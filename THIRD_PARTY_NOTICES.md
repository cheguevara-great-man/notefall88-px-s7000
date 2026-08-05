# Third-party notices

## ESP32_Host_MIDI

The USB-MIDI host task/client architecture in `firmware/src/UsbMidiHost.*` is derived from ideas and portions of [ESP32_Host_MIDI v7.2.0](https://github.com/sauloverissimo/ESP32_Host_MIDI/tree/v7.2.0), used under the MIT License.

The NoteFall version removes all non-USB transports, keeps exactly one outstanding IN transfer, allocates no isochronous descriptors for a bulk MIDI endpoint, and adds explicit interface cleanup. The original English MIT notice is reproduced below:

```text
MIT License

Copyright (c) 2025 Saulo Veríssimo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Browser bundle

Production JS is compiled into `firmware/data/` and therefore contains third-party code. Versions are fixed by `web/package-lock.json`.

| Package | Version | License | Use |
|---|---:|---|---|
| `@tonejs/midi` | 2.0.28 | MIT | MIDI parsing and recording export |
| `midi-file` | 1.2.4 | MIT | transitive Standard MIDI File codec |
| `@xmldom/xmldom` | 0.9.10 | MIT | MusicXML DOM parsing |
| `fflate` | 0.8.2 | MIT | bounded MXL decompression |
| `opensheetmusicdisplay` | 1.9.9 | BSD-3-Clause | MusicXML engraving |
| `vexflow` | 1.2.93 | MIT | OSMD notation renderer |
| `jszip` | 3.10.1 | MIT option of MIT/GPL dual license | OSMD bundled ZIP support |
| `loglevel` | 1.9.2 | MIT | OSMD logging |
| `typescript-collections` | 1.3.3 | MIT | OSMD data structures |
| `pako` | 1.0.11 | MIT | JSZip deflate implementation |

Copyright notices for the MIT components:

- © 2016 Yotam Mann (`@tonejs/midi`)
- © 2016 Carter Thaxton (`midi-file`)
- © 2019–present Christopher J. Brody and contributors; © 2012–2017 @jindw and contributors (`@xmldom/xmldom`)
- © 2023 Arjun Barrett (`fflate`)
- © 2010 Mohit Muthanna Cheppudira (`vexflow`)
- © 2009–2016 Stuart Knightley, David Duponchel, Franz Buchinger and António Afonso (`jszip`, MIT option selected)
- © 2013 Tim Perry (`loglevel`)
- © 2010–2017 Tomasz Ciborski (`typescript-collections`)
- © 2014–2017 Vitaly Puzrin and Andrei Tuputcyn (`pako`)

The MIT terms printed in the ESP32_Host_MIDI section above apply to each MIT-licensed component and its listed copyright holder.

OSMD BSD-3-Clause notice:

```text
Copyright 2019 PhonicScore

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
```

## Firmware and engineering dependencies

- `arduinoWebSockets` 2.7.2 — LGPL-2.1; source and license are distributed by the fixed PlatformIO package. Binary distributors must preserve the LGPL notice and applicable relinking/reverse-engineering rights. [Upstream source](https://github.com/Links2004/arduinoWebSockets) and [LGPL-2.1 text](https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html).
- `ArduinoJson` 7.4.3 — MIT.
- Arduino-ESP32 / ESP-IDF toolchain components — their upstream mixed licenses apply to compiled firmware.
- CadQuery — Apache-2.0; used to generate manufacturing exports, not linked into firmware.

Piano Trainer Studio code and assets are not copied or linked. It is an audited AGPL-3.0 product reference only; see `docs/pts-adoption-decision.md`.

## W3C MusicXML test fixtures

Three unmodified compatibility fixtures under `web/test-fixtures/w3c-musicxml/`
come from the W3C Music Notation Community Group's
[`musicxmlTestSuite`](https://github.com/w3c-cg/musicxmlTestSuite/tree/b2e6a1627b8574c9714e1fd0a8a5b1921e10f8f3)
at pinned commit `b2e6a1627b8574c9714e1fd0a8a5b1921e10f8f3`, under the MIT
License. The upstream copyright and full license text are preserved beside the
fixtures in `web/test-fixtures/w3c-musicxml/LICENSE`.
