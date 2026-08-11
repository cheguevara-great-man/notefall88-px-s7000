# NoteFall Studio license boundary

NoteFall-authored source files remain available under the repository's MIT
license. The **NoteFall Studio distribution** also bundles and dynamically
loads `webmscore-webpack5` 0.21.0-a, a GPL-licensed WebAssembly conversion
engine. The combined Studio PWA and Android/iOS application distributions are
therefore conveyed under **GNU GPL version 3**.

The complete GPL-3.0 text is shipped inside every Studio build at
`legal/GPL-3.0.txt`. Corresponding source for the NoteFall application is the
public repository containing this file. The exact third-party package,
integrity value, upstream source URL, copied runtime files, and build boundary
are recorded in `THIRD_PARTY_NOTICES.md`, `web/package-lock.json`, and
`docs/decisions/005-studio-score-converter.md`.

This GPL boundary does not include NoteFall Core firmware or its embedded web
bundle: the Core production build neither links nor distributes the webmscore
runtime and remains MIT-licensed, subject to the third-party notices shipped
with it.
