# Haze SFC & Compiler Plugin System — Scope

Status: **design accepted, not started**. Companion file: [sfc-button-lowered.hz](sfc-button-lowered.hz)
— the hand-lowered output for the reference button SFC, verified to compile against the
current runtime (swapped into `ui_widgets`, built clean).

---

## 1. Goals

- Vue-3-SFC-class ergonomics for UI components, in natively compiled haze. Sections, props,
  slots, emits, reactive declarative templates.
- Tailwind-class styling ergonomics: whitespace-separated tokens, arbitrary values, variants —
  lowered at compile time to the existing zero-alloc preset/op system. No string parsing at runtime.
- The SFC compiler is a **plugin of the haze compiler**, not a wrapping compiler. It cooperates
  with the real parser; it never reimplements the language.
- Plugins are eventually **written in haze**, shipped inside library packages, and activated by
  a single dependency line in the consumer's `haze.toml`. From-scratch time-to-button must be
  very low.
- The same plugin system later carries formatting and linting, including the full type-aware
  (typescript-eslint-class) rule surface.

## 2. Non-goals

- **HTML compatibility.** Deliberately distant from HTML; we are not inheriting browser baggage.
- **A second compiler.** No embedded grammars, no reimplementation of expressions, no
  parser-in-parser.
- **AST/semantic mutation APIs for plugins.** Ever (see §6). Writes are text; reads are queries.
- **Plugin-to-plugin composition / ordering semantics** (v1: one plugin per file, disjoint claims).

---

## 3. The SFC file format

### 3.1 Sections

SFC files use the **`.hzui`** extension. A file is split by **line-anchored, open-only
markers**: a line matching `^@(props|emit|slot|setup|template)` starts a section; the next
marker ends it. No closing markers, no brace counting — splitting is a single regex pass with
**no parsing**. Each section at most once; `@props`/`@emit`/`@slot` in any order, then
`@setup`, then `@template`:

```
<prelude>     plain haze, verbatim: imports, exported types (Vue's plain <script>)
@props        struct-body syntax: fields with defaults
@slot         name: { payload fields }   (scoped-slot payload type)
@emit         name: (ArgTypes,)
@setup        plain haze, verbatim (Vue's <script setup>)
@template     template syntax (§3.2) — the only section with its own (token-level) grammar
```

`@template` takes an optional component-box class list: `@template [w-fit grow?w-grow h-fit]`
(lowers to `componentSize()`; replaces manual sizing calls).

### 3.2 Template syntax

Element head, fixed order — every element reads identically:

```
tag  if=/for=  [class-tokens]  attrs  content  { children }
```

- **Head boundary:** the head ends at the first `{` at bracket-depth 0.
- **Strict value rule (template-wide, LOCKED 2026-08-23):** every attribute value, event
  handler, `if=`/`for=`/`key=` value, class-token condition, and content expression is exactly
  one of: a **single identifier** (`enabled`, `!grow`, `clicked`), a **string literal**, a
  number, or a **bracketed `[expression]`**. Member access, calls and operators MUST be
  bracketed: `[props.grow]?w-grow`, `label=[props.label]`, `if=[label.length > 0]`,
  `text [w-4] [s.label]`. Enforced by the transformer (error names the fix) and shown by the
  grammar (dotted bare values render as `invalid.illegal`). Rationale: the head stays
  tokenizable without an expression parser, and the rule is visible at a glance.
- **Content vs class list:** the first `[ ]` group after the tag/control attrs is the class
  list; a later `[ ]` group is the content expression. `text [expr]` is therefore a class
  list — write `text [] [expr]` for bracketed content without classes (rare; identifiers and
  strings need no brackets).
- **Control flow:** `if=` / `else-if=` / `else` / `for=[item in items] key=expr` as attributes
  (v-if/v-for). Plain haze `if`/`for` statements also pass through (immediate-mode escape hatch),
  but see the no-logic lints below.
- **Events:** `@pointerdown=clicked` → `onPointerDown: clicked`.
- **Components:** capitalized head = component, lowercase = builtin element (bet-and-verify, §6.2).
- **Slots:** child side renders with fallback: `slot content label=label { ...fallback... }`.
  Parent side provides: `#content label { ... }` (payload destructure; may be omitted). A bare
  child block on a component is the default slot.
- **Text:** content is the trailing token: `text [tokens] label`.

### 3.3 Class tokens

Whitespace-separated only — no commas, no quotes, no parens between tokens.

- `row`, `gap-0`, `cross-align-center` — static token → preset call (`presets.row()` …).
  Lowering is a **naming rule** (`px-2` → `px(2)`, `w-fit` → `wFit()`), not a table: the real
  compiler resolves the call, and any `export fn` in a preset namespace is automatically a token.
- **Scale numbers:** `gap-0`, `p-4`, `w-2.5` — any integer or float; the preset applies the
  Tailwind spacing scale (`headwind.computeSize`, 4px per unit). Fractions (`w-1/2`) are
  rejected until `Size` gains a percent variant.
- **Explicit values:** `[ ]` holds a real haze expression, spliced verbatim. With a **unit
  suffix** (outside the bracket — the bracket is an expression, not a string) it is an explicit,
  never-scaled length: `px` → `ui_styling.Px`, `em` → `Em` (× the element's own
  font size, or the root size if none is set — so put `font-size` tokens first), `rem` → `Rem`
  (× `ui_styling.rootFontSize` = 16, matching ui_layout). Presets take these via `Length`
  overloads (`p(real)` scale vs `p(Length)` explicit) — p/px/py/pt/pr/pb/pl, gap, w, h,
  rounded, font-size. **No unit = raw expression**, passed through untouched — the preset
  decides its meaning (`bg-[color]`, `p-[n]` = scale). Table-free like Tailwind: the plugin
  cannot know which tokens are lengths, so explicit lengths carry their unit. IMPLEMENTED
  2026-08-24.
- **Conditionals:** `cond?token` — cond is a single bool identifier (bare `!` negation allowed)
  or `[expr]` (member access must be bracketed, per the strict value rule). Lowered to `cond ? op : noop()`. Combined with last-wins merge, no else-branch is
  needed: `w-fit grow?w-grow`.
- **State variants:** `hover:`/`active:`/`focus:` prefix — lowered against the element's own
  (auto-generated) elementRef: `hover:bg-[style.bgHover]` → `ref.hover() ? op : noop()`.
  `:` means *element state*, `?` means *arbitrary condition* — never mixed.
- **Merging is last-wins per field** (Tailwind semantics) — IMPLEMENTED 2026-08-24 in
  `ui_styling.applyDivOp`/`applyTextOp`; explicit `style:` fields still win over every preset
  (ops apply onto an empty style, explicit fields are overlaid afterwards). Padding is a single
  `PaddingOp` with optional per-side `Length` fields, so `p-4 px-2 pb-1` composes by side and
  `px-2 p-4` is overridden by `p-4`. Tokens are emitted in source order (no reversal).
- **`class` passthrough:** every component implicitly accepts a `class` prop (`[]Op`, plain
  stack data, compared by generated `!=`); the child splices it with a literal `class` token at
  the position of its choice. This + variants + theme tokens is intended to replace per-component
  style structs entirely (long-term direction; `ButtonStyle`-like structs remain possible).

### 3.4 IDs

Never written in SFCs. Every element automatically gets a **sequential id within its enclosing
scope**, assigned in source order by the transformer (matches the existing per-parent id
scoping). Sole exception: inside a loop, `key=expr` is **required on all direct children** —
enforced by the transformer; runtime id = `hash(staticId, key)`. Explicit `id=` remains for the
imperative API only.

Known limitation (accepted): inserting an element renumbers later siblings in that scope, which
shifts ids across an edit. Hot reload will need runtime handling for id shifts — explicitly out
of scope for now.

### 3.5 Name resolution & reactivity semantics

- **Props are bare identifiers everywhere** — in `@setup` and `@template` alike, so code moves
  between them by copy-paste. Use-site rewrite to a live read (`label` →
  `instance.props().label`), shadowing respected (core capability, §6.3). `props.x` stays legal
  as the explicit form.
- **Emits:** `@emit click: (MouseEvent,)` generates an `onClick?:` prop and a real method
  called as `<emitName>.click(e)` (null-check inside). Checked by the ordinary compiler — no
  string-based `emit("click", …)`. Note: `emit` currently appears in the lexer
  ([HazeLexer.g4:30](../src/Parser/grammar/HazeLexer.g4#L30)) but that is a leak, not a language
  keyword — do not rely on it. v0 uses different (non-colliding) dialect names for the props and
  emit accessors; final naming TBD after the lexer leak is removed.
- **Computeds auto-unwrap:** bare `isActive` in value position reads the value (tracking read
  inside `computed()` bodies); passing where `Computed<T>` is expected passes the handle
  (type-directed, §6.3).
- **Snapshot-read error:** a bare prop or computed read at setup top level (outside any
  closure/computed) is a compile error, not a documented gotcha.
- **Template purity lints:** no lambda literals, no `let` in `@template` — logic lives in setup.
  Templates must not allocate.
- **Generated `operator!=`** compares exactly the `@props` fields; emits/slots (closures) are
  excluded by construction. Field-wise equality for plain prop structs is generated in-language
  via `for comptime field in T.fields` (pattern already used in
  [reactive.hz:53](../stdlib/core/src/reactive.hz#L53)) — no core feature needed.
- **Dialect vocabulary** (`computed`, `elementRef`, `props.`, `slots.`, `emits`) is reserved by
  the SFC dialect and forwarded by fixed **textual rewrite** (`computed(` → `rx.computed(`,
  `elementRef` → `ui.elementRef`): haze has no generic function values (`let computed =
  rx.computed;` fails with "expects 1 type parameters"), so forwarding by variable assignment is
  not possible. Users cannot shadow these names in SFC files.

---

## 4. Lowering contract

The plugin composes one syntactically valid haze file: verbatim sections spliced between fixed
boilerplate, template lowered to `ui.div`/`ui.text`/component calls with preset arguments.
[sfc-button-lowered.hz](sfc-button-lowered.hz) is the normative example (compiles today), with
`//@plugin:` notes at each decision: generated Props struct + `!=`, slot payload struct, emit
struct, auto ids, slot/fallback lowering, usage-side lowering.

**Source locations use the `#source` directive — IMPLEMENTED (2026-08-23), in both parsers.**
The directive now has two modes and three positions:

- **Pin mode** (historical): `#source "path:line:col[-endcol][.endline]" { ... }` — every node
  inside reports exactly that span. Used by generated `import.hz` and by the SFC transformer
  for lowered template statements (pointing at the element head).
- **Offset mode** (new): `#source "path:line" { ... }` — line-map semantics like C's `#line`:
  the first line after the directive corresponds to `line`, subsequent lines shift with it,
  columns pass through unchanged. Used for verbatim sections (prelude/props/setup), which are
  spliced at their original indentation so columns stay exact.
- **Positions**: global declarations (incl. imports), struct content, and **statements** — all
  three grammar positions exist in the ANTLR grammar (as dedicated rules, since parse-time
  listeners never receive enter events for labeled alternatives — the pre-existing
  struct-content directive was silently broken for exactly that reason in the ANTLR path, and
  entirely missing in the native parser) and in `compiler/haze-parser`.
- **Relative paths** resolve against the directory of the file being parsed (ANTLR:
  `computeSourceLoc`; native: the bridge's revive walk). The transformer emits just the
  basename, since transform output is parsed under the original filepath.

Verified end-to-end: an SFC compiled through the dev compiler reports setup errors, template
errors, and props errors at their original file:line:column (column-exact for verbatim
sections); `--parser assert` confirms both parsers produce identical ASTs. Diagnostics needed
**zero sink changes**. The LSP may later want a reverse map (SFC position → generated position)
for completions; not needed for diagnostics.

---

## 5. Runtime / stdlib changes required (found by compiling the lowered file)

1. ~~Op merge order~~ DONE 2026-08-24: runtime is last-wins per field, explicit style wins.
2. ~~Granular padding~~ DONE 2026-08-24: `PaddingOp` has optional per-side `Length` fields;
   `Length = Px | Em | Rem` with `resolveLength`; `WidthLengthOp`/`HeightLengthOp`/`RoundedOp`/
   `FontSizeLengthOp` for explicit sizes; headwind aliases for the mechanical naming rule
   (`textNowrap`, `crossAlignCenter`, `itemsCenter`, …).
3. **`class` passthrough prop:** `[]DivStyleOp`-typed prop + splice token support.
4. **Hover/active variants:** auto elementRef per styled element + conditional ops (no new
   runtime primitives; lowering only).
5. **`key=` id hashing helper** (small runtime function).

Each is day-scale.

---

## 6. Plugin architecture

### 6.1 Principle

**Hard rule: the compiler core MUST NOT know anything specific to UI/SFC files.** It implements
only a generic plugin interface (registration, routing, transform invocation, diagnostics,
caching). Everything UI-specific — markers, sections, template grammar, class tokens, id rules —
is defined entirely by the UI plugin. If a core change is ever needed, it must be a *generic*
capability (annotation, conversion rule, query), never an SFC-shaped one.

**Writes are text. Reads are queries. Semantics stay in core.**
A plugin never sees or mutates compiler internals mid-elaboration. Precedents this shape is
copied from: Rust proc-macros (tokens in, source out — survived a decade of internal churn),
typescript-eslint (full type-aware ruleset on a read-only checker API), libclang (stable
handle-based C API over a churning compiler).

### 6.2 The four tools of a transform plugin (in strict preference order)

1. **Inject declarations, never rewrite uses.** Make names resolve by emitting a prelude into
   the generated scope; the compiler's scoping handles shadowing.
2. **Bet and verify.** Generate by syntactic convention (capitalized = component; untyped slot
   closure params bound by inference) and let the type system check the bet — errors are
   source-mapped back. Use comptime (`static_assert`, `meta`, `T.fields`) *in the generated
   haze* for first-class diagnostics and derives: the target language's comptime is the plugin's
   semantic engine.
3. **Core declarative capabilities** (small, slow-growing list; each must be defensible as a
   language feature): `@[component_props(T)]` resolution fallback, `Computed<T>` value
   conversion, snapshot-read/template-purity lints.
4. **Downward queries.** During transform, a plugin may run read-only queries against its
   **dependencies** (already fully compiled by build order — answers exact, no staleness), never
   against the package being transformed. Same-package decisions use tools 1–3. A
   previous-snapshot escape hatch for same-package semantic generation is explicitly deferred
   until a real plugin demonstrates the need.

### 6.3 Capabilities

- **`transform`** — pre-parse, `(filename, source) → source'` (with `#source` directives
  embedded; errors thrown as plugin errors). Pure; cached by `(pluginHash, sourceHash)` in the
  existing build cache. Hook point: between `readFile` and `Parser.parseTextToASTAsync` in
  [ModuleCompiler.ts](../src/ModuleCompiler/ModuleCompiler.ts) (`collectFile`,
  `collectFileAsRoot`, `collectDepFile`) — the single choke point all ingestion funnels through;
  `scanProjectSourceFiles` registration gives modification watching. Per-file purity is what
  keeps single-file incremental compiles and hot reloading possible later.
- **`analyze`** — post-elaboration, read-only, handle-based query API (opaque node/symbol/type
  ids; `type_of`, `symbol_of`, `is_assignable`, walk, …; start with the ~15 queries
  typescript-eslint's top rules use; additive-only versioning). Emits diagnostics + **fix-its as
  text edits** (same write currency). Can fail the build; can never change what compiles. Powers
  type-aware lint and LSP squiggles (same process, same API).
- **`format`** — CST/token level, no types. Requires a lossless (trivia-preserving) token
  stream; whoever claims a marker owns formatting for its syntax (the SFC plugin formats
  `@template`).

### 6.4 Packaging & activation (v0 — LOCKED)

Registered dependency-style in the consuming module's `haze.toml`; this single line enables
everything:

```toml
[plugins]
hzui = { path = "stdlib/hzui" }    # name is irrelevant for now
```

- **Non-inheriting:** a plugin applies only to the source files of the module that declares it.
  A dep built from SFCs declares the plugin in its own `haze.toml`.
- **Routing — `.hzui` (decided 2026-08-23):** SFC files use the `.hzui` extension. Plugins
  declare the extensions they claim (`extensions: [".hzui"]`); the compiler collects claimed
  extensions as module sources exactly like `.hz` (discovery, watching, hashing) and routes
  every source file through the loaded plugins. The hzui plugin claims `.hzui` only — plain
  `.hz` files are never touched; a `.hzui` file without section markers is an error. The core
  knows nothing about `.hzui` itself, only about the registry.
- **Diagnostics:** no per-plugin error-code registry — codes can't be unique across plugins
  anyway. A plugin throws/returns a plugin error carrying its name and a message string; the
  compiler surfaces it under one generic plugin-error code, located via `#source`.
- One plugin per file (first claimer wins is a config error; keep claims disjoint).

Phase 1 keeps this schema and adds `entry` for haze-written plugins and optional
`capabilities = ["transform", "analyze", "format"]`.

### 6.5 Build lifecycle

1. Resolve dependency graph → collect `[plugin]` declarations.
2. Build plugin packages **with plugins disabled** (a plugin is plain haze — keeps the build
   graph acyclic). Shared-lib target (`.so`), cached; registries may ship prebuilt binaries per
   target.
3. `dlopen` via `bun:ffi`. C ABI: `hz_plugin_manifest()`, `hz_plugin_transform(in, len, out*)`,
   `hz_plugin_free(buf)`; JSON-over-buffers; plugin allocates, compiler frees via the plugin.
4. Compile project: routed files pass through `transform` (cached) before
   [NativeParser](../src/Parser/NativeParser.ts); generated annotations/comptime do the semantic
   work during normal elaboration; every diagnostic passes through the lineMap before the single
   sink in [Errors.ts](../src/shared/Errors.ts).
5. LSP ([lsp.ts](../src/lsp.ts)) runs in-process: same transform, same lineMap, same query API.

**Trust:** a plugin is native code at build time — same trust level as depending on the library;
pin plugin binaries by hash in the lockfile.

---

## 7. Infrastructure ledger (phased; LOC ≈ new code; Elaborate.ts alone is 18.5k)

### Phase 0 — SFC end-to-end, in-tree TS pass behind the plugin interface (~3–4k)

| # | Piece | Where | ~LOC |
|---|-------|-------|-----|
| 1 | Transform interface + marker routing | NativeParser.ts | 150 |
| 2 | Section splitter + composer (line-preserving) | new | 500 |
| 3 | Template lowerer (the core) | new | 1,500 |
| 4 | Source locations via existing `#source` directive | (composer output) | ~0 |
| 5 | `@[component_props]` resolution fallback | Elaborate.ts | 200 |
| 6 | `Computed<T>` unwrap + snapshot-read error | Conversion.ts/Elaborate.ts | 200 |
| 7 | Template purity lints | composer/Elaborate | 100 |
| 8 | Stdlib items of §5 | ui_styling/headwind | 400 |

Deliverable: `button.hz` as an SFC compiles and runs; errors point at SFC lines.
**"Does it feel good" is answered here, before any FFI exists.**

### Phase 1 — plugins as haze packages (~3–4k)

| # | Piece | ~LOC |
|---|-------|-----|
| 9 | `[plugin]` manifest + build orchestration (plugins-off plugin builds, routing table) | 300 |
| 10 | Shared-lib build target + C-ABI exports | 300 |
| 11 | dlopen host (bun:ffi, JSON marshaling, free protocol) | 300 |
| 12 | Transform cache integration | 150 |
| 13 | Port composer + lowerer to haze (TS pass becomes golden test — byte-identical output) | 2–3k haze |

Deliverable: the two-line story; `haze add hazeui` → write an SFC → it works.

### Phase 2 — `analyze`: type-aware lint (~1.5–2k)

| # | Piece | ~LOC |
|---|-------|-----|
| 14 | Handle-based query veneer (~15 queries, additive versioning) | 1,000 |
| 15 | Fix-it plumbing (Errors.ts + LSP code actions) | 300 |
| 16 | Downward queries during transform | 200 |

### Phase 3 — `format` (wildcard)

Token-level formatter ~1–3k, **gated on** whether the parser's token stream is losslessly
round-trippable (trivia/comments). Scope separately before promising.

**Headline:** ~4k to a working SFC, ~7–8k to the self-hosted plugin system, ~10k with type-aware
linting.

---

## 8. Decision log

| Decision | Choice | Why |
|---|---|---|
| Section markers | line-anchored, open-only, fixed order | split without parsing; closer is redundant |
| Class separator | whitespace only | the actual reason Tailwind feels good |
| Dynamic values | `token-[expr]unit`, unit outside bracket | bracket holds an expression, not a string |
| `?` vs `:` in tokens | `?` = arbitrary bool, `:` = element state | never ambiguous; last-wins removes else |
| Merge order | last-wins | Tailwind semantics; enables `w-fit grow?w-grow` and `class` overrides |
| Emit call form | `<emitName>.click(e)` method (names TBD; `emit` lexer entry is a leak, not a keyword) | checked by the ordinary compiler; no string dispatch |
| Plugin registration | `[plugins] name = { path = "…" }`, dependency-style, non-inheriting | one line enables everything; compiler core stays UI-agnostic |
| Plugin errors | one generic code + plugin name + message string | codes can't be unique across plugins |
| Source mapping | `#source` with pin + offset (line-map) modes, at global/struct/statement positions, relative paths | implemented in both parsers; zero diagnostic-sink changes |
| File extension | `.hzui`, registered by the plugin (`extensions`), collected like `.hz` by the core | unambiguous routing; editor language id; core stays extension-agnostic |
| Section order | `@props`/`@emit`/`@slot` any order, then `@setup`, then `@template` | matches how drafts were actually written |
| Editor support | separate grammar-only VS Code extension `stdlib/hzui/vscode` (language `hzui`, embeds `source.hz`) | base haze extension never accumulates project-specific rules |
| Slot fallback | `slot name { fallback }` (Vue semantics) | dissolves `if slots.x { slots.x() }` |
| Prop access | bare identifiers in setup **and** template | copy-paste between sections; explicit `props.x` remains |
| IDs | auto (source order) + mandatory `key=` in loops | biggest ergonomic gotcha removed |
| Plugin write access | text only (transform output / fix-it edits) | prevents a second compiler; proc-macro lesson |
| Plugin read access | handle-based queries, post-elaboration + downward at transform time | typescript-eslint/libclang precedent; no staleness for deps |
| Semantic hooks in plugins | **never** | each need becomes a core annotation or comptime pattern instead |
| Plugin language | haze (Phase 1), TS reference first | prove interface + ship feature before FFI; TS pass becomes the golden test |
| Style structs (`ButtonStyle`) | long-term replaced by `class` passthrough + variants + theme tokens | components stop inventing per-component knob vocabularies |

## 9. v0 implementation subset (locked)

In: sections/markers, class tokens + `[expr]` values + `?` conditions, attrs/events, `if=` /
`else-if=` / `for=` + mandatory `key=` on all direct loop children, slots (both sides, scoped
payloads), auto ids, generated Props/`!=`/emit/slot structs, `#source`-mapped diagnostics.
Explicit dialect-prefixed access (`props.x`-style, final names TBD) — bare-name unwrapping ships
later with the core annotation, as a pure relaxation.

Out (pure lowering additions later, no design debt): `hover:`/`active:` variants, `class`
passthrough, theme tokens, bare prop identifiers, `analyze`/`format`, FFI/haze port.

Owner: user implements the transformer and writes the generation spec; the compiler side is the
generic plugin interface only (registration, routing, invocation, plugin errors, cache keys,
watch registration).

## 10. Open questions

- `use`/alias language feature for functions (nice-to-have; dialect-reserved names cover v0).
- Theme tokens (`bg-surface-hover`): compile-time theme table design — where declared, how
  resolved.
- Trivia preservation in the current ANTLR token stream (gates Phase 3).
- Exact annotation syntax for core capabilities (`@[...]` used throughout this doc as placeholder).
- Whether `cond?a:b` (inline else) is allowed in class tokens, or last-wins only (current lean:
  last-wins only, keep `:` unambiguous).
