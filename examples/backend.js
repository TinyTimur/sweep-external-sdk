// Complete, runnable Sweep integrator backend in one file.
// Every name used here is defined here — nothing is left to the imagination.
//
// Run (after `npm run build` in the repo root, or with the package installed):
//   SWEEP_API_URL=... SWEEP_PARTNER_ID=... SWEEP_PARTNER_SECRET=... node examples/backend.js
//
// Endpoints served for your frontend (see examples/frontend.js):
//   POST /api/sweep/quote                 body: QuoteRequest
//   POST /api/sweep/prepare               body: { intentSessionId, walletContext }
//   POST /api/sweep/submitted             body: { attemptId, walletAuthorization, chainResults }
//   GET  /api/sweep/status/:attemptId
//   POST /webhooks/sweep                  signed Sweep webhook deliveries
//
// Simplifications versus production, called out inline:
//   - persistence is in-memory Maps; production writes to a database
//   - the ambiguous-outcome retry happens once, immediately; production
//     schedules retries with backoff and survives process restarts

import crypto from 'node:crypto'
import http from 'node:http'
import { SweepExternalClient, verifyWebhook } from 'sweep-external-sdk/server'

const PORT = Number(process.env.PORT || 8080)

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) {
    console.error(`Missing required environment variable ${name}`)
    process.exit(1)
  }
  return value
}

const config = {
  sweepApiUrl: requiredEnv('SWEEP_API_URL'),
  partnerId: requiredEnv('SWEEP_PARTNER_ID'),
  secret: requiredEnv('SWEEP_PARTNER_SECRET'),
}

const client = new SweepExternalClient(config)

// ---------------------------------------------------------------------------
// Persistence. In production every one of these writes goes to a database,
// and the pendingRequests write MUST be durable before the request is
// transmitted — that is what makes ambiguous outcomes safely retryable.
// ---------------------------------------------------------------------------
const store = {
  /** @type {Map<string, {operation: string, body: unknown, acknowledged: boolean}>} */
  pendingRequests: new Map(),
  /** @type {Set<string>} webhook eventId dedupe */
  seenWebhookEvents: new Set(),
  /** @type {Map<string, object>} attemptId -> latest snapshot (webhook or /status) */
  attempts: new Map(),
}

// Persist first, transmit second, retry the SAME body with the SAME key on an
// ambiguous outcome. `send` receives the idempotency key and performs one call.
async function mutateOnce(operation, body, send) {
  const idempotencyKey = `${operation}-${crypto.randomUUID()}`
  store.pendingRequests.set(idempotencyKey, { operation, body, acknowledged: false })

  let result = await send(idempotencyKey)
  if (!result.reachable) {
    // Outcome unknown — replay the identical request once. Production retries
    // with backoff until Sweep answers, surviving restarts via the store.
    result = await send(idempotencyKey)
  }
  if (result.reachable) {
    store.pendingRequests.get(idempotencyKey).acknowledged = true
  }
  return result
}

// Map a client result onto an HTTP response for our frontend.
function relay(res, result) {
  if (!result.reachable) {
    return sendJson(res, 503, { error: result.error })
  }
  // Success and Sweep-rejected responses both pass through: the frontend
  // needs quoteStatus/error codes either way. See the /errors tables.
  return sendJson(res, result.upstreamStatus, result.response)
}

// ---------------------------------------------------------------------------
// HTTP plumbing (node:http keeps the example dependency-free)
// ---------------------------------------------------------------------------
function sendJson(res, status, payload) {
  const bytes = Buffer.from(JSON.stringify(payload))
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(bytes)
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  try {
    // -- Webhook receiver: verify raw bytes BEFORE parsing, dedupe, then 2xx.
    if (req.method === 'POST' && url.pathname === '/webhooks/sweep') {
      const rawBody = await readRawBody(req)
      const verdict = verifyWebhook(
        { partnerId: config.partnerId, secret: config.secret },
        { rawBody, headers: req.headers },
      )
      if (!verdict.ok) return sendJson(res, verdict.status, { error: verdict.error })
      if (!store.seenWebhookEvents.has(verdict.payload.eventId)) {
        store.seenWebhookEvents.add(verdict.payload.eventId) // durable in production
        store.attempts.set(verdict.payload.attemptId, verdict.payload)
        console.log(`webhook: attempt ${verdict.payload.attemptId} -> ${verdict.payload.event}`)
      }
      res.writeHead(200)
      return res.end()
    }

    if (req.method === 'POST' && url.pathname === '/api/sweep/quote') {
      const intent = JSON.parse((await readRawBody(req)).toString('utf8'))
      const result = await mutateOnce('quote', intent, (key) => client.quote(intent, key))
      return relay(res, result)
    }

    if (req.method === 'POST' && url.pathname === '/api/sweep/prepare') {
      const { intentSessionId, walletContext } = JSON.parse((await readRawBody(req)).toString('utf8'))
      const result = await mutateOnce('prepare', { intentSessionId, walletContext }, (key) =>
        client.prepare(intentSessionId, { walletContext }, key),
      )
      if (result.reachable && result.ok && result.response.status !== 'prepared') {
        // Replayed attempt that already has evidence or is terminal: the
        // frontend must NOT execute chainActions again.
        console.warn(`prepare replayed attempt ${result.response.attemptId} in status ${result.response.status}`)
      }
      return relay(res, result)
    }

    if (req.method === 'POST' && url.pathname === '/api/sweep/submitted') {
      const { attemptId, walletAuthorization, chainResults } = JSON.parse((await readRawBody(req)).toString('utf8'))
      const body = { walletAuthorization, chainResults }
      const result = await mutateOnce('submitted', body, (key) => client.submitted(attemptId, body, key))
      if (result.reachable && result.ok) store.attempts.set(attemptId, result.response)
      return relay(res, result)
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/sweep/status/')) {
      const attemptId = decodeURIComponent(url.pathname.slice('/api/sweep/status/'.length))
      const result = await client.status(attemptId)
      if (result.reachable && result.ok) store.attempts.set(attemptId, result.response)
      return relay(res, result)
    }

    return sendJson(res, 404, { error: 'not_found' })
  } catch (error) {
    console.error(error)
    return sendJson(res, 500, { error: 'internal_error' })
  }
})

// Prove credentials, clock and signature implementation before serving.
const ping = await client.ping()
if (!ping.reachable || !ping.ok) {
  console.error('Sweep ping failed:', JSON.stringify(ping.reachable ? ping.response : ping.error))
  process.exit(1)
}
console.log(`Authenticated as partner "${ping.response.partnerId}"`)

server.listen(PORT, () => {
  console.log(`Integrator backend listening on http://localhost:${PORT}`)
})
