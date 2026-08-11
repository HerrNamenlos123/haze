import fs from "fs";
import vsctm, { type IRawGrammar } from "vscode-textmate";
import oniguruma from "vscode-oniguruma";
// `with { type: "file" }` makes Bun embed this asset into standalone
// executables built via `bun build --compile`, and resolves to a real,
// readable path both when run as a script and inside the compiled binary.
// A plain fs.readFileSync(path.join(import.meta.dirname, ...)) does NOT
// work once compiled, since import.meta.dirname then points into Bun's
// virtual bundle filesystem, which doesn't contain node_modules.
import onigWasmPath from "./node_modules/vscode-oniguruma/release/onig.wasm" with {
  type: "file",
};
// import mocha from "@catppuccin/vscode/themes/mocha.json" with { type: "json" };

// https://github.com/shikijs/textmate-grammars-themes

enum Error {
  UnknownError,
  InvalidMethod,
}

function errorMessage(error: Error) {
  switch (error) {
    case Error.UnknownError:
      return "Unknown Error";
    case Error.InvalidMethod:
      return "Invalid Method";
  }
}

// ── Grammar / registry: built ONCE ────────────────────────────────────
//
// This used to happen inside highlight(), i.e. on every single request:
// the oniguruma WASM was re-read from disk, a fresh Registry was built,
// and every grammar JSON was re-parsed. That dominated the cost of
// highlighting and is why re-highlighting on each keystroke was not
// viable. Now it is done once, lazily, and reused.
//
// The registry is separate from the grammars it produces, because a
// document is not always Vue: an editor buffer is, but a hover popup's
// contents are a TypeScript signature, a JSON file is JSON, and so on.
// Each top-level scope is loaded on first use and cached under its own
// name, all sharing the one registry (and therefore the one oniguruma
// WASM instance and the one parsed copy of each embedded grammar).
let registryPromise: vsctm.Registry | null = null;
const grammarPromises = new Map<
  string,
  Promise<vsctm.IGrammar | undefined>
>();

// The scope a document is parsed with when the client doesn't name one.
// Vue, because that is what this editor is for and what every previously
// existing caller expected before `scopeName` was a parameter at all.
const DEFAULT_SCOPE = "source.vue";

function getRegistry(): vsctm.Registry {
  if (registryPromise) {
    return registryPromise;
  }
  const wasmBin = fs.readFileSync(onigWasmPath).buffer;
  const vscodeOnigurumaLib = oniguruma.loadWASM(wasmBin).then(() => {
    return {
      createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
      createOnigString: (s) => new oniguruma.OnigString(s),
    };
  });

  const registry = new vsctm.Registry({
    onigLib: vscodeOnigurumaLib,
    loadGrammar: async (
      scopeName: string
    ): Promise<IRawGrammar | undefined> => {
      if (scopeName === "source.vue") {
        const data = await import("./languages/vue.tmLanguage.json", {
          with: { type: "json" },
        });
        return { ...data.default } as any;
      }
      if (scopeName === "source.ts") {
        const data = await import("./languages/ts.tmLanguage.json", {
          with: { type: "json" },
        });
        return { ...data.default } as any;
      }
      if (scopeName === "source.json") {
        const data = await import("./languages/json.tmLanguage.json", {
          with: { type: "json" },
        });
        return { ...data.default } as any;
      }
      if (scopeName === "source.css") {
        const data = await import("./languages/css.tmLanguage.json", {
          with: { type: "json" },
        });
        return { ...data.default } as any;
      }
      if (scopeName === "text.html.basic") {
        const data = await import("./languages/html.tmLanguage.json", {
          with: { type: "json" },
        });
        return { ...data.default } as any;
      }
      if (scopeName === "text.html.markdown") {
        const data = await import("./languages/markdown.tmLanguage.json", {
          with: { type: "json" },
        });
        return { ...data.default } as any;
      }
      if (scopeName === "text.html.derivative") {
        const data = await import(
          "./languages/html-derivative.tmLanguage.json",
          {
            with: { type: "json" },
          }
        );
        return { ...data.default } as any;
      }
      if (scopeName === "text.pug") {
        const data = await import("./languages/pug.tmLanguage.json", {
          with: { type: "json" },
        });
        return { ...data.default } as any;
      }
      if (scopeName === "source.stylus") {
        const data = await import("./languages/stylus.tmLanguage.json", {
          with: { type: "json" },
        });
        return { ...data.default } as any;
      }
      if (scopeName === "source.postcss") {
        const data = await import("./languages/postcss.tmLanguage.json", {
          with: { type: "json" },
        });
        return { ...data.default } as any;
      }
      if (scopeName === "source.sass") {
        const data = await import("./languages/sass.tmLanguage.json", {
          with: { type: "json" },
        });
        return { ...data.default } as any;
      }
      if (scopeName === "source.css.scss") {
        const data = await import("./languages/scss.tmLanguage.json", {
          with: { type: "json" },
        });
        return { ...data.default } as any;
      }
      if (scopeName === "source.css.less") {
        const data = await import("./languages/less.tmLanguage.json", {
          with: { type: "json" },
        });
        return { ...data.default } as any;
      }
      if (scopeName === "source.js") {
        const data = await import("./languages/javascript.tmLanguage.json", {
          with: { type: "json" },
        });
        return { ...data.default } as any;
      }
      if (scopeName === "source.js.jsx") {
        const data = await import("./languages/jsx.tmLanguage.json", {
          with: { type: "json" },
        });
        return { ...data.default } as any;
      }
      if (scopeName === "source.tsx") {
        const data = await import("./languages/tsx.tmLanguage.json", {
          with: { type: "json" },
        });
        return { ...data.default } as any;
      }
      if (scopeName === "source.coffee") {
        const data = await import("./languages/coffee.tmLanguage.json", {
          with: { type: "json" },
        });
        return { ...data.default } as any;
      }
      if (scopeName === "source.json5") {
        const data = await import("./languages/json5.tmLanguage.json", {
          with: { type: "json" },
        });
        return { ...data.default } as any;
      }
      if (scopeName === "source.yaml") {
        const data = await import("./languages/yaml.tmLanguage.json", {
          with: { type: "json" },
        });
        return { ...data.default } as any;
      }
      if (scopeName === "source.toml") {
        const data = await import("./languages/toml.tmLanguage.json", {
          with: { type: "json" },
        });
        return { ...data.default } as any;
      }
      if (scopeName === "source.graphql") {
        const data = await import("./languages/graphql.tmLanguage.json", {
          with: { type: "json" },
        });
        return { ...data.default } as any;
      }
      // console.log(`Unknown scope name: ${scopeName}`);
      // Bun.spawnSync([
      //   "zenity",
      //   "--info",
      //   "--text=Unknown scope name: " + scopeName,
      // ]);
    },
  });

  registryPromise = registry;
  return registry;
}

// The grammar for one top-level scope, loaded on first use and cached
// under its own name. Everything the registry's own loadGrammar() knows
// about is reachable here, so a caller naming e.g. "source.ts" gets a
// TypeScript grammar rather than a Vue one that would treat a bare
// signature as malformed SFC markup.
function getGrammar(
  scopeName: string = DEFAULT_SCOPE
): Promise<vsctm.IGrammar | undefined> {
  const cached = grammarPromises.get(scopeName);
  if (cached) {
    return cached;
  }
  const loaded = getRegistry().loadGrammar(scopeName);
  grammarPromises.set(scopeName, loaded);
  return loaded;
}

function initialize() {
  // Warm the grammar so the first real request isn't the one that pays
  // for loading it. Only the default (editor buffer) scope is warmed --
  // any other is loaded on first use, since which ones a session needs
  // isn't known up front.
  void getGrammar();
}

type Token = {
  lineIndex: number;
  // BYTE offsets into the UTF-8 encoding of the line -- NOT JavaScript
  // string indices. See toByteOffsets() for why the conversion happens
  // here rather than on the consumer side.
  startIndex: number;
  endIndex: number;
  scopes: string[];
};

/**
 * Convert vscode-textmate's token boundaries from JavaScript string indices
 * (UTF-16 code units) into byte offsets in the line's UTF-8 encoding.
 *
 * These are two different index spaces and they diverge on any line holding
 * a non-ASCII character: "hö" is 2 UTF-16 units but 3 UTF-8 bytes. The Haze
 * side stores lines as UTF-8 and slices them by byte offset, so handing it
 * a UTF-16 index makes it cut a multi-byte character in half -- producing a
 * lone lead byte that is not valid UTF-8, which the text renderer then
 * cannot turn into a glyph.
 *
 * Converting here, at the one place where the indices are still known to be
 * UTF-16, keeps a single index space (bytes) everywhere downstream.
 *
 * Runs once per line per tokenization, and the ASCII fast path means the
 * common case is a length check.
 */
function toByteOffsets(
  line: string,
  tokens: readonly { startIndex: number; endIndex: number; scopes: string[] }[],
  lineIndex: number
): Token[] {
  // Fast path: for a pure-ASCII line the two index spaces are identical,
  // which is every line in most source files.
  let ascii = true;
  for (let i = 0; i < line.length; i++) {
    if (line.charCodeAt(i) > 0x7f) {
      ascii = false;
      break;
    }
  }
  if (ascii) {
    return tokens.map((t) => ({
      lineIndex,
      startIndex: t.startIndex,
      endIndex: t.endIndex,
      scopes: t.scopes,
    }));
  }

  // Build a UTF-16 index -> byte offset map for this line. Entry i is the
  // byte offset at which the UTF-16 prefix of length i ends, so the map has
  // line.length + 1 entries and every token boundary can be looked up
  // directly.
  const byteAt = new Array<number>(line.length + 1);
  let bytes = 0;
  for (let i = 0; i < line.length; i++) {
    byteAt[i] = bytes;
    const code = line.codePointAt(i) as number;
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code <= 0xffff) {
      bytes += 3;
    } else {
      // Astral: one codepoint spelled as a surrogate PAIR, so it occupies
      // two UTF-16 indices. Record the second one as pointing at the same
      // byte offset, and skip it.
      bytes += 4;
      byteAt[i + 1] = bytes;
      i++;
    }
  }
  byteAt[line.length] = bytes;

  const clamp = (index: number): number => {
    if (index <= 0) return 0;
    if (index >= byteAt.length) return bytes;
    return byteAt[index];
  };

  return tokens.map((t) => ({
    lineIndex,
    startIndex: clamp(t.startIndex),
    endIndex: clamp(t.endIndex),
    scopes: t.scopes,
  }));
}

// ── Incremental tokenization ──────────────────────────────────────────
//
// TextMate tokenization is inherently sequential: a line's tokens depend
// on the rule stack left behind by the line before it (that is how a
// multi-line string or a <script> block "colours" the lines inside it).
// So it cannot be made random-access -- but it CAN be made incremental,
// which is what an editor actually needs:
//
//   * the rule stack at the END of every line is cached, so retokenizing
//     can START at the first changed line instead of at the top of the
//     file;
//   * it STOPS as soon as a line's resulting rule stack matches what was
//     cached there before, because from that point on every following
//     line would tokenize identically to last time.
//
// Editing one line in the middle of a 50k-line file therefore costs a
// handful of lines of work, not 50k. The pathological case (typing `"`
// or `<script>`, which changes the stack for everything below) still
// degrades to a full retokenize from the edit down -- correctly.
type DocState = {
  lines: string[];
  // ruleStacks[i] is the stack AFTER line i. ruleStacks[-1] is INITIAL.
  ruleStacks: vsctm.StateStack[];
  // tokensByLine[i] are the tokens of line i.
  tokensByLine: Token[][];
  // The top-level grammar this document was opened with. Remembered so a
  // later incremental "change" retokenizes with the SAME grammar it was
  // originally parsed by -- re-deriving it per request would silently
  // reparse the document under a different language the moment a caller
  // omitted the scope.
  scopeName: string;
};

const documents = new Map<string, DocState>();

function stackBefore(state: DocState, lineIndex: number): vsctm.StateStack {
  return lineIndex === 0 ? vsctm.INITIAL : state.ruleStacks[lineIndex - 1];
}

// Tokenize from `fromLine` downwards, stopping early once the rule stack
// reconverges with what was previously cached. Returns the range of lines
// whose tokens actually changed, so only those need to be sent back.
function retokenizeFrom(
  grammar: vsctm.IGrammar,
  state: DocState,
  fromLine: number,
  // Lines at/after this index have no trustworthy cached stack (they were
  // just inserted or shifted), so convergence can only be checked beyond it.
  minLineToCheckConvergence: number
): { firstLine: number; lastLine: number } {
  let ruleStack = stackBefore(state, fromLine);
  let lastChanged = fromLine - 1;

  for (let i = fromLine; i < state.lines.length; i++) {
    const result = grammar.tokenizeLine(state.lines[i], ruleStack);

    // tokenizeLine reports UTF-16 string indices; the Haze side slices UTF-8
    // by byte offset. Convert here so a single index space (bytes) is used
    // everywhere downstream -- see toByteOffsets.
    const tokens: Token[] = toByteOffsets(state.lines[i], result.tokens, i);

    const previousStack = state.ruleStacks[i];
    state.tokensByLine[i] = tokens;
    state.ruleStacks[i] = result.ruleStack;
    lastChanged = i;

    // If this line ended in exactly the state it ended in last time, every
    // line below it is unaffected and already correct in the cache.
    if (
      i >= minLineToCheckConvergence &&
      previousStack &&
      previousStack === result.ruleStack
    ) {
      break;
    }

    ruleStack = result.ruleStack;
  }

  return { firstLine: fromLine, lastLine: lastChanged };
}

function collectTokens(state: DocState, firstLine: number, lastLine: number): Token[] {
  const out: Token[] = [];
  for (let i = firstLine; i <= lastLine && i < state.tokensByLine.length; i++) {
    for (const t of state.tokensByLine[i]) {
      out.push(t);
    }
  }
  return out;
}

// Full (re)tokenize of a document -- used on open, and as the fallback
// whenever a client sends a change for a document we do not know.
async function openDocument(
  uri: string,
  text: string,
  scopeName: string = DEFAULT_SCOPE
) {
  const grammar = await getGrammar(scopeName);
  if (!grammar) {
    return { tokens: [] as Token[], firstLine: 0, lastLine: 0, lineCount: 0 };
  }
  const lines = text.split("\n");
  const state: DocState = {
    lines: lines,
    ruleStacks: new Array(lines.length),
    tokensByLine: new Array(lines.length),
    scopeName: scopeName,
  };
  documents.set(uri, state);
  const range = retokenizeFrom(grammar, state, 0, lines.length);
  return {
    tokens: collectTokens(state, range.firstLine, range.lastLine),
    firstLine: range.firstLine,
    lastLine: range.lastLine,
    lineCount: lines.length,
  };
}

// Apply a line-range edit and retokenize only what it affected.
//
// `startLine` + `removedCount` lines are replaced by `newLines`, which is
// exactly the shape of text_document.ChangeSet on the Haze side.
async function changeDocument(
  uri: string,
  startLine: number,
  removedCount: number,
  newLines: string[]
) {
  const state = documents.get(uri);
  if (!state) {
    // Never opened (or the engine restarted): nothing to be incremental
    // against, so fall back to a full parse of what we were given. No
    // scope to inherit either, so this takes the default -- a client that
    // opened with a non-default scope is expected to have done so via
    // "open", which is what records it.
    return openDocument(uri, newLines.join("\n"));
  }
  // The grammar this document was OPENED with, not the default: a change
  // must never silently reparse a TypeScript buffer as Vue.
  const grammar = await getGrammar(state.scopeName);
  if (!grammar) {
    return { tokens: [] as Token[], firstLine: 0, lastLine: 0, lineCount: 0 };
  }

  state.lines.splice(startLine, removedCount, ...newLines);
  state.ruleStacks.splice(startLine, removedCount, ...new Array(newLines.length));
  state.tokensByLine.splice(startLine, removedCount, ...new Array(newLines.length));

  // Lines from startLine to the end of the inserted block have no valid
  // cached stack, so convergence may only be tested after them.
  const range = retokenizeFrom(
    grammar,
    state,
    startLine,
    startLine + newLines.length
  );
  return {
    tokens: collectTokens(state, range.firstLine, range.lastLine),
    firstLine: range.firstLine,
    lastLine: range.lastLine,
    lineCount: state.lines.length,
  };
}

// Backwards-compatible whole-document highlight.
async function highlight(file: string, scopeName: string = DEFAULT_SCOPE) {
  return openDocument("__default__", file, scopeName);
}

async function main() {
  const decoder = new TextDecoder();
  const stdin = Bun.stdin.stream();
  const reader = stdin.getReader();

  let buffer = "";

  let initialized = false;

  async function handleRequest(request: any) {
    switch (request.method) {
      case "initialize":
        if (!initialized) {
          initialize();
        }
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: { initialized: true },
        };

      case "highlight":
        if (!initialized) {
          initialize();
        }
        return {
          jsonrpc: "2.0",
          id: request.id,
          // id: 2,
          result: await highlight(request.fileContent, request.scopeName),
        };

      // Full parse of a document, remembered under `uri` so later
      // "change" requests can be incremental against it.
      case "open":
        if (!initialized) {
          initialize();
        }
        return {
          jsonrpc: "2.0",
          id: request.id,
          // `version` is echoed straight back so the client can discard a
          // reply that describes a document it has already edited past --
          // replies are read once per frame, requests sent once per edit.
          // `uri` likewise: replies arrive on one shared stream, so it is
          // the only thing that says WHICH document a reply describes --
          // without it a client juggling more than one (an editor buffer
          // and a hover popup, say) cannot tell them apart.
          result: {
            ...(await openDocument(
              request.uri,
              request.fileContent ?? "",
              request.scopeName ?? DEFAULT_SCOPE
            )),
            uri: request.uri ?? "",
            version: request.version ?? 0,
          },
        };

      // Incremental edit: replace `removedCount` lines at `startLine`
      // with `newLines`, and return tokens ONLY for the lines whose
      // highlighting actually changed.
      case "change":
        if (!initialized) {
          initialize();
        }
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            ...(await changeDocument(
              request.uri,
              request.startLine ?? 0,
              request.removedCount ?? 0,
              request.newLines ?? []
            )),
            // See the "open" case above for why the uri is echoed.
            uri: request.uri ?? "",
            version: request.version ?? 0,
          },
        };

      default:
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: Error.InvalidMethod,
            message: errorMessage(Error.InvalidMethod),
          },
        };
    }
  }

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value);

    const contentLengthText = "Content-Length: ";
    const separator = "\r\n\r\n";
    while (
      buffer.startsWith(contentLengthText) &&
      buffer.indexOf(separator) !== -1
    ) {
      // separator found
      const frontHeaderLength = buffer.indexOf(separator);
      const contentLength = Number.parseInt(
        buffer.slice(contentLengthText.length, frontHeaderLength)
      );

      const totalPacketLength =
        frontHeaderLength + separator.length + contentLength;
      if (buffer.length < totalPacketLength) {
        break;
      }

      const packetContent = buffer.slice(
        frontHeaderLength + separator.length,
        totalPacketLength
      );
      buffer = buffer.slice(totalPacketLength);
      const response = await handleRequest(JSON.parse(packetContent));
      const result = JSON.stringify(response);
      process.stdout.write(
        `Content-Length: ${result.length}\r\n\r\n${result}`
      );
    }
  }
}

main();

/* OUTPUT:

Unknown scope name: source.js.regexp

Tokenizing line: function sayHello(name) {
 - token from 0 to 8 (function) with scopes source.js, meta.function.js, storage.type.function.js
 - token from 8 to 9 ( ) with scopes source.js, meta.function.js
 - token from 9 to 17 (sayHello) with scopes source.js, meta.function.js, entity.name.function.js
 - token from 17 to 18 (() with scopes source.js, meta.function.js, punctuation.definition.parameters.begin.js
 - token from 18 to 22 (name) with scopes source.js, meta.function.js, variable.parameter.function.js
 - token from 22 to 23 ()) with scopes source.js, meta.function.js, punctuation.definition.parameters.end.js
 - token from 23 to 24 ( ) with scopes source.js
 - token from 24 to 25 ({) with scopes source.js, punctuation.section.scope.begin.js

Tokenizing line:        return "Hello, " + name;
 - token from 0 to 1 (  ) with scopes source.js
 - token from 1 to 7 (return) with scopes source.js, keyword.control.js
 - token from 7 to 8 ( ) with scopes source.js
 - token from 8 to 9 (") with scopes source.js, string.quoted.double.js, punctuation.definition.string.begin.js
 - token from 9 to 16 (Hello, ) with scopes source.js, string.quoted.double.js
 - token from 16 to 17 (") with scopes source.js, string.quoted.double.js, punctuation.definition.string.end.js
 - token from 17 to 18 ( ) with scopes source.js
 - token from 18 to 19 (+) with scopes source.js, keyword.operator.arithmetic.js
 - token from 19 to 20 ( ) with scopes source.js
 - token from 20 to 24 (name) with scopes source.js, support.constant.dom.js
 - token from 24 to 25 (;) with scopes source.js, punctuation.terminator.statement.js

Tokenizing line: }
 - token from 0 to 1 (}) with scopes source.js, punctuation.section.scope.end.js

*/
