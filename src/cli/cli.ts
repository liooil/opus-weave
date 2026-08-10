/**
 * cli — argument helpers shared by all CLI actions.
 * Actions receive a plain record from BunDesk: flag name -> string value.
 */

export type ActionArgs = Record<string, unknown>

export function requireString(args: ActionArgs, name: string): string {
  const v = args[name]
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`missing required argument --${name}`)
  }
  return v
}

export function optionalNumber(args: ActionArgs, name: string, fallback: number): number {
  const v = args[name]
  if (v === undefined) return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`--${name} must be a number, got: ${v}`)
  return n
}

export function optionalString(args: ActionArgs, name: string): string | undefined {
  const v = args[name]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/** Pretty-print a JSON result for CLI output. */
export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2))
}
