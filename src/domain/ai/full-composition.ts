import type { OwtScore, OwtScoreTrack } from '../owt/ast.ts'
import { parseOwtOrThrow } from '../owt/parser.ts'
import { repairCommonOwtErrors } from '../owt/repair.ts'
import { addRational, compareRational, rational, rationalToNumber } from '../owt/rational.ts'
import { serializeScore } from '../owt/serializer.ts'

/** An abort signal the domain layer can throw without depending on DOM globals. */
function abortedError(): Error {
  return Object.assign(new Error('Aborted'), { name: 'AbortError' })
}

export type CompositionDensity = 'sparse' | 'medium' | 'dense'

export interface CompositionSectionPlan {
  id: string
  name: string
  bars: number
  tempoStart: number
  tempoEnd?: number
  mood: string
  instrumentation: string[]
  density: CompositionDensity
  role: string
}

export interface CompositionPlan {
  title: string
  durationTargetSeconds: number
  meter: string
  key: string
  sections: CompositionSectionPlan[]
}

export interface ComposedSection {
  id: string
  owt: string
  attempts: number
}

export type FullCompositionStage =
  | { kind: 'planning' }
  | { kind: 'composing'; sectionId: string; completed: string[] }
  | { kind: 'repairing'; sectionId: string; attempt: number }
  | { kind: 'assembling'; completed: string[] }
  | { kind: 'validating' }
  | { kind: 'complete'; owt: string }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string; sectionId?: string }

export interface FullCompositionStreamUpdate {
  phase: 'plan' | 'section' | 'repair' | 'revise'
  sectionId?: string
  text: string
  kind?: 'content' | 'reasoning'
}

export interface FullCompositionAnalysis {
  durationSeconds: number
  targetDeviationSeconds: number
  bars: number
  sectionsPresent: string[]
  missingSections: string[]
  tracks: Array<{ name: string; channel: number; program: number; minPitch: number | null; maxPitch: number | null; notesPerBar: number }>
  repetitionRatio: number
  longestGlobalSilenceBeats: number
  channelProgramConflicts: number[]
  climaxDensityIncreased: boolean | null
  tempoMatchesPlan: boolean
}

export type FullCompositionTransport = (
  phase: 'plan' | 'section' | 'repair' | 'revise',
  prompt: string,
  signal?: AbortSignal,
  onUpdate?: (text: string) => void,
  onReasoningUpdate?: (text: string) => void,
) => Promise<string>

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function finite(value: unknown, label: string, min: number, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be in range ${min}–${max}`)
  return value
}

function parseTextPlan(value: string): Record<string, unknown> {
  const fields = new Map<string, string>()
  const sections: Record<string, unknown>[] = []
  for (const sourceLine of value.split(/\r?\n/)) {
    const line = sourceLine.trim()
    if (!line || /^PLAN\s+0\.1$/i.test(line)) continue
    const separator = line.indexOf(':')
    if (separator < 1) throw new Error(`invalid plan line: ${line}`)
    const key = line.slice(0, separator).trim().toLowerCase()
    const content = line.slice(separator + 1).trim()
    if (key !== 'section') {
      fields.set(key, content)
      continue
    }
    const [id, name, bars, tempo, mood, instruments, density, role, ...extra] = content.split('|').map((part) => part.trim())
    if (extra.length || !id || !name || !bars || !tempo || !mood || !instruments || !density || !role) throw new Error(`invalid section plan line: ${line}`)
    const [tempoStart, tempoEnd] = tempo.split(/\s*(?:->|→)\s*/)
    sections.push({
      id,
      name,
      bars: Number(bars),
      tempoStart: Number(tempoStart),
      tempoEnd: tempoEnd ? Number(tempoEnd) : undefined,
      mood,
      instrumentation: instruments.split(',').map((item) => item.trim()).filter(Boolean),
      density,
      role,
    })
  }
  return {
    title: fields.get('title'),
    durationTargetSeconds: Number(fields.get('duration')),
    meter: fields.get('meter'),
    key: fields.get('key'),
    sections,
  }
}

export function parseCompositionPlan(value: string | unknown): CompositionPlan {
  const root = record(typeof value === 'string' ? parseTextPlan(value) : value, 'composition plan')
  if (typeof root.title !== 'string' || !root.title.trim()) throw new Error('plan title is required')
  if (typeof root.meter !== 'string' || !/^\d+\/\d+$/.test(root.meter)) throw new Error('plan meter must be numerator/denominator')
  if (typeof root.key !== 'string' || !/^[A-G](?:#|b)? (?:major|minor)$/.test(root.key)) throw new Error('plan key is invalid')
  if (!Array.isArray(root.sections) || root.sections.length < 2) throw new Error('full composition requires at least two sections')
  const seen = new Set<string>()
  const sections = root.sections.map((raw, index): CompositionSectionPlan => {
    const item = record(raw, `sections[${index}]`)
    if (typeof item.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(item.id) || seen.has(item.id)) throw new Error(`sections[${index}].id must be unique and stable`)
    seen.add(item.id)
    if (typeof item.name !== 'string' || typeof item.mood !== 'string' || typeof item.role !== 'string') throw new Error(`sections[${index}] text fields are required`)
    if (!Array.isArray(item.instrumentation) || item.instrumentation.some((entry) => typeof entry !== 'string')) throw new Error(`sections[${index}].instrumentation must be strings`)
    if (item.density !== 'sparse' && item.density !== 'medium' && item.density !== 'dense') throw new Error(`sections[${index}].density is invalid`)
    return {
      id: item.id, name: item.name, bars: finite(item.bars, `sections[${index}].bars`, 1, 128),
      tempoStart: finite(item.tempoStart, `sections[${index}].tempoStart`, 20, 400),
      tempoEnd: item.tempoEnd === undefined ? undefined : finite(item.tempoEnd, `sections[${index}].tempoEnd`, 20, 400),
      mood: item.mood, instrumentation: item.instrumentation, density: item.density, role: item.role,
    }
  })
  return { title: root.title, durationTargetSeconds: finite(root.durationTargetSeconds, 'durationTargetSeconds', 30, 900), meter: root.meter, key: root.key, sections }
}

function meterParts(plan: CompositionPlan): [number, number] {
  const [numerator, denominator] = plan.meter.split('/').map(Number)
  return [numerator!, denominator!]
}

function sectionDurationBeats(plan: CompositionPlan, section: CompositionSectionPlan): number {
  const [numerator, denominator] = meterParts(plan)
  return section.bars * numerator * 4 / denominator
}

function sectionPrompt(plan: CompositionPlan, section: CompositionSectionPlan, previous?: ComposedSection, revision?: string): string {
  return `Compose only section ${section.id} (${section.name}) as a complete independently valid OWT 0.1 score.\nExact bars: ${section.bars}; meter: ${plan.meter}; key: ${plan.key}; tempo: ${section.tempoStart}${section.tempoEnd ? `→${section.tempoEnd}` : ''}; mood: ${section.mood}; role: ${section.role}; density: ${section.density}; instrumentation: ${section.instrumentation.join(', ')}.\nUse multiple aligned tracks when requested. program is 0-127; velocity is 1-127. No pickup and every track must span exactly ${section.bars} complete measures, using rests where silent. Return OWT only.${previous ? `\nPrevious section ending context:\n${previous.owt.slice(-1800)}` : ''}${revision ? `\nRevision request: ${revision}` : ''}`
}

function validateSection(plan: CompositionPlan, section: CompositionSectionPlan, owt: string): string {
  // Deterministically repair the common AI-output OWT errors (typography,
  // case, bar boundaries) before validating, so a slightly-off section does
  // not consume an AI retry and does not leave the assembled score broken.
  const score = parseOwtOrThrow(repairCommonOwtErrors(owt).text)
  const expected = sectionDurationBeats(plan, section)
  for (const track of score.tracks) {
    const end = track.events.reduce((maximum, event) => event.kind === 'note' || event.kind === 'rest' ? Math.max(maximum, rationalToNumber(event.at) + rationalToNumber(event.duration)) : maximum, 0)
    if (Math.abs(end - expected) > 1e-9) throw new Error(`section ${section.id} track ${track.name} spans ${end} beats; expected ${expected}`)
  }
  return serializeScore(score)
}

export function assembleFullComposition(plan: CompositionPlan, sections: readonly ComposedSection[]): string {
  const byId = new Map(sections.map((section) => [section.id, section]))
  const [numerator, denominator] = meterParts(plan)
  const tracks = new Map<string, OwtScoreTrack>()
  const tempos: OwtScore['tempos'] = []
  let beatOffset = rational(0)
  let measureOffset = 0
  for (const sectionPlan of plan.sections) {
    const section = byId.get(sectionPlan.id)
    if (!section) throw new Error(`missing section ${sectionPlan.id}`)
    const score = parseOwtOrThrow(section.owt)
    tempos.push({ position: { measure: measureOffset + 1, beat: rational(1) }, at: beatOffset, bpm: sectionPlan.tempoStart })
    if (sectionPlan.tempoEnd !== undefined && sectionPlan.bars > 1) {
      const at = addRational(beatOffset, rational(sectionDurationBeats(plan, sectionPlan) * (sectionPlan.bars - 1), sectionPlan.bars))
      tempos.push({ position: { measure: measureOffset + sectionPlan.bars, beat: rational(1) }, at, bpm: sectionPlan.tempoEnd })
    }
    for (const source of score.tracks) {
      const key = source.name
      const target = tracks.get(key) ?? { name: source.name, channel: source.channel, program: source.program, velocity: source.velocity, events: [] }
      if (target.channel !== source.channel || target.program !== source.program) throw new Error(`track ${source.name} changes channel or program between sections`)
      target.events.push(...source.events.map((event) => ({ ...event, at: addRational(event.at, beatOffset) })))
      tracks.set(key, target)
    }
    beatOffset = addRational(beatOffset, rational(sectionDurationBeats(plan, sectionPlan)))
    measureOffset += sectionPlan.bars
  }
  const [tonic, mode] = plan.key.split(' ') as [string, 'major' | 'minor']
  return serializeScore({ kind: 'score', version: '0.1', title: plan.title, ppq: 480,
    meters: [{ position: { measure: 1, beat: rational(1) }, at: rational(0), numerator, denominator }], tempos,
    keys: [{ position: { measure: 1, beat: rational(1) }, at: rational(0), tonic, mode }], tracks: [...tracks.values()] })
}

export function analyzeFullComposition(plan: CompositionPlan, owt: string): FullCompositionAnalysis {
  const score = parseOwtOrThrow(owt)
  const [numerator, denominator] = meterParts(plan)
  const beatsPerBar = numerator * 4 / denominator
  const bars = plan.sections.reduce((sum, section) => sum + section.bars, 0)
  const durationSeconds = plan.sections.reduce((sum, section) => sum + sectionDurationBeats(plan, section) * 60 / ((section.tempoStart + (section.tempoEnd ?? section.tempoStart)) / 2), 0)
  const signatures: string[] = []
  const intervals: Array<[number, number]> = []
  const trackAnalysis = score.tracks.map((track) => {
    const notes = track.events.filter((event) => event.kind === 'note')
    const pitches = notes.flatMap((event) => event.kind === 'note' ? event.pitches : [])
    for (const event of notes) if (event.kind === 'note') {
      signatures.push(`${event.pitches.join('.')}:${event.duration.numerator}/${event.duration.denominator}`)
      intervals.push([rationalToNumber(event.at), rationalToNumber(event.at) + rationalToNumber(event.duration)])
    }
    return { name: track.name, channel: track.channel, program: track.program, minPitch: pitches.length ? Math.min(...pitches) : null, maxPitch: pitches.length ? Math.max(...pitches) : null, notesPerBar: notes.length / bars }
  })
  const unique = new Set(signatures)
  const sorted = intervals.sort((a, b) => a[0] - b[0])
  let longestGlobalSilenceBeats = 0
  let soundingEnd = 0
  for (const [start, end] of sorted) { longestGlobalSilenceBeats = Math.max(longestGlobalSilenceBeats, start - soundingEnd); soundingEnd = Math.max(soundingEnd, end) }
  const programs = new Map<number, Set<number>>()
  for (const track of score.tracks) { const values = programs.get(track.channel) ?? new Set<number>(); values.add(track.program); programs.set(track.channel, values) }
  const densityRank = { sparse: 0, medium: 1, dense: 2 }
  const climax = plan.sections.findIndex((section) => /climax|高潮/i.test(`${section.name} ${section.role}`))
  return { durationSeconds, targetDeviationSeconds: durationSeconds - plan.durationTargetSeconds, bars,
    sectionsPresent: plan.sections.map((section) => section.id), missingSections: [], tracks: trackAnalysis,
    repetitionRatio: signatures.length ? 1 - unique.size / signatures.length : 0, longestGlobalSilenceBeats,
    channelProgramConflicts: [...programs].filter(([, values]) => values.size > 1).map(([channel]) => channel),
    climaxDensityIncreased: climax > 0 ? densityRank[plan.sections[climax]!.density] > densityRank[plan.sections[climax - 1]!.density] : null,
    tempoMatchesPlan: score.tempos.length >= plan.sections.length && compareRational(score.tempos[0]!.at, rational(0)) === 0 }
}

export class FullCompositionWorkflow {
  private controller?: AbortController
  private sections = new Map<string, ComposedSection>()
  private currentSectionId?: string
  private planValue?: CompositionPlan

  constructor(
    private readonly transport: FullCompositionTransport,
    private readonly onStage: (stage: FullCompositionStage) => void = () => {},
    private readonly onStream: (update: FullCompositionStreamUpdate) => void = () => {},
    private readonly repairRetries = 0,
  ) {}
  get plan(): CompositionPlan | undefined { return this.planValue }
  get composedSections(): readonly ComposedSection[] { return [...this.sections.values()] }

  cancel(): void { this.controller?.abort(); this.onStage({ kind: 'cancelled' }) }

  async createPlan(instruction: string): Promise<CompositionPlan> {
    this.controller = new AbortController(); this.onStage({ kind: 'planning' })
    const prompt = `Create a plain-text OpusWeave composition plan for: ${instruction}. Target a two-to-three-minute score. Do not return JSON or Markdown.
Use exactly this line format:
PLAN 0.1
title: Title
duration: seconds
meter: numerator/denominator
key: C major
section: stable-id | Name | bars | start-tempo or start-tempo->end-tempo | mood | instrument, instrument | sparse or medium or dense | role
Return at least two section lines and no prose.`
    this.planValue = parseCompositionPlan(await this.transport(
      'plan',
      prompt,
      this.controller.signal,
      (text) => this.onStream({ phase: 'plan', text }),
      (text) => this.onStream({ phase: 'plan', text, kind: 'reasoning' }),
    ))
    return this.planValue
  }

  async composeSection(id: string, revision?: string): Promise<ComposedSection> {
    if (!this.planValue) throw new Error('composition plan has not been created')
    const section = this.planValue.sections.find((item) => item.id === id)
    if (!section) throw new Error(`unknown section ${id}`)
    const completed = this.planValue.sections.filter((item) => this.sections.has(item.id)).map((item) => item.id)
    this.currentSectionId = id
    this.onStage({ kind: 'composing', sectionId: id, completed })
    const phase = revision ? 'revise' : 'section'
    let response = await this.transport(
      phase,
      sectionPrompt(this.planValue, section, this.sections.get(this.planValue.sections[this.planValue.sections.indexOf(section) - 1]?.id ?? ''), revision),
      this.controller?.signal,
      (text) => this.onStream({ phase, sectionId: id, text }),
      (text) => this.onStream({ phase, sectionId: id, text, kind: 'reasoning' }),
    )
    for (let attempt = 1; attempt <= this.repairRetries + 1; attempt++) {
      try {
        const result = { id, owt: validateSection(this.planValue, section, response), attempts: attempt }
        this.sections.set(id, result)
        this.currentSectionId = undefined
        return result
      } catch (error) {
        if (attempt > this.repairRetries) {
          this.onStage({ kind: 'error', sectionId: id, message: error instanceof Error ? error.message : String(error) })
          throw error
        }
        this.onStage({ kind: 'repairing', sectionId: id, attempt })
        response = await this.transport(
          'repair',
          `${sectionPrompt(this.planValue, section)}\nRepair validation error: ${error instanceof Error ? error.message : String(error)}\nReturn the corrected section OWT only.`,
          this.controller?.signal,
          (text) => this.onStream({ phase: 'repair', sectionId: id, text }),
          (text) => this.onStream({ phase: 'repair', sectionId: id, text, kind: 'reasoning' }),
        )
      }
    }
    throw new Error('unreachable')
  }

  finalize(): { plan: CompositionPlan; owt: string; analysis: FullCompositionAnalysis } {
    if (!this.planValue) throw new Error('composition plan has not been created')
    const completed = this.planValue.sections.filter((section) => this.sections.has(section.id)).map((section) => section.id)
    this.onStage({ kind: 'assembling', completed })
    const owt = assembleFullComposition(this.planValue, this.composedSections)
    this.onStage({ kind: 'validating' })
    const analysis = analyzeFullComposition(this.planValue, owt)
    this.onStage({ kind: 'complete', owt })
    return { plan: this.planValue, owt, analysis }
  }

  async run(instruction: string): Promise<{ plan: CompositionPlan; owt: string; analysis: FullCompositionAnalysis }> {
    try {
      const plan = await this.createPlan(instruction)
      for (const section of plan.sections) { if (this.controller?.signal.aborted) throw abortedError(); await this.composeSection(section.id) }
      return this.finalize()
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') this.onStage({ kind: 'cancelled' })
      else this.onStage({ kind: 'error', message: error instanceof Error ? error.message : String(error), sectionId: this.currentSectionId })
      throw error
    }
  }
}
