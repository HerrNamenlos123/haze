import { Conversion } from "../Semantic/Conversion";
import {
  makePrimitiveAvailable,
  makeVoidType,
  Semantic,
  type SemanticResult,
} from "../Semantic/Elaborate";
import { makeRawFunctionDatatypeAvailable, makeTypeUse } from "../Semantic/LookupDatatype";
import {
  BinaryOperationToString,
  EAssignmentOperation,
  EBinaryOperation,
  EDatatypeMutability,
  EExternLanguage,
  EIncrOperation,
  EUnaryOperation,
  EVariableMutability,
  IncrOperationToString,
  UnaryOperationToString,
} from "../shared/AST";
import {
  BrandedArray,
  EPrimitive,
  EVariableContext,
  type Brand,
  type LiteralValue,
  type NameSet,
} from "../shared/common";
import { assert, InternalError, printWarningMessage, type SourceLoc } from "../shared/Errors";
import { makeTempName } from "../shared/store";
import { Collect, printCollectedDatatype } from "../SymbolCollection/SymbolCollection";

export namespace Lowered {
  export type FunctionId = Brand<number, "LoweredFunction">;
  export type TypeUseId = Brand<number, "LoweredTypeUse">;
  export type TypeDefId = Brand<number, "LoweredTypeDef">;
  export type StatementId = Brand<number, "LoweredStatement">;
  export type ExprId = Brand<number, "LoweredExpression">;
  export type BlockScopeId = Brand<number, "LoweredBlockScope">;

  export enum ENode {
    CInjectDirective,
    // Symbols
    VariableSymbol,
    GlobalVariableDefinitionSymbol,
    FunctionSymbol,
    // Datatypes
    FunctionDatatype,
    BlockScope,
    StructDatatype,
    PointerDatatype,
    CallableDatatype,
    PrimitiveDatatype,
    GenericParameterDatatype,
    NamespaceDatatype,
    ArrayDatatype,
    SliceDatatype,
    UntaggedUnionDatatype,
    TaggedUnionDatatype,
    EnumDatatype,
    // Type Use
    TypeUse,
    // Statements
    InlineCStatement,
    WhileStatement,
    IfStatement,
    VariableStatement,
    ExprStatement,
    BlockScopeExpr,
    ReturnStatement,
    // Expressions
    ParenthesisExpr,
    BinaryExpr,
    LiteralExpr,
    UnaryExpr,
    ExprCallExpr,
    SymbolValueExpr,
    NamespaceOrStructValueExpr,
    SizeofExpr,
    AlignofExpr,
    DatatypeAsValueExpr,
    ExplicitCastExpr,
    ValueToUnionCastExpr,
    UnionToValueCastExpr,
    UnionToUnionCastExpr,
    UnionTagCheckExpr,
    MemberAccessExpr,
    CallableExpr,
    AddressOfExpr,
    DereferenceExpr,
    ExprAssignmentExpr,
    StructInstantiationExpr,
    PreIncrExpr,
    PostIncrExpr,
    ArrayLiteralExpr,
    ArraySubscriptExpr,
    ArraySliceExpr,
    StringConstructExpr,
    // Dummy
    Dummy,
  }

  export type TagMapping = {
    from: Lowered.TypeUseId;
    to: Lowered.TypeUseId;
    mapping: Map<number, number>;
  };

  export type Module = {
    sr: SemanticResult;

    functionNodes: BrandedArray<Lowered.FunctionId, Lowered.FunctionSymbol>;
    typeUseNodes: BrandedArray<Lowered.TypeUseId, Lowered.TypeUse>;
    typeDefNodes: BrandedArray<Lowered.TypeDefId, Lowered.TypeDef>;
    exprNodes: BrandedArray<Lowered.ExprId, Lowered.Expression>;
    statementNodes: BrandedArray<Lowered.StatementId, Lowered.Statement>;
    blockScopeNodes: BrandedArray<Lowered.BlockScopeId, Lowered.BlockScope>;
    cInjections: string[];

    loweredTypeDefs: Map<Semantic.TypeDefId, Lowered.TypeDefId>;
    loweredTypeUses: Map<Semantic.TypeUseId, Lowered.TypeUseId>;
    loweredFunctions: Map<Semantic.SymbolId, Lowered.FunctionId>;
    loweredPointers: Map<Lowered.TypeUseId, Lowered.TypeDefId>;
    loweredGlobalVariables: Map<Semantic.SymbolId, Lowered.StatementId[]>;

    loweredUnionMappings: TagMapping[];
  };

  export function addTypeUse<T extends Lowered.TypeUse>(
    lr: Lowered.Module,
    n: T
  ): [T, Lowered.TypeUseId] {
    if (lr.typeUseNodes.length === 0) {
      // Push a dummy because it causes issues when the id is zero, so zero is not a valid id.
      lr.typeUseNodes.push(undefined as any);
    }
    const id = lr.typeUseNodes.length as Lowered.TypeUseId;
    lr.typeUseNodes.push(n);
    return [n, id];
  }

  export function addTypeDef<T extends Lowered.TypeDef>(
    lr: Lowered.Module,
    n: T
  ): [T, Lowered.TypeDefId] {
    if (lr.typeDefNodes.length === 0) {
      // Push a dummy because it causes issues when the id is zero, so zero is not a valid id.
      lr.typeDefNodes.push(undefined as any);
    }
    const id = lr.typeDefNodes.length as Lowered.TypeDefId;
    lr.typeDefNodes.push(n);
    return [n, id];
  }

  export function addBlockScope<T extends Lowered.BlockScope>(
    lr: Lowered.Module,
    n: T
  ): [T, Lowered.BlockScopeId] {
    if (lr.blockScopeNodes.length === 0) {
      // Push a dummy because it causes issues when the id is zero, so zero is not a valid id.
      lr.blockScopeNodes.push(undefined as any);
    }
    const id = lr.blockScopeNodes.length as Lowered.BlockScopeId;
    lr.blockScopeNodes.push(n);
    return [n, id];
  }

  export function addExpr<T extends Lowered.Expression>(
    lr: Lowered.Module,
    n: T
  ): [T, Lowered.ExprId] {
    if (lr.exprNodes.length === 0) {
      // Push a dummy because it causes issues when the id is zero, so zero is not a valid id.
      lr.exprNodes.push(undefined as any);
    }
    const id = lr.exprNodes.length as Lowered.ExprId;
    lr.exprNodes.push(n);
    return [n, id];
  }

  export function addStatement<T extends Lowered.Statement>(
    lr: Lowered.Module,
    n: T
  ): [T, Lowered.StatementId] {
    if (lr.statementNodes.length === 0) {
      // Push a dummy because it causes issues when the id is zero, so zero is not a valid id.
      lr.statementNodes.push(undefined as any);
    }
    const id = lr.statementNodes.length as Lowered.StatementId;
    lr.statementNodes.push(n);
    return [n, id];
  }

  export function addFunction<T extends Lowered.FunctionSymbol>(
    lr: Lowered.Module,
    n: T
  ): [T, Lowered.FunctionId] {
    if (lr.functionNodes.length === 0) {
      // Push a dummy because it causes issues when the id is zero, so zero is not a valid id.
      lr.functionNodes.push(undefined as any);
    }
    const id = lr.functionNodes.length as Lowered.FunctionId;
    lr.functionNodes.push(n);
    return [n, id];
  }

  export type BinaryExpr = {
    variant: ENode.BinaryExpr;
    left: ExprId;
    operation: EBinaryOperation;
    right: ExprId;
    plainResultType: TypeDefId;
    type: TypeUseId;
  };

  export type UnaryExpr = {
    variant: ENode.UnaryExpr;
    expr: ExprId;
    operation: EUnaryOperation;
    type: TypeUseId;
  };

  export type ExprCallExpr = {
    variant: ENode.ExprCallExpr;
    expr: ExprId;
    arguments: ExprId[];
    type: TypeUseId;
  };

  export type CallableExpr = {
    variant: ENode.CallableExpr;
    thisExpr: ExprId;
    functionName: NameSet;
    functionType: TypeUseId;
    type: TypeUseId;
  };

  export type DereferenceExpr = {
    variant: ENode.DereferenceExpr;
    expr: ExprId;
    type: TypeUseId;
  };

  export type AddressOfExpr = {
    variant: ENode.AddressOfExpr;
    expr: ExprId;
    type: TypeUseId;
  };

  export type SizeofExpr = {
    variant: ENode.SizeofExpr;
    value: ExprId;
    type: TypeUseId;
  };

  export type AlignofExpr = {
    variant: ENode.AlignofExpr;
    value: ExprId;
    type: TypeUseId;
  };

  export type DatatypeAsValueExpr = {
    variant: ENode.DatatypeAsValueExpr;
    type: TypeUseId;
  };

  export type ExplicitCastExpr = {
    variant: ENode.ExplicitCastExpr;
    expr: ExprId;
    type: TypeUseId;
  };

  export type ValueToUnionCastExpr = {
    variant: ENode.ValueToUnionCastExpr;
    expr: ExprId;
    optimizeExprToNullptr: boolean;
    index: number;
    type: TypeUseId;
  };

  export type UnionToValueCastExpr = {
    variant: ENode.UnionToValueCastExpr;
    expr: ExprId;
    index: number;
    optimizeExprToNullptr: boolean;
    type: TypeUseId;
  };

  export type UnionToUnionCastExpr = {
    variant: ENode.UnionToUnionCastExpr;
    expr: ExprId;
    tagMapping: TagMapping;
    optimizeExprToNullptr: boolean;
    type: TypeUseId;
  };

  export type UnionTagCheckExpr = {
    variant: ENode.UnionTagCheckExpr;
    expr: ExprId;
    tags: number[];
    optimizeExprToNullptr: boolean;
    invertCheck: boolean;
    type: TypeUseId;
  };

  export type ExprMemberAccessExpr = {
    variant: ENode.MemberAccessExpr;
    expr: ExprId;
    memberName: string;
    requiresDeref: boolean;
    type: TypeUseId;
  };

  export type LiteralExpr = {
    variant: ENode.LiteralExpr;
    literal: LiteralValue;
    type: TypeUseId;
  };

  export type SymbolValueExpr = {
    variant: ENode.SymbolValueExpr;
    name: NameSet;
    type: TypeUseId;
  };

  export type PostIncrExpr = {
    variant: ENode.PostIncrExpr;
    expr: ExprId;
    operation: EIncrOperation;
    type: TypeUseId;
  };

  export type ExprAssignmentExpr = {
    variant: ENode.ExprAssignmentExpr;
    value: ExprId;
    target: ExprId;
    assignRefTarget: boolean;
    type: TypeUseId;
  };

  export type PreIncrExpr = {
    variant: ENode.PreIncrExpr;
    expr: ExprId;
    operation: EIncrOperation;
    type: TypeUseId;
  };

  export type StructInstantiationExpr = {
    variant: ENode.StructInstantiationExpr;
    type: TypeUseId;
    memberAssigns: {
      name: string;
      value: ExprId;
    }[];
  };

  export type ArrayLiteralExpr = {
    variant: ENode.ArrayLiteralExpr;
    values: ExprId[];
    type: TypeUseId;
  };

  export type ArraySubscriptExpr = {
    variant: ENode.ArraySubscriptExpr;
    expr: ExprId;
    index: ExprId;
    type: TypeUseId;
  };

  export type ArraySliceExpr = {
    variant: ENode.ArraySliceExpr;
    expr: ExprId;
    start: ExprId;
    end: ExprId;
    type: TypeUseId;
  };

  export type StringConstructExpr = {
    variant: ENode.StringConstructExpr;
    value: {
      data: ExprId;
      length: ExprId;
    };
    type: TypeUseId;
  };

  export type BlockScopeExpr = {
    variant: ENode.BlockScopeExpr;
    block: BlockScopeId;
    type: TypeUseId;
    sourceloc: SourceLoc;
  };

  export type Expression =
    | ExprCallExpr
    | BinaryExpr
    | UnaryExpr
    | CallableExpr
    | StructInstantiationExpr
    | ExprAssignmentExpr
    | DereferenceExpr
    | AddressOfExpr
    | SizeofExpr
    | AlignofExpr
    | DatatypeAsValueExpr
    | ExplicitCastExpr
    | ValueToUnionCastExpr
    | UnionToValueCastExpr
    | UnionToUnionCastExpr
    | UnionTagCheckExpr
    | ExprMemberAccessExpr
    | LiteralExpr
    | PreIncrExpr
    | PostIncrExpr
    | ArrayLiteralExpr
    | ArraySubscriptExpr
    | ArraySliceExpr
    | BlockScopeExpr
    | StringConstructExpr
    | SymbolValueExpr;

  export type BlockScope = {
    statements: StatementId[];
    definesVariables: boolean;
    emittedExpr: ExprId | null;
  };

  export type Statement =
    | InlineCStatement
    | ReturnStatement
    | VariableStatement
    | IfStatement
    | WhileStatement
    | ExprStatement;

  export type InlineCStatement = {
    variant: ENode.InlineCStatement;
    value: string;
    sourceloc: SourceLoc;
  };

  export type VariableStatement = {
    variant: ENode.VariableStatement;
    name: NameSet;
    type: TypeUseId;
    variableContext: EVariableContext;
    value: ExprId | null;
    sourceloc: SourceLoc;
  };

  export type ReturnStatement = {
    variant: ENode.ReturnStatement;
    expr: ExprId | null;
    sourceloc: SourceLoc;
  };

  export type IfStatement = {
    variant: ENode.IfStatement;
    condition: ExprId;
    then: BlockScopeId;
    elseIfs: {
      condition: ExprId;
      then: BlockScopeId;
    }[];
    else?: BlockScopeId;
    sourceloc: SourceLoc;
  };

  export type WhileStatement = {
    variant: ENode.WhileStatement;
    condition: ExprId;
    then: BlockScopeId;
    sourceloc: SourceLoc;
  };

  export type ExprStatement = {
    variant: ENode.ExprStatement;
    expr: ExprId;
    sourceloc: SourceLoc;
  };

  export type FunctionSymbol = {
    variant: ENode.FunctionSymbol;
    name: NameSet;
    type: TypeDefId;
    parameterNames: string[];
    externLanguage: EExternLanguage;
    isLibraryLocal: boolean;
    noreturn: boolean;
    scope: BlockScopeId | null;
    sourceloc: SourceLoc;
  };

  export type TypeUse = {
    variant: ENode.TypeUse;
    mutability: EDatatypeMutability;
    type: TypeDefId;
    pointer: boolean;
    name: NameSet;
    sourceloc: SourceLoc;
  };

  export type TypeDef =
    | StructDatatypeDef
    | CallableDatatypeDef
    | PrimitiveDatatypeDef
    | FunctionDatatypeDef
    | PointerDatatypeDef
    | ArrayDatatypeDef
    | SliceDatatypeDef
    | UntaggedUnionDatatypeDef
    | TaggedUnionDatatypeDef
    | EnumDatatypeDef;

  export type PointerDatatypeDef = {
    variant: ENode.PointerDatatype;
    name: NameSet;
    referee: TypeUseId;
  };

  export type CallableDatatypeDef = {
    variant: ENode.CallableDatatype;
    name: NameSet;
    thisExprType: TypeUseId | null;
    functionType: TypeDefId;
  };

  export type PrimitiveDatatypeDef = {
    variant: ENode.PrimitiveDatatype;
    name: NameSet;
    primitive: EPrimitive;
  };

  export type StructDatatypeDef = {
    variant: ENode.StructDatatype;
    noemit: boolean;
    name: NameSet;
    members: {
      name: string;
      type: TypeUseId;
    }[];
  };

  export type FunctionDatatypeDef = {
    variant: ENode.FunctionDatatype;
    name: NameSet;
    parameters: TypeUseId[];
    returnType: TypeUseId;
    autodest: boolean;
    vararg: boolean;
  };

  export type ArrayDatatypeDef = {
    variant: ENode.ArrayDatatype;
    datatype: TypeUseId;
    name: NameSet;
    length: bigint;
  };

  export type SliceDatatypeDef = {
    variant: ENode.SliceDatatype;
    datatype: TypeUseId;
    name: NameSet;
  };

  export type UntaggedUnionDatatypeDef = {
    variant: ENode.UntaggedUnionDatatype;
    members: TypeUseId[];
    optimizeAsRawPointer: TypeUseId | null;
    name: NameSet;
  };

  export type TaggedUnionDatatypeDef = {
    variant: ENode.TaggedUnionDatatype;
    members: {
      tag: string;
      type: TypeUseId;
    }[];
    optimizeAsRawPointer: TypeUseId | null;
    name: NameSet;
  };

  export type EnumDatatypeDef = {
    variant: ENode.EnumDatatype;
    values: {
      originalName: string;
      loweredName: NameSet;
      value: ExprId;
    }[];
    type: TypeUseId;
    noemit: boolean;
    name: NameSet;
  };
}

const storeInTempVarAndGet = (
  lr: Lowered.Module,
  type: Lowered.TypeUseId,
  value: Lowered.ExprId,
  sourceloc: SourceLoc,
  flattened: Lowered.StatementId[],
  varname?: string
): [Lowered.Expression, Lowered.ExprId] => {
  if (varname === undefined) {
    varname = makeTempName();
  }
  flattened.push(
    Lowered.addStatement(lr, {
      variant: Lowered.ENode.VariableStatement,
      name: {
        prettyName: varname,
        mangledName: varname,
        wasMangled: false,
      },
      type: type,
      variableContext: EVariableContext.FunctionLocal,
      value: value,
      sourceloc: sourceloc,
    })[1]
  );
  return Lowered.addExpr(lr, {
    variant: Lowered.ENode.SymbolValueExpr,
    name: {
      prettyName: varname,
      mangledName: varname,
      wasMangled: false,
    },
    type: type,
  });
};

function makeIntrinsicCall(
  lr: Lowered.Module,
  functionName: string,
  callArguments: Lowered.ExprId[],
  returnType: Lowered.TypeUseId
) {
  const [functype, functypeId] = Lowered.addTypeDef(lr, {
    variant: Lowered.ENode.FunctionDatatype,
    parameters: callArguments.map((a) => lr.exprNodes.get(a).type),
    returnType: returnType,
    name: {
      prettyName: functionName,
      mangledName: functionName,
      wasMangled: false,
    },
    autodest: false,
    vararg: false,
  });
  return Lowered.addExpr(lr, {
    variant: Lowered.ENode.ExprCallExpr,
    arguments: callArguments,
    expr: Lowered.addExpr(lr, {
      variant: Lowered.ENode.SymbolValueExpr,
      name: functype.name,
      type: Lowered.addTypeUse(lr, {
        variant: Lowered.ENode.TypeUse,
        mutability: EDatatypeMutability.Default,
        name: functype.name,
        pointer: false,
        sourceloc: null,
        type: functypeId,
      })[1],
    })[1],
    takesReturnArena: false,
    type: returnType,
  });
}

type InstanceInfo = {
  returnedInstanceIds: Set<Semantic.InstanceId>;
};

export function lowerExpr(
  lr: Lowered.Module,
  exprId: Semantic.ExprId,
  flattened: Lowered.StatementId[],
  instanceInfo: InstanceInfo
): [Lowered.Expression, Lowered.ExprId] {
  const expr = lr.sr.exprNodes.get(exprId);

  switch (expr.variant) {
    case Semantic.ENode.ExprCallExpr: {
      const [calledExpr, calledExprId] = lowerExpr(lr, expr.calledExpr, flattened, instanceInfo);
      const calledExprType = lr.typeUseNodes.get(calledExpr.type);
      const calledExprTypeDef = lr.typeDefNodes.get(calledExprType.type);
      assert(
        calledExprTypeDef.variant === Lowered.ENode.FunctionDatatype ||
          calledExprTypeDef.variant === Lowered.ENode.CallableDatatype
      );

      const arenaArgs: Lowered.ExprId[] = [];
      if (expr.producesAllocation) {
        if (expr.inArena) {
          arenaArgs.push(lowerExpr(lr, expr.inArena, flattened, instanceInfo)[1]);
        } else {
          const arenaName = expr.instanceIds.some((i) => instanceInfo.returnedInstanceIds.has(i))
            ? "__hz_return_arena"
            : "__hz_local_arena";
          arenaArgs.push(
            Lowered.addExpr(lr, {
              variant: Lowered.ENode.SymbolValueExpr,
              name: {
                mangledName: arenaName,
                prettyName: arenaName,
                wasMangled: false,
              },
              type: makeLowerTypeUse(lr, makeVoidPointerType(lr), false)[1],
            })[1]
          );
        }
      }

      if (calledExprTypeDef.variant === Lowered.ENode.CallableDatatype) {
        let thisExprId: Lowered.ExprId;
        if (calledExpr.variant === Lowered.ENode.CallableExpr) {
          thisExprId = calledExpr.thisExpr;
        } else if (calledExpr.variant === Lowered.ENode.SymbolValueExpr) {
          thisExprId = calledExprId;
        } else {
          throw new InternalError("Not implemented");
        }

        if (calledExpr.variant === Lowered.ENode.CallableExpr) {
          // A method or lambda is immediately called
          const type = lowerTypeUse(lr, expr.type);
          const [callExpr, callExprId] = Lowered.addExpr<Lowered.ExprCallExpr>(lr, {
            variant: Lowered.ENode.ExprCallExpr,
            expr: Lowered.addExpr(lr, {
              variant: Lowered.ENode.SymbolValueExpr,
              name: calledExpr.functionName,
              functionType: calledExpr.functionType,
              type: calledExpr.type,
            })[1],
            arguments: [
              ...arenaArgs,
              calledExpr.thisExpr,
              ...expr.arguments.map((a) => lowerExpr(lr, a, flattened, instanceInfo)[1]),
            ],
            type: type,
          });
          return [callExpr, callExprId];
        } else {
          // The callable is from a variable with unknown origin
          const type = lowerTypeUse(lr, expr.type);
          const [callExpr, callExprId] = Lowered.addExpr<Lowered.ExprCallExpr>(lr, {
            variant: Lowered.ENode.ExprCallExpr,
            expr: Lowered.addExpr(lr, {
              variant: Lowered.ENode.MemberAccessExpr,
              memberName: "fn",
              requiresDeref: false,
              type: calledExpr.type,
              expr: calledExprId,
            })[1],
            arguments: [
              ...arenaArgs,
              Lowered.addExpr(lr, {
                variant: Lowered.ENode.MemberAccessExpr,
                expr: calledExprId,
                requiresDeref: false,
                memberName: "thisPtr",
                type: lr.exprNodes.get(thisExprId).type,
              })[1],
              ...expr.arguments.map((a) => lowerExpr(lr, a, flattened, instanceInfo)[1]),
            ],
            type: type,
          });
          return [callExpr, callExprId];
        }
      } else {
        const [exprCall, exprCallId] = Lowered.addExpr<Lowered.ExprCallExpr>(lr, {
          variant: Lowered.ENode.ExprCallExpr,
          expr: calledExprId,
          arguments: [
            ...arenaArgs,
            ...expr.arguments.map((a) => lowerExpr(lr, a, flattened, instanceInfo)[1]),
          ],
          type: lowerTypeUse(lr, expr.type),
        });
        return [exprCall, exprCallId];
      }
    }

    case Semantic.ENode.BinaryExpr: {
      const typeId = lowerTypeUse(lr, expr.type);
      const type = lr.typeUseNodes.get(typeId);
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.BinaryExpr,
        left: lowerExpr(lr, expr.left, flattened, instanceInfo)[1],
        right: lowerExpr(lr, expr.right, flattened, instanceInfo)[1],
        operation: expr.operation,
        type: typeId,
        plainResultType: type.type,
      });
    }

    case Semantic.ENode.UnaryExpr: {
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.UnaryExpr,
        expr: lowerExpr(lr, expr.expr, flattened, instanceInfo)[1],
        operation: expr.operation,
        type: lowerTypeUse(lr, expr.type),
      });
    }

    case Semantic.ENode.SymbolValueExpr: {
      const symbol = lr.sr.symbolNodes.get(expr.symbol);
      assert(
        symbol.variant === Semantic.ENode.VariableSymbol ||
          symbol.variant === Semantic.ENode.GlobalVariableDefinitionSymbol ||
          symbol.variant === Semantic.ENode.FunctionSymbol
      );
      if (symbol.variant === Semantic.ENode.VariableSymbol) {
        assert(symbol.type);
        return Lowered.addExpr(lr, {
          variant: Lowered.ENode.SymbolValueExpr,
          name: {
            prettyName: symbol.name,
            mangledName: symbol.name,
            wasMangled: false,
          },
          type: lowerTypeUse(lr, symbol.type),
        });
      } else if (symbol.variant === Semantic.ENode.GlobalVariableDefinitionSymbol) {
        const variableSymbol = lr.sr.symbolNodes.get(symbol.variableSymbol);
        assert(variableSymbol.variant === Semantic.ENode.VariableSymbol);
        assert(variableSymbol.type);
        return Lowered.addExpr(lr, {
          variant: Lowered.ENode.SymbolValueExpr,
          name: {
            prettyName: symbol.name,
            mangledName: symbol.name,
            wasMangled: false,
          },
          type: lowerTypeUse(lr, variableSymbol.type),
        });
      } else {
        const a = lr.sr.symbolNodes.get(expr.symbol);
        lowerSymbol(lr, expr.symbol);
        return Lowered.addExpr(lr, {
          variant: Lowered.ENode.SymbolValueExpr,
          name: Semantic.makeNameSetSymbol(lr.sr, expr.symbol),
          type: makeLowerTypeUse(lr, lowerTypeDef(lr, symbol.type), false)[1],
        });
      }
    }

    case Semantic.ENode.AddressOfExpr: {
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.AddressOfExpr,
        expr: lowerExpr(lr, expr.expr, flattened, instanceInfo)[1],
        type: lowerTypeUse(lr, expr.type),
      });
    }

    case Semantic.ENode.DereferenceExpr: {
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.DereferenceExpr,
        expr: lowerExpr(lr, expr.expr, flattened, instanceInfo)[1],
        type: lowerTypeUse(lr, expr.type),
      });
    }

    case Semantic.ENode.ExplicitCastExpr: {
      const [loweredExpr, loweredExprId] = lowerExpr(lr, expr.expr, flattened, instanceInfo);
      const targetTypeId = lowerTypeUse(lr, expr.type);
      const exprType = lr.typeUseNodes.get(loweredExpr.type);
      const exprTypeDef = lr.typeDefNodes.get(exprType.type);
      const targetType = lr.typeUseNodes.get(targetTypeId);
      const targetTypeDef = lr.typeDefNodes.get(targetType.type);

      if (loweredExpr.type === targetTypeId) {
        return [lr.exprNodes.get(loweredExprId), loweredExprId];
      }

      // Do not cast if the cast doesn't actually do anything in the generated C, because
      // doing it would cause the left side of assignments to be casted to the same time
      // (because multiple haze types map to the same C type), and the C compiler rejects it.
      if (targetTypeDef === exprTypeDef) {
        const fromIsConst = exprType.mutability === EDatatypeMutability.Const;
        const toIsConst = targetType.mutability === EDatatypeMutability.Const;
        if (fromIsConst === toIsConst) {
          return [lr.exprNodes.get(loweredExprId), loweredExprId];
        }
      }

      if (
        exprTypeDef.variant === Lowered.ENode.StructDatatype &&
        targetTypeDef.variant === Lowered.ENode.PointerDatatype &&
        loweredExpr.type === targetTypeDef.referee
      ) {
        return Lowered.addExpr(lr, {
          variant: Lowered.ENode.AddressOfExpr,
          expr: loweredExprId,
          type: targetTypeId,
        });
      }

      if (
        exprTypeDef.variant === Lowered.ENode.PointerDatatype &&
        targetTypeDef.variant === Lowered.ENode.StructDatatype &&
        exprTypeDef.referee === targetTypeId
      ) {
        return Lowered.addExpr(lr, {
          variant: Lowered.ENode.DereferenceExpr,
          expr: loweredExprId,
          type: targetTypeId,
        });
      }

      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.ExplicitCastExpr,
        expr: loweredExprId,
        type: targetTypeId,
      });
    }

    case Semantic.ENode.MemberAccessExpr: {
      const accessedExpr = lr.sr.exprNodes.get(expr.expr);
      const accessedExprTypeUse = lr.sr.typeUseNodes.get(accessedExpr.type);
      const accessedExprTypeDef = lr.sr.typeDefNodes.get(accessedExprTypeUse.type);

      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.MemberAccessExpr,
        expr: lowerExpr(lr, expr.expr, flattened, instanceInfo)[1],
        requiresDeref: !(
          accessedExprTypeDef.variant === Semantic.ENode.StructDatatype &&
          accessedExprTypeUse.inline
        ),
        memberName: expr.memberName,
        type: lowerTypeUse(lr, expr.type),
      });
    }

    case Semantic.ENode.LiteralExpr: {
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.LiteralExpr,
        literal: expr.literal,
        type: lowerTypeUse(lr, expr.type),
      });
    }

    case Semantic.ENode.StructInstantiationExpr: {
      const structType = lowerTypeUse(lr, expr.type);
      const semanticTypeUse = lr.sr.typeUseNodes.get(expr.type);

      const structTypeUse = lr.typeUseNodes.get(structType);
      if (structTypeUse.pointer) {
        const [structExpr, structExprId] = Lowered.addExpr(lr, {
          variant: Lowered.ENode.StructInstantiationExpr,
          type: makeLowerTypeUse(lr, lowerTypeDef(lr, semanticTypeUse.type), true)[1],
          memberAssigns: expr.assign.map((a) => ({
            name: a.name,
            value: lowerExpr(lr, a.value, flattened, instanceInfo)[1],
          })),
        });

        let returns = false;
        if (expr.inFunction) {
          const funcsym = lr.sr.symbolNodes.get(expr.inFunction);
          assert(funcsym.variant === Semantic.ENode.FunctionSymbol);
          if (expr.instanceIds.some((id) => funcsym.returnsInstanceIds.has(id))) {
            returns = true;
          }
        }

        let arenaId: Lowered.ExprId;
        if (expr.inArena) {
          arenaId = lowerExpr(lr, expr.inArena, flattened, instanceInfo)[1];
        } else {
          const name = returns ? "__hz_return_arena" : "__hz_local_arena";
          arenaId = Lowered.addExpr(lr, {
            variant: Lowered.ENode.SymbolValueExpr,
            name: {
              mangledName: name,
              prettyName: name,
              wasMangled: false,
            },
            type: makeLowerTypeUse(lr, makeVoidPointerType(lr), false)[1],
          })[1];
        }

        const structTypeExprId = Lowered.addExpr(lr, {
          variant: Lowered.ENode.DatatypeAsValueExpr,
          type: makeLowerTypeUse(lr, structTypeUse.type, false)[1],
        })[1];

        const structPtrTypeExprId = Lowered.addExpr(lr, {
          variant: Lowered.ENode.DatatypeAsValueExpr,
          type: structType,
        })[1];

        const [result, resultId] = makeIntrinsicCall(
          lr,
          "HZSTD_ALLOC_STRUCT",
          [arenaId, structTypeExprId, structPtrTypeExprId, structExprId],
          structType
        );

        // const [result, resultId] = Lowered.addExpr(lr, {
        //   variant: Lowered.ENode.ExplicitCastExpr,
        //   expr: makeIntrinsicCall(
        //     lr,
        //     "hzstd_arena_allocate",
        //     [
        //       Lowered.addExpr(lr, {
        //         variant: Lowered.ENode.MemberAccessExpr,
        //         memberName: "arenaImpl",
        //         expr: arenaId,
        //         requiresDeref: true,
        //         type: lowerTypeUse(
        //           lr,
        //           makeTypeUse(
        //             lr.sr,
        //             lr.sr.e.arenaTypeDef(),
        //             EDatatypeMutability.Default,
        //             false,
        //             null
        //           )[1]
        //         ),
        //       })[1],
        //       sizeof[1],
        //       alignof[1],
        //     ],
        //     makeLowerTypeUse(lr, makeVoidPointerType(lr), true)[1]
        //   )[1],
        //   type: structType,
        // });

        // const statements: Lowered.StatementId[] = [];
        // const [structVar, structVarId] = storeInTempVarAndGet(
        //   lr,
        //   structType,
        //   resultId,
        //   expr.sourceloc,
        //   statements
        // );

        // statements.push(
        //   Lowered.addStatement(lr, {
        //     variant: Lowered.ENode.ExprStatement,
        //     expr: Lowered.addExpr(lr, {
        //       variant: Lowered.ENode.ExprAssignmentExpr,
        //       target: structVarId,
        //       type: structType,
        //       assignRefTarget: true,
        //       value: structExprId,
        //     })[1],
        //     sourceloc: expr.sourceloc,
        //   })[1]
        // );

        // const [blockScope, blockScopeId] = Lowered.addBlockScope<Lowered.BlockScope>(lr, {
        //   statements: statements,
        //   definesVariables: true,
        //   emittedExpr: structVarId,
        // });

        return [result, resultId];
        // return Lowered.addExpr(lr, {
        //   variant: Lowered.ENode.BlockScopeExpr,
        //   block: blockScopeId,
        //   sourceloc: expr.sourceloc,
        //   type: structType,
        // });
      } else {
        return Lowered.addExpr(lr, {
          variant: Lowered.ENode.StructInstantiationExpr,
          type: structType,
          memberAssigns: expr.assign.map((a) => ({
            name: a.name,
            value: lowerExpr(lr, a.value, flattened, instanceInfo)[1],
          })),
        });
      }
    }

    case Semantic.ENode.PostIncrExpr: {
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.PostIncrExpr,
        expr: lowerExpr(lr, expr.expr, flattened, instanceInfo)[1],
        operation: expr.operation,
        type: lowerTypeUse(lr, expr.type),
      });
    }

    case Semantic.ENode.PreIncrExpr: {
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.PreIncrExpr,
        expr: lowerExpr(lr, expr.expr, flattened, instanceInfo)[1],
        operation: expr.operation,
        type: lowerTypeUse(lr, expr.type),
      });
    }

    case Semantic.ENode.ArrayLiteralExpr: {
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.ArrayLiteralExpr,
        values: expr.values.map((v) => lowerExpr(lr, v, flattened, instanceInfo)[1]),
        type: lowerTypeUse(lr, expr.type),
      });
    }

    case Semantic.ENode.ArraySubscriptExpr: {
      assert(expr.indices.length === 1);
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.ArraySubscriptExpr,
        expr: lowerExpr(lr, expr.expr, flattened, instanceInfo)[1],
        index: lowerExpr(lr, expr.indices[0], flattened, instanceInfo)[1],
        type: lowerTypeUse(lr, expr.type),
      });
    }

    case Semantic.ENode.ArraySliceExpr: {
      assert(expr.indices.length === 1);
      const arrayId = lowerExpr(lr, expr.expr, flattened, instanceInfo)[1];
      const semanticArray = lr.sr.exprNodes.get(expr.expr);
      const arrayType = lr.sr.typeDefNodes.get(lr.sr.typeUseNodes.get(semanticArray.type).type);
      assert(arrayType.variant === Semantic.ENode.FixedArrayDatatype);

      const startIndex = expr.indices[0].start
        ? lowerExpr(lr, expr.indices[0].start, flattened, instanceInfo)[1]
        : Lowered.addExpr(lr, {
            variant: Lowered.ENode.LiteralExpr,
            literal: {
              type: EPrimitive.usize,
              unit: null,
              value: 0n,
            },
            type: lowerTypeUse(
              lr,
              makePrimitiveAvailable(
                lr.sr,
                EPrimitive.usize,
                EDatatypeMutability.Const,
                expr.sourceloc
              )
            ),
          })[1];
      const endIndex = expr.indices[0].end
        ? lowerExpr(lr, expr.indices[0].end, flattened, instanceInfo)[1]
        : Lowered.addExpr(lr, {
            variant: Lowered.ENode.LiteralExpr,
            literal: {
              type: EPrimitive.usize,
              unit: null,
              value: BigInt(arrayType.length),
            },
            type: lowerTypeUse(
              lr,
              makePrimitiveAvailable(
                lr.sr,
                EPrimitive.usize,
                EDatatypeMutability.Const,
                expr.sourceloc
              )
            ),
          })[1];

      let sliceExprId = arrayId;
      const array = lr.exprNodes.get(arrayId);
      if (array.variant === Lowered.ENode.ArrayLiteralExpr) {
        sliceExprId = storeInTempVarAndGet(lr, array.type, arrayId, expr.sourceloc, flattened)[1];
      }

      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.ArraySliceExpr,
        expr: sliceExprId,
        start: startIndex,
        end: endIndex,
        type: lowerTypeUse(lr, expr.type),
      });
    }

    case Semantic.ENode.CallableExpr: {
      lowerSymbol(lr, expr.functionSymbol);
      const thisExpr = lr.sr.exprNodes.get(expr.thisExpr);
      const thisExprTypeUse = lr.sr.typeUseNodes.get(thisExpr.type);
      const thisExprType = lr.sr.typeDefNodes.get(thisExprTypeUse.type);

      let loweredThisExpression = lowerExpr(lr, expr.thisExpr, flattened, instanceInfo)[1];
      assert(thisExprType.variant === Semantic.ENode.StructDatatype);
      const structPointerType = lowerTypeUse(lr, thisExpr.type);
      let tempId = loweredThisExpression;
      if (thisExpr.isTemporary) {
        tempId = storeInTempVarAndGet(
          lr,
          lowerTypeUse(lr, thisExpr.type),
          loweredThisExpression,
          expr.sourceloc,
          flattened
        )[1];
      }

      if (thisExprTypeUse.inline) {
        loweredThisExpression = Lowered.addExpr(lr, {
          variant: Lowered.ENode.AddressOfExpr,
          expr: tempId,
          type: structPointerType,
        })[1];
      } else {
        loweredThisExpression = tempId;
      }

      const functionSymbol = lr.sr.symbolNodes.get(expr.functionSymbol);
      assert(functionSymbol.variant === Semantic.ENode.FunctionSymbol);
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.CallableExpr,
        functionName: Semantic.makeNameSetSymbol(lr.sr, expr.functionSymbol),
        thisExpr: loweredThisExpression,
        type: lowerTypeUse(lr, expr.type),
        functionType: makeLowerTypeUse(lr, lowerTypeDef(lr, functionSymbol.type), false)[1],
      });
    }

    case Semantic.ENode.ExprAssignmentExpr: {
      const loweredTarget = lowerExpr(lr, expr.target, flattened, instanceInfo)[1];
      const loweredValue = lowerExpr(lr, expr.value, flattened, instanceInfo)[1];
      if (
        expr.operation === EAssignmentOperation.Rebind ||
        expr.operation === EAssignmentOperation.Assign
      ) {
        return Lowered.addExpr(lr, {
          variant: Lowered.ENode.ExprAssignmentExpr,
          target: loweredTarget,
          value: loweredValue,
          assignRefTarget: expr.operation === EAssignmentOperation.Assign,
          type: lowerTypeUse(lr, expr.type),
        });
      } else if (expr.operation === EAssignmentOperation.Add) {
        const typeId = lowerTypeUse(lr, expr.type);
        const type = lr.typeUseNodes.get(typeId);
        return Lowered.addExpr(lr, {
          variant: Lowered.ENode.ExprAssignmentExpr,
          target: loweredTarget,
          value: Lowered.addExpr(lr, {
            variant: Lowered.ENode.BinaryExpr,
            left: loweredTarget,
            right: loweredValue,
            operation: EBinaryOperation.Add,
            type: typeId,
            plainResultType: type.type,
          })[1],
          assignRefTarget: false,
          type: lowerTypeUse(lr, expr.type),
        });
      } else if (expr.operation === EAssignmentOperation.Subtract) {
        const typeId = lowerTypeUse(lr, expr.type);
        const type = lr.typeUseNodes.get(typeId);
        return Lowered.addExpr(lr, {
          variant: Lowered.ENode.ExprAssignmentExpr,
          target: loweredTarget,
          value: Lowered.addExpr(lr, {
            variant: Lowered.ENode.BinaryExpr,
            left: loweredTarget,
            right: loweredValue,
            operation: EBinaryOperation.Subtract,
            type: typeId,
            plainResultType: type.type,
          })[1],
          assignRefTarget: false,
          type: lowerTypeUse(lr, expr.type),
        });
      } else if (expr.operation === EAssignmentOperation.Multiply) {
        const typeId = lowerTypeUse(lr, expr.type);
        const type = lr.typeUseNodes.get(typeId);
        return Lowered.addExpr(lr, {
          variant: Lowered.ENode.ExprAssignmentExpr,
          target: loweredTarget,
          value: Lowered.addExpr(lr, {
            variant: Lowered.ENode.BinaryExpr,
            left: loweredTarget,
            right: loweredValue,
            operation: EBinaryOperation.Multiply,
            type: typeId,
            plainResultType: type.type,
          })[1],
          assignRefTarget: false,
          type: lowerTypeUse(lr, expr.type),
        });
      } else if (expr.operation === EAssignmentOperation.Divide) {
        const typeId = lowerTypeUse(lr, expr.type);
        const type = lr.typeUseNodes.get(typeId);
        return Lowered.addExpr(lr, {
          variant: Lowered.ENode.ExprAssignmentExpr,
          target: loweredTarget,
          value: Lowered.addExpr(lr, {
            variant: Lowered.ENode.BinaryExpr,
            left: loweredTarget,
            right: loweredValue,
            operation: EBinaryOperation.Divide,
            type: typeId,
            plainResultType: type.type,
          })[1],
          assignRefTarget: false,
          type: lowerTypeUse(lr, expr.type),
        });
      } else if (expr.operation === EAssignmentOperation.Modulo) {
        const typeId = lowerTypeUse(lr, expr.type);
        const type = lr.typeUseNodes.get(typeId);
        return Lowered.addExpr(lr, {
          variant: Lowered.ENode.ExprAssignmentExpr,
          target: loweredTarget,
          value: Lowered.addExpr(lr, {
            variant: Lowered.ENode.BinaryExpr,
            left: loweredTarget,
            right: loweredValue,
            operation: EBinaryOperation.Modulo,
            type: typeId,
            plainResultType: type.type,
          })[1],
          assignRefTarget: false,
          type: lowerTypeUse(lr, expr.type),
        });
      } else {
        assert(false);
      }
    }

    case Semantic.ENode.SizeofExpr: {
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.SizeofExpr,
        value: lowerExpr(lr, expr.valueExpr, flattened, instanceInfo)[1],
        type: lowerTypeUse(lr, expr.type),
      });
    }

    case Semantic.ENode.AlignofExpr: {
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.AlignofExpr,
        value: lowerExpr(lr, expr.valueExpr, flattened, instanceInfo)[1],
        type: lowerTypeUse(lr, expr.type),
      });
    }

    case Semantic.ENode.BlockScopeExpr: {
      return Lowered.addExpr<Lowered.BlockScopeExpr>(lr, {
        variant: Lowered.ENode.BlockScopeExpr,
        block: lowerBlockScope(lr, expr.block, false, instanceInfo),
        type: lowerTypeUse(lr, expr.type),
        sourceloc: expr.sourceloc,
      });
    }

    case Semantic.ENode.StringConstructExpr: {
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.StringConstructExpr,
        type: lowerTypeUse(lr, expr.type),
        value: {
          data: lowerExpr(lr, expr.value.data, flattened, instanceInfo)[1],
          length: lowerExpr(lr, expr.value.length, flattened, instanceInfo)[1],
        },
      });
    }

    case Semantic.ENode.DatatypeAsValueExpr: {
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.DatatypeAsValueExpr,
        type: lowerTypeUse(lr, expr.type),
      });
    }

    case Semantic.ENode.ValueToUnionCastExpr: {
      const exprType = lr.sr.typeDefNodes.get(lr.sr.typeUseNodes.get(expr.type).type);
      assert(
        exprType.variant === Semantic.ENode.UntaggedUnionDatatype ||
          exprType.variant === Semantic.ENode.TaggedUnionDatatype
      );

      const loweredUnionId = lowerTypeUse(lr, expr.type);
      const loweredUnion = lr.typeDefNodes.get(lr.typeUseNodes.get(loweredUnionId).type);
      assert(
        loweredUnion.variant === Lowered.ENode.UntaggedUnionDatatype ||
          loweredUnion.variant === Lowered.ENode.TaggedUnionDatatype
      );

      let optimizeExprToNullptr = false;
      if (loweredUnion.optimizeAsRawPointer) {
        const exprTypeDef = lr.sr.typeDefNodes.get(
          lr.sr.typeUseNodes.get(lr.sr.exprNodes.get(expr.expr).type).type
        );
        if (
          exprTypeDef.variant === Semantic.ENode.PrimitiveDatatype &&
          exprTypeDef.primitive === EPrimitive.none
        ) {
          optimizeExprToNullptr = true;
        }
      }

      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.ValueToUnionCastExpr,
        expr: lowerExpr(lr, expr.expr, flattened, instanceInfo)[1],
        optimizeExprToNullptr: optimizeExprToNullptr,
        index: expr.index,
        type: loweredUnionId,
      });
    }

    case Semantic.ENode.UnionToValueCastExpr: {
      const sourceExpr = lr.sr.exprNodes.get(expr.expr);
      const sourceType = lr.sr.typeDefNodes.get(lr.sr.typeUseNodes.get(sourceExpr.type).type);
      assert(
        sourceType.variant === Semantic.ENode.UntaggedUnionDatatype ||
          sourceType.variant === Semantic.ENode.TaggedUnionDatatype
      );

      const loweredUnionId = lowerTypeUse(lr, sourceExpr.type);
      const loweredUnion = lr.typeDefNodes.get(lr.typeUseNodes.get(loweredUnionId).type);
      assert(
        loweredUnion.variant === Lowered.ENode.UntaggedUnionDatatype ||
          loweredUnion.variant === Lowered.ENode.TaggedUnionDatatype
      );

      let optimizeExprToNullptr = false;
      if (loweredUnion.optimizeAsRawPointer) {
        const exprTypeDef = lr.sr.typeDefNodes.get(lr.sr.typeUseNodes.get(sourceExpr.type).type);
        if (
          exprTypeDef.variant === Semantic.ENode.PrimitiveDatatype &&
          exprTypeDef.primitive === EPrimitive.none
        ) {
          optimizeExprToNullptr = true;
        }
      }

      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.UnionToValueCastExpr,
        expr: lowerExpr(lr, expr.expr, flattened, instanceInfo)[1],
        optimizeExprToNullptr: optimizeExprToNullptr,
        index: expr.tag,
        type: lowerTypeUse(lr, expr.type),
      });
    }

    case Semantic.ENode.UnionToUnionCastExpr: {
      const sourceExpr = lr.sr.exprNodes.get(expr.expr);
      const sourceType = lr.sr.typeDefNodes.get(lr.sr.typeUseNodes.get(sourceExpr.type).type);
      assert(sourceType.variant === Semantic.ENode.UntaggedUnionDatatype);

      const loweredSourceUnionId = lowerTypeUse(lr, sourceExpr.type);
      const loweredSourceUnion = lr.typeDefNodes.get(
        lr.typeUseNodes.get(loweredSourceUnionId).type
      );
      assert(loweredSourceUnion.variant === Lowered.ENode.UntaggedUnionDatatype);

      const loweredTargetUnionId = lowerTypeUse(lr, expr.type);
      const loweredTargetUnion = lr.typeDefNodes.get(
        lr.typeUseNodes.get(loweredTargetUnionId).type
      );
      assert(loweredTargetUnion.variant === Lowered.ENode.UntaggedUnionDatatype);

      let optimizeExprToNullptr = false;
      if (loweredSourceUnion.optimizeAsRawPointer || loweredTargetUnion.optimizeAsRawPointer) {
        assert(
          false,
          "Union to Union conversion if one is nullptr optimized is not implemented yet"
        );
      }

      const mappingUniqueKey = loweredSourceUnionId + "_to_" + loweredTargetUnionId;

      let mapping = lr.loweredUnionMappings.find((m) => {
        return m.from === loweredSourceUnionId && m.to === loweredTargetUnionId;
      });

      if (!mapping) {
        mapping = {
          from: loweredSourceUnionId,
          to: loweredTargetUnionId,
          mapping: new Map(),
        };
        lr.loweredUnionMappings.push(mapping);

        // Fill new entry
        loweredSourceUnion.members.forEach((source, sourceIndex) => {
          const targetIndex = loweredTargetUnion.members.findIndex((m) => m === source);
          assert(targetIndex !== -1);
          mapping!.mapping.set(sourceIndex, targetIndex);
        });
      } else {
        // Verify existing entry
        loweredSourceUnion.members.forEach((source, sourceIndex) => {
          const targetIndex = loweredTargetUnion.members.findIndex((m) => m === source);
          assert(targetIndex !== -1);
          assert(mapping!.mapping.get(source) === targetIndex);
        });
      }

      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.UnionToUnionCastExpr,
        expr: lowerExpr(lr, expr.expr, flattened, instanceInfo)[1],
        optimizeExprToNullptr: optimizeExprToNullptr,
        tagMapping: mapping,
        type: loweredTargetUnionId,
      });
    }

    case Semantic.ENode.UnionTagCheckExpr: {
      const sourceExpr = lr.sr.exprNodes.get(expr.expr);
      const sourceType = lr.sr.typeDefNodes.get(lr.sr.typeUseNodes.get(sourceExpr.type).type);
      assert(
        sourceType.variant === Semantic.ENode.UntaggedUnionDatatype ||
          sourceType.variant === Semantic.ENode.TaggedUnionDatatype
      );

      const loweredUnionId = lowerTypeUse(lr, sourceExpr.type);
      const loweredUnion = lr.typeDefNodes.get(lr.typeUseNodes.get(loweredUnionId).type);
      assert(
        loweredUnion.variant === Lowered.ENode.UntaggedUnionDatatype ||
          loweredUnion.variant === Lowered.ENode.TaggedUnionDatatype
      );

      const comparisonTypes = expr.comparisonTypesAnd.map((comparisonType) =>
        lowerTypeUse(lr, comparisonType)
      );

      if (loweredUnion.optimizeAsRawPointer) {
        assert(comparisonTypes.length === 1);

        // Whether the user wanted to invert it
        let invertCheck = expr.invertCheck;

        const compTypeUse = lr.typeUseNodes.get(comparisonTypes[0]);
        const compType = lr.typeDefNodes.get(compTypeUse.type);
        if (
          compType.variant === Lowered.ENode.PrimitiveDatatype &&
          (compType.primitive === EPrimitive.null || compType.primitive === EPrimitive.none)
        ) {
          // But -> If the user wrote: Foo | none -> NOT none we must rewrite it into IS Foo
          // So:
          // If Foo is referenced (as in IS Foo or IS NOT Foo), then its ok
          // But if none is referenced (as in IS none or IS NOT none) then we must invert it
          // Since the code generation is simple and always refers to Foo, the actual value
          invertCheck = !invertCheck;
        }

        // An optimized pointer check is always truish (NOT null)
        // Therefore -> the condition may need to be inverted twice
        return Lowered.addExpr(lr, {
          variant: Lowered.ENode.UnionTagCheckExpr,
          expr: lowerExpr(lr, expr.expr, flattened, instanceInfo)[1],
          optimizeExprToNullptr: !!loweredUnion.optimizeAsRawPointer,
          invertCheck: expr.invertCheck,
          tags: [],
          type: loweredUnionId,
        });
      } else {
        const unionMembers =
          loweredUnion.variant === Lowered.ENode.UntaggedUnionDatatype
            ? loweredUnion.members
            : loweredUnion.members.map((m) => m.type);

        let tags: number[] = [];
        comparisonTypes.forEach((t) => {
          const tag = unionMembers.findIndex((m) => m === t);
          assert(tag !== -1);
          tags.push(tag);
        });

        return Lowered.addExpr(lr, {
          variant: Lowered.ENode.UnionTagCheckExpr,
          expr: lowerExpr(lr, expr.expr, flattened, instanceInfo)[1],
          optimizeExprToNullptr: !!loweredUnion.optimizeAsRawPointer,
          invertCheck: expr.invertCheck,
          tags: tags,
          type: loweredUnionId,
        });
      }
    }

    default:
      assert(false, "All cases handled " + Semantic.ENode[(expr as any).variant]);
  }
}

function makeVoidPointerType(lr: Lowered.Module) {
  const voidTypeId = lowerTypeUse(lr, makeVoidType(lr.sr));
  if (lr.loweredPointers.has(voidTypeId)) {
    return lr.loweredPointers.get(voidTypeId)!;
  }

  const [newVoid, newVoidId] = Lowered.addTypeDef(lr, {
    variant: Lowered.ENode.PointerDatatype,
    referee: voidTypeId,
    name: {
      mangledName: "pvoid",
      prettyName: "void*",
      wasMangled: true,
    },
  });
  lr.loweredPointers.set(voidTypeId, newVoidId);
  return newVoidId;
}

function makeLowerTypeUse(lr: Lowered.Module, typeDefId: Lowered.TypeDefId, pointer: boolean) {
  const typeDef = lr.typeDefNodes.get(typeDefId);
  return Lowered.addTypeUse(lr, {
    variant: Lowered.ENode.TypeUse,
    name: typeDef.name,
    mutability: EDatatypeMutability.Default,
    pointer: pointer,
    type: typeDefId,
    sourceloc: null,
  });
}

export function lowerTypeDef(lr: Lowered.Module, typeId: Semantic.TypeDefId): Lowered.TypeDefId {
  const type = lr.sr.typeDefNodes.get(typeId);

  if (type.variant === Semantic.ENode.StructDatatype) {
    if (lr.loweredTypeDefs.has(typeId)) {
      return lr.loweredTypeDefs.get(typeId)!;
    } else {
      let [p, pId] = Lowered.addTypeDef<Lowered.StructDatatypeDef>(lr, {
        variant: Lowered.ENode.StructDatatype,
        noemit: type.noemit,
        name: Semantic.makeNameSetTypeDef(lr.sr, typeId),
        members: [],
      });
      lr.loweredTypeDefs.set(typeId, pId);

      p.members = type.members.map((mId) => {
        const m = lr.sr.symbolNodes.get(mId);
        assert(m.variant === Semantic.ENode.VariableSymbol);
        assert(m.type);
        return {
          name: m.name,
          type: lowerTypeUse(lr, m.type),
        };
      });

      return pId;
    }
  } else if (type.variant === Semantic.ENode.PrimitiveDatatype) {
    if (lr.loweredTypeDefs.has(typeId)) {
      return lr.loweredTypeDefs.get(typeId)!;
    } else {
      const [p, pId] = Lowered.addTypeDef<Lowered.PrimitiveDatatypeDef>(lr, {
        variant: Lowered.ENode.PrimitiveDatatype,
        primitive: type.primitive,
        name: Semantic.makeNameSetTypeDef(lr.sr, typeId),
      });
      lr.loweredTypeDefs.set(typeId, pId);
      return pId;
    }
  } else if (type.variant === Semantic.ENode.FunctionDatatype) {
    if (lr.loweredTypeDefs.has(typeId)) {
      return lr.loweredTypeDefs.get(typeId)!;
    } else {
      const parameters: Lowered.TypeUseId[] = [];

      const arenaType = lr.sr.e.arenaTypeUse(false, null)[1];
      if (type.requires.autodest) {
        parameters.push(lowerTypeUse(lr, arenaType));
      }

      for (const p of type.parameters) {
        const pp = lr.sr.typeUseNodes.get(p);
        const typeDef = lr.sr.typeDefNodes.get(pp.type);
        if (typeDef.variant === Semantic.ENode.ParameterPackDatatype) {
          for (const packParam of typeDef.parameters || []) {
            const sym = lr.sr.symbolNodes.get(packParam);
            assert(sym.variant === Semantic.ENode.VariableSymbol);
            assert(sym.type);
            parameters.push(lowerTypeUse(lr, sym.type));
          }
        } else {
          parameters.push(lowerTypeUse(lr, p));
        }
      }
      const [p, pId] = Lowered.addTypeDef<Lowered.FunctionDatatypeDef>(lr, {
        variant: Lowered.ENode.FunctionDatatype,
        parameters: parameters,
        returnType: lowerTypeUse(lr, type.returnType),
        autodest: type.requires.autodest,
        name: Semantic.makeNameSetTypeDef(lr.sr, typeId),
        vararg: type.vararg,
      });
      lr.loweredTypeDefs.set(typeId, pId);
      return pId;
    }
  } else if (type.variant === Semantic.ENode.CallableDatatype) {
    if (lr.loweredTypeDefs.has(typeId)) {
      return lr.loweredTypeDefs.get(typeId)!;
    } else {
      const ftypeId = lowerTypeDef(lr, type.functionType);
      const ftype = lr.typeDefNodes.get(ftypeId);
      assert(ftype.variant === Lowered.ENode.FunctionDatatype);
      const [p, pId] = Lowered.addTypeDef<Lowered.CallableDatatypeDef>(lr, {
        variant: Lowered.ENode.CallableDatatype,
        thisExprType: (type.thisExprType && lowerTypeUse(lr, type.thisExprType)) || null,
        functionType: ftypeId,
        name: Semantic.makeNameSetTypeDef(lr.sr, typeId),
      });
      lr.loweredTypeDefs.set(typeId, pId);
      return pId;
    }
  } else if (type.variant === Semantic.ENode.FixedArrayDatatype) {
    if (lr.loweredTypeDefs.has(typeId)) {
      return lr.loweredTypeDefs.get(typeId)!;
    } else {
      const [p, pId] = Lowered.addTypeDef<Lowered.ArrayDatatypeDef>(lr, {
        variant: Lowered.ENode.ArrayDatatype,
        datatype: lowerTypeUse(lr, type.datatype),
        name: Semantic.makeNameSetTypeDef(lr.sr, typeId),
        length: type.length,
      });
      lr.loweredTypeDefs.set(typeId, pId);
      return pId;
    }
  } else if (type.variant === Semantic.ENode.DynamicArrayDatatype) {
    if (lr.loweredTypeDefs.has(typeId)) {
      return lr.loweredTypeDefs.get(typeId)!;
    } else {
      const [p, pId] = Lowered.addTypeDef<Lowered.SliceDatatypeDef>(lr, {
        variant: Lowered.ENode.SliceDatatype,
        datatype: lowerTypeUse(lr, type.datatype),
        name: Semantic.makeNameSetTypeDef(lr.sr, typeId),
      });
      lr.loweredTypeDefs.set(typeId, pId);
      return pId;
    }
  } else if (type.variant === Semantic.ENode.UntaggedUnionDatatype) {
    if (lr.loweredTypeDefs.has(typeId)) {
      return lr.loweredTypeDefs.get(typeId)!;
    } else {
      let optimizeAsRawPointer: Lowered.TypeUseId | null = null;
      if (type.members.length === 2) {
        // Is optimized if either 'Foo | null' or 'Foo | none'. 'Foo | null | none' can NOT be optimized (length != 2)
        const def1 = lr.sr.typeDefNodes.get(lr.sr.typeUseNodes.get(type.members[0]).type);
        const def2 = lr.sr.typeDefNodes.get(lr.sr.typeUseNodes.get(type.members[1]).type);
        if (
          def1.variant === Semantic.ENode.StructDatatype &&
          def2.variant === Semantic.ENode.PrimitiveDatatype &&
          (def2.primitive === EPrimitive.none || def2.primitive === EPrimitive.null)
        ) {
          optimizeAsRawPointer = lowerTypeUse(lr, type.members[0]);
        }
        if (
          def2.variant === Semantic.ENode.StructDatatype &&
          def1.variant === Semantic.ENode.PrimitiveDatatype &&
          (def1.primitive === EPrimitive.none || def1.primitive === EPrimitive.null)
        ) {
          optimizeAsRawPointer = lowerTypeUse(lr, type.members[1]);
        }
      }

      const canonicalMembers = type.members.map((m) => lowerTypeUse(lr, m));

      // Do another cache lookup for deduplication
      for (const [id, unionId] of lr.loweredTypeDefs) {
        const union = lr.typeDefNodes.get(unionId);
        if (union.variant === Lowered.ENode.UntaggedUnionDatatype) {
          if (
            union.optimizeAsRawPointer === optimizeAsRawPointer &&
            union.members.length === canonicalMembers.length &&
            union.members.every((m, i) => m === canonicalMembers[i])
          ) {
            return unionId;
          }
        }
      }

      const [p, pId] = Lowered.addTypeDef<Lowered.UntaggedUnionDatatypeDef>(lr, {
        variant: Lowered.ENode.UntaggedUnionDatatype,
        members: canonicalMembers,
        optimizeAsRawPointer: optimizeAsRawPointer,
        name: Semantic.makeNameSetTypeDef(lr.sr, typeId),
      });
      lr.loweredTypeDefs.set(typeId, pId);
      return pId;
    }
  } else if (type.variant === Semantic.ENode.TaggedUnionDatatype) {
    if (lr.loweredTypeDefs.has(typeId)) {
      return lr.loweredTypeDefs.get(typeId)!;
    } else {
      const members = type.members.map((m) => ({
        tag: m.tag,
        type: lowerTypeUse(lr, m.type),
      }));

      // Do another cache lookup for deduplication
      for (const [id, unionId] of lr.loweredTypeDefs) {
        const union = lr.typeDefNodes.get(unionId);
        if (union.variant === Lowered.ENode.TaggedUnionDatatype) {
          if (
            union.members.length === members.length &&
            union.members.every((m, i) => m.tag === members[i].tag && m.type === members[i].type)
          ) {
            return unionId;
          }
        }
      }

      const [p, pId] = Lowered.addTypeDef<Lowered.TaggedUnionDatatypeDef>(lr, {
        variant: Lowered.ENode.TaggedUnionDatatype,
        members: members,
        optimizeAsRawPointer: null,
        name: Semantic.makeNameSetTypeDef(lr.sr, typeId),
      });
      lr.loweredTypeDefs.set(typeId, pId);
      return pId;
    }
  } else if (type.variant === Semantic.ENode.EnumDatatype) {
    if (lr.loweredTypeDefs.has(typeId)) {
      return lr.loweredTypeDefs.get(typeId)!;
    } else {
      const enumName = Semantic.makeNameSetTypeDef(lr.sr, typeId);
      const flattened: Lowered.StatementId[] = [];
      const [p, pId] = Lowered.addTypeDef<Lowered.EnumDatatypeDef>(lr, {
        variant: Lowered.ENode.EnumDatatype,
        values: type.values.map((m) => ({
          originalName: m.name,
          loweredName: {
            prettyName: enumName.prettyName + "." + m.name,
            mangledName:
              type.extern === EExternLanguage.Extern_C
                ? m.name
                : enumName.mangledName + "_" + m.name,
            wasMangled: type.extern !== EExternLanguage.Extern_C,
          },
          value: lowerExpr(lr, m.valueExpr, flattened, {
            returnedInstanceIds: new Set(),
          })[1],
        })),
        noemit: type.noemit,
        type: lowerTypeUse(lr, type.type),
        name: enumName,
      });
      lr.loweredTypeDefs.set(typeId, pId);
      assert(flattened.length === 0);
      return pId;
    }
  } else if (type.variant === Semantic.ENode.ParameterPackDatatype) {
    assert(false, "A Parameter Pack cannot be lowered");
  } else {
    throw new InternalError("Unhandled variant: " + type.variant);
  }
}

// function makePointerAvailable(lr: Lowered.Module, typeUseId: Lowered.TypeUseId) {
//   if (lr.loweredPointers.has(typeUseId)) {
//     return lr.loweredPointers.get(typeUseId)!;
//   } else {
//     const type = lr.typeUseNodes.get(typeUseId);
//     const ptrId = Lowered.addTypeDef(lr, {
//       variant: Lowered.ENode.PointerDatatype,
//       name: {
//         mangledName:
//           (type.name.wasMangled ? "p" + type.name.mangledName : type.name.mangledName) + "AAA",
//         prettyName: type.name.prettyName + "POINTER",
//         wasMangled: type.name.wasMangled,
//       },
//       referee: typeUseId,
//     })[1];
//     lr.loweredPointers.set(typeUseId, ptrId);
//     return ptrId;
//   }
// }

function lowerTypeUse(lr: Lowered.Module, typeId: Semantic.TypeUseId): Lowered.TypeUseId {
  const typeUse = lr.sr.typeUseNodes.get(typeId);
  if (lr.loweredTypeUses.has(typeId)) {
    return lr.loweredTypeUses.get(typeId)!;
  }

  const typeDef = lr.sr.typeDefNodes.get(typeUse.type);
  const id = Lowered.addTypeUse(lr, {
    variant: Lowered.ENode.TypeUse,
    mutability: typeUse.mutability,
    name: Semantic.makeNameSetTypeUse(lr.sr, typeId),
    pointer: !typeUse.inline && typeDef.variant === Semantic.ENode.StructDatatype,
    sourceloc: typeUse.sourceloc,
    type: lowerTypeDef(lr, typeUse.type),
  })[1];
  lr.loweredTypeUses.set(typeId, id);

  return id;
}

function lowerStatement(
  lr: Lowered.Module,
  statementId: Semantic.StatementId,
  instanceInfo: InstanceInfo
): Lowered.StatementId[] {
  const statement = lr.sr.statementNodes.get(statementId);
  switch (statement.variant) {
    case Semantic.ENode.VariableStatement: {
      const flattened: Lowered.StatementId[] = [];
      const variableSymbol = lr.sr.symbolNodes.get(statement.variableSymbol);
      assert(variableSymbol.variant === Semantic.ENode.VariableSymbol);
      assert(variableSymbol.type);
      const [s, sId] = Lowered.addStatement<Lowered.Statement>(lr, {
        variant: Lowered.ENode.VariableStatement,
        name: {
          mangledName: statement.name,
          prettyName: statement.name,
          wasMangled: false,
        },
        type: lowerTypeUse(lr, variableSymbol.type),
        value: statement.value && lowerExpr(lr, statement.value, flattened, instanceInfo)[1],
        variableContext: variableSymbol.variableContext,
        sourceloc: statement.sourceloc,
      });
      return [...flattened, sId];
    }

    case Semantic.ENode.IfStatement: {
      const flattened: Lowered.StatementId[] = [];
      console.log("TODO: Lowered statement ordering may be wrong (see elseif's)");
      const [s, sId] = Lowered.addStatement<Lowered.Statement>(lr, {
        variant: Lowered.ENode.IfStatement,
        condition: lowerExpr(lr, statement.condition, flattened, instanceInfo)[1],
        then: lowerBlockScope(lr, statement.then, false, instanceInfo),
        elseIfs: statement.elseIfs.map((e) => {
          return {
            condition: lowerExpr(lr, e.condition, flattened, instanceInfo)[1],
            then: lowerBlockScope(lr, e.then, false, instanceInfo),
          };
        }),
        else: statement.else && lowerBlockScope(lr, statement.else, false, instanceInfo),
        sourceloc: statement.sourceloc,
      });
      return [...flattened, sId];
    }

    case Semantic.ENode.WhileStatement: {
      const flattened: Lowered.StatementId[] = [];
      const [s, sId] = Lowered.addStatement<Lowered.Statement>(lr, {
        variant: Lowered.ENode.WhileStatement,
        condition: lowerExpr(lr, statement.condition, flattened, instanceInfo)[1],
        then: lowerBlockScope(lr, statement.then, false, instanceInfo),
        sourceloc: statement.sourceloc,
      });
      return [...flattened, sId];
    }

    case Semantic.ENode.ExprStatement: {
      const flattened: Lowered.StatementId[] = [];
      const [s, sId] = Lowered.addStatement<Lowered.Statement>(lr, {
        variant: Lowered.ENode.ExprStatement,
        expr: lowerExpr(lr, statement.expr, flattened, instanceInfo)[1],
        sourceloc: statement.sourceloc,
      });
      return [...flattened, sId];
    }

    case Semantic.ENode.ReturnStatement: {
      const flattened: Lowered.StatementId[] = [];
      let value = statement.expr ? lowerExpr(lr, statement.expr, flattened, instanceInfo)[1] : null;
      const [s, sId] = Lowered.addStatement<Lowered.Statement>(lr, {
        variant: Lowered.ENode.ReturnStatement,
        expr: value,
        sourceloc: statement.sourceloc,
      });
      return [...flattened, sId];
    }

    case Semantic.ENode.InlineCStatement: {
      return [
        Lowered.addStatement<Lowered.InlineCStatement>(lr, {
          variant: Lowered.ENode.InlineCStatement,
          value: statement.value,
          sourceloc: statement.sourceloc,
        })[1],
      ];
    }

    default:
      throw new InternalError("Unhandled case: ");
  }
}

function lowerBlockScope(
  lr: Lowered.Module,
  semanticScopeId: Semantic.BlockScopeId,
  createLocalArena: boolean,
  instanceInfo: InstanceInfo
): Lowered.BlockScopeId {
  const blockScope = lr.sr.blockScopeNodes.get(semanticScopeId);
  assert(blockScope.variant === Semantic.ENode.BlockScope);

  let containsVariables = false;
  const statements: Lowered.StatementId[] = [];

  const loweredArenaType = lowerTypeUse(lr, lr.sr.e.arenaTypeUse(false, null)[1]);
  const loweredArenaInlineType = lowerTypeUse(lr, lr.sr.e.arenaTypeUse(true, null)[1]);
  if (createLocalArena) {
    const [arenaImpl, arenaImplId] = Lowered.addExpr(lr, {
      variant: Lowered.ENode.ExprCallExpr,
      arguments: [
        Lowered.addExpr(lr, {
          variant: Lowered.ENode.SymbolValueExpr,
          name: {
            mangledName: "HZSTD_DEFAULT_ARENA_CHUNK_SIZE",
            prettyName: "HZSTD_DEFAULT_ARENA_CHUNK_SIZE",
            wasMangled: false,
          },
          type: loweredArenaType,
        })[1],
      ],
      expr: Lowered.addExpr(lr, {
        variant: Lowered.ENode.SymbolValueExpr,
        name: {
          mangledName: "hzstd_arena_create_and_attach_subarena",
          prettyName: "hzstd_arena_create_and_attach_subarena",
          wasMangled: false,
        },
        type: makeLowerTypeUse(
          lr,
          lowerTypeDef(
            lr,
            makeRawFunctionDatatypeAvailable(lr.sr, {
              parameters: [lr.sr.e.arenaTypeUse(false, null)[1]],
              returnType: lr.sr.e.arenaTypeUse(false, null)[1],
              vararg: false,
              requires: {
                final: true,
                autodest: false,
                noreturn: false,
              },
              sourceloc: null,
            })
          ),
          false
        )[1],
      })[1],
      takesReturnArena: true,
      type: loweredArenaType,
    });

    storeInTempVarAndGet(
      lr,
      loweredArenaType,
      makeIntrinsicCall(lr, "HZSTD_MAKE_LOCAL_ARENA", [], loweredArenaType)[1],
      null,
      statements,
      "__hz_local_arena"
    );
  }

  // undefined = no return, null = return nothing, expr = return expr
  let returnedExpr: Lowered.ExprId | null | undefined = undefined;
  let firstStrippedStatement = null as SourceLoc | null;
  let lastStrippedStatement = null as SourceLoc | null;

  for (const s of blockScope.statements) {
    const statement = lr.sr.statementNodes.get(s);
    if (statement.variant === Semantic.ENode.VariableStatement) {
      containsVariables = true;
    }

    for (const statementId of lowerStatement(lr, s, instanceInfo)) {
      const innerStatement = lr.statementNodes.get(statementId);

      if (
        createLocalArena &&
        innerStatement.variant === Lowered.ENode.ReturnStatement &&
        !returnedExpr
      ) {
        if (innerStatement.expr) {
          returnedExpr = storeInTempVarAndGet(
            lr,
            lr.exprNodes.get(innerStatement.expr).type,
            innerStatement.expr,
            innerStatement.sourceloc,
            statements
          )[1];
        } else {
          returnedExpr = null;
        }
        continue;
      }

      if (returnedExpr) {
        if (!firstStrippedStatement) {
          firstStrippedStatement = innerStatement.sourceloc;
        }
        lastStrippedStatement = innerStatement.sourceloc;
        continue;
      }

      statements.push(statementId);
    }
  }

  if (firstStrippedStatement && lastStrippedStatement) {
    const location: SourceLoc = {
      filename: firstStrippedStatement.filename,
      start: firstStrippedStatement.start,
      end: lastStrippedStatement.end,
    };
    printWarningMessage(`Dead code detected and stripped`, location);
  }

  const emitted = blockScope.emittedExpr
    ? lowerExpr(lr, blockScope.emittedExpr, statements, instanceInfo)[1]
    : null;

  if (createLocalArena) {
    const [destroy, destroyId] = makeIntrinsicCall(
      lr,
      "HZSTD_DESTROY_LOCAL_ARENA",
      [
        Lowered.addExpr(lr, {
          variant: Lowered.ENode.SymbolValueExpr,
          name: {
            mangledName: "__hz_local_arena",
            prettyName: "__hz_local_arena",
            wasMangled: false,
          },
          type: loweredArenaType,
        })[1],
      ],
      lowerTypeUse(lr, makeVoidType(lr.sr))
    );
    statements.push(
      Lowered.addStatement(lr, {
        variant: Lowered.ENode.ExprStatement,
        expr: destroyId,
        sourceloc: null,
      })[1]
    );
  }

  if (returnedExpr !== undefined) {
    statements.push(
      Lowered.addStatement(lr, {
        variant: Lowered.ENode.ReturnStatement,
        expr: returnedExpr,
        sourceloc: null,
      })[1]
    );
  }

  // Flatten block scopes that don't define variables to remove redundant scopes and make code more readable
  const flattenedStatements: Lowered.StatementId[] = [];
  for (const s of statements) {
    const statement = lr.statementNodes.get(s);
    if (statement.variant === Lowered.ENode.ExprStatement) {
      const expr = lr.exprNodes.get(statement.expr);
      if (expr.variant === Lowered.ENode.BlockScopeExpr) {
        const blockScope = lr.blockScopeNodes.get(expr.block);
        if (!blockScope.definesVariables && blockScope.emittedExpr === null) {
          flattenedStatements.push(...blockScope.statements);
          continue;
        }
      }
    }
    flattenedStatements.push(s);
  }

  const [scope, scopeId] = Lowered.addBlockScope<Lowered.BlockScope>(lr, {
    statements: flattenedStatements,
    definesVariables: containsVariables,
    emittedExpr: emitted,
  });
  return scopeId;
}

// export function mangleParameterNames(sr: SemanticResult, functionSymbolId: Semantic.Id) {
//   const functionSymbol = sr.nodes.get(functionSymbolId);
//   assert(functionSymbol.variant === Semantic.ENode.FunctionSymbol);
//   const semanticFtype = sr.nodes.get(functionSymbol.type);
//   assert(semanticFtype.variant === Semantic.ENode.FunctionDatatype);

//   if (functionSymbol.extern === EExternLanguage.Extern_C) {
//     return "";
//   }

//   let parameterMangling = "";
//   for (const p of semanticFtype.parameters) {
//     const pp = sr.nodes.get(p);
//     if (pp.variant === Semantic.ENode.ParameterPackDatatypeSymbol) {
//       for (const ppp of pp.parameters) {
//         const pv = sr.nodes.get(ppp);
//         assert(pv.variant === Semantic.ENode.VariableSymbol);
//         assert(pv.type);
//         parameterMangling += mangleDatatype(sr, pv.type);
//       }
//     } else {
//       parameterMangling += mangleDatatype(sr, p);
//     }
//   }
//   return parameterMangling;
// }

function lowerSymbol(lr: Lowered.Module, symbolId: Semantic.SymbolId) {
  const symbol = lr.sr.symbolNodes.get(symbolId);

  switch (symbol.variant) {
    case Semantic.ENode.FunctionSymbol: {
      if (lr.loweredFunctions.has(symbolId)) {
        return lr.loweredFunctions.get(symbolId)!;
      }
      if (symbol.noemit) {
        return;
      }

      const parameterNames: string[] = [...symbol.parameterNames];
      const functype = lr.sr.typeDefNodes.get(symbol.type);
      assert(functype.variant === Semantic.ENode.FunctionDatatype);
      const paramPackId = functype.parameters.find((p) => {
        const ppt = lr.sr.typeUseNodes.get(p);
        const pp = lr.sr.typeDefNodes.get(ppt.type);
        return pp.variant === Semantic.ENode.ParameterPackDatatype;
      });
      if (paramPackId) {
        const paramPackt = lr.sr.typeUseNodes.get(paramPackId);
        const paramPack = lr.sr.typeDefNodes.get(paramPackt.type);
        assert(paramPack.variant === Semantic.ENode.ParameterPackDatatype);
        parameterNames.pop();
        for (const p of paramPack.parameters || []) {
          const pp = lr.sr.symbolNodes.get(p);
          assert(pp.variant === Semantic.ENode.VariableSymbol);
          parameterNames.push(pp.name);
        }
      }

      const originalFuncType = lr.sr.typeDefNodes.get(symbol.type);
      assert(originalFuncType.variant === Semantic.ENode.FunctionDatatype);
      const newParameters = [...originalFuncType.parameters];

      const arenaType = lr.sr.e.arenaTypeUse(false, null)[1];
      if (originalFuncType.requires.autodest) {
        // This is so that function declarations take an additional parameter (NOT the passing)
        parameterNames.unshift("__hz_return_arena");
        newParameters.unshift(arenaType);
      }

      const newFuncType = makeRawFunctionDatatypeAvailable(lr.sr, {
        parameters: originalFuncType.parameters,
        returnType: originalFuncType.returnType,
        sourceloc: symbol.sourceloc,
        requires: {
          final: originalFuncType.requires.final,
          autodest: originalFuncType.requires.autodest,
          noreturn: originalFuncType.requires.noreturn,
        },
        vararg: false,
      });

      const monomorphized = Semantic.isSymbolMonomorphized(lr.sr, symbolId);
      const exported = Semantic.isSymbolExported(lr.sr, symbolId);

      // Normal function
      const [f, fId] = Lowered.addFunction<Lowered.FunctionSymbol>(lr, {
        variant: Lowered.ENode.FunctionSymbol,
        name: Semantic.makeNameSetSymbol(lr.sr, symbolId),
        parameterNames: parameterNames,
        type: lowerTypeDef(lr, newFuncType),
        noreturn: originalFuncType.requires.noreturn,
        isLibraryLocal:
          monomorphized ||
          (!exported && symbol.extern !== EExternLanguage.Extern_C && symbol.scope !== null),
        scope: null,
        sourceloc: symbol.sourceloc,
        externLanguage: symbol.extern,
      });
      lr.loweredFunctions.set(symbolId, fId);

      const remainingInstances = new Set(symbol.createsInstanceIds);
      symbol.returnsInstanceIds.forEach((i) => remainingInstances.delete(i));
      symbol.explicitArenaInstanceIds.forEach((i) => remainingInstances.delete(i));
      const createLocalArena = remainingInstances.size > 0 || symbol.explicitLocalArena;

      f.scope =
        (symbol.scope &&
          lowerBlockScope(lr, symbol.scope, createLocalArena, {
            returnedInstanceIds: symbol.returnsInstanceIds,
          })) ||
        null;
      break;
    }

    case Semantic.ENode.TypeDefSymbol: {
      const datatypeId = symbol.datatype;
      const datatype = lr.sr.typeDefNodes.get(datatypeId);

      switch (datatype.variant) {
        case Semantic.ENode.EnumDatatype:
        case Semantic.ENode.StructDatatype: {
          if (datatype.noemit) {
            return undefined;
          }
          lowerTypeDef(lr, datatypeId);
          break;
        }

        case Semantic.ENode.PrimitiveDatatype:
        case Semantic.ENode.FunctionDatatype:
        case Semantic.ENode.CallableDatatype: {
          lowerTypeDef(lr, datatypeId);
          break;
        }

        case Semantic.ENode.NamespaceDatatype: {
          for (const s of datatype.symbols) {
            lowerSymbol(lr, s);
          }
          break;
        }

        default:
          throw new InternalError("Unhandled variant: " + symbol.variant);
      }
      break;
    }

    case Semantic.ENode.VariableSymbol: {
      if (symbol.variableContext !== EVariableContext.Global) {
        return undefined;
      }
      assert(false, "not implemented");
    }

    case Semantic.ENode.GlobalVariableDefinitionSymbol: {
      const variableSymbol = lr.sr.symbolNodes.get(symbol.variableSymbol);
      assert(variableSymbol.variant === Semantic.ENode.VariableSymbol);
      assert(variableSymbol.type);
      const flattened: Lowered.StatementId[] = [];
      const [p, pId] = Lowered.addStatement<Lowered.VariableStatement>(lr, {
        variant: Lowered.ENode.VariableStatement,
        name: Semantic.makeNameSetSymbol(lr.sr, symbolId),
        type: lowerTypeUse(lr, variableSymbol.type),
        variableContext: EVariableContext.Global,
        value:
          symbol.value &&
          lowerExpr(lr, symbol.value, flattened, {
            returnedInstanceIds: new Set(),
          })[1],
        sourceloc: symbol.sourceloc,
      });
      lr.loweredGlobalVariables.set(symbolId, [...flattened, pId]);
      return;
    }

    default:
      throw new InternalError("Unhandled variant: " + symbol.variant);
  }
}

const print = (str: string, indent = 0) => {
  console.info(" ".repeat(indent) + str);
};

function serializeLoweredExpr(lr: Lowered.Module, exprId: Lowered.ExprId): string {
  const expr = lr.exprNodes.get(exprId);

  switch (expr.variant) {
    case Lowered.ENode.BinaryExpr:
      return `(${serializeLoweredExpr(lr, expr.left)} ${BinaryOperationToString(
        expr.operation
      )} ${serializeLoweredExpr(lr, expr.left)})`;

    case Lowered.ENode.UnaryExpr:
      return `(${UnaryOperationToString(expr.operation)}${serializeLoweredExpr(lr, expr.expr)})`;

    case Lowered.ENode.UnionToValueCastExpr:
      return `(${lr.typeUseNodes.get(expr.type).name.prettyName})${serializeLoweredExpr(
        lr,
        expr.expr
      )}`;

    case Lowered.ENode.ValueToUnionCastExpr:
      return `(${lr.typeUseNodes.get(expr.type).name.prettyName})${serializeLoweredExpr(
        lr,
        expr.expr
      )}`;

    case Lowered.ENode.UnionToUnionCastExpr:
      return `(${serializeLoweredExpr(lr, expr.expr)} as ${
        lr.typeUseNodes.get(expr.type).name.prettyName
      })`;

    case Lowered.ENode.UnionTagCheckExpr:
      return `((${serializeLoweredExpr(lr, expr.expr)}) is union tags [${expr.tags}])`;

    case Lowered.ENode.ExplicitCastExpr:
      const exprType = lr.typeUseNodes.get(expr.type);
      return `(${serializeLoweredExpr(lr, expr.expr)} as ${exprType.name.prettyName})`;

    case Lowered.ENode.ExprCallExpr:
      return `((${serializeLoweredExpr(lr, expr.expr)})(${expr.arguments
        .map((a) => serializeLoweredExpr(lr, a))
        .join(", ")}))`;

    case Lowered.ENode.PostIncrExpr:
      return `((${serializeLoweredExpr(lr, expr.expr)})${IncrOperationToString(expr.operation)})`;

    case Lowered.ENode.PreIncrExpr:
      return `(${IncrOperationToString(expr.operation)}(${serializeLoweredExpr(lr, expr.expr)}))`;

    case Lowered.ENode.SymbolValueExpr:
      return expr.name.prettyName;

    case Lowered.ENode.BlockScopeExpr:
      return `{ ... }`;

    case Lowered.ENode.StringConstructExpr:
      return `str(${serializeLoweredExpr(lr, expr.value.data)}, ${serializeLoweredExpr(
        lr,
        expr.value.length
      )})`;

    case Lowered.ENode.ArrayLiteralExpr: {
      const t = lr.typeUseNodes.get(expr.type);
      return `(${t.name.prettyName})[${expr.values
        .map((v) => serializeLoweredExpr(lr, v))
        .join(", ")}]`;
    }

    case Lowered.ENode.ArraySubscriptExpr:
      return `(${serializeLoweredExpr(lr, expr.expr)})[${serializeLoweredExpr(lr, expr.index)}]`;

    case Lowered.ENode.ArraySliceExpr:
      return `(${serializeLoweredExpr(lr, expr.expr)})[${serializeLoweredExpr(
        lr,
        expr.start
      )}:${serializeLoweredExpr(lr, expr.end)}]`;

    case Lowered.ENode.StructInstantiationExpr: {
      const exprType = lr.typeUseNodes.get(expr.type);
      return `${exprType.name.prettyName} { ${expr.memberAssigns
        .map((a) => `${a.name}: ${serializeLoweredExpr(lr, a.value)}`)
        .join(", ")} }`;
    }

    case Lowered.ENode.DatatypeAsValueExpr: {
      const t = lr.typeUseNodes.get(expr.type);
      return t.name.prettyName;
    }

    case Lowered.ENode.LiteralExpr: {
      const exprType = lr.typeUseNodes.get(expr.type);
      const type = lr.typeDefNodes.get(exprType.type);
      if (type.variant === Lowered.ENode.PrimitiveDatatype && type.primitive === EPrimitive.str) {
        assert(expr.literal.type === EPrimitive.str);
        return `${JSON.stringify(expr.literal.value)}`;
      } else if (expr.literal.type === EPrimitive.cstr) {
        return `${JSON.stringify(expr.literal.value)}`;
      } else if (expr.literal.type === EPrimitive.ccstr) {
        return `${JSON.stringify(expr.literal.value)}`;
      } else if (expr.literal.type === EPrimitive.null) {
        return `null`;
      } else if (expr.literal.type === EPrimitive.none) {
        return `none`;
      } else if (expr.literal.type === "enum") {
        return `Enum Literal`;
      } else {
        return `${expr.literal.value}`;
      }
    }

    case Lowered.ENode.MemberAccessExpr:
      return `(${serializeLoweredExpr(lr, expr.expr)}.${expr.memberName})`;

    case Lowered.ENode.CallableExpr:
      return `Callable(${expr.functionName.prettyName}, this=${serializeLoweredExpr(
        lr,
        expr.thisExpr
      )})`;

    case Lowered.ENode.AddressOfExpr:
      return `&${serializeLoweredExpr(lr, expr.expr)}`;

    case Lowered.ENode.DereferenceExpr:
      return `*${serializeLoweredExpr(lr, expr.expr)}`;

    case Lowered.ENode.ExprAssignmentExpr:
      return `${serializeLoweredExpr(lr, expr.target)} = ${serializeLoweredExpr(lr, expr.value)}`;

    case Lowered.ENode.SizeofExpr:
      return `sizeof(${serializeLoweredExpr(lr, expr.value)})`;

    case Lowered.ENode.AlignofExpr:
      return `alignof(${serializeLoweredExpr(lr, expr.value)})`;
  }
}

export function printStatement(lr: Lowered.Module, sId: Lowered.StatementId, indent = 0) {
  const s = lr.statementNodes.get(sId);

  switch (s.variant) {
    case Lowered.ENode.ExprStatement:
      print(serializeLoweredExpr(lr, s.expr) + ";", indent);
      break;

    case Lowered.ENode.InlineCStatement:
      print("__c__(" + JSON.stringify(s.value) + ")", indent);
      break;

    case Lowered.ENode.ReturnStatement:
      print("return" + (s.expr ? ` ${serializeLoweredExpr(lr, s.expr)}` : "") + ";", indent);
      break;

    case Lowered.ENode.VariableStatement: {
      const type = lr.typeUseNodes.get(s.type);
      print(
        "var " +
          s.name.prettyName +
          ": " +
          type.name.prettyName +
          (s.value ? " = " + serializeLoweredExpr(lr, s.value) : "") +
          ";",
        indent
      );
      break;
    }

    case Lowered.ENode.IfStatement:
      print(`If ${serializeLoweredExpr(lr, s.condition)} {`, indent);
      printScope(lr, s.then, indent);
      for (const elseif of s.elseIfs) {
        print(`} else if ${serializeLoweredExpr(lr, elseif.condition)} {`, indent);
        printScope(lr, elseif.then, indent);
      }
      if (s.else) {
        print(`} else {`, indent);
        printScope(lr, s.else, indent);
      }
      print(`}`, indent);
      break;

    case Lowered.ENode.WhileStatement:
      print(`While ${serializeLoweredExpr(lr, s.condition)} {`, indent);
      printScope(lr, s.then, indent);
      print(`}`, indent);
      break;
  }
}

function printScope(lr: Lowered.Module, scopeId: Lowered.BlockScopeId, indent = 0) {
  const scope = lr.blockScopeNodes.get(scopeId);
  for (const s of scope.statements) {
    printStatement(lr, s, indent + 4);
  }
}

function printLoweredFunction(lr: Lowered.Module, fId: Lowered.FunctionId) {
  const f = lr.functionNodes.get(fId);
  if (f.scope) {
    print(f.name.prettyName + "():");
    printScope(lr, f.scope);
    print("\n");
  } else {
    print(f.name.prettyName + "()\n");
  }
}

export function PrettyPrintLowered(lr: Lowered.Module) {
  print("C Declarations:");
  for (const d of lr.cInjections) {
    print("C Decl " + JSON.stringify(d));
  }

  print("Lowered Types:");
  for (const t of [...lr.loweredTypeDefs.values()]) {
    // printLoweredType(lr, t);
  }

  print("Lowered Functions:");
  for (const t of [...lr.loweredFunctions.values()]) {
    printLoweredFunction(lr, t);
  }
}

export function LowerModule(sr: SemanticResult): Lowered.Module {
  const lr: Lowered.Module = {
    sr: sr,

    blockScopeNodes: new BrandedArray<Lowered.BlockScopeId, Lowered.BlockScope>([]),
    exprNodes: new BrandedArray<Lowered.ExprId, Lowered.Expression>([]),
    functionNodes: new BrandedArray<Lowered.FunctionId, Lowered.FunctionSymbol>([]),
    statementNodes: new BrandedArray<Lowered.StatementId, Lowered.Statement>([]),
    typeUseNodes: new BrandedArray<Lowered.TypeUseId, Lowered.TypeUse>([]),
    typeDefNodes: new BrandedArray<Lowered.TypeDefId, Lowered.TypeDef>([]),

    cInjections: [],

    loweredTypeUses: new Map(),
    loweredTypeDefs: new Map(),
    loweredFunctions: new Map(),
    loweredPointers: new Map(),
    loweredGlobalVariables: new Map(),

    loweredUnionMappings: [],
  };

  for (const [key, entries] of sr.elaboratedFuncdefSymbols) {
    for (const entry of entries) {
      lowerSymbol(lr, entry.result);
    }
  }
  for (const [key, entries] of sr.elaboratedStructDatatypes) {
    for (const entry of entries) {
      lowerSymbol(lr, entry.resultAsTypeDefSymbol);
    }
  }
  for (const [key, entries] of sr.elaboratedEnumSymbols) {
    for (const entry of entries) {
      lowerSymbol(lr, entry.resultAsTypeDefSymbol);
    }
  }
  for (const symbol of sr.elaboratedGlobalVariableDefinitions) {
    lowerSymbol(lr, symbol.result);
  }

  for (const primitive of sr.elaboratedPrimitiveTypes) {
    lowerTypeDef(lr, primitive);
  }

  for (const id of sr.cInjections) {
    const injection = sr.symbolNodes.get(id);
    assert(injection.variant === Semantic.ENode.CInjectDirectiveSymbol);
    lr.cInjections.push(injection.value);
  }

  // PrettyPrintLowered(lr);
  // RenderCollectedSymbolTree(lr);

  return lr;
}
