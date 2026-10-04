# Third-party software

PDF Markup source code is licensed under MIT. Third-party components retain
their own licenses; the project license does not replace them.

| Component                               | License                               | Source                                      |
| --------------------------------------- | ------------------------------------- | ------------------------------------------- |
| React / React DOM                       | MIT                                   | https://github.com/facebook/react           |
| PDF.js                                  | Apache-2.0                            | https://github.com/mozilla/pdf.js           |
| pdf-lib                                 | MIT                                   | https://github.com/Hopding/pdf-lib          |
| @pdf-lib/fontkit                        | MIT                                   | https://github.com/Hopding/fontkit          |
| Tailwind CSS                            | MIT                                   | https://github.com/tailwindlabs/tailwindcss |
| Tauri and official plugins              | MIT OR Apache-2.0                     | https://github.com/tauri-apps/tauri         |
| Liberation Sans (bundled as LegendSans) | GPL-2.0 with font embedding exception | src/assets/LegendSans.LICENSE               |

The PDF.js distribution copies its license into bundled assets. The font
license is included in the installed resources. Direct and transitive runtime
JavaScript licenses are collected into `public/THIRD_PARTY_LICENSES.txt`
during the build. Rust component license declarations are available in the
locked dependency graph (`cargo metadata --locked`) and upstream crates. The
installer additionally includes collected Rust license texts in `licenses/RUST_LICENSES.txt`.
Microsoft WebView2 is a separately provisioned Microsoft runtime subject to
Microsoft's terms.
