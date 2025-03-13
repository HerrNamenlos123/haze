import type { ParserRuleContext } from "antlr4";
import {
  CompilerError,
  GeneralError,
  getCallerLocation,
  InternalError,
  Location,
} from "./Errors";
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
import { SymbolCollector } from "./SymbolCollector";
import type { ModuleConfig } from "./Config";

export class Module {
  globalScope: Scope;
  concreteGlobalStatements: Map<
    string,
    VariableDefinitionStatement | VariableDeclarationStatement
  > = new Map();
  concreteFunctions: Map<string, FunctionSymbol> = new Map();
  concreteDatatypes: Map<string, DatatypeSymbol> = new Map();
  cDefinitionDecl: string[] = [];
  scopeStack: Scope[];
  moduleConfig: ModuleConfig;
  ast?: ParserRuleContext;
  filename?: string;
  collector: SymbolCollector;

  datatypes: Datatype[] = [];

  exportFunctions: Map<string, FunctionSymbol> = new Map();
  exportDatatypes: Map<string, DatatypeSymbol> = new Map();

  private anonymousStuffCounter = 0;

  constructor(moduleConfig: ModuleConfig) {
    this.globalScope = new Scope(new Location("global", 0, 0));
    this.scopeStack = [];
    this.moduleConfig = moduleConfig;
    this.collector = new SymbolCollector(this);

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
        export: false,
        location: this.globalScope.location,
      };
      this.globalScope.defineSymbol(symbol);
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
      export: false,
      location: this.globalScope.location,
    };
    this.globalScope.defineSymbol(symbol);

    if (this.moduleConfig.nostdlib) {
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
        export: false,
        location: this.globalScope.location,
      };
      this.globalScope.defineSymbol(symbol);
    }
  }

  location(ctx: ParserRuleContext) {
    if (!this.filename) {
      throw new InternalError("Missing filename", getCallerLocation(2));
    }
    return new Location(this.filename, ctx.start.line, ctx.start.column);
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
