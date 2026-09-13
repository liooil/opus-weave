/** Bounded rolling measurements; generated-token throughput alone cannot set latency. */
export class ImprovTiming {
  lead = 0.8
  cadence = 1
  private arrivals: number[] = []
  private completions: number[] = []

  get samples(): number { return this.arrivals.length }

  reset(): void {
    this.lead = 0.8
    this.cadence = 1
    this.arrivals = []
    this.completions = []
  }

  observe(firstEvent: number | undefined, completion: number, missedDeadline: boolean, failed: boolean): void {
    if (firstEvent !== undefined && Number.isFinite(firstEvent)) this.remember(this.arrivals, Math.max(0, firstEvent))
    if (!failed && Number.isFinite(completion)) this.remember(this.completions, Math.max(0, completion))
    // Keep the recent tail latency, not just the most recent fast response.
    const target = Math.max(0.3, Math.min(3, this.p90(this.arrivals, 0.55) + 0.25))
    this.lead = missedDeadline || failed
      ? Math.min(3, Math.max(target, this.lead + 0.25))
      : target >= this.lead ? target : Math.max(target, this.lead - 0.1)
    this.cadence = Math.max(0.35, Math.min(2.5, this.p90(this.completions, 0.9) + 0.075))
  }

  windowBeats(bpm: number): number {
    if (this.samples < 3) return 8
    // Four beats for fast connections, eight when latency needs more coverage.
    return Math.min(8, Math.max(4, Math.ceil((this.lead + this.cadence + 0.5) * bpm / 60 / 4) * 4))
  }

  private remember(samples: number[], value: number): void {
    samples.push(value)
    if (samples.length > 8) samples.shift()
  }

  private p90(samples: number[], fallback: number): number {
    if (!samples.length) return fallback
    return [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.9) - 1]!
  }
}
