# OpusWeave Text 0.1

OpusWeave Text (OWT) is the human- and LLM-facing text layer for OpusWeave.
It is not a replacement for Standard MIDI File, ABC, or MusicXML. OWT is used
for copy/paste, CLI and MCP operations, readable performance data, and stable
text serialization of the shared composition and take models.

OWT 0.1 has two document kinds:

- `score`: what the music should be.
- `take`: what a performer actually played.

Every file starts with `owt 0.1 score` or `owt 0.1 take` and ends with `end`.
Quoted strings use JSON string escaping. Comments start with `#` when the `#`
is preceded by whitespace, so accidentals such as `C#4` remain unambiguous.

## Score

```text
owt 0.1 score

title "Example"
ppq 480
meter 1:1 4/4
tempo 1:1 120
key 1:1 C major

track "Piano" channel=1 program=0 velocity=88
| <cc64=127> C4:1 E4:1 G4:1 C5:1 |
| [C4 E4 G4]:2{v=76} <bend=8192> R:2 |

end
```

### Time and pitch

- `C4` is MIDI note 60.
- Durations are measured in quarter notes: `1` is a quarter, `1/2` an eighth,
  `1/4` a sixteenth, `2` a half, and `4` a whole note.
- Durations are normalized rational numbers. Cursor arithmetic does not use
  floating-point accumulation.
- Every note, rest, and chord has an explicit duration.
- Every track starts at quarter position zero and has an independent cursor.
- A chord starts all contained pitches together and advances by one shared
  duration.
- `|` validates a measure boundary but never advances time.

### Directives

```text
ppq 480
meter 1:1 4/4
tempo 1:1 120
tempo 9:1 140
key 1:1 C major
track "Lead" channel=1 program=80 velocity=96
```

Positions use one-based `measure:beat`. Meter changes must occur at beat 1.
OWT channels are human-facing `1` through `16`; the shared CompositionSpec and
MIDI layers convert them to MIDI channels `0` through `15`.

### Events

```text
C4:1
R:1/2
[C4 E4 G4]:2
C4:1{v=64}
<cc64=127>
<bend=8192>
<program=40>
```

Control, bend, and program events occur at the current cursor and do not
advance it. Velocity is `1–127`; CC controller/value and program are `0–127`;
pitch bend is `0–16383` with center `8192`.

## Take

```text
owt 0.1 take

title "Take 1"
source "MIDIPLUS TINY+"
unit ms

note C4 at=0.000 dur=468.420 velocity=73 channel=1
cc 64 at=100.000 value=127 channel=1
bend at=500.000 value=8192 channel=1

end
```

Take timestamps and note durations are milliseconds and may contain decimals.
A note duration represents physical key-down to key-up time; sustain remains a
separate CC64 event. MIDI import normalizes Note On velocity zero to Note Off,
pairs repeated notes in event order, and closes unmatched notes at the MIDI end.
The serializer emits exactly three decimal places for stable diffs.

## Quantization

Exact Take events can be quantized to Score using a configurable grid, tempo,
and meter. CLI/MCP grid values use conventional whole-note fractions: `1/16`
means a sixteenth-note grid, which is OWT duration `1/4`. Note velocities are
preserved. CC and bend events are placed on the same grid. Overlapping notes
that cannot share one sequential voice are split into additional tracks.

The original MIDI/Exact Take should be retained alongside the quantized Score;
quantization is a derived view, not a replacement for performance timing.

## CLI

```bash
opusweave text validate examples/twinkle.owt
opusweave text play examples/twinkle.owt
opusweave text to-midi examples/twinkle.owt -o twinkle.mid
opusweave text from-midi twinkle.mid --view exact -o take.owt
opusweave text from-midi twinkle.mid --view quantized --grid 1/16 --bpm 120 -o score.owt
```

`text play` opens the OpusWeave internal SoundFont player with the compiled
score. Browser audio policy requires one click in the window before playback.

## MCP tools

- `validate_score_text`
- `play_score_text`
- `compile_score_text_to_midi`
- `get_take_text`
- `quantize_take`
- `compare_take_with_score`

`get_take_text` accepts a stored take ID, MIDI file, or Take text. Optional
measure bounds, BPM, and meter return a ranged Exact Take view to avoid placing
an entire long performance in one model context.

## Shared model

```text
CompositionSpec JSON ─┐
                      ├── shared composition model ── MIDI exporter
OWT Score ────────────┘

Recorded MIDI ── note pairing ── Exact Take ── quantizer ── OWT Score
```

OWT serializers are deterministic. Standard MIDI remains the performance file
format; ABC import/export and MusicXML notation remain compatibility layers for
future work.
