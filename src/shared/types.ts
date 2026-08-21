/** Types mirror the frozen v1 contract (public/external-v1.openapi.json in the docs). */

export type ProviderName = 'relay' | 'across' | 'mayan' | 'symbiosis' | 'fly'

export type QuoteStatus = 'ready' | 'partial_only' | 'unavailable' | 'expired'

export type CoverageMode = 'full' | 'partial' | 'none'

export type AttemptStatus =
  | 'prepared'
  | 'wallet_submitted'
  | 'provider_pending'
  | 'settled'
  | 'failed'
  | 'expired'

export type WebhookEvent =
  | 'wallet_submitted'
  | 'provider_pending'
  | 'settled'
  | 'failed'

export type AmountBasis = 'actual' | 'estimated'

export interface SourceInput {
  chainId: number
  /** Token contract address; the zero address for a native asset. */
  address: string
  /** Positive base-10 raw-unit string. */
  amount: string
  symbol?: string
  decimals: number
  usdValue?: string
}

export interface TargetToken {
  address: string
  symbol: string
  decimals: number
  priceUSD?: string
}

export interface TargetInput {
  chainId: number
  /** Destination token address; must equal targetToken.address. */
  address: string
  targetToken: TargetToken
}

export interface QuoteRequest {
  walletAddress: string
  recipient: string
  sources: SourceInput[]
  target?: TargetInput
  targets?: TargetInput[]
  /** 1–10,000; omission means 50. Zero is rejected — omit instead. */
  slippageBps?: number
  allowPartial?: boolean
  /** Omission means all providers enabled for the partner. */
  allowedProviders?: ProviderName[]
  /** 1,000–18,000 ms. */
  maxWaitMs?: number
  /** Integer integrator markup; bounded by the partner-configured cap. */
  feeBps?: number
  callbackUrl?: string
}

export interface LegOutputRef {
  chainId: number
  tokenAddress: string
  symbol: string
  decimals: number
}

export interface LegEconomicSummary {
  expectedOutputRaw: string
  minimumOutputRaw: string
  expectedOutputAmount: string
  minimumOutputAmount: string
  output: LegOutputRef
  totalOutputUsd: number
  totalFeeUsd: number
  totalLossUsd: number
  timeEstimate: number
  [key: string]: unknown
}

export interface FailedSource {
  chainId?: number
  address?: string
  reasonCode?: string
  [key: string]: unknown
}

export interface SelectedPlanLeg {
  outputTargetId: string
  routeId: string
  provider: string
  summary: LegEconomicSummary
  failedSources: FailedSource[]
  [key: string]: unknown
}

export interface PlanSummary {
  totalOutputUsd: number
  totalFeeUsd: number
  totalLossUsd: number
  timeEstimate: number
  [key: string]: unknown
}

export interface SelectedPlan {
  isFullPlan: boolean
  providerSet: string[]
  legs: SelectedPlanLeg[]
  summary: PlanSummary
  [key: string]: unknown
}

export interface QuoteResponse {
  apiVersion: '1'
  quoteStatus: QuoteStatus
  intentSessionId: string
  expiresAt: string
  coverageMode: CoverageMode
  selectedPlan?: SelectedPlan | null
  failedSources: FailedSource[]
  [key: string]: unknown
}

export interface WalletContext {
  connectorName?: string
  connectorId?: string
  /** Unmodified result of wallet_getCapabilities; {} is valid. */
  walletCapabilities?: Record<string, unknown>
}

export interface PrepareRequest {
  walletContext?: WalletContext
}

export interface ChainCall {
  to: string
  data: string
  value: string
  callId: string
  callIndex: number
  quoteIndex: number
  [key: string]: unknown
}

export interface ChainTransaction {
  to: string
  data?: string
  value?: string
  gas?: string
  [key: string]: unknown
}

export interface ChainAction {
  chainId: number
  submitMethod: 'sendTransaction' | 'wallet_sendCalls'
  atomicRequired: boolean
  calls: ChainCall[] | null
  transactions: ChainTransaction[] | null
  transactionCount: number
  quoteCount: number
  [key: string]: unknown
}

export interface WalletAuthorization {
  domain: { name?: string; version?: string; [key: string]: unknown }
  types: Record<string, Array<{ name: string; type: string }>>
  primaryType: string
  message: Record<string, unknown>
}

export interface PrepareResponse {
  apiVersion: '1'
  attemptId: string
  intentSessionId: string
  status: AttemptStatus
  expiresAt: string
  evidenceDeadlineAt: string
  chainActions: ChainAction[]
  walletAuthorization: WalletAuthorization
  [key: string]: unknown
}

export interface ChainResult {
  chainId: number
  /** Non-empty string, max 255 chars. */
  bundleId?: string
  /** Up to 64 entries; each a 32-byte 0x-prefixed hex value. */
  txHashes?: string[]
}

export interface SubmittedRequest {
  walletAuthorization: { signature: string }
  /** 1–16 entries, one per source chain. */
  chainResults: ChainResult[]
}

export interface SettledOutput {
  chainId: number
  symbol: string
  /** Decimal token string; may be padded past the token's decimals. */
  amount: string
  amountBasis: AmountBasis
  txHash?: string
  [key: string]: unknown
}

export interface PerChainStatus {
  chainId: number
  status: string
  txHashes?: string[]
  bundleId?: string
  [key: string]: unknown
}

export interface StatusResponse {
  apiVersion: '1'
  attemptId: string
  intentSessionId: string
  partnerId: string
  walletAddress: string
  recipient: string
  status: AttemptStatus
  expiresAt: string
  evidenceDeadlineAt: string
  submittedAt: number | null
  perChainStatus: PerChainStatus[]
  settledOutputs: SettledOutput[]
  [key: string]: unknown
}

export interface PingResponse {
  apiVersion: '1'
  ok: true
  partnerId: string
}

export interface SweepErrorBody {
  apiVersion: '1'
  error: string
  code?: string
  message?: string
  path?: string
  [key: string]: unknown
}

export interface WebhookPayload {
  eventId: string
  event: WebhookEvent
  occurredAt: string
  attemptId: string
  intentSessionId: string
  partnerId: string
  status: string
  currentStatus: AttemptStatus
  walletAddress: string
  recipient: string
  submittedAt: number | null
  perChainStatus: PerChainStatus[]
  settledOutputs: SettledOutput[]
  [key: string]: unknown
}
