# opus-weave

> From idea to score to performance.  
> 从构思，到乐谱，到演奏。

**OpusWeave** is an open-source executable score workstation for humans and AI. It turns musical ideas, sheet images, and live MIDI performances into structured scores for composing, playback, practice, score following, ensemble performance, and recording.

Application ID: `io.github.liooil.opusweave` · License: Apache-2.0

---

## First-phase vertical chain

```
AI / JSON / CLI / MCP  →  create MIDI
       ↓
Standard MIDI File  (import / export)
       ↓
GUI playback  (spessasynth_lib + Web Audio API)
       ↓
WebMIDI  (live keyboard input)
       ↓
SoundFont synthesis  (.sf2 / .sf3 / .sfogg)
       ↓
Record performance  →  export .mid
```

### What you can do today

| # | Capability |
|---|---|
| 1 | Import a `.mid` file and play it back in the browser |
| 2 | Load a `.sf2` / `.sf3` SoundFont for in-browser synthesis |
| 3 | Connect a physical MIDI keyboard via WebMIDI |
| 4 | Monitor Note On/Off, CC, and Pitch Bend messages in real time |
| 5 | Record a live MIDI performance and export a Standard MIDI File |
| 6 | Create a multi-track MIDI file via CLI (`create-midi` action) |
| 7 | Render MIDI + SoundFont to WAV via the `render-audio` action (needs system FluidSynth) |
| 8 | Use any of the above from an AI agent via the MCP server |

---

## Tech stack

- [Bun](https://bun.sh) runtime
- TypeScript (strict mode)
- [BunDesk (bundesk)](https://github.com/liooil/bundesk) — desktop window framework
- [spessasynth_lib](https://github.com/spessasus/spessasynth_lib) — SF2/SF3/MIDI synthesis
- [spessasynth_core](https://github.com/spessasus/spessasynth_core) — MIDI file I/O
- [Web MIDI API](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API) — physical keyboard input
- [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk) — AI agent interface
- Native HTML / CSS / TypeScript (no UI framework)

---

## Getting started

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.3.14
- A Chromium-family browser installed (Chrome, Chromium, Edge, Brave) — required for WebMIDI on Linux
- _(optional)_ `fluidsynth` in `$PATH` for WAV rendering

### Install

```bash
bun install
```

### Development

```bash
# Open the desktop window (uses system Chromium on Linux for WebMIDI support)
bun run dev

# Server only — no browser window (useful for headless / CI)
bun run dev -- serve --no-browser

# Run the MCP server on stdio
bun run dev:mcp

# Type-check without compiling
bun run typecheck

# Run unit tests
bun run test
```

### Build a native binary

```bash
bun run build
```

---

## CLI usage

```bash
# Create a MIDI file from JSON
bun src/main.ts create-midi \
  --output song.mid \
  --data '{"tempo":120,"name":"My Song","tracks":[{"name":"Piano","program":0,"notes":[{"note":60,"velocity":100,"startBeat":0,"durationBeats":1}]}]}'

# Create from a JSON file
bun src/main.ts create-midi-from-file --input score.json --output song.mid

# Render to WAV (requires fluidsynth)
bun src/main.ts render-audio \
  --midi song.mid \
  --soundfont /path/to/GeneralUser.sf2 \
  --output song.wav
```

---

## MCP server

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "opus-weave": {
      "command": "bun",
      "args": ["<absolute-path>/src/mcp.ts"]
    }
  }
}
```

### Available MCP tools

| Tool | Description |
|------|-------------|
| `create_midi` | Build a Type-1 MIDI file from structured note data |
| `create_midi_from_json_file` | Load a JSON score file and write it as `.mid` |
| `render_audio` | Render MIDI + SoundFont → WAV via FluidSynth |

---

## JSON score format (CreateMidiOptions)

```json
{
  "tempo": 120,
  "timeDivision": 480,
  "name": "My Piece",
  "tracks": [
    {
      "name": "Piano",
      "program": 0,
      "channel": 0,
      "notes": [
        { "note": 60, "velocity": 100, "startBeat": 0, "durationBeats": 1 },
        { "note": 64, "velocity":  90, "startBeat": 1, "durationBeats": 1 },
        { "note": 67, "velocity":  80, "startBeat": 2, "durationBeats": 2 }
      ]
    }
  ]
}
```

- `note` — MIDI note number (0–127; middle C = 60)
- `velocity` — 1–127
- `startBeat` / `durationBeats` — in quarter-note beats
- `program` — GM instrument number (0–127)

---

## Architecture

All core logic lives in `src/core/` and is shared by the GUI, CLI, and MCP layers — no three separate implementations.

```
src/
  core/
    midi.ts          # MIDI building and parsing (wraps spessasynth_core)
    fluidsynth.ts    # WAV rendering via system fluidsynth binary
  page/
    index.html       # Single-page app
    app.css          # UI styles
    app.ts           # Browser-side: player, WebMIDI, recording
  main.ts            # BunDesk entry: HTTP server + desktop window + CLI actions
  mcp.ts             # MCP stdio server
  build.ts           # Release build script
  shims.d.ts         # TypeScript module stubs for native bundesk internals
  tests/
    midi.test.ts     # Unit tests for core MIDI logic
```

