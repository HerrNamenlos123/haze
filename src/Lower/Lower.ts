import {
  getSymbol,
  getType,
  getTypeFromSymbol,
  type Semantic,
  type SemanticResult,
} from "../Semantic/SemanticSymbols";
import { EVariableContext } from "../shared/common";
import { ImpossibleSituation, InternalError } from "../shared/Errors";
import { makeLoweredId, type ID } from "../shared/store";
import type { CollectResult } from "../SymbolCollection/CollectSymbols";
import type { Lowered } from "./LowerTypes";

function lowerExpr(lr: Lowered.Module, expr: Semantic.Expression): Lowered.Expression {
  switch (expr.variant) {
    case "ExprCall": {
      return {
        variant: "ExprCallExpr",
        expr: lowerExpr(lr, expr.calledExpr),
        arguments: expr.arguments.map((a) => lowerExpr(lr, a)),
        type: resolveType(lr, expr.typeSymbol),
      };
    }

    case "BinaryExpr": {
      return {
        variant: "BinaryExpr",
        left: lowerExpr(lr, expr.left),
        right: lowerExpr(lr, expr.right),
        operation: expr.operation,
        type: resolveType(lr, expr.typeSymbol),
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
        type: resolveType(lr, symbol.typeSymbol),
      };
    }

    // case "ExprMemberAccess": {

    // }

    case "Constant": {
      return {
        variant: "ConstantExpr",
        value: expr.value,
        type: resolveType(lr, expr.typeSymbol),
      };
    }

    case "StructInstantiation": {
      return {
        variant: "StructInstantiation",
        type: resolveType(lr, expr.typeSymbol),
        memberAssigns: expr.assign.map((a) => ({
          name: a.name,
          value: lowerExpr(lr, a.value),
        })),
      };
    }
  }
}

function resolveType(lr: Lowered.Module, typeSymbolId: ID): ID {
  const type = getTypeFromSymbol(lr.sr, typeSymbolId);

  if (type.variant === "Struct") {
    const existing = [...lr.datatypes.values()].find(
      (s) => s.variant === "Struct" && s.semanticId === type.id,
    );
    if (existing) return existing.id!;

    const id = makeLoweredId();
    lr.datatypes.set(id, {
      variant: "Struct",
      name: type.name,
      generics: type.genericSymbols.map((id) => resolveType(lr, id)),
      parent: lower(lr, getSymbol(lr.sr, type.definedInNamespaceOrStruct!)),
      members: type.members.map((m) => {
        const sym = getSymbol(lr.sr, m);
        if (sym.variant !== "Variable") throw new ImpossibleSituation();
        return {
          name: sym.name,
          type: resolveType(lr, sym.typeSymbol),
        };
      }),
      semanticId: typeSymbolId,
    });
    return id;
  } else if (type.variant === "Primitive") {
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
  } else if (type.variant === "Function") {
    const existing = [...lr.datatypes.values()].find(
      (s) => s.variant === "Function" && s.semanticId === type.id,
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
      semanticId: type.id,
    });
    return id;
  } else {
    throw new InternalError("Unhandled variant: " + type.variant);
  }
}

function lowerStatement(lr: Lowered.Module, statement: Semantic.Statement): Lowered.Statement {
  switch (statement.variant) {
    case "VariableStatement": {
      const symbol = getSymbol(lr.sr, statement.variableSymbol);
      if (symbol.variant !== "Variable") throw new ImpossibleSituation();
      return {
        variant: "VariableStatement",
        name: statement.name,
        type: resolveType(lr, symbol.typeSymbol),
        value: statement.value && lowerExpr(lr, statement.value),
        variableContext: symbol.variableContext,
        sourceloc: statement.sourceloc,
      };
    }

    case "IfStatement": {
      return {
        variant: "IfStatement",
        condition: lowerExpr(lr, statement.condition),
        then: lowerScope(lr, statement.then),
        elseIfs: statement.elseIfs.map((e) => ({
          condition: lowerExpr(lr, e.condition),
          then: lowerScope(lr, e.then),
        })),
        else: statement.else && lowerScope(lr, statement.else),
        sourceloc: statement.sourceloc,
      };
    }

    case "WhileStatement": {
      return {
        variant: "WhileStatement",
        condition: lowerExpr(lr, statement.condition),
        then: lowerScope(lr, statement.then),
        sourceloc: statement.sourceloc,
      };
    }

    case "ExprStatement": {
      return {
        variant: "ExprStatement",
        expr: lowerExpr(lr, statement.expr),
        sourceloc: statement.sourceloc,
      };
    }

    default:
      throw new InternalError("Unhandled case: " + statement.variant);
  }
}

function lowerScope(lr: Lowered.Module, semanticScope: Semantic.Scope): Lowered.Scope {
  const scope: Lowered.Scope = {
    statements: [],
  };
  for (const s of semanticScope.statements) {
    scope.statements.push(lowerStatement(lr, s));
  }
  return scope;
}

function lower(lr: Lowered.Module, symbol: Semantic.Symbol): ID | undefined {
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
        type: resolveType(lr, symbol.typeSymbol),
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
          type: resolveType(lr, symbol.typeSymbol),
          scope: lowerScope(lr, symbol.scope),
          semanticId: symbol.id!,
          sourceloc: symbol.sourceloc,
        });
        return id;
      } else {
        // Method
        return undefined;
        throw new InternalError("Not implemented yet");
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

    case "Datatype": {
      const type = getType(lr.sr, symbol.type);
      switch (type.variant) {
        case "Deferred":
          throw new InternalError("No deferred type should exist in lowering");

        case "Struct": {
          for (const g of type.genericSymbols) {
            const sym = getSymbol(lr.sr, g);
            if (sym.variant === "GenericParameter") {
              return undefined;
            }
            if (sym.variant === "Datatype") {
              const tp = getType(lr.sr, sym.type);
              if (tp.variant === "Deferred") {
                return undefined;
              }
            }
          }
          return resolveType(lr, symbol.id!);
        }

        case "Primitive": {
          const existing = [...lr.datatypes.values()].find(
            (s) => s.variant === "Primitive" && s.primitive === type.primitive,
          );
          if (existing) return existing.id!;
          return makeDatatype(lr, {
            variant: "Primitive",
            primitive: type.primitive,
          });
        }

        case "Function": {
          const existing = [...lr.datatypes.values()].find(
            (s) => s.variant === "Function" && s.semanticId === type.id,
          );
          if (existing) return existing.id!;
          return makeDatatype(lr, {
            variant: "Function",
            parameters: type.functionParameters.map((p) => ({
              name: p.name,
              type: resolveType(lr, p.type),
            })),
            returnType: resolveType(lr, type.functionReturnValue),
            semanticId: type.id!,
            vararg: type.vararg,
          });
        }

        default:
          throw new InternalError("Unhandled variant: " + type.variant);
      }
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

function makeDatatype(lr: Lowered.Module, datatype: Lowered.Datatype): ID {
  datatype.id = makeLoweredId();
  lr.datatypes.set(datatype.id!, datatype);
  return datatype.id!;
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
