import fs from "fs";
import vsctm, { type IRawGrammar } from "vscode-textmate";
import oniguruma from "vscode-oniguruma";
// `with { type: "file" }` makes Bun embed this asset into standalone
// executables built via `bun build --compile`, and resolves to a real,
// readable path both when run as a script and inside the compiled binary.
// A plain fs.readFileSync(path.join(import.meta.dirname, ...)) does NOT
// work once compiled, since import.meta.dirname then points into Bun's
// virtual bundle filesystem, which doesn't contain node_modules.
import onigWasmPath from "./node_modules/vscode-oniguruma/release/onig.wasm" with { type: "file" };
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

function initialize() {}

async function highlight(file: string) {
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

  // Load the JavaScript grammar and any other grammars included by it async.
  const grammar = await registry.loadGrammar("source.vue");
  if (!grammar) {
    return;
  }
  // const file = fs.readFileSync("../Moduro_FE/src/Application.vue", "utf8");
  // const file = fs.readFileSync("../Moduro_FE/src/Application.vue", "utf8");
  // console.log(file);
  const textLines = file.split("\n");

  type Token = {
    lineIndex: number;
    startIndex: number;
    endIndex: number;
    scopes: string[];
  };

  const ret = {
    // file: file,
    // lines: [] as string[][],
    tokens: [] as Token[],
  };
  //   const text = [`function sayHello(name) {`, `\treturn "Hello, " + name;`, `}`];
  let ruleStack = vsctm.INITIAL;
  for (let lineIndex = 0; lineIndex < textLines.length; lineIndex++) {
    const line = textLines[lineIndex];
    const lineTokens = grammar.tokenizeLine(line, ruleStack);
    for (let j = 0; j < lineTokens.tokens.length; j++) {
      const token = lineTokens.tokens[j];
      // console.log(
      //   ` - token from ${token.startIndex} to ${token.endIndex} ` +
      //     `(${line.substring(token.startIndex, token.endIndex)}) ` +
      //     `with scopes ${token.scopes.join(", ")}`,
      // );
      // retLine.push(
      //   ` - token from ${token.startIndex} to ${token.endIndex} ` +
      //     `(${line.substring(token.startIndex, token.endIndex)}) ` +
      //     `with scopes ${token.scopes.join(", ")}`,
      // );
      ret.tokens.push({
        lineIndex: lineIndex,
        startIndex: token.startIndex,
        endIndex: token.endIndex,
        scopes: token.scopes,
      });
    }
    ruleStack = lineTokens.ruleStack;
    // ret.lines.push(retLine);
    // Bun.spawnSync(["zenity", "--info", "--text=tokens: " + ret.tokens.length]);
  }
  return ret;
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
          result: await highlight(request.fileContent),
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
    if (
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
      if (buffer.length >= totalPacketLength) {
        const packetContent = buffer.slice(
          frontHeaderLength + separator.length
        );
        buffer = buffer.slice(totalPacketLength);
        const response = await handleRequest(JSON.parse(packetContent));
        const result = JSON.stringify(response);
        // console.log(`Content-Length: ${result.length}\r\n\r\n${result}`);
        process.stdout.write(
          `Content-Length: ${result.length}\r\n\r\n${result}`
        );
      }
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
