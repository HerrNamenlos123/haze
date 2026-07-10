import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { Lowered, lowerExpr, lowerTypeDef } from "../Lower/Lower";
import {
  HAZE_GLOBAL_DIR,
  HAZE_STDLIB_NAME,
} from "../ModuleCompiler/ModuleCompiler";
import { Conversion } from "../Semantic/Conversion";
import type { Semantic } from "../Semantic/SemanticTypes";
import {
  BinaryOperationToString,
  EBinaryOperation,
  EUnaryOperation,
  UnaryOperationToString,
} from "../shared/AST";
import {
  getModuleGlobalNamespaceName,
  getModuleNamespaceMangledSegment,
  type ModuleConfig,
  ModuleType,
} from "../shared/Config";
import { EPrimitive, type NameSet, primitiveToString } from "../shared/common";
import { assert, GeneralError, InternalError } from "../shared/Errors";
import { OutputWriter } from "./OutputWriter";

function makeUnionMappingName(from: Lowered.TypeUseId, to: Lowered.TypeUseId) {
  return `_H_Union_Mapping_${from}_to_${to}_`;
}

function escapeStringForC(str: string): [string, number] {
  let escaped = "";
  let byteLength = 0;

  for (const char of str) {
    const code = char.codePointAt(0);
    if (code === undefined) {
      continue;
    }

    switch (char) {
      case '"':
        escaped += '\\"';
        byteLength += 1;
        break;
      case "\\":
        escaped += "\\\\";
        byteLength += 1;
        break;
      case "\n":
        escaped += "\\n";
        byteLength += 1;
        break;
      case "\r":
        escaped += "\\r";
        byteLength += 1;
        break;
      case "\t":
        escaped += "\\t";
        byteLength += 1;
        break;
      case "\0":
        escaped += "\\0";
        byteLength += 1;
        break;
      default:
        if (code >= 0x20 && code <= 0x7e) {
          // Printable ASCII
          escaped += char;
          byteLength += 1;
        } else if (code <= 0xff_ff) {
          escaped += `\\u${code.toString(16).padStart(4, "0")}`;
          byteLength += Buffer.from(char).length;
        } else {
          // code > 0xffff, surrogate pair
          escaped += `\\U${code.toString(16).padStart(8, "0")}`;
          byteLength += Buffer.from(char).length;
        }
    }
  }

  return [escaped, byteLength];
}

class CodeGenerator {
  private out = {
    includes: new OutputWriter(),
    cDecls: new OutputWriter(),
    type_declarations: new OutputWriter(),
    type_definitions: new OutputWriter(),
    function_declarations: new OutputWriter(),
    refinement_helpers: new OutputWriter(),
    function_definitions: new OutputWriter(),
    // Only ever holds hzstd's own unity-build `#include` (see the cInjections
    // loop below) -- emitted last, after every other section, so windows.h
    // (pulled in transitively on win32) never poisons earlier declarations
    // in this same translation unit with its legacy macros (e.g. near/far).
    trailer: new OutputWriter(),
    global_variables: new OutputWriter(),
  };

  private embeddedFiles: Semantic.EmbeddedFileData[] = [];
  private inGlobalScope = false;
  private emittedTagNameFunctions = new Set<Lowered.TypeDefId>();

  constructor(
    public config: ModuleConfig,
    public moduleDir: string,
    public allModules: [string, string][],
    public lr: Lowered.Module
  ) {
    if (this.config.hzstdLocation) {
      this.includeLocalHeader(
        this.config.hzstdLocation + "/hzstd/include/hzstd.h"
      );
    } else {
      this.includeLocalHeader("hzstd.h");
    }

    // Build embedded file function map
    this.buildEmbeddedFileFunctionMap();

    // const contextSymbol = this.module.globalScope.lookupSymbol(
    //   "Context",
    //   this.module.globalScope.location,
    // );
    // const context = generateUsageCode(contextSymbol.type, this.module);
    // this.out.type_declarations[mangleSymbol(contextSymbol)] = new OutputWriter()
    //   .writeLine(`struct ${context}_;`)
    //   .writeLine(`typedef struct ${context}_ ${context};`);
    if (this.config.moduleType === ModuleType.Executable) {
      this.out.function_definitions
        .writeLine("int32_t main(int argc, const char* argv[]) {")
        .pushIndent();
      this.out.function_definitions.writeLine("hzstd_initialize();");

      const have = new Set<string>();
      for (const module of this.allModules) {
        const name = getModuleGlobalNamespaceName(module[0], module[1]);
        if (have.has(name)) {
          continue;
        }
        have.add(name);
        this.includeLocalHeader(
          `${this.moduleDir}/../${module[0]}/build/regex/__hz_${name}_regex_table.h`
        );
        this.out.function_definitions.writeLine(
          `hzstd_regex_init_table(__hz_${name}_regex_table, __hz_${name}_regex_table_count);`
        );
      }

      //   // .writeLine(
      //   //   `${generateUsageCode(this.module.getBuiltinType("Context"), this.module)} ctx = {};`,
      //   // )
      //   .writeLine(`_HN6Memory5ArenaE defaultArena = {};`)
      //   .writeLine(`ctx.mem.globalDefaultArena = &defaultArena;`);
      // if (!this.module.moduleConfig.nostdlib) {
      //   // this.out.function_declarations["_H13__setupStdlib"].writeLine(
      //   //   `void _H13__setupStdlib(${generateUsageCode(this.module.getBuiltinType("Context"), this.module)}* ctx);`,
      //   // );
      //   this.out.function_definitions.writeLine("_H13__setupStdlib(&ctx);");
      // }
      // this.out.function_definitions.writeLine(
      //   `_H4ListI6StringE argsList = _HN7Process10__loadArgvE(&ctx, argc, (uint8_t**)argv);`,
      // );
      const nsSeg = getModuleNamespaceMangledSegment(
        config.name,
        config.version
      );
      this.out.function_definitions
        .writeLine(`return _HN${nsSeg}4mainEv();`)
        // .writeLine(`hzstd_arena_cleanup_and_free(parent_arena->arenaImpl);`)
        // .writeLine(`return __hz_result;`)
        .popIndent()
        .writeLine("}\n");
    }
  }

  private normalizeCRLF(buffer: Buffer, isBinary: boolean): Buffer {
    if (isBinary) {
      // For binary files, don't modify anything
      return buffer;
    }

    // For text files, normalize to LF only (remove CR)
    let content = buffer.toString("utf8");
    content = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    return Buffer.from(content, "utf8");
  }

  private buildEmbeddedFileFunctionMap() {
    for (const [_id, file] of this.lr.sr.elaboratedEmbeddedFileTable) {
      this.embeddedFiles.push(file);
    }
  }

  includeSystemHeader(filename: string) {
    this.out.includes.writeLine(`#include <${filename}>`);
  }

  includeLocalHeader(filename: string) {
    this.out.includes.writeLine(`#include "${filename}"`);
  }

  undef(name: string) {
    this.out.includes.writeLine(`#undef ${name}`);
  }

  modulePrefix() {
    const modulePrefix = getModuleGlobalNamespaceName(
      this.config.name,
      this.config.version
    );
    return modulePrefix;
  }

  compileRegex(regex: Semantic.RegexData) {
    const symbol = `__hz_${this.modulePrefix()}_regex_${regex.id}`;
    const outPath = path.join(this.moduleDir, `build/regex/${symbol}.c`);
    const regexCompilerPath = `${HAZE_GLOBAL_DIR}/regex-compiler/haze-regex-compile`;
    mkdirSync(path.dirname(outPath), { recursive: true });

    // --- invoke C helper
    const proc = spawnSync(
      regexCompilerPath,
      [outPath, symbol, regex.pattern, [...regex.flags].join("")],
      {
        encoding: "utf8", // stdout = string
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    if (proc.error) {
      throw proc.error;
    }

    if (proc.status !== 0) {
      // IMPORTANT: helper prints errors to stdout
      throw new GeneralError(`regex compilation failed:\n${proc.stdout}`);
    }
  }

  regexTablePath() {
    const outDir = path.join(this.moduleDir, "build/regex");
    const tablePath = path.join(
      outDir,
      `__hz_${this.modulePrefix()}_regex_table.c`
    );
    return tablePath;
  }

  embeddedFilePath() {
    const outDir = path.join(this.moduleDir, "build/embedded");
    const tablePath = path.join(
      outDir,
      `__hz_${this.modulePrefix()}_embedded_table.c`
    );
    return tablePath;
  }

  compileEmbeddedFile(embeddedFile: Semantic.EmbeddedFileData) {
    const typeName = embeddedFile.isBinary ? "binary" : "text";
    const symbol = `__hz_${this.modulePrefix()}_embedded_${typeName}_${embeddedFile.id}`;
    const outDir = path.join(this.moduleDir, "build/embedded");
    mkdirSync(outDir, { recursive: true });
    const cFilePath = path.join(outDir, `${symbol}.c`);

    // Read the file content and normalize line endings for text files
    const rawContent = readFileSync(embeddedFile.absolutePath);
    const fileContent = this.normalizeCRLF(rawContent, embeddedFile.isBinary);

    // Generate C code as byte array
    let c =
      "// ------------------------------------------------------------------\n";
    c += "// GENERATED FILE — DO NOT EDIT\n";
    c += `// Embedded file: ${embeddedFile.filePath} as ${embeddedFile.isBinary ? "binary" : "text"}\n`;
    c +=
      "// ------------------------------------------------------------------\n\n";

    c += "#include <stdint.h>\n";
    c += "#include <stddef.h>\n\n";

    c += `const uint8_t ${symbol}_data[] = {\n`;

    // Write bytes in groups of 16 for readability
    for (let i = 0; i < fileContent.length; i++) {
      if (i % 16 === 0) {
        c += "    ";
      }
      c += `0x${fileContent[i].toString(16).padStart(2, "0")}`;
      if (i < fileContent.length - 1) {
        c += ", ";
      }
      if ((i + 1) % 16 === 0) {
        c += "\n";
      }
    }
    if (fileContent.length % 16 !== 0) {
      c += "\n";
    }
    c += "};\n\n";

    c += `const size_t ${symbol}_size = ${fileContent.length};\n`;

    writeFileSync(cFilePath, c);
  }

  compileEmbeddedFiles() {
    const outDir = path.join(this.moduleDir, "build/embedded");
    mkdirSync(outDir, { recursive: true });

    const prefix = this.modulePrefix();
    const cPath = path.join(outDir, `__hz_${prefix}_embedded_table.c`);
    const hPath = path.join(outDir, `__hz_${prefix}_embedded_table.h`);

    // --- collect embedded files
    let maxId = 0n;
    const entries: { id: bigint; isBinary: boolean }[] = [];

    for (const [, embeddedFile] of this.lr.sr.elaboratedEmbeddedFileTable) {
      this.compileEmbeddedFile(embeddedFile);
      entries.push({ id: embeddedFile.id, isBinary: embeddedFile.isBinary });
      if (embeddedFile.id > maxId) {
        maxId = embeddedFile.id;
      }
    }

    // If no embedded files, don't generate anything
    if (entries.length === 0) {
      return;
    }

    /* =======================
     Generate HEADER (.h)
     ======================= */

    let h = "";
    h += `#ifndef __HZ_${prefix.toUpperCase()}_EMBEDDED_TABLE_H\n`;
    h += `#define __HZ_${prefix.toUpperCase()}_EMBEDDED_TABLE_H\n\n`;

    h += "#include <stddef.h>\n";
    h += "#include <stdint.h>\n\n";

    h += '#ifdef __cplusplus\nextern "C" {\n#endif\n\n';

    // Declare all embedded file data
    for (const { id, isBinary } of entries) {
      const typeName = isBinary ? "binary" : "text";
      h += `extern const uint8_t __hz_${prefix}_embedded_${typeName}_${id}_data[];\n`;
      h += `extern const size_t __hz_${prefix}_embedded_${typeName}_${id}_size;\n\n`;
    }

    h += "#ifdef __cplusplus\n}\n#endif\n\n";
    h += `#endif /* __HZ_${prefix.toUpperCase()}_EMBEDDED_TABLE_H */\n`;

    writeFileSync(hPath, h);

    /* =======================
     Generate SOURCE (.c)
     ======================= */

    let c = "";
    c +=
      "// ------------------------------------------------------------------\n";
    c += "// GENERATED FILE — DO NOT EDIT\n";
    c += "// Embedded files table\n";
    c +=
      "// ------------------------------------------------------------------\n\n";

    c += "#include <stdint.h>\n";
    c += "#include <stddef.h>\n\n";
    c += `#include "__hz_${prefix}_embedded_table.h"\n\n`;

    for (const { id, isBinary } of entries) {
      const typeName = isBinary ? "binary" : "text";
      c += `#include "__hz_${prefix}_embedded_${typeName}_${id}.c"\n`;
    }

    writeFileSync(cPath, c);
  }

  compileRegexes() {
    const outDir = path.join(this.moduleDir, "build/regex");
    mkdirSync(outDir, { recursive: true });

    const prefix = this.modulePrefix();
    const cPath = path.join(outDir, `__hz_${prefix}_regex_table.c`);
    const hPath = path.join(outDir, `__hz_${prefix}_regex_table.h`);

    // --- collect regexes
    let maxId = 0n;
    const entries: { id: bigint }[] = [];

    for (const [, regex] of this.lr.sr.elaboratedRegexTable) {
      this.compileRegex(regex);
      entries.push({ id: regex.id });
      if (regex.id > maxId) {
        maxId = regex.id;
      }
    }

    /* =======================
     Generate HEADER (.h)
     ======================= */

    let h = "";
    h += `#ifndef __HZ_${prefix.toUpperCase()}_REGEX_TABLE_H\n`;
    h += `#define __HZ_${prefix.toUpperCase()}_REGEX_TABLE_H\n\n`;

    assert(this.config.hzstdLocation);
    h += "#include <stddef.h>\n";
    h += "#include <stdint.h>\n\n";
    h += `#include "${this.config.hzstdLocation}/hzstd/include/hzstd_regex.h"\n\n`;

    h += '#ifdef __cplusplus\nextern "C" {\n#endif\n\n';

    h += `extern hzstd_regex_blob_t __hz_${prefix}_regex_table[];\n`;
    h += `extern const size_t __hz_${prefix}_regex_table_count;\n\n`;

    h += "#ifdef __cplusplus\n}\n#endif\n\n";
    h += `#endif /* __HZ_${prefix.toUpperCase()}_REGEX_TABLE_H */\n`;

    writeFileSync(hPath, h);

    /* =======================
     Generate SOURCE (.c)
     ======================= */

    let c = "";
    c +=
      "// ------------------------------------------------------------------\n";
    c += "// GENERATED FILE — DO NOT EDIT\n";
    c += "// Regex blob table (IDs start at 1)\n";
    c +=
      "// ------------------------------------------------------------------\n\n";

    c += "#include <stdint.h>\n";
    c += "#include <stddef.h>\n\n";
    c += `#include "__hz_${prefix}_regex_table.h"\n\n`;

    for (const { id } of entries) {
      c += `#include "__hz_${prefix}_regex_${id}.c"\n`;
    }

    c += "\n";

    c += `hzstd_regex_blob_t __hz_${prefix}_regex_table[] = {\n`;
    for (const { id } of entries) {
      c +=
        `    [${id}] = { .data = __hz_${prefix}_regex_${id}_data, ` +
        `.size = __hz_${prefix}_regex_${id}_size, .code = NULL },\n`;
    }
    c += "};\n\n";

    c += `const size_t __hz_${prefix}_regex_table_count = ${maxId + 1n};\n`;

    writeFileSync(cPath, c);
  }

  writeString() {
    const writer = new OutputWriter();

    this.compileRegexes();
    this.includeLocalHeader(this.regexTablePath());

    this.compileEmbeddedFiles();
    const embeddedTablePath = this.embeddedFilePath();
    // Check if embedded files exist
    if (this.lr.sr.elaboratedEmbeddedFileTable.size > 0) {
      this.includeLocalHeader(embeddedTablePath);
    }

    // writer.writeLine("// clang-format off\n\n");
    writer.writeLine("#define _POSIX_C_SOURCE 199309L\n");
    writer.writeLine("#define _GNU_SOURCE\n");

    writer.write("// Include section\n");
    writer.write(this.out.includes);

    writer.write("\n\n// C Injection section\n");
    writer.write(this.out.cDecls);

    writer.write("\n\n// Type declaration section\n");
    writer.write(this.out.type_declarations);
    writer.writeLine();

    writer.write("\n\n// Type definition section\n");
    writer.write(this.out.type_definitions);
    writer.writeLine();

    writer.write("\n\n// Function declaration section\n");
    writer.write(this.out.function_declarations);
    writer.writeLine();

    writer.write("\n\n// Global Variable section\n");
    writer.write(this.out.global_variables);
    writer.writeLine();

    writer.write("\n\n// Refinement helper functions\n");
    writer.write(this.out.refinement_helpers);
    writer.writeLine();

    writer.write("\n\n// Function definition section\n");
    writer.write(this.out.function_definitions);
    writer.writeLine();

    writer.write(
      "\n\n// Trailer section (hzstd unity-build splice, see hzstd_types.h comment)\n"
    );
    writer.write(this.out.trailer);
    writer.writeLine();

    // writer.writeLine("// clang-format on");

    return writer.get();
  }

  generate() {
    this.includeSystemHeader("stdlib.h");
    this.includeSystemHeader("stdint.h");
    this.includeSystemHeader("inttypes.h");
    this.includeSystemHeader("stdbool.h");
    this.includeSystemHeader("stdalign.h");
    this.includeSystemHeader("limits.h");
    this.includeSystemHeader("string.h");
    this.includeSystemHeader("math.h");

    const sortedLoweredTypes: (
      | { type: "def"; id: Lowered.TypeDefId }
      | { type: "use"; id: Lowered.TypeUseId }
    )[] = [];

    this.sortTypes(new Set(), sortedLoweredTypes);

    for (const decl of this.lr.cInjections) {
      // hzstd's own unity-build splice (Main.hz) must land after every other
      // declaration in this file, not alongside ordinary top-level __c__
      // injections -- see the `trailer` section comment above.
      if (
        this.config.name === HAZE_STDLIB_NAME &&
        decl.includes('"hzstd/hzstd_main.c"')
      ) {
        this.out.trailer.writeLine(decl);
      } else {
        this.out.cDecls.writeLine(decl);
      }
    }

    for (const [_id, symbol] of this.lr.loweredFunctions) {
      this.emitFunction(symbol);
    }

    this.emitModuleMetadata();

    for (const symbolInfo of sortedLoweredTypes) {
      if (symbolInfo.type === "def") {
        const symbol = this.lr.typeDefNodes.get(symbolInfo.id);
        if (symbol.variant === Lowered.ENode.PrimitiveDatatype) {
          // All primitives are handled in hzstd
        } else if (symbol.variant === Lowered.ENode.StructDatatype) {
          if (!symbol.noemit) {
            this.out.type_declarations.writeLine(
              `typedef struct ${this.mangleTypeDef(symbol)} ${this.mangleTypeDef(symbol)};`
            );
            this.out.type_definitions
              .writeLine(`struct ${this.mangleTypeDef(symbol)} {`)
              .pushIndent();
            for (const member of symbol.members) {
              this.out.type_definitions.writeLine(
                `${this.mangleTypeUse(member.type)} ${member.name};`
              );
            }
            if (symbol.members.length === 0) {
              this.out.type_definitions.writeLine("hzstd_u8_t dummy;");
            }
            this.out.type_definitions.popIndent().writeLine("};").writeLine();
          }
        } else if (symbol.variant === Lowered.ENode.PointerDatatype) {
          this.out.type_declarations.writeLine(
            `typedef ${this.mangleTypeUse(symbol.referee)}* ${this.mangleTypeDef(symbol)};`
          );
        } else if (
          symbol.variant === Lowered.ENode.UntaggedUnionDatatype ||
          symbol.variant === Lowered.ENode.TaggedUnionDatatype
        ) {
          if (symbol.optimizeAsRawPointer) {
            this.out.type_declarations.writeLine(
              `typedef ${this.mangleTypeUse(symbol.optimizeAsRawPointer)} ${this.mangleTypeDef(
                symbol
              )};`
            );
          } else {
            this.out.type_declarations.writeLine(
              `typedef struct ${this.mangleTypeDef(symbol)} ${this.mangleTypeDef(symbol)};`
            );
            this.out.type_definitions
              .writeLine(`struct ${this.mangleTypeDef(symbol)} {`)
              .pushIndent();
            this.out.type_definitions.writeLine("uint8_t tag;");
            this.out.type_definitions.writeLine("union {").pushIndent();
            const members =
              symbol.variant === Lowered.ENode.UntaggedUnionDatatype
                ? symbol.members
                : symbol.members.map((m) => m.type);
            members.forEach((m, i) => {
              this.out.type_definitions.writeLine(
                `${this.mangleTypeUse(m)} as_tag_${i};`
              );
            });
            this.out.type_definitions
              .writeLine("char as_bytes[sizeof(union{")
              .pushIndent();
            members.forEach((m, i) => {
              this.out.type_definitions.writeLine(
                `${this.mangleTypeUse(m)} as_tag_${i};`
              );
            });
            this.out.type_definitions.popIndent().writeLine("})];");
            this.out.type_definitions.popIndent().writeLine("};");
            this.out.type_definitions.popIndent().writeLine("};");
          }
        } else if (symbol.variant === Lowered.ENode.FixedArrayDatatype) {
          this.out.type_declarations.writeLine(
            `typedef struct ${this.mangleTypeDef(symbol)} ${this.mangleTypeDef(symbol)};`
          );
          this.out.type_definitions
            .writeLine(`struct ${this.mangleTypeDef(symbol)} {`)
            .pushIndent();
          this.out.type_definitions.writeLine(
            `${this.mangleTypeUse(symbol.datatype)} data[${symbol.length}];`
          );
          this.out.type_definitions.popIndent().writeLine("};");
        } else if (symbol.variant === Lowered.ENode.DynamicArrayDatatype) {
          this.out.type_declarations.writeLine(
            `typedef hzstd_dynamic_array_t ${this.mangleTypeDef(symbol)};`
          );
          // this.out.type_definitions.writeLine(`struct ${this.mangleTypeDef(symbol)} {`).pushIndent();
          // this.out.type_definitions.writeLine(`hzstd_dynamic_array_t data;`);
          // this.out.type_definitions.popIndent().writeLine(`};`);
        } else if (symbol.variant === Lowered.ENode.SliceDatatype) {
          this.out.type_declarations.writeLine(
            `typedef struct ${this.mangleTypeDef(symbol)} ${this.mangleTypeDef(symbol)};`
          );
          this.out.type_definitions
            .writeLine(`struct ${this.mangleTypeDef(symbol)} {`)
            .pushIndent();
          this.out.type_definitions.writeLine(
            `${this.mangleTypeUse(symbol.datatype)}* data;`
          );
          this.out.type_definitions.writeLine("uint64_t length;");
          this.out.type_definitions.popIndent().writeLine("};");
        } else if (symbol.variant === Lowered.ENode.FunctionDatatype) {
          this.out.type_declarations.writeLine(
            `typedef ${this.mangleTypeUse(symbol.returnType)} (*${this.mangleTypeDef(
              symbol
            )})(${symbol.parameters.map((p) => `${this.mangleTypeUse(p)}`).join(", ")});`
          );
        } else if (symbol.variant === Lowered.ENode.CallableDatatype) {
          this.out.type_declarations.writeLine(
            `typedef struct ${this.mangleTypeDef(symbol)} ${this.mangleTypeDef(symbol)};`
          );
          this.out.type_definitions
            .writeLine(`struct ${this.mangleTypeDef(symbol)} {`)
            .pushIndent();
          this.out.type_definitions.writeLine("void* env;");
          this.out.type_definitions.writeLine(
            `${this.mangleTypeDef(symbol.functionType)} fn;`
          );
          this.out.type_definitions.popIndent().writeLine("};").writeLine();
        } else if (symbol.variant === Lowered.ENode.EnumDatatype) {
          if (!symbol.noemit) {
            this.out.type_declarations.writeLine("typedef enum {").pushIndent();
            for (const value of symbol.values) {
              this.out.type_declarations.writeLine(
                `${this.mangleName(value.loweredName)} = ${this.emitExpr(value.value).out.get()},`
              );
            }
            this.out.type_declarations
              .popIndent()
              .writeLine(`} ${this.mangleName(symbol.name)} ;`);
          }
        } else if (symbol.variant === Lowered.ENode.ReactiveDatatype) {
          const wrappedTypeDef = this.lr.typeDefNodes.get(
            this.lr.typeUseNodes.get(symbol.datatype).type
          );
          if (wrappedTypeDef.variant === Lowered.ENode.DynamicArrayDatatype) {
            this.out.type_declarations.writeLine(
              `typedef hzstd_reactive_array_t* ${this.mangleTypeDef(symbol)};`
            );
          } else {
            this.out.type_declarations.writeLine(
              `typedef hzstd_reactive_cell_t* ${this.mangleTypeDef(symbol)};`
            );
          }
        } else if (symbol.variant === Lowered.ENode.ComputedDatatype) {
          this.out.type_declarations.writeLine(
            `typedef hzstd_computed_node_t* ${this.mangleTypeDef(symbol)};`
          );
        } else if (symbol.variant === Lowered.ENode.TypeAliasDatatype) {
          this.out.type_declarations.writeLine(
            `typedef ${this.mangleTypeUse(symbol.datatype)} ${this.mangleTypeDef(symbol)};`
          );
        } else if (symbol.variant === Lowered.ENode.LiteralDatatype) {
          // A literal datatype is just an alias for its base type
          const a = this.mangleTypeUse(symbol.baseType);
          const b = this.mangleTypeDef(symbol);
          if (a !== b) {
            this.out.type_declarations.writeLine(`typedef ${a} ${b};`);
          }
        } else {
          assert(false);
        }
      } else {
        const symbol = this.lr.typeUseNodes.get(symbolInfo.id);
        if (symbol.pointer) {
          this.out.type_declarations.writeLine(
            `typedef ${this.mangleTypeDef(symbol.type)}* ${this.mangleTypeUse(symbol)};`
          );
        } else {
          const a = this.mangleTypeDef(symbol.type);
          const b = this.mangleTypeUse(symbol);
          if (a !== b) {
            this.out.type_declarations.writeLine(`typedef ${a} ${b};`);
          }
        }
      }
    }

    for (const statementId of this.lr.loweredGlobalVariables) {
      const statement = this.lr.statementNodes.get(statementId);
      assert(statement.variant === Lowered.ENode.VariableStatement);
      if (statement.value) {
        this.inGlobalScope = true;
        let exprValue = this.emitExpr(statement.value).out.get();
        this.inGlobalScope = false;

        if (statement.intrinsicTakeAddrOfValue) {
          exprValue = `&(${exprValue})`;
        }

        this.out.global_variables.writeLine(
          `${this.mangleTypeUse(statement.type)} ${this.mangleName(
            statement.name
          )} = ${exprValue};`
        );
      } else {
        this.out.global_variables.writeLine(
          `${this.mangleTypeUse(statement.type)} ${this.mangleName(statement.name)} = {0};`
        );
      }
    }

    for (const mapping of this.lr.loweredUnionMappings) {
      this.out.function_declarations.writeLine(
        `static inline ${this.mangleTypeUse(mapping.to)} ${makeUnionMappingName(mapping.from, mapping.to)}(${this.mangleTypeUse(mapping.from)} from);`
      );
      this.out.function_definitions
        .writeLine(
          `static inline ${this.mangleTypeUse(mapping.to)} ${makeUnionMappingName(mapping.from, mapping.to)}(${this.mangleTypeUse(mapping.from)} from) {`
        )
        .pushIndent();
      this.out.function_definitions
        .writeLine("switch (from.tag) {")
        .pushIndent();
      for (const [from, to] of mapping.mapping) {
        this.out.function_definitions.writeLine(
          `case ${from}: return (${this.mangleTypeUse(mapping.to)}) { .tag = ${to}, .as_tag_${to} = from.as_tag_${from} };`
        );
      }
      this.out.function_definitions.writeLine(
        "default: __builtin_unreachable();"
      );
      this.out.function_definitions.popIndent().writeLine("}");
      this.out.function_definitions.popIndent().writeLine("}");
      // this.out.type_declarations
      //   .writeLine(`static const uint8_t ${makeUnionMappingName(mapping.from, mapping.to)}[] = {`)
      //   .pushIndent();
      // for (const [from, to] of mapping.mapping) {
      //   this.out.type_declarations.writeLine(`[${from}] = ${to},`);
      // }
      // this.out.type_declarations.popIndent().writeLine(`};`);
    }
  }

  sortTypes(
    appliedTypes: Set<Lowered.TypeDef | Lowered.TypeUse>,
    sortedLoweredTypes: (
      | { type: "def"; id: Lowered.TypeDefId }
      | { type: "use"; id: Lowered.TypeUseId }
    )[]
  ) {
    // This function processes the type in the sense that it goes over all types that this type depends on,
    // and if there is a direct relationship, then that type is processed, which sorts it first.
    // This is required because C has a very strict requirement on ordering of struct definitions that depend on another
    const processTypeDef = (typeId: Lowered.TypeDefId) => {
      const type = this.lr.typeDefNodes.get(typeId);

      if (appliedTypes.has(type)) {
        return;
      }

      if (type.variant === Lowered.ENode.FunctionDatatype) {
        appliedTypes.add(type);
        for (const p of type.parameters) {
          processTypeUse(p);
        }
        processTypeUse(type.returnType);
        sortedLoweredTypes.push({ type: "def", id: typeId });
      } else if (type.variant === Lowered.ENode.CallableDatatype) {
        appliedTypes.add(type);
        processTypeDef(type.functionType);
        sortedLoweredTypes.push({ type: "def", id: typeId });
      } else if (type.variant === Lowered.ENode.StructDatatype) {
        appliedTypes.add(type);
        for (const m of type.members) {
          const type = this.lr.typeUseNodes.get(m.type);
          const typeDef = this.lr.typeDefNodes.get(type.type);
          // Pointer-like types do not matter, only direct usages are bad.
          // Unions with optimizeAsRawPointer are emitted as pointer typedefs in C,
          // so they don't create a struct-level dependency on the inner type.
          const isPointerLike =
            typeDef.variant === Lowered.ENode.PointerDatatype ||
            typeDef.variant === Lowered.ENode.DynamicArrayDatatype ||
            ((typeDef.variant === Lowered.ENode.UntaggedUnionDatatype ||
              typeDef.variant === Lowered.ENode.TaggedUnionDatatype) &&
              typeDef.optimizeAsRawPointer !== null);
          if (!isPointerLike) {
            processTypeUse(m.type);
          }
        }
        sortedLoweredTypes.push({ type: "def", id: typeId });
      } else if (type.variant === Lowered.ENode.PrimitiveDatatype) {
        appliedTypes.add(type);
        sortedLoweredTypes.push({ type: "def", id: typeId });
      } else if (type.variant === Lowered.ENode.PointerDatatype) {
        appliedTypes.add(type);
        processTypeUse(type.referee);
        sortedLoweredTypes.push({ type: "def", id: typeId });
      } else if (type.variant === Lowered.ENode.FixedArrayDatatype) {
        appliedTypes.add(type);
        processTypeUse(type.datatype);
        sortedLoweredTypes.push({ type: "def", id: typeId });
      } else if (type.variant === Lowered.ENode.DynamicArrayDatatype) {
        appliedTypes.add(type);
        processTypeUse(type.datatype);
        sortedLoweredTypes.push({ type: "def", id: typeId });
      } else if (type.variant === Lowered.ENode.UntaggedUnionDatatype) {
        appliedTypes.add(type);
        if (type.optimizeAsRawPointer) {
          processTypeUse(type.optimizeAsRawPointer);
        } else {
          for (const m of type.members) {
            processTypeUse(m);
          }
        }
        sortedLoweredTypes.push({ type: "def", id: typeId });
      } else if (type.variant === Lowered.ENode.TaggedUnionDatatype) {
        appliedTypes.add(type);
        if (type.optimizeAsRawPointer) {
          processTypeUse(type.optimizeAsRawPointer);
        } else {
          for (const m of type.members) {
            processTypeUse(m.type);
          }
        }
        sortedLoweredTypes.push({ type: "def", id: typeId });
      } else if (type.variant === Lowered.ENode.EnumDatatype) {
        appliedTypes.add(type);
        processTypeUse(type.type);
        sortedLoweredTypes.push({ type: "def", id: typeId });
      } else if (type.variant === Lowered.ENode.ReactiveDatatype) {
        appliedTypes.add(type);
        sortedLoweredTypes.push({ type: "def", id: typeId });
      } else if (type.variant === Lowered.ENode.ComputedDatatype) {
        appliedTypes.add(type);
        sortedLoweredTypes.push({ type: "def", id: typeId });
      } else if (type.variant === Lowered.ENode.TypeAliasDatatype) {
        appliedTypes.add(type);
        processTypeUse(type.datatype);
        sortedLoweredTypes.push({ type: "def", id: typeId });
      } else if (type.variant === Lowered.ENode.LiteralDatatype) {
        appliedTypes.add(type);
        processTypeUse(type.baseType);
        sortedLoweredTypes.push({ type: "def", id: typeId });
      } else {
        assert(false);
      }
    };

    const processTypeUse = (typeId: Lowered.TypeUseId) => {
      const type = this.lr.typeUseNodes.get(typeId);
      if (appliedTypes.has(type)) {
        return;
      }
      appliedTypes.add(type);
      processTypeDef(type.type);
      sortedLoweredTypes.push({ type: "use", id: typeId });
    };

    for (const [_id, t] of this.lr.loweredTypeDefs) {
      processTypeDef(t);
    }
    for (const [_id, t] of this.lr.loweredTypeUses) {
      processTypeUse(t);
    }
    for (const [_id, t] of this.lr.loweredPointers) {
      processTypeDef(t);
    }
  }

  primitiveToC(primitive: EPrimitive) {
    assert(primitive !== EPrimitive.null, "null should be handled specially");
    return "hzstd_" + primitiveToString(primitive) + "_t";
  }

  mangleTypeDef(type: Lowered.TypeDef | Lowered.TypeDefId): string {
    if (typeof type !== "object") {
      type = this.lr.typeDefNodes.get(type);
    }
    return this.mangleName(type.name);
  }

  mangleTypeUse(type: Lowered.TypeUse | Lowered.TypeUseId): string {
    if (typeof type !== "object") {
      type = this.lr.typeUseNodes.get(type);
    }
    return this.mangleName(type.name);
  }

  mangleFunctionSymbol(
    func: Lowered.FunctionSymbol | Lowered.FunctionId
  ): string {
    if (typeof func !== "object") {
      func = this.lr.functionNodes.get(func);
    }
    return this.mangleName(func.name);
  }

  mangleName(name: NameSet): string {
    if (name.wasMangled) {
      return "_H" + name.mangledName;
    }
    return name.mangledName;
  }

  unionVariantPrettyName(
    union: Lowered.UntaggedUnionDatatypeDef | Lowered.TaggedUnionDatatypeDef,
    index: number
  ): string {
    if (union.variant === Lowered.ENode.TaggedUnionDatatype) {
      return union.members[index].tag;
    }
    return this.lr.typeUseNodes.get(union.members[index]).name.prettyName;
  }

  ensureUnionTagNameFunction(typeDefId: Lowered.TypeDefId): string {
    const union = this.lr.typeDefNodes.get(typeDefId);
    assert(
      union.variant === Lowered.ENode.UntaggedUnionDatatype ||
        union.variant === Lowered.ENode.TaggedUnionDatatype
    );
    const fnName = `__hz_tag_name_${this.mangleTypeDef(union)}`;
    if (this.emittedTagNameFunctions.has(typeDefId)) {
      return fnName;
    }
    this.emittedTagNameFunctions.add(typeDefId);
    this.out.refinement_helpers
      .writeLine(`static const char* ${fnName}(uint8_t tag) {`)
      .pushIndent()
      .writeLine("switch (tag) {")
      .pushIndent();
    for (let i = 0; i < union.members.length; i++) {
      const name = this.unionVariantPrettyName(union, i);
      this.out.refinement_helpers.writeLine(
        `case ${i}: return "${escapeStringForC(name)[0]}";`
      );
    }
    this.out.refinement_helpers
      .writeLine('default: return "<unknown>";')
      .popIndent()
      .writeLine("}")
      .popIndent()
      .writeLine("}");
    return fnName;
  }

  intFormatSpec(primitive: EPrimitive): string {
    switch (primitive) {
      case EPrimitive.i8:
        return "PRId8";
      case EPrimitive.i16:
        return "PRId16";
      case EPrimitive.i32:
        return "PRId32";
      case EPrimitive.i64:
      case EPrimitive.int:
        return "PRId64";
      case EPrimitive.u8:
        return "PRIu8";
      case EPrimitive.u16:
        return "PRIu16";
      case EPrimitive.u32:
        return "PRIu32";
      case EPrimitive.u64:
      case EPrimitive.usize:
        return "PRIu64";
      default:
        assert(false);
    }
  }

  makeCheckedBinaryArithmeticFunction(
    _leftId: Lowered.ExprId,
    _rightId: Lowered.ExprId,
    plainResultTypeId: Lowered.TypeDefId,
    operation: EBinaryOperation
  ) {
    const plainResultType = this.lr.typeDefNodes.get(plainResultTypeId);

    let opStr = "";
    switch (operation) {
      case EBinaryOperation.Add:
        opStr = "add";
        break;
      case EBinaryOperation.Subtract:
        opStr = "sub";
        break;
      case EBinaryOperation.Multiply:
        opStr = "mul";
        break;
      case EBinaryOperation.Divide:
        opStr = "div";
        break;
      case EBinaryOperation.Modulo:
        opStr = "mod";
        break;
      default:
        assert(false);
    }

    return `hzstd_arithmetic_${opStr}_${this.mangleName(plainResultType.name)}`;
  }

  functionSignatureParts(symbol: Lowered.FunctionSymbol) {
    const ftype = this.lr.typeDefNodes.get(symbol.type);
    assert(ftype.variant === Lowered.ENode.FunctionDatatype);

    return {
      mangledName: this.mangleFunctionSymbol(symbol),
      returnType: this.mangleTypeUse(ftype.returnType),
      params: ftype.parameters.map((p, i) => ({
        type: this.mangleTypeUse(p),
        name: symbol.parameterNames[i],
      })),
      vararg: ftype.vararg,
    };
  }

  emitFunction(symbolId: Lowered.FunctionId) {
    const symbol = this.lr.functionNodes.get(symbolId);
    const { mangledName, returnType, params, vararg } =
      this.functionSignatureParts(symbol);

    let signature = "";
    if (symbol.isLibraryLocal) {
      signature += "static ";
    }

    if (symbol.noreturn) {
      signature += "_Noreturn ";
    }

    signature += returnType + " " + mangledName + "(";
    signature += params.map((p) => `${p.type} ${p.name}`).join(", ");
    if (vararg) {
      signature += ", ...";
    }
    signature += ")";

    this.out.function_declarations.writeLine(signature + ";");

    if (symbol.scope) {
      this.out.function_definitions.writeLine(signature + " {").pushIndent();
      const s = this.emitScope(symbol.scope);
      this.out.function_definitions.write(s.temp);
      this.out.function_definitions.write(s.out);
      this.out.function_definitions.popIndent().writeLine("}").writeLine();
    }

    if (symbol.closureTrampoline) {
      this.emitFunction(symbol.closureTrampoline);
    }
  }

  // Emits the single genuinely-exported symbol for this module: a
  // hzstd_module_metadata_t global listing every `export fn`/`export extern
  // C fn` by name, alongside a same-order table of generated trampolines
  // (currently identity wrappers -- refcounting hooks land later). Everything
  // else about a module's callable surface is meant to be discovered by
  // walking these tables, not via individual OS-level symbol exports.
  emitModuleMetadata() {
    const exportedFunctionIds: Lowered.FunctionId[] = [];
    for (const fId of this.lr.loweredFunctions.values()) {
      const symbol = this.lr.functionNodes.get(fId);
      if (symbol.exported) {
        exportedFunctionIds.push(fId);
      }
    }

    const prefix = this.modulePrefix();
    const functionsArrayName = `__hz_${prefix}_module_functions`;
    const trampolineArrayName = `__hz_${prefix}_module_trampoline_functions`;
    const metadataName = `__hz_${prefix}_module_info`;

    const functionEntries: string[] = [];
    const trampolineEntries: string[] = [];

    for (const fId of exportedFunctionIds) {
      const symbol = this.lr.functionNodes.get(fId);
      const { mangledName, returnType, params, vararg } =
        this.functionSignatureParts(symbol);
      const [escapedName, nameLen] = escapeStringForC(mangledName);
      const nameLiteral = `HZSTD_STRING("${escapedName}", ${nameLen})`;

      functionEntries.push(
        `{ .name = ${nameLiteral}, .function_ptr = (void*)&${mangledName} }`
      );

      // Varargs can't be generically forwarded to another vararg function
      // without va_list plumbing (e.g. the exported `printf` wrapper) -- for
      // those, the trampoline table just points at the real function too.
      if (vararg) {
        trampolineEntries.push(
          `{ .name = ${nameLiteral}, .function_ptr = (void*)&${mangledName} }`
        );
        continue;
      }

      const trampolineName = `__hz_modtramp_${mangledName}`;
      const paramList = params.map((p) => `${p.type} ${p.name}`).join(", ");
      // By-ref parameters carry a leading "*" baked into their name (so
      // `${type} ${name}` renders as a valid pointer declaration, and uses
      // of the name elsewhere in the original function body read as a
      // dereference). Forwarding the pointer itself onward -- as opposed to
      // using its value -- needs the name with that "*" stripped back off.
      const argList = params
        .map((p) => (p.name.startsWith("*") ? p.name.slice(1) : p.name))
        .join(", ");
      const trampolineSignature = `static ${returnType} ${trampolineName}(${paramList})`;

      this.out.function_declarations.writeLine(trampolineSignature + ";");
      this.out.function_definitions
        .writeLine(trampolineSignature + " {")
        .pushIndent();
      this.out.function_definitions.writeLine("// refcount hook: none yet");
      if (returnType === "hzstd_void_t") {
        this.out.function_definitions.writeLine(`${mangledName}(${argList});`);
        this.out.function_definitions.writeLine("// refcount hook: none yet");
        this.out.function_definitions.writeLine("return;");
      } else {
        this.out.function_definitions.writeLine(
          `${returnType} __hz_r = ${mangledName}(${argList});`
        );
        this.out.function_definitions.writeLine("// refcount hook: none yet");
        this.out.function_definitions.writeLine("return __hz_r;");
      }
      this.out.function_definitions.popIndent().writeLine("}").writeLine();

      trampolineEntries.push(
        `{ .name = ${nameLiteral}, .function_ptr = (void*)&${trampolineName} }`
      );
    }

    const count = exportedFunctionIds.length;

    if (count > 0) {
      this.out.global_variables
        .writeLine(
          `static const hzstd_module_function_entry_t ${functionsArrayName}[] = {`
        )
        .pushIndent();
      for (const entry of functionEntries) {
        this.out.global_variables.writeLine(entry + ",");
      }
      this.out.global_variables.popIndent().writeLine("};");

      this.out.global_variables
        .writeLine(
          `static const hzstd_module_function_entry_t ${trampolineArrayName}[] = {`
        )
        .pushIndent();
      for (const entry of trampolineEntries) {
        this.out.global_variables.writeLine(entry + ",");
      }
      this.out.global_variables.popIndent().writeLine("};");
    }

    const [escapedModuleName, moduleNameLen] = escapeStringForC(
      this.config.name
    );
    const [escapedVersion, versionLen] = escapeStringForC(this.config.version);

    this.out.global_variables
      .writeLine(`hzstd_module_metadata_t ${metadataName} = {`)
      .pushIndent();
    this.out.global_variables.writeLine(`.module_id = HZSTD_STRING("", 0),`);
    this.out.global_variables.writeLine(
      `.module_name = HZSTD_STRING("${escapedModuleName}", ${moduleNameLen}),`
    );
    this.out.global_variables.writeLine(
      `.version = HZSTD_STRING("${escapedVersion}", ${versionLen}),`
    );
    this.out.global_variables.writeLine(
      `.functions = { .entries = ${count > 0 ? functionsArrayName : "NULL"}, .count = ${count} },`
    );
    this.out.global_variables.writeLine(
      `.trampoline_functions = { .entries = ${count > 0 ? trampolineArrayName : "NULL"}, .count = ${count} },`
    );
    this.out.global_variables.popIndent().writeLine("};");
  }

  emitScope(scopeId: Lowered.BlockScopeId): {
    temp: OutputWriter;
    out: OutputWriter;
  } {
    const scope = this.lr.blockScopeNodes.get(scopeId);

    const tempWriter = new OutputWriter();
    const outWriter = new OutputWriter();

    let returned = false;
    for (const statementId of scope.statements) {
      const statement = this.lr.statementNodes.get(statementId);
      if (returned) {
        // Ignore dead code and skip it without warning.
        // Usually dead code is stripped entirely in elaboration and never reaches lowering,
        // but in some cases like comptime functions, dead code can get through because
        // in the highlevel elaboration, it isn't dead code, but with monomorphization applied,
        // then turns into dead code. So we can just skip it.
        continue;
      }

      if (statement.variant === Lowered.ENode.ReturnStatement) {
        returned = true;
      }

      const s = this.emitStatement(statementId);
      // Interleave: each statement's setup code (temp) is emitted immediately
      // before that statement rather than being hoisted to the function top.
      // This is required for assertion temps that reference variables which
      // are only declared later in the scope.
      outWriter.write(s.temp);
      outWriter.write(s.out);
    }

    return { temp: tempWriter, out: outWriter };
  }

  emitStatement(
    statementId: Lowered.StatementId,
    noSourceloc = false
  ): {
    temp: OutputWriter;
    out: OutputWriter;
  } {
    const statement = this.lr.statementNodes.get(statementId);

    const tempWriter = new OutputWriter();
    const outWriter = new OutputWriter();
    switch (statement.variant) {
      case Lowered.ENode.ReturnStatement: {
        if (
          statement.sourceloc &&
          this.lr.sr.cc.config.includeSourceloc &&
          !noSourceloc
        ) {
          outWriter.writeLine(
            `#line ${statement.sourceloc.start.line} ${JSON.stringify(
              statement.sourceloc.filename
            )}`
          );
        }
        if (statement.expr) {
          const exprWriter = this.emitExpr(statement.expr);
          tempWriter.write(exprWriter.temp);
          outWriter.writeLine("return " + exprWriter.out.get() + ";");
        } else {
          outWriter.writeLine("return;");
        }
        return { temp: tempWriter, out: outWriter };
      }

      case Lowered.ENode.VariableStatement: {
        if (
          statement.sourceloc &&
          this.lr.sr.cc.config.includeSourceloc &&
          !noSourceloc
        ) {
          outWriter.writeLine(
            `#line ${statement.sourceloc.start.line} ${JSON.stringify(
              statement.sourceloc.filename
            )}`
          );
        }
        outWriter.write(
          `${this.mangleTypeUse(statement.type)} ${this.mangleName(statement.name)}`
        );

        if (statement.value) {
          const exprWriter = this.emitExpr(statement.value);
          tempWriter.write(exprWriter.temp);

          let exprValue = exprWriter.out.get();

          if (statement.intrinsicTakeAddrOfValue) {
            exprValue = `&(${exprValue})`;
          }

          outWriter.writeLine(` = ${exprValue};`);
        } else {
          const statementType = this.lr.typeUseNodes.get(statement.type);
          const statementTypeDef = this.lr.typeDefNodes.get(statementType.type);
          if (
            statementTypeDef.variant === Lowered.ENode.StructDatatype &&
            statementTypeDef.members.length === 0
          ) {
            outWriter.writeLine(";");
          } else {
            outWriter.writeLine(" = {0};");
          }
        }
        return { temp: tempWriter, out: outWriter };
      }

      case Lowered.ENode.ExprStatement: {
        if (
          statement.sourceloc &&
          this.lr.sr.cc.config.includeSourceloc &&
          !noSourceloc
        ) {
          outWriter.writeLine(
            `#line ${statement.sourceloc.start.line} ${JSON.stringify(
              statement.sourceloc.filename
            )}`
          );
        }

        const statementExpr = this.lr.exprNodes.get(statement.expr);
        const statementExprTypeUse = this.lr.typeUseNodes.get(
          statementExpr.type
        );
        const statementExprTypeDef = this.lr.typeDefNodes.get(
          statementExprTypeUse.type
        );
        const isVoid =
          statementExprTypeDef.variant === Lowered.ENode.PrimitiveDatatype &&
          statementExprTypeDef.primitive === EPrimitive.void;

        const exprWriter = this.emitExpr(statement.expr);
        tempWriter.write(exprWriter.temp);

        if (isVoid) {
          outWriter.writeLine(`${exprWriter.out.get()};`);
        } else {
          outWriter.writeLine(`(void)(${exprWriter.out.get()});`);
        }
        return { temp: tempWriter, out: outWriter };
      }

      case Lowered.ENode.InlineCStatement: {
        if (
          statement.sourceloc &&
          this.lr.sr.cc.config.includeSourceloc &&
          !noSourceloc
        ) {
          outWriter.writeLine(
            `#line ${statement.sourceloc.start.line} ${JSON.stringify(
              statement.sourceloc.filename
            )}`
          );
        }
        outWriter.writeLine(statement.value);
        return { temp: tempWriter, out: outWriter };
      }

      case Lowered.ENode.ForStatement: {
        if (
          statement.sourceloc &&
          this.lr.sr.cc.config.includeSourceloc &&
          !noSourceloc
        ) {
          outWriter.writeLine(
            `#line ${statement.sourceloc.start.line} ${JSON.stringify(
              statement.sourceloc.filename
            )}`
          );
        }

        const loopCondition = statement.loopCondition
          ? this.emitExpr(statement.loopCondition)
          : null;
        if (loopCondition) {
          tempWriter.write(loopCondition.temp);
        }

        const loopIncrement = statement.loopIncrement
          ? this.emitExpr(statement.loopIncrement)
          : null;
        if (loopIncrement) {
          tempWriter.write(loopIncrement.temp);
        }

        const initStatements = statement.initStatements.map((s) => {
          const a = this.emitStatement(s, true);
          tempWriter.write(a.temp);
          return a.out.get();
        });
        assert(
          initStatements.length === 1,
          "The init statement in a for loop cannot be so complex that it requires multiple statements in C"
        );

        outWriter
          .writeLine(
            `for (${initStatements[0] ?? ""} ${loopCondition ? loopCondition.out.get() : ""}; ${
              loopIncrement ? "(void)(" + loopIncrement.out.get() + ")" : ""
            }) {`
          )
          .pushIndent();

        const scope = this.emitScope(statement.body);
        tempWriter.write(scope.temp);
        outWriter.write(scope.out);
        outWriter.popIndent().writeLine("}");
        return { temp: tempWriter, out: outWriter };
      }

      case Lowered.ENode.WhileStatement: {
        if (
          statement.sourceloc &&
          this.lr.sr.cc.config.includeSourceloc &&
          !noSourceloc
        ) {
          outWriter.writeLine(
            `#line ${statement.sourceloc.start.line} ${JSON.stringify(
              statement.sourceloc.filename
            )}`
          );
        }
        const exprWriter = this.emitExpr(statement.condition);
        tempWriter.write(exprWriter.temp);
        outWriter.writeLine(`while (${exprWriter.out.get()}) {`).pushIndent();
        const scope = this.emitScope(statement.thenBlock);
        tempWriter.write(scope.temp);
        outWriter.write(scope.out);
        outWriter.popIndent().writeLine("}");
        return { temp: tempWriter, out: outWriter };
      }

      case Lowered.ENode.IfStatement: {
        if (
          statement.sourceloc &&
          this.lr.sr.cc.config.includeSourceloc &&
          !noSourceloc
        ) {
          outWriter.writeLine(
            `#line ${statement.sourceloc.start.line} ${JSON.stringify(
              statement.sourceloc.filename
            )}`
          );
        }
        const exprWriter = this.emitExpr(statement.condition);
        tempWriter.write(exprWriter.temp);
        outWriter.writeLine(`if (${exprWriter.out.get()}) {`).pushIndent();
        const scope = this.emitScope(statement.thenBlock);
        tempWriter.write(scope.temp);
        outWriter.write(scope.out);
        outWriter.popIndent().writeLine("}");
        for (const elseif of statement.elseIfs) {
          const exprWriter = this.emitExpr(elseif.condition);
          tempWriter.write(exprWriter.temp);
          outWriter
            .writeLine(`else if (${exprWriter.out.get()}) {`)
            .pushIndent();
          const s = this.emitScope(elseif.thenBlock);
          tempWriter.write(s.temp);
          outWriter.write(s.out);
          outWriter.popIndent().writeLine("}");
        }
        if (statement.else) {
          outWriter.writeLine("else {").pushIndent();
          const scope = this.emitScope(statement.else);
          tempWriter.write(scope.temp);
          outWriter.write(scope.out);
          outWriter.popIndent().writeLine("}");
        }
        return { temp: tempWriter, out: outWriter };
      }

      case Lowered.ENode.LabelJumpStatement: {
        if (
          statement.sourceloc &&
          this.lr.sr.cc.config.includeSourceloc &&
          !noSourceloc
        ) {
          outWriter.writeLine(
            `#line ${statement.sourceloc.start.line} ${JSON.stringify(
              statement.sourceloc.filename
            )}`
          );
        }
        outWriter.writeLine(`goto ${statement.labelName};`).pushIndent();
        return { temp: tempWriter, out: outWriter };
      }

      case Lowered.ENode.LabelDefinitionStatement: {
        if (
          statement.sourceloc &&
          this.lr.sr.cc.config.includeSourceloc &&
          !noSourceloc
        ) {
          outWriter.writeLine(
            `#line ${statement.sourceloc.start.line} ${JSON.stringify(
              statement.sourceloc.filename
            )}`
          );
        }
        // The semicolon is for safety because a label at the end of a scope it not valid standard C
        // but with the semicolon it is
        outWriter.writeLine(`${statement.labelName}:;`).pushIndent();
        return { temp: tempWriter, out: outWriter };
      }

      default:
        throw new InternalError("Unknown statement type: ");
    }
  }

  emitExpr(exprId: Lowered.ExprId): { temp: OutputWriter; out: OutputWriter } {
    const expr = this.lr.exprNodes.get(exprId);

    if (!expr) {
      throw new InternalError("Expr is null", undefined, 1);
    }
    const tempWriter = new OutputWriter();
    const outWriter = new OutputWriter();
    switch (expr.variant) {
      case Lowered.ENode.ExprCallExpr: {
        const args = expr.arguments.map((a) => {
          const r = this.emitExpr(a);
          tempWriter.write(r.temp);
          return r.out.get();
        });
        const callExprWriter = this.emitExpr(expr.expr);
        tempWriter.write(callExprWriter.temp);
        // const funcname = this.mangleNestedName(this.lr.functions.get(expr.functionSymbol)!);
        // outWriter.write(`_H${funcname}`);
        outWriter.write(callExprWriter.out.get() + "(" + args.join(", ") + ")");

        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.StructLiteralExpr: {
        outWriter
          .writeLine(`((${this.mangleTypeUse(expr.type)}) { `)
          .pushIndent();
        for (const assign of expr.memberAssigns) {
          const exprWriter = this.emitExpr(assign.value);
          tempWriter.write(exprWriter.temp);
          outWriter.writeLine(`.${assign.name} = ${exprWriter.out.get()}, `);
        }
        outWriter.popIndent().write(" })");
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.MemberAccessExpr: {
        const exprWriter = this.emitExpr(expr.expr);
        tempWriter.write(exprWriter.temp);

        const e = this.lr.exprNodes.get(expr.expr);
        const eTypeUse = this.lr.typeUseNodes.get(
          Lowered.resolveAlias(this.lr, e.type)
        );
        const eTypeDef = this.lr.typeDefNodes.get(eTypeUse.type);

        if (eTypeDef.variant === Lowered.ENode.StructDatatype) {
          let exprCode = exprWriter.out.get();

          let requiresParens = true;
          if (e.variant === Lowered.ENode.SymbolValueExpr) {
            // This is still a bit of a hack, we should find a better solution for hoisting
            // by introducing another compiler phase and separating
            // lowering and code generation further, so we can lower into a real
            // AST that has C features, and only THEN actually emit C code.
            // Currently the issue is that we go straight from lowering to C code,
            // and lowering is actually mainly a cleanup and optimization pass,
            // but the output it produces does not actually represent the raw C language.
            if (!e.name.mangledName.startsWith("*")) {
              requiresParens = false;
            }
          }
          if (requiresParens) {
            exprCode = `(${exprCode})`;
          }

          if (expr.requiresDeref) {
            outWriter.write(exprCode + "->" + expr.memberName);
          } else {
            outWriter.write(exprCode + "." + expr.memberName);
          }
        } else if (
          eTypeDef.variant === Lowered.ENode.PrimitiveDatatype &&
          eTypeDef.primitive === EPrimitive.str &&
          expr.memberName === "length"
        ) {
          outWriter.write("(" + exprWriter.out.get() + ")." + expr.memberName);
        } else if (
          eTypeDef.variant === Lowered.ENode.CallableDatatype &&
          (expr.memberName === "env" || expr.memberName === "fn")
        ) {
          outWriter.write("(" + exprWriter.out.get() + ")." + expr.memberName);
        } else if (
          eTypeDef.variant === Lowered.ENode.DynamicArrayDatatype &&
          expr.memberName === "length"
        ) {
          outWriter.write(
            "hzstd_dynamic_array_size(" + exprWriter.out.get() + ")"
          );
        } else if (
          eTypeDef.variant === Lowered.ENode.ReactiveDatatype &&
          expr.memberName === "length"
        ) {
          outWriter.write(
            "HZSTD_REACTIVE_ARRAY_LENGTH(" + exprWriter.out.get() + ")"
          );
        } else {
          assert(false);
        }

        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.SymbolValueExpr: {
        outWriter.write(this.mangleName(expr.name));
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.BlockScopeExpr: {
        const block = this.lr.blockScopeNodes.get(expr.block);
        if (block.emittedExpr) {
          outWriter.writeLine("({").pushIndent();
          const scope = this.emitScope(expr.block);
          tempWriter.write(scope.temp);
          outWriter.write(scope.out);
          const emitted = this.emitExpr(block.emittedExpr);
          outWriter
            .writeLine(emitted.out.get() + ";")
            .popIndent()
            .write("})");
        } else {
          outWriter.writeLine("({").pushIndent();
          const scope = this.emitScope(expr.block);
          tempWriter.write(scope.temp);
          outWriter.write(scope.out);
          outWriter.popIndent().write("})");
        }
        return { temp: tempWriter, out: outWriter };
      }

      case Lowered.ENode.ExplicitCastExpr: {
        const exprWriter = this.emitExpr(expr.expr);
        tempWriter.write(exprWriter.temp);

        const typeUse = this.lr.typeUseNodes.get(
          Lowered.resolveAlias(this.lr, expr.type)
        );
        const type = this.lr.typeDefNodes.get(typeUse.type);
        if (
          type.variant === Lowered.ENode.PrimitiveDatatype &&
          type.primitive === EPrimitive.cptr
        ) {
          const sourceExpr = this.lr.exprNodes.get(expr.expr);
          const exprTypeUse = this.lr.typeUseNodes.get(sourceExpr.type);
          const exprType = this.lr.typeDefNodes.get(exprTypeUse.type);
          if (
            exprType.variant === Lowered.ENode.PrimitiveDatatype &&
            exprType.primitive === EPrimitive.none
          ) {
            outWriter.write(`((${this.mangleTypeUse(expr.type)})NULL)`);
            return { out: outWriter, temp: tempWriter };
          }
        }

        if (type.variant === Lowered.ENode.CallableDatatype) {
          const sourceExpr = this.lr.exprNodes.get(expr.expr);
          const exprTypeUse = this.lr.typeUseNodes.get(sourceExpr.type);
          const exprType = this.lr.typeDefNodes.get(exprTypeUse.type);
          if (exprType.variant === Lowered.ENode.CallableDatatype) {
            outWriter.write(
              `({ ${this.mangleTypeUse(sourceExpr.type)} __tmp = ${this.emitExpr(expr.expr).out.get()}; (${this.mangleTypeUse(expr.type)}){ .env=__tmp.env, .fn=__tmp.fn }; })`
            );
            return { out: outWriter, temp: tempWriter };
          }
        }

        if (expr.integerNarrowingRange === null || this.inGlobalScope) {
          outWriter.write(
            `((${this.mangleTypeUse(expr.type)})(${exprWriter.out.get()}))`
          );
        } else {
          // Resolve source primitive to determine which bounds need runtime
          // checking and emit bound literals cast to the source type —
          // avoiding any signed/unsigned promotion mismatch in the comparison.
          const tgtResolvedId = Lowered.resolveAlias(this.lr, expr.type);
          const tgtTypeUse = this.lr.typeUseNodes.get(tgtResolvedId);

          const srcResolvedId = Lowered.resolveAlias(
            this.lr,
            this.lr.exprNodes.get(expr.expr).type
          );
          const srcTypeDef = this.lr.typeDefNodes.get(
            this.lr.typeUseNodes.get(srcResolvedId).type
          );
          assert(srcTypeDef.variant === Lowered.ENode.PrimitiveDatatype);
          const srcPrimitive = srcTypeDef.primitive;
          const [srcMin, srcMax] = Conversion.getIntegerMinMax(srcPrimitive);
          const { min: tgtMin, max: tgtMax } = expr.integerNarrowingRange;
          const needsLower = srcMin < tgtMin;
          const needsUpper = srcMax > tgtMax;

          type IntLiteralPrimitive =
            | EPrimitive.i8
            | EPrimitive.i16
            | EPrimitive.i32
            | EPrimitive.i64
            | EPrimitive.u8
            | EPrimitive.u16
            | EPrimitive.u32
            | EPrimitive.u64
            | EPrimitive.usize
            | EPrimitive.int;
          const emitBound = (v: bigint) => {
            const flattened: Lowered.StatementId[] = [];
            const lowered = lowerExpr(
              this.lr,
              this.lr.sr.b.literalValue(
                {
                  type: srcPrimitive as IntLiteralPrimitive,
                  unit: null,
                  value: v,
                },
                null
              )[1],
              flattened,
              { returnedInstanceIds: new Set() }
            )[1];
            return this.emitExpr(lowered).out.get();
          };

          const parts: string[] = [];
          if (needsLower) {
            parts.push(`__hz_tmp < ${emitBound(tgtMin)}`);
          }
          if (needsUpper) {
            parts.push(`__hz_tmp > ${emitBound(tgtMax)}`);
          }

          if (parts.length === 0) {
            outWriter.write(
              `((${this.mangleTypeUse(expr.type)})(${exprWriter.out.get()}))`
            );
          } else {
            const targetPrettyName = tgtTypeUse.name.prettyName;
            const fmtSpec = this.intFormatSpec(srcPrimitive);
            outWriter.write(
              `HZ_ASSERT_INT_RANGE(${exprWriter.out.get()}, ${this.mangleTypeUse(expr.type)}, (${parts.join(" || ")}), "${targetPrettyName}", ${fmtSpec})`
            );
          }
        }
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.ValueToUnionCastExpr: {
        const exprWriter = this.emitExpr(expr.expr);
        tempWriter.write(exprWriter.temp);
        const typeUse = this.lr.typeUseNodes.get(
          Lowered.resolveAlias(this.lr, expr.type)
        );
        const union = this.lr.typeDefNodes.get(typeUse.type);
        assert(
          union.variant === Lowered.ENode.UntaggedUnionDatatype ||
            union.variant === Lowered.ENode.TaggedUnionDatatype
        );

        if (union.optimizeAsRawPointer) {
          if (expr.optimizeExprToNullptr) {
            outWriter.write(`((${this.mangleTypeUse(expr.type)})(0))`);
          } else {
            outWriter.write(
              `((${this.mangleTypeUse(expr.type)})(${this.emitExpr(expr.expr).out.get()}))`
            );
          }
        } else {
          outWriter.write(
            `((${this.mangleTypeUse(expr.type)}) { .tag = ${expr.index}, .as_tag_${
              expr.index
            } = ${this.emitExpr(expr.expr).out.get()} })`
          );
        }
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.UnionToValueCastExpr: {
        const exprWriter = this.emitExpr(expr.expr);
        tempWriter.write(exprWriter.temp);
        const typeUse = this.lr.typeUseNodes.get(
          Lowered.resolveAlias(this.lr, this.lr.exprNodes.get(expr.expr).type)
        );
        const union = this.lr.typeDefNodes.get(typeUse.type);
        assert(
          union.variant === Lowered.ENode.UntaggedUnionDatatype ||
            union.variant === Lowered.ENode.TaggedUnionDatatype
        );

        if (union.optimizeAsRawPointer) {
          // Casting nullable pointer union to a target type.
          // If target is none/null, emit a none struct literal — the value itself is a pointer.
          const targetTypeDef = this.lr.typeDefNodes.get(
            this.lr.typeUseNodes.get(Lowered.resolveAlias(this.lr, expr.type))
              .type
          );
          if (
            targetTypeDef.variant === Lowered.ENode.PrimitiveDatatype &&
            (targetTypeDef.primitive === EPrimitive.none ||
              targetTypeDef.primitive === EPrimitive.null)
          ) {
            outWriter.write(`(${this.mangleTypeUse(expr.type)}){}`);
          } else {
            outWriter.write(`(${this.emitExpr(expr.expr).out.get()})`);
          }
        } else if (expr.needsRefinementAssertion) {
          const inner = this.emitExpr(expr.expr).out.get();
          const type = this.lr.typeUseNodes.get(
            this.lr.exprNodes.get(expr.expr).type
          );
          const tagNameFn = this.ensureUnionTagNameFunction(typeUse.type);
          const expectedName = this.unionVariantPrettyName(union, expr.index);
          outWriter.write(
            `*({ ${this.mangleName(type.name)} __v = ${inner}; &HZ_GET_UNION_TAG(__v, ${expr.index}, "${escapeStringForC(expectedName)[0]}", ${tagNameFn}); })`
          );
        } else {
          outWriter.write(
            `((${this.emitExpr(expr.expr).out.get()}).as_tag_${expr.index})`
          );
        }
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.UnionToUnionCastExpr: {
        const exprWriter = this.emitExpr(expr.expr);
        tempWriter.write(exprWriter.temp);
        const typeUse = this.lr.typeUseNodes.get(expr.type);
        const union = this.lr.typeDefNodes.get(typeUse.type);
        assert(
          union.variant === Lowered.ENode.UntaggedUnionDatatype ||
            union.variant === Lowered.ENode.TaggedUnionDatatype
        );

        if (union.optimizeAsRawPointer) {
          // TODO: This is not finally implemented, it is only a quick fix
          outWriter.write(this.emitExpr(expr.expr).out.get());
        } else {
          const mappingName = makeUnionMappingName(
            expr.tagMapping.from,
            expr.tagMapping.to
          );
          if (expr.needsRefinementAssertion) {
            const validTags = [...expr.tagMapping.mapping.keys()];
            const condition = validTags
              .map((t) => `__hz_tmp.tag == ${t}`)
              .join(" || ");
            const srcTypeUse = this.lr.typeUseNodes.get(
              Lowered.resolveAlias(this.lr, expr.tagMapping.from)
            );
            const srcUnion = this.lr.typeDefNodes.get(srcTypeUse.type);
            assert(
              srcUnion.variant === Lowered.ENode.UntaggedUnionDatatype ||
                srcUnion.variant === Lowered.ENode.TaggedUnionDatatype
            );
            const tagNameFn = this.ensureUnionTagNameFunction(srcTypeUse.type);
            const validSetStr = validTags
              .map((t) => this.unionVariantPrettyName(srcUnion, t))
              .join(" | ");
            outWriter.write(
              `HZ_ASSERT_UNION_SET(${this.emitExpr(expr.expr).out.get()}, (${condition}), ${mappingName}, "${validSetStr}", ${tagNameFn})`
            );
          } else {
            outWriter.write(
              `(${mappingName}(${this.emitExpr(expr.expr).out.get()}))`
            );
          }
        }
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.UnionTagCheckExpr: {
        const exprWriter = this.emitExpr(expr.expr);
        tempWriter.write(exprWriter.temp);
        const typeUse = this.lr.typeUseNodes.get(
          Lowered.resolveAlias(this.lr, this.lr.exprNodes.get(expr.expr).type)
        );
        const union = this.lr.typeDefNodes.get(typeUse.type);
        assert(
          union.variant === Lowered.ENode.UntaggedUnionDatatype ||
            union.variant === Lowered.ENode.TaggedUnionDatatype
        );

        const operator = expr.invertCheck ? "!=" : "==";
        if (union.optimizeAsRawPointer) {
          assert(expr.optimizeExprToNullptr);
          outWriter.write(
            `((${this.emitExpr(expr.expr).out.get()}) ${operator} NULL)`
          );
        } else if (expr.tags.length === 1) {
          outWriter.write(
            `((${this.emitExpr(expr.expr).out.get()}).tag ${operator} ${expr.tags[0]})`
          );
        } else {
          const exprType = this.lr.typeUseNodes.get(expr.type);
          outWriter.write(
            `({ ${this.mangleName(exprType.name)} __value = ${this.emitExpr(
              expr.expr
            ).out.get()}; ${expr.tags
              .map((t) => `value.tag ${operator} ${t}`)
              .join(expr.invertCheck ? " && " : " || ")}; })`
          );
        }
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.UnaryExpr:
        switch (expr.operation) {
          case EUnaryOperation.Minus:
          case EUnaryOperation.Plus:
          case EUnaryOperation.Negate: {
            const writer = this.emitExpr(expr.expr);
            tempWriter.write(writer.temp);
            outWriter.write(
              "(" +
                UnaryOperationToString(expr.operation) +
                "(" +
                writer.out.get() +
                "))"
            );
            break;
          }
          default:
            assert(false);
        }
        return { out: outWriter, temp: tempWriter };

      case Lowered.ENode.BinaryExpr:
        switch (expr.operation) {
          case EBinaryOperation.Multiply:
          case EBinaryOperation.Divide:
          case EBinaryOperation.Modulo:
          case EBinaryOperation.Add:
          case EBinaryOperation.Subtract: {
            const leftWriter = this.emitExpr(expr.left);
            const rightWriter = this.emitExpr(expr.right);
            tempWriter.write(leftWriter.temp);
            tempWriter.write(rightWriter.temp);

            const left = this.lr.exprNodes.get(expr.left);
            const leftType = this.lr.typeUseNodes.get(
              Lowered.resolveAlias(this.lr, left.type)
            );
            const leftTypeDef = this.lr.typeDefNodes.get(leftType.type);
            const right = this.lr.exprNodes.get(expr.right);
            const rightType = this.lr.typeUseNodes.get(
              Lowered.resolveAlias(this.lr, right.type)
            );
            const rightTypeDef = this.lr.typeDefNodes.get(rightType.type);
            assert(
              leftTypeDef.variant === Lowered.ENode.PrimitiveDatatype &&
                rightTypeDef.variant === Lowered.ENode.PrimitiveDatatype &&
                leftTypeDef.primitive === rightTypeDef.primitive
            );
            if (Conversion.isInteger(leftTypeDef.primitive)) {
              const functionName = this.makeCheckedBinaryArithmeticFunction(
                expr.left,
                expr.right,
                expr.plainResultType,
                expr.operation
              );
              outWriter.write(
                functionName +
                  "(" +
                  leftWriter.out.get() +
                  ", " +
                  rightWriter.out.get() +
                  ")"
              );
            } else {
              outWriter.write(
                "(" +
                  leftWriter.out.get() +
                  " " +
                  BinaryOperationToString(expr.operation) +
                  " " +
                  rightWriter.out.get() +
                  ")"
              );
            }
            break;
          }

          case EBinaryOperation.LessEqual:
          case EBinaryOperation.LessThan:
          case EBinaryOperation.GreaterEqual:
          case EBinaryOperation.GreaterThan: {
            const leftWriter = this.emitExpr(expr.left);
            const rightWriter = this.emitExpr(expr.right);
            tempWriter.write(leftWriter.temp);
            tempWriter.write(rightWriter.temp);

            const leftType = this.lr.typeDefNodes.get(
              this.lr.typeUseNodes.get(
                Lowered.resolveAlias(
                  this.lr,
                  this.lr.exprNodes.get(expr.left).type
                )
              ).type
            );
            const rightType = this.lr.typeDefNodes.get(
              this.lr.typeUseNodes.get(
                Lowered.resolveAlias(
                  this.lr,
                  this.lr.exprNodes.get(expr.right).type
                )
              ).type
            );

            const left = leftWriter.out.get();
            const right = rightWriter.out.get();
            if (
              leftType.variant === Lowered.ENode.PrimitiveDatatype &&
              rightType.variant === Lowered.ENode.PrimitiveDatatype &&
              Conversion.isInteger(leftType.primitive) &&
              Conversion.isInteger(rightType.primitive)
            ) {
              const leftSigned = Conversion.isSignedInteger(leftType.primitive);
              const rightSigned = Conversion.isSignedInteger(
                rightType.primitive
              );

              const plan: IntComparisonPlan = {
                leftBits: Conversion.getIntegerBits(leftType.primitive),
                rightBits: Conversion.getIntegerBits(rightType.primitive),
                leftUnsigned: !leftSigned,
                rightUnsigned: !rightSigned,
              };

              outWriter.write(
                emitIntCompare(left, right, plan, expr.operation)
              );
              break;
            }

            outWriter.write(
              "(" +
                leftWriter.out.get() +
                " " +
                BinaryOperationToString(expr.operation) +
                " " +
                rightWriter.out.get() +
                ")"
            );
            break;
          }

          case EBinaryOperation.Equal:
          case EBinaryOperation.NotEqual: {
            const leftWriter = this.emitExpr(expr.left);
            const rightWriter = this.emitExpr(expr.right);
            tempWriter.write(leftWriter.temp);
            tempWriter.write(rightWriter.temp);

            const leftType = this.lr.typeDefNodes.get(
              this.lr.typeUseNodes.get(
                Lowered.resolveAlias(
                  this.lr,
                  this.lr.exprNodes.get(expr.left).type
                )
              ).type
            );
            const rightType = this.lr.typeDefNodes.get(
              this.lr.typeUseNodes.get(
                Lowered.resolveAlias(
                  this.lr,
                  this.lr.exprNodes.get(expr.right).type
                )
              ).type
            );

            const left = leftWriter.out.get();
            const right = rightWriter.out.get();
            if (
              leftType.variant === Lowered.ENode.PrimitiveDatatype &&
              rightType.variant === Lowered.ENode.PrimitiveDatatype &&
              Conversion.isInteger(leftType.primitive) &&
              Conversion.isInteger(rightType.primitive)
            ) {
              const leftSigned = Conversion.isSignedInteger(leftType.primitive);
              const rightSigned = Conversion.isSignedInteger(
                rightType.primitive
              );

              const plan: IntComparisonPlan = {
                leftBits: Conversion.getIntegerBits(leftType.primitive),
                rightBits: Conversion.getIntegerBits(rightType.primitive),
                leftUnsigned: !leftSigned,
                rightUnsigned: !rightSigned,
              };

              outWriter.write(
                emitIntCompare(left, right, plan, expr.operation)
              );
              break;
            }

            outWriter.write(
              "(" +
                left +
                " " +
                BinaryOperationToString(expr.operation) +
                " " +
                right +
                ")"
            );
            break;
          }

          case EBinaryOperation.BoolAnd:
          case EBinaryOperation.BoolOr: {
            const leftWriter = this.emitExpr(expr.left);
            const rightWriter = this.emitExpr(expr.right);
            tempWriter.write(leftWriter.temp);
            tempWriter.write(rightWriter.temp);
            outWriter.write(
              "(" +
                leftWriter.out.get() +
                " " +
                BinaryOperationToString(expr.operation) +
                " " +
                rightWriter.out.get() +
                ")"
            );
            break;
          }

          case EBinaryOperation.BitwiseOr: {
            const leftWriter = this.emitExpr(expr.left);
            const rightWriter = this.emitExpr(expr.right);
            tempWriter.write(leftWriter.temp);
            tempWriter.write(rightWriter.temp);
            outWriter.write(
              "(" +
                leftWriter.out.get() +
                " " +
                BinaryOperationToString(expr.operation) +
                " " +
                rightWriter.out.get() +
                ")"
            );
            break;
          }

          default:
            assert(false);
        }
        return { out: outWriter, temp: tempWriter };

      case Lowered.ENode.CallableExpr: {
        let env = "NULL";
        if (expr.envValue?.type === "method") {
          const thisExpr = this.emitExpr(expr.envValue.thisExpr);
          tempWriter.write(thisExpr.temp);
          env = `HZSTD_ENV_BLOCK_FOR_THIS_PTR(${thisExpr.out.get()})`;
        } else if (
          expr.envValue?.type === "lambda" &&
          expr.envValue.captures.length > 0
        ) {
          const setters = expr.envValue.captures.map((c, i) => {
            const e = this.emitExpr(c);
            tempWriter.write(e.temp);
            return `env[${i}] = ${e.out.get()};`;
          });
          env = `({ void** env = hzstd_heap_allocate(sizeof(void*) * ${expr.envValue.captures.length}); ${setters.join(" ")} (void*)env; })`;
        }
        const func = this.lr.functionNodes.get(expr.function);
        outWriter.write(
          `((${this.mangleTypeUse(
            expr.type
          )}) { .fn = ${this.mangleName(func.name)}, .env = ${env} })`
        );
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.AddressOfExpr: {
        const e = this.emitExpr(expr.expr);
        tempWriter.write(e.temp);
        outWriter.write("&" + e.out.get());
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.DereferenceExpr: {
        const e = this.emitExpr(expr.expr);
        tempWriter.write(e.temp);
        outWriter.write("*" + e.out.get());
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.SizeofExpr: {
        const e = this.emitExpr(expr.value);
        tempWriter.write(e.temp);
        outWriter.write("sizeof(" + e.out.get() + ")");
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.AlignofExpr: {
        const e = this.emitExpr(expr.value);
        tempWriter.write(e.temp);
        outWriter.write("alignof(" + e.out.get() + ")");
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.ExprAssignmentExpr: {
        const target = this.emitExpr(expr.target);
        const value = this.emitExpr(expr.value);
        tempWriter.write(target.temp);
        tempWriter.write(value.temp);

        const targetExpr = this.lr.exprNodes.get(expr.target);
        const typeUse = this.lr.typeUseNodes.get(
          Lowered.resolveAlias(this.lr, targetExpr.type)
        );
        const typeDef = this.lr.typeDefNodes.get(typeUse.type);

        if (
          typeDef.variant === Lowered.ENode.PrimitiveDatatype ||
          typeDef.variant === Lowered.ENode.FunctionDatatype ||
          typeDef.variant === Lowered.ENode.CallableDatatype ||
          typeDef.variant === Lowered.ENode.ReactiveDatatype ||
          typeDef.variant === Lowered.ENode.LiteralDatatype ||
          typeDef.variant === Lowered.ENode.ComputedDatatype ||
          typeDef.variant === Lowered.ENode.EnumDatatype
        ) {
          outWriter.write(
            "(" + target.out.get() + " = " + value.out.get() + ")"
          );
        } else if (
          typeDef.variant === Lowered.ENode.StructDatatype ||
          typeDef.variant === Lowered.ENode.DynamicArrayDatatype
        ) {
          if (expr.assignRefTarget) {
            outWriter.write(
              "(*" + target.out.get() + " = " + value.out.get() + ")"
            );
          } else {
            outWriter.write(
              "(" + target.out.get() + " = " + value.out.get() + ")"
            );
          }
        } else if (
          typeDef.variant === Lowered.ENode.UntaggedUnionDatatype ||
          typeDef.variant === Lowered.ENode.TaggedUnionDatatype
        ) {
          if (expr.assignRefTarget) {
            outWriter.write(
              "(*" + target.out.get() + " = " + value.out.get() + ")"
            );
          } else {
            outWriter.write(
              "(" + target.out.get() + " = " + value.out.get() + ")"
            );
          }
        } else {
          assert(false);
        }

        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.ArrayLiteralExpr: {
        const values = expr.values.map((v) => {
          const e = this.emitExpr(v);
          tempWriter.write(e.temp);
          return e.out;
        });

        const typeUse = this.lr.typeUseNodes.get(expr.type);
        const typeDef = this.lr.typeDefNodes.get(typeUse.type);
        if (typeDef.variant === Lowered.ENode.FixedArrayDatatype) {
          outWriter.write(
            `(${this.mangleTypeUse(expr.type)}){ .data = {${values
              .map((v) => v.get())
              .join(", ")}} }`
          );
        } else if (typeDef.variant === Lowered.ENode.DynamicArrayDatatype) {
          assert(false, "should have been transpiled away");
        } else {
          assert(false);
        }

        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.StringSubscriptExpr: {
        const e = this.emitExpr(expr.expr);
        tempWriter.write(e.temp);
        const index = this.emitExpr(expr.index);

        const typeUse = this.lr.typeUseNodes.get(
          this.lr.exprNodes.get(expr.expr).type
        );
        const typeDef = this.lr.typeDefNodes.get(typeUse.type);
        assert(
          typeDef.variant === Lowered.ENode.PrimitiveDatatype &&
            typeDef.primitive === EPrimitive.str
        );

        tempWriter.write(index.temp);
        outWriter.write(
          `HZSTD_STRING_GET_BYTE(${e.out.get()}, ${index.out.get()})`
        );
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.ArraySubscriptExpr: {
        const e = this.emitExpr(expr.expr);
        tempWriter.write(e.temp);
        const index = this.emitExpr(expr.index);

        const typeUse = this.lr.typeUseNodes.get(
          this.lr.exprNodes.get(expr.expr).type
        );
        const typeDef = this.lr.typeDefNodes.get(typeUse.type);
        assert(
          typeDef.variant === Lowered.ENode.FixedArrayDatatype ||
            typeDef.variant === Lowered.ENode.DynamicArrayDatatype
        );

        const elementType = this.lr.typeUseNodes.get(typeDef.datatype);

        if (typeDef.variant === Lowered.ENode.FixedArrayDatatype) {
          tempWriter.write(index.temp);
          outWriter.write(
            `HZSTD_ARRAY_GET(${e.out.get()}, ${index.out.get()}, ${typeDef.length})`
          );
          return { out: outWriter, temp: tempWriter };
        }
        if (typeDef.variant === Lowered.ENode.DynamicArrayDatatype) {
          tempWriter.write(index.temp);
          outWriter.write(
            `HZSTD_DYNAMIC_ARRAY_GET(${e.out.get()}, ${this.mangleName(
              elementType.name
            )}, ${index.out.get()})`
          );
          return { out: outWriter, temp: tempWriter };
        }
        assert(false);
        throw new Error();
      }

      case Lowered.ENode.ArraySliceExpr: {
        const e = this.emitExpr(expr.expr);
        const sliceType = this.lr.typeUseNodes.get(expr.type);
        const arrayExpr = this.lr.exprNodes.get(expr.expr);
        const arrayExprType = this.lr.typeUseNodes.get(arrayExpr.type);
        const arrayExprTypeDef = this.lr.typeDefNodes.get(arrayExprType.type);
        assert(arrayExpr.variant !== Lowered.ENode.ArrayLiteralExpr);
        assert(arrayExprTypeDef.variant === Lowered.ENode.FixedArrayDatatype);

        tempWriter.write(e.temp);
        const startIndex = this.emitExpr(expr.start);
        const endIndex = this.emitExpr(expr.end);
        tempWriter.write(startIndex.temp);
        tempWriter.write(endIndex.temp);

        const array = e.out.get();
        outWriter.write(
          `(${this.mangleTypeUse(
            sliceType
          )}){ .data=(${array}).data + ${startIndex.out.get()}, .length=(${endIndex.out.get()} - ${startIndex.out.get()}) }`
        );
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.DatatypeAsValueExpr: {
        outWriter.write(this.mangleTypeUse(expr.type));
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.StringConstructExpr: {
        const data = this.emitExpr(expr.value.data);
        tempWriter.write(data.temp);

        const length = this.emitExpr(expr.value.length);
        tempWriter.write(length.temp);

        // outWriter.write(
        //   `(hzstd_str_t){ .data=(hzstd_ccstr_t)${data.out.get()}, .length=${length.out.get()} }`
        // );
        outWriter.write(`HZSTD_STRING(${data.out.get()}, ${length.out.get()})`);
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.LiteralExpr: {
        function stringifyWithDecimal(num: number) {
          const s = num.toString();
          return s.includes(".") ? s : s + ".0";
        }

        if (expr.literal.type === EPrimitive.cstr) {
          outWriter.write(
            `(hzstd_cstr_t)(${JSON.stringify(expr.literal.value)})`
          );
        } else if (expr.literal.type === EPrimitive.ccstr) {
          outWriter.write(
            `(hzstd_ccstr_t)(${JSON.stringify(expr.literal.value)})`
          );
        } else if (expr.literal.type === EPrimitive.str) {
          const [value, length] = escapeStringForC(expr.literal.value);
          outWriter.write(`HZSTD_STRING("${value}", ${length})`);
        } else if (expr.literal.type === EPrimitive.bool) {
          outWriter.write(
            `(${this.primitiveToC(expr.literal.type)})(${expr.literal.value ? "1" : "0"})`
          );
        } else if (expr.literal.type === EPrimitive.null) {
          outWriter.write("(hzstd_null_t){}");
        } else if (expr.literal.type === EPrimitive.none) {
          outWriter.write("(hzstd_none_t){}");
        } else if (expr.literal.type === EPrimitive.Regex) {
          assert(expr.literal.id !== null);
          const ns = getModuleGlobalNamespaceName(
            this.config.name,
            this.config.version
          );
          outWriter.write(
            `(hzstd_regex_t){ .blob = &__hz_${ns}_regex_table[${expr.literal.id}] }`
          );
        } else if (expr.literal.type === EPrimitive.f32) {
          outWriter.write(
            `(${this.primitiveToC(expr.literal.type)})(${stringifyWithDecimal(
              expr.literal.value
            )}f)`
          );
        } else if (
          expr.literal.type === EPrimitive.f64 ||
          expr.literal.type === EPrimitive.real
        ) {
          outWriter.write(
            `(${this.primitiveToC(expr.literal.type)})(${stringifyWithDecimal(expr.literal.value)})`
          );
        } else if (expr.literal.type === "enum") {
          const enumTypeId = lowerTypeDef(this.lr, expr.literal.enumType);
          const enumType = this.lr.typeDefNodes.get(enumTypeId);
          assert(enumType.variant === Lowered.ENode.EnumDatatype);
          const value = enumType.values.find((v) => {
            assert(expr.literal.type === "enum");
            return v.originalName === expr.literal.valueName;
          });
          assert(value);
          outWriter.write(`(${this.mangleName(value.loweredName)})`);
        } else {
          let postfix = "";
          switch (expr.literal.type) {
            case EPrimitive.i8:
            case EPrimitive.i16:
              postfix = "";
              break;

            case EPrimitive.i32:
              postfix = "L";
              break;

            case EPrimitive.i64:
            case EPrimitive.int:
              postfix = "LL";
              break;

            case EPrimitive.u8:
            case EPrimitive.u16:
              postfix = "U";
              break;

            case EPrimitive.u32:
              postfix = "UL";
              break;

            case EPrimitive.u64:
            case EPrimitive.usize:
              postfix = "ULL";
              break;

            default:
              assert(false);
              break;
          }
          let value = expr.literal.value.toString() + postfix;
          if (expr.literal.value === -2147483648n) {
            value = "INT_MIN";
          }
          if (expr.literal.value === -9223372036854775808n) {
            value = "LLONG_MIN";
          }
          outWriter.write(
            `(${this.primitiveToC(expr.literal.type)})(${value})`
          );
        }
        return { out: outWriter, temp: tempWriter };
      }

      default:
        assert(
          false,
          "All cases handled: " + Lowered.ENode[(expr as any).variant]
        );
    }
  }
}

type IntComparisonPlan = {
  leftUnsigned: boolean;
  rightUnsigned: boolean;
  leftBits: number;
  rightBits: number;
};

function cIntType(bits: number, signed: boolean): string {
  if (signed) {
    switch (bits) {
      case 8:
        return "hzstd_i8_t";
      case 16:
        return "hzstd_i16_t";
      case 32:
        return "hzstd_i32_t";
      case 64:
        return "hzstd_i64_t";
      default:
        throw new Error("invalid signed bit width");
    }
  }
  switch (bits) {
    case 8:
      return "hzstd_u8_t";
    case 16:
      return "hzstd_u16_t";
    case 32:
      return "hzstd_u32_t";
    case 64:
      return "hzstd_u64_t";
    default:
      throw new Error("invalid unsigned bit width");
  }
}

// Emits a cast only if EITHER bit width or signedness differ
function maybeCast(
  expr: string,
  fromBits: number,
  fromSigned: boolean,
  toBits: number,
  toSigned: boolean
): string {
  if (fromBits === toBits && fromSigned === toSigned) {
    return expr;
  }
  return `((${cIntType(toBits, toSigned)})(${expr}))`;
}

function nextSignedWidth(bits: number): number {
  if (bits <= 8) {
    return 16;
  }
  if (bits <= 16) {
    return 32;
  }
  if (bits <= 32) {
    return 64;
  }
  return 64;
}

function negResultForEquality(op: EBinaryOperation): string {
  return op === EBinaryOperation.NotEqual ? "1" : "0";
}

function negResultForOrdering(
  op: EBinaryOperation,
  signedIsLeft: boolean
): string {
  // signed < 0 case
  if (signedIsLeft) {
    if (op === EBinaryOperation.LessThan) {
      return "1";
    }
    if (op === EBinaryOperation.LessEqual) {
      return "1";
    }
    if (op === EBinaryOperation.GreaterThan) {
      return "0";
    }
    if (op === EBinaryOperation.GreaterEqual) {
      return "0";
    }
  } else {
    // unsigned vs signed < 0
    if (op === EBinaryOperation.LessThan) {
      return "0";
    }
    if (op === EBinaryOperation.LessEqual) {
      return "0";
    }
    if (op === EBinaryOperation.GreaterThan) {
      return "1";
    }
    if (op === EBinaryOperation.GreaterEqual) {
      return "1";
    }
  }

  // equality handled elsewhere
  throw new Error("not an ordering op");
}

// Core comparison emitter
export function emitIntCompare(
  lhs: string,
  rhs: string,
  p: {
    leftUnsigned: boolean;
    rightUnsigned: boolean;
    leftBits: number;
    rightBits: number;
  },
  operation: EBinaryOperation
): string {
  const op = BinaryOperationToString(operation);

  const leftSigned = !p.leftUnsigned;
  const rightSigned = !p.rightUnsigned;
  const maxBits = Math.max(p.leftBits, p.rightBits);

  // ------------------------------------------------------------
  // signed / signed
  // ------------------------------------------------------------
  if (leftSigned && rightSigned) {
    const l = maybeCast(lhs, p.leftBits, true, maxBits, true);
    const r = maybeCast(rhs, p.rightBits, true, maxBits, true);
    return `((${l}) ${op} (${r}))`;
  }

  // ------------------------------------------------------------
  // unsigned / unsigned
  // ------------------------------------------------------------
  if (!(leftSigned || rightSigned)) {
    const l = maybeCast(lhs, p.leftBits, false, maxBits, false);
    const r = maybeCast(rhs, p.rightBits, false, maxBits, false);
    return `((${l}) ${op} (${r}))`;
  }

  // ------------------------------------------------------------
  // mixed signedness (ℤ semantics)
  //
  // signed < 0 => fixed result
  // otherwise widen BOTH to unsigned(maxBits) and compare
  // ------------------------------------------------------------

  const wideBits = nextSignedWidth(maxBits);
  const wideType = cIntType(wideBits, false);

  const lWide = `((${wideType})(${lhs}))`;
  const rWide = `((${wideType})(${rhs}))`;

  // signed (left) vs unsigned (right)
  if (leftSigned && !rightSigned) {
    if (
      operation === EBinaryOperation.Equal ||
      operation === EBinaryOperation.NotEqual
    ) {
      return `((${lhs}) < 0 ? ${negResultForEquality(operation)} : (${lWide} ${op} ${rWide}))`;
    }

    return `((${lhs}) < 0 ? ${negResultForOrdering(operation, true)} : (${lWide} ${op} ${rWide}))`;
  }

  // unsigned (left) vs signed (right)
  if (!leftSigned && rightSigned) {
    if (
      operation === EBinaryOperation.Equal ||
      operation === EBinaryOperation.NotEqual
    ) {
      return `((${rhs}) < 0 ? ${negResultForEquality(operation)} : (${lWide} ${op} ${rWide}))`;
    }

    return `((${rhs}) < 0 ? ${negResultForOrdering(operation, false)} : (${lWide} ${op} ${rWide}))`;
  }

  throw new Error("unreachable");
}

export function generateCode(
  config: ModuleConfig,
  moduleDir: string,
  allModules: [string, string][],
  lr: Lowered.Module
): string {
  const gen = new CodeGenerator(config, moduleDir, allModules, lr);
  gen.generate();
  return gen.writeString();
}
