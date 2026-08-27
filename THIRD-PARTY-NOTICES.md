# Third-party notices

Haze bundles a small number of third-party assets. This file is the canonical
list of them and of the obligations they carry.

**The thing that is easy to forget:** these assets are not loaded from disk at
runtime. They are baked into the executable at compile time by `embed.binary`,
which emits the file as a `const uint8_t[]` in generated C (see
`compileEmbeddedFile` in `src/Codegen/CodeGenerator.ts`). Every application
built with Haze therefore *redistributes* them, byte for byte, inside its own
binary. Attribution conditions trigger on redistribution, not on use -- so they
do not stop at this repository. They propagate to anyone who ships an
application built with the Haze standard library, most of whom will never look
in this folder. That is the whole reason this file exists.

None of the bundled assets are copyleft. Nothing here places any condition on
the license of an application that uses Haze. The obligation is attribution and
nothing else.

## What is bundled

| Asset | Used by | License | Attribution required downstream |
| --- | --- | --- | --- |
| [`stdlib/renderer/resources/ProggyClean.ttf`](stdlib/renderer/resources/ProggyClean.ttf) | Default text font, [`renderer.hz`](stdlib/renderer/src/renderer.hz#L175) | MIT | Yes -- copyright notice + license text |
| [`stdlib/ui_widgets/resources/codicon.ttf`](stdlib/ui_widgets/resources/codicon.ttf) | Codicon icons, [`Codicon.hzui`](stdlib/ui_widgets/src/Codicon.hzui) | CC BY 4.0 | Yes -- credit + license link |

Everything else in this repository is MIT, Copyright (c) 2025 Florian Zachs;
see [`LICENSE`](LICENSE).

### ProggyClean.ttf

ProggyClean by Tristan Grimmer (<https://proggyfonts.net>), the 41208-byte
canonical build, SHA-256
`527d2a443ce051f93f7e77b855609722b8cb220a9f104b4aa037be5c90b71324`. It is the
same file Dear ImGui bundles, and it is distributed as MIT, Copyright (c) 2004,
2005 Tristan Grimmer.

Note that the font's own `name` table carries only "by Tristan Grimmer" and no
license string, and this repository has no record of where the file was
obtained -- it arrived in bulk commit `37499c0c` with no provenance. The MIT
statement above is taken from the Dear ImGui distribution's font
documentation, which is the usual authority for this file, but it is not
independently confirmed here. If Haze is ever shipped somewhere that audits
this properly, get a first-party copy with its license alongside it.

This one is the more load-bearing of the two: the renderer is pulled in by
*every* Haze application, unconditionally, so every Haze binary carries this
font whether or not it draws any text.

### codicon.ttf

The Visual Studio Code icon font, from
[microsoft/vscode-codicons](https://github.com/microsoft/vscode-codicons).
Full detail -- version, hashes, the CC BY / MIT split, trademark caveats and
the update procedure -- lives in
[`stdlib/ui_widgets/resources/NOTICE-codicons.md`](stdlib/ui_widgets/resources/NOTICE-codicons.md).

The short version: Microsoft licenses the *icons* under CC BY 4.0 and the
repository's *code* under MIT. The font is icons, so CC BY 4.0 applies. It is a
common and easy mistake to state this the other way around.

## If you ship an application built with Haze

Put something equivalent to this where a user can find it -- an About box, a
"Licenses" screen, or a `THIRD-PARTY-NOTICES` file next to the binary. CC BY
4.0 §3(a)(2) accepts a link to a page carrying the information, so one screen
with these lines discharges both obligations:

```
This application includes the following third-party components.

ProggyClean font — Copyright (c) 2004, 2005 Tristan Grimmer.
Licensed under the MIT License. https://proggyfonts.net

Codicons — © Microsoft Corporation, licensed under CC BY 4.0, unmodified.
https://github.com/microsoft/vscode-codicons
https://creativecommons.org/licenses/by/4.0/

Both are provided "as-is", without warranties of any kind.
```

MIT additionally wants its full license text included, not just the notice
line. Ship the copies kept alongside the assets:
[`LICENSE-ProggyClean-MIT.txt`](stdlib/renderer/resources/LICENSE-ProggyClean-MIT.txt)
and, for codicons,
[`LICENSE-codicons-CC-BY-4.0.txt`](stdlib/ui_widgets/resources/LICENSE-codicons-CC-BY-4.0.txt).

Two edges worth knowing:

- **Subsetting the codicon font counts as modification.** Tempting, since it is
  146 KB for typically a few dozen glyphs. CC BY 4.0 §3(a)(1)(B) then requires
  you to say so -- change "unmodified" to "modified (subset)" and you are done.
- **CC BY 4.0 §2(a)(5)(B) forbids downstream restrictions.** An EULA clause
  banning all asset extraction is in tension with it. Carve bundled assets out
  of any such clause.

Trademarks are a separate matter from either license. The Microsoft-branded
codicon glyphs (`vscode`, `github`, `copilot`, `azure`, ...) depict marks, and
neither CC BY nor MIT grants any right to use them *as marks*.

## If you add another bundled asset

Anything reaching `embed.binary` or `embed.text` ships in every user's binary.
Before adding one:

1. Confirm the license actually permits redistribution, and save the license
   text next to the asset -- not just a URL, which rots.
2. Record the upstream version, a SHA-256, and the exact fetch command. If the
   asset is not fetchable from its source repository (codicons is not -- its
   `dist/` is gitignored), that detour is the first thing forgotten.
3. Note whether the asset was modified. Subsetting, re-encoding and format
   conversion all count.
4. Add a row to the table above, and a line to the ready-to-paste block, so
   downstream shippers inherit a correct notice by default.
5. Leave a comment at the `embed` call site pointing here. The obligation is
   otherwise invisible at exactly the point where someone incurs it.

This file is not legal advice. It records what the upstream licenses say and
what has been verified, so that the next person does not have to re-derive it.
