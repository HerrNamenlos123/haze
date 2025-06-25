import { getSymbol, type Semantic, type SemanticResult } from "../Semantic/SemanticSymbols";
import { EVariableContext } from "../shared/common";
import { ImpossibleSituation, InternalError } from "../shared/Errors";
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
      const varname = makeTempName();
      const calledExpr = lowerExpr(lr, expr.calledExpr, flattened);
      const calledExprType = lr.datatypes.get(calledExpr.type)!;
      let vartype = calledExpr.type;
      if (calledExprType.variant === "Callable") {
        const functype = lr.datatypes.get(calledExprType.functionType);
        if (functype?.variant !== "Function") throw new ImpossibleSituation();
        vartype = functype.returnType;
      }
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
      const symbol = getSymbol(lr.sr, expr.symbol);
      if (
        symbol.variant !== "Variable" &&
        symbol.variant !== "FunctionDeclaration" &&
        symbol.variant !== "FunctionDefinition"
      )
        throw new ImpossibleSituation();
      return {
        variant: "SymbolValue",
        name: symbol.name,
        type: resolveType(lr, symbol.type),
      };
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

    case "CallableExpr": {
      const funcSymbol = lower(lr, getSymbol(lr.sr, expr.functionSymbol));
      if (!funcSymbol) throw new InternalError("Callable Function Symbol missing");
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

function resolveType(lr: Lowered.Module, typeId: SemanticSymbolId): LoweredTypeId {
  if (!typeId) throw new InternalError("ID is undefined", undefined, 1);
  const type = getSymbol(lr.sr, typeId, 1);

  if (type.variant === "StructDatatype") {
    const existing = [...lr.datatypes.values()].find(
      (s) => s.variant === "Struct" && s.semanticId === typeId,
    );
    if (existing) return existing.id!;

    const id = makeLoweredId();
    const struct: Lowered.StructDatatype = {
      id: id,
      variant: "Struct",
      name: type.name,
      generics: type.genericSymbols.map((id) => resolveType(lr, id)),
      parent:
        (type.definedInNamespaceOrStruct &&
          lower(lr, getSymbol(lr.sr, type.definedInNamespaceOrStruct))) ||
        undefined,
      members: [],
      semanticId: typeId,
    };
    lr.datatypes.set(id, struct);

    struct.members = type.members.map((m) => {
      const sym = getSymbol(lr.sr, m);
      if (sym.variant !== "Variable") throw new ImpossibleSituation();
      return {
        name: sym.name,
        type: resolveType(lr, sym.type),
      };
    });

    return id;
  } else if (type.variant === "PrimitiveDatatype") {
    const existing = [...lr.datatypes.values()].find(
      (s) => s.variant === "Primitive" && s.primitive === type.primitive,
    );
    if (existing) return existing.id!;

    const id = makeLoweredId();
    lr.datatypes.set(id, {
      id: id,
      variant: "Primitive",
      primitive: type.primitive,
    });
    return id;
  } else if (type.variant === "FunctionDatatype") {
    const existing = [...lr.datatypes.values()].find(
      (s) => s.variant === "Function" && s.semanticId === typeId,
    );
    if (existing) return existing.id!;

    const id = makeLoweredId();
    lr.datatypes.set(id, {
      id: id,
      variant: "Function",
      parameters: type.functionParameters.map((p) => {
        return { name: p.name, type: resolveType(lr, p.type) };
      }),
      returnType: resolveType(lr, type.functionReturnValue),
      vararg: type.vararg,
      semanticId: typeId,
    });
    return id;
  } else if (type.variant === "RawPointerDatatype") {
    const pointee = resolveType(lr, type.pointee);
    const existing = [...lr.datatypes.values()].find(
      (s) => s.variant === "RawPointer" && s.pointee === pointee,
    );
    if (existing) return existing.id!;

    const id = makeLoweredId();
    lr.datatypes.set(id, {
      id: id,
      variant: "RawPointer",
      pointee: pointee,
    });
    return id;
  } else if (type.variant === "ReferenceDatatype") {
    const referee = resolveType(lr, type.referee);
    const existing = [...lr.datatypes.values()].find(
      (s) => s.variant === "Reference" && s.referee === referee,
    );
    if (existing) return existing.id!;

    const id = makeLoweredId();
    lr.datatypes.set(id, {
      id: id,
      variant: "Reference",
      referee: referee,
    });
    return id;
  } else if (type.variant === "CallableDatatype") {
    const functionType = resolveType(lr, type.functionType);
    const thisExprType = type.thisExprType && resolveType(lr, type.thisExprType);
    const existing = [...lr.datatypes.values()].find(
      (s) =>
        s.variant === "Callable" &&
        s.functionType === functionType &&
        s.thisExprType === thisExprType,
    );
    if (existing) return existing.id!;

    const id = makeLoweredId();
    lr.datatypes.set(id, {
      id: id,
      variant: "Callable",
      thisExprType: thisExprType,
      functionType: functionType,
    });
    return id;
  } else {
    throw new InternalError("Unhandled variant: " + type.variant);
  }
}

function lowerStatement(lr: Lowered.Module, statement: Semantic.Statement): Lowered.Statement[] {
  switch (statement.variant) {
    case "VariableStatement": {
      // console.log(
      //   JSON.stringify(
      //     statement.value,
      //     (_, value) => (typeof value === "bigint" ? value.toString() : value),
      //     4,
      //   ),
      // );
      const flattened: Lowered.Statement[] = [];
      const symbol = getSymbol(lr.sr, statement.variableSymbol);
      if (symbol.variant !== "Variable") throw new ImpossibleSituation();
      const s: Lowered.Statement = {
        variant: "VariableStatement",
        name: statement.name,
        type: resolveType(lr, symbol.type),
        value: statement.value && lowerExpr(lr, statement.value, flattened),
        variableContext: symbol.variableContext,
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

function lowerScope(lr: Lowered.Module, semanticScope: Semantic.Scope): Lowered.Scope {
  const scope: Lowered.Scope = {
    statements: [],
  };
  for (const s of semanticScope.statements) {
    scope.statements.push(...lowerStatement(lr, s));
  }
  return scope;
}

function lower(lr: Lowered.Module, symbol: Semantic.Symbol): LoweredTypeId | undefined {
  switch (symbol.variant) {
    case "FunctionDeclaration": {
      const existing = [...lr.functions.values()].find(
        (s) => s.variant === "FunctionDeclaration" && s.semanticId === symbol.id,
      );
      if (existing) return existing.id!;

      const parent =
        symbol.nestedParentTypeSymbol && lower(lr, getSymbol(lr.sr, symbol.nestedParentTypeSymbol));

      const id = makeLoweredId();
      lr.functions.set(id, {
        id: id,
        variant: "FunctionDeclaration",
        name: symbol.name,
        parent: parent,
        type: resolveType(lr, symbol.type),
        semanticId: symbol.id!,
        sourceloc: symbol.sourceloc,
      });
      return id;
    }

    case "FunctionDefinition": {
      const existing = [...lr.functions.values()].find(
        (s) => s.variant === "FunctionDefinition" && s.semanticId === symbol.id,
      );
      if (existing) return existing.id!;

      if (symbol.methodOfSymbol === undefined) {
        // Normal function
        const parent =
          symbol.nestedParentTypeSymbol &&
          lower(lr, getSymbol(lr.sr, symbol.nestedParentTypeSymbol));

        const id = makeLoweredId();
        lr.functions.set(id, {
          id: id,
          variant: "FunctionDefinition",
          name: symbol.name,
          parent: parent,
          type: resolveType(lr, symbol.type),
          scope: lowerScope(lr, symbol.scope),
          semanticId: symbol.id!,
          sourceloc: symbol.sourceloc,
        });
        return id;
      } else {
        // Method
        const parent =
          symbol.nestedParentTypeSymbol &&
          lower(lr, getSymbol(lr.sr, symbol.nestedParentTypeSymbol));

        if (symbol.name === "get") {
          console.log(symbol.scope.sourceloc, symbol.scope.statements);
        }
        const id = makeLoweredId();
        lr.functions.set(id, {
          id: id,
          variant: "FunctionDefinition",
          name: symbol.name,
          parent: parent,
          type: resolveType(lr, symbol.type),
          scope: lowerScope(lr, symbol.scope),
          semanticId: symbol.id!,
          sourceloc: symbol.sourceloc,
        });
        return id;
      }
    }

    case "Namespace": {
      const existing = [...lr.datatypes.values()].find(
        (s) => s.variant === "Namespace" && s.semanticId === symbol.id,
      );
      if (existing) return existing.id!;
      return makeDatatype(lr, {
        variant: "Namespace",
        name: symbol.name,
        parent: (symbol.nestedParentTypeSymbol &&
          lower(lr, getSymbol(lr.sr, symbol.nestedParentTypeSymbol)))!,
        semanticId: symbol.id!,
      });
    }

    case "DeferredDatatype":
      throw new InternalError("No deferred type should exist in lowering");

    case "StructDatatype": {
      for (const g of symbol.genericSymbols) {
        const sym = getSymbol(lr.sr, g);
        if (sym.variant === "GenericParameter") {
          return undefined;
        }
        if (sym.variant === "DeferredDatatype") {
          return undefined;
        }
      }
      return resolveType(lr, symbol.id!);
    }

    case "PrimitiveDatatype": {
      const existing = [...lr.datatypes.values()].find(
        (s) => s.variant === "Primitive" && s.primitive === symbol.primitive,
      );
      if (existing) return existing.id!;
      return makeDatatype(lr, {
        variant: "Primitive",
        primitive: symbol.primitive,
      });
    }

    case "FunctionDatatype": {
      return resolveType(lr, symbol.id!);
    }

    case "RawPointerDatatype": {
      return resolveType(lr, symbol.pointee);
    }

    case "CallableDatatype": {
      return resolveType(lr, symbol.id!);
    }

    case "ReferenceDatatype": {
      return resolveType(lr, symbol.id!);
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

function makeDatatype(lr: Lowered.Module, datatype: Lowered.DatatypeWithoutId): LoweredTypeId {
  const _datatype = datatype as Lowered.Datatype;
  _datatype.id = makeLoweredId();
  lr.datatypes.set(_datatype.id, _datatype);
  return _datatype.id;
}

export function LowerModule(cr: CollectResult, sr: SemanticResult): Lowered.Module {
  const lr: Lowered.Module = {
    cr: cr,
    sr: sr,

    cDeclarations: cr.cInjections.map((i) => i.code),

    datatypes: new Map(),
    functions: new Map(),
  };

  for (const [id, symbol] of sr.symbolTable.getAll()) {
    if (!symbol.concrete || symbol.variant === "GenericParameter") {
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
