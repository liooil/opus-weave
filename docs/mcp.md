# OpusWeave MCP server

The OpusWeave MCP server exposes the CLI/domain capabilities to AI agents
over **stdio**. Start it with:

```bash
bun run opusweave mcp
```

or, from an MCP client configuration:

```json
{ "command": "bun", "args": ["<repo>/src/main.ts", "mcp"] }
```

## Protocol rules

- **stdout carries MCP protocol messages only.** All logging goes to stderr.
- No GUI, no browser window, no welcome text.
- The server exits cleanly when stdin closes; it handles tool errors without
  crashing (errors are returned as tool error results with a readable
  message).
- MCP mode is routed **before** any BunDesk/GUI code runs
  (`src/main.ts` checks `argv[0] === 'mcp'` first).

## Tools

All tools call the shared `OpusWeaveService` — the same code path as the CLI.

### `create_midi`

Create a Standard MIDI File (Type 1) from a `CompositionSpec` and write it to
disk.

| Argument | Type | Notes |
|---|---|---|
| `spec` | CompositionSpec object | See `docs/midi-model.md` |
| `output` | string | Output `.mid` file path |

Returns: `{ bytes, trackCount, noteCount, durationBeats, warnings, path }`.

### `inspect_midi`

Parse a MIDI file and return structured information.

| Argument | Type |
|---|---|
| `file` | string — path to the `.mid` file |

Returns the inspection object from `docs/midi-model.md` (format, ppq,
duration, per-track details, tempo and time-signature maps, hanging notes,
warnings).

### `render_midi`

Render MIDI + SoundFont to WAV using the system FluidSynth binary.

| Argument | Type | Notes |
|---|---|---|
| `midi` | string | Input `.mid` file |
| `soundfont` | string | Input `.sf2`/`.sf3` |
| `output` | string | Output `.wav` path |
| `sampleRate` | number (optional) | Default 44100 |
| `gain` | number (optional) | Default 0.5 |

Returns: `{ outputPath, bytes, fluidsynthVersion, durationSeconds, warnings }`.
Fails with a descriptive error (including install advice) when FluidSynth is
missing.

### `validate_composition`

Validate a CompositionSpec **without writing any file**. The input is
accepted unvalidated — this tool IS the validator — and out-of-range values
are reported rather than rejected.

Returns: `{ errors, warnings, stats }` where each error names the exact
`tracks[N].notes[M].field` and `stats` includes `trackCount`, `noteCount`,
`durationBeats`, `pitchRange`, `trackDensities`.

### `create_example_composition`

Returns a short multi-track example spec (melody + bass, tempo change,
control changes, pitch bend) for exercising the full
create → inspect → render pipeline. No arguments.

### OWT tools

OWT tools operate on the text format documented in `docs/owt.md`:

| Tool | Purpose |
|---|---|
| `validate_score_text` | Parse OWT and return source-located diagnostics plus composition validation |
| `play_score_text` | Compile Score text to a MIDI payload for the internal SoundFont player |
| `compile_score_text_to_midi` | Validate and write Score text as `.mid` |
| `get_take_text` | Register/retrieve Exact Take text, optionally ranged by measures |
| `quantize_take` | Convert Exact Take text to quantized Score text and MIDI |
| `compare_take_with_score` | Compare pitches and timing against a Score |

`get_take_text` accepts an existing `takeId`, a MIDI file to import, or Take
text to register. Range arguments use `fromMeasure`, `toMeasure`, `bpm`,
`meterNumerator`, and `meterDenominator`. `quantize_take.grid` uses a
conventional whole-note fraction such as `1/16`.

## Example session

```
→ initialize
← { serverInfo: { name: "opus-weave", version: "0.1.0" }, ... }

→ tools/call validate_composition
  { spec: { tracks: [{ name: "X", notes: [{ startBeat: 0, durationBeats: 1,
      pitch: 300, velocity: 90 }] }] } }
← { errors: [{ severity: "error", field: "tracks[0].notes[0].pitch",
      message: "must be in range 0–127, got 300", ... }], ... }

→ tools/call create_midi
  { output: "tmp/example.mid", spec: { ... } }
← { bytes: 176, trackCount: 2, noteCount: 5, durationBeats: 5,
    warnings: [], path: "..." }

→ tools/call inspect_midi { file: "tmp/example.mid" }
← { format: 1, ppq: 480, durationSeconds: 2.5, trackCount: 3, ... }
```

## Notes for AI agents

- Use `validate_composition` first when you are unsure your spec is well
  formed — it returns per-field errors instead of failing the call.
- `create_example_composition` is the fastest way to get a known-good spec to
  modify.
- `create_midi` validates too: an invalid spec fails with a precise field
  error and no file is written.
