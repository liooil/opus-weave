# OpusWeave Roadmap

Milestone 1 now includes OWT 0.1 Score/Take parsing, MIDI compilation, Exact
Take import, quantization, CLI workflows and MCP tools.

## Milestone 1: OWT text layer — implemented

- OWT Score and Exact Take documents with deterministic serialization.
- Shared CompositionSpec/MIDI compilation path.
- MIDI-to-Take pairing, velocity-zero normalization and configurable quantization.
- CLI and MCP validation, compilation, playback preparation, retrieval and comparison.

## Milestone 2: MusicXML and interactive scores

- MusicXML / MXL import and export.
- Staff display (five-line notation rendering).
- Part selection and part muting.
- Current-measure highlighting.
- Track ↔ score-part mapping.
- Original mode and reflow (re-engraved) mode.

## Milestone 3: Human–AI ensemble and score following

- The user selects the part they will perform; the app plays the rest.
- Real-time MIDI score following.
- Automatic page turns.
- Accompaniment follows the user's tempo.
- Take comparison and practice analysis.

## Milestone 4: OMR (optical music recognition)

- Image / PDF score import.
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

- Full computer-keyboard mapping.
- Multiple layers / groups.
- Multiple actions per key binding.
- FreePiano `.map` file import.
- External MIDI output.
- Richer controller scripting.

## Notes on product boundaries

- MIDI is the performance/playback format.
- OWT Score/Take is the human- and LLM-facing text layer, not an industry exchange format.
- MusicXML is the planned formal notation format; ABC remains a future compatibility format.
- Images/PDF (OMR) are planned input entry points.
- `CompositionSpec` and OWT Score share one composition business model.
- The MIDIPLUS TINY+ profile is the first official device profile, not the
  only one.
