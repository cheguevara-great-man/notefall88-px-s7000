# W3C MusicXML compatibility fixtures

These three files are copied without modification from the W3C Music Notation
Community Group's `musicxmlTestSuite` at pinned commit
`b2e6a1627b8574c9714e1fd0a8a5b1921e10f8f3`:

- `43a-PianoStaff.xml`: two-staff piano structure and `backup` timing;
- `45b-RepeatWithAlternatives.xml`: repeat endings expanded into playback order;
- `31c-MetronomeMarks.xml`: diverse machine-readable metronome forms.

Upstream: <https://github.com/w3c-cg/musicxmlTestSuite/tree/b2e6a1627b8574c9714e1fd0a8a5b1921e10f8f3/xmlFiles>

The upstream suite is MIT licensed. Its license is preserved as `LICENSE` in
this directory. Each test also pins the exact SHA-256 of its fixture so a file
cannot drift while the expected playback assertions remain unchanged.
