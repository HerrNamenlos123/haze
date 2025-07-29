import {
  EBinaryOperation,
  EExternLanguage,
  type ASTConstant,
  type ASTDatatype,
  type ASTExpr,
  type ASTFunctionDeclaration,
  type ASTFunctionDefinition,
  type ASTNamespaceDefinition,
  type ASTStatement,
  type ASTStructDefinition,
} from "../shared/AST";
import {
  assertScope,
  EMethodType,
  EPrimitive,
  EVariableContext,
  primitiveToString,
} from "../shared/common";
import { assert, CompilerError, ImpossibleSituation, InternalError, type SourceLoc } from "../shared/Errors";
import { Collect } from "../SymbolCollection/CollectSymbols";
import { Conversion } from "./Conversion";
import { makeFunctionDatatypeAvailable, lookupAndElaborateDatatype, instantiateStruct } from "./LookupDatatype";
import { makePrimitiveAvailable, Semantic, type SemanticResult } from "./SemanticSymbols";
import { serializeDatatype, serializeExpr } from "./Serialize";

export type SubstitutionContext = {
  substitute: Map<Collect.GenericParameter, Semantic.Symbol>;
};

export function makeSubstitutionContext(): SubstitutionContext {
  return {
    substitute: new Map(),
  };
}

export function isolateElaborationContext(
  parent: SubstitutionContext,
): SubstitutionContext {
  return {
    substitute: new Map(parent.substitute),
  };
}

export function elaborateExpr(
  sr: SemanticResult,
  expr: ASTExpr,
  args: {
    scope: Semantic.BlockScope,
    context: SubstitutionContext,
    elaboratedVariables: Map<Collect.Symbol, Semantic.VariableSymbol>;
  }
): Semantic.Expression {
  switch (expr.variant) {
    case "BinaryExpr": {
      const a = elaborateExpr(sr, expr.a, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        scope: args.scope,
      });
      const b = elaborateExpr(sr, expr.b, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        scope: args.scope,
      });

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
              type: makePrimitiveAvailable(sr, EPrimitive.f32),
              sourceloc: expr.sourceloc,
            };
          } else if (Conversion.isFloat(leftType) && Conversion.isFloat(rightType)) {
            return {
              variant: "BinaryExpr",
              left: a,
              operation: expr.operation,
              right: b,
              type: makePrimitiveAvailable(sr, EPrimitive.f64),
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
              type: makePrimitiveAvailable(sr, EPrimitive.f64),
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
              type: makePrimitiveAvailable(sr, EPrimitive.boolean),
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
              type: makePrimitiveAvailable(sr, EPrimitive.boolean),
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
              type: makePrimitiveAvailable(sr, EPrimitive.boolean),
              sourceloc: expr.sourceloc,
            };
          }
          break;

        default:
          throw new ImpossibleSituation();
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
          type: makePrimitiveAvailable(sr, EPrimitive.boolean),
          value: expr.constant.value,
          sourceloc: expr.sourceloc,
        };
      } else if (expr.constant.variant === "NumberConstant") {
        return {
          variant: "Constant",
          type: makePrimitiveAvailable(sr, EPrimitive.i32),
          value: expr.constant.value,
          sourceloc: expr.sourceloc,
        };
      } else {
        return {
          variant: "Constant",
          type: makePrimitiveAvailable(sr, EPrimitive.str),
          value: expr.constant.value,
          sourceloc: expr.sourceloc,
        };
      }
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ParenthesisExpr": {
      return elaborateExpr(sr, expr.expr, {
        scope: args.scope,
        elaboratedVariables: args.elaboratedVariables,
        context: args.context
      });
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExprCallExpr": {
      const calledExpr = elaborateExpr(sr, expr.calledExpr, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        scope: args.scope,
      });
      const callingArgs = expr.arguments.map((a) => elaborateExpr(sr, a, {
        scope: args.scope,
        elaboratedVariables: args.elaboratedVariables,
        context: args.context
      }));

      const convertArgs = (
        givenArgs: Semantic.Expression[],
        requiredTypes: Semantic.DatatypeSymbol[],
        vararg: boolean,
      ) => {
        if (vararg) {
          if (givenArgs.length < requiredTypes.length) {
            throw new CompilerError(
              `This call requires at least ${requiredTypes.length} arguments but only ${callingArgs.length} were given`,
              calledExpr.sourceloc,
            );
          }
        } else {
          if (givenArgs.length !== requiredTypes.length) {
            throw new CompilerError(
              `This call requires ${requiredTypes.length} arguments but ${callingArgs.length} were given`,
              calledExpr.sourceloc,
            );
          }
        }
        return givenArgs.map((a, index) => {
          if (index < requiredTypes.length) {
            return Conversion.MakeExplicitConversion(a, requiredTypes[index], expr.sourceloc);
          } else {
            return a;
          }
        });
      };

      if (calledExpr.type.variant === "CallableDatatype") {
        let parametersWithoutThis = calledExpr.type.functionType.parameters;
        if (calledExpr.type.thisExprType) {
          parametersWithoutThis = parametersWithoutThis.slice(1);
        }
        return {
          variant: "ExprCall",
          calledExpr: calledExpr,
          arguments: convertArgs(callingArgs, parametersWithoutThis, calledExpr.type.functionType.vararg),
          type: calledExpr.type.functionType.returnType,
          sourceloc: expr.sourceloc,
        };
      }

      if (calledExpr.type.variant === "FunctionDatatype") {
        return {
          variant: "ExprCall",
          calledExpr: calledExpr,
          arguments: convertArgs(callingArgs, calledExpr.type.parameters, calledExpr.type.vararg),
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
      const symbol = args.scope.collectedScope.symbolTable.lookupSymbol(expr.name, expr.sourceloc);
      if (symbol.variant === "VariableDefinitionStatement" || symbol.variant === "GlobalVariableDefinition") {
        const elaboratedSymbol = args.elaboratedVariables.get(symbol);
        if (!elaboratedSymbol) {
          assert(elaboratedSymbol);
        }
        return {
          variant: "SymbolValue",
          symbol: elaboratedSymbol,
          type: elaboratedSymbol.type,
          sourceloc: expr.sourceloc,
        };
      } else if (
        symbol.variant === "FunctionDeclaration" ||
        symbol.variant === "FunctionDefinition"
      ) {
        const elaboratedSymbol = elaborate(sr, {
          sourceSymbol: symbol,
          usageGenerics: expr.generics,
          usageInScope: args.scope.collectedScope,
          usedAt: expr.sourceloc,
          context: makeSubstitutionContext(),
        });
        assert(elaboratedSymbol?.variant === "FunctionDefinition" || elaboratedSymbol?.variant === "FunctionDeclaration");
        return {
          variant: "SymbolValue",
          symbol: elaboratedSymbol,
          type: elaboratedSymbol.type,
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
      const _expr = elaborateExpr(sr, expr.expr, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        scope: args.scope,
      });
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
      const _expr = elaborateExpr(sr, expr.expr, {
        scope: args.scope,
        elaboratedVariables: args.elaboratedVariables,
        context: args.context
      });
      if (_expr.type.variant !== "RawPointerDatatype") {
        throw new CompilerError(
          `This expression is not a pointer and cannot be dereferenced`,
          expr.expr.sourceloc,
        );
      }
      return {
        variant: "RawPointerDereference",
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
        type: lookupAndElaborateDatatype(
          sr,
          {
            datatype: expr.castedTo,
            startLookupInScope: args.scope.collectedScope,
            context: args.context,
          }
        ),
        expr: elaborateExpr(sr, expr.expr, {
          context: args.context,
          elaboratedVariables: args.elaboratedVariables,
          scope: args.scope,
        }),
        sourceloc: expr.sourceloc,
      };
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "PostIncrExpr": {
      const e = elaborateExpr(sr, expr.expr, {
        elaboratedVariables: args.elaboratedVariables,
        scope: args.scope,
        context: args.context
      });
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
      const e = elaborateExpr(sr, expr.expr, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        scope: args.scope
      });
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
      const object = elaborateExpr(sr, expr.expr, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        scope: args.scope
      });
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
        const thisExprType =
          object.type.variant === "ReferenceDatatype"
            ? object.type
            : ({
              variant: "ReferenceDatatype",
              referee: object.type,
              concrete: object.type.concrete,
            } satisfies Semantic.ReferenceDatatypeSymbol);

        // if (method.gen)

        return {
          variant: "CallableExpr",
          thisExpr: Conversion.MakeExplicitConversion(object, thisExprType, expr.sourceloc),
          functionSymbol: method,
          type: {
            variant: "CallableDatatype",
            thisExprType: thisExprType,
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

    case "ExprAssignmentExpr": {
      const value = elaborateExpr(sr, expr.value, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        scope: args.scope
      });
      const target = elaborateExpr(sr, expr.target, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        scope: args.scope
      });
      return {
        variant: "ExprAssignmentExpr",
        value: Conversion.MakeExplicitConversion(value, target.type, expr.sourceloc),
        target: target,
        type: target.type,
        sourceloc: expr.sourceloc,
      };
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "StructInstantiationExpr": {
      const struct = lookupAndElaborateDatatype(
        sr,
        {
          datatype: expr.datatype,
          startLookupInScope: args.scope.collectedScope,
          context: args.context,
        }
      );
      assert(struct.variant === "StructDatatype");

      let remainingMembers = struct.members.map((m) => m.name);
      const assignedMembers: string[] = [];
      const assign: {
        name: string;
        value: Semantic.Expression;
      }[] = [];
      for (const m of expr.members) {
        const e = elaborateExpr(sr, m.value, {
          context: args.context,
          elaboratedVariables: args.elaboratedVariables,
          scope: args.scope
        });

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
  s: ASTStatement,
  args: {
    scope: Semantic.BlockScope,
    context: SubstitutionContext,
    elaboratedVariables: Map<Collect.Symbol, Semantic.VariableSymbol>;
    expectedReturnType: Semantic.DatatypeSymbol,
  }
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
      const condition = elaborateExpr(sr, s.condition, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        scope: args.scope,
      });
      const thenScope = new Semantic.BlockScope(
        s.sourceloc,
        assertScope(s.then._collect.scope),
        args.scope,
      );
      elaborateBlockScope(sr, {
        scope: thenScope,
        expectedReturnType: args.expectedReturnType,
        elaboratedVariables: args.elaboratedVariables,
        context: args.context
      });
      const elseIfs = s.elseIfs.map((e) => {
        const newScope = new Semantic.BlockScope(
          s.sourceloc,
          assertScope(e.then._collect.scope),
          args.scope,
        );
        elaborateBlockScope(sr, {
          scope: newScope,
          expectedReturnType: args.expectedReturnType,
          elaboratedVariables: args.elaboratedVariables,
          context: args.context
        });
        return {
          condition: elaborateExpr(sr, e.condition, {
            context: args.context,
            elaboratedVariables: args.elaboratedVariables,
            scope: args.scope
          }),
          then: newScope,
        };
      });

      let elseScope: Semantic.BlockScope | undefined = undefined;
      if (s.else) {
        elseScope = new Semantic.BlockScope(s.sourceloc, assertScope(s.else._collect.scope), args.scope);
        elaborateBlockScope(sr, {
          scope: elseScope,
          expectedReturnType: args.expectedReturnType,
          elaboratedVariables: args.elaboratedVariables,
          context: args.context
        });
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
        args.scope,
      );
      elaborateBlockScope(sr, {
        scope: newScope,
        expectedReturnType: args.expectedReturnType,
        elaboratedVariables: args.elaboratedVariables,
        context: args.context
      });
      return {
        variant: "WhileStatement",
        condition: elaborateExpr(sr, s.condition, {
          context: args.context,
          scope: args.scope,
          elaboratedVariables: args.elaboratedVariables,
        }),
        then: newScope,
        sourceloc: s.sourceloc,
      };
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ReturnStatement": {
      if (s.expr) {
        return {
          variant: "ReturnStatement",
          expr: Conversion.MakeImplicitConversion(
            elaborateExpr(sr, s.expr, {
              context: args.context,
              elaboratedVariables: args.elaboratedVariables,
              scope: args.scope
            }),
            args.expectedReturnType,
            s.sourceloc,
          ),
          sourceloc: s.sourceloc,
        };
      } else {
        return {
          variant: "ReturnStatement",
          sourceloc: s.sourceloc,
        };
      }
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "VariableDefinitionStatement": {
      const expr = s.expr && elaborateExpr(sr, s.expr, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        scope: args.scope
      });

      const symbol = args.scope.symbolTable.lookupSymbol(s.name, s.sourceloc);
      assert(symbol.variant === "Variable");

      if (s.datatype) {
        symbol.type = lookupAndElaborateDatatype(
          sr,
          {
            datatype: s.datatype,
            startLookupInScope: args.scope.collectedScope,
            context: args.context,
          }
        );
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
        value: expr && Conversion.MakeImplicitConversion(expr, symbol.type, s.sourceloc),
        sourceloc: s.sourceloc,
      };
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExprStatement":
      return {
        variant: "ExprStatement",
        expr: elaborateExpr(sr, s.expr, {
          context: args.context,
          elaboratedVariables: args.elaboratedVariables,
          scope: args.scope,
        }),
        sourceloc: s.sourceloc,
      };
  }
}

export function elaborateBlockScope(
  sr: SemanticResult,
  args: {
    scope: Semantic.BlockScope,
    expectedReturnType: Semantic.DatatypeSymbol,
    elaboratedVariables: Map<Collect.Symbol, Semantic.VariableSymbol>,
    context: SubstitutionContext,
  }
) {
  args.scope.statements = [];

  const variableMap = new Map<Collect.Symbol, Semantic.VariableSymbol>(args.elaboratedVariables);

  for (const symbol of args.scope.collectedScope.symbolTable.symbols) {
    switch (symbol.variant) {
      case "GenericParameter":
        // This must be skipped. The Collect Scope defines the generic T, but we don't want to elaborate it.
        break;

      case "FunctionDeclaration":
      case "FunctionDefinition":
      case "NamespaceDefinition":
      case "GlobalVariableDefinition":
      case "StructDefinition":
      case "StructMethod":
        throw new InternalError("Unexpected case: " + symbol.variant);

      case "VariableDefinitionStatement": {
        let variableContext = EVariableContext.FunctionLocal;
        let type: Semantic.DatatypeSymbol = { variant: "DeferredDatatype", concrete: false };
        if (symbol.isParameter) {
          variableContext = EVariableContext.FunctionParameter;
          if (!symbol.datatype) {
            throw new InternalError("Parameter needs datatype");
          }
          type = lookupAndElaborateDatatype(sr, {
            datatype: symbol.datatype,
            startLookupInScope: args.scope.collectedScope,
            context: args.context
          });
        }
        const variable: Semantic.VariableSymbol = {
          variant: "Variable",
          export: false,
          externLanguage: EExternLanguage.None,
          mutable: symbol.mutable,
          name: symbol.name,
          sourceloc: symbol.sourceloc,
          variableContext: variableContext,
          type: type,
          concrete: false,
        };
        variableMap.set(symbol, variable);
        args.scope.symbolTable.defineSymbol(variable);
        break;
      }

      default:
        assert(false && "All cases handled");
    }
  }

  for (const s of args.scope.collectedScope.rawStatements) {
    const statement = elaborateStatement(sr, s, {
      scope: args.scope,
      expectedReturnType: args.expectedReturnType,
      elaboratedVariables: variableMap,
      context: args.context
    });
    args.scope.statements.push(statement);

    if (statement.variant === "ReturnStatement") {
      args.scope.returnedTypes.push(statement.expr?.type);
    }
  }
}

export function defineThisReference(
  sr: SemanticResult,
  args: {
    scope: Semantic.BlockScope,
    parentStruct: Semantic.StructDatatypeSymbol,
    context: SubstitutionContext,
  }
) {
  const thisReference: Semantic.DatatypeSymbol = {
    variant: "ReferenceDatatype",
    referee: args.parentStruct,
    concrete: args.parentStruct.concrete,
  };
  args.scope.symbolTable.defineSymbol({
    variant: "Variable",
    mutable: false,
    name: "this",
    type: thisReference,
    concrete: thisReference.concrete,
    export: false,
    externLanguage: EExternLanguage.None,
    sourceloc: args.scope.sourceloc,
    variableContext: EVariableContext.FunctionParameter,
  });
}

export function elaborate(
  sr: SemanticResult,
  args: {
    sourceSymbol: Collect.Symbol,
    usageInScope?: Collect.Scope,
    usageGenerics?: (ASTDatatype | ASTConstant)[],
    usedAt?: SourceLoc,
    structForMethod?: Semantic.StructDatatypeSymbol,
    context: SubstitutionContext,
  }
): Semantic.Symbol | undefined {

  const elaborateParentSymbol = (symbol: ASTFunctionDeclaration | ASTFunctionDefinition | ASTNamespaceDefinition | ASTStructDefinition) => {
    const parent = symbol._collect.definedInNamespaceOrStruct && elaborate(sr, {
      sourceSymbol: symbol._collect.definedInNamespaceOrStruct,
      context: args.context,
    }) || null;
    assert(!parent || parent.variant === "StructDatatype" || parent.variant === "Namespace");
    return parent;
  }

  switch (args.sourceSymbol.variant) {
    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "FunctionDeclaration": {
      for (const s of sr.elaboratedFuncdeclSymbols) {
        if (
          s.generics.length === 0 &&
          s.originalSymbol === args.sourceSymbol
        ) {
          return s.resultSymbol;
        }
      }

      const resolvedFunctype = lookupAndElaborateDatatype(
        sr,
        {
          datatype: {
            variant: "FunctionDatatype",
            params: args.sourceSymbol.params,
            ellipsis: args.sourceSymbol.ellipsis,
            returnType: args.sourceSymbol.returnType!,
            sourceloc: args.sourceSymbol.sourceloc,
          },
          startLookupInScope: assertScope(args.sourceSymbol._collect.definedInScope),
          context: args.context,
        }
      );
      assert(resolvedFunctype.variant === "FunctionDatatype");
      assert(args.sourceSymbol.methodType !== undefined);
      const symbol: Semantic.FunctionDeclarationSymbol = {
        variant: "FunctionDeclaration",
        type: resolvedFunctype,
        export: args.sourceSymbol.export,
        externLanguage: args.sourceSymbol.externLanguage,
        parameterNames: args.sourceSymbol.params.map((p) => p.name),
        methodType: args.sourceSymbol.methodType,
        parent: elaborateParentSymbol(args.sourceSymbol),
        name: args.sourceSymbol.name,
        sourceloc: args.sourceSymbol.sourceloc,
        concrete: resolvedFunctype.concrete,
      };
      sr.elaboratedFuncdeclSymbols.push({
        originalSymbol: args.sourceSymbol,
        generics: [],
        resultSymbol: symbol
      });
      return symbol;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "FunctionDefinition": {
      assert(args.usageGenerics);
      const generics = args.usageGenerics.map((g) => {
        assert(args.usageInScope);
        return lookupAndElaborateDatatype(sr, {
          datatype: g,
          startLookupInScope: args.usageInScope,
          context: args.context
        });
      });

      // If already existing, return cached to prevent loops
      for (const s of sr.elaboratedFuncdefSymbols) {
        if (
          s.generics.length === generics.length &&
          s.generics.every((g, index) => g === generics[index]) &&
          s.originalSymbol === args.sourceSymbol
        ) {
          return s.resultSymbol;
        }
      }

      if (args.sourceSymbol.generics.length !== generics.length) {
        throw new CompilerError(
          `Function ${args.sourceSymbol.name} expects ${args.sourceSymbol.generics.length} type parameters but got ${args.usageGenerics.length}`,
          args.usedAt || args.sourceSymbol.sourceloc,
        );
      }

      // New local substitution context
      const newContext = isolateElaborationContext(args.context);
      for (let i = 0; i < args.sourceSymbol.generics.length; i++) {
        newContext.substitute.set(args.sourceSymbol.generics[i], generics[i]);
      }

      const resolvedFunctype = lookupAndElaborateDatatype(
        sr,
        {
          datatype: {
            variant: "FunctionDatatype",
            params: args.sourceSymbol.params,
            ellipsis: args.sourceSymbol.ellipsis,
            returnType: args.sourceSymbol.returnType!,
            sourceloc: args.sourceSymbol.sourceloc,
          },
          startLookupInScope: assertScope(args.sourceSymbol.funcbody._collect.scope),
          context: newContext,
        }
      );
      assert(resolvedFunctype.variant === "FunctionDatatype");
      assert(args.sourceSymbol.methodType !== undefined);
      assert(args.sourceSymbol.funcbody.variant === "Scope");

      let symbol: Semantic.FunctionDefinitionSymbol = {
        variant: "FunctionDefinition",
        type: resolvedFunctype,
        export: args.sourceSymbol.export,
        parent: elaborateParentSymbol(args.sourceSymbol),
        externLanguage: args.sourceSymbol.externLanguage,
        generics: generics,
        methodType: args.sourceSymbol.methodType,
        operatorOverloading: args.sourceSymbol.operatorOverloading && {
          asTarget: lookupAndElaborateDatatype(
            sr,
            {
              datatype: args.sourceSymbol.operatorOverloading.asTarget,
              startLookupInScope: assertScope(args.usageInScope),
              context: args.context,
            }
          ),
          operator: args.sourceSymbol.operatorOverloading.operator,
        },
        parameterNames: args.sourceSymbol.params.map((p) => p.name),
        name: args.sourceSymbol.name,
        sourceloc: args.sourceSymbol.sourceloc,
        scope: undefined,
        concrete: resolvedFunctype.concrete,
      };
      if (symbol.variant !== "FunctionDefinition") {
        throw new ImpossibleSituation();
      }

      assert(args.sourceSymbol.funcbody._collect.scope);
      assert(!symbol.scope);
      if (symbol.concrete) {
        symbol.scope = new Semantic.BlockScope(
          args.sourceSymbol.sourceloc,
          args.sourceSymbol.funcbody._collect.scope,
          symbol.parent?.scope,
        );
        sr.elaboratedFuncdefSymbols.push({
          generics: generics,
          originalSymbol: args.sourceSymbol,
          resultSymbol: symbol,
        });

        // console.log("", symbol.scope.symbolTable.symbols)

        assert(symbol.scope);
        elaborateBlockScope(sr, {
          scope: symbol.scope,
          expectedReturnType: symbol.type.returnType,
          elaboratedVariables: new Map(),
          context: newContext,
        });
      }

      return symbol;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "StructMethod": {
      assert(args.structForMethod);
      const thisReference: Semantic.DatatypeSymbol = {
        variant: "ReferenceDatatype",
        referee: args.structForMethod,
        concrete: args.structForMethod.concrete,
      };

      assert(args.usageGenerics);
      const generics = args.usageGenerics.map((g) => {
        assert(args.usageInScope);
        return lookupAndElaborateDatatype(sr, {
          datatype: g,
          startLookupInScope: args.usageInScope,
          context: args.context
        });
      });

      // If already existing, return cached to prevent loops
      for (const s of sr.elaboratedFuncdefSymbols) {
        if (
          s.generics.length === generics.length &&
          s.generics.every((g, index) => g === generics[index]) &&
          s.originalSymbol === args.sourceSymbol
        ) {
          return s.resultSymbol;
        }
      }

      if (args.sourceSymbol.generics.length !== generics.length) {
        throw new CompilerError(
          `Function ${args.sourceSymbol.name} expects ${args.sourceSymbol.generics.length} type parameters but got ${args.usageGenerics.length}`,
          args.usedAt || args.sourceSymbol.sourceloc,
        );
      }

      // New local substitution context
      const newContext = isolateElaborationContext(args.context);
      for (let i = 0; i < args.sourceSymbol.generics.length; i++) {
        newContext.substitute.set(args.sourceSymbol.generics[i], generics[i]);
      }

      const parameterNames = args.sourceSymbol.params.map((p) => p.name);
      const parameters = args.sourceSymbol.params.map((p) =>
        lookupAndElaborateDatatype(
          sr,
          {
            datatype: p.datatype,
            startLookupInScope: args.structForMethod!.scope.collectedScope,
            context: args.context,
          }
        ),
      );
      parameters.unshift(thisReference);
      parameterNames.unshift("this");
      assert(args.sourceSymbol.returnType);
      const returnType = lookupAndElaborateDatatype(
        sr,
        {
          datatype: args.sourceSymbol.returnType,
          startLookupInScope: assertScope(args.sourceSymbol.declarationScope),
          context: args.context,
        }
      );

      const ftype = makeFunctionDatatypeAvailable(sr, {
        parameters: parameters,
        vararg: args.sourceSymbol.ellipsis,
        returnType: returnType,
      });

      let symbol: Semantic.FunctionDefinitionSymbol = {
        variant: "FunctionDefinition",
        type: ftype,
        export: false,
        generics: generics,
        externLanguage: EExternLanguage.None,
        methodType: EMethodType.Method,
        name: args.sourceSymbol.name,
        operatorOverloading: args.sourceSymbol.operatorOverloading && {
          asTarget: lookupAndElaborateDatatype(
            sr,
            {
              datatype: args.sourceSymbol.operatorOverloading.asTarget,
              startLookupInScope: assertScope(args.usageInScope),
              context: args.context,
            }
          ),
          operator: args.sourceSymbol.operatorOverloading.operator,
        },
        sourceloc: args.sourceSymbol.sourceloc,
        parameterNames: parameterNames,
        methodOf: args.structForMethod,
        scope: undefined,
        parent: args.structForMethod,
        concrete: ftype.concrete,
      };
      if (symbol.variant !== "FunctionDefinition") {
        throw new ImpossibleSituation();
      }

      assert(args.sourceSymbol.funcbody._collect.scope);
      assert(!symbol.scope);
      if (symbol.concrete) {
        symbol.scope = new Semantic.BlockScope(
          args.sourceSymbol.sourceloc,
          args.sourceSymbol.funcbody._collect.scope,
          symbol.parent?.scope,
        );
        defineThisReference(sr, {
          scope: symbol.scope,
          parentStruct: args.structForMethod,
          context: args.context
        });
        sr.elaboratedFuncdefSymbols.push({
          generics: generics,
          originalSymbol: args.sourceSymbol,
          resultSymbol: symbol,
        });

        assert(symbol.scope);
        elaborateBlockScope(sr, {
          scope: symbol.scope,
          expectedReturnType: symbol.type.returnType,
          elaboratedVariables: new Map(),
          context: args.context
        });
      }

      return symbol;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "NamespaceDefinition": {
      for (const s of sr.elaboratedNamespaceSymbols) {
        if (
          s.originalSymbol === args.sourceSymbol
        ) {
          return s.resultSymbol;
        }
      }

      const parent = elaborateParentSymbol(args.sourceSymbol);
      const namespace: Semantic.NamespaceSymbol = {
        variant: "Namespace",
        name: args.sourceSymbol.name,
        parent: parent,
        scope: new Semantic.DeclScope(
          args.sourceSymbol.sourceloc,
          assertScope(args.sourceSymbol._collect.scope),
          parent?.scope,
        ),
        sourceloc: args.sourceSymbol.sourceloc,
        concrete: true,
      };
      sr.elaboratedNamespaceSymbols.push({
        originalSymbol: args.sourceSymbol,
        resultSymbol: namespace,
      });

      for (const d of args.sourceSymbol.declarations) {
        if (d.variant === "FunctionDeclaration") {
          const sig = elaborate(sr, {
            sourceSymbol: d,
            context: isolateElaborationContext(args.context)
          });
          if (sig) {
            namespace.scope.symbolTable.defineSymbol(sig);
          }
        }
        else if (d.variant === "FunctionDefinition") {
          if (d.generics.length === 0 && !d.operatorOverloading) {
            const sig = elaborate(sr, {
              sourceSymbol: d,
              usageGenerics: [],
              context: isolateElaborationContext(args.context),
            });
            if (sig) {
              namespace.scope.symbolTable.defineSymbol(sig);
            }
          }
        }
        else if (d.variant === "GlobalVariableDefinition" || d.variant === "NamespaceDefinition" || d.variant === "StructDefinition") {
          const sig = elaborate(sr, {
            sourceSymbol: d,
            usageGenerics: [],
            context: isolateElaborationContext(args.context),
          });
          if (sig) {
            namespace.scope.symbolTable.defineSymbol(sig);
          }
        }
      }
      return namespace;
    }

    case "StructDefinition": {
      if (args.sourceSymbol.generics.length === 0) {
        // This is for elaborating all structs that are not generic, for the sole purpose of hitting the user
        // with compiler errors in concrete, yet unused functions.

        // Always recursively elaborate its parent first. This is very important for the context,
        // so the struct does not end up under the wrong namespace, if elaborate is called from a usage site.

        const struct = instantiateStruct(sr, {
          definedStructType: args.sourceSymbol,
          receivingType: {
            name: args.sourceSymbol.name,
            generics: [],
            variant: "NamedDatatype",
            sourceloc: args.sourceSymbol.sourceloc,
            _collect: {}
          },
          defineInNamespace: elaborateParentSymbol(args.sourceSymbol),
          context: args.context,
        });
        return struct;
      }
      else {
        return undefined;
      }
    }

    default:
      throw new ImpossibleSituation();
  }
}

export function SemanticallyAnalyze(collectedGlobalScope: Collect.Scope) {
  const sr: SemanticResult = {
    overloadedOperators: [],

    elaboratedStructDatatypes: [],
    elaboratedFuncdeclSymbols: [],
    elaboratedFuncdefSymbols: [],
    elaboratedPrimitiveTypes: [],
    elaboratedNamespaceSymbols: [],
    functionTypeCache: [],
    rawPointerTypeCache: [],
    referenceTypeCache: [],
  };

  const context = makeSubstitutionContext();

  collectedGlobalScope.symbolTable.symbols
    .map((s) => {
      if (s.variant === "FunctionDefinition" && (s.generics.length !== 0 || s.operatorOverloading)) return undefined;
      return elaborate(sr, {
        sourceSymbol: s,
        usageGenerics: [],
        context: isolateElaborationContext(context)
      })
    })
    .filter((s) => !!s);

  const mainFunction = sr.elaboratedFuncdefSymbols.find((s) => s.resultSymbol.name === "main");
  if (!mainFunction) {
    throw new CompilerError("No main function is defined in global scope", null);
  }

  if (
    mainFunction.resultSymbol.type.returnType.variant !== "PrimitiveDatatype" ||
    mainFunction.resultSymbol.type.returnType.primitive !== EPrimitive.i32
  ) {
    throw new CompilerError("Main function must return i32", mainFunction.resultSymbol.sourceloc);
  }

  return sr;
}

const gray = "\x1b[90m";
const reset = "\x1b[0m";

const print = (str: string, indent = 0, color = reset) => {
  console.log(color + " ".repeat(indent) + str + reset);
};

function printSymbol(
  symbol:
    | Semantic.NamespaceSymbol
    | Semantic.DeclScope
    | Semantic.BlockScope
    | Semantic.VariableSymbol
    | Semantic.FunctionDefinitionSymbol
    | Semantic.FunctionDeclarationSymbol
    | Semantic.PrimitiveDatatypeSymbol
    | Semantic.StructDatatypeSymbol
    | Semantic.Statement,
  indent: number,
) {
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
      } else {
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
        } else {
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
      print(`Return ${symbol.expr ? serializeExpr(symbol.expr) : ""}`, indent);
      break;

    case "VariableStatement":
      print(
        `var ${symbol.name}: ${serializeDatatype(symbol.variableSymbol.type)} ${symbol.value ? "= " + serializeExpr(symbol.value) : ""}`,
        indent,
      );
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
  // printSymbol(sr.globalNamespace, 0);

  print("");
  print("Elaborated Structs:");
  for (const symbol of sr.elaboratedStructDatatypes) {
    print("");
    printSymbol(symbol.resultSymbol, 0);
  }

  print("Elaborated Function Declarations:");
  for (const symbol of sr.elaboratedFuncdeclSymbols) {
    print("");
    printSymbol(symbol.resultSymbol, 0);
  }

  print("Elaborated Function Definitions:");
  for (const symbol of sr.elaboratedFuncdefSymbols) {
    print("");
    printSymbol(symbol.resultSymbol, 0);
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
