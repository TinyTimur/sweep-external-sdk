import { describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import { buildCanonicalSignature } from '../src/server/signature.js'
import { SweepExternalClient } from '../src/server/client.js'

const SECRET = 'test-secret'

describe('buildCanonicalSignature', () => {
  it('builds the exact canonical v2 signing string', () => {
    const body = '{"walletAddress":"0x1111111111111111111111111111111111111111"}'
    const { signingString } = buildCanonicalSignature(SECRET, {
      partnerId: 'partner-example',
      timestamp: '1893456000000',
      nonce: 'req-00000000-0000-4000-8000-000000000001',
      method: 'post',
      path: '/api/external/intents/quote',
      idempotencyKey: 'quote-00000000-0000-4000-8000-000000000001',
      rawBody: body,
    })

    expect(signingString).toBe(
      [
        'SWEEP-EXTERNAL-REQUEST',
        'auth-version:2',
        'api-version:1',
        'partner-id:partner-example',
        'timestamp:1893456000000',
        'nonce:req-00000000-0000-4000-8000-000000000001',
        'method:POST',
        'path:/api/external/intents/quote',
        'idempotency-key:quote-00000000-0000-4000-8000-000000000001',
        `body-sha256:${crypto.createHash('sha256').update(body).digest('hex')}`,
      ].join('\n')
    )
    expect(signingString.endsWith('\n')).toBe(false)
  })

  it('matches a precomputed signature vector', () => {
    // Vector computed independently; guards against accidental changes to the
    // canonical string layout or HMAC construction.
    const { signature } = buildCanonicalSignature('vector-secret', {
      partnerId: 'p1',
      timestamp: '1700000000000',
      nonce: 'nonce-0000000000000000',
      method: 'GET',
      path: '/api/external/ping',
      idempotencyKey: '',
      rawBody: '',
    })
    const expected = crypto
      .createHmac('sha256', 'vector-secret')
      .update(
        [
          'SWEEP-EXTERNAL-REQUEST',
          'auth-version:2',
          'api-version:1',
          'partner-id:p1',
          'timestamp:1700000000000',
          'nonce:nonce-0000000000000000',
          'method:GET',
          'path:/api/external/ping',
          'idempotency-key:',
          // SHA-256 of zero bytes:
          'body-sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        ].join('\n')
      )
      .digest('hex')
    expect(signature).toBe(expected)
  })
})

describe('SweepExternalClient', () => {
  const config = {
    sweepApiUrl: 'https://sweep.example',
    partnerId: 'partner-example',
    secret: SECRET,
  }

  it('signs and transmits the exact same POST bytes', async () => {
    let captured: { url: string; init: RequestInit } | undefined
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      captured = { url: String(url), init: init! }
      return new Response('{"apiVersion":"1","quoteStatus":"ready"}', { status: 200 })
    }) as typeof fetch

    const client = new SweepExternalClient(config, { fetchImpl })
    const result = await client.quote(
      { walletAddress: '0x1', recipient: '0x1', sources: [] } as never,
      'key-1'
    )

    expect(result.reachable).toBe(true)
    if (!result.reachable) return
    expect(result.ok).toBe(true)

    const headers = captured!.init.headers as Record<string, string>
    const rawBody = captured!.init.body as string
    const { signature } = buildCanonicalSignature(SECRET, {
      partnerId: config.partnerId,
      timestamp: headers['x-timestamp']!,
      nonce: headers['x-nonce']!,
      method: 'POST',
      path: '/api/external/intents/quote',
      idempotencyKey: 'key-1',
      rawBody,
    })
    expect(headers['x-signature']).toBe(signature)
    expect(headers['x-sweep-auth-version']).toBe('2')
    expect(headers['idempotency-key']).toBe('key-1')
    expect(captured!.url).toBe('https://sweep.example/api/external/intents/quote')
  })

  it('GET sends no body, no idempotency key and signs empty values', async () => {
    let captured: { init: RequestInit } | undefined
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      captured = { init: init! }
      return new Response('{"apiVersion":"1","ok":true,"partnerId":"partner-example"}', {
        status: 200,
      })
    }) as typeof fetch

    const client = new SweepExternalClient(config, { fetchImpl })
    await client.ping()

    const headers = captured!.init.headers as Record<string, string>
    expect(captured!.init.body).toBeUndefined()
    expect(headers['idempotency-key']).toBeUndefined()
    expect(headers['content-type']).toBeUndefined()
  })

  it('reports an ambiguous network failure as unreachable', async () => {
    const fetchImpl = (async () => {
      throw new Error('socket hang up')
    }) as typeof fetch
    const client = new SweepExternalClient(config, { fetchImpl })
    const result = await client.status('attempt_1')
    expect(result).toEqual({ reachable: false, error: 'sweep_unreachable' })
  })

  it('generates a fresh nonce per request', async () => {
    const nonces: string[] = []
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      nonces.push((init!.headers as Record<string, string>)['x-nonce']!)
      return new Response('{}', { status: 200 })
    }) as typeof fetch
    const client = new SweepExternalClient(config, { fetchImpl })
    await client.ping()
    await client.ping()
    expect(nonces[0]).not.toBe(nonces[1])
  })
})
