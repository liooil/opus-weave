/**
 * TempoMap — centralized beat↔tick conversion and tempo/time-signature
 * bookkeeping for the whole domain layer.
 *
 * Rounding of floating-point beats to integer ticks happens ONLY here, so
 * every exporter, recorder and analysis path agrees on the same conversion.
 */
import type { TempoEvent, TimeSignatureEvent } from './composition-spec.ts'

export interface TempoChange {
  /** Absolute tick position. */
  tick: number
  /** Tempo in BPM. */
  bpm: number
}

export interface TimeSignatureEntry {
  tick: number
  numerator: number
  denominator: number
}

export class TempoMap {
  readonly ppq: number
  /** Sorted by tick ascending. Always contains a change at tick 0. */
  readonly tempos: TempoChange[]
  /** Sorted by tick ascending. */
  readonly timeSignatures: TimeSignatureEntry[]

  constructor(opts: {
    ppq: number
    tempos?: TempoEvent[]
    timeSignatures?: TimeSignatureEvent[]
    /** BPM used for the implicit tempo at tick 0 when none is given. */
    defaultTempo?: number
  }) {
    this.ppq = opts.ppq
    const defaultTempo = opts.defaultTempo ?? 120

    const raw = (opts.tempos ?? []).slice().sort((a, b) => a.beat - b.beat)
    this.tempos =
      raw.length > 0 && raw[0]!.beat === 0
        ? raw.map((t) => ({ tick: this.beatToTick(t.beat), bpm: t.bpm }))
        : [{ tick: 0, bpm: defaultTempo }, ...raw.map((t) => ({ tick: this.beatToTick(t.beat), bpm: t.bpm }))]

    this.timeSignatures = (opts.timeSignatures ?? [])
      .slice()
      .sort((a, b) => a.beat - b.beat)
      .map((t) => ({ tick: this.beatToTick(t.beat), numerator: t.numerator, denominator: t.denominator }))
  }

  /** The single rounding point for beat→tick conversion. */
  beatToTick(beat: number): number {
    return Math.round(beat * this.ppq)
  }

  /** Tempo (BPM) in effect at the given absolute tick. */
  tempoAtTick(tick: number): number {
    let bpm = this.tempos[0]!.bpm
    for (const t of this.tempos) {
      if (t.tick <= tick) bpm = t.bpm
      else break
    }
    return bpm
  }

  /**
   * Convert an absolute tick position to seconds, integrating over tempo
   * changes. Microseconds per quarter note = 60_000_000 / bpm.
   * A tempo change at tick T applies from T onward, so each segment uses the
   * BPM in effect at the segment start.
   */
  tickToSeconds(tick: number): number {
    let seconds = 0
    let prevTick = 0
    let prevBpm = this.tempos[0]!.bpm
    for (const t of this.tempos) {
      if (t.tick >= tick) break
      seconds += ((t.tick - prevTick) / this.ppq) * (60 / prevBpm)
      prevTick = t.tick
      prevBpm = t.bpm
    }
    if (tick > prevTick) {
      seconds += ((tick - prevTick) / this.ppq) * (60 / prevBpm)
    }
    return seconds
  }

  /** Total duration in seconds for the given end tick. */
  durationSeconds(endTick: number): number {
    return this.tickToSeconds(endTick)
  }
}
