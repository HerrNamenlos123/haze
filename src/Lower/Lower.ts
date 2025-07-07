import { ParenthesisExprContext } from "../parser/grammar/autogen/HazeParser";
import { type Semantic, type SemanticResult } from "../Semantic/SemanticSymbols";
import { EPrimitive, EVariableContext } from "../shared/common";
import { assert, ImpossibleSituation, InternalError } from "../shared/Errors";
import {
  makeLoweredId,
  makeTempName,
  type LoweredTypeId,
  type SemanticSymbolId,
} from "../shared/store";
import type { CollectResult } from "../SymbolCollection/CollectSymbols";
import type { Lowered } from "./LowerTypes";

function lowerExpr(
  lr: Lowered.Module,
  expr: Semantic.Expression,
  flattened: Lowered.Statement[],
): Lowered.Expression {
  switch (expr.variant) {
    case "ExprCall": {
      const calledExpr = lowerExpr(lr, expr.calledExpr, flattened);
      assert(calledExpr.type.variant === "Function" || calledExpr.type.variant === "Callable");
      let vartype: Lowered.Datatype | undefined = undefined;
      if (calledExpr.type.variant === "Callable") {
        if (calledExpr.type.functionType.variant !== "Function") throw new ImpossibleSituation();
        vartype = calledExpr.type.functionType.returnType;
      } else {
        vartype = calledExpr.type.returnType;
      }

      if (vartype.variant !== "Struct") {
        return {
          variant: "ExprCallExpr",
          expr: calledExpr,
          arguments: expr.arguments.map((a) => lowerExpr(lr, a, flattened)),
          type: resolveType(lr, expr.type),
        };
      } else {
        const varname = makeTempName();
        flattened.push({
          variant: "VariableStatement",
          name: varname,
          type: vartype,
          variableContext: EVariableContext.FunctionLocal,
          value: {
            variant: "ExprCallExpr",
            expr: calledExpr,
            arguments: expr.arguments.map((a) => lowerExpr(lr, a, flattened)),
            type: resolveType(lr, expr.type),
          },
          sourceloc: expr.sourceloc,
        });
        return {
          variant: "SymbolValue",
          name: varname,
          type: calledExpr.type,
        };
      }
    }

    case "BinaryExpr": {
      return {
        variant: "BinaryExpr",
        left: lowerExpr(lr, expr.left, flattened),
        right: lowerExpr(lr, expr.right, flattened),
        operation: expr.operation,
        type: resolveType(lr, expr.type),
      };
    }

    case "SymbolValue": {
      assert(expr.symbol.variant === "Variable" || expr.symbol.variant === "FunctionDeclaration" || expr.symbol.variant === "FunctionDefinition")
      if (expr.symbol.variant === "Variable") {
        return {
          variant: "SymbolValue",
          name: expr.symbol.name,
          type: resolveType(lr, expr.symbol.type),
        };
      }
      else {
        const func = lower(lr, expr.symbol)
        assert(func?.variant === "FunctionDeclaration" || func?.variant === "FunctionDefinition")
        return {
          variant: "SymbolValue",
          name: expr.symbol.name,
          type: resolveType(lr, expr.symbol.type),
          functionSymbol: func,
        };
      }
    }

    case "ExplicitCast": {
      return {
        variant: "ExplicitCast",
        expr: lowerExpr(lr, expr.expr, flattened),
        type: resolveType(lr, expr.type),
      };
    }

    case "ExprMemberAccess": {
      return {
        variant: "ExprMemberAccess",
        expr: lowerExpr(lr, expr.expr, flattened),
        isReference: expr.isReference,
        memberName: expr.memberName,
        type: resolveType(lr, expr.type),
      };
    }

    case "Constant": {
      return {
        variant: "ConstantExpr",
        value: expr.value,
        type: resolveType(lr, expr.type),
      };
    }

    case "StructInstantiation": {
      return {
        variant: "StructInstantiation",
        type: resolveType(lr, expr.type),
        memberAssigns: expr.assign.map((a) => ({
          name: a.name,
          value: lowerExpr(lr, a.value, flattened),
        })),
      };
    }

    case "PostIncrExpr": {
      return {
        variant: "PostIncrExpr",
        expr: lowerExpr(lr, expr.expr, flattened),
        operation: expr.operation,
        type: resolveType(lr, expr.type),
      };
    }

    case "PreIncrExpr": {
      return {
        variant: "PreIncrExpr",
        expr: lowerExpr(lr, expr.expr, flattened),
        operation: expr.operation,
        type: resolveType(lr, expr.type),
      };
    }

    case "CallableExpr": {
      const funcSymbol = lower(lr, expr.functionSymbol);
      if (!funcSymbol) throw new InternalError("Callable Function Symbol missing");
      assert(funcSymbol.variant === "FunctionDefinition" || funcSymbol.variant === "FunctionDeclaration")
      return {
        variant: "Callable",
        functionSymbol: funcSymbol,
        thisExpr: lowerExpr(lr, expr.thisExpr, flattened),
        type: resolveType(lr, expr.type),
      };
    }

    default:
      throw new InternalError("Unhandled variant: " + expr.variant);
  }
}

function resolveType(lr: Lowered.Module, type: Semantic.DatatypeSymbol): Lowered.Datatype {
  if (type.variant === "StructDatatype") {
    if (lr.loweredTypes.has(type)) {
      return lr.loweredTypes.get(type)!;
    }
    else {
      const parent = (type.parent &&
        lower(lr, type.parent));
      assert(!parent || parent?.variant === "Namespace" || parent?.variant === "Struct");
      const p: Lowered.StructDatatype = {
        variant: "Struct",
        name: type.name,
        generics: type.generics.map((id) => resolveType(lr, id)),
        parent: parent,
        members: [],
      };
      lr.loweredTypes.set(type, p);

      p.members = type.members.map((m) => {
        if (m.variant !== "Variable") throw new ImpossibleSituation();
        return {
          name: m.name,
          type: resolveType(lr, m.type),
        };
      });

      return p;
    }
  } else if (type.variant === "PrimitiveDatatype") {
    if (lr.loweredTypes.has(type)) {
      return lr.loweredTypes.get(type)!;
    }
    else {
      const p: Lowered.PrimitiveDatatype = {
        variant: "Primitive",
        primitive: type.primitive,
      };
      lr.loweredTypes.set(type, p);
      return p;
    }
  } else if (type.variant === "FunctionDatatype") {
    if (lr.loweredTypes.has(type)) {
      return lr.loweredTypes.get(type)!;
    }
    else {
      const p: Lowered.FunctionDatatype = {
        variant: "Function",
        parameters: type.parameters.map((p) =>
          resolveType(lr, p)
        ),
        returnType: resolveType(lr, type.returnType),
        vararg: type.vararg,
      };
      lr.loweredTypes.set(type, p);
      return p;
    }
  } else if (type.variant === "RawPointerDatatype") {
    if (lr.loweredTypes.has(type)) {
      return lr.loweredTypes.get(type)!;
    }
    else {
      const p: Lowered.RawPointerDatatype = {
        variant: "RawPointer",
        pointee: resolveType(lr, type.pointee),
      };
      lr.loweredTypes.set(type, p);
      return p;
    }
  } else if (type.variant === "ReferenceDatatype") {
    if (lr.loweredTypes.has(type)) {
      return lr.loweredTypes.get(type)!;
    }
    else {
      const p: Lowered.ReferenceDatatype = {
        variant: "Reference",
        referee: resolveType(lr, type.referee),
      };
      lr.loweredTypes.set(type, p);
      return p;
    }
  } else if (type.variant === "CallableDatatype") {
    if (lr.loweredTypes.has(type)) {
      return lr.loweredTypes.get(type)!;
    }
    else {
      const ftype = resolveType(lr, type.functionType)
      assert(ftype.variant === "Function");
      const p: Lowered.CallableDatatype = {
        variant: "Callable",
        thisExprType: type.thisExprType && resolveType(lr, type.thisExprType),
        functionType: ftype,
      };
      lr.loweredTypes.set(type, p);
      return p;
    }
  } else {
    throw new InternalError("Unhandled variant: " + type.variant);
  }
}

function lowerStatement(lr: Lowered.Module, statement: Semantic.Statement): Lowered.Statement[] {
  switch (statement.variant) {
    case "VariableStatement": {
      const flattened: Lowered.Statement[] = [];
      if (statement.variableSymbol.variant !== "Variable") throw new ImpossibleSituation();
      const s: Lowered.Statement = {
        variant: "VariableStatement",
        name: statement.name,
        type: resolveType(lr, statement.variableSymbol.type),
        value: statement.value && lowerExpr(lr, statement.value, flattened),
        variableContext: statement.variableSymbol.variableContext,
        sourceloc: statement.sourceloc,
      };
      return [...flattened, s];
    }

    case "IfStatement": {
      const flattened: Lowered.Statement[] = [];
      const s: Lowered.Statement = {
        variant: "IfStatement",
        condition: lowerExpr(lr, statement.condition, flattened),
        then: lowerScope(lr, statement.then),
        elseIfs: statement.elseIfs.map((e) => {
          const flattened: Lowered.Statement[] = [];
          return {
            condition: lowerExpr(lr, e.condition, flattened),
            then: lowerScope(lr, e.then),
          };
        }),
        else: statement.else && lowerScope(lr, statement.else),
        sourceloc: statement.sourceloc,
      };
      return [...flattened, s];
    }

    case "WhileStatement": {
      const flattened: Lowered.Statement[] = [];
      const s: Lowered.Statement = {
        variant: "WhileStatement",
        condition: lowerExpr(lr, statement.condition, flattened),
        then: lowerScope(lr, statement.then),
        sourceloc: statement.sourceloc,
      };
      return [...flattened, s];
    }

    case "ExprStatement": {
      const flattened: Lowered.Statement[] = [];
      const s: Lowered.Statement = {
        variant: "ExprStatement",
        expr: lowerExpr(lr, statement.expr, flattened),
        sourceloc: statement.sourceloc,
      };
      return [...flattened, s];
    }

    case "ReturnStatement": {
      const flattened: Lowered.Statement[] = [];
      const s: Lowered.Statement = {
        variant: "ReturnStatement",
        expr: statement.expr && lowerExpr(lr, statement.expr, flattened),
        sourceloc: statement.sourceloc,
      };
      return [...flattened, s];
    }

    case "InlineCStatement": {
      return [
        {
          variant: "InlineCStatement",
          value: statement.value,
          sourceloc: statement.sourceloc,
        },
      ];
    }

    default:
      throw new InternalError("Unhandled case: ");
  }
}

function lowerScope(lr: Lowered.Module, semanticScope: Semantic.BlockScope): Lowered.Scope {
  const scope: Lowered.Scope = {
    statements: [],
  };
  for (const s of semanticScope.statements) {
    scope.statements.push(...lowerStatement(lr, s));
  }
  return scope;
}

function lower(lr: Lowered.Module, symbol: Semantic.Symbol) {
  switch (symbol.variant) {
    case "FunctionDeclaration": {
      const parent =
        symbol.nestedParentTypeSymbol && lower(lr, symbol.nestedParentTypeSymbol);
      assert(!parent || parent?.variant === "Struct" || parent?.variant === "Namespace");

      const ftype = resolveType(lr, symbol.type);
      assert(ftype.variant === "Function");
      const f: Lowered.FunctionDeclaration = {
        variant: "FunctionDeclaration",
        name: symbol.name,
        parent: parent,
        type: ftype,
        externLanguage: symbol.externLanguage,
        sourceloc: symbol.sourceloc,
      };
      lr.loweredFunctions.set(symbol, f);
      return f;
    }

    case "FunctionDefinition": {
      if (lr.loweredFunctions.has(symbol)) {
        return lr.loweredFunctions.get(symbol)!;
      }

      if (symbol.methodOf === undefined) {
        // Normal function
        const parent =
          symbol.parent &&
          lower(lr, symbol.parent);

        const ftype = resolveType(lr, symbol.type);
        assert(ftype.variant === "Function");
        assert(symbol.scope);
        assert(!parent || parent?.variant === "Struct" || parent?.variant === "Namespace");
        const f: Lowered.FunctionDefinition = {
          variant: "FunctionDefinition",
          name: symbol.name,
          parent: parent,
          type: ftype,
          scope: lowerScope(lr, symbol.scope),
          sourceloc: symbol.sourceloc,
          externLanguage: symbol.externLanguage,
        };
        lr.loweredFunctions.set(symbol, f);
        return f;
      } else {
        // Method
        const parent =
          symbol.parent &&
          lower(lr, symbol.parent);
        assert(!parent || parent?.variant === "Struct" || parent?.variant === "Namespace");

        assert(symbol.scope)
        const ftype = resolveType(lr, symbol.type)
        assert(ftype.variant === "Function");
        const f: Lowered.FunctionDefinition = {
          variant: "FunctionDefinition",
          name: symbol.name,
          parent: parent,
          type: ftype,
          scope: lowerScope(lr, symbol.scope),
          externLanguage: symbol.externLanguage,
          sourceloc: symbol.sourceloc,
        };
        lr.loweredFunctions.set(symbol, f);
        return f;
      }
    }

    case "Namespace": {
      if (lr.loweredFunctions.has(symbol)) {
        return lr.loweredFunctions.get(symbol)!;
      }
      const parent =
        (symbol.nestedParentTypeSymbol &&
          lower(lr, symbol.nestedParentTypeSymbol));
      assert(!parent || parent?.variant === "Struct" || parent?.variant === "Namespace");
      const n: Lowered.NamespaceDatatype = {
        variant: "Namespace",
        name: symbol.name,
        parent: parent
      };
      lr.loweredTypes.set(symbol, n);
      return n;
    }

    case "DeferredDatatype":
      throw new InternalError("No deferred type should exist in lowering");

    case "StructDatatype": {
      for (const g of symbol.generics) {
        if (g.variant === "GenericParameterDatatype") {
          return undefined;
        }
        if (g.variant === "DeferredDatatype") {
          return undefined;
        }
      }
      return resolveType(lr, symbol);
    }

    case "PrimitiveDatatype": {
      return resolveType(lr, symbol);
    }

    case "FunctionDatatype": {
      return resolveType(lr, symbol);
    }

    case "RawPointerDatatype": {
      return resolveType(lr, symbol);
    }

    case "CallableDatatype": {
      return resolveType(lr, symbol);
    }

    case "ReferenceDatatype": {
      return resolveType(lr, symbol);
    }

    case "Variable": {
      if (symbol.variableContext !== EVariableContext.Global) {
        return undefined;
      }
      throw new InternalError("Not implemented");
    }

    default:
      throw new InternalError("Unhandled variant: " + symbol.variant);
  }
}

export function LowerModule(cr: CollectResult, sr: SemanticResult): Lowered.Module {
  const lr: Lowered.Module = {
    cr: cr,
    sr: sr,

    cDeclarations: cr.cInjections.map((i) => i.code),

    loweredTypes: new Map(),
    loweredFunctions: new Map(),
  };

  for (const symbol of sr.globalNamespace.scope.symbolTable.symbols) {
    if (!symbol.concrete) {
      continue;
    }
    lower(lr, symbol);
  }

  // console.log(lr.datatypes);
  // console.log(
  //   JSON.stringify(
  //     lr.functions,
  //     (_, value) => (typeof value === "bigint" ? Number(value) : value),
  //     4,
  //   ),
  // );

  return lr;
}
