import { escapeLeadingUnderscores } from "typescript";
import { logger } from "../Log/log";
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
import { GLOBAL_NAMESPACE_NAME } from "../shared/Config";
import {
  assert,
  CompilerError,
  ImpossibleSituation,
  InternalError,
} from "../shared/Errors";
import { Collect } from "../SymbolCollection/CollectSymbols";
import { Conversion } from "./Conversion";
import { makeFunctionDatatypeAvailable, resolveDatatype } from "./Resolve";
import { Semantic, type SemanticResult } from "./SemanticSymbols";
import { serializeDatatype, serializeExpr } from "./Serialize";

export type ElaborationContext = {
  local: {
    substitute: Map<Collect.GenericParameter, Semantic.Symbol>;
  },
  global: {
    functionTypeCache: Semantic.FunctionDatatypeSymbol[];
    rawPointerTypeCache: Semantic.RawPointerDatatypeSymbol[];
    referenceTypeCache: Semantic.ReferenceDatatypeSymbol[];

    currentNamespace: Semantic.NamespaceSymbol | Semantic.StructDatatypeSymbol;

    elaboratedStructDatatypes: {
      originalSymbol: Collect.Symbol;
      generics: Semantic.Symbol[];
      resultSymbol: Semantic.StructDatatypeSymbol;
    }[];
    elaboratedFunctionSymbols: {
      originalSymbol: Collect.Symbol;
      resultSymbol: Semantic.StructDatatypeSymbol;
    }[];
  }
};

export function makeElaborationContext(globalNamespace: Semantic.NamespaceSymbol): ElaborationContext {
  return {
    local:
    {
      substitute: new Map(),
    },
    global: {
      functionTypeCache: [],
      rawPointerTypeCache: [],
      referenceTypeCache: [],

      currentNamespace: globalNamespace,

      elaboratedStructDatatypes: [],
      elaboratedFunctionSymbols: [],
    }
  }
}

export function inheritElaborationContext(parent: ElaborationContext, currentNamespace?: Semantic.NamespaceSymbol | Semantic.StructDatatypeSymbol): ElaborationContext {
  return {
    local: {
      substitute: new Map(parent.local.substitute),
    },
    global: { ...parent.global, currentNamespace: currentNamespace || parent.global.currentNamespace }
  }
}

export function elaborateExpr(
  sr: SemanticResult,
  scope: Semantic.BlockScope,
  expr: ASTExpr,
  context: ElaborationContext,
): Semantic.Expression {
  switch (expr.variant) {
    case "BinaryExpr": {
      const a = elaborateExpr(sr, scope, expr.a, context);
      const b = elaborateExpr(sr, scope, expr.b, context);

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
              type: sr.globalNamespace.scope.makePrimitiveAvailable(EPrimitive.f32),
              sourceloc: expr.sourceloc,
            };
          } else if (Conversion.isFloat(leftType) && Conversion.isFloat(rightType)) {
            return {
              variant: "BinaryExpr",
              left: a,
              operation: expr.operation,
              right: b,
              type: sr.globalNamespace.scope.makePrimitiveAvailable(EPrimitive.f64),
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
              type: sr.globalNamespace.scope.makePrimitiveAvailable(EPrimitive.f64),
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
              type: sr.globalNamespace.scope.makePrimitiveAvailable(EPrimitive.boolean),
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
              type: sr.globalNamespace.scope.makePrimitiveAvailable(EPrimitive.boolean),
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
              type: sr.globalNamespace.scope.makePrimitiveAvailable(EPrimitive.boolean),
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
          type: sr.globalNamespace.scope.makePrimitiveAvailable(EPrimitive.boolean),
          value: expr.constant.value,
          sourceloc: expr.sourceloc,
        };
      } else if (expr.constant.variant === "NumberConstant") {
        return {
          variant: "Constant",
          type: sr.globalNamespace.scope.makePrimitiveAvailable(EPrimitive.i32),
          value: expr.constant.value,
          sourceloc: expr.sourceloc,
        };
      } else {
        return {
          variant: "Constant",
          type: sr.globalNamespace.scope.makePrimitiveAvailable(EPrimitive.str),
          value: expr.constant.value,
          sourceloc: expr.sourceloc,
        };
      }
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ParenthesisExpr": {
      return elaborateExpr(sr, scope, expr.expr, context);
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExprCallExpr": {
      const calledExpr = elaborateExpr(sr, scope, expr.calledExpr, context);
      const args = expr.arguments.map((a) => elaborateExpr(sr, scope, a, context));

      if (calledExpr.type.variant === "CallableDatatype") {
        return {
          variant: "ExprCall",
          calledExpr: calledExpr,
          arguments: args,
          type: calledExpr.type.functionType.returnType,
          sourceloc: expr.sourceloc,
        };
      }

      if (calledExpr.type.variant === "FunctionDatatype") {
        return {
          variant: "ExprCall",
          calledExpr: calledExpr,
          arguments: args,
          type: calledExpr.type.returnType,
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
      const symbol = scope.symbolTable.lookupSymbol(expr.name, expr.sourceloc);
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
        return {
          variant: "SymbolValue",
          symbol: symbol,
          type: symbol.type,
          sourceloc: expr.sourceloc,
        };
      } else {
        throw new CompilerError(`Symbol cannot be used as a value`, expr.sourceloc);
      }
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "RawPointerAddressOf": {
      const _expr = elaborateExpr(sr, scope, expr.expr, context);
      return {
        variant: "RawPointerAddressOf",
        type: {
          variant: "RawPointerDatatype",
          pointee: _expr.type,
          concrete: _expr.type.concrete,
        },
        expr: _expr,
        sourceloc: expr.sourceloc,
      };
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "RawPointerDereference": {
      const _expr = elaborateExpr(sr, scope, expr.expr, context);
      if (_expr.type.variant !== "RawPointerDatatype") {
        throw new CompilerError(`This expression is not a pointer and cannot be dereferenced`, expr.expr.sourceloc);
      }
      return {
        variant: "RawPointerAddressOf",
        type: _expr.type.pointee,
        expr: _expr,
        sourceloc: expr.sourceloc,
      };
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExplicitCastExpr": {
      return {
        variant: "ExplicitCast",
        type: resolveDatatype(sr, expr.castedTo, scope.collectedScope, context),
        expr: elaborateExpr(sr, scope, expr.expr, context),
        sourceloc: expr.sourceloc,
      };
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "PostIncrExpr": {
      const e = elaborateExpr(sr, scope, expr.expr, context);
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
      const e = elaborateExpr(sr, scope, expr.expr, context);
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
      const object = elaborateExpr(sr, scope, expr.expr, context);
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
        return {
          variant: "CallableExpr",
          thisExpr: object,
          functionSymbol: method,
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
      const struct = resolveDatatype(sr, expr.datatype, scope.collectedScope, context);
      assert(struct.variant === "StructDatatype");

      let remainingMembers = struct.members.map((m) => m.name);
      const assignedMembers: string[] = [];
      const assign: {
        name: string;
        value: Semantic.Expression;
      }[] = [];
      for (const m of expr.members) {
        const e = elaborateExpr(sr, scope, m.value, context);

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
  context: ElaborationContext,
): Semantic.Statement {
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
      const condition = elaborateExpr(sr, scope, s.condition, context);
      const thenScope = new Semantic.BlockScope(
        s.sourceloc,
        assertScope(s.then._collect.scope),
        scope
      );
      elaborateBlockScope(sr, thenScope, context);
      const elseIfs = s.elseIfs.map((e) => {
        const newScope = new Semantic.BlockScope(
          s.sourceloc,
          assertScope(e.then._collect.scope),
          scope
        );
        elaborateBlockScope(sr, newScope, context);
        return {
          condition: elaborateExpr(sr, scope, e.condition, context),
          then: newScope,
        };
      });

      let elseScope: Semantic.BlockScope | undefined = undefined;
      if (s.else) {
        elseScope = new Semantic.BlockScope(
          s.sourceloc,
          assertScope(s.else._collect.scope),
          scope
        );
        elaborateBlockScope(sr, elseScope, context);
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
        assertScope(s.body._collect.scope),
        scope
      );
      elaborateBlockScope(sr, newScope, context);
      return {
        variant: "WhileStatement",
        condition: elaborateExpr(sr, scope, s.condition, context),
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
        expr: s.expr && elaborateExpr(sr, scope, s.expr, context),
        sourceloc: s.sourceloc,
      };

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "VariableDefinitionStatement": {
      const expr = s.expr && elaborateExpr(sr, scope, s.expr, context);

      const symbol = scope.symbolTable.lookupSymbol(s.name, s.sourceloc);
      assert(symbol.variant === "Variable");

      if (s.datatype) {
        symbol.type = resolveDatatype(sr, s.datatype, scope.collectedScope, context);
      } else {
        assert(expr);
        symbol.type = expr.type;
      }
      assert(symbol.type);
      symbol.concrete = symbol.type.concrete;

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
        expr: elaborateExpr(sr, scope, s.expr, context),
        sourceloc: s.sourceloc,
      };
  }
}

export function elaborateBlockScope(
  sr: SemanticResult,
  scope: Semantic.BlockScope,
  context: ElaborationContext,
) {
  scope.statements = [];

  for (const symbol of scope.collectedScope.symbolTable.symbols) {
    switch (symbol.variant) {
      case "FunctionDeclaration":
      case "FunctionDefinition":
      case "NamespaceDefinition":
      case "GlobalVariableDefinition":
      case "StructDefinition":
      case "StructMethod":
      case "GenericParameter":
        throw new InternalError("Unexpected case");

      case "VariableDefinitionStatement": {
        scope.symbolTable.defineSymbol({
          variant: "Variable",
          export: false,
          externLanguage: EExternLanguage.None,
          mutable: symbol.mutable,
          name: symbol.name,
          sourceloc: symbol.sourceloc,
          variableContext: EVariableContext.FunctionLocal,
          type: { variant: "DeferredDatatype", concrete: false },
          concrete: false,
        });
        break;
      }

      default:
        assert(false && "All cases handled")
    }
  }

  for (const s of scope.collectedScope.rawStatements) {
    const statement = elaborateStatement(sr, scope, s, context);
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
  context: ElaborationContext,
) {
  const thisReference: Semantic.DatatypeSymbol = {
    variant: "ReferenceDatatype",
    referee: parentStruct,
    concrete: parentStruct.concrete,
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

export function elaborateSignature(
  sr: SemanticResult,
  item: Collect.Symbol,
  scope: Collect.Scope,
  context: ElaborationContext,
): Semantic.Symbol | undefined {
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

      const resolved = resolveDatatype(sr, type, scope, context);
      assert(resolved.variant === "FunctionDatatype");
      assert(item.methodType !== undefined);
      const symbol: Semantic.FunctionDeclarationSymbol = {
        variant: "FunctionDeclaration",
        type: resolved,
        export: item.export,
        externLanguage: item.externLanguage,
        parameterNames: item.params.map((p) => p.name),
        methodType: item.methodType,
        parent: context.global.currentNamespace,
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

      const resolved = resolveDatatype(sr, type, scope, context);
      assert(resolved.variant === "FunctionDatatype");
      assert(item.funcbody.variant === "Scope");
      assert(item.methodType !== undefined);
      let symbol: Semantic.FunctionDefinitionSymbol = {
        variant: "FunctionDefinition",
        type: resolved,
        export: item.export,
        parent: context.global.currentNamespace,
        externLanguage: item.externLanguage,
        methodType: item.methodType,
        parameterNames: item.params.map((p) => p.name),
        name: item.name,
        sourceloc: item.sourceloc,
        scope: undefined,
        concrete: resolved.concrete,
      };
      if (symbol.variant !== "FunctionDefinition") {
        throw new ImpossibleSituation();
      }

      if (item.funcbody._collect.scope && symbol.concrete && !symbol.scope) {
        symbol.scope = new Semantic.BlockScope(item.sourceloc, item.funcbody._collect.scope, context.global.currentNamespace.scope);
      }

      return symbol;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "StructMethod": {

      const struct = context.global.currentNamespace;
      assert(struct?.variant === "StructDatatype");
      const thisReference: Semantic.DatatypeSymbol = {
        variant: "ReferenceDatatype",
        referee: struct,
        concrete: struct.concrete,
      };

      const parameterNames = item.params.map((p) => p.name);
      const parameters = item.params.map((p) => resolveDatatype(sr, p.datatype, scope, context));
      parameters.unshift(thisReference);
      parameterNames.unshift("this");
      assert(item.returnType);
      const returnType = resolveDatatype(sr, item.returnType, scope, context);

      const ftype = makeFunctionDatatypeAvailable(parameters, returnType, item.ellipsis, context)

      let symbol: Semantic.FunctionDefinitionSymbol = {
        variant: "FunctionDefinition",
        type: ftype,
        export: false,
        externLanguage: EExternLanguage.None,
        methodType: EMethodType.Method,
        name: item.name,
        sourceloc: item.sourceloc,
        parameterNames: parameterNames,
        methodOf: struct,
        scope: undefined,
        parent: struct,
        concrete: ftype.concrete,
      };
      if (symbol.variant !== "FunctionDefinition") {
        throw new ImpossibleSituation();
      }

      if (item.funcbody._collect.scope && symbol.concrete && !symbol.scope) {
        symbol.scope = new Semantic.BlockScope(
          symbol.sourceloc,
          item.funcbody._collect.scope,
        );
        defineThisReference(sr, symbol.scope, struct, context);
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

      return symbol;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "NamespaceDefinition": {
      const namespace: Semantic.NamespaceSymbol = {
        variant: "Namespace",
        name: item.name,
        parent: context.global.currentNamespace,
        scope: new Semantic.DeclScope(
          item.sourceloc,
          assertScope(item._collect.scope),
          context.global.currentNamespace?.scope,
        ),
        sourceloc: item.sourceloc,
        concrete: true,
      };
      for (const d of item.declarations) {
        const sig = elaborateSignature(sr, d, scope, inheritElaborationContext(context, namespace));
        if (sig) {
          namespace.scope.symbolTable.defineSymbol(sig);
        }
      }
      return namespace;
    }

    case "StructDefinition": {
      return;
    }

    default:
      throw new ImpossibleSituation();
  }
}

export function elaborateBodies(
  sr: SemanticResult,
  symbol: Semantic.Symbol,
  context: ElaborationContext,
) {
  switch (symbol.variant) {
    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "FunctionDeclaration": {
      break;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "FunctionDefinition": {
      assert(symbol.scope)
      elaborateBlockScope(sr, symbol.scope, context);
      break;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "StructDatatype": {
      break;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "Namespace": {
      for (const d of symbol.scope.symbolTable.symbols) {
        elaborateBodies(sr, d, context);
      }
      break;
    }

    case "Variable": {
      break;
    }
  }
}

export function SemanticallyAnalyze(collectedGlobalScope: Collect.Scope) {
  const sr: SemanticResult = {
    globalNamespace: {
      variant: "Namespace",
      name: GLOBAL_NAMESPACE_NAME,
      concrete: true,
      scope: new Semantic.DeclScope(null, collectedGlobalScope),
      sourceloc: null,
    },
    monomorphizedSymbols: [],
  };

  const context = makeElaborationContext(sr.globalNamespace)

  const declarations = collectedGlobalScope.symbolTable.symbols.map((s) => elaborateSignature(sr, s, collectedGlobalScope, inheritElaborationContext(context))).filter((s) => !!s);
  for (const a of declarations) {
    sr.globalNamespace.scope.symbolTable.defineSymbol(a);
  }

  for (const s of sr.globalNamespace.scope.symbolTable.symbols) {
    elaborateBodies(sr, s, inheritElaborationContext(context));
  }

  const mainFunction = sr.globalNamespace.scope.symbolTable.symbols.find(
    (s) =>
      s.variant === "FunctionDefinition" &&
      s.parent === sr.globalNamespace &&
      s.name === "main",
  ) as Semantic.FunctionDefinitionSymbol;
  if (!mainFunction) {
    throw new CompilerError("No main function is defined in global scope", null);
  }

  if (
    mainFunction.type.returnType.variant !== "PrimitiveDatatype" ||
    mainFunction.type.returnType.primitive !== EPrimitive.i32
  ) {
    throw new CompilerError("Main function must return i32", mainFunction.sourceloc);
  }

  return sr;
}

const gray = "\x1b[90m";
const reset = "\x1b[0m";

const print = (str: string, indent = 0, color = reset) => {
  console.log(color + " ".repeat(indent) + str + reset);
};

function printSymbol(symbol: Semantic.NamespaceSymbol | Semantic.DeclScope | Semantic.BlockScope | Semantic.VariableSymbol | Semantic.FunctionDefinitionSymbol | Semantic.FunctionDeclarationSymbol | Semantic.PrimitiveDatatypeSymbol | Semantic.StructDatatypeSymbol | Semantic.Statement, indent: number) {

  if (symbol instanceof Semantic.DeclScope) {
    for (const s of symbol.symbolTable.symbols) {
      printSymbol(s, indent);
    }
    return;
  }

  if (symbol instanceof Semantic.BlockScope) {
    for (const s of symbol.symbolTable.symbols) {
      printSymbol(s, indent);
    }
    for (const s of symbol.statements) {
      printSymbol(s, indent);
    }
    return;
  }

  switch (symbol.variant) {
    case "Namespace":
      print(`Namespace ${symbol.name} {`, indent);
      printSymbol(symbol.scope, indent + 2);
      print(`}`, indent);
      break;

    case "Variable":
      print(`Variable Symbol ${symbol.name};`, indent);
      break;

    case "FunctionDeclaration":
      print(`Function ${symbol.name}`, indent);
      break;

    case "FunctionDefinition":
      print(`Function ${symbol.name} {`, indent);
      if (symbol.scope) {
        printSymbol(symbol.scope, indent + 2);
      }
      else {
        print("Scope missing", indent + 2);
      }
      print(`}`, indent);
      break;

    case "PrimitiveDatatype":
      print(`${serializeDatatype(symbol)}`, indent);
      break;

    case "StructDatatype":
      print(`Struct ${serializeDatatype(symbol)} {`, indent);
      for (const member of symbol.members) {
        print(`${member.name}: ${serializeDatatype(member.type)}`, indent + 2);
      }
      for (const method of symbol.methods) {
        print(``, indent + 2);
        print(`${method.name}(): ${serializeDatatype(method.type.returnType)} {`, indent + 2);
        if (method.scope) {
          printSymbol(method.scope, indent + 4);
        }
        else {
          print(`scope missing`, indent + 4);
        }
        print(`}`, indent + 2);
      }
      print(`}`, indent);
      break;

    case "InlineCStatement":
      print(`InlineC "${symbol.value}"`, indent);
      break;

    case "ReturnStatement":
      print(`Return ${symbol.expr ? serializeExpr(symbol.expr) : ''}`, indent);
      break;

    case "VariableStatement":
      print(`var ${symbol.name}: ${serializeDatatype(symbol.variableSymbol.type)} ${symbol.value ? '= ' + serializeExpr(symbol.value) : ''}`, indent);
      break;

    case "IfStatement":
      print(`If ${serializeExpr(symbol.condition)} {`, indent);
      printSymbol(symbol.then, indent + 2);
      for (const elseif of symbol.elseIfs) {
        print(`} else if ${serializeExpr(elseif.condition)} {`, indent);
        printSymbol(elseif.then, indent + 2);
      }
      if (symbol.else) {
        print(`} else {`, indent);
        printSymbol(symbol.else, indent + 2);
      }
      print(`}`, indent);
      break;

    case "WhileStatement":
      print(`While ${serializeExpr(symbol.condition)} {`, indent);
      printSymbol(symbol.then, indent + 2);
      print(`}`, indent);
      break;

    case "ExprStatement":
      print(`Expr ${serializeExpr(symbol.expr)};`, indent);
      break;

  }
}

export function PrettyPrintAnalyzed(sr: SemanticResult) {

  printSymbol(sr.globalNamespace, 0);

  print("");
  print("Monomorphized Symbols:");
  for (const symbol of sr.monomorphizedSymbols) {
    print("");
    printSymbol(symbol, 0);
  }

  // for (const symbol of sr.globalScope.symbolTable.symbols) {
  //   switch (symbol.variant) {
  //     case "FunctionDatatype":
  //       print(
  //         ` - FunctionType [${symbol.functionParameters.map((p) => `${p.name}: ${p.type}`).join(", ")}] => ${symbol.functionReturnValue} vararg=${symbol.vararg}`,
  //         symbol.concrete ? reset : gray,
  //       );
  //       break;

  //     case "PrimitiveDatatype":
  //       print(
  //         ` - PrimitiveType ${primitiveToString(symbol.primitive)}`,
  //         symbol.concrete ? reset : gray,
  //       );
  //       break;

  //     case "StructDatatype":
  //       let s = "(" + symbol.fullNamespacedName.join(".");
  //       if (symbol.generics.length > 0) {
  //         s += " generics=[" + symbol.generics.join(", ") + "]";
  //       }
  //       s += ")";
  //       print(
  //         ` - StructType ${s} members=${symbol.members.map((id) => id).join(", ")}`,
  //         symbol.concrete ? reset : gray,
  //       );
  //       break;

  //     case "DeferredDatatype":
  //       print(` - Deferred`, symbol.concrete ? reset : gray);
  //       break;

  //     case "RawPointerDatatype":
  //       print(` - RawPointer pointee=${symbol.pointee}`, symbol.concrete ? reset : gray);
  //       break;

  //     case "ReferenceDatatype":
  //       print(` - Reference referee=${symbol.referee}`, symbol.concrete ? reset : gray);
  //       break;

  //     case "CallableDatatype":
  //       print(
  //         ` - Callable functionType=${symbol.functionType} thisExprType=${symbol.thisExprType}`,
  //         symbol.concrete ? reset : gray,
  //       );
  //       break;

  //     case "FunctionDeclaration":
  //       print(` - FuncDecl ${symbol.name}() type=${symbol.type}`, symbol.concrete ? reset : gray);
  //       break;

  //     case "FunctionDefinition":
  //       print(
  //         ` - FuncDef ${symbol.name}() type=${symbol.type} methodOf=${symbol.methodOfSymbol} parent=${symbol.parent}`,
  //         symbol.concrete ? reset : gray,
  //       );
  //       break;

  //     case "GenericParameter":
  //       print(` - GenericParameter ${symbol.name}`, symbol.concrete ? reset : gray);
  //       break;

  //     case "Variable":
  //       print(
  //         ` - Variable ${symbol.name} typeSymbol=${symbol.type} memberOf=${symbol.memberOf}`,
  //         symbol.concrete ? reset : gray,
  //       );
  //       break;
  //   }
  // }
  print("\n");
}
