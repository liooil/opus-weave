export interface Rational {
  numerator: number
  denominator: number
}

export const ZERO: Rational = Object.freeze({ numerator: 0, denominator: 1 })
export const ONE: Rational = Object.freeze({ numerator: 1, denominator: 1 })

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y !== 0) {
    const next = x % y
    x = y
    y = next
  }
  return x || 1
}

export function rational(numerator: number, denominator = 1): Rational {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator === 0) {
    throw new Error(`invalid rational ${numerator}/${denominator}`)
  }
  const sign = denominator < 0 ? -1 : 1
  const divisor = gcd(numerator, denominator)
  return { numerator: (numerator / divisor) * sign, denominator: Math.abs(denominator / divisor) }
}

export function parseRational(text: string): Rational | null {
  const match = /^(\d+)(?:\/(\d+))?$/.exec(text)
  if (!match) return null
  const numerator = Number(match[1])
  const denominator = Number(match[2] ?? 1)
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator === 0) return null
  return rational(numerator, denominator)
}

export function addRational(left: Rational, right: Rational): Rational {
  return rational(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  )
}

export function subtractRational(left: Rational, right: Rational): Rational {
  return rational(
    left.numerator * right.denominator - right.numerator * left.denominator,
    left.denominator * right.denominator,
  )
}

export function multiplyRational(left: Rational, right: Rational): Rational {
  return rational(left.numerator * right.numerator, left.denominator * right.denominator)
}

export function compareRational(left: Rational, right: Rational): number {
  return left.numerator * right.denominator - right.numerator * left.denominator
}

export function rationalToNumber(value: Rational): number {
  return value.numerator / value.denominator
}

export function formatRational(value: Rational): string {
  return value.denominator === 1 ? String(value.numerator) : `${value.numerator}/${value.denominator}`
}
