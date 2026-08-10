# OpusWeave MIDI model

OpusWeave uses **Standard MIDI File (SMF)** as its performance/playback
format — SMF Type 1 on export. MusicXML / MXL is planned as the future
notation format (see `docs/roadmap.md`), and images/PDF (OMR) are planned
entry points.

`CompositionSpec` is OpusWeave's **AI/API input model**: a structured way for
agents, CLIs and MCP tools to describe music. It is **not** a new music file
standard. The persistent output of `create_midi` is always standard MIDI.

## CompositionSpec

```json
{
  "title": "Demo",
  "ppq": 480,
  "timeSignatures": [{ "beat": 0, "numerator": 4, "denominator": 4 }],
  "tempos": [{ "beat": 0, "bpm": 120 }],
  "tracks": [
    {
      "name": "Piano",
      "channel": 0,
      "program": 0,
      "volume": 100,
      "pan": 64,
      "notes": [
        { "startBeat": 0, "durationBeats": 1, "pitch": 60, "velocity": 96 }
      ],
      "controlChanges": [{ "beat": 0, "controller": 7, "value": 100 }],
      "pitchBends": [{ "beat": 0, "value": 8192 }]
    }
  ]
}
```

### Fields

| Field | Type | Default | Notes |
|---|---|---|---|
| `title` | string | — | Sequence title |
| `ppq` | int > 0 | 480 | Ticks per quarter note |
| `tempos` | `{beat, bpm}[]` | `[{beat:0, bpm:120}]` | Tempo map; `beat` ≥ 0, `bpm` > 0 |
| `timeSignatures` | `{beat, numerator, denominator}[]` | `[]` | `denominator` must be a power of two |
| `tracks` | Track[] | required | At least one recommended (empty → conductor-only file, warning) |

Each track:

| Field | Type | Default | Notes |
|---|---|---|---|
| `name` | string | — | Track-name meta event |
| `channel` | int 0–15 | track index (capped at 15) | MIDI channel |
| `program` | int 0–127 | — | GM program change at tick 0 |
| `volume` | int 0–127 | — | CC7 at tick 0 |
| `pan` | int 0–127 | — | CC10 at tick 0 (64 = center) |
| `notes` | Note[] | `[]` | See below |
| `controlChanges` | `{beat, controller, value}[]` | `[]` | `controller` 0–127, `value` 0–127 |
| `pitchBends` | `{beat, value}[]` | `[]` | `value` 0–16383, 8192 = center |

Notes: `{ startBeat ≥ 0, durationBeats > 0, pitch 0–127, velocity 1–127 }`.

## Validation rules

All input is validated at runtime (`src/domain/composition/validation.ts`)
before anything is written:

- Non-object specs, missing/malformed `tracks` → errors.
- MIDI values outside 0–127 are **errors** (pitch, velocity, program,
  channel, controller, CC value, volume, pan).
- Negative times are errors; `durationBeats` must be > 0; `bpm` must be > 0.
- Integers are required where the MIDI format uses integers
  (pitch, velocity, controller, program, ppq, …).
- Time-signature denominators must be powers of two.
- Errors always name the exact location: `tracks[0].notes[2].pitch: must be
  in range 0–127, got 300`. Nothing is silently coerced.
- Warnings (not errors): empty track list; unusually high tempo (> 400 BPM).

## beat → tick

Floating-point beats are converted to integer ticks in exactly one place:
`TempoMap.beatToTick` (`src/domain/composition/tempo-map.ts`). Exporters and
the recorder share it, so rounding is consistent across the app.

## SMF Type 1 export mapping

`src/domain/midi/midi-export.ts`:

- Track 0 is the conductor track (created by the builder): tempo map
  (`setTempo` events, µs-per-quarter = 60_000_000 / bpm) and time signatures
  (`FF 58 04 nn dd cc bb`, `dd = log2(denominator)`).
- Each spec track becomes one MIDI track: track-name meta, optional program
  change at tick 0, optional CC7 (volume) and CC10 (pan) at tick 0, then
  control changes, pitch bends (14-bit, 8192 center) and note on/off pairs.
- Events are sorted by tick before writing — the SMF writer computes deltas
  from array order, so an out-of-order event would corrupt absolute timing.
- Output is SMF Type 1, and every export is re-parsed in tests (round-trip).

## Inspection (`inspect-midi` / `inspect_midi`)

`src/domain/midi/midi-import.ts` parses any SMF and returns:

- `format`, `ppq`, `durationSeconds`, `durationBeats`, `trackCount`;
- per track: `name`, `channels[]`, first `program`, `noteCount`,
  `minNote`/`maxNote`, `hasControlChanges`, `hasPitchBend`;
- `tempos[]` (`{tick, bpm}`), `timeSignatures[]` (`{tick, numerator,
  denominator}`);
- `hangingNotes` + `warnings` (note-ons without a matching note-off are a
  warning — implicit end-of-track note-offs are normal in real files).

Corrupt files raise `OpusWeaveError('midi-corrupt')` instead of leaking
parser exceptions.
