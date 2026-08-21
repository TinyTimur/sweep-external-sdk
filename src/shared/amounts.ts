import type { SettledOutput } from './types.js'

/**
 * Convert a decimal token string to raw units without floating-point math.
 * Tolerates zero padding past `decimals` ("2.747857000000000000" with 6 -> 2747857n)
 * and throws instead of rounding real value away.
 */
export function decimalToRawUnits(amount: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`invalid decimals: ${decimals}`)
  }
  const parts = String(amount).split('.')
  if (parts.length > 2) {
    throw new Error(`invalid decimal amount: ${amount}`)
  }
  const [whole, fraction = ''] = parts
  if (!whole || !/^\d+$/.test(whole) || (fraction && !/^\d+$/.test(fraction))) {
    throw new Error(`invalid decimal amount: ${amount}`)
  }
  if (/[1-9]/.test(fraction.slice(decimals))) {
    throw new Error(`more than ${decimals} significant decimals: ${amount}`)
  }
  const kept = fraction.slice(0, decimals).padEnd(decimals, '0')
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(kept || '0')
}

export interface SettledTarget {
  chainId: number
  symbol: string
  decimals: number
}

/**
 * Sum the settled outputs matching a target token, in raw units.
 * Spend the sum automatically only when every included output has
 * amountBasis "actual"; resolve and confirm "estimated" amounts instead.
 */
export function sumSettledTargetRaw(
  settledOutputs: SettledOutput[],
  target: SettledTarget
): bigint {
  return settledOutputs
    .filter((o) => o.chainId === target.chainId && o.symbol === target.symbol)
    .reduce((acc, o) => acc + decimalToRawUnits(o.amount, target.decimals), 0n)
}
