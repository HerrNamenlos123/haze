import {
  makePointerDatatypeAvailable,
  makeReferenceDatatypeAvailable,
} from "../Semantic/LookupDatatype";
import {
  asExpression,
  asType,
  isExpression,
  isType,
  Semantic,
  type SemanticResult,
} from "../Semantic/SemanticSymbols";
import {
  mangleDatatype,
  mangleNestedName,
  serializeDatatype,
  serializeExpr,
  serializeNestedName,
} from "../Semantic/Serialize";
import {
  BinaryOperationToString,
  EAssignmentOperation,
  EBinaryOperation,
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
} from "../shared/common";
import { assert, ImpossibleSituation, InternalError, type SourceLoc } from "../shared/Errors";
import { makeTempName } from "../shared/store";

export namespace Lowered {
  export type FunctionId = Brand<number, "LoweredFunction">;
  export type TypeId = Brand<number, "LoweredType">;
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
    ReferenceDatatype,
    CallableDatatype,
    PrimitiveDatatype,
    GenericParameterDatatype,
    NamespaceDatatype,
    LiteralValueDatatype,
    ArrayDatatype,
    SliceDatatype,
    // Statements
    InlineCStatement,
    WhileStatement,
    IfStatement,
    VariableStatement,
    ExprStatement,
    BlockScopeStatement,
    BlockStatement,
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
    PointerAddressOfExpr,
    PointerDereferenceExpr,
    ExprAssignmentExpr,
    StructInstantiationExpr,
    PreIncrExpr,
    PostIncrExpr,
    ArrayLiteralExpr,
    ArraySubscriptExpr,
    // Dummy
    Dummy,
  }

  export type Module = {
    sr: SemanticResult;

    functionNodes: BrandedArray<Lowered.FunctionId, Lowered.FunctionSymbol>;
    typeNodes: BrandedArray<Lowered.TypeId, Lowered.Datatype>;
    exprNodes: BrandedArray<Lowered.ExprId, Lowered.Expression>;
    statementNodes: BrandedArray<Lowered.StatementId, Lowered.Statement>;
    blockScopeNodes: BrandedArray<Lowered.BlockScopeId, Lowered.BlockScope>;
    cInjections: string[];

    loweredTypes: Map<Semantic.Id, Lowered.TypeId>;
    loweredFunctions: Map<Semantic.Id, Lowered.FunctionId>;
    loweredGlobalVariables: Map<Semantic.Id, Lowered.StatementId[]>;

    // This is used only during code generation (ugly i know :P)
    sortedLoweredTypes: Lowered.Datatype[];
  };

  export function addType<T extends Lowered.Datatype>(
    lr: Lowered.Module,
    n: T
  ): [T, Lowered.TypeId] {
    if (lr.typeNodes.length === 0) {
      // Push a dummy because it causes issues when the id is zero, so zero is not a valid id.
      lr.typeNodes.push({ variant: Semantic.ENode.Dummy } as any);
    }
    const id = lr.typeNodes.length as Lowered.TypeId;
    lr.typeNodes.push(n);
    return [n, id];
  }

  export function addBlockScope<T extends Lowered.BlockScope>(
    lr: Lowered.Module,
    n: T
  ): [T, Lowered.BlockScopeId] {
    if (lr.blockScopeNodes.length === 0) {
      // Push a dummy because it causes issues when the id is zero, so zero is not a valid id.
      lr.blockScopeNodes.push({ variant: Semantic.ENode.Dummy } as any);
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
      lr.exprNodes.push({ variant: Semantic.ENode.Dummy } as any);
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
      lr.statementNodes.push({ variant: Semantic.ENode.Dummy } as any);
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
      lr.functionNodes.push({ variant: Semantic.ENode.Dummy } as any);
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
    type: TypeId;
  };

  export type UnaryExpr = {
    variant: ENode.UnaryExpr;
    expr: ExprId;
    operation: EUnaryOperation;
    type: TypeId;
  };

  export type ExprCallExpr = {
    variant: ENode.ExprCallExpr;
    expr: ExprId;
    arguments: ExprId[];
    type: TypeId;
  };

  export type CallableExpr = {
    variant: ENode.CallableExpr;
    thisExpr: ExprId;
    functionPrettyName: string;
    functionMangledName: string;
    functionType: TypeId;
    wasMangled: boolean;
    type: TypeId;
  };

  export type PointerDereferenceExpr = {
    variant: ENode.PointerDereferenceExpr;
    expr: ExprId;
    type: TypeId;
  };

  export type PointerAddressOfExpr = {
    variant: ENode.PointerAddressOfExpr;
    expr: ExprId;
    type: TypeId;
  };

  export type SizeofExpr = {
    variant: ENode.SizeofExpr;
    value: ExprId;
    type: TypeId;
  };

  export type DatatypeAsValueExpr = {
    variant: ENode.DatatypeAsValueExpr;
    type: TypeId;
  };

  export type ExplicitCastExpr = {
    variant: ENode.ExplicitCastExpr;
    expr: ExprId;
    type: TypeId;
  };

  export type ExprMemberAccessExpr = {
    variant: ENode.MemberAccessExpr;
    expr: ExprId;
    memberName: string;
    isReference: boolean;
    type: TypeId;
  };

  export type LiteralExpr = {
    variant: ENode.LiteralExpr;
    literal: LiteralValue;
    type: TypeId;
  };

  export type SymbolValueExpr = {
    variant: ENode.SymbolValueExpr;
    prettyName: string;
    mangledName: string;
    wasMangled: boolean;
    type: TypeId;
  };

  export type PostIncrExpr = {
    variant: ENode.PostIncrExpr;
    expr: ExprId;
    operation: EIncrOperation;
    type: TypeId;
  };

  export type ExprAssignmentExpr = {
    variant: ENode.ExprAssignmentExpr;
    value: ExprId;
    target: ExprId;
    type: TypeId;
  };

  export type PreIncrExpr = {
    variant: ENode.PreIncrExpr;
    expr: ExprId;
    operation: EIncrOperation;
    type: TypeId;
  };

  export type StructInstantiationExpr = {
    variant: ENode.StructInstantiationExpr;
    type: TypeId;
    memberAssigns: {
      name: string;
      value: ExprId;
    }[];
  };

  export type ArrayLiteralExpr = {
    variant: ENode.ArrayLiteralExpr;
    values: ExprId[];
    type: TypeId;
  };

  export type ArraySubscriptExpr = {
    variant: ENode.ArraySubscriptExpr;
    expr: ExprId;
    index: ExprId;
    type: TypeId;
  };

  export type Expression =
    | ExprCallExpr
    | BinaryExpr
    | UnaryExpr
    | CallableExpr
    | StructInstantiationExpr
    | ExprAssignmentExpr
    | PointerDereferenceExpr
    | PointerAddressOfExpr
    | SizeofExpr
    | DatatypeAsValueExpr
    | ExplicitCastExpr
    | ExprMemberAccessExpr
    | LiteralExpr
    | PreIncrExpr
    | PostIncrExpr
    | ArrayLiteralExpr
    | ArraySubscriptExpr
    | SymbolValueExpr;

  export type BlockScope = {
    statements: StatementId[];
    definesVariables: boolean;
  };

  export type Statement =
    | InlineCStatement
    | ReturnStatement
    | VariableStatement
    | IfStatement
    | WhileStatement
    | BlockScopeStatement
    | ExprStatement;

  export type InlineCStatement = {
    variant: ENode.InlineCStatement;
    value: string;
    sourceloc: SourceLoc;
  };

  export type VariableStatement = {
    variant: ENode.VariableStatement;
    prettyName: string;
    mangledName: string;
    wasMangled: boolean;
    type: TypeId;
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

  export type BlockScopeStatement = {
    variant: ENode.BlockScopeStatement;
    block: BlockScopeId;
    sourceloc: SourceLoc;
  };

  export type ExprStatement = {
    variant: ENode.ExprStatement;
    expr: ExprId;
    sourceloc: SourceLoc;
  };

  export type FunctionSymbol = {
    variant: ENode.FunctionSymbol;
    prettyName: string;
    mangledName: string;
    wasMangled: boolean;
    type: TypeId;
    wasMonomorphized: boolean;
    parameterNames: string[];
    externLanguage: EExternLanguage;
    scope: BlockScopeId | null;
    sourceloc: SourceLoc;
  };

  export type Datatype =
    | StructDatatype
    | CallableDatatype
    | PrimitiveDatatype
    | FunctionDatatype
    | ReferenceDatatype
    | PointerDatatype
    | ArrayDatatype
    | SliceDatatype
    | LiteralValueDatatype;

  export type PointerDatatype = {
    variant: ENode.PointerDatatype;
    prettyName: string;
    mangledName: string;
    wasMangled: boolean;
    pointee: TypeId;
  };

  export type ReferenceDatatype = {
    variant: ENode.ReferenceDatatype;
    prettyName: string;
    mangledName: string;
    wasMangled: boolean;
    referee: TypeId;
  };

  export type CallableDatatype = {
    variant: ENode.CallableDatatype;
    prettyName: string;
    mangledName: string;
    wasMangled: boolean;
    thisExprType: TypeId | null;
    functionType: TypeId;
  };

  export type PrimitiveDatatype = {
    variant: ENode.PrimitiveDatatype;
    prettyName: string;
    mangledName: string;
    wasMangled: boolean;
    primitive: EPrimitive;
  };

  export type StructDatatype = {
    variant: ENode.StructDatatype;
    noemit: boolean;
    prettyName: string;
    mangledName: string;
    wasMangled: boolean;
    generics: TypeId[];
    members: {
      name: string;
      type: TypeId;
    }[];
  };

  export type FunctionDatatype = {
    variant: ENode.FunctionDatatype;
    prettyName: string;
    mangledName: string;
    wasMangled: boolean;
    parameters: TypeId[];
    returnType: TypeId;
    vararg: boolean;
  };

  export type LiteralValueDatatype = {
    variant: ENode.LiteralValueDatatype;
    prettyName: string;
    mangledName: string;
    wasMangled: boolean;
    literal: LiteralValue;
  };

  export type ArrayDatatype = {
    variant: ENode.ArrayDatatype;
    datatype: TypeId;
    prettyName: string;
    mangledName: string;
    wasMangled: boolean;
    length: number;
  };

  export type SliceDatatype = {
    variant: ENode.SliceDatatype;
    datatype: TypeId;
    prettyName: string;
    mangledName: string;
    wasMangled: boolean;
  };
}

const storeInTempVarAndGet = (
  lr: Lowered.Module,
  type: Lowered.TypeId,
  value: Lowered.ExprId,
  sourceloc: SourceLoc,
  flattened: Lowered.StatementId[]
): [Lowered.Expression, Lowered.ExprId] => {
  const varname = makeTempName();
  flattened.push(
    Lowered.addStatement(lr, {
      variant: Lowered.ENode.VariableStatement,
      prettyName: varname,
      mangledName: varname,
      wasMangled: false,
      type: type,
      variableContext: EVariableContext.FunctionLocal,
      value: value,
      sourceloc: sourceloc,
    })[1]
  );
  return Lowered.addExpr(lr, {
    variant: Lowered.ENode.SymbolValueExpr,
    prettyName: varname,
    mangledName: varname,
    wasMangled: false,
    type: type,
  });
};

function lowerExpr(
  lr: Lowered.Module,
  exprId: Semantic.Id,
  flattened: Lowered.StatementId[]
): [Lowered.Expression, Lowered.ExprId] {
  const expr = lr.sr.nodes.get(exprId);
  assert(isExpression(expr));

  switch (expr.variant) {
    case Semantic.ENode.ExprCallExpr: {
      const [calledExpr, calledExprId] = lowerExpr(lr, expr.calledExpr, flattened);
      const calledExprType = lr.typeNodes.get(calledExpr.type);
      assert(
        calledExprType.variant === Lowered.ENode.FunctionDatatype ||
          calledExprType.variant === Lowered.ENode.CallableDatatype
      );

      if (calledExprType.variant === Lowered.ENode.CallableDatatype) {
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
          const type = lowerType(lr, expr.type);
          const [callExpr, callExprId] = Lowered.addExpr<Lowered.ExprCallExpr>(lr, {
            variant: Lowered.ENode.ExprCallExpr,
            expr: Lowered.addExpr(lr, {
              variant: Lowered.ENode.SymbolValueExpr,
              mangledName: calledExpr.functionMangledName,
              prettyName: calledExpr.functionPrettyName,
              functionType: calledExpr.functionType,
              type: calledExpr.type,
              wasMangled: calledExpr.wasMangled,
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
          const type = lowerType(lr, expr.type);
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
          type: lowerType(lr, expr.type),
        });
        return [exprCall, exprCallId];
      }
    }

    case Semantic.ENode.BinaryExpr: {
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.BinaryExpr,
        left: lowerExpr(lr, expr.left, flattened)[1],
        right: lowerExpr(lr, expr.right, flattened)[1],
        operation: expr.operation,
        type: lowerType(lr, expr.type),
      });
    }

    case Semantic.ENode.UnaryExpr: {
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.UnaryExpr,
        expr: lowerExpr(lr, expr.expr, flattened)[1],
        operation: expr.operation,
        type: lowerType(lr, expr.type),
      });
    }

    case Semantic.ENode.SymbolValueExpr: {
      const symbol = lr.sr.nodes.get(expr.symbol);
      assert(
        symbol.variant === Semantic.ENode.VariableSymbol ||
          symbol.variant === Semantic.ENode.GlobalVariableDefinitionSymbol ||
          symbol.variant === Semantic.ENode.FunctionSymbol
      );
      if (symbol.variant === Semantic.ENode.VariableSymbol) {
        assert(symbol.type);
        return Lowered.addExpr(lr, {
          variant: Lowered.ENode.SymbolValueExpr,
          prettyName: symbol.name,
          mangledName: symbol.name,
          wasMangled: false,
          type: lowerType(lr, symbol.type),
        });
      } else if (symbol.variant === Semantic.ENode.GlobalVariableDefinitionSymbol) {
        const variableSymbol = lr.sr.nodes.get(symbol.variableSymbol);
        assert(variableSymbol.variant === Semantic.ENode.VariableSymbol);
        assert(variableSymbol.type);
        return Lowered.addExpr(lr, {
          variant: Lowered.ENode.SymbolValueExpr,
          prettyName: symbol.name,
          mangledName: symbol.name,
          wasMangled: false,
          type: lowerType(lr, variableSymbol.type),
        });
      } else {
        lower(lr, expr.symbol);
        return Lowered.addExpr(lr, {
          variant: Lowered.ENode.SymbolValueExpr,
          prettyName: serializeNestedName(lr.sr, expr.symbol),
          mangledName: mangleNestedName(lr.sr, expr.symbol),
          wasMangled: symbol.extern !== EExternLanguage.Extern_C,
          type: lowerType(lr, symbol.type),
        });
      }
    }

    case Semantic.ENode.PointerAddressOfExpr: {
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.PointerAddressOfExpr,
        expr: lowerExpr(lr, expr.expr, flattened)[1],
        type: lowerType(lr, expr.type),
      });
    }

    case Semantic.ENode.PointerDereferenceExpr: {
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.PointerDereferenceExpr,
        expr: lowerExpr(lr, expr.expr, flattened)[1],
        type: lowerType(lr, expr.type),
      });
    }

    case Semantic.ENode.ExplicitCastExpr: {
      const [loweredExpr, loweredExprId] = lowerExpr(lr, expr.expr, flattened);
      const targetTypeId = lowerType(lr, expr.type);
      const exprType = lr.typeNodes.get(loweredExpr.type);
      const targetType = lr.typeNodes.get(targetTypeId);

      if (
        exprType.variant === Lowered.ENode.StructDatatype &&
        targetType.variant === Lowered.ENode.ReferenceDatatype &&
        loweredExpr.type === targetType.referee
      ) {
        return Lowered.addExpr(lr, {
          variant: Lowered.ENode.PointerAddressOfExpr,
          expr: loweredExprId,
          type: targetTypeId,
        });
      }

      if (
        exprType.variant === Lowered.ENode.ReferenceDatatype &&
        targetType.variant === Lowered.ENode.StructDatatype &&
        exprType.referee === targetTypeId
      ) {
        return Lowered.addExpr(lr, {
          variant: Lowered.ENode.PointerDereferenceExpr,
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
      const accessedExpr = lr.sr.nodes.get(expr.expr);
      assert(isExpression(accessedExpr));
      const accessedExprType = lr.sr.nodes.get(accessedExpr.type);
      assert(isType(accessedExprType));
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.MemberAccessExpr,
        expr: lowerExpr(lr, expr.expr, flattened)[1],
        isReference: accessedExprType.variant === Semantic.ENode.ReferenceDatatype,
        memberName: expr.memberName,
        type: lowerType(lr, expr.type),
      });
    }

    case Semantic.ENode.LiteralExpr: {
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.LiteralExpr,
        literal: expr.literal,
        type: lowerType(lr, expr.type),
      });
    }

    case Semantic.ENode.StructInstantiationExpr: {
      const structType = lowerType(lr, expr.type);
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
        type: lowerType(lr, expr.type),
      });
    }

    case Semantic.ENode.PreIncrExpr: {
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.PreIncrExpr,
        expr: lowerExpr(lr, expr.expr, flattened)[1],
        operation: expr.operation,
        type: lowerType(lr, expr.type),
      });
    }

    case Semantic.ENode.ArrayLiteralExpr: {
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.ArrayLiteralExpr,
        values: expr.values.map((v) => lowerExpr(lr, v, flattened)[1]),
        type: lowerType(lr, expr.type),
      });
    }

    case Semantic.ENode.ArraySubscriptExpr: {
      assert(expr.indices.length === 1);
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.ArraySubscriptExpr,
        expr: lowerExpr(lr, expr.expr, flattened)[1],
        index: lowerExpr(lr, expr.indices[0], flattened)[1],
        type: lowerType(lr, expr.type),
      });
    }

    case Semantic.ENode.CallableExpr: {
      lower(lr, expr.functionSymbol);
      const thisExpr = asExpression(lr.sr.nodes.get(expr.thisExpr));
      const thisExprType = asType(lr.sr.nodes.get(thisExpr.type));

      let loweredThisExpression = lowerExpr(lr, expr.thisExpr, flattened)[1];
      if (thisExprType.variant !== Semantic.ENode.ReferenceDatatype) {
        assert(thisExprType.variant === Semantic.ENode.StructDatatype);
        const structReferenceType = lowerType(
          lr,
          makeReferenceDatatypeAvailable(lr.sr, thisExpr.type)
        );
        let tempId = loweredThisExpression;
        if (thisExpr.isTemporary) {
          tempId = storeInTempVarAndGet(
            lr,
            lowerType(lr, thisExpr.type),
            loweredThisExpression,
            expr.sourceloc,
            flattened
          )[1];
        }
        loweredThisExpression = Lowered.addExpr(lr, {
          variant: Lowered.ENode.PointerAddressOfExpr,
          expr: tempId,
          type: structReferenceType,
        })[1];
      }
      const functionSymbol = lr.sr.nodes.get(expr.functionSymbol);
      assert(functionSymbol.variant === Semantic.ENode.FunctionSymbol);
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.CallableExpr,
        functionMangledName: mangleNestedName(lr.sr, expr.functionSymbol),
        functionPrettyName: serializeNestedName(lr.sr, expr.functionSymbol),
        thisExpr: loweredThisExpression,
        type: lowerType(lr, expr.type),
        functionType: lowerType(lr, functionSymbol.type),
        wasMangled: true,
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
          type: lowerType(lr, expr.type),
        });
      } else if (expr.operation === EAssignmentOperation.Add) {
        return Lowered.addExpr(lr, {
          variant: Lowered.ENode.ExprAssignmentExpr,
          target: loweredTarget,
          value: Lowered.addExpr(lr, {
            variant: Lowered.ENode.BinaryExpr,
            left: loweredTarget,
            right: loweredValue,
            operation: EBinaryOperation.Add,
            type: lowerType(lr, expr.type),
          })[1],
          type: lowerType(lr, expr.type),
        });
      } else if (expr.operation === EAssignmentOperation.Subtract) {
        return Lowered.addExpr(lr, {
          variant: Lowered.ENode.ExprAssignmentExpr,
          target: loweredTarget,
          value: Lowered.addExpr(lr, {
            variant: Lowered.ENode.BinaryExpr,
            left: loweredTarget,
            right: loweredValue,
            operation: EBinaryOperation.Subtract,
            type: lowerType(lr, expr.type),
          })[1],
          type: lowerType(lr, expr.type),
        });
      } else if (expr.operation === EAssignmentOperation.Multiply) {
        return Lowered.addExpr(lr, {
          variant: Lowered.ENode.ExprAssignmentExpr,
          target: loweredTarget,
          value: Lowered.addExpr(lr, {
            variant: Lowered.ENode.BinaryExpr,
            left: loweredTarget,
            right: loweredValue,
            operation: EBinaryOperation.Multiply,
            type: lowerType(lr, expr.type),
          })[1],
          type: lowerType(lr, expr.type),
        });
      } else if (expr.operation === EAssignmentOperation.Divide) {
        return Lowered.addExpr(lr, {
          variant: Lowered.ENode.ExprAssignmentExpr,
          target: loweredTarget,
          value: Lowered.addExpr(lr, {
            variant: Lowered.ENode.BinaryExpr,
            left: loweredTarget,
            right: loweredValue,
            operation: EBinaryOperation.Divide,
            type: lowerType(lr, expr.type),
          })[1],
          type: lowerType(lr, expr.type),
        });
      } else if (expr.operation === EAssignmentOperation.Modulo) {
        return Lowered.addExpr(lr, {
          variant: Lowered.ENode.ExprAssignmentExpr,
          target: loweredTarget,
          value: Lowered.addExpr(lr, {
            variant: Lowered.ENode.BinaryExpr,
            left: loweredTarget,
            right: loweredValue,
            operation: EBinaryOperation.Modulo,
            type: lowerType(lr, expr.type),
          })[1],
          type: lowerType(lr, expr.type),
        });
      } else {
        assert(false);
      }
    }

    case Semantic.ENode.SizeofExpr: {
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.SizeofExpr,
        value: lowerExpr(lr, expr.valueExpr, flattened)[1],
        type: lowerType(lr, expr.type),
      });
    }

    case Semantic.ENode.RefAssignmentExpr: {
      const [ref, refId] = lowerExpr(lr, expr.target, flattened);
      const target = asExpression(lr.sr.nodes.get(expr.target));
      const targetType = asType(lr.sr.nodes.get(target.type));
      assert(targetType.variant === Semantic.ENode.ReferenceDatatype);

      const [value, valueId] = lowerExpr(lr, expr.value, flattened);
      const valueType = lr.typeNodes.get(value.type);
      const semanticValue = asExpression(lr.sr.nodes.get(expr.value));
      if (expr.operation === "assign") {
        assert(semanticValue.type === targetType.referee);
        return Lowered.addExpr(lr, {
          variant: Lowered.ENode.ExprAssignmentExpr,
          type: lowerType(lr, expr.type),
          target: Lowered.addExpr(lr, {
            variant: Lowered.ENode.PointerDereferenceExpr,
            expr: refId,
            type: lowerType(lr, makePointerDatatypeAvailable(lr.sr, targetType.referee)),
          })[1],
          value: valueId,
        });
      } else {
        assert(semanticValue.type === target.type);
        return Lowered.addExpr(lr, {
          variant: Lowered.ENode.ExprAssignmentExpr,
          type: lowerType(lr, expr.type),
          target: refId,
          value: valueId,
        });
      }
    }

    case Semantic.ENode.DatatypeAsValueExpr: {
      return Lowered.addExpr(lr, {
        variant: Lowered.ENode.DatatypeAsValueExpr,
        type: lowerType(lr, expr.type),
      });
    }

    default:
      assert(false, "All cases handled");
  }
}

function lowerType(lr: Lowered.Module, typeId: Semantic.Id): Lowered.TypeId {
  const type = lr.sr.nodes.get(typeId);
  assert(isType(type));

  if (type.variant === Semantic.ENode.StructDatatype) {
    if (lr.loweredTypes.has(typeId)) {
      return lr.loweredTypes.get(typeId)!;
    } else {
      let [p, pId] = Lowered.addType<Lowered.StructDatatype>(lr, {
        variant: Lowered.ENode.StructDatatype,
        noemit: type.noemit,
        prettyName: serializeDatatype(lr.sr, typeId),
        mangledName: mangleDatatype(lr.sr, typeId),
        wasMangled: type.extern !== EExternLanguage.Extern_C,
        generics: type.generics.map((id) => lowerType(lr, id)),
        members: [],
      });
      lr.loweredTypes.set(typeId, pId);

      p.members = type.members.map((mId) => {
        const m = lr.sr.nodes.get(mId);
        assert(m.variant === Semantic.ENode.VariableSymbol);
        assert(m.type);
        return {
          name: m.name,
          type: lowerType(lr, m.type),
        };
      });

      return pId;
    }
  } else if (type.variant === Semantic.ENode.PrimitiveDatatype) {
    if (lr.loweredTypes.has(typeId)) {
      return lr.loweredTypes.get(typeId)!;
    } else {
      const [p, pId] = Lowered.addType<Lowered.PrimitiveDatatype>(lr, {
        variant: Lowered.ENode.PrimitiveDatatype,
        primitive: type.primitive,
        mangledName: mangleDatatype(lr.sr, typeId),
        prettyName: serializeDatatype(lr.sr, typeId),
        wasMangled: true,
      });
      lr.loweredTypes.set(typeId, pId);
      return pId;
    }
  } else if (type.variant === Semantic.ENode.FunctionDatatype) {
    if (lr.loweredTypes.has(typeId)) {
      return lr.loweredTypes.get(typeId)!;
    } else {
      const parameters: Lowered.TypeId[] = [];
      for (const p of type.parameters) {
        const pp = lr.sr.nodes.get(p);
        if (pp.variant === Semantic.ENode.ParameterPackDatatypeSymbol) {
          for (const packParam of pp.parameters || []) {
            const sym = lr.sr.nodes.get(packParam);
            assert(sym.variant === Semantic.ENode.VariableSymbol);
            assert(sym.type);
            parameters.push(lowerType(lr, sym.type));
          }
        } else {
          parameters.push(lowerType(lr, p));
        }
      }
      const [p, pId] = Lowered.addType<Lowered.FunctionDatatype>(lr, {
        variant: Lowered.ENode.FunctionDatatype,
        parameters: parameters,
        returnType: lowerType(lr, type.returnType),
        prettyName: serializeDatatype(lr.sr, typeId),
        mangledName: mangleDatatype(lr.sr, typeId),
        wasMangled: true,
        vararg: type.vararg,
      });
      lr.loweredTypes.set(typeId, pId);
      return pId;
    }
  } else if (type.variant === Semantic.ENode.PointerDatatype) {
    if (lr.loweredTypes.has(typeId)) {
      return lr.loweredTypes.get(typeId)!;
    } else {
      const [p, pId] = Lowered.addType<Lowered.PointerDatatype>(lr, {
        variant: Lowered.ENode.PointerDatatype,
        pointee: lowerType(lr, type.pointee),
        mangledName: mangleDatatype(lr.sr, typeId),
        wasMangled: true,
        prettyName: serializeDatatype(lr.sr, typeId),
      });
      lr.loweredTypes.set(typeId, pId);
      return pId;
    }
  } else if (type.variant === Semantic.ENode.ReferenceDatatype) {
    if (lr.loweredTypes.has(typeId)) {
      return lr.loweredTypes.get(typeId)!;
    } else {
      const [p, pId] = Lowered.addType<Lowered.ReferenceDatatype>(lr, {
        variant: Lowered.ENode.ReferenceDatatype,
        referee: lowerType(lr, type.referee),
        mangledName: mangleDatatype(lr.sr, typeId),
        wasMangled: true,
        prettyName: serializeDatatype(lr.sr, typeId),
      });
      lr.loweredTypes.set(typeId, pId);
      return pId;
    }
  } else if (type.variant === Semantic.ENode.CallableDatatype) {
    if (lr.loweredTypes.has(typeId)) {
      return lr.loweredTypes.get(typeId)!;
    } else {
      const ftypeId = lowerType(lr, type.functionType);
      const ftype = lr.typeNodes.get(ftypeId);
      assert(ftype.variant === Lowered.ENode.FunctionDatatype);
      const [p, pId] = Lowered.addType<Lowered.CallableDatatype>(lr, {
        variant: Lowered.ENode.CallableDatatype,
        thisExprType: (type.thisExprType && lowerType(lr, type.thisExprType)) || null,
        functionType: ftypeId,
        mangledName: mangleDatatype(lr.sr, typeId),
        wasMangled: true,
        prettyName: serializeDatatype(lr.sr, typeId),
      });
      lr.loweredTypes.set(typeId, pId);
      return pId;
    }
  } else if (type.variant === Semantic.ENode.LiteralValueDatatype) {
    if (lr.loweredTypes.has(typeId)) {
      return lr.loweredTypes.get(typeId)!;
    } else {
      const [p, pId] = Lowered.addType<Lowered.LiteralValueDatatype>(lr, {
        variant: Lowered.ENode.LiteralValueDatatype,
        mangledName: mangleDatatype(lr.sr, typeId),
        wasMangled: true,
        prettyName: serializeDatatype(lr.sr, typeId),
        literal: type.literal,
      });
      lr.loweredTypes.set(typeId, pId);
      return pId;
    }
  } else if (type.variant === Semantic.ENode.ArrayDatatype) {
    if (lr.loweredTypes.has(typeId)) {
      return lr.loweredTypes.get(typeId)!;
    } else {
      const [p, pId] = Lowered.addType<Lowered.ArrayDatatype>(lr, {
        variant: Lowered.ENode.ArrayDatatype,
        datatype: lowerType(lr, type.datatype),
        mangledName: mangleDatatype(lr.sr, typeId),
        wasMangled: true,
        prettyName: serializeDatatype(lr.sr, typeId),
        length: type.length,
      });
      lr.loweredTypes.set(typeId, pId);
      return pId;
    }
  } else if (type.variant === Semantic.ENode.SliceDatatype) {
    if (lr.loweredTypes.has(typeId)) {
      return lr.loweredTypes.get(typeId)!;
    } else {
      const [p, pId] = Lowered.addType<Lowered.SliceDatatype>(lr, {
        variant: Lowered.ENode.SliceDatatype,
        datatype: lowerType(lr, type.datatype),
        mangledName: mangleDatatype(lr.sr, typeId),
        wasMangled: true,
        prettyName: serializeDatatype(lr.sr, typeId),
      });
      lr.loweredTypes.set(typeId, pId);
      return pId;
    }
  } else if (type.variant === Semantic.ENode.ParameterPackDatatypeSymbol) {
    assert(false, "A Parameter Pack cannot be lowered");
  } else {
    throw new InternalError("Unhandled variant: " + type.variant);
  }
}

function lowerStatement(lr: Lowered.Module, statementId: Semantic.Id): Lowered.StatementId[] {
  const statement = lr.sr.nodes.get(statementId);
  switch (statement.variant) {
    case Semantic.ENode.VariableStatement: {
      const flattened: Lowered.StatementId[] = [];
      const variableSymbol = lr.sr.nodes.get(statement.variableSymbol);
      assert(variableSymbol.variant === Semantic.ENode.VariableSymbol);
      assert(variableSymbol.type);
      const [s, sId] = Lowered.addStatement<Lowered.Statement>(lr, {
        variant: Lowered.ENode.VariableStatement,
        mangledName: statement.name,
        prettyName: statement.name,
        wasMangled: false,
        type: lowerType(lr, variableSymbol.type),
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

    case Semantic.ENode.BlockScopeStatement: {
      return [
        Lowered.addStatement<Lowered.BlockScopeStatement>(lr, {
          variant: Lowered.ENode.BlockScopeStatement,
          block: lowerBlockScope(lr, statement.block),
          sourceloc: statement.sourceloc,
        })[1],
      ];
    }

    default:
      throw new InternalError("Unhandled case: ");
  }
}

function lowerBlockScope(lr: Lowered.Module, semanticScopeId: Semantic.Id): Lowered.BlockScopeId {
  const blockScope = lr.sr.nodes.get(semanticScopeId);
  assert(blockScope.variant === Semantic.ENode.BlockScope);

  let containsVariables = false;
  const statements: Lowered.StatementId[] = [];

  for (const s of blockScope.statements) {
    const statement = lr.sr.nodes.get(s);
    if (statement.variant === Semantic.ENode.VariableStatement) {
      containsVariables = true;
    }

    statements.push(...lowerStatement(lr, s));
  }

  // Flatten block scopes that don't define variables to remove redundant scopes and make code more readable
  const flattenedStatements: Lowered.StatementId[] = [];
  for (const s of statements) {
    const statement = lr.statementNodes.get(s);
    if (statement.variant === Lowered.ENode.BlockScopeStatement) {
      const blockScope = lr.blockScopeNodes.get(statement.block);
      if (!blockScope.definesVariables) {
        flattenedStatements.push(...blockScope.statements);
        continue;
      }
    }
    flattenedStatements.push(s);
  }

  const [scope, scopeId] = Lowered.addBlockScope<Lowered.BlockScope>(lr, {
    statements: flattenedStatements,
    definesVariables: containsVariables,
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

function lower(lr: Lowered.Module, symbolId: Semantic.Id) {
  const symbol = lr.sr.nodes.get(symbolId);

  switch (symbol.variant) {
    case Semantic.ENode.FunctionSymbol: {
      if (lr.loweredFunctions.has(symbolId)) {
        return lr.loweredFunctions.get(symbolId)!;
      }
      if (symbol.noemit) {
        return;
      }

      const parameterNames: string[] = [...symbol.parameterNames];
      const functype = lr.sr.nodes.get(symbol.type);
      assert(functype.variant === Semantic.ENode.FunctionDatatype);
      const paramPackId = functype.parameters.find((p) => {
        const pp = lr.sr.nodes.get(p);
        return pp.variant === Semantic.ENode.ParameterPackDatatypeSymbol;
      });
      if (paramPackId) {
        const paramPack = lr.sr.nodes.get(paramPackId);
        assert(paramPack.variant === Semantic.ENode.ParameterPackDatatypeSymbol);
        parameterNames.pop();
        for (const p of paramPack.parameters || []) {
          const pp = lr.sr.nodes.get(p);
          assert(pp.variant === Semantic.ENode.VariableSymbol);
          parameterNames.push(pp.name);
        }
      }

      // Normal function
      const ftype = lowerType(lr, symbol.type);
      const [f, fId] = Lowered.addFunction<Lowered.FunctionSymbol>(lr, {
        variant: Lowered.ENode.FunctionSymbol,
        prettyName: serializeNestedName(lr.sr, symbolId),
        mangledName: mangleNestedName(lr.sr, symbolId),
        parameterNames: parameterNames,
        wasMangled: symbol.extern !== EExternLanguage.Extern_C,
        type: ftype,
        wasMonomorphized: symbol.isMonomorphized,
        scope: null,
        sourceloc: symbol.sourceloc,
        externLanguage: symbol.extern,
      });
      lr.loweredFunctions.set(symbolId, fId);

      f.scope = (symbol.scope && lowerBlockScope(lr, symbol.scope)) || null;
      break;
    }

    case Semantic.ENode.StructDatatype: {
      if (symbol.noemit) {
        return undefined;
      }
      for (const gId of symbol.generics) {
        const g = lr.sr.nodes.get(gId);
        if (g.variant === Semantic.ENode.GenericParameterDatatype) {
          return undefined;
        }
      }
      lr.loweredTypes.set(symbolId, lowerType(lr, symbolId));
      break;
    }

    case Semantic.ENode.PrimitiveDatatype:
    case Semantic.ENode.FunctionDatatype:
    case Semantic.ENode.PointerDatatype:
    case Semantic.ENode.CallableDatatype:
    case Semantic.ENode.ReferenceDatatype: {
      lr.loweredTypes.set(symbolId, lowerType(lr, symbolId));
      break;
    }

    case Semantic.ENode.VariableSymbol: {
      if (symbol.variableContext !== EVariableContext.Global) {
        return undefined;
      }
      assert(false, "not implemented");
    }

    case Semantic.ENode.NamespaceDatatype: {
      for (const s of symbol.symbols) {
        lower(lr, s);
      }
      break;
    }

    case Semantic.ENode.GlobalVariableDefinitionSymbol: {
      const variableSymbol = lr.sr.nodes.get(symbol.variableSymbol);
      assert(variableSymbol.variant === Semantic.ENode.VariableSymbol);
      assert(variableSymbol.type);
      const flattened: Lowered.StatementId[] = [];
      const [p, pId] = Lowered.addStatement<Lowered.VariableStatement>(lr, {
        variant: Lowered.ENode.VariableStatement,
        mangledName: mangleNestedName(lr.sr, symbolId),
        prettyName: serializeNestedName(lr.sr, symbolId),
        type: lowerType(lr, variableSymbol.type),
        variableContext: EVariableContext.Global,
        wasMangled: symbol.extern !== EExternLanguage.Extern_C,
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
  console.log(" ".repeat(indent) + str);
};

function printLoweredType(lr: Lowered.Module, typeId: Lowered.TypeId) {
  const type = lr.typeNodes.get(typeId);

  switch (type.variant) {
    case Lowered.ENode.CallableDatatype:
    case Lowered.ENode.FunctionDatatype:
    case Lowered.ENode.PointerDatatype:
    case Lowered.ENode.ReferenceDatatype:
    case Lowered.ENode.PrimitiveDatatype:
      print("Typedef " + type.prettyName);
      break;

    case Lowered.ENode.StructDatatype:
      print("Struct " + type.prettyName + " {");
      for (const member of type.members) {
        const memberType = lr.typeNodes.get(member.type);
        print(`${member.name}: ${memberType.prettyName}`, 2);
      }
      print("}");
      break;
  }
}

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
      const exprType = lr.typeNodes.get(expr.type);
      return `(${serializeLoweredExpr(lr, expr.expr)} as ${exprType.prettyName})`;

    case Lowered.ENode.ExprCallExpr:
      return `((${serializeLoweredExpr(lr, expr.expr)})(${expr.arguments
        .map((a) => serializeLoweredExpr(lr, a))
        .join(", ")}))`;

    case Lowered.ENode.PostIncrExpr:
      return `((${serializeLoweredExpr(lr, expr.expr)})${IncrOperationToString(expr.operation)})`;

    case Lowered.ENode.PreIncrExpr:
      return `(${IncrOperationToString(expr.operation)}(${serializeLoweredExpr(lr, expr.expr)}))`;

    case Lowered.ENode.SymbolValueExpr:
      return expr.prettyName;

    case Lowered.ENode.ArrayLiteralExpr: {
      const t = lr.typeNodes.get(expr.type);
      return `(${t.prettyName})[${expr.values.map((v) => serializeLoweredExpr(lr, v)).join(", ")}]`;
    }

    case Lowered.ENode.ArraySubscriptExpr:
      return `(${serializeLoweredExpr(lr, expr.expr)})[${serializeLoweredExpr(lr, expr.index)}]`;

    case Lowered.ENode.StructInstantiationExpr: {
      const exprType = lr.typeNodes.get(expr.type);
      return `${exprType.prettyName} { ${expr.memberAssigns
        .map((a) => `${a.name}: ${serializeLoweredExpr(lr, a.value)}`)
        .join(", ")} }`;
    }

    case Lowered.ENode.DatatypeAsValueExpr: {
      const t = lr.typeNodes.get(expr.type);
      return t.prettyName;
    }

    case Lowered.ENode.LiteralExpr: {
      const exprType = lr.typeNodes.get(expr.type);
      if (
        exprType.variant === Lowered.ENode.PrimitiveDatatype &&
        exprType.primitive === EPrimitive.str
      ) {
        assert(expr.literal.type === EPrimitive.str);
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
      return `Callable(${expr.functionPrettyName}, this=${serializeLoweredExpr(
        lr,
        expr.thisExpr
      )})`;

    case Lowered.ENode.PointerAddressOfExpr:
      return `&${serializeLoweredExpr(lr, expr.expr)}`;

    case Lowered.ENode.PointerDereferenceExpr:
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
      const type = lr.typeNodes.get(s.type);
      print(
        "var " +
          s.prettyName +
          ": " +
          type.prettyName +
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
    print("Function " + f.prettyName + ":");
    printScope(lr, f.scope);
  } else {
    print("Function " + f.prettyName);
  }
}

export function PrettyPrintLowered(lr: Lowered.Module) {
  print("C Declarations:");
  for (const d of lr.cInjections) {
    print("C Decl " + JSON.stringify(d));
  }

  print("Lowered Types:");
  for (const t of [...lr.loweredTypes.values()]) {
    printLoweredType(lr, t);
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
    typeNodes: new BrandedArray<Lowered.TypeId, Lowered.Datatype>([]),

    cInjections: [],

    loweredTypes: new Map(),
    loweredFunctions: new Map(),
    loweredGlobalVariables: new Map(),

    sortedLoweredTypes: [],
  };

  const symbolsForLowering = [
    ...sr.elaboratedFuncdefSymbols,
    ...sr.elaboratedStructDatatypes,
    ...sr.elaboratedGlobalVariableStatements,
  ];

  for (const symbol of symbolsForLowering) {
    lower(lr, symbol.resultSymbol);
  }

  for (const primitive of sr.elaboratedPrimitiveTypes) {
    lower(lr, primitive);
  }

  for (const id of sr.cInjections) {
    const injection = sr.nodes.get(id);
    assert(injection.variant === Semantic.ENode.CInjectDirective);
    lr.cInjections.push(injection.value);
  }

  // PrettyPrintLowered(lr);
  // RenderCollectedSymbolTree(lr);

  return lr;
}
