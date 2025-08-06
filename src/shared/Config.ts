import { dirname, join } from "path";
import { existsSync } from "fs";
import { parse } from "@ltd/j-toml";

import { GeneralError } from "./Errors";
import type { Collect } from "../SymbolCollection/CollectSymbols";

export enum ModuleType {
  Library,
  Executable,
}

export type ModuleDependency = { name: string; path: string };

export type ModuleConfig = {
  projectName: string;
  projectVersion: string;
  projectDescription?: string;
  projectLicense?: string;
  projectAuthors?: string[];
  scripts: { name: string; command: string }[];
  srcDirectory: string;
  nostdlib: boolean;
  moduleType: ModuleType;
  configFilePath?: string;
  dependencies: ModuleDependency[];
  linkerFlags: string[];
  compilerFlags: string[];
  platform: PlatformString;

  symbolIdCounter: number;
};

export type PlatformString = "linux-x64";

export type ModuleLibMetadata = {
  platform: PlatformString;
  filename: string;
  type: "static" | "shared";
};

export type ModuleMetadata = {
  compilerVersion: string;
  fileformatVersion: number;
  name: string;
  version: string;
  libs: ModuleLibMetadata[];
  exportedDeclarations: (Collect.Scope | Collect.Symbol)[];
  linkerFlags: string[];
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
        "Inconsistent module config: Expected string array instead of '" + v + "'",
      );
    }
    for (const s of v) {
      if (typeof s !== "string") {
        throw new GeneralError(
          "Inconsistent module config: Expected string instead of '" + s + "'",
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
        platform: getStringAnyOf<"linux-x64">(obj["platform"], ["linux-x64"]),
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
    exportedDeclarations: obj["exportedDeclarations"],
    libs: getLibs(obj["libs"]),
    linkerFlags: getStringArray(obj["linkerFlags"]),
  };
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

  getScripts(toml: any) {
    const scripts = [] as { name: string; command: string }[];
    if (toml["scripts"]) {
      for (const [name, cmd] of Object.entries(toml["scripts"])) {
        if (typeof cmd !== "string") {
          throw new GeneralError(
            `Script '${name}' in file ${this.configPath} must be of type string`,
          );
        }
        scripts.push({
          name: name,
          command: cmd,
        });
      }
    }
    return scripts;
  }

  getDependencies(toml: any) {
    const deps = [] as { name: string; path: string }[];
    if (toml["dependencies"]) {
      for (const [name, path] of Object.entries(toml["dependencies"])) {
        if (typeof path !== "string") {
          throw new GeneralError(
            `Dependency path '${path}' in file ${this.configPath} must be of type string`,
          );
        }
        deps.push({
          name: name,
          path: path,
        });
      }
    }
    return deps;
  }

  async parseConfig(): Promise<ModuleConfig> {
    const content = await Bun.file(this.configPath).text();
    const toml = parse(content, { bigint: false });

    const type = this.getOptionalStringAnyOf(toml, "type", ["lib", "exe"]);
    const moduleType = type === "exe" ? ModuleType.Executable : ModuleType.Library;

    return {
      projectName: this.getString(toml, "name"),
      projectVersion: this.getString(toml, "version"),
      projectAuthors: this.getOptionalStringArray(toml, "authors"),
      projectDescription: this.getOptionalString(toml, "description"),
      projectLicense: this.getOptionalString(toml, "license"),
      scripts: this.getScripts(toml),
      dependencies: this.getDependencies(toml),
      srcDirectory: join(dirname(this.configPath), this.getOptionalString(toml, "src") || "src"),
      configFilePath: this.configPath,
      moduleType: moduleType,
      nostdlib: this.getOptionalStringAnyOf(toml, "std", ["none"]) === "none",
      linkerFlags: (toml["linker"] && this.getOptionalStringArray(toml["linker"], "flags")) || [],
      compilerFlags:
        (toml["compiler"] && this.getOptionalStringArray(toml["compiler"], "flags")) || [],
      platform: "linux-x64",
      symbolIdCounter: 0,
    };
  }
}
