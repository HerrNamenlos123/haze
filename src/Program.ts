import type { ParserRuleContext } from "antlr4";
import { CompilerError, GeneralError, InternalError, Location } from "./Errors";
import { dirname, join } from "path";
import { existsSync } from "fs";
import { parse } from "@ltd/j-toml";
import { Scope } from "./Scope";
import {
  Language,
  mangleSymbol,
  serializeSymbol,
  type DatatypeSymbol,
  type FunctionSymbol,
  type Symbol,
  type VariableSymbol,
} from "./Symbol";
import {
  Primitive,
  primitiveVariantToString,
  serializeDatatype,
  type Datatype,
  type PrimitiveDatatype,
  type RawPointerDatatype,
  type StructDatatype,
} from "./Datatype";
import { isDeeplyEqual } from "./deep-equal";
import type {
  VariableDeclarationStatement,
  VariableDefinitionStatement,
} from "./Statement";

export type ProjectConfig = {
  projectName: string;
  projectVersion: string;
  projectDescription?: string;
  projectLicense?: string;
  projectAuthors?: string[];
  scripts: { name: string; command: string }[];
  srcDirectory: string;
  nostdlib: boolean;
};

export type ModuleConfig = {
  module: {};
};

export class ConfigParser {
  configPath: string;

  constructor(hazeConfigFile: string) {
    const configPath = this.findUpwards(hazeConfigFile);
    if (!configPath) {
      throw new GeneralError(
        `No '${hazeConfigFile}' file found in any parent directory. Are you in the correct directory?`,
      );
    }
    this.configPath = configPath;
  }

  findUpwards(filename: string, startDir = process.cwd()): string | undefined {
    let dir = startDir;
    while (dir !== dirname(dir)) {
      const filePath = join(dir, filename);
      if (existsSync(filePath)) return filePath;
      dir = dirname(dir);
    }
    return undefined;
  }

  getString(toml: any, field: string): string {
    if (typeof toml[field] === "string") {
      return toml[field];
    } else if (field in toml) {
      throw new GeneralError(
        `Field '${field}' in file ${this.configPath} must be of type string`,
      );
    } else {
      throw new GeneralError(
        `Required field '${field}' is missing in ${this.configPath}`,
      );
    }
  }

  getOptionalString(toml: any, field: string): string | undefined {
    if (typeof toml[field] === "string") {
      return toml[field];
    } else if (field in toml) {
      throw new GeneralError(
        `Field '${field}' in file ${this.configPath} must be of type string`,
      );
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
      throw new GeneralError(
        `Field '${field}' in file ${this.configPath} must be an array`,
      );
    }
    return undefined;
  }

  getScripts(toml: any) {
    const scripts = [] as { name: string; command: string }[];
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
    return scripts;
  }

  async parseConfig(): Promise<ProjectConfig> {
    const content = await Bun.file(this.configPath).text();
    const toml = parse(content, { bigint: false });
    return {
      projectName: this.getString(toml, "name"),
      projectVersion: this.getString(toml, "version"),
      projectAuthors: this.getOptionalStringArray(toml, "authors"),
      projectDescription: this.getOptionalString(toml, "description"),
      projectLicense: this.getOptionalString(toml, "license"),
      scripts: this.getScripts(toml),
      srcDirectory: join(
        dirname(this.configPath),
        this.getOptionalString(toml, "src") || "src",
      ),
      nostdlib: false,
    };
  }
}

export class Program {
  globalScope: Scope;
  concreteGlobalStatements: Map<
    string,
    VariableDefinitionStatement | VariableDeclarationStatement
  > = new Map();
  concreteFunctions: Map<string, FunctionSymbol> = new Map();
  concreteDatatypes: Map<string, DatatypeSymbol> = new Map();
  prebuildCmds: string[] = [];
  postbuildCmds: string[] = [];
  cDefinitionDecl: string[] = [];
  linkerFlags: string[] = [];
  scopeStack: Scope[];
  projectConfig: ProjectConfig;
  filename?: string;
  ast?: ParserRuleContext;

  datatypes: Datatype[] = [];

  private anonymousStuffCounter = 0;

  constructor(projectConfig: ProjectConfig) {
    this.globalScope = new Scope(new Location("global", 0, 0));
    this.scopeStack = [];
    this.projectConfig = projectConfig;

    const define = (name: string, primitive: Primitive) => {
      const type: PrimitiveDatatype = {
        variant: "Primitive",
        primitive,
      };
      const symbol: DatatypeSymbol = {
        variant: "Datatype",
        name: name,
        scope: this.globalScope,
        type,
      };
      this.globalScope.defineSymbol(symbol, this.globalScope.location);
    };

    define("none", Primitive.none);
    define("unknown", Primitive.unknown);
    define("stringview", Primitive.stringview);
    define("boolean", Primitive.boolean);
    define("booleanptr", Primitive.booleanptr);
    define("u8", Primitive.u8);
    define("u16", Primitive.u16);
    define("u32", Primitive.u32);
    define("u64", Primitive.u64);
    define("i8", Primitive.i8);
    define("i16", Primitive.i16);
    define("i32", Primitive.i32);
    define("i64", Primitive.i64);
    define("f32", Primitive.f32);
    define("f64", Primitive.f64);

    const symbol: DatatypeSymbol<RawPointerDatatype> = {
      variant: "Datatype",
      name: "RawPtr",
      type: {
        variant: "RawPointer",
        generics: new Map().set("__Pointee", undefined),
      },
      scope: this.globalScope,
    };
    this.globalScope.defineSymbol(symbol, this.globalScope.location);

    if (this.projectConfig.nostdlib) {
      const symbol: DatatypeSymbol = {
        variant: "Datatype",
        name: "Context",
        scope: this.globalScope,
        type: {
          variant: "Struct",
          generics: new Map(),
          language: Language.Internal,
          members: [],
          methods: [],
          name: "Context",
        },
      };
      this.globalScope.defineSymbol(symbol, this.globalScope.location);
    }
  }

  getBuiltinType(name: string) {
    return this.globalScope.lookupSymbol(name, this.globalScope.location).type;
  }

  pushScope(scope: Scope) {
    this.scopeStack.push(scope);
    return scope;
  }

  popScope() {
    this.scopeStack.pop();
  }

  get currentScope() {
    if (this.scopeStack.length === 0) {
      return this.globalScope;
    }
    return this.scopeStack[this.scopeStack.length - 1];
  }

  getLoc(ctx: ParserRuleContext) {
    if (!this.filename) {
      throw new InternalError("Filename missing");
    }
    return new Location(this.filename, ctx.start.line, ctx.start.column);
  }

  findBaseDatatype(basename: string) {
    for (const dt of this.datatypes) {
      switch (dt.variant) {
        case "Primitive":
          if (primitiveVariantToString(dt) === basename) {
            return dt;
          }
          break;

        case "Struct":
          if (dt.name === basename) {
            return dt;
          }
          break;
      }
    }
    return undefined;
  }

  addDatatypeRef(type: Datatype, loc: Location) {
    switch (type.variant) {
      case "Primitive":
        if (
          !this.datatypes.find(
            (d) => d.variant === "Primitive" && d.primitive === type.primitive,
          )
        ) {
          this.datatypes.push(type);
        }
        break;

      case "Generic":
        break;

      case "Struct":
        const found = this.datatypes.find(
          (d) => d.variant === "Struct" && d.name === type.name,
        ) as StructDatatype | undefined;
        if (found) {
          if (found.generics !== type.generics) {
            throw new CompilerError(
              `Type '${found.name}<>' was already declared with incompatible generics list`,
              loc,
            );
          }
          if (!isDeeplyEqual(found.members, type.members)) {
            throw new CompilerError(
              `Type '${found.name}<>' was already declared with incompatible members list`,
              loc,
            );
          }
          if (!isDeeplyEqual(found.methods, type.methods)) {
            throw new CompilerError(
              `Type '${found.name}<>' was already declared with incompatible methods list`,
              loc,
            );
          }
        } else {
          this.datatypes.push(type);
        }
        break;

      case "Function":
        this.addDatatypeRef(type.functionReturnType, loc);
        type.functionParameters.forEach((p) => this.addDatatypeRef(p[1], loc));
        break;
    }
    this.datatypes.push(type);
  }

  makeAnonymousName() {
    return `__anonym_${this.anonymousStuffCounter++}`;
  }

  makeTempVarname() {
    return `__temp_${this.anonymousStuffCounter++}`;
  }

  print() {
    console.log("Program");
    for (const symbol of this.globalScope.getSymbols()) {
      console.log(serializeSymbol(symbol));
      // if (symbol.type.variant === "Struct") {
      //   for (const s of symbol.type.members) {
      //     console.log(serializeDatatype(s.type));
      //   }
      // }
    }

    console.log("\nConcrete Functions:");
    for (const [name, symbol] of this.concreteFunctions.entries()) {
      console.log(serializeSymbol(symbol));
      // if (symbol.type.functionParameters.length > 0) {
      //   const [name, p] = symbol.type.functionParameters[0];
      //   if (p) {
      //     if (p.variant === "Struct") {
      //       for (const s of p.members) {
      //         console.log(serializeDatatype(s.type));
      //       }
      //     }
      //   }
      // }
    }

    console.log("\nConcrete Datatypes:");
    for (const [name, symbol] of this.concreteDatatypes.entries()) {
      console.log(serializeSymbol(symbol));
    }
  }
}
