/**
 * Shared error types for OpusWeave.
 *
 * OpusWeaveError carries an error code plus optional context (track/event/field)
 * so CLI, MCP and GUI can surface precise messages instead of raw stack text.
 */

export type OpusWeaveErrorCode =
  | 'invalid-spec'
  | 'invalid-owt'
  | 'midi-corrupt'
  | 'file-not-found'
  | 'file-unreadable'
  | 'invalid-output-path'
  | 'fluidsynth-missing'
  | 'fluidsynth-failed'
  | 'webmidi-unsupported'
  | 'webmidi-denied'
  | 'soundfont-invalid'
  | 'internal'

export class OpusWeaveError extends Error {
  readonly code: OpusWeaveErrorCode
  /** Optional per-issue breakdown for validation errors. */
  readonly issues?: string[]

  constructor(code: OpusWeaveErrorCode, message: string, issues?: string[]) {
    super(message)
    this.name = 'OpusWeaveError'
    this.code = code
    this.issues = issues
  }
}

export function toErrorMessage(err: unknown): string {
  if (err instanceof OpusWeaveError) return err.message
  if (err instanceof Error) return err.message
  return String(err)
}
