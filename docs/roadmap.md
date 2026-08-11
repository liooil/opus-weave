# OpusWeave Roadmap

Milestone 1 establishes `.owt` as the primary editable format. MIDI is an
import, playback and export format; MIDI import intentionally extracts and
simplifies a melody instead of preserving performance events.

## Milestone 1: OWT melody editor — implemented

- Score-only OWT documents with deterministic parsing and serialization.
- OWT editing, validation, formatting, playback and MIDI export.
- Lossy MIDI/recording melody extraction with source selection, voice reduction and rhythm quantization.
- CLI and MCP OWT validation, playback, import and export workflows.

## Milestone 2: MusicXML and interactive scores

- MusicXML / MXL import and export.
- Staff display (five-line notation rendering).
- Part selection and part muting.
- Current-measure highlighting.
- Track ↔ score-part mapping.
- Original mode and reflow (re-engraved) mode.

## Milestone 3: Human–AI ensemble and score following

- Basic AI call-and-response from the latest live phrase is available; tempo-following ensemble remains future work.
- The user selects the part they will perform; the app plays the rest.
- Real-time MIDI score following.
- Automatic page turns.
- Accompaniment follows the user's tempo.
- Melody transcription quality evaluation and correction tools.

## Milestone 4: OMR (optical music recognition)

- AI-assisted image and MP4-frame transcription to validated OWT is available; deterministic OMR and PDF import remain future work.
- Replaceable `OmrProvider` interface.
- Staff-level OMR sidecar data.
- Source-image coordinates and confidence values.
- Human proofreading/correction UI.
- AGPL OMR implementations are kept out of the Apache-2.0 core.

## Milestone 5: Jianpu (numbered notation)

- Printed Jianpu recognition.
- MusicXML Jianpu representation.
- Jianpu rendering.
- Lyrics, chords and multi-part support.

## Milestone 6: FreePiano compatibility

- Switchable OpusWeave, English, Pinyin and FreePiano classic keyboard layouts are available; the visual custom-layout editor remains future work.
- Multiple layers / groups.
- Multiple actions per key binding.
- FreePiano `.map` file import.
- External MIDI output.
- Richer controller scripting.

## Notes on product boundaries

- OWT (`.owt`) is the primary human- and LLM-facing source format.
- MIDI is an import, playback and export format; MIDI → OWT is intentionally lossy.
- MusicXML remains a future notation interchange format.
- Images and MP4 frame samples can already produce simplified OWT through a configured multimodal model; deterministic OMR, PDF and audio transcription remain future work.
- `CompositionSpec` is the internal compilation model shared by OWT validation and MIDI export.
- The MIDIPLUS TINY+ profile is the first official device profile, not the
  only one.
