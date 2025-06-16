import type { ParserRuleContext } from "antlr4ng";
import {
  CompilerError,
  GeneralError,
  getCallerLocation,
  ImpossibleSituation,
  InternalError,
  SourceLoc,
} from "./Errors";
import { ResolvedScope } from "./Scope";
import { isDeeplyEqual } from "./deep-equal";
import type {
  VariableDeclarationStatement,
  VariableDefinitionStatement,
} from "./Statement";
import { SymbolCollector } from "./SymbolCollector";
import type { ModuleConfig } from "./Config";
import { ParsedStore } from "./store";
import type { ParsedDatatype, ParsedSymbol } from "./ParsedTypes";

export class Module {
  concreteGlobalStatements: Map<
    string,
    VariableDefinitionStatement | VariableDeclarationStatement
  > = new Map();
  cDefinitionDecl: string[] = [];
  scopeStack: ResolvedScope[];
  moduleConfig: ModuleConfig;
  ast?: ParserRuleContext;
  filename?: string;
  collector: SymbolCollector;

  exportSymbols: Map<string, ParsedSymbol.Symbol> = new Map();

  parsedStore = new ParsedStore(this);

  private anonymousStuffCounter = 0;

  constructor(moduleConfig: ModuleConfig) {
    this.scopeStack = [];
    this.moduleConfig = moduleConfig;
    this.collector = new SymbolCollector(this);

    // const array: DatatypeSymbol<StructDatatype> = {
    //   variant: "Datatype",
    //   name: "__C_Array",
    //   type: {
    //     variant: "Struct",
    //     generics: new Map()
    //       .set("_Arr_T", undefined)
    //       .set("_Arr_Size", undefined),
    //     language: Linkage.Internal,
    //     members: [],
    //     methods: [],
    //     name: "__C_Array",
    //   },
    //   scope: this.parsedStore.globalScope,
    //   export: false,
    //   location: this.parsedStore.globalScope.location,
    // };
    // this.parsedStore.globalScope.defineSymbol(array);

    // if (this.moduleConfig.nostdlib) {
    //   const symbol: DatatypeSymbol = {
    //     variant: "Datatype",
    //     name: "Context",
    //     scope: this.parsedStore.globalScope,
    //     type: {
    //       variant: "Struct",
    //       generics: new Map(),
    //       language: Linkage.Internal,
    //       members: [],
    //       methods: [],
    //       name: "Context",
    //     },
    //     export: false,
    //     location: this.parsedStore.globalScope.location,
    //   };
    //   this.parsedStore.globalScope.defineSymbol(symbol);
    // }
  }

  location(ctx: ParserRuleContext) {
    if (!this.filename) {
      throw new InternalError("Missing filename", getCallerLocation(2));
    }
    return new SourceLoc(
      this.filename,
      ctx.start?.line ?? 0,
      ctx.start?.column ?? 0,
    );
  }

  getBuiltinPrimitive(name: string) {
    const type = this.parsedStore.getType(this.getBuiltinTypeSymbol(name).type);
    if (type.variant !== "Primitive") {
      throw new InternalError("getBuiltinPrimitive got a non-primitive");
    }
    return type;
  }

  getBuiltinTypeSymbol(name: string): ParsedSymbol.DatatypeSymbol {
    const symbol = this.parsedStore.globalScope.lookupSymbol(
      this,
      name,
      this.parsedStore.globalScope.location,
    );
    if (symbol.variant !== "Datatype") {
      throw new InternalError("getBuiltinTypeSymbol got a non-datatype");
    }
    return symbol;
  }

  pushScope(scope: ResolvedScope) {
    this.scopeStack.push(scope);
    return scope;
  }

  popScope() {
    this.scopeStack.pop();
  }

  get currentScope() {
    if (this.scopeStack.length === 0) {
      return this.parsedStore.globalScope;
    }
    return this.scopeStack[this.scopeStack.length - 1];
  }

  // findBaseDatatype(basename: string) {
  //   for (const dt of this.datatypes) {
  //     switch (dt.variant) {
  //       case "Primitive":
  //         if (primitiveVariantToString(dt) === basename) {
  //           return dt;
  //         }
  //         break;

  //       case "Struct":
  //         if (dt.name === basename) {
  //           return dt;
  //         }
  //         break;
  //     }
  //   }
  //   return undefined;
  // }

  // addDatatypeRef(type: Datatype, loc: Location) {
  //   switch (type.variant) {
  //     case "Primitive":
  //       if (
  //         !this.datatypes.find(
  //           (d) => d.variant === "Primitive" && d.primitive === type.primitive,
  //         )
  //       ) {
  //         this.datatypes.push(type);
  //       }
  //       break;

  //     case "Generic":
  //       break;

  //     case "Struct":
  //       const found = this.datatypes.find(
  //         (d) => d.variant === "Struct" && d.name === type.name,
  //       ) as StructDatatype | undefined;
  //       if (found) {
  //         if (found.generics !== type.generics) {
  //           throw new CompilerError(
  //             `Type '${found.name}<>' was already declared with incompatible generics list`,
  //             loc,
  //           );
  //         }
  //         if (!isDeeplyEqual(found.members, type.members)) {
  //           throw new CompilerError(
  //             `Type '${found.name}<>' was already declared with incompatible members list`,
  //             loc,
  //           );
  //         }
  //         if (!isDeeplyEqual(found.methods, type.methods)) {
  //           throw new CompilerError(
  //             `Type '${found.name}<>' was already declared with incompatible methods list`,
  //             loc,
  //           );
  //         }
  //       } else {
  //         this.datatypes.push(type);
  //       }
  //       break;

  //     case "Function":
  //       this.addDatatypeRef(type.functionReturnType, loc);
  //       type.functionParameters.forEach((p) => this.addDatatypeRef(p[1], loc));
  //       break;
  //   }
  //   this.datatypes.push(type);
  // }

  makeAnonymousName() {
    return `__anonym_${this.anonymousStuffCounter++}`;
  }

  makeTempVarname() {
    return `__temp_${this.anonymousStuffCounter++}`;
  }

  // print() {
  //   console.log("Program");
  //   for (const symbol of this.parsedStore.globalScope.getAllSymbols()) {
  //     console.log(serializeSymbol(symbol));
  //     // if (symbol.type.variant === "Struct") {
  //     //   for (const s of symbol.type.members) {
  //     //     console.log(serializeDatatype(s.type));
  //     //   }
  //     // }
  //   }

  //   console.log("\nConcrete Functions:");
  //   for (const [name, symbol] of this.concreteFunctions.entries()) {
  //     console.log(serializeSymbol(symbol));
  //     // if (symbol.type.functionParameters.length > 0) {
  //     //   const [name, p] = symbol.type.functionParameters[0];
  //     //   if (p) {
  //     //     if (p.variant === "Struct") {
  //     //       for (const s of p.members) {
  //     //         console.log(serializeDatatype(s.type));
  //     //       }
  //     //     }
  //     //   }
  //     // }
  //   }

  //   console.log("\nConcrete Datatypes:");
  //   for (const [name, symbol] of this.concreteDatatypes.entries()) {
  //     console.log(serializeSymbol(symbol));
  //   }
  // }
}
