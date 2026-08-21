import { describe, expect, it } from 'vitest'
import { decimalToRawUnits, sumSettledTargetRaw } from '../src/shared/amounts.js'

describe('decimalToRawUnits', () => {
  it('converts a plain decimal', () => {
    expect(decimalToRawUnits('9.95', 6)).toBe(9_950_000n)
  })

  it('tolerates zero padding past the token decimals', () => {
    expect(decimalToRawUnits('2.747857000000000000', 6)).toBe(2_747_857n)
  })

  it('handles integers and zero', () => {
    expect(decimalToRawUnits('10', 6)).toBe(10_000_000n)
    expect(decimalToRawUnits('0', 6)).toBe(0n)
  })

  it('throws instead of rounding real value away', () => {
    expect(() => decimalToRawUnits('1.0000001', 6)).toThrow(/significant decimals/)
  })

  it('rejects malformed input', () => {
    expect(() => decimalToRawUnits('1e6', 6)).toThrow(/invalid decimal amount/)
    expect(() => decimalToRawUnits('-1', 6)).toThrow(/invalid decimal amount/)
    expect(() => decimalToRawUnits('.5', 6)).toThrow(/invalid decimal amount/)
    expect(() => decimalToRawUnits('1.2.3', 6)).toThrow()
  })
})

describe('sumSettledTargetRaw', () => {
  const target = { chainId: 42161, symbol: 'USDC', decimals: 6 }

  it('sums only outputs matching the target', () => {
    const total = sumSettledTargetRaw(
      [
        { chainId: 42161, symbol: 'USDC', amount: '9.950000000000000000', amountBasis: 'estimated' },
        { chainId: 42161, symbol: 'USDC', amount: '0.05', amountBasis: 'estimated' },
        { chainId: 8453, symbol: 'USDC', amount: '1', amountBasis: 'actual' },
        { chainId: 42161, symbol: 'WETH', amount: '1', amountBasis: 'actual' },
      ],
      target
    )
    expect(total).toBe(10_000_000n)
  })

  it('returns 0n when nothing matches', () => {
    expect(sumSettledTargetRaw([], target)).toBe(0n)
  })
})
