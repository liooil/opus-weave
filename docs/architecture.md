# OpusWeave Architecture

This document describes the module boundaries and the key decisions behind
them. Everything here refers to the real code in `src/`.

## Principles

The phase-1 spec mandates five separations, and the code follows them:

1. **MIDI input is separated from the synthesizer.** Raw incoming messages
   flow through `src/midi/web-midi-manager.ts` (ports) into a single message
   pipeline in `src/web/app.ts` (`handleMidiMessage`); only then do they
   reach the audio backend through the `SynthEngine.send` interface.
   Swapping the synth never touches the input path.
2. **The domain model is separated from the UI.** All music logic lives in
   `src/domain/` and is framework-free: no DOM, no AudioContext, no BunDesk.
   The GUI is a thin orchestration layer in `src/web/`.
3. **CLI, MCP and GUI share one service.** `OpusWeaveService`
   (`src/domain/services/opusweave-service.ts`) is the single entry point for
   creating, inspecting, validating and rendering. CLI actions (`src/main.ts`)
   and MCP tools (`src/mcp/tools.ts`) are thin adapters over it — neither
   re-implements MIDI processing.
4. **The browser playback backend and the FluidSynth render backend are
   separate.** `SynthEngine` (implemented by `SpessaSynthEngine` and
   `MockSynthEngine`) is real-time browser synthesis; `FluidSynthRenderer` is
   offline CLI rendering. The GUI never touches FluidSynth, and the renderer
   never touches Web Audio.
5. **Device configuration is not hardcoded in UI handlers.** Device profiles
   (`src/domain/devices/`) describe how a hardware controller maps to MIDI;
   the computer-keyboard mapping goes through `MappingEngine`; UI event
   handlers only forward messages.

## Module map

```
src/main.ts        BunDesk app: HTTP server (127.0.0.1 only), window (Chromium
                   provider), CLI actions, --smoke. `mcp` argv is handled
                   BEFORE any GUI code runs (stdio-only mode).
src/build.ts       Single-file binary via bundesk; the AudioWorklet processor
                   is embedded with a `with { type: 'file' }` import and
                   served at /spessasynth_processor.min.js.
src/domain/
  composition/     CompositionSpec types, runtime validation, TempoMap
                   (the single beat→tick rounding point).
  midi/            midi-export (SMF Type 1), midi-import/inspect, recorder.
  devices/         DeviceProfile model + matching, MappingEngine,
                   MIDIPLUS TINY+ profile.
  midi-learn.ts    MIDI Learn: arm parameter → bind control → persist.
  services/        OpusWeaveService (shared by CLI/MCP/GUI).
src/audio/         SynthEngine contract, spessasynth engine, mock, renderers.
src/midi/          WebMidiManager (browser) + pure port-selection logic.
src/mcp/           MCP server (stdio) + tool definitions.
src/web/           GUI: index.html, app.css, app.ts, components/.
src/tests/         98 unit tests.
```

## Key decisions

### `with { type: 'file' }` for the AudioWorklet asset

The spessasynth processor script must be served verbatim in dev AND inside the
compiled single-file binary. A `?raw` import is not resolved by `Bun.build`
in this Bun version, so `src/main.ts` imports it with
`with { type: 'file' }` (the same mechanism bundesk itself uses for its native
shim). In the compiled binary the file is embedded and materialized to a
runtime path; `readFileSync` serves it over the `/spessasynth_processor.min.js`
route. This is verified by the build smoke test (the binary serves HTTP 200 +
full byte size).

### MCP routing happens before the GUI

`src/main.ts` checks `argv[0] === 'mcp'` before creating the BunDesk app, so
stdio mode never opens a window, never binds a port and never prints welcome
text. The MCP session ends when stdin closes and the process exits by event-
loop drain: `process.exit()` is deliberately avoided there because on Windows
it truncates buffered stdout responses (the SDK writes responses
asynchronously).

### beat→tick rounding is centralized in `TempoMap`

`TempoMap.beatToTick` is the only place floating-point beats become integer
ticks. Exporters and the recorder both go through it, so every layer agrees
on timing. `TempoMap.tickToSeconds` integrates over the tempo map
(microseconds-per-quarter = 60_000_000 / bpm) with each segment priced at the
tempo in effect at the segment start.

### Track mute = event stripping, not synth hacks

The sequencer plays whole files, and spessasynth's channel-mute API is not
exposed through its public wrapper. `applyTrackMutes` (`src/domain/midi/
midi-import.ts`) copies the `BasicMIDI`, strips the muted tracks' events
(keeping the end-of-track marker), and re-serializes — pure, testable, and
independent of private synthesizer internals.

### Recording exports Type 0 with fixed tempo

`MidiRecorder` timestamps events with high-precision deltas; `takeToMidi`
writes a Type 0 SMF at the recorder's fixed tempo (480 ppq, 120 BPM default)
onto the single track the builder creates. Note On velocity 0 is normalized
to Note Off, repeated key presses close the previous note, and held notes are
closed on stop/disconnect/page-close so exports never contain dangling
notes. The exported file re-imports through the app's own importer (covered
by tests).

### Optional arrays are optional

`CompositionTrack.controlChanges` / `pitchBends` are optional in the type and
defaulted at export (`?? []`), matching the MCP schema's `.default([])`.

### Single instance + port fallback

BunDesk `singleInstance` forwards secondary invocations to the primary.
`WebMidiManager` persists the selected input port as `{id, name,
manufacturer}`; after a replug the pure `selectPort` logic restores by exact
id, then by name/manufacturer, then by name only — never by a stale index.
Virtual routing ports ("Midi Through" etc.) are flagged and only auto-selected
when nothing physical is present.

### Errors are typed

`OpusWeaveError` carries a machine-readable `code` plus per-issue detail
(validation errors name the exact `tracks[N].notes[M].field`). The CLI prints
the message, MCP returns it as tool error text, and the GUI surfaces it in the
status error box — nothing is console-only.
