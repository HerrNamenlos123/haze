# hzui SFC — VS Code syntax highlighting

Language support for hzui single-file components (`.hzui`). Contributes the
`hzui` language and a grammar that embeds the base haze extension's
`source.hz` grammar (which must be installed) without modifying it:

- `@props` / `@emit` / `@slot` / `@setup` / `@template` section markers
- `@font <name> [<expr>]` directives, with the bound name and the expression
  highlighted separately -- recognised anywhere in the file, including inside
  `@template` and `@props`, since the directive never ends a section
- template syntax: element/component heads, attrs, `@event=`, `if=`/`for=`,
  `slot` / `#slot`
- tailwind-style class brackets, with `[expr]` arbitrary values highlighted
  as real haze expressions and unit suffixes (`px`/`em`/`%`)

Everything outside `@template` (prelude, `@setup`, ...) keeps ordinary haze
highlighting from the base grammar.

Build & install:

    cd stdlib/hzui/vscode
    npx @vscode/vsce package --allow-missing-repository
    code --install-extension hzui-0.0.1.vsix --force

If you use VS Code *profiles*, install into the profile the workspace runs
under (the CLI installs into the default profile otherwise, and the running
window will never see it):

    code --profile Haze --install-extension hzui-0.0.1.vsix --force

Kept deliberately separate from the core haze extension: every framework can
ship its own injection grammar this way, and the base extension never
accumulates project-specific rules.
