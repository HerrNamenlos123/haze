import {
  EBinaryOperation,
  EExternLanguage,
  EUnaryOperation,
  type ASTConstant,
  type ASTDatatype,
  type ASTExpr,
  type ASTFunctionDeclaration,
  type ASTFunctionDefinition,
  type ASTGlobalVariableDefinition,
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
import {
  assert,
  CompilerError,
  ImpossibleSituation,
  InternalError,
  type SourceLoc,
} from "../shared/Errors";
import { Collect, type CollectionContext } from "../SymbolCollection/CollectSymbols";
import { getScope } from "../SymbolCollection/SymbolCollection";
import { Conversion } from "./Conversion";
import {
  makeFunctionDatatypeAvailable,
  lookupAndElaborateDatatype,
  instantiateStruct,
  makeReferenceDatatypeAvailable,
  makeRawPointerDatatypeAvailable,
} from "./LookupDatatype";
import { makePrimitiveAvailable, Semantic, type SemanticResult } from "./SemanticSymbols";
import { serializeDatatype, serializeExpr, serializeNestedName } from "./Serialize";

export type SubstitutionContext = {
  substitute: Map<Collect.GenericParameter, Semantic.Symbol>;
};

export function makeSubstitutionContext(): SubstitutionContext {
  return {
    substitute: new Map(),
  };
}

export function isolateElaborationContext(parent: SubstitutionContext): SubstitutionContext {
  return {
    substitute: new Map(parent.substitute),
  };
}

export function elaborateExpr(
  sr: SemanticResult,
  expr: ASTExpr,
  args: {
    scope: Collect.Scope;
    context: SubstitutionContext;
    elaboratedVariables: Map<Collect.Symbol, Semantic.VariableSymbol>;
  },
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
      const rightType = b.type;

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
          } else if (rightType.variant === "RawPointerDatatype" && Conversion.isInteger(leftType)) {
            return {
              variant: "BinaryExpr",
              left: a,
              operation: expr.operation,
              right: b,
              type: rightType,
              sourceloc: expr.sourceloc,
            };
          } else if (leftType.variant === "RawPointerDatatype" && Conversion.isInteger(rightType)) {
            return {
              variant: "BinaryExpr",
              left: a,
              operation: expr.operation,
              right: b,
              type: leftType,
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
            (Conversion.isFloat(leftType) && Conversion.isFloat(rightType)) ||
            (leftType.variant === "RawPointerDatatype" &&
              rightType.variant === "RawPointerDatatype")
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

      throw new CompilerError(
        `No known binary result for types ${serializeDatatype(leftType)} and ${serializeDatatype(rightType)}`,
        expr.sourceloc,
      );
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================
    case "UnaryExpr": {
      const e = elaborateExpr(sr, expr.expr, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        scope: args.scope,
      });

      switch (expr.operation) {
        case EUnaryOperation.Plus:
        case EUnaryOperation.Minus:
          if (Conversion.isInteger(e.type) || Conversion.isFloat(e.type)) {
            return {
              variant: "UnaryExpr",
              expr: e,
              operation: expr.operation,
              type: e.type,
              sourceloc: expr.sourceloc,
            };
          }
          break;

        case EUnaryOperation.Negate:
          if (Conversion.isInteger(e.type) || Conversion.isFloat(e.type)) {
            return {
              variant: "UnaryExpr",
              expr: e,
              operation: expr.operation,
              type: e.type,
              sourceloc: expr.sourceloc,
            };
          }
          if (Conversion.isBoolean(e.type)) {
            return {
              variant: "UnaryExpr",
              expr: e,
              operation: expr.operation,
              type: e.type,
              sourceloc: expr.sourceloc,
            };
          }
          if (e.type.variant === "RawPointerDatatype") {
            return {
              variant: "BinaryExpr",
              left: e,
              right: {
                variant: "Constant",
                type: e.type,
                value: 0,
                sourceloc: expr.sourceloc,
              },
              operation: EBinaryOperation.Equal,
              type: e.type,
              sourceloc: expr.sourceloc,
            };
          }
          break;

        default:
          throw new ImpossibleSituation();
      }

      throw new CompilerError(
        `No known unary result for type ${serializeDatatype(e.type)}`,
        expr.sourceloc,
      );
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
        function isFloat(n: number): boolean {
          return Number(n) === n && n % 1 !== 0;
        }
        if (isFloat(expr.constant.value)) {
          return {
            variant: "Constant",
            type: makePrimitiveAvailable(sr, EPrimitive.f64),
            value: expr.constant.value,
            sourceloc: expr.sourceloc,
          };
        } else {
          let type = EPrimitive.i8;
          if (expr.constant.value >= -Math.pow(2, 7) && expr.constant.value <= Math.pow(2, 7) - 1) {
            type = EPrimitive.i8;
          } else if (
            expr.constant.value >= -Math.pow(2, 15) &&
            expr.constant.value <= Math.pow(2, 15) - 1
          ) {
            type = EPrimitive.i16;
          } else if (
            expr.constant.value >= -Math.pow(2, 31) &&
            expr.constant.value <= Math.pow(2, 31) - 1
          ) {
            type = EPrimitive.i32;
          } else if (
            expr.constant.value >= -Math.pow(2, 63) &&
            expr.constant.value <= Math.pow(2, 63) - 1
          ) {
            type = EPrimitive.i64;
          } else {
            throw new CompilerError(
              `The numeral constant ${expr.constant.value} is outside of any workable integer range`,
              expr.sourceloc,
            );
          }
          return {
            variant: "Constant",
            type: makePrimitiveAvailable(sr, type),
            value: expr.constant.value,
            sourceloc: expr.sourceloc,
          };
        }
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
        context: args.context,
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
      const callingArgs = expr.arguments.map((a) =>
        elaborateExpr(sr, a, {
          scope: args.scope,
          elaboratedVariables: args.elaboratedVariables,
          context: args.context,
        }),
      );

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
            // console.log(
            //   `Conversion: ${serializeDatatype(a.type)} -> ${serializeDatatype(requiredTypes[index])}`,
            // );
            return Conversion.MakeImplicitConversion(a, requiredTypes[index], expr.sourceloc);
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
          arguments: convertArgs(
            callingArgs,
            parametersWithoutThis,
            calledExpr.type.functionType.vararg,
          ),
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
        assert(calledExpr.type.originalCollectedSymbol.variant === "StructDefinition");
        const constructor = [...calledExpr.type.methods].find((m) => m.name === "constructor");
        if (!constructor) {
          throw new CompilerError(
            `Struct ${calledExpr.type.name} is called, but it does not provide a constructor`,
            expr.sourceloc,
          );
        }
        return {
          variant: "ExprCall",
          calledExpr: {
            variant: "SymbolValue",
            symbol: constructor,
            type: constructor.type,
            sourceloc: expr.sourceloc,
          },
          arguments: convertArgs(callingArgs, constructor.type.parameters, constructor.type.vararg),
          type: constructor.type.returnType,
          sourceloc: expr.sourceloc,
        };
      } else if (calledExpr.type.variant === "PrimitiveDatatype") {
        throw new CompilerError(
          `Expression of type ${primitiveToString(calledExpr.type.primitive)} is not callable`,
          expr.sourceloc,
        );
      } else if (calledExpr.type.variant === "RawPointerDatatype") {
        throw new CompilerError(`Expression of type Pointer is not callable`, expr.sourceloc);
      }
      assert(false && "All cases handled");
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "SymbolValueExpr": {
      if (expr.name === "sizeof") {
        if (expr.generics.length !== 1) {
          throw new CompilerError(
            `The sizeof<> Operator needs exactly 1 type argument`,
            expr.sourceloc,
          );
        }
        return {
          variant: "SizeofExpr",
          datatype: lookupAndElaborateDatatype(sr, {
            datatype: expr.generics[0],
            startLookupInScope: args.scope,
            isInCFuncdecl: false,
            context: args.context,
          }),
          type: makePrimitiveAvailable(sr, EPrimitive.u64),
          sourceloc: expr.sourceloc,
        };
      }

      const symbol = args.scope.lookupSymbol(expr.name, expr.sourceloc);
      if (symbol.variant === "VariableDefinitionStatement") {
        const elaboratedSymbol = args.elaboratedVariables.get(symbol);
        if (!elaboratedSymbol) {
          assert(elaboratedSymbol);
        }
        assert(elaboratedSymbol?.variant === "Variable");
        return {
          variant: "SymbolValue",
          symbol: elaboratedSymbol,
          type: elaboratedSymbol.type,
          sourceloc: expr.sourceloc,
        };
      } else if (symbol.variant === "GlobalVariableDefinition") {
        const elaboratedSymbol = elaborate(sr, {
          sourceSymbol: symbol,
          context: makeSubstitutionContext(),
        });
        assert(elaboratedSymbol?.variant === "GlobalVariableDefinition");
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
          usageInScope: args.scope,
          usedAt: expr.sourceloc,
          context: makeSubstitutionContext(),
        });
        assert(
          elaboratedSymbol?.variant === "FunctionDefinition" ||
          elaboratedSymbol?.variant === "FunctionDeclaration",
        );
        return {
          variant: "SymbolValue",
          symbol: elaboratedSymbol,
          type: elaboratedSymbol.type,
          sourceloc: expr.sourceloc,
        };
      } else if (
        symbol.variant === "StructDefinition" ||
        symbol.variant === "NamespaceDefinition"
      ) {
        // This is for static function calls like Arena.create();
        const elaboratedSymbol = elaborate(sr, {
          sourceSymbol: symbol,
          usageGenerics: expr.generics,
          usageInScope: args.scope,
          usedAt: expr.sourceloc,
          context: makeSubstitutionContext(),
        });
        assert(
          elaboratedSymbol?.variant === "NamespaceDatatype" ||
          elaboratedSymbol?.variant === "StructDatatype",
        );
        return {
          variant: "NamespaceValue",
          symbol: elaboratedSymbol,
          type: elaboratedSymbol,
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
        type: makeRawPointerDatatypeAvailable(sr, _expr.type),
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
        context: args.context,
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
        type: lookupAndElaborateDatatype(sr, {
          datatype: expr.castedTo,
          startLookupInScope: args.scope,
          isInCFuncdecl: false,
          context: args.context,
        }),
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
        context: args.context,
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
        scope: args.scope,
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
        scope: args.scope,
      });
      let type = object.type;

      if (type.variant === "RawPointerDatatype") {
        type = type.pointee;
      }

      if (object.variant === "NamespaceValue" && object.type.variant === "NamespaceDatatype") {
        const found = object.type.scope.collectedScope.tryLookupSymbol(
          expr.member,
          expr.sourceloc,
        );
        if (!found) {
          throw new CompilerError(
            `Namespace '${object.type.name}' does not define any declarations called '${expr.member}'`,
            expr.sourceloc,
          );
        }
        const elaborated = elaborate(sr, {
          sourceSymbol: found,
          usageGenerics: expr.generics,
          usageInScope: args.scope,
          usedAt: expr.sourceloc,
          context: args.context,
        });
        assert(elaborated);
        if (
          elaborated.variant === "FunctionDefinition" ||
          elaborated.variant === "FunctionDeclaration"
        ) {
          return {
            variant: "SymbolValue",
            symbol: elaborated,
            type: elaborated.type,
            sourceloc: expr.sourceloc,
          };
        } else {
          assert(false);
        }
      }

      if (type.variant !== "StructDatatype") {
        throw new CompilerError(
          "Cannot access member of non-structural type " + serializeDatatype(type),
          expr.sourceloc,
        );
      }

      const member = type.members.find((m) => {
        return m.name === expr.member;
      });

      if (member) {
        if (expr.generics.length > 0) {
          throw new CompilerError(
            `Member '${expr.member}' does not expect any type arguments, but ${expr.generics.length} are given`,
            expr.sourceloc,
          );
        }
        if (object.variant === "NamespaceValue") {
          assert(false, "Static members not implemented yet");
        }
        return {
          variant: "ExprMemberAccess",
          expr: object,
          memberName: expr.member,
          type: member.type,
          sourceloc: expr.sourceloc,
        };
      }

      assert(type.originalCollectedSymbol.variant === "StructDefinition");
      const collectedMethod = type.originalCollectedSymbol.methods.find(
        (m) => m.name === expr.member,
      );

      if (collectedMethod) {
        const elaboratedMethod = elaborate(sr, {
          structForMethod: type,
          context: args.context,
          usageGenerics: expr.generics,
          usageInScope: args.scope,
          usedAt: expr.sourceloc,
          sourceSymbol: collectedMethod,
        });
        assert(elaboratedMethod?.variant === "FunctionDefinition");

        if (object.variant === "NamespaceValue" && collectedMethod.static) {
          return {
            variant: "SymbolValue",
            symbol: elaboratedMethod,
            type: elaboratedMethod.type,
            sourceloc: expr.sourceloc,
          };
        } else if (object.variant !== "NamespaceValue" && !collectedMethod.static) {
          let thisPointer = object;
          if (
            thisPointer.type.variant !== "RawPointerDatatype" &&
            !(thisPointer.type.variant === "StructDatatype" && !thisPointer.type.cstruct)
          ) {
            thisPointer = {
              variant: "RawPointerAddressOf",
              expr: thisPointer,
              sourceloc: expr.sourceloc,
              type: makeRawPointerDatatypeAvailable(sr, thisPointer.type),
            };
          }

          let thisPointerType = thisPointer.type;
          if (thisPointer.type.variant === "StructDatatype" && !thisPointer.type.cstruct) {
            thisPointerType = makeRawPointerDatatypeAvailable(sr, thisPointer.type);
          }

          return {
            variant: "CallableExpr",
            thisExpr: thisPointer,
            functionSymbol: elaboratedMethod,
            type: {
              variant: "CallableDatatype",
              thisExprType: thisPointerType,
              functionType: elaboratedMethod.type,
              concrete: elaboratedMethod.type.concrete,
            },
            sourceloc: expr.sourceloc,
          };
        } else if (object.variant === "NamespaceValue") {
          throw new CompilerError(
            `Method ${serializeNestedName(elaboratedMethod)} is used in a static context but is not static`,
            expr.sourceloc,
          );
        } else {
          throw new CompilerError(
            `Method ${serializeNestedName(elaboratedMethod)} is static but is used in a non-static context`,
            expr.sourceloc,
          );
        }
      }

      throw new CompilerError(
        `No attribute named '${expr.member}' in struct ${type.name}`,
        expr.sourceloc,
      );
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExprAssignmentExpr": {
      const value = elaborateExpr(sr, expr.value, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        scope: args.scope,
      });
      const target = elaborateExpr(sr, expr.target, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        scope: args.scope,
      });
      return {
        variant: "ExprAssignmentExpr",
        value: Conversion.MakeImplicitConversion(value, target.type, expr.sourceloc),
        target: target,
        type: target.type,
        sourceloc: expr.sourceloc,
      };
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "StructInstantiationExpr": {
      const struct = lookupAndElaborateDatatype(sr, {
        datatype: expr.datatype,
        startLookupInScope: args.scope,
        isInCFuncdecl: false,
        context: args.context,
      });
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
          scope: args.scope,
        });

        const variable = struct.members.find((mm) => {
          assert(mm.variant === "Variable");
          return mm.name === m.name;
        });

        if (!variable) {
          throw new CompilerError(
            `${serializeDatatype(struct)} does not have a member named '${m.name}'`,
            expr.sourceloc,
          );
        }
        assert(variable.variant === "Variable");

        if (assignedMembers.includes(m.name)) {
          throw new CompilerError(`Cannot assign member ${m.name} twice`, expr.sourceloc);
        }

        if (e.type !== variable.type) {
          throw new CompilerError(
            `Member assignment ${m.name} has mismatching types: Cannot assign ${serializeDatatype(e.type)} to ${serializeDatatype(variable.type)}`,
            expr.sourceloc,
          );
        }

        remainingMembers = remainingMembers.filter((mm) => mm !== m.name);
        assign.push({
          value: e,
          name: m.name,
        });
        assignedMembers.push(m.name);
      }

      if (struct.name === "Result") {
        // Special exception for standard library Result<> Type, until unions are implemented properly
        remainingMembers = remainingMembers.filter(
          (mm) => !["successValue", "errorValue"].includes(mm),
        );
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
    scope: Semantic.BlockScope;
    context: SubstitutionContext;
    elaboratedVariables: Map<Collect.Symbol, Semantic.VariableSymbol>;
    expectedReturnType: Semantic.DatatypeSymbol;
  },
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
        scope: args.scope.collectedScope,
      });
      assert(s.then._collect.scope);
      const thenScope = new Semantic.BlockScope(
        s.sourceloc,
        getScope(sr.cc, s.then._collect.scope),
        args.scope,
      );
      elaborateBlockScope(sr, {
        scope: thenScope,
        expectedReturnType: args.expectedReturnType,
        elaboratedVariables: args.elaboratedVariables,
        context: args.context,
      });
      const elseIfs = s.elseIfs.map((e) => {
        assert(e.then._collect.scope);
        const newScope = new Semantic.BlockScope(
          s.sourceloc,
          getScope(sr.cc, e.then._collect.scope),
          args.scope,
        );
        elaborateBlockScope(sr, {
          scope: newScope,
          expectedReturnType: args.expectedReturnType,
          elaboratedVariables: args.elaboratedVariables,
          context: args.context,
        });
        return {
          condition: elaborateExpr(sr, e.condition, {
            context: args.context,
            elaboratedVariables: args.elaboratedVariables,
            scope: args.scope.collectedScope,
          }),
          then: newScope,
        };
      });

      let elseScope: Semantic.BlockScope | undefined = undefined;
      if (s.else) {
        assert(s.else._collect.scope);
        elseScope = new Semantic.BlockScope(
          s.sourceloc,
          getScope(sr.cc, s.else._collect.scope),
          args.scope,
        );
        elaborateBlockScope(sr, {
          scope: elseScope,
          expectedReturnType: args.expectedReturnType,
          elaboratedVariables: args.elaboratedVariables,
          context: args.context,
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
      assert(s.body._collect.scope);
      const newScope = new Semantic.BlockScope(
        s.sourceloc,
        getScope(sr.cc, s.body._collect.scope),
        args.scope,
      );
      elaborateBlockScope(sr, {
        scope: newScope,
        expectedReturnType: args.expectedReturnType,
        elaboratedVariables: args.elaboratedVariables,
        context: args.context,
      });
      return {
        variant: "WhileStatement",
        condition: elaborateExpr(sr, s.condition, {
          context: args.context,
          scope: args.scope.collectedScope,
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
              scope: args.scope.collectedScope,
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
      const expr =
        s.expr &&
        elaborateExpr(sr, s.expr, {
          context: args.context,
          elaboratedVariables: args.elaboratedVariables,
          scope: args.scope.collectedScope,
        });

      if (expr?.variant === "NamespaceValue") {
        throw new CompilerError(
          `A struct/namespace datatype cannot be written into a variable`,
          expr.sourceloc,
        );
      }

      const symbol = args.scope.symbolTable.lookupSymbol(s.name, s.sourceloc);
      assert(symbol.variant === "Variable");

      if (s.datatype) {
        symbol.type = lookupAndElaborateDatatype(sr, {
          datatype: s.datatype,
          startLookupInScope: args.scope.collectedScope,
          isInCFuncdecl: false,
          context: args.context,
        });
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
          scope: args.scope.collectedScope,
        }),
        sourceloc: s.sourceloc,
      };
  }
}

export function elaborateBlockScope(
  sr: SemanticResult,
  args: {
    scope: Semantic.BlockScope;
    expectedReturnType: Semantic.DatatypeSymbol;
    elaboratedVariables: Map<Collect.Symbol, Semantic.VariableSymbol>;
    context: SubstitutionContext;
  },
) {
  args.scope.statements = [];

  const variableMap = new Map<Collect.Symbol, Semantic.VariableSymbol>(args.elaboratedVariables);

  for (const symbol of args.scope.collectedScope.symbols) {
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
        if (symbol.kind === EVariableContext.FunctionParameter) {
          variableContext = EVariableContext.FunctionParameter;
          if (!symbol.datatype) {
            throw new InternalError("Parameter needs datatype");
          }
          type = lookupAndElaborateDatatype(sr, {
            datatype: symbol.datatype,
            startLookupInScope: args.scope.collectedScope,
            isInCFuncdecl: false,
            context: args.context,
          });
        } else if (symbol.kind === EVariableContext.ThisReference) {
          if (variableMap.has(symbol)) {
            break;
          } else {
            assert(
              false,
              "Variable definition statement for This-Reference was encountered, but it's not yet in the variableMap. It should already be elaborated by the parent.",
            );
          }
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
      context: args.context,
    });
    args.scope.statements.push(statement);

    if (statement.variant === "ReturnStatement") {
      args.scope.returnedTypes.push(statement.expr?.type);
    }
  }
}

export function defineThisPointer(
  sr: SemanticResult,
  args: {
    scope: Semantic.BlockScope;
    parentStruct: Semantic.StructDatatypeSymbol;
    context: SubstitutionContext;
    elaboratedVariables: Map<Collect.Symbol, Semantic.VariableSymbol>;
  },
) {
  const thisPointer = makeRawPointerDatatypeAvailable(sr, args.parentStruct);

  const vardef: Semantic.Symbol = {
    variant: "Variable",
    mutable: false,
    name: "this",
    type: thisPointer,
    concrete: thisPointer.concrete,
    export: false,
    externLanguage: EExternLanguage.None,
    sourceloc: args.scope.sourceloc,
    variableContext: EVariableContext.FunctionParameter,
  };
  args.scope.symbolTable.defineSymbol(vardef);

  const thisRefVarDef = args.scope.collectedScope.tryLookupSymbolHere("this");
  assert(thisRefVarDef);
  args.elaboratedVariables.set(thisRefVarDef, vardef);
}

export function elaborate(
  sr: SemanticResult,
  args: {
    sourceSymbol: Collect.Symbol;
    usageInScope?: Collect.Scope;
    usageGenerics?: (ASTDatatype | ASTConstant)[];
    usedAt?: SourceLoc;
    structForMethod?: Semantic.StructDatatypeSymbol;
    context: SubstitutionContext;
  },
): Semantic.Symbol | undefined {
  const elaborateParentSymbol = (
    symbol:
      | ASTFunctionDeclaration
      | ASTFunctionDefinition
      | ASTNamespaceDefinition
      | ASTGlobalVariableDefinition
      | ASTStructDefinition,
  ) => {
    const parent =
      (symbol._collect.definedInNamespaceOrStruct &&
        elaborate(sr, {
          sourceSymbol: symbol._collect.definedInNamespaceOrStruct,
          context: args.context,
        })) ||
      null;
    assert(
      !parent || parent.variant === "StructDatatype" || parent.variant === "NamespaceDatatype",
    );
    return parent;
  };

  switch (args.sourceSymbol.variant) {
    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "FunctionDeclaration": {
      for (const s of sr.elaboratedFuncdeclSymbols) {
        if (s.generics.length === 0 && s.originalSymbol === args.sourceSymbol) {
          return s.resultSymbol;
        }
      }

      const resolvedFunctype = lookupAndElaborateDatatype(sr, {
        datatype: {
          variant: "FunctionDatatype",
          params: args.sourceSymbol.params,
          ellipsis: args.sourceSymbol.ellipsis,
          returnType: args.sourceSymbol.returnType!,
          sourceloc: args.sourceSymbol.sourceloc,
        },
        isInCFuncdecl: args.sourceSymbol.externLanguage === EExternLanguage.Extern_C,
        startLookupInScope: assertScope(args.sourceSymbol._collect.definedInScope),
        context: args.context,
      });
      assert(resolvedFunctype.variant === "FunctionDatatype");
      assert(args.sourceSymbol.methodType !== undefined);
      const symbol: Semantic.FunctionDeclarationSymbol = {
        variant: "FunctionDeclaration",
        type: resolvedFunctype,
        export: args.sourceSymbol.export,
        staticMethod: false,
        noemit: args.sourceSymbol.noemit,
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
        resultSymbol: symbol,
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
          isInCFuncdecl: false,
          context: args.context,
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
      const substitutionContext = isolateElaborationContext(args.context);
      for (let i = 0; i < args.sourceSymbol.generics.length; i++) {
        substitutionContext.substitute.set(args.sourceSymbol.generics[i], generics[i]);
      }

      assert(args.sourceSymbol.declarationScope);
      const resolvedFunctype = lookupAndElaborateDatatype(sr, {
        datatype: {
          variant: "FunctionDatatype",
          params: args.sourceSymbol.params,
          ellipsis: args.sourceSymbol.ellipsis,
          returnType: args.sourceSymbol.returnType!,
          sourceloc: args.sourceSymbol.sourceloc,
        },
        startLookupInScope: getScope(sr.cc, args.sourceSymbol.declarationScope),
        isInCFuncdecl: false,
        context: substitutionContext,
      });
      assert(resolvedFunctype.variant === "FunctionDatatype");
      assert(args.sourceSymbol.methodType !== undefined);
      assert(args.sourceSymbol.funcbody?.variant === "Scope");

      let symbol: Semantic.FunctionDefinitionSymbol = {
        variant: "FunctionDefinition",
        type: resolvedFunctype,
        export: args.sourceSymbol.export,
        staticMethod: false,
        parent: elaborateParentSymbol(args.sourceSymbol),
        externLanguage: args.sourceSymbol.externLanguage,
        generics: generics,
        methodType: args.sourceSymbol.methodType,
        operatorOverloading: args.sourceSymbol.operatorOverloading && {
          asTarget: lookupAndElaborateDatatype(sr, {
            datatype: args.sourceSymbol.operatorOverloading.asTarget,
            startLookupInScope: assertScope(args.usageInScope),
            isInCFuncdecl: false,
            context: substitutionContext,
          }),
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
          getScope(sr.cc, args.sourceSymbol.funcbody._collect.scope),
          symbol.parent?.scope,
        );
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
          context: substitutionContext,
        });
      }

      return symbol;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "StructMethod": {
      assert(args.structForMethod);
      assert(args.usageGenerics);
      const generics = args.usageGenerics.map((g) => {
        assert(args.usageInScope);
        return lookupAndElaborateDatatype(sr, {
          datatype: g,
          startLookupInScope: args.usageInScope,
          isInCFuncdecl: false,
          context: args.context,
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
      const substitutionContext = isolateElaborationContext(args.context);
      for (let i = 0; i < args.sourceSymbol.generics.length; i++) {
        substitutionContext.substitute.set(args.sourceSymbol.generics[i], generics[i]);
      }

      const parameterNames = args.sourceSymbol.params.map((p) => p.name);
      const parameters = args.sourceSymbol.params.map((p) => {
        assert(args.sourceSymbol.variant === "StructMethod");
        assert(args.sourceSymbol.declarationScope);
        return lookupAndElaborateDatatype(sr, {
          datatype: p.datatype,
          startLookupInScope: getScope(sr.cc, args.sourceSymbol.declarationScope),
          isInCFuncdecl: false,
          context: substitutionContext,
        });
      });
      assert(args.sourceSymbol.returnType);

      if (!args.sourceSymbol.static && args.sourceSymbol.name !== "constructor") {
        const thisPointer = makeRawPointerDatatypeAvailable(sr, args.structForMethod);
        parameters.unshift(thisPointer);
        parameterNames.unshift("this");
      }

      assert(args.sourceSymbol.declarationScope)
      const returnType = lookupAndElaborateDatatype(sr, {
        datatype: args.sourceSymbol.returnType,
        startLookupInScope: getScope(sr.cc, args.sourceSymbol.declarationScope),
        isInCFuncdecl: false,
        context: substitutionContext,
      });

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
        staticMethod: args.sourceSymbol.static,
        externLanguage: EExternLanguage.None,
        methodType: EMethodType.Method,
        name: args.sourceSymbol.name,
        operatorOverloading: args.sourceSymbol.operatorOverloading && {
          asTarget: lookupAndElaborateDatatype(sr, {
            datatype: args.sourceSymbol.operatorOverloading.asTarget,
            startLookupInScope: assertScope(args.usageInScope),
            isInCFuncdecl: false,
            context: substitutionContext,
          }),
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

      assert(args.sourceSymbol.funcbody?._collect.scope);
      assert(!symbol.scope);
      if (symbol.concrete) {
        assert(args.sourceSymbol.funcbody._collect.scope);
        symbol.scope = new Semantic.BlockScope(
          args.sourceSymbol.sourceloc,
          getScope(sr.cc, args.sourceSymbol.funcbody._collect.scope),
          symbol.parent?.scope,
        );
        const variableMap = new Map<Collect.Symbol, Semantic.VariableSymbol>();

        if (!symbol.staticMethod && symbol.name !== "constructor") {
          defineThisPointer(sr, {
            scope: symbol.scope,
            parentStruct: args.structForMethod,
            elaboratedVariables: variableMap,
            context: substitutionContext,
          });
        }

        sr.elaboratedFuncdefSymbols.push({
          generics: generics,
          originalSymbol: args.sourceSymbol,
          resultSymbol: symbol,
        });

        assert(symbol.scope);
        elaborateBlockScope(sr, {
          scope: symbol.scope,
          expectedReturnType: symbol.type.returnType,
          elaboratedVariables: variableMap,
          context: substitutionContext,
        });
      }

      return symbol;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "NamespaceDefinition": {
      for (const s of sr.elaboratedNamespaceSymbols) {
        if (s.originalSymbol === args.sourceSymbol) {
          return s.resultSymbol;
        }
      }

      const parent = elaborateParentSymbol(args.sourceSymbol);
      assert(args.sourceSymbol._collect.scope);
      const namespace: Semantic.NamespaceDatatypeSymbol = {
        variant: "NamespaceDatatype",
        name: args.sourceSymbol.name,
        parent: parent,
        scope: new Semantic.DeclScope(
          args.sourceSymbol.sourceloc,
          getScope(sr.cc, args.sourceSymbol._collect.scope),
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
            context: isolateElaborationContext(args.context),
          });
          if (sig) {
            namespace.scope.symbolTable.defineSymbol(sig);
          }
        } else if (d.variant === "FunctionDefinition") {
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
        } else if (
          d.variant === "GlobalVariableDefinition" ||
          d.variant === "NamespaceDefinition" ||
          d.variant === "StructDefinition"
        ) {
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
      assert(args.usageGenerics);
      const struct = instantiateStruct(sr, {
        definedStructType: args.sourceSymbol,
        receivingType: {
          name: args.sourceSymbol.name,
          generics: args.usageGenerics,
          variant: "NamedDatatype",
          sourceloc: args.sourceSymbol.sourceloc,
          cstruct: false,
          _collect: {
            usedInScope: args.usageInScope,
          },
        },
        cstruct: false,
        context: args.context,
      });
      return struct;
    }

    case "GlobalVariableDefinition": {
      for (const s of sr.elaboratedGlobalVariableSymbols) {
        if (s.originalSymbol === args.sourceSymbol) {
          return s.resultSymbol;
        }
      }
      const scope = assertScope(args.sourceSymbol._collect.definedInScope);
      const elaboratedExpr =
        args.sourceSymbol.expr &&
        elaborateExpr(sr, args.sourceSymbol.expr, {
          scope: scope,
          elaboratedVariables: new Map(),
          context: args.context,
        });
      let type =
        args.sourceSymbol.datatype &&
        lookupAndElaborateDatatype(sr, {
          datatype: args.sourceSymbol.datatype,
          isInCFuncdecl: false,
          startLookupInScope: scope,
          context: args.context,
        });
      if (!type && elaboratedExpr) {
        type = elaboratedExpr.type;
      }
      assert(type);
      const parent = elaborateParentSymbol(args.sourceSymbol);
      const s: Semantic.GlobalVariableDefinitionSymbol = {
        variant: "GlobalVariableDefinition",
        name: args.sourceSymbol.name,
        export: args.sourceSymbol.export,
        externLanguage: args.sourceSymbol.externLanguage,
        mutable: args.sourceSymbol.mutable,
        type: type,
        value: elaboratedExpr,
        sourceloc: args.sourceSymbol.sourceloc,
        parent: parent,
        concrete: type.concrete,
      };
      sr.elaboratedGlobalVariableSymbols.push({
        originalSymbol: args.sourceSymbol,
        resultSymbol: s,
      });
      return s;
    }

    default:
      assert(false, args.sourceSymbol.variant);
  }
}

export function SemanticallyAnalyze(cc: CollectionContext, isLibrary: boolean) {
  const sr: SemanticResult = {
    overloadedOperators: [],
    cc: cc,

    elaboratedStructDatatypes: [],
    elaboratedFuncdeclSymbols: [],
    elaboratedFuncdefSymbols: [],
    elaboratedPrimitiveTypes: [],
    elaboratedNamespaceSymbols: [],
    elaboratedGlobalVariableSymbols: [],
    functionTypeCache: [],
    rawPointerTypeCache: [],
    referenceTypeCache: [],
  };

  const globalScope = getScope(cc, cc.globalScope);

  globalScope.symbols.forEach((s) => {
    if (s.variant === "FunctionDefinition" && (s.generics.length !== 0 || s.operatorOverloading)) {
      return undefined;
    }

    if (s.variant === "StructDefinition" && s.generics.length > 0) {
      return undefined;
    }

    return elaborate(sr, {
      sourceSymbol: s,
      usageGenerics: [],
      context: makeSubstitutionContext(),
    });
  });

  const mainFunction = sr.elaboratedFuncdefSymbols.find((s) => s.resultSymbol.name === "main");
  if (!isLibrary) {
    if (!mainFunction) {
      throw new CompilerError("No main function is defined in global scope", null);
    }

    if (
      mainFunction.resultSymbol.type.returnType.variant !== "PrimitiveDatatype" ||
      mainFunction.resultSymbol.type.returnType.primitive !== EPrimitive.i32
    ) {
      throw new CompilerError("Main function must return i32", mainFunction.resultSymbol.sourceloc);
    }
  } else {
    if (mainFunction) {
      throw new CompilerError(
        "main function is defined, but not allowed because module is built as library",
        null,
      );
    }
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
    | Semantic.NamespaceDatatypeSymbol
    | Semantic.DeclScope
    | Semantic.BlockScope
    | Semantic.VariableSymbol
    | Semantic.GlobalVariableDefinitionSymbol
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
    case "NamespaceDatatype":
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

  // for (const symbol of sr.globalScope.symbols) {
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
