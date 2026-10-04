# Liberation Sans source

`src/assets/LegendSans.ttf` is the unmodified Liberation Sans Regular 1.07.4
font from the official binary archive, distributed under GPL-2.0 with the
exceptions in `src/assets/LegendSans.LICENSE`. The application source has a
separate MIT license. The font's embedding exception applies to documents;
it does not replace the font software's redistribution requirements.

The original source archive, including FontForge `.sfd` files, build scripts,
Makefile, authors and license texts, is included here and in installed resources
under `licenses/font-source/`. It can be unpacked with a tar/gzip tool. The
upstream README and Makefile describe building fonts with FontForge and `make`;
the application does not execute these scripts.

Upstream: [Liberation 1.7 fonts](https://github.com/liberationfonts/liberation-1.7-fonts).

| File                    | Official source                                                                 | SHA-256                                                            |
| ----------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Source archive          | https://releases.pagure.org/liberation-fonts/liberation-fonts-1.07.4.tar.gz     | `ad98b7498dc2992f7f0868f79b65ce4a720a3acdb63ab3f1f1cb6881117a5406` |
| Upstream binary archive | https://releases.pagure.org/liberation-fonts/liberation-fonts-ttf-1.07.4.tar.gz | `61a7e2b6742a43c73e8762cdfeaf6dfcf9abdd2cfa0b099a9854d69bc4cfee5c` |
| Bundled font            | `LiberationSans-Regular.ttf` in the binary archive, stored as `LegendSans.ttf`  | `fc977b8f8a736c45ee4126383d0b8a929af7d4f4a9c4a1c974ed5a32387db822` |

The regular font has the same character coverage, mapped glyph outlines and
advance widths as the previous bundled 1.07.4 build. Text shaping was compared
across supported characters and representative Latin, Greek and Cyrillic text.
No font outlines or license statements were modified.
