# claude_ui

Reactive UI components over [`stdlib/claude`](../claude/README.md), built with
hzui. Import it alongside hzui; it adds components, nothing else.

```toml
[dependencies]
hzui = { path = "../stdlib/hzui" }
claude_ui = { path = "../stdlib/claude_ui" }

[plugins]
hzui = { path = "../stdlib/hzui" }
```

## The bridge

`claude.Session` is a POLLED model: it drains a pipe when asked and mutates a
conversation in place. A reactive tree is the opposite — it rebuilds when a
cell it read was written. `Chat` is where the two meet, and deliberately the
only place they do: every component here reads `Chat.revision` and nothing
else, so no view knows a subprocess exists.

```haze
let session = claude.start({ cwd: projectDir });
assert(session);

// The prompt handle is YOURS. Bind it to a cache file and a half-typed
// prompt survives a reload, a crash and a closed window.
let cache = json.CacheFile<Draft>(cachePath);
let chat = claude_ui.Chat(session, cache.data.prompt);
```

`ClaudeChat` pumps it (`Chat.poll()` once per frame) and everything below is a
pure view. Mount it once per chat:

```
ClaudeChat [] chat=chat {}
```

Nothing in this module owns anything you might want to own. The session is
handed in already spawned — its model, tools, account and working directory
are yours to decide — and so is every text handle.

## The components

| | |
|---|---|
| `ClaudeChat` | the whole panel: log, blocking question, composer, model picker |
| `ClaudeMessage` | one message |
| `ClaudeBlock` | one content block: text, thinking, or a tool call and its result |
| `ClaudeAsk` | the question blocking the agent: a choice, a plan, or a tool |
| `ClaudeSignIn` | the OAuth flow, both paths |

Every one is exported and usable on its own; `ClaudeChat` is a composition and
nothing more. A host that wants a different arrangement builds one out of the
same pieces rather than fighting it.

### Feedback goes through the composer

"No, do it this way" is the answer that matters most, and it is prose, not a
button. `ClaudeAsk` therefore takes the handle the composer is already bound
to: whatever is typed there becomes a denial's reason or a plan's comments,
and is cleared once it has been sent. One place to type, and that draft is as
safe as the prompt is.

### Why a revision prop

A `ref struct` cannot be compared, so a component whose prop is a live
`Message` or `ContentBlock` cannot tell that it changed. Each level therefore
also takes a `revision: int` — `messageFingerprint(message)` /
`blockFingerprint(block)` — which is what re-runs its template. Because it is
per block, a streaming reply re-renders the one block that is growing.

## Allocation

Measured with `GC_get_total_bytes` (`claude.totalAllocatedBytes()`), not
asserted by inspection:

| | |
|---|---|
| an idle poll | **0 bytes** |
| an idle frame (the whole panel) | **0 bytes** |
| every read a view makes | **0 bytes** |
| a redraw of one block | **0 bytes** |
| a redraw of the whole panel | ~207 bytes |

`Chat.visibleMessages()` refills a shared buffer rather than building a list,
`models()` tracks a separate `handshake` cell so a picker's options are not
rebuilt per token, and every stored closure is bound in `@setup` — a capturing
closure is a heap allocation and a template re-runs on every token.

Those remaining bytes are ONE allocation, and not this module's: the heap env
of the `#content` slot closure the SFC transformer writes inline into the
template. Removing the ScrollView from `ClaudeChat` takes a full redraw to 0
bytes; hoisting non-loop slot closures into the setup body would fix it here
and everywhere else slots are used.

`Chat` and `Login` are plain structs, not `ref struct`s: they hold nothing but
handles, so a copy is the same object and a heap cell would buy nothing. Bind
one to a local in `@setup` rather than reaching through `props` per use — a
method on a value struct needs an lvalue.

## What is not here yet

Tool diffs (`claude.toolDiff` returns them; nothing draws them), transcript
and session history, profile management beyond the sign-in flow, todos,
context/cost meters, attachments, multi-select answers to `AskUserQuestion`
(one label per question is sent), and subagent nesting (a `Task`'s output is
drawn as an ordinary tool call).
