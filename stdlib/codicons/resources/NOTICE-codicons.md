# Codicons -- third-party notice

> Part of the repo-wide list in [`THIRD-PARTY-NOTICES.md`](../../../THIRD-PARTY-NOTICES.md),
> which also covers what an application built with Haze has to forward.


`codicon.ttf` in this folder is the icon font from
[microsoft/vscode-codicons](https://github.com/microsoft/vscode-codicons) --
the very same icon set Visual Studio Code itself renders its UI with. We bundle
the built font verbatim so that Haze applications get VS Code's icon language
for free, without anyone having to redraw it, and without a runtime download or
a font dependency on the host system.

Bundled from the published npm package `@vscode/codicons`, version
**0.0.46-24** (font internally versioned "codicon Version 1.15").

| File | What it is |
| --- | --- |
| `codicon.ttf` | The TrueType icon font, unmodified. 630 icons (631 glyphs incl. `.notdef`), `unitsPerEm` 300, mapped into the Unicode Private Use Area, U+EA60 through U+ECE7. SHA-256 `3819e4ae4b87350e7c37a5d8f24e71ada2f1f2ee58f7ce5ebc1f88e3c8c38c80`. |
| `codicon.csv` | The upstream `short_name,character,unicode` mapping -- how you get from an icon name like `chevron-right` to the codepoint you render. Also unmodified. |
| `LICENSE-codicons-CC-BY-4.0.txt` | Upstream `LICENSE`: Creative Commons Attribution 4.0 International. |
| `LICENSE-codicons-MIT.txt` | Upstream `LICENSE-CODE`: MIT. |

## Licensing

Microsoft dual-licenses that repository, and the split is by *kind of thing*,
not by file:

> Microsoft and any contributors grant you a license to the Microsoft
> documentation and other content in this repository under the
> [Creative Commons Attribution 4.0 International Public License](https://creativecommons.org/licenses/by/4.0/legalcode),
> see the [LICENSE](https://github.com/microsoft/vscode-codicons/blob/main/LICENSE) file,
> and grant you a license to any code in the repository under the
> [MIT License](https://opensource.org/licenses/MIT), see the
> [LICENSE-CODE](https://github.com/microsoft/vscode-codicons/blob/main/LICENSE-CODE) file.

So: **the icons themselves -- and therefore `codicon.ttf` and `codicon.csv`,
which are just the icons in a shipping format -- are content, and are covered
by CC BY 4.0.** MIT covers the build scripts and tooling in that repo, which we
do not ship. Copyright (c) Microsoft Corporation.

CC BY 4.0 is a permissive license: it allows redistribution and use, including
commercially, in original or modified form. Its one substantive condition is
attribution -- which is what this file is for. Anything that ships this font
should carry this notice, or an equivalent credit naming Microsoft and the
CC BY 4.0 license, somewhere a user can find it (an About box, a licenses
screen, or the distributed source tree). The rest of the `ui_widgets` package
is MIT, per its `haze.toml`, and the two coexist fine: bundling CC BY 4.0 content
inside an MIT-licensed package does not relicense either one.

Trademarks are explicitly *not* granted. The Microsoft-branded glyphs in this
font (`vscode`, `github`, `azure`, `microsoft`, `copilot`, ...) depict logos
that remain Microsoft or third-party trademarks; the font license does not give
anyone permission to use those marks as marks. Rendering them as UI icons for
the thing they denote is ordinary nominative use; putting them on your own
product is not. See
<https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks>.

## Updating

`dist/` is gitignored upstream, so the font is not fetchable from the GitHub
repo -- take it from the npm tarball:

```sh
curl -sSL -o codicons.tgz \
  "https://registry.npmjs.org/@vscode/codicons/-/codicons-<version>.tgz"
tar xzf codicons.tgz
cp package/dist/codicon.ttf package/dist/codicon.csv .
cp package/LICENSE LICENSE-codicons-CC-BY-4.0.txt
cp package/LICENSE-CODE LICENSE-codicons-MIT.txt
```

Then update the version, the SHA-256, the glyph count and the codepoint range in
the table above. Codepoints are stable across upstream releases; new icons get appended.
