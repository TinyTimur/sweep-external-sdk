import type { ChainAction, WalletAuthorization } from '../shared/types.js'

export * from '../shared/index.js'

/** Minimal EIP-1193 provider surface the SDK needs. */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
}

export interface ChainMetadata {
  name: string
  rpcUrls: string[]
  nativeCurrency: { name: string; symbol: string; decimals: number }
  explorerUrl?: string
}

/**
 * Read wallet_getCapabilities immediately before prepare and pass the result
 * unchanged in walletContext.walletCapabilities. {} means the wallet did not
 * report capabilities; Sweep then returns sequential sendTransaction actions.
 */
export async function readWalletCapabilities(
  provider: Eip1193Provider,
  address: string
): Promise<Record<string, unknown>> {
  try {
    return (await provider.request({
      method: 'wallet_getCapabilities',
      params: [address],
    })) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** Switch the wallet to chainId, adding the chain when the wallet does not know it. */
export async function ensureChain(
  provider: Eip1193Provider,
  chainId: number,
  chains: Record<number, ChainMetadata>
): Promise<void> {
  const meta = chains[chainId]
  const hex = `0x${Number(chainId).toString(16)}`
  const current = String(await provider.request({ method: 'eth_chainId' }))
  if (current.toLowerCase() === hex) return

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hex }],
    })
  } catch (error) {
    const code = (error as { code?: number } | null)?.code
    if (code !== 4902 || !meta?.rpcUrls) throw error
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: hex,
          chainName: meta.name,
          nativeCurrency: meta.nativeCurrency,
          rpcUrls: meta.rpcUrls,
          blockExplorerUrls: meta.explorerUrl ? [meta.explorerUrl] : undefined,
        },
      ],
    })
  }
  const after = String(await provider.request({ method: 'eth_chainId' }))
  if (after.toLowerCase() !== hex) {
    throw new Error(`Wallet is not on ${meta?.name || chainId}`)
  }
}

/**
 * Sign the prepared EIP-712 authorization with eth_signTypedData_v4.
 * The EIP712Domain declaration is built from the fields the returned domain
 * actually carries; no returned value is modified.
 */
export async function signAuthorization(
  provider: Eip1193Provider,
  address: string,
  authorization: WalletAuthorization
): Promise<{ signature: string }> {
  const domain = authorization.domain
  const typedData = {
    domain,
    types: {
      EIP712Domain: [
        ...(domain?.name !== undefined ? [{ name: 'name', type: 'string' }] : []),
        ...(domain?.version !== undefined
          ? [{ name: 'version', type: 'string' }]
          : []),
        ...(domain?.chainId !== undefined
          ? [{ name: 'chainId', type: 'uint256' }]
          : []),
        ...(domain?.verifyingContract !== undefined
          ? [{ name: 'verifyingContract', type: 'address' }]
          : []),
      ],
      ...authorization.types,
    },
    primaryType: authorization.primaryType,
    message: authorization.message,
  }
  const signature = (await provider.request({
    method: 'eth_signTypedData_v4',
    params: [address, JSON.stringify(typedData)],
  })) as string
  return { signature } // 65-byte ECDSA hex
}

export interface ChainActionEvidence {
  bundleId: string | null
  txHashes: string[]
}

export interface ExecuteChainActionOptions {
  /** Waits for a receipt and throws on revert; used between dependent sequential transactions. */
  waitForReceipt: (chainId: number, hash: string) => Promise<unknown>
  /** Optional: raise the gas LIMIT of prepared transactions, e.g. (g) => (g * 125n) / 100n. */
  addGasMargin?: (gas: bigint) => bigint
  /** Called as soon as a hash or bundle id exists; persist it before continuing. */
  onEvidence?: (evidence: ChainActionEvidence) => void | Promise<void>
}

const toHexQuantity = (v: string | number | bigint): string =>
  `0x${BigInt(v).toString(16)}`

/**
 * Execute one prepared chain action exactly as returned.
 * Returns the evidence to report to /submitted: a bundle id for
 * wallet_sendCalls, ordered hashes for sendTransaction.
 * Never alters to, data, value or call order.
 */
export async function executeChainAction(
  provider: Eip1193Provider,
  address: string,
  action: ChainAction,
  options: ExecuteChainActionOptions
): Promise<ChainActionEvidence> {
  const { waitForReceipt, addGasMargin = (g) => g, onEvidence } = options

  if (action.submitMethod === 'wallet_sendCalls') {
    const calls = (action.calls ?? []).map((c) => ({
      to: c.to,
      data: c.data || '0x',
      value: toHexQuantity(c.value || '0'),
    }))
    let batchId: unknown
    try {
      const r = await provider.request({
        method: 'wallet_sendCalls',
        params: [
          {
            version: '2.0.0',
            id: `partner-call-${globalThis.crypto.randomUUID()}`,
            chainId: toHexQuantity(action.chainId),
            from: address,
            atomicRequired: Boolean(action.atomicRequired),
            calls,
          },
        ],
      })
      batchId = typeof r === 'string' ? r : (r as { id?: string } | null)?.id
    } catch (error) {
      if ((error as { code?: number } | null)?.code === 4001) throw error // user rejection: stop
      // Older EIP-5792 wallets accept the 1.0 shape.
      const r = await provider.request({
        method: 'wallet_sendCalls',
        params: [
          {
            version: '1.0',
            chainId: toHexQuantity(action.chainId),
            from: address,
            calls,
          },
        ],
      })
      batchId = typeof r === 'string' ? r : (r as { id?: string } | null)?.id
    }
    if (!batchId || typeof batchId !== 'string' || [...batchId].length > 255) {
      throw new Error('Wallet accepted the batch but returned no reportable id')
    }
    const evidence: ChainActionEvidence = { bundleId: batchId, txHashes: [] }
    await onEvidence?.(evidence) // report the bundle id NOW
    return evidence
  }

  if (action.submitMethod !== 'sendTransaction') {
    throw new Error(`Unsupported submitMethod "${String(action.submitMethod)}"`)
  }

  const txHashes: string[] = []
  const transactions = action.transactions ?? []
  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i]!
    const params: Record<string, string> = {
      from: address,
      to: tx.to,
      value: toHexQuantity(tx.value || '0'),
    }
    if (tx.data) params.data = tx.data
    if (tx.gas) params.gas = toHexQuantity(addGasMargin(BigInt(tx.gas)))

    const hash = (await provider.request({
      method: 'eth_sendTransaction',
      params: [params],
    })) as string
    txHashes.push(hash)
    await onEvidence?.({ bundleId: null, txHashes: [...txHashes] })

    if (i < transactions.length - 1) {
      await waitForReceipt(action.chainId, hash) // later calls depend on it
    }
  }
  return { bundleId: null, txHashes }
}

export type RpcCall = (
  chainId: number,
  method: string,
  params: unknown[]
) => Promise<unknown>

/** Poll a read-only RPC for a transaction receipt; throws on revert or timeout. */
export async function waitForReceipt(
  rpc: RpcCall,
  chainId: number,
  hash: string,
  timeoutMs = 300_000
): Promise<unknown> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const receipt = (await rpc(chainId, 'eth_getTransactionReceipt', [hash])) as {
      status?: string
    } | null
    if (receipt) {
      if (receipt.status && BigInt(receipt.status) === 0n) {
        throw new Error(`Transaction reverted: ${hash}`)
      }
      return receipt
    }
    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error(`Timed out waiting for ${hash}`)
}
