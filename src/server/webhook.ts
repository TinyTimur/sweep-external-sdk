import crypto from 'node:crypto'
import type { WebhookPayload } from '../shared/types.js'

const WEBHOOK_MAX_SKEW_MS = 5 * 60_000
const WEBHOOK_EVENT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const WEBHOOK_EVENTS = new Set([
  'wallet_submitted',
  'provider_pending',
  'settled',
  'failed',
])

const safeHexEqual = (a: unknown, b: unknown): boolean => {
  const A = Buffer.from(String(a || ''), 'utf8')
  const B = Buffer.from(String(b || ''), 'utf8')
  return A.length > 0 && A.length === B.length && crypto.timingSafeEqual(A, B)
}

/** Frozen webhook signature: HMAC_SHA256(secret, `${timestamp}.${rawBody}`). */
export const buildWebhookSignature = (
  secret: string,
  timestamp: string,
  rawBody: Buffer | string
): string =>
  crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex')

export interface WebhookVerifyConfig {
  partnerId: string
  secret: string
}

export interface WebhookVerifyInput {
  /** Exact raw request bytes, captured before any JSON parsing. */
  rawBody: Buffer
  /** Incoming request headers (lower-cased keys, as in Node). */
  headers: Record<string, string | string[] | undefined>
  now?: number
}

export type WebhookVerifyResult =
  | { ok: true; payload: WebhookPayload }
  | {
      ok: false
      status: 400 | 401
      error:
        | 'invalid_webhook_body'
        | 'invalid_webhook_signature'
        | 'invalid_webhook_payload'
    }

/**
 * Verify a Sweep webhook from raw bytes.
 * After ok: true, durably deduplicate payload.eventId, persist, then return 2xx.
 */
export function verifyWebhook(
  config: WebhookVerifyConfig,
  input: WebhookVerifyInput
): WebhookVerifyResult {
  const { rawBody, headers } = input
  const now = input.now ?? Date.now()
  if (!Buffer.isBuffer(rawBody)) {
    return { ok: false, status: 400, error: 'invalid_webhook_body' }
  }
  const header = (name: string): string => {
    const v = headers[name]
    return String(Array.isArray(v) ? v[0] ?? '' : v ?? '').trim()
  }
  const partnerId = header('x-partner-id')
  const timestamp = header('x-timestamp')
  const signature = header('x-signature')
  const eventId = header('x-sweep-event-id')
  const timestampMs = Number(timestamp)
  if (
    partnerId !== config.partnerId ||
    !Number.isFinite(timestampMs) ||
    Math.abs(now - timestampMs) > WEBHOOK_MAX_SKEW_MS ||
    !safeHexEqual(signature, buildWebhookSignature(config.secret, timestamp, rawBody))
  ) {
    return { ok: false, status: 401, error: 'invalid_webhook_signature' }
  }
  let payload: unknown
  try {
    payload = JSON.parse(rawBody.toString('utf8'))
  } catch {
    return { ok: false, status: 400, error: 'invalid_webhook_body' }
  }
  const p = payload as WebhookPayload | null
  if (
    !p ||
    typeof p !== 'object' ||
    Array.isArray(p) ||
    !WEBHOOK_EVENT_ID_RE.test(eventId) ||
    p.eventId !== eventId ||
    p.partnerId !== config.partnerId ||
    !WEBHOOK_EVENTS.has(p.event) ||
    p.status !== p.event ||
    typeof p.attemptId !== 'string'
  ) {
    return { ok: false, status: 400, error: 'invalid_webhook_payload' }
  }
  return { ok: true, payload: p }
}
