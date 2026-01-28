import { dirname, join } from "path";
import { existsSync } from "fs";
import { parse } from "@ltd/j-toml";
import { writeFile, readFile } from "fs/promises";

import { CompilerError, GeneralError } from "./Errors";
import type { Collect } from "../SymbolCollection/SymbolCollection";
import { getCurrentPlatform, type ModulePrintInfo } from "../Module";
import assert from "assert";

export enum ModuleType {
  Library,
  Executable,
}

export enum Platform {
  Win32,
  Linux,
}

export let PLATFORM: Platform;
if (process.platform === "win32") {
  PLATFORM = Platform.Win32;
} else if (process.platform === "linux") {
  PLATFORM = Platform.Linux;
} else if (process.platform === "darwin") {
  throw new Error("MacOS not supported yet");
} else {
  throw new Error("Platform not supported yet: " + process.platform);
}

export type ModuleDependency = { name: string; path: string };

export type ScriptDef = { name: string; command: string; depends: string[] | null };

export class PlatformStrings {
  private all = new Set<string>();
  private win32 = new Set<string>();
  private linux = new Set<string>();

  constructor(values?: { all: string[]; win32: string[]; linux: string[] }) {
    if (values) {
      this.all = new Set(values.all);
      this.win32 = new Set(values.win32);
      this.linux = new Set(values.linux);
    }
  }

  combineForPlatform() {
    const result = this.getAll();
    if (PLATFORM === Platform.Win32) {
      result.push(...this.win32);
    }
    if (PLATFORM === Platform.Linux) {
      result.push(...this.linux);
    }
    return result;
  }

  getAll() {
    return [...this.all];
  }

  getWin32() {
    return [...this.win32];
  }

  getLinux() {
    return [...this.linux];
  }

  merge(strings: PlatformStrings) {
    this.addAll(strings.getAll());
    this.addWin32(strings.getWin32());
    this.addLinux(strings.getLinux());
  }

  addAll(flag: string | string[]) {
    if (Array.isArray(flag)) {
      for (const f of flag) {
        this.all.add(f);
      }
    } else {
      this.all.add(flag);
    }
  }

  addWin32(flag: string | string[]) {
    if (Array.isArray(flag)) {
      for (const f of flag) {
        this.win32.add(f);
      }
    } else {
      this.win32.add(flag);
    }
  }

  addLinux(flag: string | string[]) {
    if (Array.isArray(flag)) {
      for (const f of flag) {
        this.linux.add(f);
      }
    } else {
      this.linux.add(flag);
    }
  }
}

export enum ECollectionMode {
  WrapIntoModuleNamespace,
  ImportUnderRootDirectly,
}

export enum EModuleFileDir {
  BinaryDir = "bin",
  SourceDir = "src",
  ModuleRootDir = "root",
  AutogenDir = "autogen",
}

export type GeneratorFile =
  | {
      type: "module-file";
      module: string;
      dir: EModuleFileDir;
      path: string;
    }
  | {
      type: "placeholder";
    };

export type GeneratorConfig = {
  name: string;
} & (
  | {
      type: "exec";
      exec: string;
      inputs: GeneratorFile[];
      outputs: GeneratorFile[];
    }
  | {
      type: "placeholder";
    }
);

export type GeneratorGraphNode = {
  config: GeneratorConfig;
  dependsOn: string[];
};

export type ModuleConfig = {
  name: string;
  printerModule?: ModulePrintInfo;
  version: string;
  description?: string;
  license?: string;
  authors?: string[];
  scripts: {
    any: ScriptDef[];
    win32: ScriptDef[];
    linux: ScriptDef[];
  };
  source: { type: "src-dir"; dirpath: string } | { type: "single-file"; filepath: string };
  nostdlib: boolean;
  moduleType: ModuleType;
  configFilePath?: string;
  dependencies: ModuleDependency[];
  linkerFlags: PlatformStrings;
  interfaceLinkerFlags: PlatformStrings;
  compilerFlags: PlatformStrings;
  macros: PlatformStrings;
  interfaceMacros: PlatformStrings;
  includeDirs: PlatformStrings;
  hzstdLocation: string | null;
  platform: PlatformString;
  includeSourceloc: boolean;
  generators: GeneratorConfig[];
};

export type PlatformString = "linux-x64" | "win32-x64";

export type ModuleLibMetadata = {
  platform: PlatformString;
  filename: string;
  type: "static" | "shared";
};

// export type ExportData = {
//   nodes: ImpExp.Node[];
// };

// export type ExportData = {
//   nodes: Collect.Node[];
// };

export type CompileCommands = CompileCommandEntry[];

export type CompileCommandEntry = {
  /**
   * The working directory where the compilation command is executed.
   * Usually the project root or the directory containing the source file.
   */
  directory: string;

  /**
   * The full compiler invocation used to compile this file.
   * It may include compiler, flags, defines, include paths, etc.
   * Example: "clang -std=c17 -Iinclude -c out/main.c"
   */
  command?: string;

  /**
   * Alternative to `command`, introduced by some tools (like Ninja/CMake)
   * for better structured command data. Only one of `command` or
   * `arguments` is required.
   */
  arguments?: string[];

  /**
   * The absolute or relative path to the source file.
   * clangd resolves it relative to `directory` if not absolute.
   */
  file: string;

  /**
   * Optional. Some tools add this when the output object file path differs
   * from the source name.
   */
  output?: string;
};

export type ExportData = {
  exported: Set<Collect.SymbolId>;
};

export type ModuleMetadata = {
  compilerVersion: string;
  fileformatVersion: number;
  name: string;
  version: string;
  libs: ModuleLibMetadata[];
  includeDirs: PlatformStrings;
  interfaceMacros: PlatformStrings;
  linkerFlags: PlatformStrings;
  interfaceLinkerFlags: PlatformStrings;
  fullModuleGraph: [string, string][];
  compileCommands: CompileCommands;
  importFile: "import.hz";
};

const getStringArray = (v: any) => {
  if (!Array.isArray(v)) {
    throw new GeneralError(
      "Inconsistent module config: Expected string array instead of '" + v + "'",
    );
  }
  for (const s of v) {
    if (typeof s !== "string") {
      throw new GeneralError("Inconsistent module config: Expected string instead of '" + s + "'");
    }
  }
  return v as string[];
};

export function parseModuleMetadata(metadata: string): ModuleMetadata {
  const obj = JSON.parse(metadata);

  const getString = (v: any) => {
    if (typeof v !== "string") {
      throw new GeneralError("Inconsistent module config: Expected string instead of '" + v + "'");
    }
    return v as string;
  };

  function getStringAnyOf<T extends string>(v: any, options: string[]): T {
    if (typeof v !== "string") {
      throw new GeneralError("Inconsistent module config: Expected string instead of '" + v + "'");
    }
    if (!options.includes(v)) {
      throw new GeneralError("Inconsistent module config: Expected any of '" + options + "'");
    }
    return v as T;
  }

  const getNumber = (v: any) => {
    if (typeof v !== "number") {
      throw new GeneralError("Inconsistent module config: Expected number instead of '" + v + "'");
    }
    return v as number;
  };

  const getLibs = (v: any): ModuleLibMetadata[] => {
    if (!Array.isArray(v)) {
      throw new GeneralError(
        "Inconsistent module config: Expected object array instead of '" + v + "'",
      );
    }
    const libs: ModuleLibMetadata[] = [];
    for (const obj of v) {
      if (typeof obj !== "object") {
        throw new GeneralError(
          "Inconsistent module config: Expected object instead of '" + v + "'",
        );
      }
      libs.push({
        filename: getString(obj["filename"]),
        platform: getStringAnyOf<PlatformString>(obj["platform"], ["linux-x64", "win32-x64"]),
        type: getStringAnyOf<"static" | "shared">(obj["type"], ["static", "shared"]),
      });
    }
    return libs;
  };

  return {
    compilerVersion: getString(obj["compilerVersion"]),
    fileformatVersion: getNumber(obj["fileformatVersion"]),
    name: getString(obj["name"]),
    version: getString(obj["version"]),
    libs: getLibs(obj["libs"]),
    includeDirs: new PlatformStrings({
      all: getStringArray(obj["includeDirs"]["all"]),
      win32: getStringArray(obj["includeDirs"]["win32"]),
      linux: getStringArray(obj["includeDirs"]["linux"]),
    }),
    linkerFlags: new PlatformStrings({
      all: getStringArray(obj["linkerFlags"]["all"]),
      win32: getStringArray(obj["linkerFlags"]["win32"]),
      linux: getStringArray(obj["linkerFlags"]["linux"]),
    }),
    interfaceLinkerFlags: new PlatformStrings({
      all: getStringArray(obj["interfaceLinkerFlags"]["all"]),
      win32: getStringArray(obj["interfaceLinkerFlags"]["win32"]),
      linux: getStringArray(obj["interfaceLinkerFlags"]["linux"]),
    }),
    interfaceMacros: new PlatformStrings({
      all: getStringArray(obj["interfaceMacros"]["all"]),
      win32: getStringArray(obj["interfaceMacros"]["win32"]),
      linux: getStringArray(obj["interfaceMacros"]["linux"]),
    }),
    fullModuleGraph: obj["fullModuleGraph"],
    compileCommands: obj["compileCommands"],
    importFile: "import.hz",
  };
}

export function getModuleGlobalNamespaceName(moduleName: string, moduleVersion: string) {
  return `${moduleName.replaceAll("-", "_")}_v${moduleVersion.replaceAll(".", "_")}`;
}

export class ConfigParser {
  configPath: string;

  constructor(hazeConfigFile: string, startDir?: string) {
    const configPath = this.findUpwards(hazeConfigFile, startDir);
    if (!configPath) {
      throw new GeneralError(
        `No '${hazeConfigFile}' file found in any parent directory. Are you in the correct directory?`,
      );
    }
    this.configPath = configPath;
  }

  findUpwards(filename: string, startDir?: string): string | undefined {
    let dir = startDir || process.cwd();
    while (dir !== dirname(dir)) {
      const filePath = join(dir, filename);
      if (existsSync(filePath)) {
        return filePath;
      }
      dir = dirname(dir);
    }
    return undefined;
  }

  getString(toml: any, field: string): string {
    if (typeof toml[field] === "string") {
      return toml[field];
    } else if (field in toml) {
      throw new GeneralError(`Field '${field}' in file ${this.configPath} must be of type string`);
    } else {
      throw new GeneralError(`Required field '${field}' is missing in ${this.configPath}`);
    }
  }

  getOptionalString(toml: any, field: string): string | undefined {
    if (typeof toml[field] === "string") {
      return toml[field];
    } else if (field in toml) {
      throw new GeneralError(`Field '${field}' in file ${this.configPath} must be of type string`);
    }
    return undefined;
  }

  getOptionalStringAnyOf(toml: any, field: string, options: string[]): string | undefined {
    if (typeof toml[field] === "string") {
      if (options.includes(toml[field])) {
        return toml[field];
      }
      throw new GeneralError(
        `Field '${field}' in file ${this.configPath} must be any of '${options}'`,
      );
    } else if (field in toml) {
      throw new GeneralError(`Field '${field}' in file ${this.configPath} must be of type string`);
    }
    return undefined;
  }

  getOptionalStringArray(toml: any, field: string): string[] | undefined {
    if (Array.isArray(toml[field])) {
      const array = toml[field];
      array.forEach((s) => {
        if (typeof s !== "string") {
          throw new GeneralError(
            `Element '${s}' of field '${field}' in file ${this.configPath} must be of type string`,
          );
        }
      });
      return array;
    } else if (field in toml) {
      throw new GeneralError(`Field '${field}' in file ${this.configPath} must be an array`);
    }
    return undefined;
  }

  getScripts(scriptInput: any) {
    const scripts = [] as { name: string; command: string; depends: string[] | null }[];
    if (scriptInput) {
      for (const [name, cmd] of Object.entries(scriptInput)) {
        if (name === "linux" || name === "win32") continue;
        if (typeof cmd === "string") {
          scripts.push({
            name: name,
            command: cmd,
            depends: null,
          });
        } else if (typeof cmd === "object" && cmd !== null) {
          if (!("command" in cmd)) {
            throw new GeneralError(
              `Script '${name}' in file ${this.configPath} requires a 'command' attribute`,
            );
          }
          if (typeof cmd.command !== "string") {
            throw new GeneralError(
              `Script '${name}' in file ${this.configPath} requires the 'command' attribute to be a string`,
            );
          }
          let depends = null as string[] | null;
          if ("depends" in cmd) {
            if (typeof cmd.depends === "string") {
              depends = [cmd.depends];
            } else if (Array.isArray(cmd.depends)) {
              depends = cmd.depends.map((a) => {
                if (typeof a !== "string") {
                  throw new GeneralError(
                    `Script '${name}' in file ${this.configPath} requires all 'depends' globs to be strings`,
                  );
                }
                return a;
              });
            } else {
              throw new GeneralError(
                `Script '${name}' in file ${this.configPath} requires a 'command' attribute`,
              );
            }
          }
          scripts.push({
            name: name,
            command: cmd.command,
            depends: depends,
          });
        } else {
          throw new GeneralError(
            `Script '${name}' in file ${this.configPath} has unsupported type`,
          );
        }
      }
    }
    return scripts;
  }

  getDependencies(toml: any) {
    const deps = [] as { name: string; path: string }[];
    if (toml["dependencies"]) {
      for (const [name, props] of Object.entries(toml["dependencies"])) {
        if (typeof props !== "object" || props === null) {
          throw new GeneralError(
            `Dependency props for dependency '${name}' in file ${this.configPath} must be an object`,
          );
        }
        if (!("path" in props)) {
          throw new GeneralError(
            `Dependency '${name}' in file ${this.configPath} requires a path attribute`,
          );
        }
        if (typeof props["path"] !== "string") {
          throw new GeneralError(
            `Dependency path '${props["path"]}' in file ${this.configPath} must be of type string`,
          );
        }
        deps.push({
          name: name,
          path: props["path"],
        });
      }
    }
    return deps;
  }

  async parseConfig(sourceloc?: boolean): Promise<ModuleConfig> {
    const content = await readFile(this.configPath, "utf-8");
    const toml = parse(content, { bigint: false });

    const type = this.getOptionalStringAnyOf(toml, "type", ["lib", "exe"]);
    const moduleType = type === "exe" ? ModuleType.Executable : ModuleType.Library;

    const config: ModuleConfig = {
      name: this.getString(toml, "name"),
      version: this.getString(toml, "version"),
      authors: this.getOptionalStringArray(toml, "authors"),
      description: this.getOptionalString(toml, "description"),
      license: this.getOptionalString(toml, "license"),
      scripts: {
        any: this.getScripts(toml["scripts"]),
        win32:
          ((toml as any)?.scripts?.win32 && this.getScripts((toml as any)["scripts"]?.win32)) || [],
        linux:
          ((toml as any)?.scripts?.linux && this.getScripts((toml as any)["scripts"]?.linux)) || [],
      },
      dependencies: this.getDependencies(toml),
      source: {
        type: "src-dir",
        dirpath: join(dirname(this.configPath), this.getOptionalString(toml, "src") || "src"),
      },
      configFilePath: this.configPath,
      moduleType: moduleType,
      nostdlib: this.getOptionalStringAnyOf(toml, "std", ["none"]) === "none",
      linkerFlags: new PlatformStrings({
        all: [],
        win32: [],
        linux: [],
      }),
      interfaceLinkerFlags: new PlatformStrings({
        all: [],
        win32: [],
        linux: [],
      }),
      compilerFlags: new PlatformStrings({
        all: [],
        win32: [],
        linux: [],
      }),
      macros: new PlatformStrings({
        all: [],
        win32: [],
        linux: [],
      }),
      interfaceMacros: new PlatformStrings({
        all: [],
        win32: [],
        linux: [],
      }),
      includeDirs: new PlatformStrings({
        all: [],
        win32: [],
        linux: [],
      }),
      hzstdLocation: null,
      platform: getCurrentPlatform(),
      includeSourceloc: sourceloc ?? true,
      generators: [],
    };

    const linker = toml["linker"] as any;
    config.linkerFlags.addAll((linker && this.getOptionalStringArray(linker, "flags")) || []);
    config.linkerFlags.addWin32(
      (linker?.win32 && this.getOptionalStringArray(linker.win32, "flags")) || [],
    );
    config.linkerFlags.addLinux(
      (linker?.linux && this.getOptionalStringArray(linker.linux, "flags")) || [],
    );

    const compiler = toml["compiler"] as any;
    config.compilerFlags.addAll((compiler && this.getOptionalStringArray(compiler, "flags")) || []);
    config.compilerFlags.addWin32(
      (compiler?.win32 && this.getOptionalStringArray(compiler.win32, "flags")) || [],
    );
    config.compilerFlags.addLinux(
      (compiler?.linux && this.getOptionalStringArray(compiler.linux, "flags")) || [],
    );

    config.macros.addAll((compiler && this.getOptionalStringArray(compiler, "defines")) || []);
    config.macros.addWin32(
      (compiler?.win32 && this.getOptionalStringArray(compiler.win32, "defines")) || [],
    );
    config.macros.addLinux(
      (compiler?.linux && this.getOptionalStringArray(compiler.linux, "defines")) || [],
    );

    const _interface = toml["interface"] as any;
    if (_interface) {
      const compiler = _interface["compiler"] as any;
      config.interfaceMacros.addAll(
        (compiler && this.getOptionalStringArray(compiler, "defines")) || [],
      );
      config.interfaceMacros.addWin32(
        (compiler?.win32 && this.getOptionalStringArray(compiler.win32, "defines")) || [],
      );
      config.interfaceMacros.addLinux(
        (compiler?.linux && this.getOptionalStringArray(compiler.linux, "defines")) || [],
      );

      const linker = _interface["linker"] as any;
      config.interfaceLinkerFlags.addAll(
        (linker && this.getOptionalStringArray(linker, "flags")) || [],
      );
      config.interfaceLinkerFlags.addWin32(
        (linker?.win32 && this.getOptionalStringArray(linker.win32, "flags")) || [],
      );
      config.interfaceLinkerFlags.addLinux(
        (linker?.linux && this.getOptionalStringArray(linker.linux, "flags")) || [],
      );
    }

    const generators = toml["generator"] as any;
    if (generators) {
      for (const [key, _value] of Object.entries(generators)) {
        if (typeof _value !== "object" || _value === null) {
          throw new GeneralError(`Generator '${key}' is expected to be an object`);
        }
        const value = _value as Record<string, unknown>;
        if (!value["exec"]) {
          throw new GeneralError(`Generator '${key}' is expected to have an 'exec' attribute`);
        }
        const generator: GeneratorConfig = {
          name: key,
          exec: value["exec"] as string,
          inputs: [],
          outputs: [],
          type: "exec",
        };

        if (!value["inputs"] || !Array.isArray(value["inputs"])) {
          throw new GeneralError(
            `Generator '${key}' is expected to be an 'inputs' attribute with an array value`,
          );
        }
        if (!value["outputs"] || !Array.isArray(value["outputs"])) {
          throw new GeneralError(
            `Generator '${key}' is expected to be an 'inputs' attribute with an array value`,
          );
        }

        const parseFile = (type: "input" | "output", file: any) => {
          if (file["module"]) {
            if (typeof file["module"] !== "string") {
              throw new GeneralError(
                `Generator '${key}' defines an invalid ${type}: 'module' property is expected to be a string`,
              );
            }
            if (typeof file["path"] !== "string") {
              throw new GeneralError(
                `Generator '${key}' defines an invalid ${type}: 'path' property is expected to be a string`,
              );
            }
            if (typeof file["dir"] !== "string") {
              throw new GeneralError(
                `Generator '${key}' defines an invalid ${type}: 'module' property is expected to be a string`,
              );
            }
            const dirStr = file["dir"] as string;
            let dir: EModuleFileDir | null = null;
            switch (dirStr) {
              case "autogen":
                dir = EModuleFileDir.AutogenDir;
                break;
              case "bin":
                dir = EModuleFileDir.BinaryDir;
                break;
              case "src":
                dir = EModuleFileDir.SourceDir;
                break;
              case "root":
                dir = EModuleFileDir.ModuleRootDir;
                break;
              default:
                throw new GeneralError(
                  `Generator '${key}' defines an invalid ${type}: 'dir' property can only be: ["bin", "root", "src"]`,
                );
            }
            const f: GeneratorFile = {
              module: file["module"] as string,
              dir: dir,
              type: "module-file",
              path: file["path"] as string,
            };
            return f;
          } else {
            throw new GeneralError(
              `Generator '${key}' defines an invalid input: Only module-directories are supported yet`,
            );
          }
        };

        generator.type = "exec";
        assert(generator.type === "exec");
        for (const input of Object.values(value["inputs"])) {
          generator.inputs.push(parseFile("input", input));
        }
        for (const output of Object.values(value["outputs"])) {
          generator.outputs.push(parseFile("output", output));
        }

        config.generators.push(generator);
      }
    }

    return config;
  }
}
