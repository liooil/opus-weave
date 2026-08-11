/**
 * Runtime validation for CompositionSpec.
 *
 * Every value that will be written into a MIDI file is checked here.
 * Errors always name the exact track / event / field; nothing is silently
 * coerced. Warnings flag recoverable oddities (empty track lists, very high
 * tempos) without blocking export.
 */
import type { CompositionSpec } from './composition-spec.ts'

export interface ValidationIssue {
  severity: 'error' | 'warning'
  /** Index into spec.tracks, when the issue belongs to a track. */
  trackIndex?: number
  /** Index into the track's note/cc/pitchBend array, when applicable. */
  eventIndex?: number
  /** Field path such as `notes[2].pitch`. */
  field: string
  message: string
}

export interface CompositionStats {
  trackCount: number
  noteCount: number
  /** Total length in beats (max end of any note, or 0). */
  durationBeats: number
  /** Pitch range over all notes; null when there are no notes. */
  pitchRange: { min: number; max: number } | null
  /** Notes per track. */
  trackDensities: number[]
}

export interface ValidationResult {
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
  stats: CompositionStats
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v)
}

function err(
  field: string,
  message: string,
  ctx?: { trackIndex?: number; eventIndex?: number },
): ValidationIssue {
  return { severity: 'error', field, message, ...ctx }
}

function warn(
  field: string,
  message: string,
  ctx?: { trackIndex?: number; eventIndex?: number },
): ValidationIssue {
  return { severity: 'warning', field, message, ...ctx }
}

function checkNumber(
  v: unknown,
  field: string,
  range: { min: number; max: number },
  ctx: { trackIndex?: number; eventIndex?: number },
  out: ValidationIssue[],
  integer = true,
): boolean {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    out.push(err(field, `must be a finite number, got ${JSON.stringify(v)}`, ctx))
    return false
  }
  if (integer && !Number.isInteger(v)) {
    out.push(err(field, `must be an integer, got ${v}`, ctx))
    return false
  }
  if (v < range.min || v > range.max) {
    out.push(err(field, `must be in range ${range.min}–${range.max}, got ${v}`, ctx))
    return false
  }
  return true
}

export function validateCompositionSpec(input: unknown): ValidationResult {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const stats: CompositionStats = {
    trackCount: 0,
    noteCount: 0,
    durationBeats: 0,
    pitchRange: null,
    trackDensities: [],
  }

  if (!isRecord(input)) {
    errors.push(err('', `spec must be an object, got ${typeof input}`))
    return { errors, warnings, stats }
  }
  const spec = input as unknown as CompositionSpec & Record<string, unknown>

  // title (optional, string)
  if (spec.title !== undefined && typeof spec.title !== 'string') {
    errors.push(err('title', `must be a string, got ${typeof spec.title}`))
  }

  // ppq (optional, positive integer)
  if (spec.ppq !== undefined) {
    if (!isInt(spec.ppq) || spec.ppq < 1) {
      errors.push(err('ppq', `must be a positive integer, got ${JSON.stringify(spec.ppq)}`))
    }
  }

  // tracks (required, array)
  if (!Array.isArray(spec.tracks)) {
    errors.push(err('tracks', 'must be an array'))
    return { errors, warnings, stats }
  }
  stats.trackCount = spec.tracks.length
  if (spec.tracks.length === 0) {
    warnings.push(warn('tracks', 'track list is empty — the export will contain only a conductor track'))
  }

  const noteRanges = { min: Infinity, max: -Infinity }
  let totalDurationBeats = 0

  spec.tracks.forEach((rawTrack, t) => {
    const ctx = { trackIndex: t }
    if (!isRecord(rawTrack)) {
      errors.push(err('tracks[t]', `must be an object, got ${typeof rawTrack}`, ctx))
      return
    }
    const track = rawTrack as Record<string, unknown>
    const prefix = (field: string) => `tracks[${t}].${field}`

    if (track.name !== undefined && typeof track.name !== 'string') {
      errors.push(err(prefix('name'), `must be a string, got ${typeof track.name}`, ctx))
    }
    if (track.channel !== undefined) {
      checkNumber(track.channel, prefix('channel'), { min: 0, max: 15 }, ctx, errors)
    }
    if (track.program !== undefined) {
      checkNumber(track.program, prefix('program'), { min: 0, max: 127 }, ctx, errors)
    }
    if (track.volume !== undefined) {
      checkNumber(track.volume, prefix('volume'), { min: 0, max: 127 }, ctx, errors)
    }
    if (track.pan !== undefined) {
      checkNumber(track.pan, prefix('pan'), { min: 0, max: 127 }, ctx, errors)
    }

    let noteCount = 0

    // notes
    if (track.notes !== undefined) {
      if (!Array.isArray(track.notes)) {
        errors.push(err(prefix('notes'), 'must be an array', ctx))
      } else {
        track.notes.forEach((rawNote, n) => {
          const nctx = { trackIndex: t, eventIndex: n }
          if (!isRecord(rawNote)) {
            errors.push(err(prefix(`notes[${n}]`), `must be an object, got ${typeof rawNote}`, nctx))
            return
          }
          const note = rawNote as Record<string, unknown>
          const okPitch = checkNumber(note.pitch, prefix(`notes[${n}].pitch`), { min: 0, max: 127 }, nctx, errors)
          const okVel = checkNumber(note.velocity, prefix(`notes[${n}].velocity`), { min: 1, max: 127 }, nctx, errors)
          const okStart = checkNumber(note.startBeat, prefix(`notes[${n}].startBeat`), { min: 0, max: Infinity }, nctx, errors, false)
          const okDur = checkNumber(note.durationBeats, prefix(`notes[${n}].durationBeats`), { min: Number.MIN_VALUE, max: Infinity }, nctx, errors, false)

          if (okStart && okDur) {
            totalDurationBeats = Math.max(totalDurationBeats, (note.startBeat as number) + (note.durationBeats as number))
          }
          if (okPitch) {
            const p = note.pitch as number
            noteRanges.min = Math.min(noteRanges.min, p)
            noteRanges.max = Math.max(noteRanges.max, p)
          }
          if (okPitch && okVel && okStart && okDur) noteCount++
        })
      }
    }

    // controlChanges
    if (track.controlChanges !== undefined) {
      if (!Array.isArray(track.controlChanges)) {
        errors.push(err(prefix('controlChanges'), 'must be an array', ctx))
      } else {
        track.controlChanges.forEach((rawCc, n) => {
          const nctx = { trackIndex: t, eventIndex: n }
          if (!isRecord(rawCc)) {
            errors.push(err(prefix(`controlChanges[${n}]`), `must be an object, got ${typeof rawCc}`, nctx))
            return
          }
          const cc = rawCc as Record<string, unknown>
          checkNumber(cc.beat, prefix(`controlChanges[${n}].beat`), { min: 0, max: Infinity }, nctx, errors, false)
          checkNumber(cc.controller, prefix(`controlChanges[${n}].controller`), { min: 0, max: 127 }, nctx, errors)
          checkNumber(cc.value, prefix(`controlChanges[${n}].value`), { min: 0, max: 127 }, nctx, errors)
        })
      }
    }

    // pitchBends
    if (track.pitchBends !== undefined) {
      if (!Array.isArray(track.pitchBends)) {
        errors.push(err(prefix('pitchBends'), 'must be an array', ctx))
      } else {
        track.pitchBends.forEach((rawPb, n) => {
          const nctx = { trackIndex: t, eventIndex: n }
          if (!isRecord(rawPb)) {
            errors.push(err(prefix(`pitchBends[${n}]`), `must be an object, got ${typeof rawPb}`, nctx))
            return
          }
          const pb = rawPb as Record<string, unknown>
          checkNumber(pb.beat, prefix(`pitchBends[${n}].beat`), { min: 0, max: Infinity }, nctx, errors, false)
          checkNumber(pb.value, prefix(`pitchBends[${n}].value`), { min: 0, max: 16383 }, nctx, errors)
        })
      }
    }

    if (track.programChanges !== undefined) {
      if (!Array.isArray(track.programChanges)) {
        errors.push(err(prefix('programChanges'), 'must be an array', ctx))
      } else {
        track.programChanges.forEach((rawProgram, n) => {
          const nctx = { trackIndex: t, eventIndex: n }
          if (!isRecord(rawProgram)) {
            errors.push(err(prefix(`programChanges[${n}]`), `must be an object, got ${typeof rawProgram}`, nctx))
            return
          }
          checkNumber(rawProgram.beat, prefix(`programChanges[${n}].beat`), { min: 0, max: Infinity }, nctx, errors, false)
          checkNumber(rawProgram.program, prefix(`programChanges[${n}].program`), { min: 0, max: 127 }, nctx, errors)
        })
      }
    }

    stats.trackDensities.push(noteCount)
    stats.noteCount += noteCount
  })

  // tempos
  if (spec.tempos !== undefined) {
    if (!Array.isArray(spec.tempos)) {
      errors.push(err('tempos', 'must be an array'))
    } else {
      spec.tempos.forEach((rawTempo, n) => {
        const nctx = { eventIndex: n }
        if (!isRecord(rawTempo)) {
          errors.push(err(`tempos[${n}]`, `must be an object, got ${typeof rawTempo}`, nctx))
          return
        }
        const tempo = rawTempo as Record<string, unknown>
        checkNumber(tempo.beat, `tempos[${n}].beat`, { min: 0, max: Infinity }, nctx, errors, false)
        checkNumber(tempo.bpm, `tempos[${n}].bpm`, { min: Number.MIN_VALUE, max: Infinity }, nctx, errors, false)
        if (typeof tempo.bpm === 'number' && tempo.bpm > 400) {
          warnings.push(warn(`tempos[${n}].bpm`, `tempo ${tempo.bpm} BPM is unusually high`, nctx))
        }
      })
    }
  }

  // timeSignatures
  if (spec.timeSignatures !== undefined) {
    if (!Array.isArray(spec.timeSignatures)) {
      errors.push(err('timeSignatures', 'must be an array'))
    } else {
      spec.timeSignatures.forEach((rawTs, n) => {
        const nctx = { eventIndex: n }
        if (!isRecord(rawTs)) {
          errors.push(err(`timeSignatures[${n}]`, `must be an object, got ${typeof rawTs}`, nctx))
          return
        }
        const ts = rawTs as Record<string, unknown>
        checkNumber(ts.beat, `timeSignatures[${n}].beat`, { min: 0, max: Infinity }, nctx, errors, false)
        checkNumber(ts.numerator, `timeSignatures[${n}].numerator`, { min: 1, max: 64 }, nctx, errors)
        if (isInt(ts.denominator) && (ts.denominator as number) >= 1) {
          const d = ts.denominator as number
          if ((d & (d - 1)) !== 0) {
            errors.push(err(`timeSignatures[${n}].denominator`, `must be a power of two, got ${d}`, nctx))
          }
        } else {
          errors.push(err(`timeSignatures[${n}].denominator`, `must be a positive integer, got ${JSON.stringify(ts.denominator)}`, nctx))
        }
      })
    }
  }

  if (spec.keySignatures !== undefined) {
    if (!Array.isArray(spec.keySignatures)) {
      errors.push(err('keySignatures', 'must be an array'))
    } else {
      spec.keySignatures.forEach((rawKey, n) => {
        const nctx = { eventIndex: n }
        if (!isRecord(rawKey)) {
          errors.push(err(`keySignatures[${n}]`, `must be an object, got ${typeof rawKey}`, nctx))
          return
        }
        checkNumber(rawKey.beat, `keySignatures[${n}].beat`, { min: 0, max: Infinity }, nctx, errors, false)
        if (typeof rawKey.tonic !== 'string' || !/^[A-G](?:#|b)?$/.test(rawKey.tonic)) {
          errors.push(err(`keySignatures[${n}].tonic`, `must be a tonic such as C, F#, or Bb, got ${JSON.stringify(rawKey.tonic)}`, nctx))
        }
        if (rawKey.mode !== 'major' && rawKey.mode !== 'minor') {
          errors.push(err(`keySignatures[${n}].mode`, `must be major or minor, got ${JSON.stringify(rawKey.mode)}`, nctx))
        }
      })
    }
  }

  stats.durationBeats = totalDurationBeats
  if (stats.noteCount > 0) {
    stats.pitchRange = { min: noteRanges.min, max: noteRanges.max }
  }

  return { errors, warnings, stats }
}

/** True when the spec has no validation errors. */
export function isSpecValid(result: ValidationResult): boolean {
  return result.errors.length === 0
}

/** Join error messages into a single human-readable string. */
export function formatIssues(issues: ValidationIssue[]): string {
  return issues.map((i) => `${i.field}: ${i.message}`).join('; ')
}
