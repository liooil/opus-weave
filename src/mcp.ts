/**
 * OpusWeave MCP Server — stdio transport.
 * Exposes MIDI creation and rendering tools to AI agents via the
 * Model Context Protocol.
 *
 * Usage:
 *   bun src/mcp.ts
 *
 * Or add to MCP client config:
 *   { "command": "bun", "args": ["<path>/src/mcp.ts"] }
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { buildMidi } from './core/midi.ts'
import { renderAudio, writeTmpMidi, deleteTmpFile } from './core/fluidsynth.ts'
import { resolve } from 'node:path'

// ─── Schema ───────────────────────────────────────────────────────────────────

const NoteSchema = z.object({
  note: z.number().int().min(0).max(127).describe('MIDI note number (0–127, middle C = 60)'),
  velocity: z.number().int().min(1).max(127).describe('Note velocity (1–127)'),
  startBeat: z.number().min(0).describe('Start time in quarter-note beats'),
  durationBeats: z.number().min(0).describe('Duration in quarter-note beats'),
  channel: z.number().int().min(0).max(15).optional().describe('MIDI channel 0–15 (default: track index)'),
})

const TrackSchema = z.object({
  name: z.string().describe('Track name'),
  program: z.number().int().min(0).max(127).optional().describe('GM program number 0–127'),
  channel: z.number().int().min(0).max(15).optional().describe('MIDI channel for all notes in this track'),
  notes: z.array(NoteSchema).describe('Notes in this track'),
})

const CreateMidiSchema = z.object({
  output: z.string().describe('Absolute output .mid file path'),
  tempo: z.number().min(1).max(600).optional().describe('BPM tempo (default 120)'),
  timeDivision: z.number().int().min(1).optional().describe('Ticks per quarter note (default 480)'),
  name: z.string().optional().describe('MIDI sequence name'),
  tracks: z.array(TrackSchema).min(1).describe('Array of tracks'),
})

const RenderAudioSchema = z.object({
  midi: z.string().describe('Absolute path to input .mid file'),
  soundfont: z.string().describe('Absolute path to .sf2 / .sf3 SoundFont'),
  output: z.string().describe('Absolute output .wav file path'),
  sampleRate: z.number().int().optional().describe('Sample rate in Hz (default 44100)'),
  gain: z.number().optional().describe('FluidSynth gain (default 0.5)'),
})

// ─── Server ───────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'opus-weave',
  version: '0.1.0',
})

server.tool(
  'create_midi',
  'Create a Standard MIDI File (Type 1) from structured note data and write it to disk.',
  CreateMidiSchema.shape,
  async (args) => {
    const { output, tracks, tempo, timeDivision, name } = args
    const buf = buildMidi({ tracks, tempo, timeDivision, name })
    await Bun.write(resolve(output), buf)
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ ok: true, path: resolve(output), bytes: buf.byteLength }),
        },
      ],
    }
  },
)

server.tool(
  'render_audio',
  'Render a MIDI file + SoundFont to WAV using the system FluidSynth binary.',
  RenderAudioSchema.shape,
  async (args) => {
    const { midi, soundfont, output, sampleRate, gain } = args
    await renderAudio({
      midiPath: resolve(midi),
      soundfontPath: resolve(soundfont),
      outputPath: resolve(output),
      sampleRate,
      gain,
    })
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ ok: true, output: resolve(output) }),
        },
      ],
    }
  },
)

server.tool(
  'create_midi_from_json_file',
  'Load a JSON file describing a MIDI sequence and write it as a .mid file.',
  {
    input: z.string().describe('Absolute path to JSON file with CreateMidiOptions shape'),
    output: z.string().describe('Absolute output .mid file path'),
  },
  async (args) => {
    const raw = await Bun.file(resolve(args.input)).text()
    const options = JSON.parse(raw) as Parameters<typeof buildMidi>[0]
    const buf = buildMidi(options)
    await Bun.write(resolve(args.output), buf)
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ ok: true, path: resolve(args.output), bytes: buf.byteLength }),
        },
      ],
    }
  },
)

// ─── Connect and run ─────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
// Server runs until stdin closes
