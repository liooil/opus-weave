# Third-party notices

OpusWeave is licensed under Apache-2.0. This file lists the third-party
software it depends on and their licenses.

## Runtime dependencies

| Package | License | Notes |
|---|---|---|
| [spessasynth_lib](https://github.com/spessasus/spessasynth_lib) | Apache-2.0 | Browser MIDI synthesis (SF2/SF3) — license file: `node_modules/spessasynth_lib/LICENSE` |
| [spessasynth_core](https://github.com/spessasus/spessasynth_core) | Apache-2.0 | MIDI file I/O and builder — license file: `node_modules/spessasynth_core/LICENSE` |
| [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) | MIT | MCP server SDK — `node_modules/@modelcontextprotocol/sdk/package.json` |
| [zod](https://github.com/colinhacks/zod) | MIT | Schema validation — `node_modules/zod/package.json` |
| [bundesk](https://github.com/liooil/bundesk) | MIT | Desktop window/server framework — `node_modules/bundesk/LICENSE` |
| [@types/bun](https://github.com/oven-sh/bun) | MIT | TypeScript types (dev) |

## Optional external tools (not bundled, not distributed)

| Tool | License | Used for |
|---|---|---|
| [FluidSynth](https://github.com/FluidSynth/fluidsynth) | GPL-2.0-or-later (library: LGPL-2.1-or-later) | Optional offline MIDI→WAV rendering. OpusWeave only invokes the system `fluidsynth` binary as a subprocess; it is never installed or distributed by this project. Users who install it are responsible for its license terms. |

## Bundled SoundFonts

OpusWeave bundles `src/web/assets/soundfonts/FluidR3Mono_GM.sf3`, version 2.312,
as its General MIDI bank. The original stereo Fluid R3 bank is by Frank Wen;
the mono version is by Michael Cowgill, with additional credited instruments
from Ethan Winer and Michael Schorsch. It is distributed under the MIT License.
The complete upstream acknowledgements and license are preserved in
`src/web/assets/soundfonts/FluidR3Mono_License.md`. The SF3 is emitted as a
separate runtime asset and is not part of the PWA startup precache.
Upstream source: `https://github.com/musescore/MuseScore/raw/2.1/share/sound/FluidR3Mono_GM.sf3`.
SHA-256: `cfcd66d89e8386823400eca64934b14fbea7bf48ba1f00d21189af1262794ec2`.

The default acoustic piano layer, `src/web/assets/freepiano-mda-piano.sf2`, is
adapted from the original **mdaPiano v1.0** PCM sample data and key groups by
Paul Kellett. The source is pinned in `scripts/generate-mda-piano-sf2.ts` and is
licensed under the MIT License (Copyright © 2008 Paul Kellett; Copyright © 2019
Elk Audio OS). The generated SoundFont preserves that copyright and license.
FreePiano 1.8 uses mdaPiano as its bundled default instrument; OpusWeave does
not distribute or execute FreePiano's VST DLL.

Users may still load their own .sf2 / .sf3 / .sfogg files, subject to those
files' respective licenses.

## FreePiano keyboard interoperability

The optional “FreePiano classic” computer-keyboard layout reproduces the main
alphanumeric key-to-note assignments documented in FreePiano 1.8's public
`data/freepiano.map` for interoperability. OpusWeave implements those factual
assignments independently and does not copy or distribute FreePiano executable
code, plugins, or UI assets.

## Trademarks

OpusWeave is an independent project and is not affiliated with or endorsed by
FreePiano, MIDIPLUS, the MIDI Association, or any SoundFont trademark holder.
Product and company names mentioned in this project may be trademarks of
their respective owners.
