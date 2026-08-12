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

OpusWeave is an editor and player for `.owt` text files:

```
MIDI / AI prompt / score image / MP4 frames
       ↓  melody extraction or multimodal generation
OWT text  (primary editable source)
       ↓
MIDI playback/export  →  SoundFont synthesis
```

| # | Capability |
|---|---|
| 1 | Navigate and edit `.owt` with Helix modal score units—CHAR is an event, WORD a measure and LINE a track—or use raw text and live performance replacement |
| 2 | Import MIDI through intentional lossy melody extraction with track selection, voice reduction and rhythm quantization |
| 3 | Export OWT to Standard MIDI for playback and interchange |
| 4 | Play immediately with the FreePiano-style mda Piano default and lightweight Micro GM fallback, or load a custom `.sf2` / `.sf3` / `.sfogg` bank |
| 5 | Connect a physical MIDI keyboard via WebMIDI for live performance, guided practice and AI improvisation |
| 6 | Inspect and edit imported MIDI on a multi-track beat timeline before extracting or exporting |
| 7 | Monitor Note On/Off, CC and Pitch Bend in real time |
| 8 | Render MIDI + SoundFont to WAV via the optional system FluidSynth (`render-midi`) |
| 9 | Drive OWT validation, playback, import and export through MCP |
| 10 | Switch the live computer keyboard between OpusWeave chromatic, English-word, Pinyin-tone and FreePiano classic performance layouts |
| 11 | Load public-domain piano examples including Ode to Joy, Für Elise, Canon in D, Minuet in G and Moonlight Sonata |
| 12 | Open or drop OWT directly, convert MIDI deterministically, or send score images/MP4 to OpenAI, Anthropic, OpenRouter, Ollama, llama.cpp or a compatible multimodal endpoint through one unified import path |

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
bun run opusweave owt validate examples/twinkle.owt
bun run opusweave owt play examples/twinkle.owt
bun run opusweave owt to-midi examples/twinkle.owt -o tmp/twinkle.mid
bun run opusweave owt from-midi tmp/twinkle.mid --grid 1/16 --voice continuous -o tmp/melody.owt
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

OWT-first tools are `validate_owt`, `play_owt`, `export_owt_to_midi`, and
`import_midi_to_owt`. Lower-level MIDI and CompositionSpec utilities remain
available. See [docs/mcp.md](docs/mcp.md) and [docs/owt.md](docs/owt.md).

## SoundFonts

OpusWeave starts with **mda Piano**, the same default sampled piano instrument
used by FreePiano 1.8. The original MIT-licensed PCM samples and key groups are
packaged as a browser-compatible SoundFont; **OpusWeave Micro GM** remains as a
fallback for the other 127 melodic programs and drums. The timbre closely
matches FreePiano's default, though rendering is not bit-identical because
OpusWeave uses the SoundFont synthesis model rather than the original VST DSP.
You can replace the default at any time with your own `.sf2`, `.sf3`, or
`.sfogg` bank; only use files you are legally allowed to use.

The Sound Library panel can explicitly route Web Audio to an operating-system
output such as a USB-C monitor, HDMI display, speakers, or headset. Use
**Show devices** if names are hidden; Chromium may request microphone
permission only to reveal device labels, and OpusWeave immediately stops the
temporary stream without recording it.

## Format model


- **OWT (`.owt`)** is the primary persistent format: simple, deterministic,
  human-editable melody text. See [docs/owt.md](docs/owt.md).
- **MIDI** is an import, playback and export format. MIDI → OWT is intentionally
  lossy: accompaniment, performance controls and microtiming are discarded.
- **CompositionSpec** is an internal structured compilation model shared by
  OWT validation and MIDI export, not the user-facing file format.
- **Score images and MP4 video** can be sent to a configured multimodal model
  and simplified into validated OWT; MP4 recognition samples visual frames.

See [docs/midi-model.md](docs/midi-model.md) for the full `CompositionSpec`
schema and validation rules.

## Project layout

```
src/
├── main.ts                    # BunDesk desktop app, CLI actions, --smoke, MCP routing
├── build.ts                   # single-file binary build (bundesk)
├── domain/                    # framework-free core: OWT, melody extraction,
│   │                          #   composition IR, MIDI import/export, devices
│   │                          #   quantization, device profiles, MIDI learn, service
├── audio/                     # SynthEngine interface, spessasynth engine, mock,
│   │                          #   FluidSynth renderer
├── midi/                      # WebMIDI manager, port selection
├── mcp/                       # MCP server + tool definitions
├── cli/                       # CLI argument helpers
├── web/                       # GUI: HTML/CSS/TS, no framework
└── tests/                     # deterministic Bun test suite
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
