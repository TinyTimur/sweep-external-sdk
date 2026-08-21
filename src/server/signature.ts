import crypto from 'node:crypto'

const sha256Hex = (v: string): string =>
  crypto.createHash('sha256').update(v).digest('hex')

const hmacHex = (secret: string, v: string): string =>
  crypto.createHmac('sha256', secret).update(v).digest('hex')

export interface CanonicalSignatureInput {
  partnerId: string
  /** Unix epoch milliseconds, as a decimal string. */
  timestamp: string
  nonce: string
  method: string
  /** Full deployed pathname (/api/external/...), no query string. */
  path: string
  /** Empty string for GET. */
  idempotencyKey?: string
  /** Exact raw request bytes; empty string for GET. */
  rawBody?: string
}

export interface CanonicalSignature {
  signingString: string
  signature: string
}

/** Build the canonical auth v2 signing string and its HMAC-SHA256 signature. */
export function buildCanonicalSignature(
  secret: string,
  input: CanonicalSignatureInput
): CanonicalSignature {
  const signingString = [
    'SWEEP-EXTERNAL-REQUEST',
    'auth-version:2',
    'api-version:1',
    `partner-id:${input.partnerId}`,
    `timestamp:${input.timestamp}`,
    `nonce:${input.nonce}`,
    `method:${input.method.toUpperCase()}`,
    `path:${input.path}`,
    `idempotency-key:${input.idempotencyKey || ''}`,
    `body-sha256:${sha256Hex(input.rawBody || '')}`,
  ].join('\n')
  return { signingString, signature: hmacHex(secret, signingString) }
}
