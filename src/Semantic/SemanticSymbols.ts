import { CompilerError, InternalError, type SourceLoc } from "../shared/Errors";
import type {
  ASTStructDefinition,
  EBinaryOperation,
  EExternLanguage,
  EIncrOperation,
  EOperator,
} from "../shared/AST";
import {
  EVariableContext,
  primitiveToString,
  type EMethodType,
  type EPrimitive,
} from "../shared/common";
import type { Collect } from "../SymbolCollection/CollectSymbols";

export type SemanticResult = {
  // globalNamespace: Semantic.NamespaceSymbol;
  // monomorphizedStructs: Set<Semantic.StructDatatypeSymbol>;
  // monomorphizedFuncdecls: Set<Semantic.FunctionDeclarationSymbol>;
  // monomorphizedFuncdefs: Set<Semantic.FunctionDefinitionSymbol>;
  overloadedOperators: Semantic.FunctionDefinitionSymbol[];

  elaboratedStructDatatypes: {
    originalSymbol: Collect.Symbol;
    generics: Semantic.Symbol[];
    resultSymbol: Semantic.StructDatatypeSymbol;
  }[];
  elaboratedFuncdeclSymbols: {
    originalSymbol: Collect.Symbol;
    generics: Semantic.Symbol[];
    resultSymbol: Semantic.FunctionDeclarationSymbol;
  }[];
  elaboratedFuncdefSymbols: {
    originalSymbol: Collect.Symbol;
    generics: Semantic.Symbol[];
    resultSymbol: Semantic.FunctionDefinitionSymbol;
  }[];
  elaboratedNamespaceSymbols: {
    originalSymbol: Collect.Symbol;
    resultSymbol: Semantic.NamespaceDatatypeSymbol;
  }[];
  elaboratedGlobalVariableSymbols: {
    originalSymbol: Collect.Symbol;
    resultSymbol: Semantic.VariableSymbol;
  }[];

  elaboratedPrimitiveTypes: Semantic.PrimitiveDatatypeSymbol[];
  functionTypeCache: Semantic.FunctionDatatypeSymbol[];
  rawPointerTypeCache: Semantic.RawPointerDatatypeSymbol[];
  referenceTypeCache: Semantic.ReferenceDatatypeSymbol[];
};

export function makePrimitiveAvailable(
  sr: SemanticResult,
  primitive: EPrimitive,
): Semantic.PrimitiveDatatypeSymbol {
  for (const s of sr.elaboratedPrimitiveTypes) {
    if (s.primitive === primitive) {
      return s;
    }
  }
  const s = {
    variant: "PrimitiveDatatype",
    primitive: primitive,
    concrete: true,
  } satisfies Semantic.PrimitiveDatatypeSymbol;
  sr.elaboratedPrimitiveTypes.push(s);
  return s;
}

export function isDatatypeSymbol(x: Semantic.Symbol): x is Semantic.DatatypeSymbol {
  return x.variant.endsWith("Datatype");
}

export namespace Semantic {
  export type VariableSymbol = {
    variant: "Variable";
    name: string;
    memberOf?: StructDatatypeSymbol | NamespaceDatatypeSymbol;
    type: DatatypeSymbol;
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
    generics: DatatypeSymbol[];
    staticMethod: boolean;
    type: FunctionDatatypeSymbol;
    operatorOverloading?: {
      operator: EOperator;
      asTarget: DatatypeSymbol;
    };
    parameterNames: string[];
    externLanguage: EExternLanguage;
    collectedScope?: Collect.Scope;
    scope?: Semantic.BlockScope;
    export: boolean;
    methodType: EMethodType;
    methodOf?: StructDatatypeSymbol;
    sourceloc: SourceLoc;
    parent: StructDatatypeSymbol | NamespaceDatatypeSymbol | null;
    concrete: boolean;
  };

  export type FunctionDeclarationSymbol = {
    variant: "FunctionDeclaration";
    name: string;
    type: FunctionDatatypeSymbol;
    staticMethod: boolean;
    externLanguage: EExternLanguage;
    parameterNames: string[];
    export: boolean;
    methodType: EMethodType;
    sourceloc: SourceLoc;
    parent: StructDatatypeSymbol | NamespaceDatatypeSymbol | null;
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
    methods: Set<FunctionDefinitionSymbol>;
    parent: StructDatatypeSymbol | NamespaceDatatypeSymbol | null;
    rawAst: ASTStructDefinition;
    scope: Semantic.DeclScope;
    sourceloc: SourceLoc;
    concrete: boolean;
    originalCollectedSymbol: Collect.Symbol;
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

  export type NamespaceDatatypeSymbol = {
    variant: "NamespaceDatatype";
    name: string;
    parent: Semantic.NamespaceDatatypeSymbol | Semantic.StructDatatypeSymbol | null;
    scope: Semantic.DeclScope;
    sourceloc: SourceLoc;
    concrete: boolean;
  };

  export type Symbol =
    | VariableSymbol
    | FunctionDefinitionSymbol
    | FunctionDeclarationSymbol
    | GenericParameterDatatypeSymbol
    | NamespaceDatatypeSymbol
    | FunctionDatatypeSymbol
    | StructDatatypeSymbol
    | RawPointerDatatypeSymbol
    | ReferenceDatatypeSymbol
    | CallableDatatypeSymbol
    | DeferredDatatypeSymbol
    | PrimitiveDatatypeSymbol;

  export type DatatypeSymbol = Extract<Symbol, { variant: `${string}Datatype` }>;

  export type ExprMemberAccessExpr = {
    variant: "ExprMemberAccess";
    expr: Expression;
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
    sourceloc: SourceLoc;
  };

  export type NamespaceValueExpr = {
    variant: "NamespaceValue";
    symbol: NamespaceDatatypeSymbol | StructDatatypeSymbol;
    type: DatatypeSymbol;
    sourceloc: SourceLoc;
  };

  export type SizeofExpr = {
    variant: "SizeofExpr";
    datatype?: DatatypeSymbol;
    value?: Expression;
    type: DatatypeSymbol;
    sourceloc: SourceLoc;
  };

  export type ExprAssignmentExpr = {
    variant: "ExprAssignmentExpr";
    value: Expression;
    target: Expression;
    type: DatatypeSymbol;
    sourceloc: SourceLoc;
  };

  export type RawPointerDereferenceExpr = {
    variant: "RawPointerDereference";
    expr: Expression;
    type: DatatypeSymbol;
    sourceloc: SourceLoc;
  };

  export type RawPointerAddressOfExpr = {
    variant: "RawPointerAddressOf";
    expr: Expression;
    type: DatatypeSymbol;
    sourceloc: SourceLoc;
  };

  export type ExplicitCastExpr = {
    variant: "ExplicitCast";
    expr: Expression;
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
    | NamespaceValueExpr
    | SizeofExpr
    | ExprAssignmentExpr
    | BinaryExpr
    | CallableExpr
    | PreIncrExpr
    | PostIncrExpr
    | RawPointerAddressOfExpr
    | RawPointerDereferenceExpr
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

  export class SymbolTable {
    symbols: (
      | VariableSymbol
      | FunctionDefinitionSymbol
      | FunctionDeclarationSymbol
      | NamespaceDatatypeSymbol
      | PrimitiveDatatypeSymbol
      | StructDatatypeSymbol
    )[] = [];

    constructor(public parentTable?: SymbolTable) {}

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

    tryLookupSymbol(name: string, loc: SourceLoc): Symbol | undefined {
      let p: SymbolTable | undefined = this;
      while (p) {
        const symbol = p.tryLookupSymbolHere(name);
        if (symbol) {
          return symbol;
        }
        p = p.parentTable;
      }
    }
  }

  export class DeclScope {
    public symbolTable: SymbolTable;

    constructor(
      public sourceloc: SourceLoc,
      public collectedScope: Collect.Scope,
      public parentScope?: DeclScope,
    ) {
      this.symbolTable = new SymbolTable(parentScope?.symbolTable);
    }
  }

  export class BlockScope {
    public statements: Semantic.Statement[] = [];
    public symbolTable: SymbolTable;
    public returnedTypes: (DatatypeSymbol | undefined)[] = [];

    constructor(
      public sourceloc: SourceLoc,
      public collectedScope: Collect.Scope,
      public parentScope?: BlockScope | DeclScope,
    ) {
      this.symbolTable = new SymbolTable(parentScope?.symbolTable);
    }
  }
}
