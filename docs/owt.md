# OpusWeave Text 0.1

OpusWeave Text (`.owt`) is the primary OpusWeave file format. It is a stable,
human-editable description of musical content: notes, rests, rhythm, measures,
tempo and optional harmony. OpusWeave is an OWT editor and player; MIDI is an
import, playback and export format rather than the source of truth.

OWT has one document kind: Score. Every file starts with `owt 0.1 score` and
ends with `end`.

## Simple melody

```text
owt 0.1 score

title "Example melody"
ppq 480
meter 1:1 4/4
tempo 1:1 120
key 1:1 C major

track "Melody" channel=1 program=0 velocity=88

| C4:1 D4:1 E4:1 G4:1 |
| A4:2 G4:1 R:1 |

end
```

`C4` is MIDI note 60. Durations use quarter-note units:

| OWT duration | Musical duration |
|---|---|
| `4` | whole note |
| `2` | half note |
| `1` | quarter note |
| `1/2` | eighth note |
| `1/4` | sixteenth note |

Durations are normalized rational numbers, so cursor arithmetic does not
accumulate floating-point error. Every note, rest and chord has an explicit
duration. `|` validates a measure boundary but does not advance time.

Quoted strings use JSON escaping. Comments start with `#` when preceded by
whitespace, so accidentals such as `C#4` remain unambiguous.

## Directives

```text
ppq 480
meter 1:1 4/4
tempo 1:1 120
tempo 9:1 132
key 1:1 G major
track "Melody" channel=1 program=0 velocity=88
```

Positions use one-based `measure:beat`. OWT channels are human-facing `1`
through `16`; MIDI conversion maps them to channels `0` through `15`.

The primary editing profile is one `Melody` track. Multiple tracks, chords and
control events remain available for music that needs them:

```text
[C4 E4 G4]:2
C4:1{v=64}
<cc64=127>
<bend=8192>
<program=40>
```

Automatic imports deliberately produce the simpler one-track profile and omit
per-note velocity unless explicitly requested.

## Editor highlighting

The OpusWeave editor colors directives, strings, notes, rests, chords,
controls, attributes, numbers, bars and comments. During OWT playback, the
source token for every currently sounding note or rest is highlighted. The
same event is highlighted in the staff and Jianpu views. The highlight follows
tempo changes and supports simultaneous events on multiple tracks. Editing the
text stops the stale playback mapping before rebuilding the lexical layer.
Hovering or keyboard-focusing a note in the timeline, staff or Jianpu view
opens a readable source card. OWT tokens preserve their source text, while
timeline values are expanded to one field per line. Localized rows explain
every available field: event type, pitch and MIDI number, duration, channel,
velocity, and timeline position.

## Direct score editing

The default Helix **NORMAL · Score edit** mode applies modal motions directly
to complete musical objects instead of exposing a separate selection-level control:

- **Event (CHAR)** — one note, rest, chord or control event, such as `C4:1`.
- **Measure (WORD)** — the events between a pair of bar lines.
- **Track (LINE)** — one complete musical track.

Use `h`/`l` to move between events, `b`/`w`/`e` between measures and `k`/`j`
between tracks. Arrow keys mirror `h`/`l` and `k`/`j`. Search commands are not
part of the OWT modal language. `Space` opens the button-command hierarchy,
including play/pause, views, editing actions, import, examples and AI actions.
`Ctrl+Space` toggles play/pause globally, including from the timeline, staff and
Jianpu views. The adjacent **Loop playback** toggle repeats the active MIDI or
OWT playback continuously; `Space t l` toggles it from the Helix command tree.
The transport remains visible on **Settings**, so SoundFont, preset, output and
volume changes can be auditioned without returning to the score. Its single
action label reads **Play** while paused and **Pause** while playing. The global
**Return to beginning** action silences current playback, moves the persistent
score cursor to beat zero and remains available in every score view; it is not
a separate stopped state.
Selected OWT ranges repeat their exact range, while AI-improv responses and
timeline replacement previews remain one-shot.
For events, enter a complete token and use **Insert before**, **Insert after**
or **Replace**. **Delete** applies to the selected event, measure or track.
**Play to replace event** waits for one Note On from MIDI, the computer
keyboard or the virtual piano, then replaces the selected pitch while keeping
its duration and event attributes.

**RAW · Raw text** is a first-class Helix mode beside NORMAL, INSERT and
SELECT. Click the mode indicator at the editor's lower-left corner to toggle
NORMAL and RAW; there are no separate mode buttons. RAW keeps the same syntax
highlighting and editor layout while enabling unrestricted native typing,
paste and document replacement. Most Helix motions are intentionally inactive;
Save remains available.
**Improv** is independent of the editor mode and lives in the global score
toolbar beside **AI composition**, so it remains available in OWT, Timeline,
Staff and Jianpu views.

The editor continuously stores the complete UTF-8 OWT source in the URL hash as
URL-safe Base64 (`#owt=...`). Copying the browser URL therefore shares the
current score without a server, and refreshing restores even an unfinished edit.
A shared-score hash takes precedence over desktop startup MIDI. Invalid hash
data is rejected and replaced with the default score.

## Guided performance

The **Perform** action turns the current Melody track into a sequence of
expected notes. The Live Performance panel shows the next note, the mapped
computer key when available, progress, an outlined computer keycap and an
outlined piano key. Correct Note On input advances the guide; a chord advances
after every pitch in that chord has been played. Wrong notes do not advance.

## Real-time computer-keyboard layouts

The Live Performance panel owns the active computer-keyboard layout. Changing
its selector immediately updates the visible key-to-note map, piano range and
live keystrokes. The selected layout is saved locally.

- **OpusWeave default** is the existing chromatic two-octave piano layout.
- **English word melody** maps every letter through constrained C-major
  pentatonic motion; spaces and punctuation create tonic cadences.
- **Pinyin melody** maps Pinyin letters through pentatonic motion; spaces and
  punctuation create cadences without occupying number keys for tones.
- **FreePiano classic** reproduces every note-playing key from FreePiano 1.8's
  canonical `data/freepiano.map`: the full main section, navigation cluster,
  arrow keys and numeric keypad span B1 through A6.

In the default layout, A/K change octave and F/4 change velocity. Those keys
become ordinary notes in the word, Pinyin and FreePiano layouts.

`ComputerKeyboardLayout` is a public domain contract accepted by
`MappingEngine.setComputerLayout`, so a future layout editor can install user
key maps without changing input handlers.

## Built-in examples

The editor includes public-domain material: *Twinkle Twinkle Little Star*,
Beethoven's *Ode to Joy*, the opening of *Für Elise*, Pachelbel's *Canon in D*,
Petzold's *Minuet in G*, and the opening texture of Beethoven's *Moonlight
Sonata*. The example picker sits beside **Open / Import**, because examples are
another source to open. The source files are also available under `examples/`.

## AI score editor

The **AI composition** button opens a blocking prompt dialog. `Enter` confirms
the request; `Shift+Enter` inserts a newline. The dialog rotates short prompt
suggestions on each opening, and an empty submission uses the displayed
suggestion. After submission, the dialog closes and the button itself reports
working, success or failure by its text and color.

Service URL, optional API key, protocol, model and expandable prompt-template
settings live on the **Settings** page and are stored locally in the browser.
The shared system prompt and the composition, media-transcription and
improvisation templates are independently editable. `{instruction}` marks where
each feature's user-entered request is inserted; the current OWT is appended
automatically. Defaults can be restored from the same panel.

Entering a service URL discovers selectable models when the provider exposes a
model-list API. llama.cpp servers are recognized on LAN port 8080 and both
`/models` and `/v1/models` are supported. Manual model IDs remain available.
Auto detection supports OpenAI Responses, OpenAI Chat/legacy Completions,
Anthropic Messages, Ollama native, OpenRouter and llama.cpp/OpenAI-compatible
servers. The source contains no default endpoint or model. When no
endpoint/model is configured, the button instead opens a prepared, editable
prompt containing the current score and OWT validity rules. It can be copied
into any AI chat, and the returned OWT can always be pasted directly into the
editor.

- A typed or suggested prompt edits the current OWT, validates the returned
  document and plays it.
- **Open / Import** and drag-and-drop share one dispatcher: OWT opens directly,
  MIDI is converted deterministically, and score images or MP4 files go to AI.
  Images are sent as multimodal content; MP4 files are decoded in the browser
  and sampled into up to eight JPEG frames before transcription.
- **Improv mode** listens continuously to MIDI, computer-keyboard or virtual-keyboard input. The first Note On starts a user turn; once all notes are released and input is silent for 1.2 seconds, the phrase is converted to OWT and sent automatically. The AI response is validated and played, then the mode returns to listening. Playing during the AI response interrupts it immediately and begins the next user turn.

Invalid model output is returned to the model with parser diagnostics for up to
three repairs. If free-form OWT remains invalid, a JSON-schema-constrained note
response is converted into measure-safe OWT. Desktop builds proxy AI requests
through the loopback BunDesk server so a LAN llama.cpp server does not need
browser CORS configuration; the static web build connects directly.

## Lossy MIDI import

MIDI import extracts an editable melody instead of preserving the MIDI event
stream. The conversion is intentionally lossy and deterministic:

1. Ignore the percussion channel.
2. Group notes by MIDI track and channel.
3. Select the most melody-like source using track names, monophony, pitch range
   and note density, unless the user selects a track or channel.
4. Reduce simultaneous notes to one voice using `continuous`, `highest` or
   `lowest` selection.
5. Quantize note starts and durations to `1/8`, `1/16` or `1/32`.
6. Preserve the first tempo, meter and key signature when available.
7. Emit one track named `Melody`.
8. Discard accompaniment tracks, drum notes, CC, pitch bend, aftertouch, SysEx,
   raw track structure and performance microtiming.

The importer returns a report containing the selected track/channel, input and
output note counts, discarded note count and ignored event count. Loss is part
of the contract: the generated OWT represents the recognizable melody, not a
round-trip copy of the MIDI file.

Recordings use the same extraction pipeline. Future audio/video transcription
and score-image recognition should also produce the same simple OWT model after
recognition and normalization.

## CLI

```bash
opusweave owt validate examples/twinkle.owt
opusweave owt play examples/twinkle.owt
opusweave owt to-midi examples/twinkle.owt -o twinkle.mid
opusweave owt from-midi twinkle.mid --grid 1/16 --voice continuous -o melody.owt
```

Optional MIDI import flags:

- `--track N`: one-based source MIDI track.
- `--channel N`: source MIDI channel `1–16`.
- `--grid 1/8|1/16|1/32`: rhythm simplification grid.
- `--voice continuous|highest|lowest`: polyphony reduction strategy.
- `--preserve-velocity true`: retain per-note velocity overrides.

`owt play` opens the OpusWeave player with the compiled OWT. Browser audio
policy may require one click before playback starts.

## MCP tools

- `validate_owt`
- `play_owt`
- `export_owt_to_midi`
- `import_midi_to_owt`

`import_midi_to_owt` exposes the same lossy melody extraction options and
returns both OWT text and the conversion report.

## Internal compilation

```text
.owt text
   │ parse + validate
   ▼
OWT Score AST
   │ internal conversion
   ▼
CompositionSpec
   │ MIDI exporter
   ▼
MIDI playback/export
```

`CompositionSpec` remains an internal structured compilation model. `.owt` is
the persistent user-facing source format. MIDI and rendered audio can always be
regenerated from OWT, but imported MIDI cannot be reconstructed from simplified
OWT.
