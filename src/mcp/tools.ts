/**
 * mcp/tools — tool definitions for the OpusWeave MCP server.
 * Every tool calls OpusWeaveService; none re-implements MIDI logic.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { OpusWeaveService } from '../domain/services/opusweave-service.ts'
import { parseRational, rational } from '../domain/owt/rational.ts'

const TextContent = (text: string) => ({ content: [{ type: 'text' as const, text }] })

const CompositionSpecSchema = z
  .object({
    title: z.string().optional().describe('Sequence title'),
    ppq: z.number().int().positive().optional().describe('Ticks per quarter note (default 480)'),
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
    'validate_score_text',
    'Parse and validate OWT 0.1 Score text. Returns source-located syntax diagnostics plus CompositionSpec validation.',
    { text: z.string().describe('OWT 0.1 score text') },
    async ({ text }) => TextContent(JSON.stringify(service.validateOwt(text))),
  )

  server.tool(
    'play_score_text',
    'Compile OWT Score text into a playable Standard MIDI payload for the OpusWeave internal SoundFont player.',
    { text: z.string().describe('OWT 0.1 score text') },
    async ({ text }) => TextContent(JSON.stringify(service.prepareOwtPlayback(text))),
  )

  server.tool(
    'compile_score_text_to_midi',
    'Compile OWT Score text to a Standard MIDI File and write it to disk.',
    { text: z.string().describe('OWT 0.1 score text'), output: z.string().describe('Output .mid path') },
    async ({ text, output }) => TextContent(JSON.stringify(await service.compileOwtScore(text, output))),
  )

  server.tool(
    'get_take_text',
    'Register or retrieve an Exact OWT Take. A MIDI file or Take text may initialize the take ID; optional measure bounds return a ranged view.',
    {
      takeId: z.string().optional(),
      midiFile: z.string().optional(),
      takeText: z.string().optional(),
      fromMeasure: z.number().int().positive().optional(),
      toMeasure: z.number().int().positive().optional(),
      bpm: z.number().positive().default(120),
      meterNumerator: z.number().int().positive().default(4),
      meterDenominator: z.number().int().positive().default(4),
    },
    async (args) => {
      let takeId = args.takeId
      if (args.midiFile) takeId = (await service.importMidiAsTake(args.midiFile, takeId)).takeId
      else if (args.takeText) takeId = service.registerTakeText(args.takeText, takeId).takeId
      if (!takeId) throw new Error('takeId, midiFile, or takeText is required')
      const range = args.fromMeasure !== undefined || args.toMeasure !== undefined
        ? {
            fromMeasure: args.fromMeasure ?? 1,
            toMeasure: args.toMeasure ?? args.fromMeasure ?? 1,
            bpm: args.bpm,
            meter: { numerator: args.meterNumerator, denominator: args.meterDenominator },
          }
        : undefined
      return TextContent(JSON.stringify({ takeId, text: service.getTakeText(takeId, range) }))
    },
  )

  server.tool(
    'quantize_take',
    'Quantize Exact OWT Take text into OWT Score text while preserving velocities, CC, and pitch bend events.',
    {
      takeText: z.string(),
      grid: z.string().default('1/16').describe('Conventional whole-note fraction, for example 1/16'),
      bpm: z.number().positive().default(120),
      meterNumerator: z.number().int().positive().default(4),
      meterDenominator: z.number().int().positive().default(4),
      program: z.number().int().min(0).max(127).default(0),
    },
    async (args) => {
      const parsed = parseRational(args.grid)
      if (!parsed) throw new Error(`invalid quantization grid: ${args.grid}`)
      const result = service.quantizeTakeText(args.takeText, {
        grid: rational(parsed.numerator * 4, parsed.denominator),
        bpm: args.bpm,
        meter: { numerator: args.meterNumerator, denominator: args.meterDenominator },
        program: args.program,
      })
      return TextContent(JSON.stringify(result))
    },
  )

  server.tool(
    'compare_take_with_score',
    'Compare Exact OWT Take text with OWT Score text and report pitch matches, missing/extra notes, and timing error.',
    { takeText: z.string(), scoreText: z.string() },
    async ({ takeText, scoreText }) => TextContent(JSON.stringify(service.compareTakeTextWithScore(takeText, scoreText))),
  )
}
