import { logger } from "../log/log";
import {
  EBinaryOperation,
  EExternLanguage,
  type ASTExpr,
  type ASTFunctionDatatype,
  type ASTNamedDatatype,
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
import {
  assert,
  CompilerError,
  ImpossibleSituation,
  InternalError,
  type SourceLoc,
} from "../shared/Errors";
import { type SemanticSymbolId } from "../shared/store";
import { Collect } from "../SymbolCollection/CollectSymbols";
import { Conversion } from "./Conversion";
import { instantiateSymbol } from "./Instantiate";
import { resolveDatatype } from "./Resolve";
import { Semantic, type SemanticResult } from "./SemanticSymbols";

export function elaborateExpr(
  sr: SemanticResult,
  scope: Semantic.BlockScope,
  expr: ASTExpr,
  genericContext?: Semantic.GenericContext,
): Semantic.Expression {
  if (!genericContext) {
    genericContext = {
      mapping: new Map(),
      datatypesDone: new Map(),
    };
  }

  switch (expr.variant) {
    case "BinaryExpr": {
      const a = elaborateExpr(sr, scope, expr.a, genericContext);
      const b = elaborateExpr(sr, scope, expr.b, genericContext);

      const leftType = a.type;
      const rightType = a.type;

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
              type: Conversion.getIntegerBinaryResult(leftType, rightType),
              sourceloc: expr.sourceloc,
            };
          }
          if (Conversion.isF32(leftType) && Conversion.isF32(rightType)) {
            return {
              variant: "BinaryExpr",
              left: a,
              operation: expr.operation,
              right: b,
              type: sr.globalScope.makePrimitiveAvailable(EPrimitive.f32),
              sourceloc: expr.sourceloc,
            };
          } else if (Conversion.isFloat(leftType) && Conversion.isFloat(rightType)) {
            return {
              variant: "BinaryExpr",
              left: a,
              operation: expr.operation,
              right: b,
              type: sr.globalScope.makePrimitiveAvailable(EPrimitive.f64),
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
              type: sr.globalScope.makePrimitiveAvailable(EPrimitive.f64),
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
              type: sr.globalScope.makePrimitiveAvailable(EPrimitive.boolean),
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
              type: sr.globalScope.makePrimitiveAvailable(EPrimitive.boolean),
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
              type: sr.globalScope.makePrimitiveAvailable(EPrimitive.boolean),
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
          type: {
            variant: "DeferredDatatype",
            concrete: false,
          },
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
          type: sr.globalScope.makePrimitiveAvailable(EPrimitive.boolean),
          value: expr.constant.value,
          sourceloc: expr.sourceloc,
        };
      } else if (expr.constant.variant === "NumberConstant") {
        return {
          variant: "Constant",
          type: sr.globalScope.makePrimitiveAvailable(EPrimitive.i32),
          value: expr.constant.value,
          sourceloc: expr.sourceloc,
        };
      } else {
        return {
          variant: "Constant",
          type: sr.globalScope.makePrimitiveAvailable(EPrimitive.str),
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

      if (calledExpr.type.variant === "CallableDatatype") {
        return {
          variant: "ExprCall",
          calledExpr: calledExpr,
          arguments: args,
          type: calledExpr.type.functionType.functionReturnValue,
          sourceloc: expr.sourceloc,
        };
      }

      if (calledExpr.type.variant === "FunctionDatatype") {
        return {
          variant: "ExprCall",
          calledExpr: calledExpr,
          arguments: args,
          type: calledExpr.type.functionReturnValue,
          sourceloc: expr.sourceloc,
        };
      } else if (calledExpr.type.variant === "StructDatatype") {
        throw new CompilerError(
          `Expression of type Struct ${calledExpr.type.name} is not callable`,
          expr.sourceloc,
        );
      } else if (calledExpr.type.variant === "PrimitiveDatatype") {
        throw new CompilerError(
          `Expression of type ${primitiveToString(calledExpr.type.primitive)} is not callable`,
          expr.sourceloc,
        );
      } else if (calledExpr.type.variant === "RawPointerDatatype") {
        throw new CompilerError(`Expression of type Pointer is not callable`, expr.sourceloc);
      } else if (calledExpr.type.variant === "ReferenceDatatype") {
        throw new CompilerError(`Expression of type Reference is not callable`, expr.sourceloc);
      }
      assert(false && "All cases handled");
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "SymbolValueExpr": {
      const symbol = scope.symbolTable.lookupSymbolHere(expr.name, expr.sourceloc);
      if (symbol.variant === "Variable") {
        return {
          variant: "SymbolValue",
          symbol: symbol,
          type: symbol.type,
          sourceloc: expr.sourceloc,
        };
      } else if (
        symbol.variant === "FunctionDeclaration" ||
        symbol.variant === "FunctionDefinition"
      ) {
        const functionSymbol = instantiateSymbol(sr, symbol, {
          mapping: new Map(genericContext.mapping),
          currentStructOrNamespace: genericContext.currentStructOrNamespace,
          datatypesDone: new Map(genericContext.datatypesDone),
        });
        assert(
          functionSymbol.variant === "FunctionDefinition" ||
            functionSymbol.variant === "FunctionDeclaration",
        );
        return {
          variant: "SymbolValue",
          symbol: functionSymbol,
          type: functionSymbol.type,
          sourceloc: expr.sourceloc,
        };
      } else {
        throw new CompilerError(`Symbol cannot be used as a value`, expr.sourceloc);
      }
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExplicitCastExpr": {
      return {
        variant: "ExplicitCast",
        type: resolveDatatype(sr, scope, expr.castedTo, genericContext),
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
      let type = object.type;
      let isReference = false;

      if (type.variant === "ReferenceDatatype") {
        type = type.referee;
        isReference = true;
      }

      if (type.variant !== "StructDatatype") {
        throw new CompilerError("Cannot access member of a non-structural type", expr.sourceloc);
      }

      const member = type.members.find((m) => {
        return m.name === expr.member;
      });
      const method = type.methods.find((m) => {
        return m.name === expr.member;
      });

      if (member) {
        return {
          variant: "ExprMemberAccess",
          expr: object,
          memberName: expr.member,
          isReference: isReference,
          type: member.type,
          sourceloc: expr.sourceloc,
        };
      } else if (method) {
        console.log("Calling method ", method.name);
        return {
          variant: "CallableExpr",
          thisExpr: object,
          functionSymbol: instantiateSymbol(sr, method, genericContext, {
            newMemberOf:
              method.nestedParentTypeSymbol?.variant === "StructDatatype"
                ? method.nestedParentTypeSymbol
                : undefined,
          }),
          type: {
            variant: "CallableDatatype",
            thisExprType: {
              variant: "ReferenceDatatype",
              referee: object.type,
              concrete: object.type.concrete,
            },
            functionType: method.type,
            concrete: method.type.concrete,
          },
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
      const struct = resolveDatatype(sr, scope, expr.datatype, genericContext);
      assert(struct.variant === "StructDatatype");

      let remainingMembers = struct.members.map((m) => m.name);
      const assignedMembers: string[] = [];
      const assign: {
        name: string;
        value: Semantic.Expression;
      }[] = [];
      for (const m of expr.members) {
        const e = elaborateExpr(sr, scope, m.value, genericContext);

        const variable = struct.members.find((mm) => {
          assert(mm.variant === "Variable");
          return mm.name === m.name;
        });

        if (!variable) {
          throw new CompilerError(`Member with name ${m.name} does not exist`, expr.sourceloc);
        }
        assert(variable.variant === "Variable");

        if (assignedMembers.includes(m.name)) {
          throw new CompilerError(`Cannot assign member ${m.name} twice`, expr.sourceloc);
        }

        if (e.type !== variable.type) {
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
        type: struct,
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
  scope: Semantic.BlockScope,
  s: ASTStatement,
  genericContext: Semantic.GenericContext | null,
): Semantic.Statement {
  if (!genericContext) {
    genericContext = {
      mapping: new Map(),
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
      const thenScope = new Semantic.BlockScope(
        s.sourceloc,
        assertScope(s.then._collect.scope).rawStatements,
      );
      elaborateScope(sr, thenScope, genericContext);
      const elseIfs = s.elseIfs.map((e) => {
        const newScope = new Semantic.BlockScope(
          s.sourceloc,
          assertScope(e.then._collect.scope).rawStatements,
        );
        elaborateScope(sr, newScope, genericContext);
        return {
          condition: elaborateExpr(sr, scope, e.condition, genericContext),
          then: newScope,
        };
      });

      let elseScope: Semantic.BlockScope | undefined = undefined;
      if (s.else) {
        elseScope = new Semantic.BlockScope(
          s.sourceloc,
          assertScope(s.else._collect.scope).rawStatements,
        );
        elaborateScope(sr, elseScope, genericContext);
      }
      return {
        variant: "IfStatement",
        condition: condition,
        then: thenScope,
        elseIfs: elseIfs,
        else: elseScope,
        sourceloc: s.sourceloc,
      };
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "WhileStatement": {
      const newScope = new Semantic.BlockScope(
        s.sourceloc,
        assertScope(s.body._collect.scope).rawStatements,
      );
      elaborateScope(sr, newScope, genericContext);
      return {
        variant: "WhileStatement",
        condition: elaborateExpr(sr, scope, s.condition, genericContext),
        then: newScope,
        sourceloc: s.sourceloc,
      };
    }

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
      let type: Semantic.DatatypeSymbol | undefined = undefined;
      if (s.datatype) {
        type = resolveDatatype(sr, scope, s.datatype, genericContext);
      } else {
        assert(expr);
        type = expr.type;
      }
      assert(type);

      const symbol: Semantic.VariableSymbol = {
        variant: "Variable",
        export: false,
        externLanguage: EExternLanguage.None,
        mutable: s.mutable,
        name: s.name,
        type: type,
        sourceloc: s.sourceloc,
        variableContext: EVariableContext.FunctionLocal,
        memberOf: undefined,
        concrete: type.concrete,
      };
      // s._semantic.symbol = symbol.id;

      return {
        variant: "VariableStatement",
        mutable: s.mutable,
        name: s.name,
        variableSymbol: symbol,
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
  scope: Semantic.BlockScope,
  genericContext: Semantic.GenericContext | null,
) {
  if (!genericContext) {
    genericContext = {
      mapping: new Map(),
      datatypesDone: new Map(),
    };
  }

  scope.statements = [];
  for (const s of scope.rawStatements) {
    const statement = elaborateStatement(sr, scope, s, genericContext);
    scope.statements.push(statement);

    if (statement.variant === "ReturnStatement") {
      scope.returnedTypes.push(statement.expr?.type);
    }
  }
}

export function defineThisReference(
  sr: SemanticResult,
  scope: Semantic.BlockScope,
  parentStruct: Semantic.StructDatatypeSymbol,
  genericContext: Semantic.GenericContext,
) {
  const thisType = instantiateSymbol(sr, parentStruct, genericContext);
  const thisReference: Semantic.DatatypeSymbol = {
    variant: "ReferenceDatatype",
    referee: thisType,
    concrete: thisType.concrete,
  };
  scope.symbolTable.defineSymbol({
    variant: "Variable",
    mutable: false,
    name: "this",
    type: thisReference,
    concrete: thisReference.concrete,
    export: false,
    externLanguage: EExternLanguage.None,
    sourceloc: scope.sourceloc,
    variableContext: EVariableContext.FunctionParameter,
  });
}

export function elaborate(
  sr: SemanticResult,
  item: Collect.Symbol,
  scope: Semantic.DeclScope | Semantic.BlockScope,
  collectScope: Collect.Scope,
  genericContext: Semantic.GenericContext | null,
): Semantic.Symbol {
  logger.trace("elaborate()");
  if (!genericContext) {
    genericContext = {
      mapping: new Map(),
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

      const resolved = resolveDatatype(sr, type, scope, collectScope, genericContext);
      assert(resolved.variant === "FunctionDatatype");
      assert(item.methodType !== undefined);
      const symbol: Semantic.FunctionDeclarationSymbol = {
        variant: "FunctionDeclaration",
        type: resolved,
        export: item.export,
        externLanguage: item.externLanguage,
        methodType: item.methodType,
        nestedParentTypeSymbol: genericContext.currentStructOrNamespace,
        name: item.name,
        sourceloc: item.sourceloc,
        concrete: resolved.concrete,
      };
      return symbol;
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

      const resolved = resolveDatatype(sr, type, scope, collectScope, genericContext);
      assert(resolved.variant === "FunctionDatatype");
      assert(item.funcbody.variant === "Scope");
      let symbol: Semantic.FunctionDefinitionSymbol = {
        variant: "FunctionDefinition",
        type: resolved,
        export: item.export,
        nestedParentTypeSymbol: genericContext.currentStructOrNamespace || undefined,
        externLanguage: item.externLanguage,
        methodType: item._collect.method!,
        name: item.name,
        sourceloc: item.sourceloc,
        scope: undefined,
        concrete: resolved.concrete,
      };
      if (symbol.variant !== "FunctionDefinition") {
        throw new ImpossibleSituation();
      }

      if (item.funcbody._collect.scope && symbol.concrete && !symbol.scope) {
        symbol.scope = new Semantic.BlockScope(item.sourceloc, item.funcbody.statements, scope);
        // item.funcbody._collect.scope._semantic.forFunctionSymbol = symbol;

        elaborateScope(sr, symbol.scope!, genericContext);
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

      return symbol;
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
      const struct = genericContext.currentStructOrNamespace;
      console.log(genericContext);
      assert(struct?.variant === "StructDatatype");
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
        methodFunctype,
        scope,
        collectScope,
        genericContext,
      );

      // Second part of this pointer
      assert(resolvedMethodFunctype.variant === "FunctionDatatype");
      const thisTyped = instantiateSymbol(sr, struct, genericContext);
      const thisReference: Semantic.DatatypeSymbol = {
        variant: "ReferenceDatatype",
        referee: thisTyped,
        concrete: thisTyped.concrete,
      };
      for (const param of resolvedMethodFunctype.functionParameters) {
        if (param.name === "this") {
          param.type = thisReference;
        }
      }
      resolvedMethodFunctype.concrete =
        resolvedMethodFunctype.functionParameters.every((p) => p.type.concrete) &&
        resolvedMethodFunctype.functionReturnValue.concrete &&
        resolvedMethodFunctype.generics.every((g) => g.concrete);

      resolvedMethodFunctype = instantiateSymbol(sr, resolvedMethodFunctype, genericContext);

      let symbol: Semantic.FunctionDefinitionSymbol = {
        variant: "FunctionDefinition",
        type: resolvedMethodFunctype,
        export: false,
        externLanguage: EExternLanguage.None,
        methodType: EMethodType.Method,
        name: item.name,
        sourceloc: item.sourceloc,
        methodOf: struct,
        scope: undefined,
        nestedParentTypeSymbol: struct,
        concrete: resolvedMethodFunctype.concrete,
      };
      if (symbol.variant !== "FunctionDefinition") {
        throw new ImpossibleSituation();
      }
      // item._semantic.symbol = symbol.id;
      // console.log("Elaborated method ", symbol.name, symbol.methodOf);

      if (item.funcbody._collect.scope && symbol.concrete && !symbol.scope) {
        // item.funcbody._collect.scope._semantic.forFunctionSymbol = symbol;
        assert(symbol.collectedScope);
        symbol.scope = new Semantic.BlockScope(
          symbol.sourceloc,
          symbol.collectedScope.rawStatements,
        );
        defineThisReference(sr, symbol.scope, struct, genericContext);
        elaborateScope(sr, symbol.scope, genericContext);
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

      return symbol;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "NamespaceDefinition": {
      assert(genericContext.currentStructOrNamespace !== undefined);
      const namespace: Semantic.NamespaceSymbol = {
        variant: "Namespace",
        name: item.name,
        declarations: [],
        nestedParentTypeSymbol: genericContext.currentStructOrNamespace,
        scope: new Semantic.DeclScope(
          item.sourceloc,
          genericContext.currentStructOrNamespace?.scope,
        ),
        sourceloc: item.sourceloc,
        concrete: true,
      };
      namespace.declarations = item.declarations.map((d) =>
        elaborate(sr, d, scope, collectScope, {
          ...genericContext,
          currentStructOrNamespace: namespace,
        }),
      );
      return namespace;
    }

    case "StructDefinition": {
      // if (item._semantic.symbol) {
      //   return item._semantic.symbol;
      // }
      const generics: Semantic.GenericParameterSymbol[] = item.generics.map((g) => ({
        variant: "GenericParameter",
        name: g,
        uniqueNamespacedIdentifier: item._collect.fullNamespacedName!,
        sourceloc: item.sourceloc,
        concrete: false,
      }));

      const struct: Semantic.StructDatatypeSymbol = {
        variant: "StructDatatype",
        name: item.name,
        externLanguage: item.externLanguage,
        members: [],
        methods: [],
        definedInNamespaceOrStruct: genericContext.currentStructOrNamespace,
        genericSymbols: generics,
        fullNamespacedName: item._collect.fullNamespacedName!,
        namespaces: item._collect.namespaces!,
        collectedDeclaration: item,
        concrete: generics.every((g) => g.concrete),
        scope: new Semantic.DeclScope(
          item.sourceloc,
          genericContext.currentStructOrNamespace?.scope,
        ),
        sourceloc: item.sourceloc,
      };
      assert(struct.variant === "StructDatatype");
      // item._semantic.symbol = struct.;
      scope.symbolTable.defineSymbol(struct);

      for (const g of item.generics) {
        struct.scope.symbolTable.defineSymbol({
          variant: "GenericParameter",
          name: g,
          concrete: struct.concrete,
          sourceloc: item.sourceloc,
        });
        console.log("Defined ", g);
      }

      // Add members
      struct.members = item.members.map((m) => {
        const resolved = resolveDatatype(sr, m.type, struct.scope, collectScope, {
          datatypesDone: new Map(genericContext.datatypesDone),
          mapping: new Map(genericContext.mapping),
          currentStructOrNamespace: struct,
        });
        return {
          variant: "Variable",
          name: m.name,
          externLanguage: EExternLanguage.None,
          export: false,
          mutable: true,
          sourceloc: m.sourceloc,
          type: resolved,
          variableContext: EVariableContext.MemberOfStruct,
          memberOf: struct,
          concrete: resolved.concrete,
        };
      });

      // Add methods
      struct.methods = item.methods
        .map((m) => {
          // m._semantic.memberOfSymbol = struct.id;
          return elaborate(sr, m, struct.scope, collectScope, {
            datatypesDone: new Map(genericContext.datatypesDone),
            mapping: new Map(genericContext.mapping),
            currentStructOrNamespace: struct,
          }) as Semantic.FunctionDefinitionSymbol;
        })
        .filter(Boolean)
        .map((m) => m!);

      // Add drop function
      if (struct.methods.every((m) => m.name !== "drop")) {
        if (!item._collect.scope) throw new ImpossibleSituation();
        const dropType: Semantic.FunctionDatatypeSymbol = {
          variant: "FunctionDatatype",
          concrete: struct.concrete,
          functionParameters: [],
          functionReturnValue: sr.globalScope.makePrimitiveAvailable(EPrimitive.none),
          generics: [],
          vararg: false,
        };
        const drop: Semantic.FunctionDefinitionSymbol = {
          variant: "FunctionDefinition",
          export: false,
          concrete: struct.concrete,
          externLanguage: EExternLanguage.None,
          methodType: EMethodType.Drop,
          name: "drop",
          scope: new Semantic.BlockScope(item.sourceloc, item._collect.scope.rawStatements),
          type: dropType,
          methodOf: struct,
          nestedParentTypeSymbol: struct,
          sourceloc: item.sourceloc,
        };
        struct.methods.push(drop);
      }

      return struct;
    }

    default:
      throw new ImpossibleSituation();
  }
}

function analyzeGlobalScope(
  sr: SemanticResult,
  globalScope: Semantic.BlockScope | Semantic.DeclScope,
  symbols: Collect.Symbol[],
  genericContext: Semantic.GenericContext | null,
) {
  logger.trace("Analyzing global scope");
  if (!genericContext) {
    genericContext = {
      mapping: new Map(),
      datatypesDone: new Map(),
    };
  }
  for (const symbol of symbols) {
    elaborate(sr, symbol, globalScope, genericContext);
  }
}

export function SemanticallyAnalyze(globalScope: Collect.Scope) {
  const sr: SemanticResult = {
    globalScope: new Semantic.DeclScope({ filename: "global", line: 0, column: 0 }),
  };
  analyzeGlobalScope(sr, sr.globalScope, globalScope.symbolTable.symbols, null);

  const mainFunction = sr.globalScope.symbolTable.symbols.find(
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

  if (
    mainFunction.type.functionReturnValue.variant !== "PrimitiveDatatype" ||
    mainFunction.type.functionReturnValue.primitive !== EPrimitive.i32
  ) {
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
  for (const symbol of sr.globalScope.symbolTable.symbols) {
    switch (symbol.variant) {
      case "FunctionDatatype":
        print(
          ` - FunctionType [${symbol.functionParameters.map((p) => `${p.name}: ${p.type}`).join(", ")}] => ${symbol.functionReturnValue} vararg=${symbol.vararg}`,
          symbol.concrete ? reset : gray,
        );
        break;

      case "PrimitiveDatatype":
        print(
          ` - PrimitiveType ${primitiveToString(symbol.primitive)}`,
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
          ` - StructType ${s} members=${symbol.members.map((id) => id).join(", ")}`,
          symbol.concrete ? reset : gray,
        );
        break;

      case "DeferredDatatype":
        print(` - Deferred`, symbol.concrete ? reset : gray);
        break;

      case "RawPointerDatatype":
        print(` - RawPointer pointee=${symbol.pointee}`, symbol.concrete ? reset : gray);
        break;

      case "ReferenceDatatype":
        print(` - Reference referee=${symbol.referee}`, symbol.concrete ? reset : gray);
        break;

      case "CallableDatatype":
        print(
          ` - Callable functionType=${symbol.functionType} thisExprType=${symbol.thisExprType}`,
          symbol.concrete ? reset : gray,
        );
        break;

      case "FunctionDeclaration":
        print(` - FuncDecl ${symbol.name}() type=${symbol.type}`, symbol.concrete ? reset : gray);
        break;

      case "FunctionDefinition":
        print(
          ` - FuncDef ${symbol.name}() type=${symbol.type} methodOf=${symbol.methodOfSymbol} parent=${symbol.nestedParentTypeSymbol}`,
          symbol.concrete ? reset : gray,
        );
        break;

      case "GenericParameter":
        print(` - GenericParameter ${symbol.name}`, symbol.concrete ? reset : gray);
        break;

      case "Variable":
        print(
          ` - Variable ${symbol.name} typeSymbol=${symbol.type} memberOf=${symbol.memberOf}`,
          symbol.concrete ? reset : gray,
        );
        break;
    }
  }
  print("\n");
}
