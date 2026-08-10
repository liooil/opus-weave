# OpusWeave

> From idea to score to performance.

OpusWeave is an open-source executable score workstation for humans
and AI. It turns musical ideas, sheet images, and live MIDI performances
into structured scores for composing, playback, practice, score following,
ensemble performance, and recording.

OpusWeave treats a score as more than a static document: it is readable
by people, executable by instruments, and editable by agents.

Application ID: `io.github.liooil.opusweave` · License: Apache-2.0

Web app: [liooil.github.io/opus-weave](https://liooil.github.io/opus-weave/). Every push to `main` publishes the pure browser build through GitHub Pages.
Install it from the browser to keep the complete workstation—including the synth engine and bundled SoundFonts—available without a network connection after the first load.

---

## What phase 1 delivers

A complete vertical chain:

```
AI / JSON / CLI / MCP  →  create MIDI
       ↓
Standard MIDI File  (import / export, SMF Type 1)
       ↓
GUI playback  (spessasynth_lib + Web Audio API)
       ↓
WebMIDI  (live keyboard input, hot-plug, auto-reconnect)
       ↓
SoundFont synthesis  (.sf2 / .sf3 / .sfogg)
       ↓
Record performance  →  export .mid (re-importable)
```

| # | Capability |
|---|---|
| 1 | Import a `.mid` file into a multi-track beat timeline, select ranges, replace them through live playing, and export the edited MIDI |
| 2 | Play immediately with the FreePiano-style mda Piano default and lightweight Micro GM fallback, or load a custom `.sf2` / `.sf3` / `.sfogg` bank |
| 3 | Connect a physical MIDI keyboard via WebMIDI (permission button, port picker, hot-plug, id-change fallback) |
| 4 | Monitor Note On/Off, CC, and Pitch Bend in real time (with note names) |
| 5 | Record a live performance (hardware keyboard or computer keyboard) and export a Standard MIDI File that re-imports |
| 6 | Create a multi-track MIDI file via CLI or MCP from a structured `CompositionSpec` |
| 7 | Render MIDI + SoundFont to WAV via the optional system FluidSynth (`render-midi`) |
| 8 | Drive everything from an AI agent via the MCP server (5 tools) |
| 9 | Play with the computer keyboard (Z–M / S–L / Q–U, octave shift, fixed velocity) and learn MIDI controls (`MIDI Learn`) |
| 10 | Built-in editable device profile for the MIDIPLUS TINY+ 32-key keyboard |

## Quick start

Prerequisites: [Bun](https://bun.sh) ≥ 1.3.14, a Chromium-family browser
(Chrome, Edge, Brave…) for WebMIDI, and optionally `fluidsynth` for offline
WAV rendering.

```bash
bun install
bun run dev            # desktop window (Chromium app mode on Linux/Windows)
```

Headless server (open the printed URL in Firefox or Chromium):

```bash
bun run dev --no-browser
```

The server binds `127.0.0.1` only — it is never exposed to the LAN by default.

### CLI

```bash
bun run opusweave create-midi --spec examples/minimal-composition.json --output tmp/example.mid
bun run opusweave inspect-midi --file tmp/example.mid
bun run opusweave render-midi --midi tmp/example.mid --soundfont /path/to/bank.sf2 --output tmp/example.wav
bun run opusweave doctor [--soundfont /path/to/bank.sf2]
bun run opusweave mcp   # stdio MCP server
```

### MCP

Add to your MCP client config:

```json
{ "command": "bun", "args": ["<repo>/src/main.ts", "mcp"] }
```

Tools: `create_midi`, `inspect_midi`, `render_midi`, `validate_composition`,
`create_example_composition`. See [docs/mcp.md](docs/mcp.md).

## SoundFonts

OpusWeave starts with **mda Piano**, the same default sampled piano instrument
used by FreePiano 1.8. The original MIT-licensed PCM samples and key groups are
packaged as a browser-compatible SoundFont; **OpusWeave Micro GM** remains as a
fallback for the other 127 melodic programs and drums. The timbre closely
matches FreePiano's default, though rendering is not bit-identical because
OpusWeave uses the SoundFont synthesis model rather than the original VST DSP.
You can replace the default at any time with your own `.sf2`, `.sf3`, or
`.sfogg` bank; only use files you are legally allowed to use.

## Format model

- **MIDI** is the performance/playback format (Standard MIDI File, Type 1 by
  default).
- **MusicXML / MXL** is the planned future notation format (see
  [docs/roadmap.md](docs/roadmap.md)).
- **CompositionSpec** is OpusWeave's AI/API input model — a structured way
  for agents to describe music. It is **not** a new music file standard; the
  persistent output is standard MIDI.
- **Images / PDF (OMR)** are planned future entry points.

See [docs/midi-model.md](docs/midi-model.md) for the full `CompositionSpec`
schema and validation rules.

## Project layout

```
src/
├── main.ts                    # BunDesk desktop app, CLI actions, --smoke, MCP routing
├── build.ts                   # single-file binary build (bundesk)
├── domain/                    # framework-free core: spec, validation, tempo map,
│   │                          #   MIDI export/import/recorder, device profiles,
│   │                          #   mapping engine, MIDI learn, OpusWeaveService
├── audio/                     # SynthEngine interface, spessasynth engine, mock,
│   │                          #   FluidSynth renderer
├── midi/                      # WebMIDI manager, port selection
├── mcp/                       # MCP server + tool definitions
├── cli/                       # CLI argument helpers
├── web/                       # GUI: HTML/CSS/TS, no framework
└── tests/                     # 98 unit tests (bun test)
```

The GUI, CLI and MCP all call the same `OpusWeaveService` — domain logic is
implemented once, never per-layer.

## Platform notes

- Desktop windows use the **Chromium-family browser provider** on Linux and
  Windows because the product depends on WebMIDI; WebKitGTK and unpatched
  WebView2 do not expose Web MIDI.
- `FluidSynth` is an optional external tool used only for offline WAV
  rendering. The GUI plays through the in-browser synth. FluidSynth is never
  auto-installed; `doctor` prints install instructions when it is missing.

## Docs

- [docs/architecture.md](docs/architecture.md) — module boundaries and key decisions
- [docs/midi-model.md](docs/midi-model.md) — CompositionSpec schema, validation, SMF mapping
- [docs/mcp.md](docs/mcp.md) — MCP server usage and tools
- [docs/roadmap.md](docs/roadmap.md) — future milestones (MusicXML, ensemble, OMR, Jianpu, FreePiano)

## License

Apache-2.0. Third-party notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

OpusWeave is an independent project. It is not affiliated with or endorsed by
FreePiano, MIDIPLUS, the MIDI Association, or any SoundFont trademark holder.
