/** Argument helpers shared by OpusWeave's application-owned CLI commands. */

export type CliArgs = Record<string, unknown>

export function parseLongOptions(command: string, argv: string[], allowedNames: readonly string[]): CliArgs {
  const allowed = new Set(allowedNames)
  const result: CliArgs = {}

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!
    if (!token.startsWith('--')) {
      throw new Error(`${command}: unexpected positional argument: ${token}`)
    }

    const equals = token.indexOf('=')
    const name = token.slice(2, equals === -1 ? undefined : equals)
    if (!allowed.has(name)) throw new Error(`${command}: unknown option --${name}`)

    if (equals !== -1) {
      result[name] = token.slice(equals + 1)
      continue
    }

    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${command}: option --${name} requires a value`)
    }
    result[name] = value
    index++
  }

  return result
}

export function requireString(args: CliArgs, name: string): string {
  const v = args[name]
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`missing required argument --${name}`)
  }
  return v
}

export function optionalNumber(args: CliArgs, name: string, fallback: number): number {
  const v = args[name]
  if (v === undefined) return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`--${name} must be a number, got: ${v}`)
  return n
}

export function optionalString(args: CliArgs, name: string): string | undefined {
  const v = args[name]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/** Pretty-print a JSON result for CLI output. */
export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2))
}
