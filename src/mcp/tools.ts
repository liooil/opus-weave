/**
 * mcp/tools — tool definitions for the OpusWeave MCP server.
 * Every tool calls OpusWeaveService; none re-implements MIDI logic.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { OpusWeaveService } from '../domain/services/opusweave-service.ts'

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
}
