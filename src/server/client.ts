import crypto from 'node:crypto'
import { buildCanonicalSignature } from './signature.js'
import type {
  PingResponse,
  PrepareRequest,
  PrepareResponse,
  QuoteRequest,
  QuoteResponse,
  StatusResponse,
  SubmittedRequest,
  SweepErrorBody,
} from '../shared/types.js'

export interface SweepClientConfig {
  /** SWEEP_API_URL, no trailing slash. */
  sweepApiUrl: string
  partnerId: string
  /** SWEEP_PARTNER_SECRET. Backend only — never ship to a browser. */
  secret: string
}

export interface SweepClientOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** The request never reached a definitive outcome: retry the SAME bytes with the SAME idempotency key. */
export interface SweepUnreachableResult {
  reachable: false
  error: 'sweep_timeout' | 'sweep_unreachable'
}

export interface SweepHttpResult<T> {
  reachable: true
  ok: boolean
  upstreamStatus: number
  /** Parsed JSON body: T on success, SweepErrorBody on failure. */
  response: T | SweepErrorBody
  debug: { signingString: string }
}

export type SweepResult<T> = SweepUnreachableResult | SweepHttpResult<T>

/**
 * Canonical auth v2 client for the Sweep External API.
 * Persist { operation, path, idempotencyKey, rawBody } before each mutating
 * call and reuse them verbatim on retry.
 */
export class SweepExternalClient {
  private readonly config: SweepClientConfig
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(config: SweepClientConfig, options: SweepClientOptions = {}) {
    this.config = config
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? 45_000
  }

  ping(): Promise<SweepResult<PingResponse>> {
    return this.request('GET', '/api/external/ping')
  }

  quote(
    intent: QuoteRequest,
    idempotencyKey: string
  ): Promise<SweepResult<QuoteResponse>> {
    return this.request('POST', '/api/external/intents/quote', intent, idempotencyKey)
  }

  prepare(
    intentSessionId: string,
    body: PrepareRequest,
    idempotencyKey: string
  ): Promise<SweepResult<PrepareResponse>> {
    return this.request(
      'POST',
      `/api/external/intents/${encodeURIComponent(intentSessionId)}/prepare`,
      body,
      idempotencyKey
    )
  }

  submitted(
    attemptId: string,
    body: SubmittedRequest,
    idempotencyKey: string
  ): Promise<SweepResult<StatusResponse>> {
    return this.request(
      'POST',
      `/api/external/attempts/${encodeURIComponent(attemptId)}/submitted`,
      body,
      idempotencyKey
    )
  }

  status(attemptId: string): Promise<SweepResult<StatusResponse>> {
    return this.request(
      'GET',
      `/api/external/attempts/${encodeURIComponent(attemptId)}/status`
    )
  }

  async request<T>(
    method: 'GET' | 'POST',
    path: string,
    payload?: unknown,
    idempotencyKey?: string
  ): Promise<SweepResult<T>> {
    // Serialize ONCE; hash, sign and transmit these exact bytes.
    const rawBody = method === 'GET' ? '' : JSON.stringify(payload ?? {})
    const signedKey = method === 'GET' ? '' : idempotencyKey || ''
    const nonce = `req-${crypto.randomUUID()}`
    const timestamp = String(Date.now())
    const { signingString, signature } = buildCanonicalSignature(this.config.secret, {
      partnerId: this.config.partnerId,
      timestamp,
      nonce,
      method,
      path,
      idempotencyKey: signedKey,
      rawBody,
    })

    const headers: Record<string, string> = {
      'x-partner-id': this.config.partnerId,
      'x-timestamp': timestamp,
      'x-sweep-auth-version': '2',
      'x-nonce': nonce,
      'x-signature': signature,
    }
    if (method !== 'GET') {
      headers['content-type'] = 'application/json'
      if (idempotencyKey) headers['idempotency-key'] = idempotencyKey
    }

    let upstream: Response
    try {
      upstream = await this.fetchImpl(`${this.config.sweepApiUrl}${path}`, {
        method,
        headers,
        ...(method === 'GET' ? {} : { body: rawBody }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      return {
        reachable: false,
        error:
          error instanceof Error && error.name === 'TimeoutError'
            ? 'sweep_timeout'
            : 'sweep_unreachable',
      }
    }

    const text = await upstream.text()
    let response: unknown
    try {
      response = text ? JSON.parse(text) : {}
    } catch {
      response = { raw: text }
    }
    return {
      reachable: true,
      ok: upstream.ok,
      upstreamStatus: upstream.status,
      response: response as T | SweepErrorBody,
      debug: { signingString },
    }
  }
}
