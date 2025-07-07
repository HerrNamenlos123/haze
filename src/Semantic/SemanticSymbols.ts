import { CompilerError, InternalError, type SourceLoc } from "../shared/Errors";
import type {
  ASTStructDefinition,
  EBinaryOperation,
  EExternLanguage,
  EIncrOperation,
} from "../shared/AST";
import {
  EVariableContext,
  primitiveToString,
  type EMethodType,
  type EPrimitive,
} from "../shared/common";
import {
  makeSemanticScopeId,
  makeSemanticSymbolId,
  type CollectScopeId,
  type SemanticScopeId,
  type SemanticSymbolId,
} from "../shared/store";
import type { Collect } from "../SymbolCollection/CollectSymbols";

export type SemanticResult = {
  globalNamespace: Semantic.NamespaceSymbol;
  monomorphizedSymbols: Semantic.StructDatatypeSymbol[];
};

export function isDatatypeSymbol(x: Semantic.Symbol): x is Semantic.DatatypeSymbol {
  return x.variant.endsWith("Datatype");
}

export namespace Semantic {
  export type VariableSymbol = {
    variant: "Variable";
    name: string;
    memberOf?: StructDatatypeSymbol | NamespaceSymbol;
    type: DatatypeSymbol;
    // definedInScope: SemanticScopeId;
    mutable: boolean;
    export: boolean;
    externLanguage: EExternLanguage;
    variableContext: EVariableContext;
    sourceloc: SourceLoc;
    concrete: boolean;
  };

  export type FunctionDefinitionSymbol = {
    variant: "FunctionDefinition";
    name: string;
    type: FunctionDatatypeSymbol;
    externLanguage: EExternLanguage;
    collectedScope?: Collect.Scope;
    scope?: Semantic.BlockScope;
    export: boolean;
    methodType: EMethodType;
    methodOf?: StructDatatypeSymbol;
    sourceloc: SourceLoc;
    parent?: StructDatatypeSymbol | NamespaceSymbol;
    concrete: boolean;
  };

  export type FunctionDeclarationSymbol = {
    variant: "FunctionDeclaration";
    name: string;
    type: FunctionDatatypeSymbol;
    externLanguage: EExternLanguage;
    export: boolean;
    methodType: EMethodType;
    sourceloc: SourceLoc;
    nestedParentTypeSymbol?: StructDatatypeSymbol | NamespaceSymbol;
    concrete: boolean;
  };

  export type FunctionDatatypeSymbol = {
    variant: "FunctionDatatype";
    parameters: DatatypeSymbol[];
    returnType: DatatypeSymbol;
    vararg: boolean;
    concrete: boolean;
  };

  export type StructDatatypeSymbol = {
    variant: "StructDatatype";
    name: string;
    generics: DatatypeSymbol[];
    externLanguage: EExternLanguage;
    members: VariableSymbol[];
    methods: FunctionDefinitionSymbol[];
    parent?: StructDatatypeSymbol | NamespaceSymbol;
    rawAst: ASTStructDefinition;
    scope: Semantic.DeclScope;
    sourceloc: SourceLoc;
    concrete: boolean;
  };

  export type RawPointerDatatypeSymbol = {
    variant: "RawPointerDatatype";
    pointee: DatatypeSymbol;
    concrete: boolean;
  };

  export type ReferenceDatatypeSymbol = {
    variant: "ReferenceDatatype";
    referee: DatatypeSymbol;
    concrete: boolean;
  };

  export type CallableDatatypeSymbol = {
    variant: "CallableDatatype";
    thisExprType?: DatatypeSymbol;
    functionType: FunctionDatatypeSymbol;
    concrete: boolean;
  };

  export type DeferredDatatypeSymbol = {
    variant: "DeferredDatatype";
    concrete: boolean;
  };

  export type PrimitiveDatatypeSymbol = {
    variant: "PrimitiveDatatype";
    primitive: EPrimitive;
    concrete: boolean;
  };

  export type GenericParameterDatatypeSymbol = {
    variant: "GenericParameterDatatype";
    name: string;
    concrete: boolean;
  };

  export type NamespaceSymbol = {
    variant: "Namespace";
    name: string;
    nestedParentTypeSymbol?: Semantic.NamespaceSymbol | Semantic.StructDatatypeSymbol;
    scope: Semantic.DeclScope;
    sourceloc: SourceLoc;
    concrete: boolean;
  };

  export type Symbol =
    | VariableSymbol
    | FunctionDefinitionSymbol
    | FunctionDeclarationSymbol
    | GenericParameterDatatypeSymbol
    | NamespaceSymbol
    | FunctionDatatypeSymbol
    | StructDatatypeSymbol
    | RawPointerDatatypeSymbol
    | ReferenceDatatypeSymbol
    | CallableDatatypeSymbol
    | DeferredDatatypeSymbol
    | PrimitiveDatatypeSymbol;

  export type DatatypeSymbol = Extract<Symbol, { variant: `${string}Datatype` }>;

  // export type SymbolWithoutId =
  //   | (Omit<VariableSymbol, "id"> & { variant: "Variable" })
  //   | (Omit<GenericParameterSymbol, "id"> & { variant: "GenericParameter" })
  //   | (Omit<FunctionDefinitionSymbol, "id"> & { variant: "FunctionDefinition" })
  //   | (Omit<FunctionDeclarationSymbol, "id"> & { variant: "FunctionDeclaration" })
  //   | (Omit<NamespaceSymbol, "id"> & { variant: "Namespace" })
  //   | (Omit<FunctionDatatypeSymbol, "id"> & { variant: "FunctionDatatype" })
  //   | (Omit<StructDatatypeSymbol, "id"> & { variant: "StructDatatype" })
  //   | (Omit<RawPointerDatatypeSymbol, "id"> & { variant: "RawPointerDatatype" })
  //   | (Omit<ReferenceDatatypeSymbol, "id"> & { variant: "ReferenceDatatype" })
  //   | (Omit<CallableDatatypeSymbol, "id"> & { variant: "CallableDatatype" })
  //   | (Omit<DeferredDatatypeSymbol, "id"> & { variant: "DeferredDatatype" })
  //   | (Omit<PrimitiveDatatypeSymbol, "id"> & { variant: "PrimitiveDatatype" });

  export type ExprMemberAccessExpr = {
    variant: "ExprMemberAccess";
    expr: Expression;
    method?: SemanticSymbolId;
    memberName: string;
    isReference: boolean;
    type: DatatypeSymbol;
    sourceloc: SourceLoc;
  };

  export type CallableExpr = {
    variant: "CallableExpr";
    thisExpr: Expression;
    functionSymbol: FunctionDefinitionSymbol;
    type: DatatypeSymbol;
    sourceloc: SourceLoc;
  };

  export type SymbolValueExpr = {
    variant: "SymbolValue";
    symbol: Symbol;
    type: DatatypeSymbol;
    functionSymbol?: SemanticSymbolId;
    sourceloc: SourceLoc;
  };

  export type ExplicitCastExpr = {
    variant: "ExplicitCast";
    expr: Expression;
    type: DatatypeSymbol;
    sourceloc: SourceLoc;
  };

  export type SymbolValueThisPtrExpr = {
    variant: "SymbolValueThisPointer";
    type: DatatypeSymbol;
    sourceloc: SourceLoc;
  };

  export type BinaryExpr = {
    variant: "BinaryExpr";
    left: Expression;
    right: Expression;
    operation: EBinaryOperation;
    type: DatatypeSymbol;
    sourceloc: SourceLoc;
  };

  export type PostIncrExpr = {
    variant: "PostIncrExpr";
    expr: Expression;
    operation: EIncrOperation;
    type: DatatypeSymbol;
    sourceloc: SourceLoc;
  };

  export type PreIncrExpr = {
    variant: "PreIncrExpr";
    expr: Expression;
    operation: EIncrOperation;
    type: DatatypeSymbol;
    sourceloc: SourceLoc;
  };

  export type ExprCallExpr = {
    variant: "ExprCall";
    calledExpr: Expression;
    arguments: Expression[];
    type: DatatypeSymbol;
    sourceloc: SourceLoc;
  };

  export type StructInstantiationExpr = {
    variant: "StructInstantiation";
    assign: {
      name: string;
      value: Expression;
    }[];
    type: DatatypeSymbol;
    sourceloc: SourceLoc;
  };

  export type ConstantExpr = {
    variant: "Constant";
    value: number | string | boolean;
    type: DatatypeSymbol;
    sourceloc: SourceLoc;
  };

  export type Expression =
    | ExprMemberAccessExpr
    | SymbolValueExpr
    | SymbolValueThisPtrExpr
    | BinaryExpr
    | CallableExpr
    | PreIncrExpr
    | PostIncrExpr
    | ExplicitCastExpr
    | ExprCallExpr
    | StructInstantiationExpr
    | ConstantExpr;

  export type InlineCStatement = {
    variant: "InlineCStatement";
    value: string;
    sourceloc: SourceLoc;
  };

  export type ReturnStatement = {
    variant: "ReturnStatement";
    expr?: Expression;
    sourceloc: SourceLoc;
  };

  export type IfStatement = {
    variant: "IfStatement";
    condition: Expression;
    then: BlockScope;
    elseIfs: {
      condition: Expression;
      then: BlockScope;
    }[];
    else?: BlockScope;
    sourceloc: SourceLoc;
  };

  export type WhileStatement = {
    variant: "WhileStatement";
    condition: Expression;
    then: BlockScope;
    sourceloc: SourceLoc;
  };

  export type VariableStatement = {
    variant: "VariableStatement";
    name: string;
    value?: Expression;
    mutable: boolean;
    variableSymbol: VariableSymbol;
    sourceloc: SourceLoc;
  };

  export type ExprStatement = {
    variant: "ExprStatement";
    expr: Expression;
    sourceloc: SourceLoc;
  };

  export type Statement =
    | InlineCStatement
    | ReturnStatement
    | VariableStatement
    | IfStatement
    | WhileStatement
    | ExprStatement;

  // export class GlobalSymbolTable {
  //   private symbols: Map<SemanticSymbolId, Symbol> = new Map();

  //   constructor(public parentTable?: SymbolTable) {}

  //   defineSymbol(symbol: SymbolWithoutId): Symbol {
  //     const _symbol = symbol as Symbol;
  //     _symbol.id = makeSemanticSymbolId();
  //     this.symbols.set(_symbol.id, _symbol);
  //     return _symbol;
  //   }

  //   getAll() {
  //     return this.symbols;
  //   }

  //   get(id: SemanticSymbolId, errorPropagationSteps = 0) {
  //     const s = this.symbols.get(id);
  //     if (!s) {
  //       throw new InternalError(
  //         "Symbol with id " + id + " does not exist in symbol table",
  //         undefined,
  //         errorPropagationSteps + 1,
  //       );
  //     }
  //     return s;
  //   }

  //   makeSymbolAvailable(symbol: SymbolWithoutId) {
  //     const s = this.findSymbol(symbol);
  //     if (s) {
  //       return s;
  //     } else {
  //       return this.defineSymbol(symbol);
  //     }
  //   }

  //   makePrimitiveAvailable(primitive: EPrimitive) {
  //     return this.makeSymbolAvailable({
  //       variant: "PrimitiveDatatype",
  //       primitive: primitive,
  //       concrete: true,
  //     });
  //   }

  //   findSymbol(symbol: SymbolWithoutId): Symbol | undefined {
  //     switch (symbol.variant) {
  //       case "Variable":
  //         return [...this.symbols.values()].find(
  //           (s) =>
  //             s.variant === "Variable" &&
  //             s.name === symbol.name &&
  //             s.concrete === symbol.concrete &&
  //             s.memberOf === symbol.memberOf &&
  //             s.definedInScope === symbol.definedInScope,
  //         );

  //       case "GenericParameter":
  //         return [...this.symbols.values()].find(
  //           (s) =>
  //             s.variant === "GenericParameter" &&
  //             s.name === symbol.name &&
  //             s.uniqueNamespacedIdentifier.toString() ===
  //               symbol.uniqueNamespacedIdentifier.toString(),
  //         );

  //       case "FunctionDefinition":
  //         return [...this.symbols.values()].find(
  //           (s) =>
  //             s.variant === "FunctionDefinition" &&
  //             s.name === symbol.name &&
  //             s.concrete === symbol.concrete &&
  //             s.nestedParentTypeSymbol === symbol.nestedParentTypeSymbol,
  //         );

  //       case "FunctionDeclaration":
  //         return [...this.symbols.values()].find(
  //           (s) =>
  //             s.variant === "FunctionDeclaration" &&
  //             s.name === symbol.name &&
  //             s.concrete === symbol.concrete &&
  //             s.nestedParentTypeSymbol === symbol.nestedParentTypeSymbol,
  //         );

  //       case "Namespace":
  //         return [...this.symbols.values()].find(
  //           (s) =>
  //             s.variant === "Namespace" &&
  //             s.name === symbol.name &&
  //             s.nestedParentTypeSymbol === symbol.nestedParentTypeSymbol,
  //         );

  //       case "FunctionDatatype":
  //         return [...this.symbols.values()].find(
  //           (f) =>
  //             f.variant === "FunctionDatatype" &&
  //             f.functionParameters.toString() === symbol.functionParameters.toString() &&
  //             f.functionReturnValue === symbol.functionReturnValue &&
  //             f.generics.toString() === symbol.generics.toString() &&
  //             f.concrete === symbol.concrete &&
  //             f.vararg === symbol.vararg,
  //         );

  //       case "PrimitiveDatatype":
  //         return [...this.symbols.values()].find(
  //           (d) => d.variant === "PrimitiveDatatype" && d.primitive === symbol.primitive,
  //         );

  //       case "StructDatatype":
  //         return [...this.symbols.values()].find(
  //           (d) =>
  //             d.variant === "StructDatatype" &&
  //             d.concrete === symbol.concrete &&
  //             d.name === symbol.name &&
  //             d.definedInNamespaceOrStruct === symbol.definedInNamespaceOrStruct &&
  //             d.genericSymbols.toString() === symbol.genericSymbols.toString(),
  //         );

  //       case "DeferredDatatype":
  //         return [...this.symbols.values()].find((d) => d.variant === "DeferredDatatype");

  //       case "RawPointerDatatype":
  //         return [...this.symbols.values()].find(
  //           (d) => d.variant === "RawPointerDatatype" && d.pointee === symbol.pointee,
  //         );

  //       case "ReferenceDatatype":
  //         return [...this.symbols.values()].find(
  //           (d) => d.variant === "ReferenceDatatype" && d.referee === symbol.referee,
  //         );

  //       case "CallableDatatype": {
  //         return [...this.symbols.values()].find(
  //           (d) =>
  //             d.variant === "CallableDatatype" &&
  //             d.functionType === symbol.functionType &&
  //             d.concrete === symbol.concrete &&
  //             d.thisExprType === symbol.thisExprType,
  //         );
  //       }

  //       default:
  //         throw new InternalError("Unexpected symbol type");
  //     }
  //   }

  //   tryLookupSymbolHere(name: string): Symbol | undefined {
  //     const symbol = [...this.symbols.values()].find((s) => "name" in s && s.name === name);
  //     if (symbol) {
  //       return symbol;
  //     }
  //     return undefined;
  //   }

  //   lookupSymbolHere(name: string, loc: SourceLoc): Symbol {
  //     const symbol = this.tryLookupSymbolHere(name);
  //     if (symbol) {
  //       return symbol;
  //     }
  //     throw new CompilerError(`Symbol '${name}' was not declared in this scope`, loc);
  //   }

  //   lookupSymbol(name: string, loc: SourceLoc): Symbol {
  //     let p: SymbolTable | undefined = this;
  //     while (p) {
  //       const symbol = p.tryLookupSymbolHere(name);
  //       if (symbol) {
  //         return symbol;
  //       }
  //       p = p.parentTable;
  //     }
  //     throw new CompilerError(`Symbol '${name}' was not declared in this scope`, loc);
  //   }

  //   // lookupByName(name: string): Symboll | undefined {
  //   //   const symbol = [...this.datatypes.values()].find((s) => "name" in s && s.name === name);
  //   //   if (symbol) {
  //   //     return symbol;
  //   //   }
  //   //   return undefined;
  //   // }

  //   // makePrimitiveDatatypeAvailable(primitive: EPrimitive) {
  //   //   return this.makeDatatypeAvailable({
  //   //     variant: "Primitive",
  //   //     primitive: primitive,
  //   //     concrete: true,
  //   //   });
  //   // }
  // }

  export class SymbolTable {
    symbols: (
      | VariableSymbol
      | FunctionDefinitionSymbol
      | FunctionDeclarationSymbol
      | NamespaceSymbol
      | PrimitiveDatatypeSymbol
      | StructDatatypeSymbol
    )[] = [];

    constructor(public parentTable?: SymbolTable) { }

    defineSymbol(symbol: Symbol): Symbol {
      if (symbol.variant === "FunctionDatatype") {
        throw new InternalError("A Function Datatype cannot be defined as a symbol");
      }
      if (symbol.variant === "RawPointerDatatype") {
        throw new InternalError("A Raw Pointer Datatype cannot be defined as a symbol");
      }
      if (symbol.variant === "ReferenceDatatype") {
        throw new InternalError("A Reference Datatype cannot be defined as a symbol");
      }
      if (symbol.variant === "CallableDatatype") {
        throw new InternalError("A Callable Datatype cannot be defined as a symbol");
      }
      if (symbol.variant === "DeferredDatatype") {
        throw new InternalError("A Deferred Datatype cannot be defined as a symbol");
      }
      if (symbol.variant === "GenericParameterDatatype") {
        throw new InternalError("A Generic Parameter Datatype cannot be defined as a symbol");
      }
      if (symbol.variant === "PrimitiveDatatype") {
        const name = primitiveToString(symbol.primitive);
        if (this.tryLookupSymbolHere(name)) {
          throw new InternalError(`Symbol ${name} was already defined in this scope`);
        }
      } else {
        if (this.tryLookupSymbolHere(symbol.name)) {
          throw new CompilerError(
            `Symbol ${symbol.name} was already defined in this scope`,
            symbol.sourceloc,
          );
        }
      }

      this.symbols.push(symbol);
      return symbol;
    }

    tryLookupSymbolHere(name: string): Symbol | undefined {
      const symbol = this.symbols.find((s) => {
        if (
          (s.variant === "PrimitiveDatatype" && primitiveToString(s.primitive) === name) ||
          (s.variant !== "PrimitiveDatatype" && s.name === name)
        ) {
          return true;
        }
      });
      if (symbol) {
        return symbol;
      }
      return undefined;
    }

    lookupSymbolHere(name: string, loc: SourceLoc): Symbol {
      const symbol = this.tryLookupSymbolHere(name);
      if (symbol) {
        return symbol;
      }
      throw new CompilerError(`Symbol '${name}' was not declared in this scope`, loc);
    }

    lookupSymbol(name: string, loc: SourceLoc): Symbol {
      let p: SymbolTable | undefined = this;
      while (p) {
        const symbol = p.tryLookupSymbolHere(name);
        if (symbol) {
          return symbol;
        }
        p = p.parentTable;
      }
      throw new CompilerError(`Symbol '${name}' was not declared in this scope`, loc);
    }
  }

  export class DeclScope {
    public id: SemanticScopeId;
    public symbolTable: SymbolTable;

    constructor(
      public sourceloc: SourceLoc,
      public collectedScope: Collect.Scope,
      public parentScope?: DeclScope,
    ) {
      this.id = makeSemanticScopeId();
      this.symbolTable = new SymbolTable(parentScope?.symbolTable);
    }

    makePrimitiveAvailable(primitive: EPrimitive): PrimitiveDatatypeSymbol {
      const p = this.symbolTable.tryLookupSymbolHere(primitiveToString(primitive));
      if (p) {
        return p as PrimitiveDatatypeSymbol;
      } else {
        return this.symbolTable.defineSymbol({
          variant: "PrimitiveDatatype",
          primitive: primitive,
          concrete: true,
        }) as PrimitiveDatatypeSymbol;
      }
    }
  }

  export class BlockScope {
    public id: SemanticScopeId;
    public statements: Semantic.Statement[] = [];
    public symbolTable: SymbolTable;
    public returnedTypes: (DatatypeSymbol | undefined)[] = [];

    constructor(
      public sourceloc: SourceLoc,
      public collectedScope: Collect.Scope,
      public parentScope?: BlockScope | DeclScope,
    ) {
      this.id = makeSemanticScopeId();
      this.symbolTable = new SymbolTable(parentScope?.symbolTable);
    }
  }
}

// export function getSymbol(sr: SemanticResult, id: SemanticSymbolId, errorPropagationSteps = 0) {
//   if (!id) throw new InternalError("ID is undefined", undefined, 1);
//   const symbol = sr.symbolTable.get(id, 1 + errorPropagationSteps);
//   if (!symbol) {
//     throw new InternalError("Symbol does not exist " + id);
//   }
//   return symbol;
// }
