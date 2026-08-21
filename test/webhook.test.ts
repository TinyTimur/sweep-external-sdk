import { describe, expect, it } from 'vitest'
import { buildWebhookSignature, verifyWebhook } from '../src/server/webhook.js'

const CONFIG = { partnerId: 'partner-example', secret: 'test-secret' }

const payload = {
  eventId: 'evt_1',
  event: 'settled',
  occurredAt: '2030-01-01T00:05:00.000Z',
  attemptId: 'attempt_1',
  intentSessionId: 'intent_1',
  partnerId: 'partner-example',
  status: 'settled',
  currentStatus: 'settled',
  walletAddress: '0x1111111111111111111111111111111111111111',
  recipient: '0x1111111111111111111111111111111111111111',
  submittedAt: 1893456030000,
  perChainStatus: [],
  settledOutputs: [],
}

function makeDelivery(overrides: { body?: unknown; headers?: Record<string, string> } = {}) {
  const now = 1893456030000
  const rawBody = Buffer.from(JSON.stringify(overrides.body ?? payload), 'utf8')
  const timestamp = String(now)
  const headers = {
    'x-partner-id': CONFIG.partnerId,
    'x-timestamp': timestamp,
    'x-signature': buildWebhookSignature(CONFIG.secret, timestamp, rawBody),
    'x-sweep-event-id': 'evt_1',
    ...overrides.headers,
  }
  return { rawBody, headers, now }
}

describe('verifyWebhook', () => {
  it('accepts a correctly signed delivery', () => {
    const d = makeDelivery()
    const result = verifyWebhook(CONFIG, d)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.payload.eventId).toBe('evt_1')
  })

  it('rejects a tampered body', () => {
    const d = makeDelivery()
    const tampered = Buffer.from(
      d.rawBody.toString('utf8').replace('settled', 'failed!'),
      'utf8'
    )
    const result = verifyWebhook(CONFIG, { ...d, rawBody: tampered })
    expect(result).toMatchObject({ ok: false, status: 401 })
  })

  it('rejects excessive clock skew', () => {
    const d = makeDelivery()
    const result = verifyWebhook(CONFIG, { ...d, now: d.now + 6 * 60_000 })
    expect(result).toMatchObject({ ok: false, status: 401 })
  })

  it('rejects an event id mismatch', () => {
    const d = makeDelivery({ headers: { 'x-sweep-event-id': 'evt_other' } })
    const result = verifyWebhook(CONFIG, d)
    expect(result).toMatchObject({ ok: false, error: 'invalid_webhook_payload' })
  })

  it('rejects an unknown event type', () => {
    const d = makeDelivery({ body: { ...payload, event: 'expired', status: 'expired' } })
    const result = verifyWebhook(CONFIG, d)
    expect(result).toMatchObject({ ok: false, error: 'invalid_webhook_payload' })
  })

  it('rejects a wrong partner id', () => {
    const d = makeDelivery({ headers: { 'x-partner-id': 'someone-else' } })
    const result = verifyWebhook(CONFIG, d)
    expect(result).toMatchObject({ ok: false, status: 401 })
  })
})
