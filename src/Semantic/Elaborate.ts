import { logger } from "../log/log";
import {
  EBinaryOperation,
  EExternLanguage,
  type ASTExpr,
  type ASTFunctionDatatype,
  type ASTParam,
  type ASTStatement,
} from "../shared/AST";
import {
  assertScope,
  EMethodType,
  EPrimitive,
  EVariableContext,
  primitiveToString,
} from "../shared/common";
import { assert, CompilerError, ImpossibleSituation, InternalError } from "../shared/Errors";
import { type SemanticSymbolId } from "../shared/store";
import { Collect } from "../SymbolCollection/CollectSymbols";
import { Conversion } from "./Conversion";
import { instantiateSymbol } from "./Instantiate";
import { resolveDatatype } from "./Resolve";
import { getSymbol, Semantic, type SemanticResult } from "./SemanticSymbols";

export function elaborateExpr(
  sr: SemanticResult,
  scope: Semantic.Scope,
  expr: ASTExpr,
  genericContext: Semantic.GenericContext | null,
): Semantic.Expression {
  if (!genericContext) {
    genericContext = {
      symbolToSymbol: new Map(),
      elaborateCurrentStructOrNamespace: null,
      datatypesDone: new Map(),
    };
  }

  switch (expr.variant) {
    case "BinaryExpr": {
      const a = elaborateExpr(sr, scope, expr.a, genericContext);
      const b = elaborateExpr(sr, scope, expr.b, genericContext);

      const leftType = getSymbol(sr, a.type);
      const rightType = getSymbol(sr, a.type);

      switch (expr.operation) {
        case EBinaryOperation.Multiply:
        case EBinaryOperation.Divide:
        case EBinaryOperation.Modulo:
        case EBinaryOperation.Add:
        case EBinaryOperation.Subtract:
          if (Conversion.isInteger(leftType) && Conversion.isInteger(rightType)) {
            return {
              variant: "BinaryExpr",
              left: a,
              operation: expr.operation,
              right: b,
              type: Conversion.getIntegerBinaryResult(leftType, rightType).id,
              sourceloc: expr.sourceloc,
            };
          }
          if (Conversion.isF32(leftType) && Conversion.isF32(rightType)) {
            return {
              variant: "BinaryExpr",
              left: a,
              operation: expr.operation,
              right: b,
              type: sr.symbolTable.makePrimitiveAvailable(EPrimitive.f32).id,
              sourceloc: expr.sourceloc,
            };
          } else if (Conversion.isFloat(leftType) && Conversion.isFloat(rightType)) {
            return {
              variant: "BinaryExpr",
              left: a,
              operation: expr.operation,
              right: b,
              type: sr.symbolTable.makePrimitiveAvailable(EPrimitive.f64).id,
              sourceloc: expr.sourceloc,
            };
          } else if (
            (Conversion.isFloat(leftType) && Conversion.isInteger(rightType)) ||
            (Conversion.isInteger(leftType) && Conversion.isFloat(rightType))
          ) {
            return {
              variant: "BinaryExpr",
              left: a,
              operation: expr.operation,
              right: b,
              type: sr.symbolTable.makePrimitiveAvailable(EPrimitive.f64).id,
              sourceloc: expr.sourceloc,
            };
          }
          break;

        case EBinaryOperation.LessEqual:
        case EBinaryOperation.LessThan:
        case EBinaryOperation.GreaterEqual:
        case EBinaryOperation.GreaterThan:
          if (
            (Conversion.isInteger(leftType) || Conversion.isFloat(leftType)) &&
            (Conversion.isInteger(rightType) || Conversion.isFloat(rightType))
          ) {
            return {
              variant: "BinaryExpr",
              left: a,
              operation: expr.operation,
              right: b,
              type: sr.symbolTable.makePrimitiveAvailable(EPrimitive.boolean).id,
              sourceloc: expr.sourceloc,
            };
          }
          break;

        case EBinaryOperation.Equal:
        case EBinaryOperation.Unequal:
          if (
            (Conversion.isBoolean(leftType) && Conversion.isBoolean(rightType)) ||
            (Conversion.isInteger(leftType) && Conversion.isInteger(rightType)) ||
            (Conversion.isFloat(leftType) && Conversion.isFloat(rightType))
          ) {
            return {
              variant: "BinaryExpr",
              left: a,
              operation: expr.operation,
              right: b,
              type: sr.symbolTable.makePrimitiveAvailable(EPrimitive.boolean).id,
              sourceloc: expr.sourceloc,
            };
          }
          break;

        case EBinaryOperation.BoolAnd:
        case EBinaryOperation.BoolOr:
          if (Conversion.isBoolean(leftType) && Conversion.isBoolean(rightType)) {
            return {
              variant: "BinaryExpr",
              left: a,
              operation: expr.operation,
              right: b,
              type: sr.symbolTable.makePrimitiveAvailable(EPrimitive.boolean).id,
              sourceloc: expr.sourceloc,
            };
          }
          break;

        default:
          throw new ImpossibleSituation();
      }

      if (leftType.variant === "DeferredDatatype" || rightType.variant === "DeferredDatatype") {
        return {
          variant: "BinaryExpr",
          left: a,
          operation: expr.operation,
          right: b,
          type: sr.symbolTable.makeSymbolAvailable({ variant: "DeferredDatatype", concrete: false })
            .id,
          sourceloc: expr.sourceloc,
        };
      }

      throw new InternalError("No known binary result for types ");
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ConstantExpr": {
      if (expr.constant.variant === "BooleanConstant") {
        return {
          variant: "Constant",
          type: sr.symbolTable.makePrimitiveAvailable(EPrimitive.boolean).id,
          value: expr.constant.value,
          sourceloc: expr.sourceloc,
        };
      } else if (expr.constant.variant === "NumberConstant") {
        return {
          variant: "Constant",
          type: sr.symbolTable.makePrimitiveAvailable(EPrimitive.i32).id,
          value: expr.constant.value,
          sourceloc: expr.sourceloc,
        };
      } else {
        return {
          variant: "Constant",
          type: sr.symbolTable.makePrimitiveAvailable(EPrimitive.str).id,
          value: expr.constant.value,
          sourceloc: expr.sourceloc,
        };
      }
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ParenthesisExpr": {
      return elaborateExpr(sr, scope, expr.expr, genericContext);
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExprCallExpr": {
      const calledExpr = elaborateExpr(sr, scope, expr.calledExpr, genericContext);
      const args = expr.arguments.map((a) => elaborateExpr(sr, scope, a, genericContext));
      const type = getSymbol(sr, calledExpr.type);

      if (type.variant === "CallableDatatype") {
        const ftype = getSymbol(sr, type.functionType);
        assert(ftype.variant === "FunctionDatatype");
        return {
          variant: "ExprCall",
          calledExpr: calledExpr,
          arguments: args,
          type: getSymbol(sr, ftype.functionReturnValue).id!,
          sourceloc: expr.sourceloc,
        };
      }

      if (type.variant === "FunctionDatatype") {
        return {
          variant: "ExprCall",
          calledExpr: calledExpr,
          arguments: args,
          type: getSymbol(sr, type.functionReturnValue).id!,
          sourceloc: expr.sourceloc,
        };
      } else if (type.variant === "StructDatatype") {
        throw new CompilerError(
          `Expression of type Struct ${type.name} is not callable`,
          expr.sourceloc,
        );
      } else if (type.variant === "PrimitiveDatatype") {
        throw new CompilerError(
          `Expression of type ${primitiveToString(type.primitive)} is not callable`,
          expr.sourceloc,
        );
      } else if (type.variant === "Namespace") {
        throw new CompilerError(`Expression of type Namespace is not callable`, expr.sourceloc);
      } else if (type.variant === "RawPointerDatatype") {
        throw new CompilerError(`Expression of type Pointer is not callable`, expr.sourceloc);
      } else if (type.variant === "ReferenceDatatype") {
        throw new CompilerError(`Expression of type Reference is not callable`, expr.sourceloc);
      }
      assert(false && "All cases handled");
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "SymbolValueExpr": {
      const symbol = scope.collectScope.symbolTable.lookupSymbol(expr.name, expr.sourceloc);
      if (
        symbol.variant === "VariableDefinitionStatement" ||
        symbol.variant === "GlobalVariableDefinition"
      ) {
        if (!symbol._semantic.symbol) throw new InternalError("Semantic Symbol missing");
        const variableSymbol = getSymbol(sr, symbol._semantic.symbol);
        assert(variableSymbol.variant === "Variable");

        return {
          variant: "SymbolValue",
          symbol: variableSymbol.id!,
          type: variableSymbol.type,
          sourceloc: expr.sourceloc,
        };
      } else if (
        symbol.variant === "FunctionDeclaration" ||
        symbol.variant === "FunctionDefinition"
      ) {
        if (!symbol._semantic.symbol) throw new ImpossibleSituation();
        const rawFunctionSymbol = getSymbol(sr, symbol._semantic.symbol);
        const functionSymbol = instantiateSymbol(sr, rawFunctionSymbol.id, {
          symbolToSymbol: new Map(genericContext.symbolToSymbol),
          elaborateCurrentStructOrNamespace: genericContext.elaborateCurrentStructOrNamespace,
          datatypesDone: new Map(genericContext.datatypesDone),
        });
        assert(
          functionSymbol.variant === "FunctionDefinition" ||
            functionSymbol.variant === "FunctionDeclaration",
        );
        return {
          variant: "SymbolValue",
          symbol: functionSymbol.id,
          type: functionSymbol.type,
          sourceloc: expr.sourceloc,
        };
      } else {
        throw new CompilerError(`Symbol ${symbol.name} cannot be used as a value`, expr.sourceloc);
      }
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExplicitCastExpr": {
      return {
        variant: "ExplicitCast",
        type: resolveDatatype(sr, scope.collectScope, expr.castedTo, genericContext).id,
        expr: elaborateExpr(sr, scope, expr.expr, genericContext),
        sourceloc: expr.sourceloc,
      };
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "PostIncrExpr": {
      const e = elaborateExpr(sr, scope, expr.expr, genericContext);
      return {
        variant: "PostIncrExpr",
        type: e.type,
        expr: e,
        operation: expr.operation,
        sourceloc: expr.sourceloc,
      };
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "PreIncrExpr": {
      const e = elaborateExpr(sr, scope, expr.expr, genericContext);
      return {
        variant: "PreIncrExpr",
        type: e.type,
        expr: e,
        operation: expr.operation,
        sourceloc: expr.sourceloc,
      };
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExprMemberAccess": {
      const object = elaborateExpr(sr, scope, expr.expr, genericContext);
      let type = getSymbol(sr, object.type);
      let isReference = false;

      if (type.variant === "ReferenceDatatype") {
        type = getSymbol(sr, type.referee);
        isReference = true;
      }

      if (type.variant !== "StructDatatype") {
        throw new CompilerError("Cannot access member of a non-structural type", expr.sourceloc);
      }

      const memberId = type.members.find((m) => {
        const mm = sr.symbolTable.get(m)! as Semantic.VariableSymbol;
        return mm.name === expr.member;
      });
      const methodId = type.methods.find((m) => {
        const mm = sr.symbolTable.get(m)! as Semantic.FunctionDefinitionSymbol;
        return mm.name === expr.member;
      });

      if (memberId) {
        const member = getSymbol(sr, memberId) as Semantic.VariableSymbol;
        const memberTypeSymbol = getSymbol(sr, member.type);

        return {
          variant: "ExprMemberAccess",
          expr: object,
          memberName: expr.member,
          isReference: isReference,
          type: memberTypeSymbol.id!,
          sourceloc: expr.sourceloc,
        };
      } else if (methodId) {
        const method = getSymbol(sr, methodId) as
          | Semantic.FunctionDeclarationSymbol
          | Semantic.FunctionDefinitionSymbol;
        const functype = getSymbol(sr, method.type);
        // elaborate(sr, method, genericContext);

        const objRef = sr.symbolTable.makeSymbolAvailable({
          variant: "ReferenceDatatype",
          referee: object.type,
          concrete: getSymbol(sr, object.type).concrete,
        });

        const callable = sr.symbolTable.makeSymbolAvailable({
          variant: "CallableDatatype",
          thisExprType: objRef.id,
          functionType: functype.id,
          concrete: functype.concrete,
        });

        return {
          variant: "CallableExpr",
          thisExpr: object,
          functionSymbol: method.id!,
          type: callable.id,
          sourceloc: expr.sourceloc,
        };
      } else {
        throw new CompilerError(`No such member in struct ${type.name}`, expr.sourceloc);
      }
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "StructInstantiationExpr": {
      const struct = resolveDatatype(sr, scope.collectScope, expr.datatype, genericContext);
      assert(struct.variant === "StructDatatype");

      let remainingMembers = struct.members.map(
        (m) => (getSymbol(sr, m) as Semantic.VariableSymbol).name,
      );
      const assignedMembers: string[] = [];
      const assign: {
        name: string;
        value: Semantic.Expression;
      }[] = [];
      for (const m of expr.members) {
        const e = elaborateExpr(sr, scope, m.value, genericContext);

        const variableId = struct.members.find((mm) => {
          const s = getSymbol(sr, mm);
          assert(s.variant === "Variable");
          return s.name === m.name;
        });

        if (!variableId) {
          throw new CompilerError(`Member with name ${m.name} does not exist`, expr.sourceloc);
        }
        const variable = getSymbol(sr, variableId);
        assert(variable.variant === "Variable");
        const variableType = getSymbol(sr, variable.type);

        if (assignedMembers.includes(m.name)) {
          throw new CompilerError(`Cannot assign member ${m.name} twice`, expr.sourceloc);
        }

        if (e.type !== variableType.id) {
          throw new CompilerError(`Member assignment ${m.name} has type mismatch`, expr.sourceloc);
        }

        remainingMembers = remainingMembers.filter((mm) => mm !== m.name);
        assign.push({
          value: e,
          name: m.name,
        });
        assignedMembers.push(m.name);
      }
      if (remainingMembers.length > 0) {
        throw new CompilerError(
          `Members ${remainingMembers.join(", ")} were not assigned`,
          expr.sourceloc,
        );
      }

      return {
        variant: "StructInstantiation",
        assign: assign,
        type: struct.id!,
        sourceloc: expr.sourceloc,
      };
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    default:
      throw new InternalError("Unhandled variant: " + expr.variant);
  }
}

export function elaborateStatement(
  sr: SemanticResult,
  scope: Semantic.Scope,
  s: ASTStatement,
  genericContext: Semantic.GenericContext | null,
): Semantic.Statement {
  if (!genericContext) {
    genericContext = {
      symbolToSymbol: new Map(),
      elaborateCurrentStructOrNamespace: null,
      datatypesDone: new Map(),
    };
  }

  switch (s.variant) {
    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "InlineCStatement":
      return {
        variant: "InlineCStatement",
        value: s.code,
        sourceloc: s.sourceloc,
      };

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "IfStatement": {
      const condition = elaborateExpr(sr, scope, s.condition, genericContext);
      const then = elaborateScope(sr, assertScope(s.then._collect.scope), genericContext, scope);
      const elseIfs = s.elseIfs.map((e) => {
        return {
          condition: elaborateExpr(sr, scope, e.condition, genericContext),
          then: elaborateScope(sr, assertScope(e.then._collect.scope), genericContext, scope),
        };
      });
      const _else =
        s.else && elaborateScope(sr, assertScope(s.else._collect.scope), genericContext, scope);
      return {
        variant: "IfStatement",
        condition: condition,
        then: then,
        elseIfs: elseIfs,
        else: _else,
        sourceloc: s.sourceloc,
      };
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "WhileStatement":
      return {
        variant: "WhileStatement",
        condition: elaborateExpr(sr, scope, s.condition, genericContext),
        then: elaborateScope(sr, assertScope(s.body._collect.scope), genericContext, scope),
        sourceloc: s.sourceloc,
      };

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ReturnStatement":
      return {
        variant: "ReturnStatement",
        expr: s.expr && elaborateExpr(sr, scope, s.expr, genericContext),
        sourceloc: s.sourceloc,
      };

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "VariableDefinitionStatement": {
      const expr = s.expr && elaborateExpr(sr, scope, s.expr, genericContext);

      let typeSymbolId: SemanticSymbolId | undefined = undefined;
      if (s.datatype) {
        typeSymbolId = resolveDatatype(sr, scope.collectScope, s.datatype, genericContext).id;
      } else {
        if (!expr) throw new ImpossibleSituation();
        typeSymbolId = expr.type;
      }

      const symbol = sr.symbolTable.makeSymbolAvailable({
        variant: "Variable",
        export: false,
        externLanguage: EExternLanguage.None,
        mutable: s.mutable,
        name: s.name,
        type: typeSymbolId,
        definedInScope: scope.id,
        sourceLoc: s.sourceloc,
        variableContext: EVariableContext.FunctionLocal,
        memberOf: undefined,
        concrete: getSymbol(sr, typeSymbolId).concrete,
      });
      s._semantic.symbol = symbol.id;

      return {
        variant: "VariableStatement",
        mutable: s.mutable,
        name: s.name,
        variableSymbol: symbol.id,
        value: expr,
        sourceloc: s.sourceloc,
      };
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExprStatement":
      return {
        variant: "ExprStatement",
        expr: elaborateExpr(sr, scope, s.expr, genericContext),
        sourceloc: s.sourceloc,
      };
  }
}

export function elaborateScope(
  sr: SemanticResult,
  astScope: Collect.Scope,
  genericContext: Semantic.GenericContext | null,
  parentScope?: Semantic.Scope,
): Semantic.Scope {
  if (!genericContext) {
    genericContext = {
      symbolToSymbol: new Map(),
      elaborateCurrentStructOrNamespace: null,
      datatypesDone: new Map(),
    };
  }

  const scope = new Semantic.Scope(astScope.sourceloc, astScope, parentScope);
  for (const s of astScope.statements) {
    const statement = elaborateStatement(sr, scope, s, genericContext);
    scope.statements.push(statement);

    if (statement.variant === "ReturnStatement") {
      scope.returnedTypes.push(statement.expr?.type);
    }
  }
  return scope;
}

export function elaborate(
  sr: SemanticResult,
  item: Collect.Symbol,
  genericContext: Semantic.GenericContext | null,
): SemanticSymbolId {
  logger.trace("elaborate()");
  if (!genericContext) {
    genericContext = {
      symbolToSymbol: new Map(),
      elaborateCurrentStructOrNamespace: null,
      datatypesDone: new Map(),
    };
  }

  switch (item.variant) {
    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "FunctionDeclaration": {
      const type: ASTFunctionDatatype = {
        variant: "FunctionDatatype",
        params: item.params,
        ellipsis: item.ellipsis,
        returnType: item.returnType!,
        sourceloc: item.sourceloc,
      };

      const resolved = resolveDatatype(sr, item._collect.definedInScope!, type, genericContext);
      item._semantic.symbol = sr.symbolTable.makeSymbolAvailable({
        variant: "FunctionDeclaration",
        type: resolved.id,
        export: item.export,
        externLanguage: item.externLanguage,
        method: item._collect.method!,
        nestedParentTypeSymbol: genericContext.elaborateCurrentStructOrNamespace || undefined,
        name: item.name,
        sourceloc: item.sourceloc,
        concrete: resolved.concrete,
      }).id;

      return item._semantic.symbol!;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "FunctionDefinition": {
      const type: ASTFunctionDatatype = {
        variant: "FunctionDatatype",
        params: item.params,
        ellipsis: item.ellipsis,
        returnType: item.returnType!,
        sourceloc: item.sourceloc,
      };

      const resolved = resolveDatatype(sr, item._collect.definedInScope!, type, genericContext);
      let symbol = sr.symbolTable.defineSymbol({
        variant: "FunctionDefinition",
        type: resolved.id,
        export: item.export,
        nestedParentTypeSymbol: genericContext.elaborateCurrentStructOrNamespace || undefined,
        externLanguage: item.externLanguage,
        method: item._collect.method!,
        name: item.name,
        sourceloc: item.sourceloc,
        scope: new Semantic.Scope(item.sourceloc, item.funcbody._collect.scope!),
        concrete: resolved.concrete,
      });
      if (symbol.variant !== "FunctionDefinition") {
        throw new ImpossibleSituation();
      }
      item._semantic.symbol = symbol.id;

      if (item.funcbody._collect.scope && symbol.concrete) {
        item.funcbody._collect.scope._semantic.forFunctionSymbol = symbol.id;
        symbol.scope = elaborateScope(
          sr,
          item.funcbody._collect.scope,
          genericContext,
          symbol.scope,
        );
      }

      // if (item.returnType!.variant === "Deferred") {
      //   if (symbol.scope.returnedTypes.length > 0) {
      //     if (!hasOnlyDuplicates(symbol.scope.returnedTypes)) {
      //       throw new InternalError("Multiple different return types not supported yet");
      //     }

      //     const functypeSymbol = sr.symbolTable.get(symbol.typeSymbol) as Semantic.DatatypeSymbol;
      //     const functype = sr.typeTable.get(functypeSymbol.type) as Semantic.FunctionDatatype;
      //     const tp = sr.typeTable.makePrimitiveDatatypeAvailable(EPrimitive.none);
      //     functype.functionReturnValue =
      //       symbol.scope.returnedTypes[0] ||
      //       sr.symbolTable.makeDatatypeSymbolAvailable(tp.id, tp.concrete).id;
      //     symbol.typeSymbol = sr.typeTable.makeDatatypeAvailable(functype).id;
      //     symbol = sr.symbolTable.makeSymbolAvailable(symbol);
      //     item._semantic.symbol = symbol.id;
      //   } else {
      //     const functypeSymbol = sr.symbolTable.get(symbol.typeSymbol) as Semantic.DatatypeSymbol;
      //     const functype = sr.typeTable.get(functypeSymbol.type) as Semantic.FunctionDatatype;
      //     const tp = sr.typeTable.makePrimitiveDatatypeAvailable(EPrimitive.none);
      //     functype.functionReturnValue = sr.symbolTable.makeDatatypeSymbolAvailable(
      //       tp.id,
      //       tp.concrete,
      //     ).id;
      //     symbol.typeSymbol = sr.typeTable.makeDatatypeAvailable(functype).id;
      //     symbol = sr.symbolTable.makeSymbolAvailable(symbol);
      //     item._semantic.symbol = symbol.id;
      //   }
      // } else {
      //   if (!hasOnlyDuplicates(symbol.scope.returnedTypes)) {
      //     throw new InternalError("Multiple different return types not supported yet");
      //   }
      // }

      return symbol.id;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "StructMethod": {
      const methodFunctype: ASTFunctionDatatype = {
        variant: "FunctionDatatype",
        params: item.params,
        ellipsis: item.ellipsis,
        returnType: item.returnType!,
        sourceloc: item.sourceloc,
      };

      // Now add this pointer to method
      if (!item._semantic.memberOfSymbol) throw new ImpossibleSituation();
      const struct = getSymbol(sr, item._semantic.memberOfSymbol);
      assert(struct.variant === "StructDatatype");
      const thisType: ASTParam = {
        name: "this",
        datatype: {
          variant: "Deferred",
        },
        sourceloc: item.sourceloc,
      };
      methodFunctype.params = [thisType, ...methodFunctype.params];

      let resolvedMethodFunctype = resolveDatatype(
        sr,
        item._collect.definedInScope!,
        methodFunctype,
        genericContext,
      );

      // Second part of this pointer
      assert(resolvedMethodFunctype.variant === "FunctionDatatype");
      for (const param of resolvedMethodFunctype.functionParameters) {
        if (param.name === "this") {
          const thisReference = sr.symbolTable.makeSymbolAvailable({
            variant: "ReferenceDatatype",
            referee: instantiateSymbol(sr, item._semantic.memberOfSymbol, genericContext).id,
            concrete: struct.concrete,
          });
          param.type = thisReference.id;
        }
      }
      resolvedMethodFunctype.concrete =
        resolvedMethodFunctype.functionParameters.every((p) => getSymbol(sr, p.type).concrete) &&
        getSymbol(sr, resolvedMethodFunctype.functionReturnValue).concrete &&
        resolvedMethodFunctype.generics.every((g) => getSymbol(sr, g).concrete);

      resolvedMethodFunctype = instantiateSymbol(sr, resolvedMethodFunctype.id, genericContext);

      let symbol = sr.symbolTable.defineSymbol({
        variant: "FunctionDefinition",
        type: resolvedMethodFunctype.id,
        export: false,
        externLanguage: EExternLanguage.None,
        method: EMethodType.Method,
        name: item.name,
        sourceloc: item.sourceloc,
        methodOfSymbol: item._semantic.memberOfSymbol,
        scope: new Semantic.Scope(item.sourceloc, assertScope(item.funcbody._collect.scope)),
        nestedParentTypeSymbol: item._semantic.memberOfSymbol,
        concrete: resolvedMethodFunctype.concrete,
      });
      if (symbol.variant !== "FunctionDefinition") {
        throw new ImpossibleSituation();
      }
      item._semantic.symbol = symbol.id;
      console.log("Elaborated method ", symbol.name, symbol.methodOfSymbol);

      const scope = item.funcbody._collect.scope;
      if (scope && symbol.concrete) {
        scope._semantic.forFunctionSymbol = symbol.id;
        symbol.scope = elaborateScope(sr, scope, genericContext, symbol.scope);
      }

      if (!item.returnType) {
        item.returnType = {
          variant: "NamedDatatype",
          name: "none",
          generics: [],
          _collect: {},
          sourceloc: item.sourceloc,
        };
      }
      // if (item.returnType!.variant === "Deferred") {
      //   if (symbol.scope.returnedTypes.length > 0) {
      //     if (!hasOnlyDuplicates(symbol.scope.returnedTypes)) {
      //       throw new InternalError("Multiple different return types not supported yet");
      //     }

      //     const functypeSymbol = sr.symbolTable.get(symbol.typeSymbol) as Semantic.DatatypeSymbol;
      //     const functype = sr.typeTable.get(functypeSymbol.type) as Semantic.FunctionDatatype;
      //     const tp = sr.typeTable.makePrimitiveDatatypeAvailable(EPrimitive.none);
      //     functype.functionReturnValue =
      //       symbol.scope.returnedTypes[0] ||
      //       sr.symbolTable.makeDatatypeSymbolAvailable(tp.id, tp.concrete).id;
      //     symbol.typeSymbol = sr.typeTable.makeDatatypeAvailable(functype).id;
      //     symbol = sr.symbolTable.makeSymbolAvailable(symbol);
      //     item._semantic.symbol = symbol.id;
      //   } else {
      //     const functypeSymbol = sr.symbolTable.get(symbol.typeSymbol) as Semantic.DatatypeSymbol;
      //     const functype = sr.typeTable.get(functypeSymbol.type) as Semantic.FunctionDatatype;
      //     const tp = sr.typeTable.makePrimitiveDatatypeAvailable(EPrimitive.none);
      //     functype.functionReturnValue = sr.symbolTable.makeDatatypeSymbolAvailable(
      //       tp.id,
      //       tp.concrete,
      //     ).id;
      //     symbol.typeSymbol = sr.typeTable.makeDatatypeAvailable(functype).id;
      //     symbol = sr.symbolTable.makeSymbolAvailable(symbol);
      //     item._semantic.symbol = symbol.id;
      //   }
      // } else {
      //   if (!hasOnlyDuplicates(symbol.scope.returnedTypes)) {
      //     throw new CompilerError(
      //       "Multiple different return types not supported yet",
      //       symbol.scope.sourceloc,
      //     );
      //   }
      // }

      return symbol.id;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "NamespaceDefinition": {
      assert(genericContext.elaborateCurrentStructOrNamespace !== undefined);
      const namespace = sr.symbolTable.makeSymbolAvailable({
        variant: "Namespace",
        name: item.name,
        declarations: [],
        nestedParentTypeSymbol: genericContext.elaborateCurrentStructOrNamespace || undefined,
        concrete: true,
      }) as Semantic.NamespaceSymbol;
      namespace.declarations = item.declarations.map((d) =>
        elaborate(sr, d, {
          ...genericContext,
          elaborateCurrentStructOrNamespace: namespace.id,
        }),
      );
      return namespace.id!;
    }

    case "StructDefinition": {
      if (item._semantic.symbol) {
        return item._semantic.symbol;
      }

      const generics = item.generics.map(
        (g) =>
          sr.symbolTable.makeSymbolAvailable({
            variant: "GenericParameter",
            name: g,
            belongsToStruct: item._collect.fullNamespacedName!,
            sourceloc: item.sourceloc,
            concrete: false,
          }).id,
      );

      const struct = sr.symbolTable.makeSymbolAvailable({
        variant: "StructDatatype",
        name: item.name,
        externLanguage: item.externLanguage,
        members: [],
        methods: [],
        definedInNamespaceOrStruct: genericContext.elaborateCurrentStructOrNamespace,
        genericSymbols: generics,
        fullNamespacedName: item._collect.fullNamespacedName!,
        namespaces: item._collect.namespaces!,
        concrete: generics.every((g) => getSymbol(sr, g).concrete),
      });
      assert(struct.variant === "StructDatatype");
      item._semantic.symbol = struct.id;

      // Add members
      struct.members = item.members.map((m) => {
        const resolved = resolveDatatype(sr, item._collect.scope!, m.type, genericContext);
        return sr.symbolTable.makeSymbolAvailable({
          variant: "Variable",
          name: m.name,
          externLanguage: EExternLanguage.None,
          export: false,
          mutable: true,
          definedInScope: item._collect.scope!.id,
          sourceLoc: m.sourceloc,
          type: resolved.id,
          variableContext: EVariableContext.MemberOfStruct,
          memberOf: struct.id,
          concrete: resolved.concrete,
        }).id;
      });

      // Add methods
      struct.methods = item.methods
        .map((m) => {
          m._semantic.memberOfSymbol = struct.id;
          return elaborate(sr, m, genericContext);
        })
        .filter(Boolean)
        .map((m) => m!);

      // Add drop function
      if (
        struct.methods.every(
          (m) => (getSymbol(sr, m) as Semantic.FunctionDeclarationSymbol).name !== "drop",
        )
      ) {
        if (!item._collect.scope) throw new ImpossibleSituation();
        const dropType = sr.symbolTable.makeSymbolAvailable({
          variant: "FunctionDatatype",
          concrete: struct.concrete,
          functionParameters: [],
          functionReturnValue: sr.symbolTable.makePrimitiveAvailable(EPrimitive.none).id,
          generics: [],
          vararg: false,
        });
        const drop = sr.symbolTable.makeSymbolAvailable({
          variant: "FunctionDefinition",
          export: false,
          concrete: struct.concrete,
          externLanguage: EExternLanguage.None,
          method: EMethodType.Drop,
          name: "drop",
          scope: new Semantic.Scope(item.sourceloc, item._collect.scope),
          type: dropType.id,
          methodOfSymbol: struct.id,
          nestedParentTypeSymbol: struct.id,
          sourceloc: item.sourceloc,
        });
        struct.methods.push(drop.id);
      }

      return struct.id;
    }

    default:
      throw new ImpossibleSituation();
  }
}

function analyzeGlobalScope(
  sr: SemanticResult,
  globalScope: Collect.Scope,
  genericContext: Semantic.GenericContext | null,
) {
  logger.trace("Analyzing global scope");
  if (!genericContext) {
    genericContext = {
      symbolToSymbol: new Map(),
      elaborateCurrentStructOrNamespace: null,
      datatypesDone: new Map(),
    };
  }
  for (const symbol of globalScope.symbolTable.symbols) {
    elaborate(sr, symbol, genericContext);
  }
}

export function SemanticallyAnalyze(globalScope: Collect.Scope) {
  const sr: SemanticResult = {
    symbolTable: new Semantic.SymbolTable(),
  };
  analyzeGlobalScope(sr, globalScope, null);

  const mainFunction = [...sr.symbolTable.getAll().values()].find(
    (s) =>
      s.variant === "FunctionDefinition" &&
      s.nestedParentTypeSymbol === undefined &&
      s.name === "main",
  ) as Semantic.FunctionDefinitionSymbol;
  if (!mainFunction) {
    throw new CompilerError("No main function is defined", {
      filename: "global",
      line: 0,
      column: 0,
    });
  }

  const funcType = getSymbol(sr, mainFunction.type);
  assert(funcType.variant === "FunctionDatatype");
  const retType = getSymbol(sr, funcType.functionReturnValue);
  if (retType.variant !== "PrimitiveDatatype" || retType.primitive !== EPrimitive.i32) {
    throw new CompilerError("Main function must return i32", mainFunction.sourceloc);
  }

  return sr;
}

export function PrettyPrintAnalyzed(sr: SemanticResult) {
  const indent = 0;

  const gray = "\x1b[90m";
  const reset = "\x1b[0m";

  const print = (str: string, color = reset) => {
    console.log(color + " ".repeat(indent) + str + reset);
  };

  print("Symbol Table:");
  for (const [id, symbol] of sr.symbolTable.getAll()) {
    switch (symbol.variant) {
      case "FunctionDatatype":
        print(
          ` - [${id}] FunctionType [${symbol.functionParameters.map((p) => `${p.name}: ${p.type}`).join(", ")}] => ${symbol.functionReturnValue} vararg=${symbol.vararg}`,
          symbol.concrete ? reset : gray,
        );
        break;

      case "PrimitiveDatatype":
        print(
          ` - [${id}] PrimitiveType ${primitiveToString(symbol.primitive)}`,
          symbol.concrete ? reset : gray,
        );
        break;

      case "StructDatatype":
        let s = "(" + symbol.fullNamespacedName.join(".");
        if (symbol.genericSymbols.length > 0) {
          s += " generics=[" + symbol.genericSymbols.join(", ") + "]";
        }
        s += ")";
        print(
          ` - [${id}] StructType ${s} members=${symbol.members.map((id) => id).join(", ")}`,
          symbol.concrete ? reset : gray,
        );
        break;

      case "DeferredDatatype":
        print(` - [${id}] Deferred`, symbol.concrete ? reset : gray);
        break;

      case "RawPointerDatatype":
        print(` - [${id}] RawPointer pointee=${symbol.pointee}`, symbol.concrete ? reset : gray);
        break;

      case "ReferenceDatatype":
        print(` - [${id}] Reference referee=${symbol.referee}`, symbol.concrete ? reset : gray);
        break;

      case "CallableDatatype":
        print(
          ` - [${id}] Callable functionType=${symbol.functionType} thisExprType=${symbol.thisExprType}`,
          symbol.concrete ? reset : gray,
        );
        break;

      case "FunctionDeclaration":
        print(
          ` - [${id}] FuncDecl ${symbol.name}() type=${symbol.type}`,
          symbol.concrete ? reset : gray,
        );
        break;

      case "FunctionDefinition":
        print(
          ` - [${id}] FuncDef ${symbol.name}() type=${symbol.type} methodOf=${symbol.methodOfSymbol} parent=${symbol.nestedParentTypeSymbol}`,
          symbol.concrete ? reset : gray,
        );
        break;

      case "GenericParameter":
        print(` - [${id}] GenericParameter ${symbol.name}`, symbol.concrete ? reset : gray);
        break;

      case "Variable":
        print(
          ` - [${id}] Variable ${symbol.name} typeSymbol=${symbol.type} memberOf=${symbol.memberOf}`,
          symbol.concrete ? reset : gray,
        );
        break;
    }
  }
  print("\n");
}
