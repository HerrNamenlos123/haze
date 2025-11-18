import { dirname, join } from "path";
import { existsSync } from "fs";
import { parse } from "@ltd/j-toml";
import { writeFile, readFile } from "fs/promises";

import { GeneralError } from "./Errors";
import type { Collect } from "../SymbolCollection/SymbolCollection";
import { getCurrentPlatform, type ModulePrintInfo } from "../Module";

export enum ModuleType {
  Library,
  Executable,
}

export type ModuleDependency = { name: string; path: string };

export type ScriptDef = { name: string; command: string; depends: string[] | null };

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
  srcDirectory: string;
  nostdlib: boolean;
  moduleType: ModuleType;
  configFilePath?: string;
  dependencies: ModuleDependency[];
  linkerFlags: {
    any: string[];
    win32: string[];
    linux: string[];
  };
  compilerFlags: {
    any: string[];
    win32: string[];
    linux: string[];
  };
  hzstdLocation: string | null;
  platform: PlatformString;
  includeSourceloc: boolean;
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
  linkerFlags: {
    any: string[];
    win32: string[];
    linux: string[];
  };
  compileCommands: CompileCommands;
  importFile: "import.hz";
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

  const getStringArray = (v: any) => {
    if (!Array.isArray(v)) {
      throw new GeneralError(
        "Inconsistent module config: Expected string array instead of '" + v + "'"
      );
    }
    for (const s of v) {
      if (typeof s !== "string") {
        throw new GeneralError(
          "Inconsistent module config: Expected string instead of '" + s + "'"
        );
      }
    }
    return v as string[];
  };

  const getNumber = (v: any) => {
    if (typeof v !== "number") {
      throw new GeneralError("Inconsistent module config: Expected number instead of '" + v + "'");
    }
    return v as number;
  };

  const getLibs = (v: any): ModuleLibMetadata[] => {
    if (!Array.isArray(v)) {
      throw new GeneralError(
        "Inconsistent module config: Expected object array instead of '" + v + "'"
      );
    }
    const libs: ModuleLibMetadata[] = [];
    for (const obj of v) {
      if (typeof obj !== "object") {
        throw new GeneralError(
          "Inconsistent module config: Expected object instead of '" + v + "'"
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
    linkerFlags: {
      any: getStringArray(obj["linkerFlags"]["any"]),
      win32: getStringArray(obj["linkerFlags"]["win32"]),
      linux: getStringArray(obj["linkerFlags"]["linux"]),
    },
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
        `No '${hazeConfigFile}' file found in any parent directory. Are you in the correct directory?`
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
        `Field '${field}' in file ${this.configPath} must be any of '${options}'`
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
            `Element '${s}' of field '${field}' in file ${this.configPath} must be of type string`
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
              `Script '${name}' in file ${this.configPath} requires a 'command' attribute`
            );
          }
          if (typeof cmd.command !== "string") {
            throw new GeneralError(
              `Script '${name}' in file ${this.configPath} requires the 'command' attribute to be a string`
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
                    `Script '${name}' in file ${this.configPath} requires all 'depends' globs to be strings`
                  );
                }
                return a;
              });
            } else {
              throw new GeneralError(
                `Script '${name}' in file ${this.configPath} requires a 'command' attribute`
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
            `Script '${name}' in file ${this.configPath} has unsupported type`
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
            `Dependency props for dependency '${name}' in file ${this.configPath} must be an object`
          );
        }
        if (!("path" in props)) {
          throw new GeneralError(
            `Dependency '${name}' in file ${this.configPath} requires a path attribute`
          );
        }
        if (typeof props["path"] !== "string") {
          throw new GeneralError(
            `Dependency path '${props["path"]}' in file ${this.configPath} must be of type string`
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
      srcDirectory: join(dirname(this.configPath), this.getOptionalString(toml, "src") || "src"),
      configFilePath: this.configPath,
      moduleType: moduleType,
      nostdlib: this.getOptionalStringAnyOf(toml, "std", ["none"]) === "none",
      linkerFlags: {
        any: [],
        win32: [],
        linux: [],
      },
      compilerFlags: {
        any: [],
        win32: [],
        linux: [],
      },
      hzstdLocation: null,
      platform: getCurrentPlatform(),
      includeSourceloc: sourceloc ?? true,
    };

    const linker = toml["linker"] as any;
    config.linkerFlags = {
      any: (linker && this.getOptionalStringArray(linker, "flags")) || [],
      win32: (linker?.win32 && this.getOptionalStringArray(linker.win32, "flags")) || [],
      linux: (linker?.linux && this.getOptionalStringArray(linker.linux, "flags")) || [],
    };

    const compiler = toml["compiler"] as any;
    config.compilerFlags = {
      any: (compiler && this.getOptionalStringArray(compiler, "flags")) || [],
      win32: (compiler?.win32 && this.getOptionalStringArray(compiler?.win32, "flags")) || [],
      linux: (compiler?.linux && this.getOptionalStringArray(compiler?.linux, "flags")) || [],
    };

    return config;
  }
}
