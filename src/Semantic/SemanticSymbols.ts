import { CompilerError, InternalError, type SourceLoc } from "../shared/Errors";
import type {
  ASTStructDefinition,
  EBinaryOperation,
  EExternLanguage,
  EIncrOperation,
  EOperator,
  EUnaryOperation,
} from "../shared/AST";
import {
  BrandedArray,
  EVariableContext,
  primitiveToString,
  type Brand,
  type EMethodType,
  type EPrimitive,
  type SemanticId,
} from "../shared/common";
import type { Collect, CollectionContext } from "../SymbolCollection/SymbolCollection";

export type SemanticResult = {
  cc: CollectionContext;

  // nodes: BrandedArray<SemanticId, Semantic.Node>;
  functionNodes: BrandedArray<SemanticId, Semantic.FunctionDeclarationSymbol>;

  overloadedOperators: Semantic.FunctionDefinitionSymbol[];

  elaboratedStructDatatypes: {
    originalSymbol: Collect.Id;
    generics: Semantic.TypeId[];
    resultSymbol: Semantic.TypeId;
  }[];
  elaboratedFuncdefSymbols: {
    originalSymbol: Collect.Id;
    generics: Semantic.TypeId[];
    resultSymbol: Semantic.FunctionId;
  }[];
  elaboratedNamespaceSymbols: {
    originalSymbol: Collect.Id;
    resultSymbol: Semantic.NamespaceDatatypeSymbol;
  }[];
  elaboratedGlobalVariableSymbols: {
    originalSymbol: Collect.Id;
    resultSymbol: Semantic.GlobalVariableDefinitionSymbol;
  }[];

  elaboratedPrimitiveTypes: Semantic.PrimitiveDatatypeSymbol[];
  functionTypeCache: Semantic.FunctionDatatypeSymbol[];
  rawPointerTypeCache: Semantic.PointerDatatypeSymbol[];
  referenceTypeCache: Semantic.ReferenceDatatypeSymbol[];

  exportedCollectedSymbols: Set<number>;
};

export function makePrimitiveAvailable(
  sr: SemanticResult,
  primitive: EPrimitive
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
  export type FunctionId = Brand<number, "SemanticFunction">;
  export type TypeId = Brand<number, "SemanticType">;
  export type StatementId = Brand<number, "SemanticStatement">;
  export type ExprId = Brand<number, "SemanticExpr">;

  export type VariableSymbol = {
    variant: "Variable";
    name: string;
    memberOfStruct: TypeId | null;
    type: TypeId;
    mutable: boolean;
    export: boolean;
    externLanguage: EExternLanguage;
    variableContext: EVariableContext;
    sourceloc: SourceLoc;
    concrete: boolean;
  };

  export type GlobalVariableDefinitionSymbol = {
    variant: "GlobalVariableDefinition";
    name: string;
    type: TypeId;
    value: ExprId | null;
    mutable: boolean;
    export: boolean;
    externLanguage: EExternLanguage;
    sourceloc: SourceLoc;
    concrete: boolean;
  };

  export type FunctionDefinitionSymbol = {
    variant: "FunctionDefinition";
    staticMethod: boolean;
    type: FunctionDatatypeSymbol;
    operatorOverloading?: {
      operator: EOperator;
      asTarget: DatatypeSymbol;
    };
    parameterNames: string[];
    externLanguage: EExternLanguage;
    collectedScope?: number;
    scope?: Semantic.BlockScope;
    export: boolean;
    methodType: EMethodType;
    methodOf?: StructDatatypeSymbol;
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
    noemit: boolean;
    generics: DatatypeSymbol[];
    extern: EExternLanguage;
    members: VariableSymbol[];
    methods: Set<FunctionDefinitionSymbol>;
    parentSymbol: TypeId | null;
    rawAst: ASTStructDefinition;
    scope: Semantic.DeclScope;
    sourceloc: SourceLoc;
    concrete: boolean;
    originalCollectedSymbol: number;
  };

  export type PointerDatatypeSymbol = {
    variant: "PointerDatatype";
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

  export type ConstantDatatypeSymbol = {
    variant: "ConstantDatatype";
    kind: "boolean" | "string" | "number";
    value: boolean | string | number;
    sourceloc: SourceLoc;
    concrete: boolean;
  };

  export type Symbol =
    | VariableSymbol
    | GlobalVariableDefinitionSymbol
    | FunctionDefinitionSymbol
    | FunctionDeclarationSymbol
    | GenericParameterDatatypeSymbol
    | NamespaceDatatypeSymbol
    | FunctionDatatypeSymbol
    | StructDatatypeSymbol
    | PointerDatatypeSymbol
    | ReferenceDatatypeSymbol
    | CallableDatatypeSymbol
    | PrimitiveDatatypeSymbol
    | ConstantDatatypeSymbol;

  export type DatatypeSymbol = Extract<Symbol, { variant: `${string}Datatype` }>;

  export type ExprMemberAccessExpr = {
    variant: "ExprMemberAccess";
    expr: Expression;
    memberName: string;
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

  export type UnaryExpr = {
    variant: "UnaryExpr";
    expr: Expression;
    operation: EUnaryOperation;
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
    | UnaryExpr
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
      | GlobalVariableDefinitionSymbol
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
      if (symbol.variant === "ConstantDatatype") {
        throw new InternalError("A Constant Datatype cannot be defined as a symbol");
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
            symbol.sourceloc
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
      public parentScope?: DeclScope
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
      public parentScope?: BlockScope | DeclScope
    ) {
      this.symbolTable = new SymbolTable(parentScope?.symbolTable);
    }
  }

  export type Node = Expression | Symbol;
}
