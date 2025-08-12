import { assert, CompilerError, InternalError, type SourceLoc } from "../shared/Errors";
import type {
  ASTStructDefinition,
  EBinaryOperation,
  EExternLanguage,
  EIncrOperation,
  EOperator,
  EUnaryOperation,
  EVariableMutability,
} from "../shared/AST";
import {
  BrandedArray,
  EVariableContext,
  primitiveToString,
  type Brand,
  type EMethodType,
  type EPrimitive,
  type LiteralValue,
} from "../shared/common";
import { Collect, type CollectionContext } from "../SymbolCollection/SymbolCollection";
import type { Encoding } from "bun";

export type SemanticResult = {
  cc: CollectionContext;

  // nodes: BrandedArray<SemanticId, Semantic.Node>;
  // functionNodes: BrandedArray<Semantic.FunctionId, Semantic.FunctionDefinitionSymbol>;
  // typeNodes: BrandedArray<Semantic.TypeId, Semantic.DatatypeSymbol>;
  // exprNodes: BrandedArray<Semantic.ExprId, Semantic.Expression>;
  // variableNodes: BrandedArray<Semantic.VariableId, Semantic.VariableSymbol>;
  nodes: BrandedArray<Semantic.Id, Semantic.Node>;

  overloadedOperators: Semantic.FunctionSymbol[];

  elaboratedStructDatatypes: {
    originalSymbol: Collect.Id;
    generics: Semantic.Id[];
    resultSymbol: Semantic.Id;
  }[];
  elaboratedFuncdefSymbols: {
    originalSymbol: Collect.Id;
    generics: Semantic.Id[];
    resultSymbol: Semantic.Id;
  }[];
  elaboratedNamespaceSymbols: {
    originalSharedInstance: Collect.Id;
    resultSymbol: Semantic.Id;
  }[];
  elaboratedGlobalVariableStatements: {
    originalSymbol: Collect.Id;
    resultSymbol: Semantic.Id;
  }[];
  elaboratedGlobalVariableSymbols: Map<Collect.Id, Semantic.Id>;
  // Function-local variable symbols are cached per function call because they are separate for each generic instance.

  elaboratedPrimitiveTypes: Semantic.Id[];
  functionTypeCache: Semantic.Id[];
  rawPointerTypeCache: Semantic.Id[];
  referenceTypeCache: Semantic.Id[];

  exportedCollectedSymbols: Set<number>;

  cInjections: Set<Collect.Id>;
};

export function makePrimitiveAvailable(sr: SemanticResult, primitive: EPrimitive): Semantic.Id {
  for (const id of sr.elaboratedPrimitiveTypes) {
    const s = sr.nodes.get(id);
    assert(s.variant === Semantic.ENode.PrimitiveDatatype);
    if (s.primitive === primitive) {
      return id;
    }
  }
  const s = Semantic.addNode(sr, {
    variant: Semantic.ENode.PrimitiveDatatype,
    primitive: primitive,
    concrete: true,
  });
  sr.elaboratedPrimitiveTypes.push(s);
  return s;
}

export function isExpression(node: Semantic.Node): node is Semantic.Expression {
  return ([...Semantic.ExpressionEnums] as number[]).includes(node.variant);
}

export function getExprType(sr: SemanticResult, exprId: Semantic.Id): Semantic.Id {
  const expr = sr.nodes.get(exprId);
  assert(isExpression(expr));
  return expr.type;
}

export function isTypeConcrete(sr: SemanticResult, id: Semantic.Id) {
  const symbol = sr.nodes.get(id);
  assert("concrete" in symbol);
  return symbol.concrete;
}

export namespace Semantic {
  export type Id = Brand<number, "Semantic">;
  export const enum ENode {
    // Symbols
    VariableSymbol,
    GlobalVariableDefinitionSymbol,
    FunctionSymbol,
    // Datatypes
    FunctionDatatype,
    StructDatatype,
    PointerDatatype,
    ReferenceDatatype,
    CallableDatatype,
    PrimitiveDatatype,
    GenericParameterDatatype,
    NamespaceDatatype,
    // Statements
    InlineCStatement,
    WhileStatement,
    IfStatement,
    VariableStatement,
    ExprStatement,
    BlockStatement,
    ReturnStatement,
    // Expressions
    ParenthesisExpr,
    BinaryExpr,
    LiteralExpr,
    UnaryExpr,
    ExprCallExpr,
    SymbolValueExpr,
    NamespaceValueExpr,
    SizeofExpr,
    ExplicitCastExpr,
    MemberAccessExpr,
    CallableExpr,
    PointerAddressOfExpr,
    PointerDereferenceExpr,
    ExprAssignmentExpr,
    StructInstantiationExpr,
    PreIncrExpr,
    PostIncrExpr,
  }

  export const ExpressionEnums = [
    ENode.ParenthesisExpr,
    ENode.BinaryExpr,
    ENode.LiteralExpr,
    ENode.UnaryExpr,
    ENode.ExprCallExpr,
    ENode.SymbolValueExpr,
    ENode.CallableExpr,
    ENode.SizeofExpr,
    ENode.ExplicitCastExpr,
    ENode.NamespaceValueExpr,
    ENode.MemberAccessExpr,
    ENode.PointerAddressOfExpr,
    ENode.PointerDereferenceExpr,
    ENode.ExprAssignmentExpr,
    ENode.StructInstantiationExpr,
    ENode.PreIncrExpr,
    ENode.PostIncrExpr,
  ] as const;

  export function addNode(sr: SemanticResult, n: Semantic.Node) {
    sr.nodes.push(n);
    return (sr.nodes.length - 1) as Semantic.Id;
  }

  export type VariableSymbol = {
    variant: ENode.VariableSymbol;
    name: string;
    memberOfStruct: Id | null;
    type: Id | null;
    mutability: EVariableMutability;
    export: boolean;
    extern: EExternLanguage;
    variableContext: EVariableContext;
    parentStructOrNS: Semantic.Id | null;
    sourceloc: SourceLoc;
    concrete: boolean;
  };

  export type GlobalVariableDefinitionSymbol = {
    variant: ENode.GlobalVariableDefinitionSymbol;
    variableSymbol: Id;
    name: string;
    value: Id | null;
    export: boolean;
    extern: EExternLanguage;
    parentStructOrNS: Semantic.Id | null;
    sourceloc: SourceLoc;
    concrete: boolean;
  };

  export type FunctionSymbol = {
    variant: ENode.FunctionSymbol;
    staticMethod: boolean;
    name: string;
    type: Id;
    operatorOverloading?: {
      operator: EOperator;
      asTarget: Id;
    };
    parameterNames: string[];
    extern: EExternLanguage;
    // collectedScope?: number;
    // scope?: Semantic.BlockScope;
    export: boolean;
    // methodType: EMethodType;
    methodOf?: StructDatatypeSymbol;
    sourceloc: SourceLoc;
    parentStructOrNS: Semantic.Id | null;
    concrete: boolean;
  };

  export type FunctionDatatypeSymbol = {
    variant: ENode.FunctionDatatype;
    parameters: Id[];
    returnType: Id;
    vararg: boolean;
    concrete: boolean;
  };

  export type StructDatatypeSymbol = {
    variant: ENode.StructDatatype;
    name: string;
    noemit: boolean;
    generics: Semantic.Id[];
    extern: EExternLanguage;
    members: VariableSymbol[];
    methods: Set<FunctionSymbol>;
    parentStructOrNS: Id | null;
    sourceloc: SourceLoc;
    concrete: boolean;
    originalCollectedSymbol: Collect.Id;
  };

  export type PointerDatatypeSymbol = {
    variant: ENode.PointerDatatype;
    pointee: Id;
    concrete: boolean;
  };

  export type ReferenceDatatypeSymbol = {
    variant: ENode.ReferenceDatatype;
    referee: Id;
    concrete: boolean;
  };

  export type CallableDatatypeSymbol = {
    variant: ENode.CallableDatatype;
    thisExprType?: Id;
    functionType: Id;
    concrete: boolean;
  };

  export type PrimitiveDatatypeSymbol = {
    variant: ENode.PrimitiveDatatype;
    primitive: EPrimitive;
    concrete: boolean;
  };

  export type GenericParameterDatatypeSymbol = {
    variant: ENode.GenericParameterDatatype;
    name: string;
    concrete: boolean;
  };

  export type NamespaceDatatypeSymbol = {
    variant: ENode.NamespaceDatatype;
    name: string;
    parentStructOrNS: Semantic.Id | null;
    concrete: boolean; // For consistency, always true
  };

  // export type ConstantDatatypeSymbol = {
  //   variant: "ConstantDatatype";
  //   kind: "boolean" | "string" | "number";
  //   value: boolean | string | number;
  //   sourceloc: SourceLoc;
  //   concrete: boolean;
  // };

  export type Symbol =
    | VariableSymbol
    | GlobalVariableDefinitionSymbol
    | FunctionSymbol
    | GenericParameterDatatypeSymbol
    | NamespaceDatatypeSymbol
    | FunctionDatatypeSymbol
    | StructDatatypeSymbol
    | PointerDatatypeSymbol
    | ReferenceDatatypeSymbol
    | CallableDatatypeSymbol
    | PrimitiveDatatypeSymbol;
  // | ConstantDatatypeSymbol;

  export type ExprMemberAccessExpr = {
    variant: ENode.MemberAccessExpr;
    expr: Id;
    memberName: string;
    type: Id;
    sourceloc: SourceLoc;
  };

  export type CallableExpr = {
    variant: ENode.CallableExpr;
    thisExpr: Id;
    functionSymbol: Id;
    type: Id;
    sourceloc: SourceLoc;
  };

  export type SymbolValueExpr = {
    variant: ENode.SymbolValueExpr;
    symbol: Symbol;
    type: Id;
    sourceloc: SourceLoc;
  };

  export type NamespaceValueExpr = {
    variant: ENode.NamespaceValueExpr;
    symbol: Id;
    type: Id;
    sourceloc: SourceLoc;
  };

  export type SizeofExpr = {
    variant: ENode.SizeofExpr;
    datatype?: Id;
    value?: Expression;
    type: Id;
    sourceloc: SourceLoc;
  };

  export type ExprAssignmentExpr = {
    variant: ENode.ExprAssignmentExpr;
    value: Id;
    target: Id;
    type: Id;
    sourceloc: SourceLoc;
  };

  export type PointerDereferenceExpr = {
    variant: ENode.PointerDereferenceExpr;
    expr: Id;
    type: Id;
    sourceloc: SourceLoc;
  };

  export type PointerAddressOfExpr = {
    variant: ENode.PointerAddressOfExpr;
    expr: Id;
    type: Id;
    sourceloc: SourceLoc;
  };

  export type ExplicitCastExpr = {
    variant: ENode.ExplicitCastExpr;
    expr: Id;
    type: Id;
    sourceloc: SourceLoc;
  };

  export type BinaryExpr = {
    variant: ENode.BinaryExpr;
    left: Id;
    right: Id;
    operation: EBinaryOperation;
    type: Id;
    sourceloc: SourceLoc;
  };

  export type UnaryExpr = {
    variant: ENode.UnaryExpr;
    expr: Id;
    operation: EUnaryOperation;
    type: Id;
    sourceloc: SourceLoc;
  };

  export type PostIncrExpr = {
    variant: ENode.PostIncrExpr;
    expr: Id;
    operation: EIncrOperation;
    type: Id;
    sourceloc: SourceLoc;
  };

  export type PreIncrExpr = {
    variant: ENode.PreIncrExpr;
    expr: Id;
    operation: EIncrOperation;
    type: Id;
    sourceloc: SourceLoc;
  };

  export type ExprCallExpr = {
    variant: ENode.ExprCallExpr;
    calledExpr: Id;
    arguments: Id[];
    type: Id;
    sourceloc: SourceLoc;
  };

  export type StructInstantiationExpr = {
    variant: ENode.StructInstantiationExpr;
    assign: {
      name: string;
      value: Id;
    }[];
    type: Id;
    sourceloc: SourceLoc;
  };

  export type LiteralExpr = {
    variant: ENode.LiteralExpr;
    literal: LiteralValue;
    type: Id;
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
    | PointerAddressOfExpr
    | PointerDereferenceExpr
    | ExplicitCastExpr
    | ExprCallExpr
    | StructInstantiationExpr
    | LiteralExpr;

  // =============================================

  export type InlineCStatement = {
    variant: ENode.InlineCStatement;
    value: string;
    sourceloc: SourceLoc;
  };

  export type ReturnStatement = {
    variant: ENode.ReturnStatement;
    expr?: Expression;
    sourceloc: SourceLoc;
  };

  export type IfStatement = {
    variant: ENode.IfStatement;
    condition: Expression;
    then: Id;
    elseIfs: {
      condition: Expression;
      then: Id;
    }[];
    else?: Id;
    sourceloc: SourceLoc;
  };

  export type WhileStatement = {
    variant: ENode.WhileStatement;
    condition: Expression;
    then: Id;
    sourceloc: SourceLoc;
  };

  export type VariableStatement = {
    variant: ENode.VariableStatement;
    name: string;
    value?: Expression;
    mutable: boolean;
    variableSymbol: VariableSymbol;
    sourceloc: SourceLoc;
  };

  export type ExprStatement = {
    variant: ENode.ExprStatement;
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

  // export class SymbolTable {
  //   symbols: (
  //     | VariableSymbol
  //     | GlobalVariableDefinitionSymbol
  //     | FunctionDefinitionSymbol
  //     | NamespaceDatatypeSymbol
  //     | PrimitiveDatatypeSymbol
  //     | StructDatatypeSymbol
  //   )[] = [];

  //   constructor(public parentTable?: SymbolTable) {}

  //   defineSymbol(symbol: Symbol): Symbol {
  //     if (symbol.variant === "FunctionDatatype") {
  //       throw new InternalError("A Function Datatype cannot be defined as a symbol");
  //     }
  //     if (symbol.variant === "RawPointerDatatype") {
  //       throw new InternalError("A Raw Pointer Datatype cannot be defined as a symbol");
  //     }
  //     if (symbol.variant === "ReferenceDatatype") {
  //       throw new InternalError("A Reference Datatype cannot be defined as a symbol");
  //     }
  //     if (symbol.variant === "CallableDatatype") {
  //       throw new InternalError("A Callable Datatype cannot be defined as a symbol");
  //     }
  //     if (symbol.variant === "DeferredDatatype") {
  //       throw new InternalError("A Deferred Datatype cannot be defined as a symbol");
  //     }
  //     if (symbol.variant === "GenericParameterDatatype") {
  //       throw new InternalError("A Generic Parameter Datatype cannot be defined as a symbol");
  //     }
  //     if (symbol.variant === "ConstantDatatype") {
  //       throw new InternalError("A Constant Datatype cannot be defined as a symbol");
  //     }
  //     if (symbol.variant === "PrimitiveDatatype") {
  //       const name = primitiveToString(symbol.primitive);
  //       if (this.tryLookupSymbolHere(name)) {
  //         throw new InternalError(`Symbol ${name} was already defined in this scope`);
  //       }
  //     } else {
  //       if (this.tryLookupSymbolHere(symbol.name)) {
  //         throw new CompilerError(
  //           `Symbol ${symbol.name} was already defined in this scope`,
  //           symbol.sourceloc
  //         );
  //       }
  //     }

  //     this.symbols.push(symbol);
  //     return symbol;
  //   }

  //   tryLookupSymbolHere(name: string): Symbol | undefined {
  //     const symbol = this.symbols.find((s) => {
  //       if (
  //         (s.variant === "PrimitiveDatatype" && primitiveToString(s.primitive) === name) ||
  //         (s.variant !== "PrimitiveDatatype" && s.name === name)
  //       ) {
  //         return true;
  //       }
  //     });
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

  //   tryLookupSymbol(name: string, loc: SourceLoc): Symbol | undefined {
  //     let p: SymbolTable | undefined = this;
  //     while (p) {
  //       const symbol = p.tryLookupSymbolHere(name);
  //       if (symbol) {
  //         return symbol;
  //       }
  //       p = p.parentTable;
  //     }
  //   }
  // }

  // export class DeclScope {
  //   public symbolTable: SymbolTable;

  //   constructor(
  //     public sourceloc: SourceLoc,
  //     public collectedScope: Collect.Scope,
  //     public parentScope?: DeclScope
  //   ) {
  //     this.symbolTable = new SymbolTable(parentScope?.symbolTable);
  //   }
  // }

  // export class BlockScope {
  //   public statements: Semantic.Statement[] = [];
  //   public symbolTable: SymbolTable;
  //   public returnedTypes: (DatatypeSymbol | undefined)[] = [];

  //   constructor(
  //     public sourceloc: SourceLoc,
  //     public collectedScope: Collect.Scope,
  //     public parentScope?: BlockScope | DeclScope
  //   ) {
  //     this.symbolTable = new SymbolTable(parentScope?.symbolTable);
  //   }
  // }

  export type Node = Expression | Symbol;
}
