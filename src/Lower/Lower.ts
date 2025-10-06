import { makePrimitiveAvailable, Semantic, type SemanticResult } from "../Semantic/Elaborate";
import {
  makeNullableReferenceDatatypeAvailable,
  makeReferenceDatatypeAvailable,
  makeTypeUse,
} from "../Semantic/LookupDatatype";
import {
  BinaryOperationToString,
  EAssignmentOperation,
  EBinaryOperation,
  EDatatypeMutability,
  EExternLanguage,
  EIncrOperation,
  EUnaryOperation,
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
import { assert, InternalError, type SourceLoc } from "../shared/Errors";
import { makeTempName } from "../shared/store";

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
    NullableReferenceDatatype,
    ReferenceDatatype,
    CallableDatatype,
    PrimitiveDatatype,
    GenericParameterDatatype,
    NamespaceDatatype,
    ArrayDatatype,
    SliceDatatype,
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
    DatatypeAsValueExpr,
    ExplicitCastExpr,
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
    loweredGlobalVariables: Map<Semantic.SymbolId, Lowered.StatementId[]>;
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

  export type DatatypeAsValueExpr = {
    variant: ENode.DatatypeAsValueExpr;
    type: TypeUseId;
  };

  export type ExplicitCastExpr = {
    variant: ENode.ExplicitCastExpr;
    expr: ExprId;
    type: TypeUseId;
  };

  export type ExprMemberAccessExpr = {
    variant: ENode.MemberAccessExpr;
    expr: ExprId;
    memberName: string;
    isReference: boolean;
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
    | DatatypeAsValueExpr
    | ExplicitCastExpr
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
    scope: BlockScopeId | null;
    sourceloc: SourceLoc;
  };

  export type TypeUse = {
    variant: ENode.TypeUse;
    mutability: EDatatypeMutability;
    type: TypeDefId;
    name: NameSet;
    sourceloc: SourceLoc;
  };

  export type TypeDef =
    | StructDatatypeDef
    | CallableDatatypeDef
    | PrimitiveDatatypeDef
    | FunctionDatatypeDef
    | ReferenceDatatypeDef
    | NullableReferenceDatatypeDef
    | ArrayDatatypeDef
    | SliceDatatypeDef;

  export type NullableReferenceDatatypeDef = {
    variant: ENode.NullableReferenceDatatype;
    name: NameSet;
    referee: TypeUseId;
  };

  export type ReferenceDatatypeDef = {
    variant: ENode.ReferenceDatatype;
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
    vararg: boolean;
  };

  export type ArrayDatatypeDef = {
    variant: ENode.ArrayDatatype;
    datatype: TypeUseId;
    name: NameSet;
    length: number;
  };

  export type SliceDatatypeDef = {
    variant: ENode.SliceDatatype;
    datatype: TypeUseId;
    name: NameSet;
  };
}

const storeInTempVarAndGet = (
  lr: Lowered.Module,
  type: Lowered.TypeUseId,
  value: Lowered.ExprId,
  sourceloc: SourceLoc,
  flattened: Lowered.StatementId[]
): [Lowered.Expression, Lowered.ExprId] => {
  const varname = makeTempName();
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

function lowerExpr(
  lr: Lowered.Module,
  exprId: Semantic.ExprId,
  flattened: Lowered.StatementId[]
): [Lowered.Expression, Lowered.ExprId] {
  const expr = lr.sr.exprNodes.get(exprId);

  switch (expr.variant) {
    case Semantic.ENode.ExprCallExpr: {
      const [calledExpr, calledExprId] = lowerExpr(lr, expr.calledExpr, flattened);
      const calledExprType = lr.typeUseNodes.get(calledExpr.type);
      const calledExprTypeDef = lr.typeDefNodes.get(calledExprType.type);
      assert(
        calledExprTypeDef.variant === Lowered.ENode.FunctionDatatype ||
          calledExprTypeDef.variant === Lowered.ENode.CallableDatatype
      );

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
              calledExpr.thisExpr,
              ...expr.arguments.map((a) => lowerExpr(lr, a, flattened)[1]),
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
              isReference: false,
              type: calledExpr.type,
              expr: calledExprId,
            })[1],
            arguments: [
              Lowered.addExpr(lr, {
                variant: Lowered.ENode.MemberAccessExpr,
                expr: calledExprId,
                isReference: false,
                memberName: "thisPtr",
                type: lr.exprNodes.get(thisExprId).type,
              })[1],
              ...expr.arguments.map((a) => lowerExpr(lr, a, flattened)[1]),
            ],
            type: type,
          });
          return [callExpr, callExprId];
        }
      } else {
        const [exprCall, exprCallId] = Lowered.addExpr<Lowered.ExprCallExpr>(lr, {
          variant: Lowered.ENode.ExprCallExpr,
          expr: calledExprId,
          arguments: expr.arguments.map((a) => lowerExpr(lr, a, flattened)[1]),
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
        left: lowerExpr(lr, expr.left, flattened)[1],
        right: lowerExpr(lr, expr.right, flattened)[1],
        operation: expr.operation,
        type: typeId,
        plainResultType: type.type,
      });
    }

    case Semantic.ENode.UnaryExpr: {
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.UnaryExpr,
        expr: lowerExpr(lr, expr.expr, flattened)[1],
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
          type: lowerTypeUse(
            lr,
            makeTypeUse(lr.sr, symbol.type, EDatatypeMutability.Const, expr.sourceloc)[1]
          ),
        });
      }
    }

    case Semantic.ENode.AddressOfExpr: {
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.AddressOfExpr,
        expr: lowerExpr(lr, expr.expr, flattened)[1],
        type: lowerTypeUse(lr, expr.type),
      });
    }

    case Semantic.ENode.DereferenceExpr: {
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.DereferenceExpr,
        expr: lowerExpr(lr, expr.expr, flattened)[1],
        type: lowerTypeUse(lr, expr.type),
      });
    }

    case Semantic.ENode.ExplicitCastExpr: {
      const [loweredExpr, loweredExprId] = lowerExpr(lr, expr.expr, flattened);
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
        targetTypeDef.variant === Lowered.ENode.ReferenceDatatype &&
        loweredExpr.type === targetTypeDef.referee
      ) {
        return Lowered.addExpr(lr, {
          variant: Lowered.ENode.AddressOfExpr,
          expr: loweredExprId,
          type: targetTypeId,
        });
      }

      if (
        exprTypeDef.variant === Lowered.ENode.ReferenceDatatype &&
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
      const accessedExprType = lr.sr.typeDefNodes.get(
        lr.sr.typeUseNodes.get(accessedExpr.type).type
      );
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.MemberAccessExpr,
        expr: lowerExpr(lr, expr.expr, flattened)[1],
        isReference:
          accessedExprType.variant === Semantic.ENode.ReferenceDatatype ||
          accessedExprType.variant === Semantic.ENode.NullableReferenceDatatype,
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
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.StructInstantiationExpr,
        type: structType,
        memberAssigns: expr.assign.map((a) => ({
          name: a.name,
          value: lowerExpr(lr, a.value, flattened)[1],
        })),
      });
    }

    case Semantic.ENode.PostIncrExpr: {
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.PostIncrExpr,
        expr: lowerExpr(lr, expr.expr, flattened)[1],
        operation: expr.operation,
        type: lowerTypeUse(lr, expr.type),
      });
    }

    case Semantic.ENode.PreIncrExpr: {
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.PreIncrExpr,
        expr: lowerExpr(lr, expr.expr, flattened)[1],
        operation: expr.operation,
        type: lowerTypeUse(lr, expr.type),
      });
    }

    case Semantic.ENode.ArrayLiteralExpr: {
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.ArrayLiteralExpr,
        values: expr.values.map((v) => lowerExpr(lr, v, flattened)[1]),
        type: lowerTypeUse(lr, expr.type),
      });
    }

    case Semantic.ENode.ArraySubscriptExpr: {
      assert(expr.indices.length === 1);
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.ArraySubscriptExpr,
        expr: lowerExpr(lr, expr.expr, flattened)[1],
        index: lowerExpr(lr, expr.indices[0], flattened)[1],
        type: lowerTypeUse(lr, expr.type),
      });
    }

    case Semantic.ENode.ArraySliceExpr: {
      assert(expr.indices.length === 1);
      const arrayId = lowerExpr(lr, expr.expr, flattened)[1];
      const semanticArray = lr.sr.exprNodes.get(expr.expr);
      const arrayType = lr.sr.typeDefNodes.get(lr.sr.typeUseNodes.get(semanticArray.type).type);
      assert(arrayType.variant === Semantic.ENode.ArrayDatatype);

      const startIndex = expr.indices[0].start
        ? lowerExpr(lr, expr.indices[0].start, flattened)[1]
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
        ? lowerExpr(lr, expr.indices[0].end, flattened)[1]
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
      const thisExprType = lr.sr.typeDefNodes.get(lr.sr.typeUseNodes.get(thisExpr.type).type);

      let loweredThisExpression = lowerExpr(lr, expr.thisExpr, flattened)[1];
      if (thisExprType.variant !== Semantic.ENode.ReferenceDatatype) {
        assert(thisExprType.variant === Semantic.ENode.StructDatatype);
        const structReferenceType = lowerTypeUse(
          lr,
          makeReferenceDatatypeAvailable(
            lr.sr,
            thisExpr.type,
            EDatatypeMutability.Const,
            expr.sourceloc
          )
        );
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
        loweredThisExpression = Lowered.addExpr(lr, {
          variant: Lowered.ENode.AddressOfExpr,
          expr: tempId,
          type: structReferenceType,
        })[1];
      }
      const functionSymbol = lr.sr.symbolNodes.get(expr.functionSymbol);
      assert(functionSymbol.variant === Semantic.ENode.FunctionSymbol);
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.CallableExpr,
        functionName: Semantic.makeNameSetSymbol(lr.sr, expr.functionSymbol),
        thisExpr: loweredThisExpression,
        type: lowerTypeUse(lr, expr.type),
        functionType: lowerTypeUse(
          lr,
          makeTypeUse(lr.sr, functionSymbol.type, EDatatypeMutability.Const, expr.sourceloc)[1]
        ),
      });
    }

    case Semantic.ENode.ExprAssignmentExpr: {
      const loweredTarget = lowerExpr(lr, expr.target, flattened)[1];
      const loweredValue = lowerExpr(lr, expr.value, flattened)[1];
      if (expr.operation === EAssignmentOperation.Assign) {
        return Lowered.addExpr(lr, {
          variant: Lowered.ENode.ExprAssignmentExpr,
          target: loweredTarget,
          value: loweredValue,
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
          type: lowerTypeUse(lr, expr.type),
        });
      } else {
        assert(false);
      }
    }

    case Semantic.ENode.SizeofExpr: {
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.SizeofExpr,
        value: lowerExpr(lr, expr.valueExpr, flattened)[1],
        type: lowerTypeUse(lr, expr.type),
      });
    }

    case Semantic.ENode.BlockScopeExpr: {
      return Lowered.addExpr<Lowered.BlockScopeExpr>(lr, {
        variant: Lowered.ENode.BlockScopeExpr,
        block: lowerBlockScope(lr, expr.block),
        type: lowerTypeUse(lr, expr.type),
        sourceloc: expr.sourceloc,
      });
    }

    case Semantic.ENode.RefAssignmentExpr: {
      const [ref, refId] = lowerExpr(lr, expr.target, flattened);
      const target = lr.sr.exprNodes.get(expr.target);
      const targetType = lr.sr.typeDefNodes.get(lr.sr.typeUseNodes.get(target.type).type);
      assert(targetType.variant === Semantic.ENode.ReferenceDatatype);

      const [value, valueId] = lowerExpr(lr, expr.value, flattened);
      const valueType = lr.typeUseNodes.get(value.type);
      const semanticValue = lr.sr.exprNodes.get(expr.value);
      if (expr.operation === "assign") {
        assert(semanticValue.type === targetType.referee);
        return Lowered.addExpr(lr, {
          variant: Lowered.ENode.ExprAssignmentExpr,
          type: lowerTypeUse(lr, expr.type),
          target: Lowered.addExpr(lr, {
            variant: Lowered.ENode.DereferenceExpr,
            expr: refId,
            type: lowerTypeUse(
              lr,
              makeNullableReferenceDatatypeAvailable(
                lr.sr,
                targetType.referee,
                EDatatypeMutability.Const,
                expr.sourceloc
              )
            ),
          })[1],
          value: valueId,
        });
      } else {
        assert(semanticValue.type === target.type);
        return Lowered.addExpr(lr, {
          variant: Lowered.ENode.ExprAssignmentExpr,
          type: lowerTypeUse(lr, expr.type),
          target: refId,
          value: valueId,
        });
      }
    }

    case Semantic.ENode.StringConstructExpr: {
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.StringConstructExpr,
        type: lowerTypeUse(lr, expr.type),
        value: {
          data: lowerExpr(lr, expr.value.data, flattened)[1],
          length: lowerExpr(lr, expr.value.length, flattened)[1],
        },
      });
    }

    case Semantic.ENode.DatatypeAsValueExpr: {
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.DatatypeAsValueExpr,
        type: lowerTypeUse(lr, expr.type),
      });
    }

    default:
      assert(false, "All cases handled");
  }
}

function lowerTypeDef(lr: Lowered.Module, typeId: Semantic.TypeDefId): Lowered.TypeDefId {
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
        name: Semantic.makeNameSetTypeDef(lr.sr, typeId),
        vararg: type.vararg,
      });
      lr.loweredTypeDefs.set(typeId, pId);
      return pId;
    }
  } else if (type.variant === Semantic.ENode.NullableReferenceDatatype) {
    if (lr.loweredTypeDefs.has(typeId)) {
      return lr.loweredTypeDefs.get(typeId)!;
    } else {
      const [p, pId] = Lowered.addTypeDef<Lowered.NullableReferenceDatatypeDef>(lr, {
        variant: Lowered.ENode.NullableReferenceDatatype,
        referee: lowerTypeUse(lr, type.referee),
        name: Semantic.makeNameSetTypeDef(lr.sr, typeId),
      });
      lr.loweredTypeDefs.set(typeId, pId);
      return pId;
    }
  } else if (type.variant === Semantic.ENode.ReferenceDatatype) {
    if (lr.loweredTypeDefs.has(typeId)) {
      return lr.loweredTypeDefs.get(typeId)!;
    } else {
      const [p, pId] = Lowered.addTypeDef<Lowered.ReferenceDatatypeDef>(lr, {
        variant: Lowered.ENode.ReferenceDatatype,
        referee: lowerTypeUse(lr, type.referee),
        name: Semantic.makeNameSetTypeDef(lr.sr, typeId),
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
  } else if (type.variant === Semantic.ENode.ArrayDatatype) {
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
  } else if (type.variant === Semantic.ENode.SliceDatatype) {
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
  } else if (type.variant === Semantic.ENode.ParameterPackDatatype) {
    assert(false, "A Parameter Pack cannot be lowered");
  } else {
    throw new InternalError("Unhandled variant: " + type.variant);
  }
}

function lowerTypeUse(lr: Lowered.Module, typeId: Semantic.TypeUseId): Lowered.TypeUseId {
  const typeUse = lr.sr.typeUseNodes.get(typeId);
  if (lr.loweredTypeUses.has(typeId)) {
    return lr.loweredTypeUses.get(typeId)!;
  }

  const id = Lowered.addTypeUse(lr, {
    variant: Lowered.ENode.TypeUse,
    mutability: typeUse.mutability,
    name: Semantic.makeNameSetTypeUse(lr.sr, typeId),
    sourceloc: typeUse.sourceloc,
    type: lowerTypeDef(lr, typeUse.type),
  })[1];
  lr.loweredTypeUses.set(typeId, id);
  return id;
}

function lowerStatement(
  lr: Lowered.Module,
  statementId: Semantic.StatementId
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
        value: statement.value && lowerExpr(lr, statement.value, flattened)[1],
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
        condition: lowerExpr(lr, statement.condition, flattened)[1],
        then: lowerBlockScope(lr, statement.then),
        elseIfs: statement.elseIfs.map((e) => {
          return {
            condition: lowerExpr(lr, e.condition, flattened)[1],
            then: lowerBlockScope(lr, e.then),
          };
        }),
        else: statement.else && lowerBlockScope(lr, statement.else),
        sourceloc: statement.sourceloc,
      });
      return [...flattened, sId];
    }

    case Semantic.ENode.WhileStatement: {
      const flattened: Lowered.StatementId[] = [];
      const [s, sId] = Lowered.addStatement<Lowered.Statement>(lr, {
        variant: Lowered.ENode.WhileStatement,
        condition: lowerExpr(lr, statement.condition, flattened)[1],
        then: lowerBlockScope(lr, statement.then),
        sourceloc: statement.sourceloc,
      });
      return [...flattened, sId];
    }

    case Semantic.ENode.ExprStatement: {
      const flattened: Lowered.StatementId[] = [];
      const [s, sId] = Lowered.addStatement<Lowered.Statement>(lr, {
        variant: Lowered.ENode.ExprStatement,
        expr: lowerExpr(lr, statement.expr, flattened)[1],
        sourceloc: statement.sourceloc,
      });
      return [...flattened, sId];
    }

    case Semantic.ENode.ReturnStatement: {
      const flattened: Lowered.StatementId[] = [];
      let value = statement.expr ? lowerExpr(lr, statement.expr, flattened)[1] : null;

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
  semanticScopeId: Semantic.BlockScopeId
): Lowered.BlockScopeId {
  const blockScope = lr.sr.blockScopeNodes.get(semanticScopeId);
  assert(blockScope.variant === Semantic.ENode.BlockScope);

  let containsVariables = false;
  const statements: Lowered.StatementId[] = [];

  for (const s of blockScope.statements) {
    const statement = lr.sr.statementNodes.get(s);
    if (statement.variant === Semantic.ENode.VariableStatement) {
      containsVariables = true;
    }

    statements.push(...lowerStatement(lr, s));
  }

  const emitted = blockScope.emittedExpr
    ? lowerExpr(lr, blockScope.emittedExpr, statements)[1]
    : null;

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

      const monomorphized = Semantic.isSymbolMonomorphized(lr.sr, symbolId);
      const exported = Semantic.isSymbolExported(lr.sr, symbolId);

      // Normal function
      const [f, fId] = Lowered.addFunction<Lowered.FunctionSymbol>(lr, {
        variant: Lowered.ENode.FunctionSymbol,
        name: Semantic.makeNameSetSymbol(lr.sr, symbolId),
        parameterNames: parameterNames,
        type: lowerTypeDef(lr, symbol.type),
        isLibraryLocal:
          monomorphized &&
          !exported &&
          symbol.extern !== EExternLanguage.Extern_C &&
          symbol.scope !== null,
        scope: null,
        sourceloc: symbol.sourceloc,
        externLanguage: symbol.extern,
      });
      lr.loweredFunctions.set(symbolId, fId);

      f.scope = (symbol.scope && lowerBlockScope(lr, symbol.scope)) || null;
      break;
    }

    case Semantic.ENode.TypeDefSymbol: {
      const datatypeId = symbol.datatype;
      const datatype = lr.sr.typeDefNodes.get(datatypeId);

      switch (datatype.variant) {
        case Semantic.ENode.StructDatatype: {
          if (datatype.noemit) {
            return undefined;
          }
          lowerTypeDef(lr, datatypeId);
          break;
        }

        case Semantic.ENode.PrimitiveDatatype:
        case Semantic.ENode.FunctionDatatype:
        case Semantic.ENode.NullableReferenceDatatype:
        case Semantic.ENode.CallableDatatype:
        case Semantic.ENode.ReferenceDatatype: {
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
        value: symbol.value && lowerExpr(lr, symbol.value, flattened)[1],
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
      } else if (expr.literal.type === EPrimitive.c_str) {
        return `${JSON.stringify(expr.literal.value)}`;
      } else if (expr.literal.type === EPrimitive.null) {
        return `null`;
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
  }
}

export function printStatement(lr: Lowered.Module, sId: Lowered.StatementId, indent = 0) {
  const s = lr.statementNodes.get(sId);

  switch (s.variant) {
    case Lowered.ENode.ExprStatement:
      print(serializeLoweredExpr(lr, s.expr) + ";", indent);
      break;

    case Lowered.ENode.InlineCStatement:
      print("Inline C " + JSON.stringify(s.value), indent);
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
    printStatement(lr, s, indent + 2);
  }
}

function printLoweredFunction(lr: Lowered.Module, fId: Lowered.FunctionId) {
  const f = lr.functionNodes.get(fId);
  if (f.scope) {
    print("Function " + f.name.prettyName + ":");
    printScope(lr, f.scope);
  } else {
    print("Function " + f.name.prettyName);
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
    loweredGlobalVariables: new Map(),
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
