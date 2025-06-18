import type { SymbolTable } from "typescript";
import { CompilerError, InternalError, type SourceLoc } from "../Errors";
import type {
  ASTStatement,
  EExternLanguage,
  ELiteralUnit,
} from "../shared/AST";
import {
  primitiveToString,
  type EMethodType,
  type EPrimitive,
  type EVariableContext,
} from "../shared/common";
import { makeSymbolId, makeTypeId, type ID } from "../shared/store";

export type SemanticResult = {
  symbolTable: Semantic.SymbolTable;
  typeTable: Semantic.TypeTable;
};

// export class ParsedStore extends BaseStore {
//   globalScope: ResolvedScope;

//   private scopes: Map<ScopeId, ResolvedScope> = new Map();
//   private symbols: Map<SymbolId, ParsedSymbol.Symbol> = new Map();
//   private datatypes: Map<TypeId, ParsedDatatype.Datatype> = new Map();

//   constructor(module: Module) {
//     super(module);

//     this.globalScope = this.createScope(new SourceLoc("global", 0, 0));
//     this.createPrimitiveTypeAndSymbol(EPrimitive.none);
//     this.createPrimitiveTypeAndSymbol(EPrimitive.unknown);
//     this.createPrimitiveTypeAndSymbol(EPrimitive.stringview);
//     this.createPrimitiveTypeAndSymbol(EPrimitive.boolean);
//     this.createPrimitiveTypeAndSymbol(EPrimitive.booleanptr);
//     this.createPrimitiveTypeAndSymbol(EPrimitive.u8);
//     this.createPrimitiveTypeAndSymbol(EPrimitive.u16);
//     this.createPrimitiveTypeAndSymbol(EPrimitive.u32);
//     this.createPrimitiveTypeAndSymbol(EPrimitive.u64);
//     this.createPrimitiveTypeAndSymbol(EPrimitive.i8);
//     this.createPrimitiveTypeAndSymbol(EPrimitive.i16);
//     this.createPrimitiveTypeAndSymbol(EPrimitive.i32);
//     this.createPrimitiveTypeAndSymbol(EPrimitive.i64);
//     this.createPrimitiveTypeAndSymbol(EPrimitive.f32);
//     this.createPrimitiveTypeAndSymbol(EPrimitive.f64);
//   }

//   getSymbol(id: SymbolId) {
//     const dt = this.symbols.get(id);
//     if (!dt) {
//       throw new InternalError(
//         `Symbol with id ${id} is not known to the compiler`,
//       );
//     }
//     return dt;
//   }

//   getScope(id: ScopeId) {
//     const dt = this.scopes.get(id);
//     if (!dt) {
//       throw new InternalError(
//         `Scope with id ${id} is not known to the compiler`,
//       );
//     }
//     return dt;
//   }

//   getType(id: TypeId) {
//     const dt = this.datatypes.get(id);
//     if (!dt) {
//       throw new InternalError(
//         `Datatype with id ${id} is not known to the compiler`,
//       );
//     }
//     return dt;
//   }

//   createScope(location: SourceLoc, parentScope?: ScopeId) {
//     const id = this.makeScopeId();
//     return new ResolvedScope(id, location, parentScope);
//   }

//   createSymbol<T extends ParsedSymbol.Symbol>(fn: (id: SymbolId) => T) {
//     const id = this.makeSymbolId();
//     const symbol = fn(id);
//     this.symbols.set(id, symbol);
//     return symbol;
//   }

//   createDatatype<T extends ParsedDatatype.Datatype>(fn: (id: TypeId) => T) {
//     const id = this.makeTypeId();
//     const type = fn(id);
//     this.datatypes.set(id, type);
//     return type;
//   }

//   private createPrimitiveTypeAndSymbol(primitive: EPrimitive) {
//     const dt = this.createDatatype((id) => ({
//       id,
//       variant: "Primitive",
//       primitive: primitive,
//     }));
//     this.createSymbol((id) => ({
//       id,
//       variant: "Datatype",
//       name: primitiveToString(dt),
//       type: dt.id,
//       definedInScope: this.globalScope.id,
//       isExported: false,
//       location: this.globalScope.location,
//     }));
//   }
// }

// export type BaseDatatype = {
//   id: ID;
// };

// export type FunctionDatatype = {
//   variant: "Function";
//   generics: ID[];
//   functionParameters: ID[];
//   functionReturnValue: ID;
//   vararg: boolean;
// } & BaseDatatype;

// export type StructDatatype = {
//   variant: "Struct";
//   name: string;
//   generics: ID[];
//   linkage: ELinkage;
//   members: ID[];
//   methods: ID[];
//   parentSymbol?: ID;
// } & BaseDatatype;

// export type RawPointerDatatype = {
//   variant: "RawPointer";
//   pointee: ID;
// } & BaseDatatype;

// export type PrimitiveDatatype = {
//   variant: "Primitive";
//   primitive: EPrimitive;
// } & BaseDatatype;

// export type NamespaceDatatype = {
//   variant: "Namespace";
//   name: string;
//   symbolsScope: ID;
// } & BaseDatatype;

// export type Datatype =
//   | FunctionDatatype
//   | StructDatatype
//   | RawPointerDatatype
//   | PrimitiveDatatype
//   | NamespaceDatatype;

// export type DatatypeVariants =
//   | FunctionDatatype["variant"]
//   | StructDatatype["variant"]
//   | RawPointerDatatype["variant"]
//   | PrimitiveDatatype["variant"]
//   | NamespaceDatatype["variant"];

export namespace Semantic {
  export type FunctionDatatype = {
    id?: ID;
    variant: "Function";
    generics: ID[];
    functionParameters: ID[];
    functionReturnValue: ID;
    vararg: boolean;
  };

  export type StructDatatype = {
    id?: ID;
    variant: "Struct";
    name: string;
    namespaces: string[];
    fullNamespacedName: string[];
    genericSymbols: ID[];
    externLanguage: EExternLanguage;
    members: ID[];
    methods: ID[];
    // parentSymbol?: ID;
  };

  export type DeferredDatatype = {
    id?: ID;
    variant: "Deferred";
  };

  // export type GenericPlaceholderType = {
  //   id?: ID;
  //   variant: "GenericPlaceholder";
  //   name: string;
  //   sourceLoc: SourceLoc;
  //   belongsToType: ID;
  // };

  //   export type RawPointerDatatype = {
  //     id: ID;
  //     variant: "RawPointer";
  //     pointee: ID;
  //   };

  export type PrimitiveDatatype = {
    id?: ID;
    variant: "Primitive";
    primitive: EPrimitive;
  };

  // export type NamespaceDatatype = {
  //   id?: ID;
  //   variant: "Namespace";
  //   name: string;
  // };

  export type Datatype =
    | FunctionDatatype
    | DeferredDatatype
    // | GenericPlaceholderType
    | StructDatatype
    //   | RawPointerDatatype
    | PrimitiveDatatype;
  // | NamespaceDatatype;

  //   export type DatatypeVariants =
  //     | FunctionDatatype["variant"]
  //     | StructDatatype["variant"]
  //     | RawPointerDatatype["variant"]
  //     | PrimitiveDatatype["variant"]
  //     | NamespaceDatatype["variant"];

  export type VariableSymbol = {
    id?: ID;
    variant: "Variable";
    name: string;
    typeSymbol: ID;
    mutable: boolean;
    export: boolean;
    externLanguage: EExternLanguage;
    sourceLoc: SourceLoc;
  };

  export type GenericParameterSymbol = {
    id?: ID;
    variant: "GenericParameter";
    name: string;
    belongsToStruct: string[];
    sourceLoc: SourceLoc;
  };

  export type FunctionDefinitionSymbol = {
    id?: ID;
    variant: "FunctionDefinition";
    name: string;
    namespacePath: string[];
    typeSymbol: ID;
    externLanguage: EExternLanguage;
    scope: Semantic.Scope;
    export: boolean;
    method: EMethodType;
    sourceloc: SourceLoc;
  };

  export type FunctionDeclarationSymbol = {
    id?: ID;
    variant: "FunctionDeclaration";
    name: string;
    namespacePath: string[];
    typeSymbol: ID;
    externLanguage: EExternLanguage;
    export: boolean;
    method: EMethodType;
    sourceloc: SourceLoc;
  };

  export type DatatypeSymbol = {
    id?: ID;
    variant: "Datatype";
    type: ID;
    export: boolean;
    sourceloc: SourceLoc;
  };

  //   export type ConstantSymbol = {
  //     id: ID;
  //     variant: "Constant";
  //     constant:
  //       | {
  //           variant: "String";
  //           type: ID;
  //           value: string;
  //           location: SourceLoc;
  //         }
  //       | {
  //           variant: "Boolean";
  //           type: ID;
  //           value: boolean;
  //           location: SourceLoc;
  //         }
  //       | {
  //           variant: "Literal";
  //           type: ID;
  //           value: number;
  //           unit?: ELiteralUnit;
  //           location: SourceLoc;
  //         };
  //     location: SourceLoc;
  //   };

  export type Symbol =
    | VariableSymbol
    | GenericParameterSymbol
    | FunctionDefinitionSymbol
    | FunctionDeclarationSymbol
    | DatatypeSymbol;
  // | ConstantSymbol

  export type InlineCStatement = {
    id: ID;
    value: string;
    sourceloc: SourceLoc;
  };

  export type Statement = InlineCStatement;

  export class SymbolTable {
    private symbols: Map<ID, Symbol> = new Map();

    constructor() {}

    defineSymbol(symbol: Symbol) {
      // if (!symbol.id) {
      symbol.id = makeSymbolId();
      // }
      this.symbols.set(symbol.id, symbol);
      return symbol.id;
    }

    getAll() {
      return this.symbols;
    }

    get(id: ID) {
      const s = this.symbols.get(id);
      if (!s) {
        throw new InternalError(
          "Symbol with id " + id + " does not exist in symbol table",
        );
      }
      return s;
    }

    makeSymbolAvailable(symbol: Symbol) {
      const s = this.findSymbol(symbol);
      if (s) {
        return s.id!;
      } else {
        return this.defineSymbol(symbol);
      }
    }

    findSymbol(symbol: Symbol) {
      switch (symbol.variant) {
        case "Datatype":
          return [...this.symbols.values()].find(
            (s) => s.variant === "Datatype" && s.type === symbol.type,
          );

        case "Variable":
          return [...this.symbols.values()].find(
            (s) => s.variant === "Variable" && s.name === symbol.name,
          );

        case "GenericParameter":
          return [...this.symbols.values()].find(
            (s) =>
              s.variant === "GenericParameter" &&
              s.name === symbol.name &&
              s.belongsToStruct.toString() ===
                symbol.belongsToStruct.toString(),
          );

        case "FunctionDefinition":
          return [...this.symbols.values()].find(
            (s) => s.variant === "FunctionDefinition" && s.name === symbol.name,
          );

        case "FunctionDeclaration":
          return [...this.symbols.values()].find(
            (s) =>
              s.variant === "FunctionDeclaration" && s.name === symbol.name,
          );

        default:
          throw new InternalError("Unexpected symbol type");
      }
    }

    tryLookupSymbol(name: string): Symbol | undefined {
      const symbol = [...this.symbols.values()].find(
        (s) => "name" in s && s.name === name,
      );
      if (symbol) {
        return symbol;
      }
      return undefined;
    }

    lookupSymbol(name: string, loc: SourceLoc): Symbol {
      const symbol = this.tryLookupSymbol(name);
      if (symbol) {
        return symbol;
      }
      throw new CompilerError(
        `Symbol '${name}' was not declared in this scope`,
        loc,
      );
    }
  }

  export class TypeTable {
    private datatypes: Map<ID, Datatype> = new Map();

    constructor() {}

    defineDatatype(datatype: Datatype) {
      if (this.exists(datatype)) {
        throw new InternalError(`Symbol already exists in symbol table`);
      }
      // if (!datatype.id) {
      datatype.id = makeTypeId();
      // }
      this.datatypes.set(datatype.id, datatype);
      return datatype.id;
    }

    exists(datatype: Datatype) {
      return Boolean(this.findDatatype(datatype));
    }

    getAll() {
      return this.datatypes;
    }

    get(id: ID) {
      const s = this.datatypes.get(id);
      if (!s) {
        throw new InternalError(
          "Type with id " + id + " does not exist in type table",
        );
      }
      return s;
    }

    findDatatype(datatype: Datatype) {
      switch (datatype.variant) {
        case "Function":
          return [...this.datatypes.values()].find(
            (f) =>
              f.variant === "Function" &&
              f.functionParameters.toString() ===
                datatype.functionParameters.toString() &&
              f.functionReturnValue === datatype.functionReturnValue &&
              f.generics.toString() === datatype.generics.toString() &&
              f.vararg === datatype.vararg,
          );

        case "Primitive":
          return [...this.datatypes.values()].find(
            (d) =>
              d.variant === "Primitive" && d.primitive === datatype.primitive,
          );

        case "Struct":
          return [...this.datatypes.values()].find(
            (d) =>
              d.variant === "Struct" &&
              d.name === datatype.name &&
              d.genericSymbols.toString() ===
                datatype.genericSymbols.toString(),
          );

        case "Deferred":
          return [...this.datatypes.values()].find(
            (d) => d.variant === "Deferred",
          );

        // case "GenericPlaceholder":
        //   return [...this.datatypes.values()].find(
        //     (d) =>
        //       d.variant === "GenericPlaceholder" &&
        //       d.name === datatype.name &&
        //       d.belongsToType === datatype.belongsToType,
        //   );

        // case "Namespace":
        //   return [...this.datatypes.values()].find(
        //     (d) => d.variant === "Namespace" && d.name === datatype.name,
        //   );

        default:
          throw new InternalError("Unexpected symbol type");
      }
    }

    makeDatatypeAvailable(datatype: Datatype) {
      const dt = this.findDatatype(datatype);
      if (dt) {
        return dt.id!;
      } else {
        return this.defineDatatype(datatype);
      }
    }

    lookupByName(name: string): Datatype | undefined {
      const symbol = [...this.datatypes.values()].find(
        (s) => "name" in s && s.name === name,
      );
      if (symbol) {
        return symbol;
      }
      return undefined;
    }
  }

  export class Scope {
    public statements: Semantic.Statement[] = [];
    public symbolTable: SymbolTable;

    constructor(public location: SourceLoc) {
      this.symbolTable = new SymbolTable();
    }
  }
}
