/**
 * mcp/tools — tool definitions for the OpusWeave MCP server.
 * Every tool calls OpusWeaveService; none re-implements MIDI logic.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { OpusWeaveService } from '../domain/services/opusweave-service.ts'
import { analyzeFullComposition, assembleFullComposition, parseCompositionPlan } from '../domain/ai/full-composition.ts'
import { parseOwtOrThrow } from '../domain/owt/parser.ts'

const TextContent = (text: string) => ({ content: [{ type: 'text' as const, text }] })

const CompositionSpecSchema = z
  .object({
    title: z.string().optional().describe('Sequence title'),
    ppq: z.number().int().min(1).max(32767).optional().describe('Ticks per quarter note (default 480)'),
    tempos: z
      .array(z.object({ beat: z.number().min(0), bpm: z.number().positive() }))
      .optional()
      .describe('Tempo map: BPM changes at beats'),
    timeSignatures: z
      .array(
        z.object({
          beat: z.number().min(0),
          numerator: z.number().int().min(1).max(64),
          denominator: z.number().int().min(1).describe('Power of two (2, 4, 8…)'),
        }),
      )
      .optional(),
    keySignatures: z
      .array(z.object({ beat: z.number().min(0), tonic: z.string(), mode: z.enum(['major', 'minor']) }))
      .optional(),
    tracks: z
      .array(
        z.object({
          name: z.string().describe('Track name'),
          channel: z.number().int().min(0).max(15).optional().describe('MIDI channel (default: track index)'),
          program: z.number().int().min(0).max(127).optional().describe('GM program number'),
          volume: z.number().int().min(0).max(127).optional().describe('Track volume (CC7)'),
          pan: z.number().int().min(0).max(127).optional().describe('Track pan, 64 = center (CC10)'),
          notes: z
            .array(
              z.object({
                startBeat: z.number().min(0).describe('Start in quarter-note beats'),
                durationBeats: z.number().positive().describe('Duration in quarter-note beats'),
                pitch: z.number().int().min(0).max(127).describe('MIDI note 0–127'),
                velocity: z.number().int().min(1).max(127),
              }),
            )
            .default([]),
          controlChanges: z
            .array(
              z.object({
                beat: z.number().min(0),
                controller: z.number().int().min(0).max(127),
                value: z.number().int().min(0).max(127),
              }),
            )
            .default([]),
          pitchBends: z
            .array(z.object({ beat: z.number().min(0), value: z.number().int().min(0).max(16383).describe('0–16383, 8192 = center') }))
            .default([]),
          programChanges: z
            .array(z.object({ beat: z.number().min(0), program: z.number().int().min(0).max(127) }))
            .default([]),
        }),
      )
      .min(1)
      .describe('Tracks to write'),
  })
  .describe('OpusWeave CompositionSpec — the structured AI/API input model, not a music file format')

export function registerTools(server: McpServer, service: OpusWeaveService): void {
  server.tool(
    'create_midi',
    'Create a Standard MIDI File (Type 1) from a CompositionSpec and write it to disk. Returns the file path, track/note counts, duration and validation warnings.',
    { spec: CompositionSpecSchema.describe('The composition to write'), output: z.string().describe('Output .mid file path') },
    async (args) => {
      const result = await service.createMidi(args.spec, args.output)
      return TextContent(JSON.stringify(result))
    },
  )

  server.tool(
    'inspect_midi',
    'Parse a MIDI file and return structured information: format, PPQ, duration, per-track names/channels/programs/note counts/ranges, tempo and time-signature maps, and warnings (e.g. hanging notes).',
    { file: z.string().describe('Path to the .mid file') },
    async (args) => {
      const inspection = await service.inspectMidiFile(args.file)
      return TextContent(JSON.stringify(inspection))
    },
  )

  server.tool(
    'render_midi',
    'Render a MIDI file + SoundFont to a WAV file using the system FluidSynth binary. Reports output size, FluidSynth version and estimated duration.',
    {
      midi: z.string().describe('Input .mid file path'),
      soundfont: z.string().describe('Input .sf2/.sf3 SoundFont path'),
      output: z.string().describe('Output .wav file path'),
      sampleRate: z.number().int().optional().describe('Sample rate in Hz (default 44100)'),
      gain: z.number().optional().describe('FluidSynth gain (default 0.5)'),
    },
    async (args) => {
      const result = await service.renderMidi(args)
      return TextContent(JSON.stringify(result))
    },
  )

  server.tool(
    'validate_composition',
    'Validate a CompositionSpec without writing any file. Returns per-field errors, warnings, and statistics (track/note counts, duration in beats, pitch range, track densities). Accepts unvalidated input: the tool is the validator.',
    { spec: z.unknown().describe('CompositionSpec-shaped input to validate; out-of-range values are reported, not rejected') },
    async (args) => {
      const result = service.validateComposition(args.spec)
      return TextContent(JSON.stringify(result))
    },
  )

  server.tool(
    'create_example_composition',
    'Generate a short multi-track example CompositionSpec (melody + bass, tempo change, control changes, pitch bend) for exercising the full create → inspect → render pipeline.',
    {},
    async () => {
      const spec = service.createExampleComposition()
      return TextContent(JSON.stringify(spec))
    },
  )

  server.tool(
    'validate_owt',
    'Parse and validate an OWT file. Returns source-located syntax diagnostics and composition validation.',
    { text: z.string().describe('OWT 0.1 score text') },
    async ({ text }) => TextContent(JSON.stringify(service.validateOwt(text))),
  )

  server.tool(
    'format_owt',
    'Parse, validate, and canonicalize OWT. The canonical formatter intentionally removes comments because OWT 0.1 has an AST rather than a comment-preserving CST.',
    { text: z.string().describe('OWT 0.1 score text') },
    async ({ text }) => TextContent(service.formatOwt(text)),
  )

  server.tool(
    'play_owt',
    'Compile OWT into a playable MIDI payload for the OpusWeave internal SoundFont player.',
    { text: z.string().describe('OWT 0.1 score text') },
    async ({ text }) => TextContent(JSON.stringify(service.prepareOwtPlayback(text))),
  )

  server.tool(
    'export_owt_to_midi',
    'Compile OWT to a Standard MIDI File and write it to disk.',
    { text: z.string().describe('OWT 0.1 score text'), output: z.string().describe('Output .mid path') },
    async ({ text, output }) => TextContent(JSON.stringify(await service.compileOwtScore(text, output))),
  )

  server.tool(
    'import_midi_to_owt',
    'Extract a simple editable melody from MIDI. This conversion intentionally discards accompaniment, performance controls, and timing detail.',
    {
      file: z.string().describe('Input .mid file path'),
      grid: z.enum(['1/8', '1/16', '1/32']).default('1/16'),
      track: z.number().int().positive().optional().describe('Optional one-based MIDI track number'),
      channel: z.number().int().min(1).max(16).optional().describe('Optional MIDI channel'),
      voice: z.enum(['continuous', 'highest', 'lowest']).default('continuous'),
      preserveVelocity: z.boolean().default(false),
    },
    async (args) => {
      const denominator = Number(args.grid.slice(2))
      const result = await service.importMidiAsOwt(args.file, {
        grid: { numerator: 4, denominator },
        trackIndex: args.track === undefined ? undefined : args.track - 1,
        channel: args.channel,
        voiceStrategy: args.voice,
        preserveVelocity: args.preserveVelocity,
      })
      return TextContent(JSON.stringify(result))
    },
  )

  server.tool(
    'create_composition_plan',
    'Validate and normalize a section-based full-composition plan created by an agent. This does not generate notes.',
    { plan: z.unknown().describe('CompositionPlan with title, duration target, meter, key, and ordered sections') },
    async ({ plan }) => TextContent(JSON.stringify(parseCompositionPlan(plan))),
  )

  server.tool(
    'compose_section',
    'Validate one independently composed section score before assembly. Agents should generate one section at a time, not individual notes.',
    { sectionId: z.string(), owt: z.string().describe('Complete independently valid OWT section score') },
    async ({ sectionId, owt }) => {
      parseOwtOrThrow(owt)
      return TextContent(JSON.stringify({ id: sectionId, owt: service.formatOwt(owt), valid: true }))
    },
  )

  server.tool(
    'assemble_composition',
    'Assemble validated section OWT scores according to a CompositionPlan. The program owns measure offsets, tempo map, and track alignment.',
    { plan: z.unknown(), sections: z.array(z.object({ id: z.string(), owt: z.string(), attempts: z.number().int().positive().default(1) })) },
    async ({ plan, sections }) => TextContent(assembleFullComposition(parseCompositionPlan(plan), sections)),
  )

  server.tool(
    'validate_full_composition',
    'Analyze structural full-score metrics: duration, bars, ranges, density, repetition, silence, channel conflicts, sections and tempo conformance. It does not judge musical quality.',
    { plan: z.unknown(), owt: z.string() },
    async ({ plan, owt }) => TextContent(JSON.stringify(analyzeFullComposition(parseCompositionPlan(plan), owt))),
  )

  server.tool(
    'revise_section',
    'Validate a revised section and return the section list with only that target replaced.',
    { sectionId: z.string(), revisedOwt: z.string(), sections: z.array(z.object({ id: z.string(), owt: z.string(), attempts: z.number().int().positive().default(1) })) },
    async ({ sectionId, revisedOwt, sections }) => {
      parseOwtOrThrow(revisedOwt)
      if (!sections.some((section) => section.id === sectionId)) throw new Error(`unknown section ${sectionId}`)
      return TextContent(JSON.stringify(sections.map((section) => section.id === sectionId ? { ...section, owt: service.formatOwt(revisedOwt) } : section)))
    },
  )
}
