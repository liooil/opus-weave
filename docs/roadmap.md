# OpusWeave Roadmap

Planned milestones. Nothing here is implemented in phase 1 — this document
only records the direction.

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
- MusicXML is the planned formal notation format.
- Images/PDF (OMR) are planned input entry points.
- `CompositionSpec` is an AI/API input model, not a new music standard.
- The MIDIPLUS TINY+ profile is the first official device profile, not the
  only one.
