// Complete browser-side Sweep flow. Every name used here is defined here.
//
// This module imports a bare specifier ('sweep-external-sdk/browser'), so it
// is consumed through your bundler (Vite, webpack, esbuild — anything).
// Wire `runSweep` to your UI:
//
//   import { runSweep } from './frontend.js'
//   const snapshot = await runSweep(provider, address, intent, { onStatus: render })
//
// where `provider` is the EIP-1193 provider of the connected wallet (from
// EIP-6963 discovery or your wallet library) and `intent` is the QuoteRequest
// your UI assembled (sources, target, recipient — see the docs' /api/quote).

import {
  readWalletCapabilities,
  ensureChain,
  signAuthorization,
  executeChainAction,
  waitForReceipt,
} from 'sweep-external-sdk/browser'

// ---------------------------------------------------------------------------
// Chain metadata for wallet_addEthereumChain and read-only receipt polling.
// Extend with every chain you let users sweep from. Public RPC endpoints are
// fine for reading receipts; swap in your own for production traffic.
// ---------------------------------------------------------------------------
const CHAINS = {
  8453: {
    name: 'Base',
    rpcUrls: ['https://mainnet.base.org'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    explorerUrl: 'https://basescan.org',
  },
  42161: {
    name: 'Arbitrum One',
    rpcUrls: ['https://arb1.arbitrum.io/rpc'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    explorerUrl: 'https://arbiscan.io',
  },
}

// Minimal JSON-RPC caller used by waitForReceipt (read-only, keyless).
async function rpc(chainId, method, params) {
  const response = await fetch(CHAINS[chainId].rpcUrls[0], {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const body = await response.json()
  if (body.error) throw new Error(`RPC ${method} failed: ${body.error.message}`)
  return body.result
}

// Calls into YOUR backend (examples/backend.js) — never into Sweep directly:
// the partner secret lives server-side only.
async function backend(path, body) {
  const response = await fetch(`/api/sweep${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(`${path} failed: ${payload.error ?? response.status}`)
  return payload
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------
// The whole flow: quote -> prepare -> sign -> execute -> report -> poll.
// ---------------------------------------------------------------------------
export async function runSweep(provider, address, intent, { onStatus = () => {} } = {}) {
  // 1. Quote. Show economics from selectedPlan to the user before continuing.
  const quote = await backend('/quote', intent)
  if (quote.quoteStatus !== 'ready') {
    throw new Error(`No executable plan: ${quote.quoteStatus}`)
  }
  onStatus({ step: 'quoted', quote })
  // In a real UI the user reviews and confirms here, before expiresAt passes.

  // 2. Prepare, with capabilities read immediately before the call.
  const walletCapabilities = await readWalletCapabilities(provider, address)
  const prepared = await backend('/prepare', {
    intentSessionId: quote.intentSessionId,
    walletContext: { connectorName: 'example', connectorId: 'injected', walletCapabilities },
  })
  if (prepared.status !== 'prepared') {
    // Replayed attempt that already has evidence — do NOT execute again.
    onStatus({ step: 'resumed', attemptId: prepared.attemptId })
    return pollUntilTerminal(prepared.attemptId, onStatus)
  }
  onStatus({ step: 'prepared', attemptId: prepared.attemptId })

  // 3. Sign the EIP-712 authorization exactly as returned.
  const { signature } = await signAuthorization(provider, address, prepared.walletAuthorization)

  // 4. Execute every chain action in order, reporting evidence as it appears.
  const evidenceByChain = new Map()
  for (const action of prepared.chainActions) {
    await ensureChain(provider, action.chainId, CHAINS)
    await executeChainAction(provider, address, action, {
      waitForReceipt: (chainId, hash) => waitForReceipt(rpc, chainId, hash),
      onEvidence: async (evidence) => {
        // Report the moment evidence exists — a crash after broadcast must
        // not lose it. Later receipt hashes go up as additive evidence.
        evidenceByChain.set(action.chainId, evidence)
        await backend('/submitted', {
          attemptId: prepared.attemptId,
          walletAuthorization: { signature },
          chainResults: [...evidenceByChain.entries()].map(([chainId, e]) => ({
            chainId,
            ...(e.bundleId ? { bundleId: e.bundleId } : {}),
            ...(e.txHashes.length ? { txHashes: e.txHashes } : {}),
          })),
        })
        onStatus({ step: 'evidence', chainId: action.chainId, evidence })
      },
    })
  }

  // 5. Poll until Sweep verifies settlement.
  return pollUntilTerminal(prepared.attemptId, onStatus)
}

async function pollUntilTerminal(attemptId, onStatus, intervalMs = 5000) {
  for (;;) {
    const snapshot = await backend(`/status/${encodeURIComponent(attemptId)}`)
    onStatus({ step: 'status', snapshot })
    if (['settled', 'failed', 'expired'].includes(snapshot.status)) {
      return snapshot // settled: settledOutputs[] holds the delivered amounts
    }
    await sleep(intervalMs)
  }
}
