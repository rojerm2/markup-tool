# NSIS installer notices

`COPYING` is the unmodified upstream license supplied with NSIS 3.11, the
installer tool used by the pinned Tauri CLI. Its SHA-256 is
`e7dd514003ab96cb3ddccbc028fe5c795fccf57dc41f21cfb9d4dd16ead23bf5`.

The installer uses NSIS's built-in plugins and LZMA compression. The license
contains the zlib/libpng terms and the Common Public License terms with the
special exception for linking to the LZMA module. This project does not modify
these upstream components. The notice is bundled as `licenses/NSIS_COPYING`;
the application source retains its own MIT license.

- [NSIS licensing](https://nsis.sourceforge.io/Docs/AppendixI.html)
- [NSIS 3.11 binary and source distributions](https://sourceforge.net/projects/nsis/files/NSIS%203/3.11/)

Preserve the complete upstream notice and review it when changing installer
components. Other plugins supplied by Tauri retain Tauri's licenses, as listed
in the main third-party notices.
