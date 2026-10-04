# Third-party software

PDF Markup source code is licensed under MIT. Third-party components retain
their own licenses; the project license does not replace them.

| Component                               | License                                          | Source                                          |
| --------------------------------------- | ------------------------------------------------ | ----------------------------------------------- |
| React / React DOM                       | MIT                                              | https://github.com/facebook/react               |
| PDF.js                                  | Apache-2.0                                       | https://github.com/mozilla/pdf.js               |
| pdf-lib                                 | MIT                                              | https://github.com/Hopding/pdf-lib              |
| @pdf-lib/fontkit                        | MIT                                              | https://github.com/Hopding/fontkit              |
| Tailwind CSS                            | MIT                                              | https://github.com/tailwindlabs/tailwindcss     |
| Tauri and official plugins              | MIT OR Apache-2.0                                | https://github.com/tauri-apps/tauri             |
| Liberation Sans (bundled as LegendSans) | GPL-2.0 with font embedding exception            | src/assets/LegendSans.LICENSE                   |
| NSIS installer and built-in plugins     | zlib/libpng; LZMA CPL-1.0 with linking exception | https://nsis.sourceforge.io/Docs/AppendixI.html |

The PDF.js distribution copies its license into bundled assets. The font
license is included in the installed resources.
The font's corresponding source archive and build instructions are included in
`licenses/font-source/`; provenance is documented in `third_party/fonts/README.md`.
Direct and transitive runtime JavaScript licenses are collected into `public/THIRD_PARTY_LICENSES.txt`
during the build. Rust component license declarations are available in the
locked dependency graph (`cargo metadata --locked`) and upstream crates. The
installer additionally includes collected Rust license texts in `licenses/RUST_LICENSES.txt`.
Microsoft WebView2 is a separately provisioned Microsoft runtime subject to
Microsoft's terms.

The installer uses unmodified NSIS 3.11 components. Its upstream license,
including the LZMA linking exception, is included in `licenses/NSIS_COPYING`.
See [third_party/nsis/README.md](third_party/nsis/README.md) for provenance and
the upstream source distribution.
