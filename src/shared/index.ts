export * from './types.js'
export { decimalToRawUnits, sumSettledTargetRaw } from './amounts.js'
export type { SettledTarget } from './amounts.js'

export const TERMINAL_ATTEMPT_STATUSES = ['settled', 'failed', 'expired'] as const

export const WEBHOOK_EVENTS = [
  'wallet_submitted',
  'provider_pending',
  'settled',
  'failed',
] as const
