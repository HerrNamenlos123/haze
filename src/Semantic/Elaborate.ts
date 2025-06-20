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
import { CompilerError, ImpossibleSituation, InternalError } from "../shared/Errors";
import { makeCollectScopeId, type SemanticSymbolId } from "../shared/store";
import { Collect } from "../SymbolCollection/CollectSymbols";
import { hasOnlyDuplicates } from "../utils";
import { Conversion } from "./Conversion";
import { instantiateDatatype, instantiateSymbol } from "./Instantiate";
import { resolveDatatype } from "./Resolve";
import {
  getSymbol,
  getType,
  getTypeFromSymbol,
  Semantic,
  type SemanticResult,
} from "./SemanticSymbols";

export function elaborateExpr(
  sr: SemanticResult,
  scope: Semantic.Scope,
  expr: ASTExpr,
  genericContext: Semantic.GenericContext | null,
): Semantic.Expression {
  if (!genericContext) {
    genericContext = {
      symbolToSymbol: new Map(),
      datatypesDone: new Map(),
    };
  }

  switch (expr.variant) {
    case "BinaryExpr": {
      const a = elaborateExpr(sr, scope, expr.a, genericContext);
      const b = elaborateExpr(sr, scope, expr.b, genericContext);

      const leftType = getTypeFromSymbol(sr, a.typeSymbol);
      const rightType = getTypeFromSymbol(sr, a.typeSymbol);

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
              typeSymbol: sr.symbolTable.makeDatatypeSymbolAvailable(
                Conversion.getIntegerBinaryResult(leftType, rightType).id!,
                true,
              ).id,
              sourceloc: expr.sourceloc,
            };
          }
          if (Conversion.isF32(leftType) && Conversion.isF32(rightType)) {
            return {
              variant: "BinaryExpr",
              left: a,
              operation: expr.operation,
              right: b,
              typeSymbol: sr.symbolTable.makeDatatypeSymbolAvailable(
                sr.typeTable.makePrimitiveDatatypeAvailable(EPrimitive.f32).id,
                true,
              ).id,
              sourceloc: expr.sourceloc,
            };
          } else if (Conversion.isFloat(leftType) && Conversion.isFloat(rightType)) {
            return {
              variant: "BinaryExpr",
              left: a,
              operation: expr.operation,
              right: b,
              typeSymbol: sr.symbolTable.makeDatatypeSymbolAvailable(
                sr.typeTable.makePrimitiveDatatypeAvailable(EPrimitive.f64).id,
                true,
              ).id,
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
              typeSymbol: sr.symbolTable.makeDatatypeSymbolAvailable(
                sr.typeTable.makePrimitiveDatatypeAvailable(EPrimitive.f64).id,
                true,
              ).id,
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
              typeSymbol: sr.symbolTable.makeDatatypeSymbolAvailable(
                sr.typeTable.makePrimitiveDatatypeAvailable(EPrimitive.boolean).id,
                true,
              ).id,
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
              typeSymbol: sr.symbolTable.makeDatatypeSymbolAvailable(
                sr.typeTable.makePrimitiveDatatypeAvailable(EPrimitive.boolean).id,
                true,
              ).id,
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
              typeSymbol: sr.symbolTable.makeDatatypeSymbolAvailable(
                sr.typeTable.makePrimitiveDatatypeAvailable(EPrimitive.boolean).id,
                true,
              ).id,
              sourceloc: expr.sourceloc,
            };
          }
          break;

        default:
          throw new ImpossibleSituation();
      }

      if (leftType.variant === "Deferred" || rightType.variant === "Deferred") {
        return {
          variant: "BinaryExpr",
          left: a,
          operation: expr.operation,
          right: b,
          typeSymbol: sr.symbolTable.makeDatatypeSymbolAvailable(
            sr.typeTable.makeDatatypeAvailable({ variant: "Deferred", concrete: false }).id,
            false,
          ).id,
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
        const dt = sr.typeTable.makePrimitiveDatatypeAvailable(EPrimitive.boolean);
        const sym = sr.symbolTable.makeDatatypeSymbolAvailable(dt.id, true);
        return {
          variant: "Constant",
          typeSymbol: sym.id,
          value: expr.constant.value,
          sourceloc: expr.sourceloc,
        };
      } else if (expr.constant.variant === "NumberConstant") {
        const dt = sr.typeTable.makePrimitiveDatatypeAvailable(EPrimitive.i32);
        const sym = sr.symbolTable.makeDatatypeSymbolAvailable(dt.id, true);
        return {
          variant: "Constant",
          typeSymbol: sym.id,
          value: expr.constant.value,
          sourceloc: expr.sourceloc,
        };
      } else {
        const dt = sr.typeTable.makePrimitiveDatatypeAvailable(EPrimitive.str);
        const sym = sr.symbolTable.makeDatatypeSymbolAvailable(dt.id, true);
        return {
          variant: "Constant",
          typeSymbol: sym.id,
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
      const type = getTypeFromSymbol(sr, calledExpr.typeSymbol);

      if (type.variant === "Callable") {
        const callableFunc = getTypeFromSymbol(sr, calledExpr.typeSymbol);
        if (callableFunc.variant !== "Callable") throw new ImpossibleSituation();
        const ftype = getTypeFromSymbol(sr, callableFunc.functionType);
        if (ftype.variant !== "Function") throw new ImpossibleSituation();
        return {
          variant: "ExprCall",
          calledExpr: calledExpr,
          arguments: args,
          typeSymbol: getSymbol(sr, ftype.functionReturnValue).id!,
          sourceloc: expr.sourceloc,
        };
      }

      if (type.variant === "Function") {
        return {
          variant: "ExprCall",
          calledExpr: calledExpr,
          arguments: args,
          typeSymbol: getSymbol(sr, type.functionReturnValue).id!,
          sourceloc: expr.sourceloc,
        };
      } else if (type.variant === "Struct") {
        throw new CompilerError(
          `Expression of type Struct ${type.name} is not callable`,
          expr.sourceloc,
        );
      } else if (type.variant === "Primitive") {
        throw new CompilerError(
          `Expression of type ${primitiveToString(type.primitive)} is not callable`,
          expr.sourceloc,
        );
      } else if (type.variant === "Namespace") {
        throw new CompilerError(`Expression of type Namespace is not callable`, expr.sourceloc);
      } else if (type.variant === "RawPointer") {
        throw new CompilerError(`Expression of type Pointer is not callable`, expr.sourceloc);
      } else if (type.variant === "Reference") {
        throw new CompilerError(`Expression of type Reference is not callable`, expr.sourceloc);
      }
      throw new ImpossibleSituation();
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
        const variableSymbol = getSymbol(sr, symbol._semantic.symbol) as Semantic.VariableSymbol;

        return {
          variant: "SymbolValue",
          symbol: variableSymbol.id!,
          typeSymbol: variableSymbol.typeSymbol,
          sourceloc: expr.sourceloc,
        };
      } else if (
        symbol.variant === "FunctionDeclaration" ||
        symbol.variant === "FunctionDefinition"
      ) {
        if (!symbol._semantic.symbol) throw new ImpossibleSituation();
        const rawFunctionSymbol = getSymbol(sr, symbol._semantic.symbol) as
          | Semantic.FunctionDeclarationSymbol
          | Semantic.FunctionDefinitionSymbol;

        const functionSymbol = instantiateSymbol(sr, rawFunctionSymbol.id!, {
          symbolToSymbol: new Map(genericContext.symbolToSymbol),
          datatypesDone: new Map(genericContext.datatypesDone),
        });
        if (
          functionSymbol.variant !== "FunctionDefinition" &&
          functionSymbol.variant !== "FunctionDeclaration"
        ) {
          throw new ImpossibleSituation();
        }
        return {
          variant: "SymbolValue",
          symbol: functionSymbol.id,
          typeSymbol: functionSymbol.typeSymbol,
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
        typeSymbol: resolveDatatype(sr, scope.collectScope, expr.castedTo, genericContext).id,
        expr: elaborateExpr(sr, scope, expr.expr, genericContext),
        sourceloc: expr.sourceloc,
      };
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExprMemberAccess": {
      const object = elaborateExpr(sr, scope, expr.expr, genericContext);
      const structType = getTypeFromSymbol(sr, object.typeSymbol);
      if (structType.variant !== "Struct") {
        throw new CompilerError("Cannot access member of a non-structural type", expr.sourceloc);
      }

      const memberId = structType.members.find((m) => {
        const mm = sr.symbolTable.get(m)! as Semantic.VariableSymbol;
        return mm.name === expr.member;
      });
      const methodId = structType.methods.find((m) => {
        const mm = sr.symbolTable.get(m)! as Semantic.FunctionDefinitionSymbol;
        return mm.name === expr.member;
      });

      if (memberId) {
        const member = getSymbol(sr, memberId) as Semantic.VariableSymbol;
        const memberTypeSymbol = getSymbol(sr, member.typeSymbol);

        return {
          variant: "ExprMemberAccess",
          expr: object,
          memberName: expr.member,
          typeSymbol: memberTypeSymbol.id!,
          sourceloc: expr.sourceloc,
        };
      } else if (methodId) {
        const method = getSymbol(sr, methodId) as
          | Semantic.FunctionDeclarationSymbol
          | Semantic.FunctionDefinitionSymbol;
        const methodFuncTypeSymbol = getSymbol(sr, method.typeSymbol);

        const objRef = sr.typeTable.makeDatatypeAvailable({
          variant: "Reference",
          referee: object.typeSymbol,
          concrete: getTypeFromSymbol(sr, object.typeSymbol).concrete,
        });

        const callable = sr.typeTable.makeDatatypeAvailable({
          variant: "Callable",
          thisExprType: sr.symbolTable.makeDatatypeSymbolAvailable(objRef.id, objRef.concrete).id,
          functionType: methodFuncTypeSymbol.id,
          concrete: methodFuncTypeSymbol.concrete,
        });

        return {
          variant: "CallableExpr",
          thisExpr: object,
          functionSymbol: method.id!,
          typeSymbol: sr.symbolTable.makeDatatypeSymbolAvailable(callable.id!, callable.concrete)
            .id,
          sourceloc: expr.sourceloc,
        };
      } else {
        throw new CompilerError(`No such member in struct ${structType.name}`, expr.sourceloc);
      }
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "StructInstantiationExpr": {
      const symbol = resolveDatatype(sr, scope.collectScope, expr.datatype, genericContext);
      if (symbol.variant !== "Datatype") throw new ImpossibleSituation();
      const type = getType(sr, symbol.type);
      if (type.variant !== "Struct")
        throw new CompilerError("This type cannot be instantiated", expr.sourceloc);

      let remainingMembers = type.members.map(
        (m) => (getSymbol(sr, m) as Semantic.VariableSymbol).name,
      );
      const assignedMembers: string[] = [];
      const assign: {
        name: string;
        value: Semantic.Expression;
      }[] = [];
      for (const m of expr.members) {
        const e = elaborateExpr(sr, scope, m.value, genericContext);

        const variableId = type.members.find((mm) => {
          const s = getSymbol(sr, mm);
          if (s.variant !== "Variable") throw new ImpossibleSituation();
          return s.name === m.name;
        });

        if (!variableId) {
          throw new CompilerError(`Member with name ${m.name} does not exist`, expr.sourceloc);
        }
        const variable = getSymbol(sr, variableId) as Semantic.VariableSymbol;
        const variableTypeSymbol = getSymbol(sr, variable.typeSymbol);
        if (
          variableTypeSymbol.variant !== "GenericParameter" &&
          variableTypeSymbol.variant !== "Datatype"
        )
          throw new ImpossibleSituation();

        if (assignedMembers.includes(m.name)) {
          throw new CompilerError(`Cannot assign member ${m.name} twice`, expr.sourceloc);
        }

        if (variableTypeSymbol.variant !== "GenericParameter") {
          if (e.typeSymbol !== variableTypeSymbol.id) {
            throw new CompilerError(
              `Member assignment ${m.name} has type mismatch`,
              expr.sourceloc,
            );
          }
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
        typeSymbol: symbol.id!,
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
        typeSymbolId = expr.typeSymbol;
      }

      const symbol = sr.symbolTable.makeSymbolAvailable({
        variant: "Variable",
        export: false,
        externLanguage: EExternLanguage.None,
        mutable: s.mutable,
        name: s.name,
        typeSymbol: typeSymbolId,
        definedInScope: scope.id,
        sourceLoc: s.sourceloc,
        variableContext: EVariableContext.FunctionLocal,
        memberOfType: undefined,
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
      scope.returnedTypes.push(statement.expr?.typeSymbol);
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
        typeSymbol: resolved.id,
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
        typeSymbol: resolved.id,
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
      const type: ASTFunctionDatatype = {
        variant: "FunctionDatatype",
        params: item.params,
        ellipsis: item.ellipsis,
        returnType: item.returnType!,
        sourceloc: item.sourceloc,
      };

      // Now add this pointer to method
      if (!item._semantic.memberOfSymbol) throw new ImpossibleSituation();
      const struct = getTypeFromSymbol(sr, item._semantic.memberOfSymbol);
      if (struct.variant !== "Struct") throw new ImpossibleSituation();
      const thisType: ASTParam = {
        name: "this",
        datatype: {
          variant: "Deferred",
        },
        sourceloc: item.sourceloc,
      };
      type.params = [thisType, ...type.params];

      const resolved = resolveDatatype(sr, item._collect.definedInScope!, type, genericContext);

      // Second part of this pointer
      const functype = getTypeFromSymbol(sr, resolved.id) as Semantic.FunctionDatatype;
      for (const param of functype.functionParameters) {
        if (param.name === "this") {
          const thisReference = sr.typeTable.makeDatatypeAvailable({
            variant: "Reference",
            referee: item._semantic.memberOfSymbol,
            concrete: struct.concrete,
          });
          param.type = sr.symbolTable.makeDatatypeSymbolAvailable(
            thisReference.id,
            thisReference.concrete,
          ).id;
        }
      }

      let symbol = sr.symbolTable.defineSymbol({
        variant: "FunctionDefinition",
        typeSymbol: resolved.id,
        export: false,
        externLanguage: EExternLanguage.None,
        method: EMethodType.Method,
        name: item.name,
        sourceloc: item.sourceloc,
        methodOfSymbol: item._semantic.memberOfSymbol,
        scope: new Semantic.Scope(item.sourceloc, assertScope(item.funcbody._collect.scope)),
        nestedParentTypeSymbol: item._semantic.memberOfSymbol,
        concrete: resolved.concrete,
      });
      if (symbol.variant !== "FunctionDefinition") {
        throw new ImpossibleSituation();
      }
      item._semantic.symbol = symbol.id;

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
      if (genericContext.elaborateCurrentStructOrNamespace === undefined) {
        throw new ImpossibleSituation();
      }
      const namespace = sr.symbolTable.makeSymbolAvailable({
        variant: "Namespace",
        name: item.name,
        declarations: [],
        nestedParentTypeSymbol: genericContext.elaborateCurrentStructOrNamespace,
        concrete: true,
      }) as Semantic.NamespaceSymbol;
      logger.debug("Defined Namespace " + namespace.name + " " + namespace.id);
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

      if (genericContext.elaborateCurrentStructOrNamespace === undefined) {
        throw new ImpossibleSituation();
      }
      const struct = sr.typeTable.makeDatatypeAvailable({
        variant: "Struct",
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
      if (struct.variant !== "Struct") throw new ImpossibleSituation();
      item._semantic.type = struct.id;

      const structSym = sr.symbolTable.makeSymbolAvailable({
        variant: "Datatype",
        export: false,
        type: struct.id,
        concrete: struct.concrete,
      });
      item._semantic.symbol = structSym.id;

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
          typeSymbol: resolved.id,
          variableContext: EVariableContext.MemberOfStruct,
          memberOfType: struct.id,
          concrete: resolved.concrete,
        }).id;
      });

      // Add methods
      struct.methods = item.methods
        .map((m) => {
          m._semantic.memberOfSymbol = structSym.id;
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
        const dropType = sr.typeTable.makeDatatypeAvailable({
          variant: "Function",
          concrete: struct.concrete,
          functionParameters: [],
          functionReturnValue: sr.symbolTable.makeDatatypeSymbolAvailable(
            sr.typeTable.makePrimitiveDatatypeAvailable(EPrimitive.none).id,
            struct.concrete,
          ).id,
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
          typeSymbol: sr.symbolTable.makeDatatypeSymbolAvailable(dropType.id, struct.concrete).id,
          methodOfSymbol: structSym.id,
          nestedParentTypeSymbol: structSym.id,
          sourceloc: item.sourceloc,
        });
        struct.methods.push(drop.id);
      }

      return sr.symbolTable.makeDatatypeSymbolAvailable(struct.id, struct.concrete).id;
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
    typeTable: new Semantic.TypeTable(),
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

  const funcType = getTypeFromSymbol(sr, mainFunction.typeSymbol) as Semantic.FunctionDatatype;
  const retType = getTypeFromSymbol(sr, funcType.functionReturnValue);
  if (retType.variant !== "Primitive" || retType.primitive !== EPrimitive.i32) {
    throw new CompilerError("main function must return i32", mainFunction.sourceloc);
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

  print("Datatype Table:");
  for (const [id, type] of sr.typeTable.getAll()) {
    switch (type.variant) {
      case "Function":
        print(
          ` - [${id}] FunctionType [${type.functionParameters.map((p) => `${p.name}: ${p.type}`).join(", ")}] => ${type.functionReturnValue} vararg=${type.vararg}`,
          type.concrete ? reset : gray,
        );
        break;

      case "Primitive":
        print(
          ` - [${id}] PrimitiveType ${primitiveToString(type.primitive)}`,
          type.concrete ? reset : gray,
        );
        break;

      case "Struct":
        let s = "(" + type.fullNamespacedName.join(".");
        if (type.genericSymbols.length > 0) {
          s += " generics=[" + type.genericSymbols.join(", ") + "]";
        }
        s += ")";
        print(
          ` - [${id}] StructType ${s} members=${type.members.map((id) => id).join(", ")}`,
          type.concrete ? reset : gray,
        );
        break;

      case "Deferred":
        print(` - [${id}] Deferred`, type.concrete ? reset : gray);
        break;

      case "RawPointer":
        print(` - [${id}] RawPointer pointee=${type.pointee}`, type.concrete ? reset : gray);
        break;

      case "Reference":
        print(` - [${id}] Reference referee=${type.referee}`, type.concrete ? reset : gray);
        break;

      case "Callable":
        print(
          ` - [${id}] Callable functionType=${type.functionType} thisExprType=${type.thisExprType}`,
          type.concrete ? reset : gray,
        );
        break;

      // case "GenericPlaceholder":
      //   print(
      //     ` - [${id}] GenericPlaceholder ${type.name} ofType=${type.belongsToType}`,
      //   );
      //   break;
    }
  }
  print("\n");

  print("Symbol Table:");
  for (const [id, symbol] of sr.symbolTable.getAll()) {
    switch (symbol.variant) {
      case "Datatype":
        print(` - [${id}] Datatype type=${symbol.type}`, symbol.concrete ? reset : gray);
        break;

      case "FunctionDeclaration":
        print(
          ` - [${id}] FuncDecl ${symbol.name}() type=${symbol.typeSymbol}`,
          symbol.concrete ? reset : gray,
        );
        break;

      case "FunctionDefinition":
        print(
          ` - [${id}] FuncDef ${symbol.name}() type=${symbol.typeSymbol} methodOf=${symbol.methodOfSymbol} parent=${symbol.nestedParentTypeSymbol}`,
          symbol.concrete ? reset : gray,
        );
        break;

      case "GenericParameter":
        print(` - [${id}] GenericParameter ${symbol.name}`, symbol.concrete ? reset : gray);
        break;

      case "Variable":
        print(
          ` - [${id}] Variable ${symbol.name} typeSymbol=${symbol.typeSymbol} memberOf=${symbol.memberOfType}`,
          symbol.concrete ? reset : gray,
        );
        break;
    }
  }
  print("\n");
}
