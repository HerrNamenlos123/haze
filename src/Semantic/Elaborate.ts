import {
  EAssignmentOperation,
  EBinaryOperation,
  EExternLanguage,
  EDatatypeMutability,
  EVariableMutability,
  EOverloadedOperator,
} from "../shared/AST";
import {
  EMethodType,
  EPrimitive,
  EVariableContext,
  primitiveToString,
  stringToPrimitive,
} from "../shared/common";
import { getModuleGlobalNamespaceName } from "../shared/Config";
import {
  assert,
  assertCompilerError,
  CompilerError,
  formatSourceLoc,
  InternalError,
  printWarningMessage,
  type SourceLoc,
} from "../shared/Errors";
import {
  Collect,
  funcSymHasParameterPack,
  printCollectedExpr,
  printCollectedSymbol,
} from "../SymbolCollection/SymbolCollection";
import { Conversion } from "./Conversion";
import { EvalCTFE, EvalCTFEBoolean, EvalCTFEOrFail } from "./CTFE";
import {
  makeStackArrayDatatypeAvailable,
  makeDynamicArrayDatatypeAvailable,
  makeTypeUse,
  makeRawFunctionDatatypeAvailable,
  makeFunctionDatatypeAvailable,
  makeDeferredFunctionDatatypeAvailable,
} from "./LookupDatatype";

import { EUnaryOperation } from "../shared/AST";
import { makeTempId, makeTempName } from "../shared/store";
import { ConditionChain, ConstraintSet, type ConstraintPath } from "./Constraint";
import { Semantic } from "./SemanticTypes";

function isPowerOfTwo(x: bigint): boolean {
  return x > 0n && (x & (x - 1n)) === 0n;
}

export class SemanticElaborator {
  currentContext: Semantic.ElaborationContext;
  inFunction: Semantic.SymbolId | null = null;
  inAttemptExpr: Semantic.ExprId | null = null;
  functionReturnsInstanceIds?: Set<Semantic.InstanceId>;

  constructor(
    public sr: Semantic.Context,
    currentContext: Semantic.ElaborationContext,
  ) {
    this.currentContext = currentContext;
  }

  withAdditionalConstraints<T>(constraints: ConstraintSet, fn: () => T): T {
    const c = ConstraintSet.empty();
    c.addAll(this.currentContext.constraints);
    c.addAll(constraints);
    return this.withContext(
      {
        context: Semantic.isolateElaborationContext(this.currentContext, {
          constraints: c,
          currentScope: this.currentContext.currentScope,
          genericsScope: this.currentContext.genericsScope,
          instanceDeps: this.currentContext.instanceDeps,
        }),
        inFunction: this.inFunction,
        inAttemptExpr: this.inAttemptExpr,
        functionReturnsInstanceIds: this.functionReturnsInstanceIds,
      },
      fn,
    );
  }

  withScopes<T>(
    args: {
      currentScope: Collect.ScopeId;
      genericsScope: Collect.ScopeId;
    },
    fn: () => T,
  ): T {
    return this.withContext(
      {
        context: Semantic.isolateElaborationContext(this.currentContext, {
          currentScope: args.currentScope,
          genericsScope: args.genericsScope,
          constraints: this.currentContext.constraints,
          instanceDeps: this.currentContext.instanceDeps,
        }),
        inFunction: this.inFunction,
        inAttemptExpr: this.inAttemptExpr,
        functionReturnsInstanceIds: this.functionReturnsInstanceIds,
      },
      fn,
    );
  }

  withContext<T>(
    args: {
      context: Semantic.ElaborationContext;
      inFunction: Semantic.SymbolId | null;
      inAttemptExpr: Semantic.ExprId | null;
      functionReturnsInstanceIds?: Set<Semantic.InstanceId>;
    },
    fn: () => T,
  ): T {
    const oldContext = this.currentContext;
    this.currentContext = args.context;
    const oldAttempt = this.inAttemptExpr;
    this.inAttemptExpr = args.inAttemptExpr;
    const oldReturn = this.inFunction;
    this.inFunction = args.inFunction;
    const oldReturnIds = this.functionReturnsInstanceIds;
    this.functionReturnsInstanceIds = args.functionReturnsInstanceIds;

    const result = fn();

    this.functionReturnsInstanceIds = oldReturnIds;
    this.inFunction = oldReturn;
    this.inAttemptExpr = oldAttempt;
    this.currentContext = oldContext;
    return result;
  }

  getFunctionSymbolReturnType(id: Semantic.SymbolId) {
    const sym = this.getSymbol(id);
    assert(sym.variant === Semantic.ENode.FunctionSymbol);
    const type = this.getTypeDef(sym.type);
    if (type.variant === Semantic.ENode.FunctionDatatype) {
      return type.returnType;
    }
    assert(type.variant === Semantic.ENode.DeferredFunctionDatatype);
    return undefined;
  }

  getSymbol(id: Semantic.SymbolId) {
    return this.sr.symbolNodes.get(id);
  }

  getExpr(id: Semantic.ExprId) {
    return this.sr.exprNodes.get(id);
  }

  getTypeUse(id: Semantic.TypeUseId) {
    return this.sr.typeUseNodes.get(id);
  }

  getTypeDef(id: Semantic.TypeDefId) {
    return this.sr.typeDefNodes.get(id);
  }

  binaryExpr(binaryExpr: Collect.BinaryExpr, inference: Semantic.Inference) {
    if (binaryExpr.operation === EBinaryOperation.BoolAnd) {
      let [left, leftId] = this.expr(binaryExpr.left, inference);

      // This builds the constraints that apply to the expr itself, the right part of the AND
      const constraints = this.currentContext.constraints.clone();
      this.buildLogicalConstraintSet(constraints, leftId);

      const [right, rightId] = this.withAdditionalConstraints(constraints, () =>
        this.expr(binaryExpr.right, inference),
      );
      return this.sr.b.binaryExpr(
        Conversion.MakeConversionOrThrow(
          this.sr,
          leftId,
          this.sr.b.boolType(),
          this.currentContext.constraints,
          left.sourceloc,
          Conversion.Mode.Implicit,
          inference?.unsafe || false,
        ),
        Conversion.MakeConversionOrThrow(
          this.sr,
          rightId,
          this.sr.b.boolType(),
          this.currentContext.constraints,
          right.sourceloc,
          Conversion.Mode.Implicit,
          inference?.unsafe || false,
        ),
        binaryExpr.operation,
        this.sr.b.boolType(),
        binaryExpr.sourceloc,
      );
    } else if (binaryExpr.operation === EBinaryOperation.BoolOr) {
      let [left, leftId] = this.expr(binaryExpr.left, inference);

      // This builds the constraints that apply to the expr itself, the right part of the AND
      const constraints = this.currentContext.constraints.clone();
      this.buildLogicalConstraintSet(constraints, leftId);

      const [right, rightId] = this.withAdditionalConstraints(constraints.inverse(), () =>
        this.expr(binaryExpr.right, inference),
      );
      return this.sr.b.binaryExpr(
        Conversion.MakeConversionOrThrow(
          this.sr,
          leftId,
          this.sr.b.boolType(),
          this.currentContext.constraints,
          left.sourceloc,
          Conversion.Mode.Implicit,
          inference?.unsafe || false,
        ),
        Conversion.MakeConversionOrThrow(
          this.sr,
          rightId,
          this.sr.b.boolType(),
          this.currentContext.constraints,
          right.sourceloc,
          Conversion.Mode.Implicit,
          inference?.unsafe || false,
        ),
        binaryExpr.operation,
        this.sr.b.boolType(),
        binaryExpr.sourceloc,
      );
    } else if (binaryExpr.operation === EBinaryOperation.BitwiseOr) {
      let [left, leftId] = this.expr(binaryExpr.left, { unsafe: inference?.unsafe });
      let [right, rightId] = this.expr(binaryExpr.right, { unsafe: inference?.unsafe });
      let leftUse = this.sr.typeUseNodes.get(left.type);
      let rightUse = this.sr.typeUseNodes.get(right.type);
      let leftDef = this.sr.typeDefNodes.get(leftUse.type);
      let rightDef = this.sr.typeDefNodes.get(rightUse.type);
      if (
        leftDef.variant === Semantic.ENode.EnumDatatype &&
        rightDef.variant === Semantic.ENode.EnumDatatype
      ) {
        if (leftUse.type !== rightUse.type) {
          throw new CompilerError(
            `Bitwise Or operation between '${Semantic.serializeTypeUse(this.sr, left.type)}' and '${Semantic.serializeTypeUse(this.sr, right.type)}' is not allowed since the enums are unrelated`,
            binaryExpr.sourceloc,
          );
        }
        if (!leftDef.bitflag) {
          throw new CompilerError(
            `Bitwise Or operation on '${Semantic.serializeTypeUse(this.sr, left.type)}' is not allowed since it is not a bitflag enum`,
            binaryExpr.sourceloc,
          );
        }

        return this.sr.b.binaryExpr(
          leftId,
          rightId,
          EBinaryOperation.BitwiseOr,
          left.type,
          binaryExpr.sourceloc,
        );
      }
      throw new CompilerError(
        `Bitwise Or operation is only allowed on bitflag enums`,
        binaryExpr.sourceloc,
      );
    } else if (
      binaryExpr.operation === EBinaryOperation.Equal ||
      binaryExpr.operation === EBinaryOperation.NotEqual
    ) {
      let left = this.expr(binaryExpr.left, { unsafe: inference?.unsafe })[0];
      let right = this.expr(binaryExpr.right, { unsafe: inference?.unsafe })[0];
      if (
        left.variant === Semantic.ENode.DatatypeAsValueExpr &&
        right.variant === Semantic.ENode.DatatypeAsValueExpr
      ) {
        return this.sr.b.literal(
          binaryExpr.operation === EBinaryOperation.Equal && left.type === right.type,
          binaryExpr.sourceloc,
        );
      }
    } else if (binaryExpr.operation === EBinaryOperation.Add) {
      let [left, leftId] = this.expr(binaryExpr.left, inference);
      let [right, rightId] = this.expr(binaryExpr.right, inference);
      const leftTypeUse = this.sr.typeUseNodes.get(left.type);
      // const leftType = this.sr.typeDefNodes.get(leftTypeUse.type);
      const rightTypeUse = this.sr.typeUseNodes.get(right.type);
      // const rightType = this.sr.typeDefNodes.get(rightTypeUse.type);
      if (
        Conversion.isString(this.sr, leftTypeUse.type) &&
        Conversion.isString(this.sr, rightTypeUse.type)
      ) {
        const leftCTFE = EvalCTFE(this.sr, leftId);
        const rightCTFE = EvalCTFE(this.sr, rightId);

        if (leftCTFE.ok && rightCTFE.ok) {
          const leftResult = this.sr.exprNodes.get(leftCTFE.value[1]);
          const rightResult = this.sr.exprNodes.get(rightCTFE.value[1]);
          if (
            leftResult.variant === Semantic.ENode.LiteralExpr &&
            rightResult.variant === Semantic.ENode.LiteralExpr
          ) {
            assert(
              leftResult.literal.type === EPrimitive.str ||
                leftResult.literal.type === EPrimitive.cstr ||
                leftResult.literal.type === EPrimitive.ccstr,
            );
            assert(
              rightResult.literal.type === EPrimitive.str ||
                rightResult.literal.type === EPrimitive.cstr ||
                rightResult.literal.type === EPrimitive.ccstr,
            );
            return this.sr.b.literal(
              leftResult.literal.value + rightResult.literal.value,
              binaryExpr.sourceloc,
            );
          }
        }

        return this.sr.b.callStringFormatFunc([leftId, rightId], null, binaryExpr.sourceloc);
      }
    }

    let leftId = this.expr(binaryExpr.left, inference)[1];
    let rightId = this.expr(binaryExpr.right, inference)[1];
    return this.sr.b.binaryExpr(
      leftId,
      rightId,
      binaryExpr.operation,
      Conversion.makeBinaryResultType(
        this.sr,
        leftId,
        rightId,
        binaryExpr.operation,
        binaryExpr.sourceloc,
      ),
      binaryExpr.sourceloc,
    );
  }

  exprs(exprs: Collect.ExprId[]) {
    return exprs.map((a) => this.expr(a, undefined)[1]);
  }

  assertNoGenericArgs(expr: Collect.SymbolValueExpr, functionName: string) {
    if (expr.genericArgs.length !== 0) {
      throw new CompilerError(
        `The ${functionName} function cannot take any type parameters`,
        expr.sourceloc,
      );
    }
  }

  assertParameterN(expr: Collect.ExprCallExpr, n: number | [number, number], functionName: string) {
    if (Array.isArray(n)) {
      if (expr.arguments.length < n[0] || expr.arguments.length > n[1]) {
        throw new CompilerError(
          `The ${functionName} function must take between ${n[0]} and ${n[1]} parameters`,
          expr.sourceloc,
        );
      }
    } else {
      if (expr.arguments.length !== n) {
        throw new CompilerError(
          `The ${functionName} function must take exactly ${n} parameter(s)`,
          expr.sourceloc,
        );
      }
    }
  }

  assertExprAllocatorType(allocatorExpr: Semantic.ExprId, sourceloc: SourceLoc) {
    const realAllocatorType = this.allocatorTypeDef();
    const allocatorType = this.getTypeUse(this.getExpr(allocatorExpr).type);
    if (allocatorType.type !== realAllocatorType) {
      throw new CompilerError(
        `The 'with' operator requires the right expression to be of type 'Allocator' (aka 'inline hzstd_allocator_t'). Has: ${Semantic.serializeTypeDef(
          this.sr,
          allocatorType.type,
        )}`,
        sourceloc,
      );
    }
  }

  callExpr(
    callExpr: Collect.ExprCallExpr,
    inference: Semantic.Inference,
  ): [Semantic.Expression, Semantic.ExprId] {
    const collectedExpr = this.sr.cc.exprNodes.get(callExpr.calledExpr);
    if (collectedExpr.variant === Collect.ENode.SymbolValueExpr) {
      if (collectedExpr.name === "typeof") {
        this.assertNoGenericArgs(collectedExpr, "typeof");
        this.assertParameterN(callExpr, 1, "typeof");
        return this.sr.b.datatypeUseAsValue(
          this.sr.exprNodes.get(this.expr(callExpr.arguments[0], undefined)[1]).type,
          collectedExpr.sourceloc,
        );
      }
      if (collectedExpr.name === "sizeof") {
        this.assertNoGenericArgs(collectedExpr, "sizeof");
        this.assertParameterN(callExpr, 1, "sizeof");
        return this.sr.b.sizeof(this.expr(callExpr.arguments[0], undefined)[1]);
      }
      if (collectedExpr.name === "alignof") {
        this.assertNoGenericArgs(collectedExpr, "alignof");
        this.assertParameterN(callExpr, 1, "alignof");
        return this.sr.b.alignof(this.expr(callExpr.arguments[0], undefined)[1]);
      }
      if (collectedExpr.name === "static_assert") {
        this.assertNoGenericArgs(collectedExpr, "static_assert");
        this.assertParameterN(callExpr, [1, 2], "static_assert");

        let second = undefined as Semantic.LiteralExpr | undefined;
        if (callExpr.arguments.length > 1) {
          const s = this.getExpr(this.expr(callExpr.arguments[1], undefined)[1]);
          if (
            s.variant !== Semantic.ENode.LiteralExpr ||
            (s.literal.type !== EPrimitive.str &&
              s.literal.type !== EPrimitive.cstr &&
              s.literal.type !== EPrimitive.ccstr)
          ) {
            throw new CompilerError(
              "The static_assert function requires the second parameter to be a string, or omitted",
              collectedExpr.sourceloc,
            );
          } else {
            second = s;
          }
        }
        const value = EvalCTFEBoolean(this.sr, this.expr(callExpr.arguments[0], undefined)[1]);
        if (value) {
          return this.sr.b.literal(true, collectedExpr.sourceloc);
        } else {
          let str = second ? Semantic.serializeLiteralValue(this.sr, second?.literal) : undefined;
          if (second && second.literal.type === EPrimitive.str) {
            str = second.literal.value; // Bypass and don't escape it to make message look better
          }
          throw new CompilerError(
            `static_assert evaluated to false${str ? ": " + str : ""}`,
            callExpr.sourceloc,
          );
        }
      }

      const primitive = stringToPrimitive(collectedExpr.name);
      if (primitive !== undefined) {
        const callingArguments = callExpr.arguments.map((a) => this.expr(a, undefined)[1]);
        assertCompilerError(
          collectedExpr.genericArgs.length === 0,
          "Primitive constructors cannot take any type parameters",
          collectedExpr.sourceloc,
        );
        if (primitive === EPrimitive.str) {
          assertCompilerError(
            callingArguments.length >= 1 && callingArguments.length <= 2,
            "'str' constructor must take one or two parameters",
            collectedExpr.sourceloc,
          );
          const first = this.getExpr(callingArguments[0]);
          const firstType = this.getTypeDef(this.sr.typeUseNodes.get(first.type).type);
          const second = callingArguments.length > 1 ? this.getExpr(callingArguments[1]) : null;
          const secondType =
            callingArguments.length > 1 && second
              ? this.getTypeDef(this.getTypeUse(second.type).type)
              : null;
          if (
            firstType.variant === Semantic.ENode.PrimitiveDatatype &&
            firstType.primitive === EPrimitive.str &&
            callingArguments.length === 1
          ) {
            return [first, callingArguments[0]];
          }
          // if (
          //   callingArguments.length === 2 &&
          //   second &&
          //   secondType &&
          //   firstType.variant === Semantic.ENode.NullableReferenceDatatype &&
          //   sr.typeUseNodes.get(firstType.referee).type ===
          //     makeRawPrimitiveAvailable(sr, EPrimitive.u8) &&
          //   secondType.variant === Semantic.ENode.PrimitiveDatatype &&
          //   Conversion.isInteger(secondType.primitive)
          // ) {
          //   return Semantic.addExpr(sr, {
          //     variant: Semantic.ENode.StringConstructExpr,
          //     type: makePrimitiveAvailable(
          //       sr,
          //       EPrimitive.str,
          //       EDatatypeMutability.Const,
          //       expr.sourceloc
          //     ),
          //     value: {
          //       variant: "data-length",
          //       data: callingArguments[0],
          //       length: callingArguments[1],
          //     },
          //     isTemporary: true,
          //     sourceloc: expr.sourceloc,
          //   });
          // }
          throw new CompilerError(
            `Primitive ${primitiveToString(
              primitive,
            )} constructor does not provide an overload that can take following types: (${callingArguments
              .map((a) => {
                return Semantic.serializeTypeUse(this.sr, this.sr.exprNodes.get(a).type);
              })
              .join(", ")})`,
            callExpr.sourceloc,
          );
        }
        throw new CompilerError(
          `Primitive ${primitiveToString(primitive)} is not constructible`,
          callExpr.sourceloc,
        );
      }
    }

    let decisiveArguments = [] as {
      index: number;
      exprId: Semantic.ExprId | null;
    }[];
    callExpr.arguments.forEach((p, i) => {
      if (IsExprDecisiveForOverloadResolution(this.sr, p)) {
        decisiveArguments.push({
          index: i,
          exprId: this.sr.e.expr(p, inference)[1],
        });
      } else {
        decisiveArguments.push({
          index: i,
          exprId: null,
        });
      }
    });

    // Choose all arguments that can contribute to disambiguating an overloaded function call
    const [calledExpr, calledExprId] = this.sr.e.expr(callExpr.calledExpr, {
      gonnaCallFunctionWithParameterValues: decisiveArguments,
      unsafe: inference?.unsafe,
    });
    const calledExprTypeUse = this.getTypeUse(calledExpr.type);
    const calledExprType = this.getTypeDef(calledExprTypeUse.type);

    // Helper: Elaborate all calling arguments with type hints from parameter types
    const elaborateCallingArguments = (
      parameterTypes: {
        optional: boolean;
        type: Semantic.TypeUseId;
      }[],
    ): Semantic.ExprId[] => {
      return callExpr.arguments.map((arg, index) => {
        // Reuse already-elaborated decisive arguments
        if (decisiveArguments[index]?.exprId) {
          return decisiveArguments[index].exprId;
        }

        // Elaborate with type hint for struct inference
        const paramType = index < parameterTypes.length ? parameterTypes[index].type : undefined;
        return this.sr.e.expr(arg, {
          gonnaInstantiateStructWithType: paramType,
          unsafe: inference?.unsafe,
        })[1];
      });
    };

    // Helper: Validate argument count and return actual args (with defaults for optional)
    const validateAndPrepareArguments = (
      givenArgs: Semantic.ExprId[],
      parameterTypes: {
        optional: boolean;
        type: Semantic.TypeUseId;
      }[],
      hasVararg: boolean,
      hasParameterPack: boolean,
    ): Semantic.ExprId[] => {
      // Count required parameters (non-optional, non-pack)
      const requiredParams = parameterTypes.filter(
        (p) => !p.optional && !this.isParameterPackType(p.type),
      );
      const optionalParams = parameterTypes.filter(
        (p) => p.optional && !this.isParameterPackType(p.type),
      );

      // Check argument count
      if (hasVararg || hasParameterPack) {
        // Vararg and pack: at least required params needed
        assertCompilerError(
          givenArgs.length >= requiredParams.length,
          `This call requires at least ${requiredParams.length} arguments but ${givenArgs.length} were given`,
          calledExpr.sourceloc,
        );
      } else {
        // No vararg/pack: exact match or with optional params
        const maxParams = parameterTypes.length;
        const minParams = requiredParams.length;
        assertCompilerError(
          givenArgs.length >= minParams && givenArgs.length <= maxParams,
          `This call requires ${minParams}${
            minParams !== maxParams ? `-${maxParams}` : ""
          } arguments but ${givenArgs.length} were given`,
          calledExpr.sourceloc,
        );
      }

      // Fill in missing optional arguments with `none`
      const result = [...givenArgs];
      for (let i = givenArgs.length; i < parameterTypes.length; i++) {
        if (parameterTypes[i].optional) {
          result.push(this.sr.b.noneExpr()[1]);
        }
      }

      return result;
    };

    // Helper: Insert implicit conversions for arguments
    const convertArguments = (
      givenArgs: Semantic.ExprId[],
      parameterTypes: {
        optional: boolean;
        type: Semantic.TypeUseId;
      }[],
      hasVararg: boolean,
      hasParameterPack: boolean,
    ): Semantic.ExprId[] => {
      const argumentSourcelocs = callExpr.arguments.map(
        (a) => this.sr.cc.exprNodes.get(a).sourceloc,
      );

      // Find the index of the parameter pack parameter (if any)
      const packParameterIndex = hasParameterPack
        ? parameterTypes.findIndex((p) => this.isParameterPackType(p.type))
        : -1;

      return givenArgs.map((arg, index) => {
        // If this is the parameter pack position, keep args as-is (they'll be bundled by codegen)
        if (index === packParameterIndex) {
          return arg;
        }

        // Only convert if we have a corresponding non-pack parameter
        if (
          index < parameterTypes.length &&
          !this.isParameterPackType(parameterTypes[index].type)
        ) {
          return Conversion.MakeConversionOrThrow(
            this.sr,
            arg,
            parameterTypes[index].type,
            this.currentContext.constraints,
            index < argumentSourcelocs.length ? argumentSourcelocs[index] : calledExpr.sourceloc,
            Conversion.Mode.Implicit,
            inference?.unsafe || false,
          );
        } else if (hasVararg && index >= parameterTypes.length) {
          // Vararg: pass remaining args as-is
          return arg;
        } else {
          // Default: pass as-is (shouldn't reach here if validation passed)
          return arg;
        }
      });
    };

    assert(this.inFunction);
    if (calledExprType.variant === Semantic.ENode.CallableDatatype) {
      const ftype = this.sr.typeDefNodes.get(calledExprType.functionType);
      assert(ftype.variant === Semantic.ENode.FunctionDatatype);
      let parametersWithoutThis = ftype.parameters;
      if (calledExprType.thisExprType) {
        parametersWithoutThis = parametersWithoutThis.slice(1);
      }
      const hasParameterPack = parametersWithoutThis.some((p) => this.isParameterPackType(p.type));
      const elaboratedArgs = elaborateCallingArguments(parametersWithoutThis);
      const preparedArgs = validateAndPrepareArguments(
        elaboratedArgs,
        parametersWithoutThis,
        ftype.vararg,
        hasParameterPack,
      );
      const finalArgs = convertArguments(
        preparedArgs,
        parametersWithoutThis,
        ftype.vararg,
        hasParameterPack,
      );

      return this.sr.b.callExpr(calledExprId, finalArgs, this.inFunction, callExpr.sourceloc);
    }

    if (calledExprType.variant === Semantic.ENode.DeferredFunctionDatatype) {
      throw new CompilerError(
        `This function is not fully elaborated yet. If it is part of a recursive call chain, it requires an explicit return type and a " :: final" annotation.`,
        callExpr.sourceloc,
      );
    } else if (calledExprType.variant === Semantic.ENode.FunctionDatatype) {
      const hasParameterPack = calledExprType.parameters.some((p) =>
        this.isParameterPackType(p.type),
      );

      const elaboratedArgs = elaborateCallingArguments(calledExprType.parameters);
      const preparedArgs = validateAndPrepareArguments(
        elaboratedArgs,
        calledExprType.parameters,
        calledExprType.vararg,
        hasParameterPack,
      );
      const actualArgs = convertArguments(
        preparedArgs,
        calledExprType.parameters,
        calledExprType.vararg,
        hasParameterPack,
      );
      return this.sr.b.callExpr(calledExprId, actualArgs, this.inFunction, callExpr.sourceloc);
    } else if (calledExprType.variant === Semantic.ENode.StructDatatype) {
      const original = this.sr.cc.typeDefNodes.get(calledExprType.originalCollectedDefinition);
      assert(original.variant === Collect.ENode.StructTypeDef);

      const structScope = this.sr.cc.scopeNodes.get(original.lexicalScope);
      assert(structScope.variant === Collect.ENode.StructLexicalScope);

      const constructorOverloadGroupId = [...structScope.symbols].find((mId) => {
        const m = this.sr.cc.symbolNodes.get(mId);
        return m.variant === Collect.ENode.FunctionOverloadGroupSymbol && m.name === "constructor";
      });
      if (!constructorOverloadGroupId) {
        throw new CompilerError(
          `Struct ${calledExprType.name} is called, but it does not provide a constructor`,
          callExpr.sourceloc,
        );
      }

      const constructorId = this.FunctionOverloadChoose(
        constructorOverloadGroupId,
        decisiveArguments,
        callExpr.sourceloc,
      );

      const collectedMethod = this.sr.cc.symbolNodes.get(constructorId);
      assert(collectedMethod.variant === Collect.ENode.FunctionSymbol);

      let elaboratedStructCache = null as Semantic.StructDef | null;
      for (const [_, cache] of this.sr.elaboratedStructDatatypes) {
        for (const entry of cache) {
          if (entry.result === calledExprTypeUse.type) {
            assert(elaboratedStructCache === null);
            elaboratedStructCache = entry;
          }
        }
      }
      assert(elaboratedStructCache);

      const parameterPackTypes = this.prepareParameterPackTypes(
        "constructor",
        collectedMethod.parameters,
        inference?.gonnaCallFunctionWithParameterValues,
        callExpr.sourceloc,
      );

      const elaboratedMethodId = this.withContext(
        {
          context: Semantic.mergeSubstitutionContext(
            elaboratedStructCache.substitutionContext,
            this.currentContext,
            {
              currentScope: this.currentContext.currentScope,
              genericsScope: this.currentContext.currentScope,
              instanceDeps: {
                instanceDependsOn: new Map(),
                structMembersDependOn: new Map(),
                symbolDependsOn: new Map(),
              },
            },
          ),
          inFunction: null,
          inAttemptExpr: null,
        },
        () => {
          const signature = this.elaborateFunctionSignature(constructorId);
          const sig = this.sr.symbolNodes.get(signature);
          assert(sig.variant === Semantic.ENode.FunctionSignature);
          return this.elaborateFunctionSymbolWithGenerics(
            signature,
            [],
            callExpr.sourceloc,
            parameterPackTypes,
          );
        },
      );
      assert(elaboratedMethodId);
      const elaboratedMethod = this.sr.symbolNodes.get(elaboratedMethodId);
      assert(elaboratedMethod.variant === Semantic.ENode.FunctionSymbol);

      const constructorFunctype = this.getTypeDef(elaboratedMethod.type);
      assert(constructorFunctype.variant === Semantic.ENode.FunctionDatatype);
      const hasParameterPack = constructorFunctype.parameters.some((p) =>
        this.isParameterPackType(p.type),
      );

      const elaboratedArgs = elaborateCallingArguments(constructorFunctype.parameters);
      const preparedArgs = validateAndPrepareArguments(
        elaboratedArgs,
        constructorFunctype.parameters,
        constructorFunctype.vararg,
        hasParameterPack,
      );
      const finalArgs = convertArguments(
        preparedArgs,
        constructorFunctype.parameters,
        constructorFunctype.vararg,
        hasParameterPack,
      );
      return this.sr.b.callExpr(
        this.sr.b.symbolValue(elaboratedMethodId, callExpr.sourceloc)[1],
        finalArgs,
        this.inFunction,
        callExpr.sourceloc,
      );
    } else if (calledExprType.variant === Semantic.ENode.UnionTagRefDatatype) {
      assert(calledExpr.variant === Semantic.ENode.UnionTagReferenceExpr);
      const union = this.sr.typeDefNodes.get(calledExpr.unionType);
      const tagname = calledExpr.tag;
      assert(union.variant === Semantic.ENode.TaggedUnionDatatype);
      const index = union.members.findIndex((m) => m.tag === tagname);
      assert(index !== -1);
      const typeOfTag = union.members[index].type;

      const paramTypes = [
        {
          optional: false,
          type: typeOfTag,
        },
      ];
      const hasParameterPack = paramTypes.some((p) => this.isParameterPackType(p.type));
      const elaboratedArgs = elaborateCallingArguments(paramTypes);
      const preparedArgs = validateAndPrepareArguments(
        elaboratedArgs,
        paramTypes,
        false,
        hasParameterPack,
      );
      const finalArgs = convertArguments(preparedArgs, paramTypes, false, hasParameterPack);

      const instanceIds = new Set<Semantic.InstanceId>();
      for (const a of finalArgs) {
        const e = this.sr.e.getExpr(a);
        e.instanceIds.forEach((i) => instanceIds.add(i));
      }

      const e = this.sr.exprNodes.get(finalArgs[0]);
      return this.sr.b.addExpr(this.sr, {
        variant: Semantic.ENode.ValueToUnionCastExpr,
        expr: finalArgs[0],
        instanceIds: [...instanceIds],
        isTemporary: true,
        index: index,
        sourceloc: callExpr.sourceloc,
        type: makeTypeUse(
          this.sr,
          calledExpr.unionType,
          EDatatypeMutability.Default,
          false,
          calledExpr.sourceloc,
        )[1],
        flow: e.flow,
        writes: e.writes,
      });
    } else if (calledExprType.variant === Semantic.ENode.PrimitiveDatatype) {
      throw new CompilerError(
        `Expression of type ${Semantic.serializeTypeUse(this.sr, calledExpr.type)} is not callable`,
        callExpr.sourceloc,
      );
    }
    assert(false, "All cases handled " + Semantic.ENode[calledExprType.variant]);
  }

  unaryExpr(
    unaryExpr: Collect.UnaryExpr,
    inference: Semantic.Inference,
  ): [Semantic.Expression, Semantic.ExprId] {
    const [e, eId] = this.sr.e.expr(unaryExpr.expr, undefined);

    if (unaryExpr.operation === EUnaryOperation.Negate) {
      const boolResult = Conversion.MakeConversion(
        this.sr,
        eId,
        this.sr.b.boolType(),
        this.currentContext.constraints,
        unaryExpr.sourceloc,
        Conversion.Mode.Implicit,
        inference?.unsafe,
      );
      if (boolResult.ok) {
        return this.sr.b.unaryExpr(
          boolResult.expr,
          EUnaryOperation.Negate,
          this.sr.b.boolType(),
          unaryExpr.sourceloc,
        );
      }
    }

    if (unaryExpr.operation === EUnaryOperation.Plus) {
      return [e, eId]; // Plus does nothing.
    } else if (unaryExpr.operation === EUnaryOperation.Minus) {
      const resultType = Conversion.makeUnaryResultType(
        this.sr,
        e.type,
        unaryExpr.operation,
        unaryExpr.sourceloc,
      );
      const resultTypeDef = this.sr.typeDefNodes.get(this.sr.typeUseNodes.get(resultType).type);
      assert(resultTypeDef.variant === Semantic.ENode.PrimitiveDatatype);

      // Here we replace the unary minus (as in "-x") with a normal subtraction (as in "(0 - x)"), because it's clearer
      // and gives us free runtime overflow checking through the existing arithmetic traps
      if (
        resultTypeDef.primitive === EPrimitive.i8 ||
        resultTypeDef.primitive === EPrimitive.i16 ||
        resultTypeDef.primitive === EPrimitive.i32 ||
        resultTypeDef.primitive === EPrimitive.i64 ||
        resultTypeDef.primitive === EPrimitive.u8 ||
        resultTypeDef.primitive === EPrimitive.u16 ||
        resultTypeDef.primitive === EPrimitive.u32 ||
        resultTypeDef.primitive === EPrimitive.u64 ||
        resultTypeDef.primitive === EPrimitive.int ||
        resultTypeDef.primitive === EPrimitive.usize
      ) {
        return this.sr.b.binaryExpr(
          this.sr.b.literalValue(
            {
              type: resultTypeDef.primitive,
              unit: null,
              value: 0n,
            },
            unaryExpr.sourceloc,
          )[1],
          eId,
          EBinaryOperation.Subtract,
          resultType,
          unaryExpr.sourceloc,
        );
      } else if (
        resultTypeDef.primitive === EPrimitive.f32 ||
        resultTypeDef.primitive === EPrimitive.f64 ||
        resultTypeDef.primitive === EPrimitive.real
      ) {
        return this.sr.b.binaryExpr(
          this.sr.b.literalValue(
            {
              type: resultTypeDef.primitive,
              unit: null,
              value: 0,
            },
            unaryExpr.sourceloc,
          )[1],
          eId,
          EBinaryOperation.Subtract,
          resultType,
          unaryExpr.sourceloc,
        );
      } else {
        assert(false);
      }
    } else if (unaryExpr.operation === EUnaryOperation.Negate) {
      // Union negation
      const aUse = this.sr.typeUseNodes.get(e.type);
      const aDef = this.sr.typeDefNodes.get(aUse.type);
      if (aDef.variant === Semantic.ENode.TaggedUnionDatatype) {
        const okTag = aDef.members.find((m) => m.tag === "Ok");
        const errTag = aDef.members.find((m) => m.tag === "Err");
        if (okTag && errTag) {
          return this.sr.b.addExpr(this.sr, {
            variant: Semantic.ENode.UnionTagCheckExpr,
            expr: eId,
            instanceIds: [],
            comparisonTypesAnd: [errTag.type],
            invertCheck: false,
            isTemporary: true,
            sourceloc: e.sourceloc,
            type: this.sr.b.boolType(),
            flow: e.flow,
            writes: e.writes,
          });
        }
      }

      return this.sr.b.unaryExpr(
        eId,
        unaryExpr.operation,
        Conversion.makeUnaryResultType(this.sr, e.type, unaryExpr.operation, unaryExpr.sourceloc),
        unaryExpr.sourceloc,
      );
    } else {
      assert(false);
    }
  }

  literalExpr(literalExpr: Collect.LiteralExpr, inference: Semantic.Inference) {
    if (
      literalExpr.literal.type === EPrimitive.u8 ||
      literalExpr.literal.type === EPrimitive.u16 ||
      literalExpr.literal.type === EPrimitive.u32 ||
      literalExpr.literal.type === EPrimitive.u64 ||
      literalExpr.literal.type === EPrimitive.usize ||
      literalExpr.literal.type === EPrimitive.i8 ||
      literalExpr.literal.type === EPrimitive.i16 ||
      literalExpr.literal.type === EPrimitive.i32 ||
      literalExpr.literal.type === EPrimitive.i64 ||
      literalExpr.literal.type === EPrimitive.int
    ) {
      // Special case: u64/usize are the only types where literals of the entire range do not fit in the 'int' range.
      // Therefore is the casted type is that type, allow it. For other types it does not matter because the
      // int will later just be narrowed into the target and nobody knows.
      if (inference?.gonnaInstantiateStructWithType) {
        const typeUse = this.sr.typeUseNodes.get(inference.gonnaInstantiateStructWithType);
        const typeDef = this.sr.typeDefNodes.get(typeUse.type);
        if (
          typeDef.variant === Semantic.ENode.PrimitiveDatatype &&
          (typeDef.primitive === EPrimitive.u64 || typeDef.primitive === EPrimitive.usize)
        ) {
          const [u64Min, u64Max] = Conversion.getIntegerMinMax(typeDef.primitive);
          if (literalExpr.literal.value >= u64Min && literalExpr.literal.value <= u64Max) {
            return this.sr.b.literalValue(
              {
                type: typeDef.primitive,
                unit: null,
                value: literalExpr.literal.value,
              },
              literalExpr.sourceloc,
            );
          }

          throw new CompilerError(
            `Value ${literalExpr.literal.value} is out of range for literal type ${primitiveToString(
              typeDef.primitive,
            )}`,
            literalExpr.sourceloc,
          );
        }
      }

      const [min, max] = Conversion.getIntegerMinMax(literalExpr.literal.type);
      if (literalExpr.literal.value < min || literalExpr.literal.value > max) {
        throw new CompilerError(
          `Value ${literalExpr.literal.value} is out of range for literal type ${primitiveToString(
            literalExpr.literal.type,
          )}`,
          literalExpr.sourceloc,
        );
      }
    }

    if (
      literalExpr.literal.type === EPrimitive.str ||
      literalExpr.literal.type === EPrimitive.cstr ||
      literalExpr.literal.type === EPrimitive.ccstr
    ) {
      if (literalExpr.literal.prefix === "b") {
        const bytes = new TextEncoder().encode(literalExpr.literal.value);

        if (bytes.length !== 1) {
          throw new CompilerError(
            `A b"..."-prefixed string defines a single-byte ASCII character and cannot encode a non-ASCII, multi-byte character.`,
            literalExpr.sourceloc,
          );
        }

        return this.sr.b.literalValue(
          {
            type: EPrimitive.u8,
            unit: null,
            value: BigInt(bytes[0]),
          },
          literalExpr.sourceloc,
        );
      }
    }

    return this.sr.b.literalValue(literalExpr.literal, literalExpr.sourceloc);
  }

  fstring(fstring: Collect.FStringExpr) {
    const fragments = fstring.fragments.map((f) => {
      if (f.type === "text") {
        return this.sr.b.literal(f.value, fstring.sourceloc)[1];
      } else {
        return this.expr(f.value, {})[1];
      }
    });

    const allocator = fstring.allocator ? this.expr(fstring.allocator, {})[1] : null;
    if (allocator) {
      this.sr.e.assertExprAllocatorType(allocator, fstring.sourceloc);
    }

    return this.sr.b.callStringFormatFunc(fragments, allocator, fstring.sourceloc);
  }

  expr(
    exprId: Collect.ExprId,
    inference: Semantic.Inference,
  ): readonly [Semantic.Expression, Semantic.ExprId] {
    const expr = this.sr.cc.exprNodes.get(exprId);

    let result: Semantic.Expression;
    let resultId: Semantic.ExprId;

    switch (expr.variant) {
      case Collect.ENode.BinaryExpr:
        [result, resultId] = this.binaryExpr(expr, inference);
        break;

      case Collect.ENode.ExprCallExpr:
        return this.callExpr(expr, inference);

      case Collect.ENode.UnaryExpr:
        return this.unaryExpr(expr, inference);

      case Collect.ENode.LiteralExpr:
        return this.literalExpr(expr, inference);

      case Collect.ENode.FStringExpr:
        return this.fstring(expr);

      case Collect.ENode.AggregateLiteralExpr:
        return this.structInstantiation(expr, inference);

      case Collect.ENode.SymbolValueExpr:
        return this.symbolValue(expr, inference);

      case Collect.ENode.MemberAccessExpr:
        return this.memberAccess(expr, inference);

      case Collect.ENode.ExprAssignmentExpr:
        return this.assignmentExpr(expr, inference);

      case Collect.ENode.ExplicitCastExpr:
        return this.explicitCastExpr(expr, inference);

      case Collect.ENode.ParenthesisExpr:
        return this.parenthesisExpr(expr, inference);

      case Collect.ENode.BlockScopeExpr:
        return this.blockScopeExpr(expr, inference);

      case Collect.ENode.TypeLiteralExpr:
        return this.typeLiteral(expr);

      case Collect.ENode.ArraySubscriptExpr:
        return this.arraySubscript(expr);

      case Collect.ENode.ExprIsTypeExpr:
        return this.exprIsType(expr, inference);

      case Collect.ENode.ErrorPropagationExpr:
        return this.errorPropagationExpr(expr, inference);

      case Collect.ENode.PreIncrExpr:
        return this.preIncr(expr);

      case Collect.ENode.PostIncrExpr:
        return this.postIncr(expr);

      case Collect.ENode.AttemptExpr:
        return this.attemptExpr(expr, inference);

      case Collect.ENode.TernaryExpr:
        return this.ternaryExpr(expr, inference);

      default:
        assert(false, "All cases handled: " + Collect.ENode[(expr as any).variant]);
    }

    return [result, resultId];
  }

  topLevelScope(scopeId: Collect.ScopeId) {
    const scope = this.sr.cc.scopeNodes.get(scopeId);
    switch (scope.variant) {
      case Collect.ENode.UnitScope:
      case Collect.ENode.ModuleScope: {
        for (const symbolId of scope.symbols) {
          this.topLevelSymbol(symbolId);
        }
        for (const symbolId of scope.scopes) {
          this.topLevelScope(symbolId);
        }
        break;
      }

      case Collect.ENode.FileScope: {
        for (const symbolId of scope.symbols) {
          this.topLevelSymbol(symbolId);
        }
        break;
      }

      default:
        assert(false, (scope as any).variant.toString());
    }
  }

  namespace(namespaceId: Collect.TypeDefId) {
    const namespace = this.sr.cc.typeDefNodes.get(namespaceId);
    assert(namespace.variant === Collect.ENode.NamespaceTypeDef);
    const sharedInstance = this.sr.cc.nsSharedInstances.get(namespace.sharedInstance);
    assert(sharedInstance.variant === Collect.ENode.NamespaceSharedInstance);

    for (const s of this.sr.elaboratedNamespaceSymbols) {
      if (s.originalSharedInstance === namespace.sharedInstance) {
        return s.result;
      }
    }

    let parentNamespace = null as Semantic.TypeDefId | null;
    const parentScope = this.sr.cc.scopeNodes.get(namespace.parentScope);
    if (parentScope.variant === Collect.ENode.NamespaceScope) {
      const namespaceSymbol = this.sr.cc.symbolNodes.get(parentScope.owningSymbol);
      assert(namespaceSymbol.variant === Collect.ENode.TypeDefSymbol);
      parentNamespace = this.namespace(namespaceSymbol.typeDef);
    }

    const [ns, nsId] = this.sr.b.namespaceType(
      namespace.name,
      parentNamespace,
      namespaceId,
      namespace.export,
    );
    this.sr.elaboratedNamespaceSymbols.push({
      originalSharedInstance: namespace.sharedInstance,
      substitutionContext: this.sr.e.currentContext,
      result: nsId,
    });

    for (const scopeId of sharedInstance.namespaceScopes) {
      const nsScope = this.sr.cc.scopeNodes.get(scopeId);
      assert(nsScope.variant === Collect.ENode.NamespaceScope);
      for (const symbolId of nsScope.symbols) {
        this.withContext(
          {
            context: Semantic.isolateElaborationContext(this.currentContext, {
              currentScope: scopeId,
              genericsScope: scopeId,
              constraints: this.currentContext.constraints,
              instanceDeps: {
                instanceDependsOn: new Map(),
                structMembersDependOn: new Map(),
                symbolDependsOn: new Map(),
              },
            }),
            inAttemptExpr: null,
            inFunction: null,
          },
          () => {
            const sym = this.sr.e.topLevelSymbol(symbolId);
            for (const s of sym) {
              ns.symbols.push(s);
            }
          },
        );
      }
    }
    return nsId;
  }

  enum(enumId: Collect.TypeDefId) {
    const enumValue = this.sr.cc.typeDefNodes.get(enumId);
    assert(enumValue.variant === Collect.ENode.EnumTypeDef);

    let parentNamespace = null as Semantic.TypeDefId | null;
    const parentScope = this.sr.cc.scopeNodes.get(enumValue.parentScope);
    if (parentScope.variant === Collect.ENode.NamespaceScope) {
      const namespaceSymbol = this.sr.cc.symbolNodes.get(parentScope.owningSymbol);
      assert(namespaceSymbol.variant === Collect.ENode.TypeDefSymbol);
      parentNamespace = this.namespace(namespaceSymbol.typeDef);
    }

    const found = getFromEnumDefCache(this.sr, enumId, {
      parentStructOrNS: parentNamespace,
    });
    if (found) {
      return found;
    }

    const [enumType, enumTypeId] = this.sr.b.addType<Semantic.EnumDatatypeDef>(this.sr, {
      variant: Semantic.ENode.EnumDatatype,
      concrete: true,
      extern: enumValue.extern,
      name: enumValue.name,
      noemit: enumValue.noemit,
      unscoped: enumValue.unscoped,
      bitflag: enumValue.bitflag,
      originalCollectedSymbol: enumId,
      parentStructOrNS: parentNamespace,
      sourceloc: enumValue.sourceloc,
      export: enumValue.export,
      values: [],
      type: -1 as Semantic.TypeUseId,
    });
    const [_, enumSymbolId] = this.sr.b.typeDefSymbol(enumTypeId);

    insertIntoEnumDefCache(this.sr, enumId, {
      substitutionContext: this.currentContext,
      parentStructOrNS: parentNamespace,
      result: enumTypeId,
      resultAsTypeDefSymbol: enumSymbolId,
    });

    if (enumValue.export) {
      this.sr.exportedSymbols.add(enumSymbolId);
    }

    const getEnumType = () => {
      if (enumValue.values[0].value) {
        const [valueResult, _] = EvalCTFEOrFail(
          this.sr,
          this.expr(enumValue.values[0].value, undefined)[1],
          enumValue.values[0].sourceloc,
        );
        assert(valueResult.variant === Semantic.ENode.LiteralExpr);

        if (valueResult.literal.type === EPrimitive.int) {
          return ["int", this.sr.b.intType()] as const;
        } else if (
          valueResult.literal.type === EPrimitive.str ||
          valueResult.literal.type === EPrimitive.cstr ||
          valueResult.literal.type === EPrimitive.ccstr
        ) {
          return ["str", this.sr.b.strType()] as const;
        } else {
          throw new CompilerError(
            `Enum values can only be of type string or integer, not '${Semantic.serializeLiteralType(
              this.sr,
              valueResult.literal,
            )}'`,
            enumValue.values[0].sourceloc,
          );
        }
      } else {
        return ["int", this.sr.b.intType()] as const;
      }
    };

    if (enumValue.values.length > 0) {
      const [enumDatatype, enumDatatypeId] = getEnumType();

      // Save type in enum so elaboration can immediately access it
      enumType.type = enumDatatypeId;

      if (enumDatatype === "int") {
        let nextValue = 0n;

        if (enumValue.bitflag) {
          nextValue = 1n;
        }

        const usedValues = new Set<bigint>();
        for (const value of enumValue.values) {
          if (value.value) {
            const [valueResult, _] = EvalCTFEOrFail(
              this.sr,
              this.expr(value.value, undefined)[1],
              value.sourceloc,
            );
            assert(valueResult.variant === Semantic.ENode.LiteralExpr);

            if (valueResult.type !== enumDatatypeId) {
              throw new CompilerError(
                `This enum cannot have values with mixed datatypes '${Semantic.serializeTypeUse(
                  this.sr,
                  valueResult.type,
                )}' and '${Semantic.serializeTypeUse(this.sr, enumDatatypeId)}'`,
                value.sourceloc,
              );
            }
            assert(valueResult.literal.type === EPrimitive.int);

            if (
              enumValue.bitflag &&
              !isPowerOfTwo(valueResult.literal.value) &&
              valueResult.literal.value !== 0n
            ) {
              throw new CompilerError(
                `This value does not resolve to an integer that is a power of two/an integer with exactly one bit set`,
                value.sourceloc,
              );
            }

            if (usedValues.has(valueResult.literal.value)) {
              throw new CompilerError(
                `Multiple fields with value ${valueResult.literal.value} not allowed`,
                value.sourceloc,
              );
            }

            if (enumValue.bitflag) {
              nextValue = valueResult.literal.value * 2n;
            } else {
              nextValue = valueResult.literal.value + 1n;
            }

            enumType.values.push({
              name: value.name,
              type: enumDatatypeId,
              valueExpr: this.sr.b.literal(valueResult.literal.value, value.sourceloc)[1],
              literalExpr: this.sr.b.literalValue(
                {
                  type: "enum",
                  enumType: enumTypeId,
                  valueName: value.name,
                },
                value.sourceloc,
              )[1],
            });

            usedValues.add(valueResult.literal.value);
          } else {
            if (enumValue.bitflag) {
              while (usedValues.has(nextValue)) {
                nextValue *= 2n;
              }
            } else {
              while (usedValues.has(nextValue)) {
                nextValue++;
              }
            }

            if (enumValue.bitflag) {
              assert(isPowerOfTwo(nextValue));
            }

            enumType.values.push({
              name: value.name,
              type: enumDatatypeId,
              valueExpr: this.sr.b.literal(nextValue, value.sourceloc)[1],
              literalExpr: this.sr.b.literalValue(
                {
                  type: "enum",
                  enumType: enumTypeId,
                  valueName: value.name,
                },
                value.sourceloc,
              )[1],
            });

            if (usedValues.has(nextValue)) {
              throw new CompilerError(
                `Multiple fields with value ${nextValue} not allowed`,
                value.sourceloc,
              );
            }
            usedValues.add(nextValue);
          }
        }
      } else {
        if (enumValue.bitflag) {
          throw new CompilerError(
            `bitflag enums are required to have integer values`,
            enumValue.sourceloc,
          );
        }

        const usedValues = new Set<string>();
        for (const value of enumValue.values) {
          if (value.value) {
            const [valueResult, _] = EvalCTFEOrFail(
              this.sr,
              this.expr(value.value, undefined)[1],
              value.sourceloc,
            );
            assert(valueResult.variant === Semantic.ENode.LiteralExpr);

            if (valueResult.type !== enumDatatypeId) {
              throw new CompilerError(
                `This enum cannot have values with mixed datatypes '${Semantic.serializeTypeUse(
                  this.sr,
                  valueResult.type,
                )}' and '${Semantic.serializeTypeUse(this.sr, enumDatatypeId)}'`,
                value.sourceloc,
              );
            }
            assert(valueResult.literal.type === EPrimitive.str);

            enumType.values.push({
              name: value.name,
              type: enumDatatypeId,
              valueExpr: this.sr.b.literal(valueResult.literal.value, value.sourceloc)[1],
              literalExpr: this.sr.b.literalValue(
                {
                  type: "enum",
                  enumType: enumTypeId,
                  valueName: value.name,
                },
                value.sourceloc,
              )[1],
            });

            if (usedValues.has(valueResult.literal.value)) {
              throw new CompilerError(
                `Multiple fields with value "${valueResult.literal.value}" not allowed`,
                value.sourceloc,
              );
            }
            usedValues.add(valueResult.literal.value);
          } else {
            throw new CompilerError(
              `An enum with string values requires all values to be defined`,
              value.sourceloc,
            );
          }
        }
      }
    } else {
      enumType.type = this.sr.b.intType();
      enumType.values.push({
        type: this.sr.b.intType(),
        name: `__HZ_DUMMY_ENUM_VALUE_${makeTempId()}`,
        literalExpr: this.sr.b.literal(0n, enumValue.sourceloc)[1],
        valueExpr: this.sr.b.literal(0n, enumValue.sourceloc)[1], // Not supposed to be accessed
      });
    }

    return enumTypeId;
  }

  memberAccess(
    memberAccess: Collect.MemberAccessExpr,
    inference: Semantic.Inference,
  ): readonly [Semantic.Expression, Semantic.ExprId] {
    const collectedObjectExpr = this.sr.cc.exprNodes.get(memberAccess.expr);
    if (
      collectedObjectExpr.variant === Collect.ENode.SymbolValueExpr &&
      collectedObjectExpr.name === "fn"
    ) {
      throw new CompilerError(
        `'fn' intrinsic object does not have a member named '${memberAccess.memberName}'`,
        memberAccess.sourceloc,
      );
    }

    const [object, objectId] = this.expr(memberAccess.expr, inference);
    let objectTypeUse = this.sr.typeUseNodes.get(object.type);
    let objectType = this.sr.typeDefNodes.get(objectTypeUse.type);

    if (object.variant === Semantic.ENode.DatatypeAsValueExpr) {
      return this.elaborateDatatypeMemberAccess(this.sr, objectId, object.type, memberAccess, {
        gonnaCallFunctionWithParameterValues: inference?.gonnaCallFunctionWithParameterValues,
      });
    }

    if (memberAccess.memberName === "toString") {
      const funcname = `__hz_value_to_string_${Semantic.mangleTypeUse(this.sr, object.type).name}`;

      let [func, funcId] = [null, null] as [
        Semantic.FunctionSymbol | null,
        Semantic.SymbolId | null,
      ];
      if (this.sr.syntheticFunctions.has(funcname)) {
        funcId = this.sr.syntheticFunctions.get(funcname)!;
        assert(funcId);
        const sym = this.sr.symbolNodes.get(funcId);
        assert(sym.variant === Semantic.ENode.FunctionSymbol);
        func = sym;
      } else {
        const functionType = makeRawFunctionDatatypeAvailable(this.sr, {
          parameters: [
            {
              optional: false,
              type: object.type,
            },
          ],
          returnType: this.sr.b.strType(),
          requires: {
            final: true,
            pure: false,
            noreturn: false,
            noreturnIf: null,
          },
          sourceloc: memberAccess.sourceloc,
          vararg: false,
        });

        // This MUST be a callable because we want toString() to NOT have parameters. Therefore
        // we must get the value itself into the function without requiring an argument later.
        // Therefore we create a callable and get the value into the callable, such that later the
        // callable can simply be called without arguments because the value is already inside the callable.
        const code = `return fmt.format(this);`;
        [func, funcId] = this.sr.b.syntheticFunctionFromCode({
          functionTypeId: functionType,
          parameterNames: ["this"],
          funcname: funcname,
          bodySourceCode: code,
          currentScope: this.currentContext.currentScope,
          sourceloc: memberAccess.sourceloc,
        });
        this.sr.syntheticFunctions.set(funcname, funcId);
      }

      assert(func && funcId);

      return this.sr.b.addExpr(this.sr, {
        variant: Semantic.ENode.CallableExpr,
        functionSymbol: funcId,
        instanceIds: [],
        isTemporary: true,
        sourceloc: memberAccess.sourceloc,
        thisExpr: objectId,
        type: makeTypeUse(
          this.sr,
          this.sr.b.addType(this.sr, {
            variant: Semantic.ENode.CallableDatatype,
            concrete: true,
            functionType: func.type,
            thisExprType: object.type,
          })[1],
          EDatatypeMutability.Default,
          false,
          memberAccess.sourceloc,
        )[1],
        flow: object.flow,
        writes: object.writes,
      });
    }

    if (objectType.variant === Semantic.ENode.ParameterPackDatatype) {
      if (memberAccess.memberName === "length") {
        if (objectType.parameters === null) {
          throw new CompilerError(
            `Parameter Pack is not substituted yet and does not have enough context to know its length`,
            memberAccess.sourceloc,
          );
        }
        return this.sr.b.literalValue(
          {
            type: EPrimitive.int,
            unit: null,
            value: BigInt(objectType.parameters.length),
          },
          memberAccess.sourceloc,
        );
      }
      throw new CompilerError(
        `Parameter Pack does not have a member named '${memberAccess.memberName}'`,
        memberAccess.sourceloc,
      );
    }

    if (
      objectType.variant === Semantic.ENode.PrimitiveDatatype &&
      objectType.primitive === EPrimitive.str
    ) {
      if (memberAccess.memberName === "length") {
        return this.sr.b.memberAccessRaw(
          objectId,
          "length",
          this.sr.b.intType(),
          true,
          memberAccess.sourceloc,
        );
      }

      if (memberAccess.memberName === "substr") {
        const funcname = `__hz_string_substr_`;

        let [func, funcId] = [null, null] as [
          Semantic.FunctionSymbol | null,
          Semantic.SymbolId | null,
        ];
        if (this.sr.syntheticFunctions.has(funcname)) {
          funcId = this.sr.syntheticFunctions.get(funcname)!;
          assert(funcId);
          const sym = this.sr.symbolNodes.get(funcId);
          assert(sym.variant === Semantic.ENode.FunctionSymbol);
          func = sym;
        } else {
          const functionType = makeRawFunctionDatatypeAvailable(this.sr, {
            parameters: [
              {
                optional: false,
                type: object.type,
              },
              { optional: false, type: this.sr.b.optionalIntType() },
              {
                optional: false,
                type: this.sr.b.optionalIntType(),
              },
            ],
            returnType: this.sr.b.strType(),
            requires: {
              final: true,
              pure: false,
              noreturn: false,
              noreturnIf: null,
            },
            sourceloc: memberAccess.sourceloc,
            vararg: false,
          });

          const code = `__c__("return HZSTD_STRING_SUBSTR(this, start, end);");`;

          [func, funcId] = this.sr.b.syntheticFunctionFromCode({
            functionTypeId: functionType,
            parameterNames: ["this", "start", "end"],
            funcname: funcname,
            bodySourceCode: code,
            currentScope: this.currentContext.currentScope,
            sourceloc: memberAccess.sourceloc,
          });
          this.sr.syntheticFunctions.set(funcname, funcId);
        }

        assert(func && funcId);

        return this.sr.b.addExpr(this.sr, {
          variant: Semantic.ENode.CallableExpr,
          functionSymbol: funcId,
          instanceIds: [],
          isTemporary: true,
          sourceloc: memberAccess.sourceloc,
          thisExpr: objectId,
          type: makeTypeUse(
            this.sr,
            this.sr.b.addType(this.sr, {
              variant: Semantic.ENode.CallableDatatype,
              concrete: true,
              functionType: func.type,
              thisExprType: object.type,
            })[1],
            EDatatypeMutability.Default,
            false,
            memberAccess.sourceloc,
          )[1],
          flow: object.flow,
          writes: object.writes,
        });
      }

      // TODO: Turn this into a slice [N]u8
      // if (expr.memberName === "data") {
      //   return Semantic.addExpr(sr, {
      //     variant: Semantic.ENode.MemberAccessExpr,
      //     isTemporary: true,
      //     sourceloc: expr.sourceloc,
      //     type: makeNullableReferenceDatatypeAvailable(
      //       sr,
      //       makePrimitiveAvailable(
      //         sr,
      //         EPrimitive.u8,
      //         EDatatypeMutability.Const,
      //         expr.sourceloc
      //       ),
      //       EDatatypeMutability.Const,
      //       expr.sourceloc
      //     ),
      //     expr: objectId,
      //     memberName: "data",
      //   });
      // }
      throw new CompilerError(
        `Datatype '${Semantic.serializeTypeUse(
          this.sr,
          object.type,
        )}' does not have a member named '${memberAccess.memberName}'`,
        memberAccess.sourceloc,
      );
    }

    if (objectType.variant === Semantic.ENode.DynamicArrayDatatype) {
      for (const fieldId of objectType.syntheticFields) {
        const field = this.sr.symbolNodes.get(fieldId);
        if (field.variant === Semantic.ENode.VariableSymbol) {
          if (field.name === "length" && memberAccess.memberName === "length") {
            return this.sr.b.memberAccessRaw(
              objectId,
              "length",
              this.sr.b.intType(),
              true,
              memberAccess.sourceloc,
            );
          }
        }
      }

      if (memberAccess.memberName === "push") {
        const funcname = `__hz_dynamic_array_push_${
          Semantic.mangleTypeUse(this.sr, objectType.datatype).name
        }`;

        let [func, funcId] = [null, null] as [
          Semantic.FunctionSymbol | null,
          Semantic.SymbolId | null,
        ];
        if (this.sr.syntheticFunctions.has(funcname)) {
          funcId = this.sr.syntheticFunctions.get(funcname)!;
          assert(funcId);
          const sym = this.sr.symbolNodes.get(funcId);
          assert(sym.variant === Semantic.ENode.FunctionSymbol);
          func = sym;
        } else {
          const functionType = makeRawFunctionDatatypeAvailable(this.sr, {
            parameters: [
              {
                optional: false,
                type: object.type,
              },
              {
                optional: false,
                type: objectType.datatype,
              },
            ],
            returnType: this.sr.b.voidType(),
            requires: {
              final: true,
              pure: false,
              noreturn: false,
              noreturnIf: null,
            },
            sourceloc: memberAccess.sourceloc,
            vararg: false,
          });

          const name = Semantic.mangleTypeUse(this.sr, objectType.datatype);
          const code = `__c__("HZSTD_ARRAY_PUSH(this, ${
            name.wasMangled ? "_H" + name.name : name.name
          }, element);");`;

          [func, funcId] = this.sr.b.syntheticFunctionFromCode({
            functionTypeId: functionType,
            parameterNames: ["this", "element"],
            funcname: funcname,
            bodySourceCode: code,
            currentScope: this.currentContext.currentScope,
            sourceloc: memberAccess.sourceloc,
          });
          this.sr.syntheticFunctions.set(funcname, funcId);
        }

        assert(func && funcId);

        return this.sr.b.addExpr(this.sr, {
          variant: Semantic.ENode.CallableExpr,
          functionSymbol: funcId,
          instanceIds: [],
          isTemporary: true,
          sourceloc: memberAccess.sourceloc,
          thisExpr: objectId,
          type: makeTypeUse(
            this.sr,
            this.sr.b.addType(this.sr, {
              variant: Semantic.ENode.CallableDatatype,
              concrete: true,
              functionType: func.type,
              thisExprType: object.type,
            })[1],
            EDatatypeMutability.Default,
            false,
            memberAccess.sourceloc,
          )[1],
          flow: object.flow,
          writes: object.writes,
        });
      }
      if (memberAccess.memberName === "pop") {
        const funcname = `__hz_dynamic_array_pop_${
          Semantic.mangleTypeUse(this.sr, objectType.datatype).name
        }`;

        let [func, funcId] = [null, null] as [
          Semantic.FunctionSymbol | null,
          Semantic.SymbolId | null,
        ];
        if (this.sr.syntheticFunctions.has(funcname)) {
          funcId = this.sr.syntheticFunctions.get(funcname)!;
          assert(funcId);
          const sym = this.sr.symbolNodes.get(funcId);
          assert(sym.variant === Semantic.ENode.FunctionSymbol);
          func = sym;
        } else {
          const functionType = makeRawFunctionDatatypeAvailable(this.sr, {
            parameters: [
              {
                optional: false,
                type: object.type,
              },
            ],
            returnType: objectType.datatype,
            requires: {
              final: true,
              pure: false,
              noreturn: false,
              noreturnIf: null,
            },
            sourceloc: memberAccess.sourceloc,
            vararg: false,
          });

          const code = `__c__("return HZSTD_ARRAY_POP(this, ${
            Semantic.mangleTypeUse(this.sr, objectType.datatype).name
          });");`;

          [func, funcId] = this.sr.b.syntheticFunctionFromCode({
            functionTypeId: functionType,
            parameterNames: ["this"],
            funcname: funcname,
            bodySourceCode: code,
            currentScope: this.currentContext.currentScope,
            sourceloc: memberAccess.sourceloc,
          });
          this.sr.syntheticFunctions.set(funcname, funcId);
        }

        assert(func && funcId);

        return this.sr.b.addExpr(this.sr, {
          variant: Semantic.ENode.CallableExpr,
          functionSymbol: funcId,
          instanceIds: [],
          isTemporary: true,
          sourceloc: memberAccess.sourceloc,
          thisExpr: objectId,
          type: makeTypeUse(
            this.sr,
            this.sr.b.addType(this.sr, {
              variant: Semantic.ENode.CallableDatatype,
              concrete: true,
              functionType: func.type,
              thisExprType: object.type,
            })[1],
            EDatatypeMutability.Default,
            false,
            memberAccess.sourceloc,
          )[1],
          flow: object.flow,
          writes: object.writes,
        });
      }
      throw new CompilerError(
        `Datatype '${Semantic.serializeTypeUse(
          this.sr,
          object.type,
        )}' does not have a member named '${memberAccess.memberName}'`,
        memberAccess.sourceloc,
      );
    }
    if (objectType.variant === Semantic.ENode.FixedArrayDatatype) {
      if (memberAccess.memberName === "length") {
        return this.sr.b.literalValue(
          {
            type: EPrimitive.int,
            unit: null,
            value: objectType.length,
          },
          memberAccess.sourceloc,
        );
      }
      throw new CompilerError(
        `Datatype '${Semantic.serializeTypeUse(
          this.sr,
          object.type,
        )}' does not have a member named '${memberAccess.memberName}'`,
        memberAccess.sourceloc,
      );
    }

    if (objectType.variant !== Semantic.ENode.StructDatatype) {
      throw new CompilerError(
        "Cannot access member of non-structural type " +
          Semantic.serializeTypeUse(this.sr, object.type),
        memberAccess.sourceloc,
      );
    }

    const memberId = objectType.members.find((mId) => {
      const m = this.sr.symbolNodes.get(mId);
      assert(m.variant === Semantic.ENode.VariableSymbol);
      return m.name === memberAccess.memberName;
    });

    if (memberId) {
      if (memberAccess.genericArgs.length > 0) {
        throw new CompilerError(
          `Member '${memberAccess.memberName}' does not expect any type arguments, but ${memberAccess.genericArgs.length} are given`,
          memberAccess.sourceloc,
        );
      }
      const member = this.sr.symbolNodes.get(memberId);
      assert(member.variant === Semantic.ENode.VariableSymbol && member.type);

      return this.sr.b.memberAccess(
        objectId,
        memberAccess.memberName,
        this.currentContext.constraints,
        memberAccess.sourceloc,
      );
    }

    const collectedStruct = this.sr.cc.typeDefNodes.get(objectType.originalCollectedDefinition);
    assert(collectedStruct.variant === Collect.ENode.StructTypeDef);
    const structScope = this.sr.cc.scopeNodes.get(collectedStruct.lexicalScope);
    assert(structScope.variant === Collect.ENode.StructLexicalScope);
    const overloadGroupId = [...structScope.symbols].find((mId) => {
      const m = this.sr.cc.symbolNodes.get(mId);
      return (
        m.variant === Collect.ENode.FunctionOverloadGroupSymbol &&
        m.name === memberAccess.memberName
      );
    });

    if (overloadGroupId) {
      const overloadGroup = this.sr.cc.symbolNodes.get(overloadGroupId);
      assert(overloadGroup.variant === Collect.ENode.FunctionOverloadGroupSymbol);

      const chosenOverloadId = this.FunctionOverloadChoose(
        overloadGroupId,
        inference?.gonnaCallFunctionWithParameterValues,
        memberAccess.sourceloc,
      );

      const collectedMethod = this.sr.cc.symbolNodes.get(chosenOverloadId);
      assert(collectedMethod.variant === Collect.ENode.FunctionSymbol);

      let objectTypeId = object.type;
      // const objectType = this.sr.typeDefNodes.get(this.sr.typeUseNodes.get(objectTypeId).type);

      const typedef = this.sr.typeUseNodes.get(objectTypeId).type;
      let elaboratedStructCache = null as Semantic.StructDef | null;
      for (const [_, cache] of this.sr.elaboratedStructDatatypes) {
        for (const entry of cache) {
          if (entry.result === typedef) {
            elaboratedStructCache = entry;
          }
        }
      }
      assert(elaboratedStructCache);

      const parameterPackTypes = this.prepareParameterPackTypes(
        overloadGroup.name,
        collectedMethod.parameters,
        inference?.gonnaCallFunctionWithParameterValues,
        memberAccess.sourceloc,
      );

      const elaboratedMethodId = this.withContext(
        {
          context: Semantic.mergeSubstitutionContext(
            elaboratedStructCache.substitutionContext,
            this.currentContext,
            {
              currentScope: this.currentContext.currentScope,
              genericsScope: this.currentContext.currentScope,
              instanceDeps: {
                instanceDependsOn: new Map(),
                structMembersDependOn: new Map(),
                symbolDependsOn: new Map(),
              },
            },
          ),
          inAttemptExpr: null,
          inFunction: null,
        },
        () =>
          this.elaborateFunctionSymbolWithGenerics(
            this.elaborateFunctionSignature(chosenOverloadId),
            memberAccess.genericArgs.map((g) => this.expressionAsGenericArg(g)),
            memberAccess.sourceloc,
            parameterPackTypes,
          ),
      );
      assert(elaboratedMethodId);
      const elaboratedMethod = this.sr.symbolNodes.get(elaboratedMethodId);
      assert(elaboratedMethod.variant === Semantic.ENode.FunctionSymbol);

      if (elaboratedMethod.staticMethod) {
        throw new CompilerError(
          `Method ${Semantic.serializeFullSymbolName(
            this.sr,
            elaboratedMethodId,
          )} is static but is called through an object`,
          memberAccess.sourceloc,
        );
      }

      if (
        objectTypeUse.mutability !== EDatatypeMutability.Mut &&
        elaboratedMethod.methodRequiredMutability === EDatatypeMutability.Mut
      ) {
        throw new CompilerError(
          `Method ${Semantic.serializeFullSymbolName(
            this.sr,
            elaboratedMethodId,
          )} can mutate the object but is not called on an object that is mutable. Is it called on a const object?`,
          memberAccess.sourceloc,
        );
      }

      if (
        objectTypeUse.mutability !== EDatatypeMutability.Const &&
        elaboratedMethod.methodRequiredMutability === EDatatypeMutability.Const
      ) {
        throw new CompilerError(
          `Method ${Semantic.serializeFullSymbolName(
            this.sr,
            elaboratedMethodId,
          )} requires the object it is called on to be const (fully immutable).`,
          memberAccess.sourceloc,
        );
      }

      return this.sr.b.addExpr(this.sr, {
        variant: Semantic.ENode.CallableExpr,
        instanceIds: [],
        thisExpr: objectId,
        functionSymbol: elaboratedMethodId,
        type: makeTypeUse(
          this.sr,
          this.sr.b.addType(this.sr, {
            variant: Semantic.ENode.CallableDatatype,
            thisExprType: object.type,
            functionType: elaboratedMethod.type,
            concrete: this.sr.typeDefNodes.get(elaboratedMethod.type).concrete,
          })[1],
          EDatatypeMutability.Const,
          false,
          memberAccess.sourceloc,
        )[1],
        sourceloc: memberAccess.sourceloc,
        isTemporary: true,
        flow: object.flow,
        writes: object.writes,
      });
    }

    throw new CompilerError(
      `No attribute named '${memberAccess.memberName}' in struct ${objectType.name}`,
      memberAccess.sourceloc,
    );
  }

  typeDefSymbol(typeDefSymbol: Collect.TypeDefSymbol) {
    const typedef = this.sr.cc.typeDefNodes.get(typeDefSymbol.typeDef);
    switch (typedef.variant) {
      case Collect.ENode.TypeDefAlias: {
        this.sr.exportedTypeAliases.add(typeDefSymbol.typeDef);
        return []; // No need to pre-elaborate type aliases, they are elaborated on demand when looked up
      }

      case Collect.ENode.NamespaceTypeDef: {
        return [this.sr.b.typeDefSymbol(this.sr.e.namespace(typeDefSymbol.typeDef))[1]];
      }

      case Collect.ENode.StructTypeDef: {
        // If it's concrete, act as if we tried to use it to elaborate it immediately for early errors. If generic, skip
        if (typedef.generics.length === 0) {
          return [
            this.sr.b.typeDefSymbol(
              this.instantiateAndElaborateStructWithGenerics(
                typeDefSymbol.typeDef,
                [],
                typedef.sourceloc,
              ),
            )[1],
          ];
        }
        return [];
      }

      case Collect.ENode.EnumTypeDef: {
        return [this.sr.b.typeDefSymbol(this.sr.e.enum(typeDefSymbol.typeDef))[1]];
      }

      default:
        assert(false, (typedef as any).variant.toString());
    }
  }

  functionOverloadGroup(overloadGroup: Collect.FunctionOverloadGroupSymbol) {
    const functionSymbols: Semantic.SymbolId[] = [];
    for (const id of overloadGroup.overloads) {
      const func = this.sr.cc.symbolNodes.get(id);
      assert(func.variant === Collect.ENode.FunctionSymbol);
      if (func.generics.length === 0 && !funcSymHasParameterPack(this.sr.cc, id)) {
        const signature = this.elaborateFunctionSignature(id);
        const sId = this.elaborateFunctionSymbol(
          signature,
          this.elaborateParentSymbolFromCache(func.parentScope),
          [],
        );
        functionSymbols.push(sId);
      }
    }
    return functionSymbols;
  }

  variableSymbol(variableSymbol: Collect.VariableSymbol, variableSymbolId: Collect.SymbolId) {
    assert(variableSymbol.variableContext === EVariableContext.Global);
    if (this.sr.elaboratedGlobalVariableSymbols.has(variableSymbolId)) {
      return [this.sr.elaboratedGlobalVariableSymbols.get(variableSymbolId)!];
    }

    let type =
      (variableSymbol.type && this.lookupAndElaborateDatatype(variableSymbol.type)) || null;

    let comptimeValue: Semantic.ExprId | null = null;
    let global = false;
    if (type === null) {
      if (!variableSymbol.globalValueInitializer) {
        throw new CompilerError(
          `A global constant is by definition immutable and is always required to be initialized with a value that can be evaluated at compile time.`,
          variableSymbol.sourceloc,
        );
      }
      const [expr, exprId] = this.sr.e.expr(variableSymbol.globalValueInitializer, undefined);
      type = expr.type;
      global = true;
      comptimeValue = exprId;
    }

    const [variable, variableId] = this.sr.b.variableSymbol(
      variableSymbol.name,
      type,
      variableSymbol.comptime,
      comptimeValue,
      variableSymbol.mutability,
      this.elaborateParentSymbolFromCache(variableSymbol.inScope),
      variableSymbol.sourceloc,
    );
    this.sr.elaboratedGlobalVariableSymbols.set(variableSymbolId, variableId);

    if (global) {
      assert(variable.comptimeValue);
      const [_, defSymId] = this.sr.b.addSymbol(this.sr, {
        variant: Semantic.ENode.GlobalVariableDefinitionSymbol,
        comptime: variable.comptime,
        concrete: variable.concrete,
        export: variable.export,
        extern: variable.extern,
        name: variable.name,
        parentStructOrNS: variable.parentStructOrNS,
        sourceloc: variable.sourceloc,
        value: variable.comptimeValue,
        variableSymbol: variableId,
      });
      this.sr.elaboratedGlobalVariableDefinitionSymbols.add(defSymId);
    }

    return [variableId];
  }

  topLevelSymbol(symbolId: Collect.SymbolId): Semantic.SymbolId[] {
    const symbol = this.sr.cc.symbolNodes.get(symbolId);
    switch (symbol.variant) {
      case Collect.ENode.TypeDefSymbol:
        return this.typeDefSymbol(symbol);

      case Collect.ENode.FunctionOverloadGroupSymbol:
        return this.functionOverloadGroup(symbol);

      case Collect.ENode.VariableSymbol: {
        const ids = this.variableSymbol(symbol, symbolId);
        assert(ids.length === 1);
        const globalVarId = ids[0];
        const globalVar = this.sr.symbolNodes.get(globalVarId);
        assert(globalVar.variant === Semantic.ENode.VariableSymbol);

        return [globalVarId];
      }

      case Collect.ENode.CInjectDirective: {
        const [e, eId] = this.expr(symbol.expr, undefined);

        const result = EvalCTFE(this.sr, eId);
        if (!result.ok) {
          throw new CompilerError(`This expression is not evaluable at compile time`, e.sourceloc);
        }

        const r = result.value[0];
        assert(r.variant === Semantic.ENode.LiteralExpr);
        if (
          r.literal.type !== EPrimitive.str &&
          r.literal.type !== EPrimitive.cstr &&
          r.literal.type !== EPrimitive.ccstr
        ) {
          throw new CompilerError(
            `This intrinsic can only take compile-time-evaluable string literals`,
            e.sourceloc,
          );
        }

        return [this.sr.b.cInject(r.literal.value, symbol.export, symbol.sourceloc)];
      }

      default:
        assert(false, "Global Symbol " + symbol.variant);
    }
  }

  instantiateAndElaborateStructWithGenerics(
    definedStructTypeId: Collect.TypeDefId,
    genericArgs: Semantic.ExprId[],
    sourceloc: SourceLoc,
  ) {
    const definedStructType = this.sr.cc.typeDefNodes.get(definedStructTypeId);
    assert(definedStructType.variant === Collect.ENode.StructTypeDef);

    if (definedStructType.generics.length !== genericArgs.length) {
      throw new CompilerError(
        `Type ${definedStructType.name} expects ${definedStructType.generics.length} type parameters but got ${genericArgs.length}`,
        sourceloc,
      );
    }

    let context = this.currentContext;

    if (definedStructType.generics.length !== 0) {
      assert(definedStructType.lexicalScope);
      context = Semantic.isolateElaborationContext(context, {
        currentScope: context.currentScope,
        genericsScope: context.currentScope,
        constraints: context.constraints,
        instanceDeps: {
          instanceDependsOn: new Map(),
          structMembersDependOn: new Map(),
          symbolDependsOn: new Map(),
        },
      });
      for (let i = 0; i < definedStructType.generics.length; i++) {
        context.substitute.set(definedStructType.generics[i], genericArgs[i]);
      }
    }

    return this.withContext(
      {
        context: context,
        inAttemptExpr: null,
        inFunction: null,
      },
      () => {
        return this.instantiateAndElaborateStruct(definedStructTypeId);
      },
    );
  }

  elaborateMethodsAndTypedefsOfStruct(semanticStructId: Semantic.TypeDefId) {
    const semanticStruct = this.sr.typeDefNodes.get(semanticStructId);
    assert(semanticStruct.variant === Semantic.ENode.StructDatatype);
    const collectedStructDef = this.sr.cc.symbolNodes.get(semanticStruct.originalCollectedSymbol);
    assert(collectedStructDef.variant === Collect.ENode.TypeDefSymbol);
    const collectedStruct = this.sr.cc.typeDefNodes.get(collectedStructDef.typeDef);
    assert(collectedStruct.variant === Collect.ENode.StructTypeDef);

    const lexicalScope = this.sr.cc.scopeNodes.get(collectedStruct.lexicalScope);
    assert(lexicalScope.variant === Collect.ENode.StructLexicalScope);
    const fieldScope = this.sr.cc.scopeNodes.get(collectedStruct.fieldScope);
    assert(fieldScope.variant === Collect.ENode.StructFieldScope);
    [...fieldScope.symbols, ...lexicalScope.symbols].forEach((symbolId) => {
      const symbol = this.sr.cc.symbolNodes.get(symbolId);
      if (symbol.variant === Collect.ENode.FunctionOverloadGroupSymbol) {
        symbol.overloads.forEach((overloadId) => {
          const overloadedFunc = this.sr.cc.symbolNodes.get(overloadId);
          assert(overloadedFunc.variant === Collect.ENode.FunctionSymbol);
          if (
            overloadedFunc.generics.length !== 0 ||
            funcSymHasParameterPack(this.sr.cc, overloadId)
          ) {
            return;
          }
          const signature = this.elaborateFunctionSignature(overloadId);
          const funcId = this.elaborateFunctionSymbol(signature, semanticStructId, []);
          const func = this.sr.symbolNodes.get(funcId);
          assert(funcId && func && func.variant === Semantic.ENode.FunctionSymbol);
          semanticStruct.methods.push(funcId);
        });
      } else if (symbol.variant === Collect.ENode.TypeDefSymbol) {
        const def = this.sr.cc.typeDefNodes.get(symbol.typeDef);
        if (def.variant === Collect.ENode.StructTypeDef) {
          if (def.generics.length !== 0) {
            return;
          }
          // If the nested struct is not generic, instantiate it without generics for early errors
          const subStructId = this.instantiateAndElaborateStructWithGenerics(
            symbol.typeDef,
            [],
            def.sourceloc,
          );
          semanticStruct.nestedStructs.push(subStructId);
        }
      }
    });
  }

  elaborateStructMember(
    semanticStructId: Semantic.TypeDefId,
    symbol: Collect.VariableSymbol,
    onlyElaborateType: boolean = false,
  ) {
    const semanticStruct = this.sr.typeDefNodes.get(semanticStructId);
    assert(semanticStruct.variant === Semantic.ENode.StructDatatype);
    const structSym = this.sr.cc.symbolNodes.get(semanticStruct.originalCollectedSymbol);
    assert(structSym.variant === Collect.ENode.TypeDefSymbol);
    const structType = this.sr.cc.typeDefNodes.get(structSym.typeDef);
    assert(structType.variant === Collect.ENode.StructTypeDef);
    assert(symbol.type);
    const typeId = this.withContext(
      {
        context: Semantic.isolateElaborationContext(this.currentContext, {
          // Start lookup in the struct itself, these are members, so both the type and
          // its generics must be found from within the struct
          currentScope: structType.lexicalScope,
          genericsScope: structType.lexicalScope,
          constraints: ConstraintSet.empty(),
          instanceDeps: {
            instanceDependsOn: new Map(),
            structMembersDependOn: new Map(),
            symbolDependsOn: new Map(),
          },
        }),
        inAttemptExpr: null,
        inFunction: null,
      },
      () => {
        return this.lookupAndElaborateDatatype(symbol.type!);
      },
    );
    if (onlyElaborateType) return;
    const typeInstance = this.sr.typeUseNodes.get(typeId);
    const type = this.sr.typeDefNodes.get(typeInstance.type);
    const [variable, variableId] = this.sr.b.addSymbol(this.sr, {
      variant: Semantic.ENode.VariableSymbol,
      name: symbol.name,
      export: false,
      extern: EExternLanguage.None,
      mutability: EVariableMutability.Default,
      sourceloc: symbol.sourceloc,
      memberOfStruct: semanticStructId,
      type: typeId,
      consumed: false,
      variableContext: EVariableContext.MemberOfStruct,
      parentStructOrNS: semanticStructId,
      comptime: false,
      comptimeValue: null,
      concrete: type.concrete,
    });
    semanticStruct.members.push(variableId);
    const defaultValue = structType.defaultMemberValues.find((v) => v.name === symbol.name);
    if (defaultValue) {
      const value = this.sr.cc.exprNodes.get(defaultValue.value);
      let defaultExprId: Semantic.ExprId;
      if (value.variant === Collect.ENode.SymbolValueExpr && value.name === "default") {
        if (value.genericArgs.length !== 0) {
          throw new CompilerError(
            `'default' initializer cannot take any generics`,
            symbol.sourceloc,
          );
        }
        defaultExprId = Conversion.MakeDefaultValue(this.sr, typeId, symbol.sourceloc);
      } else {
        defaultExprId = this.expr(defaultValue.value, {
          gonnaInstantiateStructWithType: variable.type,
          unsafe: false,
        })[1];
      }
      semanticStruct.memberDefaultValues.push({
        memberName: variable.name,
        value: Conversion.MakeConversionOrThrow(
          this.sr,
          defaultExprId,
          typeId,
          ConstraintSet.empty(),
          symbol.sourceloc,
          Conversion.Mode.Implicit,
          false,
        ),
      });
    }
  }

  elaborateMembersOfStruct(semanticStructId: Semantic.TypeDefId, onlyElaborateType: boolean) {
    const semanticStruct = this.sr.typeDefNodes.get(semanticStructId);
    assert(semanticStruct.variant === Semantic.ENode.StructDatatype);
    const collectedStructDef = this.sr.cc.symbolNodes.get(semanticStruct.originalCollectedSymbol);
    assert(collectedStructDef.variant === Collect.ENode.TypeDefSymbol);
    const collectedStruct = this.sr.cc.typeDefNodes.get(collectedStructDef.typeDef);
    assert(collectedStruct.variant === Collect.ENode.StructTypeDef);

    const lexicalScope = this.sr.cc.scopeNodes.get(collectedStruct.lexicalScope);
    assert(lexicalScope.variant === Collect.ENode.StructLexicalScope);
    const fieldScope = this.sr.cc.scopeNodes.get(collectedStruct.fieldScope);
    assert(fieldScope.variant === Collect.ENode.StructFieldScope);
    [...fieldScope.symbols, ...lexicalScope.symbols].forEach((symbolId) => {
      const symbol = this.sr.cc.symbolNodes.get(symbolId);
      if (symbol.variant === Collect.ENode.VariableSymbol) {
        this.elaborateStructMember(semanticStructId, symbol, onlyElaborateType);
      }
    });
  }

  instantiateAndElaborateStruct(
    definedStructTypeId: Collect.TypeDefId, // The defining struct datatype to be instantiated (e.g. struct Foo<T> {})
  ): Semantic.TypeDefId {
    const definedStructType = this.sr.cc.typeDefNodes.get(definedStructTypeId);
    assert(definedStructType.variant === Collect.ENode.StructTypeDef);

    const genericArgs = definedStructType.generics.map((g) => {
      const substitute = this.currentContext.substitute.get(g);
      assert(substitute);
      return substitute;
    });

    const parentStructOrNS = this.elaborateParentSymbolFromCache(definedStructType.parentScope);

    // This whole recursive stack and SCC business is a deep rabbit hole we must go down.
    // It is required in order to make sure complex chains of structs work, where one struct
    // may reference another struct, this struct has methods, those methods reference the original struct again
    // and access its fields, etc. An intricate algorithm is required to make it work, such that all structs are
    // elaborated and all of them can reference all other ones without issues of missing fields because they were
    // not elaborated yet.
    // Fun fact: This is really not trivial and the reason C++ has those shitty forward declarations and
    // incomplete structs, which simply goes around this problem and the compiler gives the problem to
    // the user instead of solving it. This is the reason C++ headers/sources with class method definitions suck.
    // We want to solve it in the compiler instead.

    // If already existing, return cached to prevent loops
    const existing = getFromStructDefCache(this.sr, definedStructTypeId, {
      genericArgs: genericArgs,
      parentStructOrNS: parentStructOrNS,
    });
    if (existing) {
      const struct = this.sr.typeDefNodes.get(existing);
      assert(struct.variant === Semantic.ENode.StructDatatype);

      if (this.currentContext.elaborationRecursiveStructStack.length === 0) {
        // This is not in a chain (or already past the end of the chain), so fix the members if required
        if (!struct.methodsFinalized && !struct.methodsInProgress) {
          struct.methodsInProgress = false;
          struct.methodsFinalized = true;
          this.elaborateMethodsAndTypedefsOfStruct(existing);
        }
      }

      if (struct.membersBuilt && !struct.membersFinalized) {
        struct.membersFinalized = true;
        this.elaborateMembersOfStruct(existing, true);
      }

      return existing;
    }

    const [struct, structId] = this.sr.b.addType<Semantic.StructDatatypeDef>(this.sr, {
      variant: Semantic.ENode.StructDatatype,
      name: definedStructType.name,
      generics: genericArgs,
      extern: definedStructType.extern,
      noemit: definedStructType.noemit,
      opaque: definedStructType.opaque,
      plain: definedStructType.plain,
      membersBuilt: false,
      membersFinalized: false,
      parentStructOrNS: parentStructOrNS,
      members: [],
      export: definedStructType.export,
      memberDefaultValues: [],
      methods: [],
      methodsFinalized: false,
      methodsInProgress: false,
      nestedStructs: [],
      sourceloc: definedStructType.sourceloc,
      concrete: genericArgs.every((g) => isTypeExprConcrete(this.sr, g)),
      originalCollectedDefinition: definedStructTypeId,
      originalCollectedSymbol: definedStructType.collectedTypeDefSymbol,
    });

    if (struct.concrete) {
      insertIntoStructDefCache(this.sr, definedStructTypeId, {
        genericArgs: genericArgs,
        parentStructOrNS: parentStructOrNS,
        result: structId,
        resultAsTypeDefSymbol: this.sr.b.addSymbol(this.sr, {
          variant: Semantic.ENode.TypeDefSymbol,
          datatype: structId,
        })[1],
        substitutionContext: this.currentContext,
      });

      if (definedStructType.export && struct.generics.length === 0) {
        const [_, id] = this.sr.b.typeDefSymbol(structId);
        this.sr.exportedSymbols.add(id);
      }

      const lexicalScope = this.sr.cc.scopeNodes.get(definedStructType.lexicalScope);
      assert(lexicalScope.variant === Collect.ENode.StructLexicalScope);
      const fieldScope = this.sr.cc.scopeNodes.get(definedStructType.fieldScope);
      assert(fieldScope.variant === Collect.ENode.StructFieldScope);

      const isRoot = this.currentContext.elaborationRecursiveStructStack.length === 0;
      this.currentContext.elaborationRecursiveStructStack.push(structId);

      if (isRoot) {
        struct.methodsInProgress = true;
      }

      // FIRST elaborate members
      this.elaborateMembersOfStruct(structId, false);
      struct.membersBuilt = true;

      if (isRoot) {
        // If this is a root struct of an elaboration chain, since all members are elaborated now,
        // elaborate methods and then elaborate members again, so they can elaborate their methods

        this.elaborateMethodsAndTypedefsOfStruct(structId);
        struct.methodsFinalized = true;
      }
      // If this is NOT a root struct, do NOT elaborate methods

      this.currentContext.elaborationRecursiveStructStack.pop();

      if (isRoot) {
        // Now elaborate all members again but without the stack, so they think they are the root now and fix themselves
        this.elaborateMembersOfStruct(structId, true);
        struct.membersFinalized = true;
      }
    }

    return structId;
  }

  elaborateVariableSymbolInScope(variableSymbolId: Collect.SymbolId) {
    const symbol = this.sr.cc.symbolNodes.get(variableSymbolId);
    switch (symbol.variant) {
      case Collect.ENode.VariableSymbol: {
        let variableContext = EVariableContext.FunctionLocal;
        let type: Semantic.TypeUseId | null = null;

        const typeOverride = this.currentContext.elaborationTypeOverride.get(variableSymbolId);
        if (typeOverride) {
          type = typeOverride;
        }

        if (symbol.variableContext === EVariableContext.FunctionParameter) {
          variableContext = EVariableContext.FunctionParameter;
          if (!symbol.type) {
            throw new InternalError("Parameter needs datatype");
          }
          const symbolType = this.sr.cc.typeUseNodes.get(symbol.type);
          if (symbolType.variant === Collect.ENode.ParameterPack) {
            // Is elaborated directly in function
            break;
          }
          type = this.withContext(
            {
              context: Semantic.isolateElaborationContext(this.currentContext, {
                genericsScope: symbol.inScope,
                currentScope: symbol.inScope,
                constraints: this.currentContext.constraints,
                instanceDeps: this.currentContext.instanceDeps,
              }),
              inFunction: this.inFunction,
              inAttemptExpr: this.inAttemptExpr,
            },
            () => this.lookupAndElaborateDatatype(symbol.type!),
          );
        } else if (symbol.variableContext === EVariableContext.ThisReference) {
          if (this.currentContext.elaboratedVariables.has(variableSymbolId)) {
            break;
          } else {
            assert(
              false,
              "Variable definition statement for This-Reference was encountered, but it's not yet in the variableMap. It should already be elaborated by the parent.",
            );
          }
        }
        const [_, variableId] = this.sr.b.addSymbol(this.sr, {
          variant: Semantic.ENode.VariableSymbol,
          export: false,
          extern: EExternLanguage.None,
          mutability: symbol.mutability,
          name: symbol.name,
          sourceloc: symbol.sourceloc,
          memberOfStruct: null,
          parentStructOrNS: this.elaborateParentSymbolFromCache(symbol.inScope),
          comptime: symbol.comptime,
          comptimeValue: null,
          variableContext: variableContext,
          consumed: false,
          type: type,
          concrete: false,
        });
        this.currentContext.elaboratedVariables.set(variableSymbolId, variableId);
        break;
      }

      default:
        assert(false, symbol.variant.toString());
    }
  }

  prepareParameterPackTypes(
    functionName: string,
    requiredParameters: Collect.ParameterValue[],
    givenArguments:
      | {
          index: number;
          exprId: Semantic.ExprId | null;
        }[]
      | undefined,
    sourceloc: SourceLoc,
  ) {
    const parameterPackTypes: Semantic.TypeUseId[] = [];

    const hasParameterPack = requiredParameters.some((p) => {
      const t = this.sr.cc.typeUseNodes.get(p.type);
      return t.variant === Collect.ENode.ParameterPack;
    });
    if (hasParameterPack) {
      const numParametersWithoutPack = requiredParameters.length - 1;

      if (givenArguments === undefined) {
        throw new CompilerError(
          `Function ${functionName} uses a Parameter Pack, but there is not enough context around the function access to determine the types it is going to be called with`,
          sourceloc,
        );
      }

      if (givenArguments.length < numParametersWithoutPack) {
        throw new CompilerError(
          `Function ${functionName} requires at least ${numParametersWithoutPack} parameters, but ${givenArguments.length} are given`,
          sourceloc,
        );
      }

      for (let i = numParametersWithoutPack; i < givenArguments.length; i++) {
        const exprId = givenArguments[i].exprId;
        assert(exprId);
        const expr = this.sr.exprNodes.get(exprId);
        parameterPackTypes.push(expr.type);
      }
    }
    return parameterPackTypes;
  }

  FunctionOverloadChoose(
    overloadGroupId: Collect.SymbolId,
    calledWithArgs: { index: number; exprId: Semantic.ExprId | null }[] | undefined,
    usageSourceLocation: SourceLoc,
  ) {
    const overloadGroup = this.sr.cc.symbolNodes.get(overloadGroupId);
    assert(overloadGroup.variant === Collect.ENode.FunctionOverloadGroupSymbol);

    if (overloadGroup.overloads.size === 1) {
      return [...overloadGroup.overloads][0];
    }

    if (calledWithArgs === undefined) {
      throw new CompilerError(
        `Function '${overloadGroup.name}' is overloaded but not directly called, so there is not enough context to disambiguate the overload. Overloaded functions must be immediately called to disambiguate the call using the given arguments`,
        usageSourceLocation,
      );
    }

    const matchSignatures = (exact: boolean) => {
      const matchingSignatures = [] as {
        matches: boolean;
        signature: Semantic.SymbolId;
        reason: string | null;
      }[];
      for (const overloadId of overloadGroup.overloads) {
        const overload = this.sr.cc.symbolNodes.get(overloadId);
        assert(overload.variant === Collect.ENode.FunctionSymbol);

        const signatureId = this.elaborateFunctionSignature(overloadId);
        const signature = this.sr.symbolNodes.get(signatureId);
        assert(signature.variant === Semantic.ENode.FunctionSignature);

        // if (signature.parameters.length !== calledWithArgs.length) {
        //   exactCandidateSignatures.push({
        //     matches: false,
        //     signature: signatureId,
        //     reason: `Expects ${signature.parameters.length} arguments instead of ${calledWithArgs.length}`,
        //   });
        //   continue;
        // }

        if (funcSymHasParameterPack(this.sr.cc, overloadId)) {
          matchingSignatures.push({
            matches: false,
            signature: signatureId,
            reason: `Contains a parameter pack (exact match not possible)`,
          });
          continue;
        }

        let maxArgIndex = 0;
        for (const arg of calledWithArgs) {
          if (arg.index > maxArgIndex) maxArgIndex = arg.index;
        }

        if (maxArgIndex >= signature.parameters.length) {
          matchingSignatures.push({
            matches: false,
            signature: signatureId,
            reason: `Too many parameters given`,
          });
          continue;
        }

        if (maxArgIndex < signature.parameters.length - 1) {
          matchingSignatures.push({
            matches: false,
            signature: signatureId,
            reason: `Not enough parameters given`,
          });
          continue;
        }

        let matches = true;
        let reason = null as string | null;
        signature.parameters.forEach((signatureParam, i) => {
          const passed = calledWithArgs.find((a) => a.index === i);
          if (!passed || !passed.exprId) {
            // This parameter is not passed or is not concrete, so hope that the others are enough for a match
            // matches = false;
            // reason = `Parameter #${i + 1} does not have a concrete type`;
            return;
          }

          const actuallyGivenexpression = this.sr.exprNodes.get(passed.exprId);
          const aUse = this.sr.e.getTypeUse(actuallyGivenexpression.type);
          const bUse = this.sr.e.getTypeUse(signatureParam.type);
          if (aUse.type !== bUse.type) {
            matches = false;
            reason = `Parameter #${i + 1} has unrelated type: ${Semantic.serializeTypeUse(
              this.sr,
              actuallyGivenexpression.type,
            )} != ${Semantic.serializeTypeUse(this.sr, signatureParam.type)}`;
            return;
          }

          if (aUse.inline !== bUse.inline) {
            matches = false;
            reason = `Parameter #${
              i + 1
            } has mismatching 'inline' attribute: ${Semantic.serializeTypeUse(
              this.sr,
              actuallyGivenexpression.type,
            )} != ${Semantic.serializeTypeUse(this.sr, signatureParam.type)}`;
            return;
          }

          if (exact) {
            if (aUse.mutability !== bUse.mutability) {
              matches = false;
              reason = `Parameter #${i + 1} has mismatching mutability: ${Semantic.serializeTypeUse(
                this.sr,
                actuallyGivenexpression.type,
              )} != ${Semantic.serializeTypeUse(this.sr, signatureParam.type)}`;
              return;
            }
          } else {
            if (
              aUse.mutability !== EDatatypeMutability.Mut &&
              bUse.mutability === EDatatypeMutability.Mut
            ) {
              matches = false;
              reason = `Parameter #${
                i + 1
              } cannot implicitly make non-mutable datatype mutable: ${Semantic.serializeTypeUse(
                this.sr,
                actuallyGivenexpression.type,
              )} != ${Semantic.serializeTypeUse(this.sr, signatureParam.type)}`;
              return;
            }

            if (
              aUse.mutability !== EDatatypeMutability.Const &&
              bUse.mutability === EDatatypeMutability.Const
            ) {
              matches = false;
              reason = `Parameter #${
                i + 1
              } cannot implicitly make non-const datatype const: ${Semantic.serializeTypeUse(
                this.sr,
                actuallyGivenexpression.type,
              )} != ${Semantic.serializeTypeUse(this.sr, signatureParam.type)}`;
              return;
            }
          }
          // Else it fits
        });

        matchingSignatures.push({
          matches: matches,
          signature: signatureId,
          reason: reason,
        });
      }

      return matchingSignatures;
    };

    const exactMatchingSignatures = matchSignatures(true);
    if (exactMatchingSignatures.filter((s) => s.matches).length === 1) {
      const signature = this.sr.symbolNodes.get(
        exactMatchingSignatures.find((s) => s.matches)!.signature,
      );
      assert(signature.variant === Semantic.ENode.FunctionSignature);
      return signature.originalFunction;
    }

    // There cannot ever ever be more than 1 exact matches, if that is possible, it is a language design ambiguity
    assert(exactMatchingSignatures.filter((s) => s.matches).length === 0);

    const nonExactMatchingSignatures = matchSignatures(false);
    if (nonExactMatchingSignatures.filter((s) => s.matches).length === 1) {
      const signature = this.sr.symbolNodes.get(
        nonExactMatchingSignatures.find((s) => s.matches)!.signature,
      );
      assert(signature.variant === Semantic.ENode.FunctionSignature);
      return signature.originalFunction;
    }
    if (nonExactMatchingSignatures.filter((s) => s.matches).length === 0) {
      let str = `No candidate for call to overloaded function '${overloadGroup.name}' matches arguments\n`;
      for (const candidate of nonExactMatchingSignatures) {
        const signature = this.sr.symbolNodes.get(candidate.signature);
        assert(signature.variant === Semantic.ENode.FunctionSignature);
        const originalFunction = this.sr.cc.symbolNodes.get(signature.originalFunction);
        assert(originalFunction.variant === Collect.ENode.FunctionSymbol);
        str += `Candidate at ${
          originalFunction.sourceloc ? formatSourceLoc(originalFunction.sourceloc) : "?"
        }: ${Semantic.serializeFullSymbolName(this.sr, candidate.signature)} -> `;
        assert(candidate.reason);
        str += `Failed because: ${candidate.reason}\n`;
      }
      throw new CompilerError(str, usageSourceLocation);
    } else {
      let str = `Call to overloaded function '${overloadGroup.name}' is ambiguous: Multiple functions fit the criteria:\n`;
      for (const candidate of nonExactMatchingSignatures) {
        if (!candidate.matches) continue;
        const signature = this.sr.symbolNodes.get(candidate.signature);
        assert(signature.variant === Semantic.ENode.FunctionSignature);
        const originalFunction = this.sr.cc.symbolNodes.get(signature.originalFunction);
        assert(originalFunction.variant === Collect.ENode.FunctionSymbol);
        str += `Candidate at ${
          originalFunction.sourceloc ? formatSourceLoc(originalFunction.sourceloc) : "?"
        }: ${Semantic.serializeFullSymbolName(this.sr, candidate.signature)}\n`;
      }
      str += "You must use explicit struct initializations in order to disambiguate the call\n";
      throw new CompilerError(str, usageSourceLocation);
    }
  }

  sequenceControlFlow(a: Semantic.FlowResult, b: Semantic.FlowResult): Semantic.FlowResult {
    const out = Semantic.FlowResult.empty();

    // a is the state from all statements that came before
    // b is the new statement
    out.addAll(a);

    if (out.has(Semantic.FlowType.NoReturn)) {
      // This is actually a bad case when there is code after a noreturn function.
      // It is unreachable and should be stripped but we will just keep it and ignore the problem.
    }

    if (b.has(Semantic.FlowType.Raise)) {
      out.add(Semantic.FlowType.Raise);
    }
    if (b.has(Semantic.FlowType.Return)) {
      out.add(Semantic.FlowType.Return);
    }

    if (
      b.has(Semantic.FlowType.NoReturn) &&
      !(out.has(Semantic.FlowType.Raise) || out.has(Semantic.FlowType.Return))
    ) {
      out.add(Semantic.FlowType.NoReturn);
    }

    if (!b.has(Semantic.FlowType.Fallthrough)) {
      // b no-fallthrough stops every fallthrough up to this point
      out.remove(Semantic.FlowType.Fallthrough);
    }

    return out;
  }

  makeAndElaborateBlockScope(
    sourceScopeId: Collect.ScopeId,
    args: { lastExprIsEmit: boolean; unsafe?: boolean },
  ) {
    const sourceScope = this.sr.cc.scopeNodes.get(sourceScopeId);
    assert(
      sourceScope.variant !== Collect.ENode.ModuleScope &&
        sourceScope.variant !== Collect.ENode.UnitScope &&
        sourceScope.variant !== Collect.ENode.FileScope,
    );
    const [scope, scopeId] = this.sr.b.addBlockScope(this.sr, {
      variant: Semantic.ENode.BlockScope,
      statements: [],
      emittedExpr: -1 as Semantic.ExprId,
      sourceloc: sourceScope.sourceloc,
    });
    const { flow, writes } = this.elaborateRawBlockScope(
      {
        targetScopeId: scopeId,
        sourceScopeId: sourceScopeId,
        unsafe: args.unsafe ?? false,
      },
      args.lastExprIsEmit,
    );
    assert(scope.emittedExpr !== -1);
    return {
      flow: flow,
      scope: scope,
      scopeId: scopeId,
      writes: writes,
    };
  }

  elaborateRawBlockScope(
    args: {
      sourceScopeId: Collect.ScopeId;
      targetScopeId: Semantic.BlockScopeId;
      unsafe: boolean;
    },
    lastExprIsEmit: boolean,
  ) {
    const scope = this.sr.cc.scopeNodes.get(args.sourceScopeId);
    assert(scope.variant === Collect.ENode.BlockScope);

    const blockScope = this.sr.blockScopeNodes.get(args.targetScopeId);
    assert(blockScope.variant === Semantic.ENode.BlockScope);

    let blockFlow = Semantic.FlowResult.fallthrough();
    let blockWrites = Semantic.WriteResult.empty();
    this.withScopes(
      {
        currentScope: args.sourceScopeId,
        genericsScope: args.sourceScopeId,
      },
      () => {
        for (const sId of scope.symbols) {
          const sym = this.sr.cc.symbolNodes.get(sId);
          if (sym.variant === Collect.ENode.VariableSymbol) {
            this.elaborateVariableSymbolInScope(sId);
          } else if (sym.variant === Collect.ENode.TypeDefSymbol) {
            this.typeDefSymbol(sym);
          } else {
            assert(false);
          }
        }

        const statements = [...scope.statements];
        statements.forEach((sId, index) => {
          assert(this.inFunction);

          let gonnaInstantiateStructWithType: Semantic.TypeUseId | undefined;

          if (this.sr.cc.statementNodes.get(sId).variant === Collect.ENode.ReturnStatement) {
            // For return type inference
            gonnaInstantiateStructWithType = this.getFunctionSymbolReturnType(this.inFunction);
          }

          const {
            flow: statementFlow,
            writes: statementWrites,
            statementId,
          } = this.elaborateStatement(sId, {
            gonnaInstantiateStructWithType: gonnaInstantiateStructWithType,
            unsafe: scope.unsafe || args.unsafe,
          });
          if (!statementId) return;

          const statement = this.sr.statementNodes.get(statementId);
          blockFlow = this.sequenceControlFlow(blockFlow, statementFlow);
          blockWrites.addAll(statementWrites);

          if (
            lastExprIsEmit &&
            statement.variant === Semantic.ENode.ExprStatement &&
            index === statements.length - 1 &&
            // If it's void (as by calling a void function at the end), we ignore it, don't emit and
            // later let it be turned into "none" instead.
            !Conversion.isVoidById(this.sr, this.sr.exprNodes.get(statement.expr).type)
          ) {
            blockScope.emittedExpr = statement.expr;
          } else {
            blockScope.statements.push(statementId);
          }
        });
      },
    );

    if (blockScope.emittedExpr === -1) {
      // Still nothing returned, so return "none" which is our replacement for void
      blockScope.emittedExpr = this.sr.b.literalValue(
        {
          type: EPrimitive.none,
        },
        blockScope.sourceloc,
      )[1];
    }

    assert(blockScope.emittedExpr !== -1);
    return {
      flow: blockFlow,
      writes: blockWrites,
    };
  }

  elaborateFunctionSymbolWithGenerics(
    functionSignatureId: Semantic.SymbolId,
    genericArgs: Semantic.ExprId[],
    usageSourceLocation: SourceLoc,
    paramPackTypes: Semantic.TypeUseId[],
  ) {
    const functionSignature = this.sr.symbolNodes.get(functionSignatureId);
    assert(functionSignature.variant === Semantic.ENode.FunctionSignature);
    const func = this.sr.cc.symbolNodes.get(functionSignature.originalFunction);
    assert(func.variant === Collect.ENode.FunctionSymbol);

    if (func.generics.length !== genericArgs.length) {
      throw new CompilerError(
        `Function ${func.name} expects ${func.generics.length} type parameters but got ${genericArgs.length}`,
        usageSourceLocation,
      );
    }

    if (
      !func.functionScope &&
      (func.generics.length !== 0 ||
        funcSymHasParameterPack(this.sr.cc, functionSignature.originalFunction))
    ) {
      throw new CompilerError(
        `Non-Extern function '${func.name}' is generic or uses a parameter pack, but does not define a body. (Generic functions cannot be forward declared)`,
        func.sourceloc,
      );
    }

    let context = this.currentContext;

    if (
      func.generics.length !== 0 ||
      funcSymHasParameterPack(this.sr.cc, functionSignature.originalFunction)
    ) {
      assert(func.functionScope);
      context = Semantic.isolateElaborationContext(context, {
        currentScope: context.currentScope,
        genericsScope: context.currentScope,
        constraints: context.constraints,
        instanceDeps: {
          instanceDependsOn: new Map(),
          structMembersDependOn: new Map(),
          symbolDependsOn: new Map(),
        },
      });
      for (let i = 0; i < func.generics.length; i++) {
        context.substitute.set(func.generics[i], genericArgs[i]);
      }
    }

    return this.withContext(
      {
        context: context,
        inAttemptExpr: null,
        inFunction: null,
      },
      () => {
        return this.elaborateFunctionSymbol(
          functionSignatureId,
          functionSignature.parentStructOrNS,
          paramPackTypes,
        );
      },
    );
  }

  elaborateFunctionSymbol(
    functionSignatureId: Semantic.SymbolId,
    parentStructOrNS: Semantic.TypeDefId | null,
    paramPackTypes: Semantic.TypeUseId[],
  ): Semantic.SymbolId {
    const functionSignature = this.sr.symbolNodes.get(functionSignatureId);
    assert(functionSignature.variant === Semantic.ENode.FunctionSignature);

    const func = this.sr.cc.symbolNodes.get(functionSignature.originalFunction);
    assert(func.variant === Collect.ENode.FunctionSymbol);

    const newContext = Semantic.isolateElaborationContext(this.currentContext, {
      genericsScope: func.functionScope || func.parentScope,
      currentScope: func.functionScope || func.parentScope,
      constraints: this.currentContext.constraints,
      instanceDeps: {
        instanceDependsOn: new Map(),
        structMembersDependOn: new Map(),
        symbolDependsOn: new Map(),
      },
    });

    return this.withContext(
      {
        context: newContext,
        inAttemptExpr: null,
        inFunction: null,
      },
      () => {
        // The way this works is that first we define all generic substitutions outside of the function in the context,
        // and then we elaborate the function symbol here. For that, we get the raw generics and retrieve substitutions
        // for all of them. All substitutions must be available. This means that the system works very well, because
        // if we elaborate a generic function from itself recursively, we automatically get the correct substitution.
        const genericArgs = func.generics.map((g) => {
          const substitute = newContext.substitute.get(g);
          assert(substitute);
          return substitute;
        });

        const existing = getFromFuncDefCache(this.sr, functionSignature.originalFunction, {
          genericArgs: genericArgs,
          paramPackTypes: paramPackTypes,
          parentStructOrNS: parentStructOrNS,
        });
        if (existing) {
          return existing;
        }

        const expectedReturnType =
          func.returnType && this.lookupAndElaborateDatatype(func.returnType);

        if (func.vararg && func.extern !== EExternLanguage.Extern_C) {
          throw new CompilerError(
            `A C-Style Vararg parameter pack may only be used on extern "C" functions`,
            func.sourceloc,
          );
        }

        let parameterPack = false;
        const parameterNames = func.parameters.map((p) => p.name);
        const parameters = func.parameters
          .map((p, i) => {
            const paramType = this.sr.cc.typeUseNodes.get(p.type);
            if (paramType.variant === Collect.ENode.ParameterPack) {
              if (i !== func.parameters.length - 1) {
                throw new CompilerError(
                  `A Parameter Pack may only appear at the very end of the parameter list`,
                  func.sourceloc,
                );
              }
              if (func.extern !== EExternLanguage.None) {
                throw new CompilerError(
                  `A Parameter Pack may not be used on an exported function`,
                  func.sourceloc,
                );
              }
              parameterPack = true;

              assert(func.functionScope);
              const functionScope = this.sr.cc.scopeNodes.get(func.functionScope);
              assert(functionScope.variant === Collect.ENode.FunctionScope);
              const packVariable = [...functionScope.symbols].find((s) => {
                const sym = this.sr.cc.symbolNodes.get(s);
                return sym.variant === Collect.ENode.VariableSymbol && sym.name === p.name;
              });
              assert(packVariable);

              const [_, paramPackId] = this.sr.b.addType(this.sr, {
                variant: Semantic.ENode.ParameterPackDatatype,
                parameters: paramPackTypes.map((t, i) => {
                  const [_, variableId] = this.sr.b.addSymbol(this.sr, {
                    variant: Semantic.ENode.VariableSymbol,
                    comptime: false,
                    comptimeValue: null,
                    concrete: true,
                    name: `__param_pack_${i}`,
                    export: false,
                    extern: EExternLanguage.None,
                    memberOfStruct: null,
                    mutability: EVariableMutability.Default,
                    parentStructOrNS: null,
                    type: t,
                    consumed: false,
                    variableContext: EVariableContext.FunctionParameter,
                    sourceloc: func.sourceloc,
                  });
                  return variableId;
                }),
                concrete: true,
              });
              const paramPackVariableId = this.sr.b.addSymbol(this.sr, {
                variant: Semantic.ENode.VariableSymbol,
                comptime: false,
                comptimeValue: null,
                consumed: false,
                concrete: true,
                name: `__param_pack`,
                export: false,
                extern: EExternLanguage.None,
                memberOfStruct: null,
                mutability: EVariableMutability.Default,
                parentStructOrNS: null,
                type: makeTypeUse(
                  this.sr,
                  paramPackId,
                  EDatatypeMutability.Const,
                  false,
                  func.sourceloc,
                )[1],
                variableContext: EVariableContext.FunctionParameter,
                sourceloc: func.sourceloc,
              })[1];
              newContext.elaboratedVariables.set(packVariable, paramPackVariableId);
              return {
                optional: false,
                type: makeTypeUse(
                  this.sr,
                  paramPackId,
                  EDatatypeMutability.Const,
                  false,
                  func.sourceloc,
                )[1],
              };
            }
            return {
              optional: p.optional,
              type: this.lookupAndElaborateDatatype(p.type),
            };
          })
          .filter((p) => Boolean(p))
          .map((p) => p!);

        if (func.methodType === EMethodType.Method && !func.staticMethod) {
          parameterNames.unshift("this");
          assert(parentStructOrNS);
          parameters.unshift({
            optional: false,
            type: makeTypeUse(
              this.sr,
              parentStructOrNS,
              func.methodRequiredMutability ?? EDatatypeMutability.Default,
              false,
              func.sourceloc,
            )[1],
          });
        }

        let ftype = makeDeferredFunctionDatatypeAvailable(this.sr, {
          parameters: parameters,
          vararg: func.vararg,
          sourceloc: func.sourceloc,
        });

        let noreturnIf: {
          expr: Collect.ExprId;
          argIndex: number;
          operation: "noreturn-if-truthy" | "noreturn-if-falsy";
        } | null = null;
        if (func.requires.noreturnIf) {
          // We do not care about function-type identity since we don't set it, since the
          // Deferred Function Type does not have requirements per definition anyways, therefore
          // it is enough if we just set it once after the function has been elaborated.
          let [e, eId] = [
            this.sr.cc.exprNodes.get(func.requires.noreturnIf.expr),
            func.requires.noreturnIf.expr,
          ];

          let negateCondition = false;
          const unwrapParenthesis = () => {
            if (e.variant === Collect.ENode.ParenthesisExpr) {
              eId = e.expr;
              e = this.sr.cc.exprNodes.get(eId);
            }
          };

          unwrapParenthesis();
          if (e.variant === Collect.ENode.UnaryExpr && e.operation === EUnaryOperation.Negate) {
            negateCondition = !negateCondition;
            eId = e.expr;
            e = this.sr.cc.exprNodes.get(eId);
            unwrapParenthesis();
          }

          if (e.variant === Collect.ENode.SymbolValueExpr && e.genericArgs.length === 0) {
            const name = e.name;
            const paramIndex = parameterNames.findIndex((p) => p === name);
            if (paramIndex === -1) {
              throw new CompilerError(
                `The condition accesses a symbol ('${name}') which is not a parameter of the function. For now, only parameters may be accessed in conditions.`,
                e.sourceloc,
              );
            }

            assert(paramIndex >= 0 && paramIndex < parameters.length);
            const param = parameters[paramIndex];
            const paramTypeUse = this.sr.typeUseNodes.get(param.type);
            const paramTypeDef = this.sr.typeDefNodes.get(paramTypeUse.type);

            if (
              paramTypeDef.variant !== Semantic.ENode.PrimitiveDatatype ||
              paramTypeDef.primitive !== EPrimitive.bool
            ) {
              throw new CompilerError(
                `Currently, noreturn_if() conditions are only allowed to access bool parameters, other types are not implemented yet`,
                e.sourceloc,
              );
            }

            noreturnIf = {
              expr: func.requires.noreturnIf.expr,
              argIndex: paramIndex,
              operation: negateCondition ? "noreturn-if-falsy" : "noreturn-if-truthy",
            };
          } else {
            throw new CompilerError(
              `Unsupported expression in noreturn_if() construct`,
              e.sourceloc,
            );
          }
        }

        if (func.requires.final) {
          const returnType = expectedReturnType || this.sr.b.voidType();
          ftype = makeRawFunctionDatatypeAvailable(this.sr, {
            parameters: parameters,
            returnType: returnType,
            vararg: func.vararg,
            requires: {
              final: func.requires.final,
              noreturn: func.requires.noreturn,
              pure: func.requires.pure,
              noreturnIf: noreturnIf,
            },
            sourceloc: func.sourceloc,
          });
        }

        if (!func.functionScope && !func.requires.final) {
          throw new CompilerError(
            `Function '${func.name}' does not have a body, so nothing can be inferred by the compiler. Therefore it requires manual constraints as well as a ':: final' annotation to fix the constraints.`,
            func.sourceloc,
          );
        }

        let [symbol, symbolId] = this.sr.b.addSymbol<Semantic.FunctionSymbol>(this.sr, {
          variant: Semantic.ENode.FunctionSymbol,
          type: ftype,
          annotatedReturnType: expectedReturnType,
          export: func.export,
          generics: genericArgs,
          staticMethod: func.staticMethod,
          parameterPack: parameterPack,
          methodOf: parentStructOrNS,
          methodType: func.methodType,
          parentStructOrNS: parentStructOrNS,
          overloadedOperator: func.overloadedOperator,
          noemit: func.noemit,
          extern: func.extern,
          parameterNames: parameterNames,
          methodRequiredMutability: func.methodRequiredMutability,
          returnedDatatypes: new Set(),
          name: func.name,
          sourceloc: func.sourceloc,
          createsInstanceIds: new Set(),
          returnStatements: new Set(),
          returnsInstanceIds: new Set(),
          isImpure: false,
          instanceDepsSnapshot: this.sr.e.currentContext.instanceDeps,
          scope: null,
          concrete: this.sr.typeDefNodes.get(ftype).concrete,
          originalCollectedFunction: functionSignature.originalFunction,
        });

        if (symbol.concrete) {
          insertIntoFuncDefCache(this.sr, functionSignature.originalFunction, {
            genericArgs: genericArgs,
            paramPackTypes: paramPackTypes,
            parentStructOrNS: parentStructOrNS,
            result: symbolId,
            substitutionContext: newContext,
          });

          if (!func.requires.final) {
            const funcType = this.sr.typeDefNodes.get(ftype);
            assert(funcType.variant === Semantic.ENode.DeferredFunctionDatatype);
            for (const paramId of funcType.parameters) {
              const paramUse = this.sr.typeUseNodes.get(paramId.type);
              const paramType = this.sr.typeDefNodes.get(paramUse.type);

              if (
                (paramType.variant === Semantic.ENode.StructDatatype &&
                  !paramUse.inline &&
                  paramUse.mutability === EDatatypeMutability.Mut) ||
                (paramType.variant === Semantic.ENode.DynamicArrayDatatype &&
                  paramUse.mutability === EDatatypeMutability.Mut) ||
                (paramType.variant === Semantic.ENode.UntaggedUnionDatatype &&
                  paramType.members.some((m) => {
                    const typeUse = this.sr.typeUseNodes.get(m);
                    const typeDef = this.sr.typeDefNodes.get(typeUse.type);
                    return (
                      (typeDef.variant === Semantic.ENode.StructDatatype ||
                        typeDef.variant === Semantic.ENode.DynamicArrayDatatype) &&
                      typeUse.mutability === EDatatypeMutability.Mut
                    );
                  })) ||
                (paramType.variant === Semantic.ENode.TaggedUnionDatatype &&
                  paramType.members.some((m) => {
                    const typeUse = this.sr.typeUseNodes.get(m.type);
                    const typeDef = this.sr.typeDefNodes.get(typeUse.type);
                    return (
                      (typeDef.variant === Semantic.ENode.StructDatatype ||
                        typeDef.variant === Semantic.ENode.DynamicArrayDatatype) &&
                      typeUse.mutability === EDatatypeMutability.Mut
                    );
                  }))
              ) {
                symbol.isImpure = true;
              }
            }
          }

          if (!func.functionScope) {
            // Function declaration without body
          } else {
            // With scope
            const functionScope = this.sr.cc.scopeNodes.get(func.functionScope);
            assert(functionScope.variant === Collect.ENode.FunctionScope);

            if (symbol.methodType === EMethodType.Method) {
              const collectedThisRefId = [...functionScope.symbols].find((sId) => {
                const sym = this.sr.cc.symbolNodes.get(sId);
                return sym.variant === Collect.ENode.VariableSymbol && sym.name === "this";
              });
              assert(collectedThisRefId);
              const collectedThisRef = this.sr.cc.symbolNodes.get(collectedThisRefId);
              assert(collectedThisRef.variant === Collect.ENode.VariableSymbol);

              assert(symbol.methodOf);
              const thisRef = makeTypeUse(
                this.sr,
                symbol.methodOf,
                symbol.methodRequiredMutability ?? EDatatypeMutability.Default,
                false,
                func.sourceloc,
              )[1];
              const variableId = this.sr.b.addSymbol(this.sr, {
                variant: Semantic.ENode.VariableSymbol,
                memberOfStruct: symbol.methodOf,
                mutability: EVariableMutability.Default,
                name: collectedThisRef.name,
                type: thisRef,
                comptime: false,
                comptimeValue: null,
                concrete: isTypeConcrete(this.sr, thisRef),
                export: false,
                extern: EExternLanguage.None,
                parentStructOrNS: symbol.parentStructOrNS,
                sourceloc: symbol.sourceloc,
                variableContext: EVariableContext.FunctionParameter,
              })[1];
              newContext.elaboratedVariables.set(collectedThisRefId, variableId);
            }

            for (const sId of functionScope.symbols) {
              const symbol = this.sr.cc.symbolNodes.get(sId);
              if (symbol.variant === Collect.ENode.VariableSymbol) {
                this.withContext(
                  {
                    context: newContext,
                    inFunction: symbolId,
                    inAttemptExpr: null,
                  },
                  () => {
                    this.elaborateVariableSymbolInScope(sId);
                  },
                );
              }
            }

            const { scopeId, flow } = this.withContext(
              {
                context: newContext,
                inFunction: symbolId,
                functionReturnsInstanceIds: symbol.returnsInstanceIds,
                inAttemptExpr: null,
              },
              () =>
                this.makeAndElaborateBlockScope(functionScope.blockScope, {
                  lastExprIsEmit: false,
                }),
            );
            symbol.scope = scopeId;

            if (func.name === "main" && parentStructOrNS) {
              const modulePrefix = getModuleGlobalNamespaceName(
                this.sr.cc.config.name,
                this.sr.cc.config.version,
              );
              const parent = this.sr.typeDefNodes.get(parentStructOrNS);
              if ("name" in parent && parent.name === modulePrefix) {
                if (this.sr.globalMainFunction !== null) {
                  const existing = this.sr.symbolNodes.get(this.sr.globalMainFunction);
                  assert(existing.variant === Semantic.ENode.FunctionSymbol);
                  if (existing.sourceloc) {
                    throw new CompilerError(
                      `Multiply defined main function: Previous definition at ${formatSourceLoc(
                        existing.sourceloc,
                      )}`,
                      func.sourceloc,
                    );
                  } else {
                    throw new CompilerError(`Multiply defined main function`, func.sourceloc);
                  }
                }
                this.sr.globalMainFunction = symbolId;
              }
            }

            Semantic.getInstanceDepsGraph(
              symbol.instanceDepsSnapshot,
              symbol.returnsInstanceIds,
            ).forEach((d) => symbol.returnsInstanceIds.add(d));

            // Add "none" as a returned value if nothing is returned. This is only for the return type.
            if (
              flow.has(Semantic.FlowType.Fallthrough) &&
              !func.requires.noreturn &&
              !func.requires.final
            ) {
              symbol.returnedDatatypes.add(this.sr.b.noneType());
            }

            if (!func.requires.final) {
              let inferredReturnType: Semantic.TypeUseId | null = expectedReturnType;
              if (!inferredReturnType) {
                if (symbol.returnedDatatypes.size === 0) {
                  inferredReturnType = this.sr.b.voidType();
                } else if (symbol.returnedDatatypes.size === 1) {
                  inferredReturnType = [...symbol.returnedDatatypes][0];
                } else {
                  inferredReturnType = this.sr.b.untaggedUnionTypeUse(
                    [...symbol.returnedDatatypes],
                    symbol.sourceloc,
                  );
                }
              }

              // If anything is returned that is a reference, like an object or an array, then it must be considered impure,
              // even if the return type is not mutable, because objects are required to have "identity" and multiple calls
              // cannot be collapsed into a single one because otherwise two different objects would have the same identity.
              const returnUse = this.sr.typeUseNodes.get(inferredReturnType);
              const returnDef = this.sr.typeDefNodes.get(returnUse.type);
              if (
                returnDef.variant === Semantic.ENode.StructDatatype ||
                returnDef.variant === Semantic.ENode.DynamicArrayDatatype ||
                (returnDef.variant === Semantic.ENode.UntaggedUnionDatatype &&
                  returnDef.members.some((m) => {
                    const typeUse = this.sr.typeUseNodes.get(m);
                    const typeDef = this.sr.typeDefNodes.get(typeUse.type);
                    return (
                      typeDef.variant === Semantic.ENode.StructDatatype ||
                      typeDef.variant === Semantic.ENode.DynamicArrayDatatype
                    );
                  })) ||
                (returnDef.variant === Semantic.ENode.TaggedUnionDatatype &&
                  returnDef.members.some((m) => {
                    const typeUse = this.sr.typeUseNodes.get(m.type);
                    const typeDef = this.sr.typeDefNodes.get(typeUse.type);
                    return (
                      typeDef.variant === Semantic.ENode.StructDatatype ||
                      typeDef.variant === Semantic.ENode.DynamicArrayDatatype
                    );
                  }))
              ) {
                symbol.isImpure = true;
              }

              symbol.type = makeRawFunctionDatatypeAvailable(this.sr, {
                parameters: parameters,
                returnType: inferredReturnType,
                vararg: func.vararg,
                requires: {
                  final: true,
                  pure: func.requires.pure || (!func.requires.final && !symbol.isImpure),
                  noreturn: func.requires.noreturn || flow.has(Semantic.FlowType.NoReturn),
                  noreturnIf: noreturnIf,
                },
                sourceloc: func.sourceloc,
              });
              const functype = this.sr.typeDefNodes.get(symbol.type);
              assert(functype.variant === Semantic.ENode.FunctionDatatype);

              // Fix returning "none" if nothing is returned but the function returns "none", except it returns 'void'
              if (
                flow.has(Semantic.FlowType.Fallthrough) &&
                !Conversion.isVoidById(this.sr, functype.returnType)
              ) {
                assert(symbol.scope);
                const bodyScope = this.sr.blockScopeNodes.get(symbol.scope);
                const statementId = this.sr.b.addStatement(this.sr, {
                  variant: Semantic.ENode.ReturnStatement,
                  expr: this.sr.b.noneExpr()[1],
                  sourceloc: func.sourceloc,
                })[1];
                bodyScope.statements.push(statementId);
                symbol.returnStatements.add(statementId);
              }

              // Now the return type has been fixed, so we have to go over all return statements now
              // and insert implicit type conversions to the return type in order to convert between unions implicitly.
              // Important if: 'Foo' and 'str' is returned, then the return type is 'Foo | str', so in each
              // return statement, 'Foo' must be implicitly converted to 'Foo | str'.
              for (const sId of symbol.returnStatements) {
                const statement = this.sr.statementNodes.get(sId);
                if (statement.variant === Semantic.ENode.ReturnStatement) {
                  if (statement.expr) {
                    // Convert an existing value
                    const returnedExpr = this.getExpr(statement.expr);
                    if (returnedExpr.type !== inferredReturnType) {
                      statement.expr = Conversion.MakeConversionOrThrow(
                        this.sr,
                        statement.expr,
                        inferredReturnType,
                        ConstraintSet.empty(),
                        statement.sourceloc,
                        Conversion.Mode.Implicit,
                        false,
                      );
                    }
                  } else {
                    // Insert a "none" value if no value was returned at all
                    if (Conversion.isNoneById(this.sr, inferredReturnType)) {
                      statement.expr = this.sr.b.noneExpr()[1];
                    } else if (Conversion.isVoidById(this.sr, inferredReturnType)) {
                      // The only valid place where a return statement can actually return nothing
                    } else {
                      assert(false);
                    }
                  }
                }
              }
            }
          }

          if (
            symbol.export &&
            symbol.generics.length === 0 &&
            !funcSymHasParameterPack(this.sr.cc, symbol.originalCollectedFunction)
          ) {
            this.sr.exportedSymbols.add(symbolId);
          }
        }

        return symbolId;
      },
    );
  }

  lookupAndElaborateDatatype(typeId: Collect.TypeUseId): Semantic.TypeUseId {
    const type = this.sr.cc.typeUseNodes.get(typeId);

    switch (type.variant) {
      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.FunctionDatatype: {
        const result = makeFunctionDatatypeAvailable(this.sr, {
          parameters: type.parameters.map((p) => ({
            optional: p.optional,
            type: this.lookupAndElaborateDatatype(p.type),
          })),
          returnType: this.lookupAndElaborateDatatype(type.returnType),
          vararg: type.vararg,
          mutability: type.mutability,
          requires: {
            final: type.requires.final,
            pure: type.requires.pure,
            noreturn: type.requires.noreturn,
            noreturnIf: type.requires.noreturnIf,
          },
          sourceloc: type.sourceloc,
        });
        return result;
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.StackArrayDatatype: {
        return makeStackArrayDatatypeAvailable(
          this.sr,
          this.lookupAndElaborateDatatype(type.datatype),
          type.length,
          type.mutability,
          type.inline,
          type.sourceloc,
        );
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.DynamicArrayDatatype: {
        return makeDynamicArrayDatatypeAvailable(
          this.sr,
          this.lookupAndElaborateDatatype(type.datatype),
          type.mutability,
          false,
          type.sourceloc,
        );
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      // case Collect.ENode.TypeDefAlias: {
      //   return lookupAndElaborateDatatype(sr, {
      //     typeId: type.target,
      //     context: args.context,
      //     elaboratedVariables: args.elaboratedVariables,
      //     isInCFuncdecl: args.isInCFuncdecl,
      //   });
      // }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.NamedDatatype: {
        const primitive = stringToPrimitive(type.name);
        if (primitive) {
          if (type.genericArgs.length > 0) {
            throw new CompilerError(`Type ${type.name} is not generic`, type.sourceloc);
          }
          return makePrimitiveAvailable(this.sr, primitive, type.mutability, type.sourceloc);
        }

        if (type.name === "Callable") {
          if (type.genericArgs.length != 1) {
            throw new CompilerError(
              `Type Callable<> must take exactly 1 type parameter`,
              type.sourceloc,
            );
          }
          const farg = this.sr.cc.exprNodes.get(type.genericArgs[0]);
          if (
            farg.variant !== Collect.ENode.LiteralExpr &&
            farg.variant !== Collect.ENode.TypeLiteralExpr
          ) {
            throw new CompilerError(
              `Expression '${printCollectedExpr(
                this.sr.cc,
                type.genericArgs[0],
              )}' cannot be used as a generic substitute`,
              type.sourceloc,
            );
          }
          if (
            farg.variant !== Collect.ENode.TypeLiteralExpr ||
            this.sr.cc.typeUseNodes.get(farg.datatype).variant !== Collect.ENode.FunctionDatatype
          ) {
            throw new CompilerError(
              `Type Callable<> must take a function datatype as the generic argument`,
              type.sourceloc,
            );
          }
          const functype = this.lookupAndElaborateDatatype(farg.datatype);
          return makeTypeUse(
            this.sr,
            this.sr.b.addType(this.sr, {
              variant: Semantic.ENode.CallableDatatype,
              functionType: this.sr.typeUseNodes.get(functype).type,
              thisExprType: undefined,
              concrete: isTypeConcrete(this.sr, functype),
            })[1],
            type.mutability,
            false,
            type.sourceloc,
          )[1];
        }

        let foundResult = Semantic.lookupSymbol(this.sr, type.name, {
          startLookupInScope: this.currentContext.currentScope,
          sourceloc: type.sourceloc,
        });
        if (foundResult.type === "semantic") {
          const e = this.sr.exprNodes.get(foundResult.id);
          if (e.variant === Semantic.ENode.DatatypeAsValueExpr) {
            return e.type;
          }
          assert(false);
        }
        let foundId = foundResult.id;
        let found = this.sr.cc.symbolNodes.get(foundId);

        if (found.variant === Collect.ENode.GenericTypeParameterSymbol) {
          const mappedTo = this.currentContext.substitute.get(foundId);
          if (mappedTo) {
            const mapped = this.sr.exprNodes.get(mappedTo);
            if (mapped.variant === Semantic.ENode.DatatypeAsValueExpr) {
              return mapped.type;
            } else {
              throw new CompilerError(
                `Generic placeholder '${type.name}' resolves to value '${Semantic.serializeExpr(
                  this.sr,
                  mappedTo,
                )}', which cannot be used as a datatype`,
                type.sourceloc,
              );
            }
          } else {
            return makeTypeUse(
              this.sr,
              this.sr.b.addType(this.sr, {
                variant: Semantic.ENode.GenericParameterDatatype,
                name: found.name,
                collectedParameter: foundId,
                concrete: false,
              })[1],
              type.mutability,
              false,
              type.sourceloc,
            )[1];
          }
        } else if (found.variant === Collect.ENode.TypeDefSymbol) {
          const typedef = this.sr.cc.typeDefNodes.get(found.typeDef);
          if (typedef.variant === Collect.ENode.TypeDefAlias) {
            // console.log("Looked up alias", Semantic.serializeTypeUse(this.sr));
            const generics = type.genericArgs.map((g) => {
              return this.withContext(
                {
                  context: this.currentContext,
                  inAttemptExpr: null,
                  inFunction: null,
                },
                () => this.expressionAsGenericArg(g),
              );
            });

            if (typedef.generics.length !== generics.length) {
              throw new CompilerError(
                `Type ${typedef.name} expects ${typedef.generics.length} type parameters but got ${generics.length}`,
                typedef.sourceloc,
              );
            }
            let context = this.currentContext;
            if (typedef.generics.length !== 0) {
              assert(typedef.genericScope);
              context = Semantic.isolateElaborationContext(context, {
                currentScope: typedef.genericScope,
                genericsScope: context.currentScope,
                constraints: context.constraints,
                instanceDeps: {
                  instanceDependsOn: new Map(),
                  structMembersDependOn: new Map(),
                  symbolDependsOn: new Map(),
                },
              });
              for (let i = 0; i < typedef.generics.length; i++) {
                context.substitute.set(typedef.generics[i], generics[i]);
              }
            }

            return this.withContext(
              {
                context: context,
                inFunction: this.inFunction,
                inAttemptExpr: this.inAttemptExpr,
              },
              () => {
                const aliasedTypeId = this.lookupAndElaborateDatatype(typedef.target);
                if (type.innerNested) {
                  const aliasedType = this.sr.typeDefNodes.get(
                    this.sr.typeUseNodes.get(aliasedTypeId).type,
                  );
                  if (aliasedType.variant !== Semantic.ENode.NamespaceDatatype) {
                    throw new CompilerError(
                      `Type '${Semantic.serializeTypeUse(
                        this.sr,
                        aliasedTypeId,
                      )}' cannot be used as a namespace`,
                      type.sourceloc,
                    );
                  }
                  const collectedNamespace = this.sr.cc.typeDefNodes.get(
                    aliasedType.collectedNamespace,
                  );
                  assert(collectedNamespace.variant === Collect.ENode.NamespaceTypeDef);
                  return this.withContext(
                    {
                      context: Semantic.isolateElaborationContext(this.currentContext, {
                        currentScope: collectedNamespace.namespaceScope,
                        genericsScope: this.currentContext.genericsScope,
                        constraints: ConstraintSet.empty(),
                        instanceDeps: {
                          instanceDependsOn: new Map(),
                          structMembersDependOn: new Map(),
                          symbolDependsOn: new Map(),
                        },
                      }),
                      inAttemptExpr: null,
                      inFunction: null,
                    },
                    () => {
                      // Use the outermost modifiers and ignore the inner ones
                      const typeUseId = this.lookupAndElaborateDatatype(type.innerNested!);
                      const typeUse = this.sr.typeUseNodes.get(typeUseId);
                      return makeTypeUse(
                        this.sr,
                        typeUse.type,
                        type.mutability,
                        type.inline,
                        type.sourceloc,
                      )[1];
                    },
                  );
                }

                const gotUse = this.sr.typeUseNodes.get(aliasedTypeId);

                const supposedTypeForError = makeTypeUse(
                  this.sr,
                  gotUse.type,
                  type.mutability,
                  type.inline,
                  type.sourceloc,
                )[1];

                let inline = gotUse.inline || type.inline;
                let mutability = gotUse.mutability;

                if (
                  gotUse.mutability === EDatatypeMutability.Mut &&
                  type.mutability === EDatatypeMutability.Default
                ) {
                  mutability = EDatatypeMutability.Default;
                } else if (
                  gotUse.mutability === EDatatypeMutability.Const &&
                  type.mutability === EDatatypeMutability.Default
                ) {
                  mutability = EDatatypeMutability.Default;
                } else if (gotUse.mutability !== type.mutability) {
                  throw new CompilerError(
                    `This alias is defined as ${Semantic.serializeTypeUse(this.sr, aliasedTypeId)}, which cannot be treated as ${Semantic.serializeTypeUse(this.sr, supposedTypeForError)}`,
                    type.sourceloc,
                  );
                }

                return makeTypeUse(this.sr, gotUse.type, mutability, inline, type.sourceloc)[1];
              },
            );
          } else if (typedef.variant === Collect.ENode.StructTypeDef) {
            const generics = type.genericArgs.map((g) => {
              return this.withContext(
                {
                  context: this.currentContext,
                  inAttemptExpr: null,
                  inFunction: null,
                },
                () => this.expressionAsGenericArg(g),
              );
            });

            const structId = this.instantiateAndElaborateStructWithGenerics(
              found.typeDef,
              generics,
              type.sourceloc,
            );
            const struct = this.sr.typeDefNodes.get(structId);
            assert(struct.variant === Semantic.ENode.StructDatatype);
            const structScope = this.sr.cc.scopeNodes.get(typedef.lexicalScope);
            assert(structScope.variant === Collect.ENode.StructLexicalScope);

            if (type.innerNested) {
              // Here we need to merge the context from the parent into the child
              let cachedParentSubstitutions = undefined as Semantic.ElaborationContext | undefined;
              const entry = this.sr.elaboratedStructDatatypes.get(found.typeDef);

              for (const cache of entry || []) {
                if (
                  cache.canonicalizedGenerics.length === generics.length &&
                  cache.canonicalizedGenerics.every(
                    (g, i) => g === Semantic.canonicalizeGenericExpr(this.sr, generics[i]),
                  )
                ) {
                  cachedParentSubstitutions = cache.substitutionContext;
                  break;
                }
              }
              assert(cachedParentSubstitutions);
              return this.withContext(
                {
                  context: Semantic.mergeSubstitutionContext(
                    cachedParentSubstitutions,
                    this.currentContext,
                    {
                      currentScope: typedef.lexicalScope,
                      genericsScope: this.currentContext.genericsScope,
                      instanceDeps: {
                        instanceDependsOn: new Map(),
                        structMembersDependOn: new Map(),
                        symbolDependsOn: new Map(),
                      },
                    },
                  ),
                  inAttemptExpr: null,
                  inFunction: null,
                },
                () => {
                  // Use the outermost modifiers and ignore the inner ones
                  const typeUseId = this.lookupAndElaborateDatatype(type.innerNested!);
                  const typeUse = this.sr.typeUseNodes.get(typeUseId);
                  return makeTypeUse(
                    this.sr,
                    typeUse.type,
                    type.mutability,
                    type.inline,
                    type.sourceloc,
                  )[1];
                },
              );
            } else {
              return makeTypeUse(
                this.sr,
                structId,
                type.mutability,
                type.inline,
                type.sourceloc,
              )[1];
            }
          } else if (typedef.variant === Collect.ENode.NamespaceTypeDef) {
            if (!type.innerNested) {
              return makeTypeUse(
                this.sr,
                this.namespace(found.typeDef),
                type.mutability,
                type.inline,
                type.sourceloc,
              )[1];
            }
            return this.withContext(
              {
                context: Semantic.isolateElaborationContext(this.currentContext, {
                  currentScope: typedef.namespaceScope,
                  genericsScope: this.currentContext.genericsScope,
                  constraints: this.currentContext.constraints,
                  instanceDeps: {
                    instanceDependsOn: new Map(),
                    structMembersDependOn: new Map(),
                    symbolDependsOn: new Map(),
                  },
                }),
                inAttemptExpr: null,
                inFunction: null,
              },
              () => {
                // Use the outermost modifiers and ignore the inner ones
                const typeUseId = this.lookupAndElaborateDatatype(type.innerNested!);
                const typeUse = this.sr.typeUseNodes.get(typeUseId);
                return makeTypeUse(
                  this.sr,
                  typeUse.type,
                  type.mutability,
                  type.inline,
                  type.sourceloc,
                )[1];
              },
            );
          } else if (typedef.variant === Collect.ENode.EnumTypeDef) {
            return makeTypeUse(
              this.sr,
              this.enum(found.typeDef),
              type.mutability,
              type.inline,
              type.sourceloc,
            )[1];
          }
        }
        throw new CompilerError(
          `Symbol '${type.name}' cannot be used as a datatype here`,
          type.sourceloc,
        );
      }

      case Collect.ENode.ParameterPack: {
        return this.sr.b.paramPackTypeUse(EDatatypeMutability.Default, type.sourceloc);
      }

      case Collect.ENode.UntaggedUnionDatatype: {
        const rawMembers = type.members.map((m) => this.lookupAndElaborateDatatype(m));
        return this.sr.b.untaggedUnionTypeUse(rawMembers, type.sourceloc);
      }

      case Collect.ENode.TaggedUnionDatatype: {
        const rawMembers = type.members.map((m) => ({
          tag: m.tag,
          type: this.lookupAndElaborateDatatype(m.type),
        }));
        return this.sr.b.taggedUnionTypeUse(rawMembers, type.nodiscard, type.sourceloc);
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      default:
        assert(false, (type as any).variant.toString());
    }
  }

  assignmentExpr(assignment: Collect.ExprAssignmentExpr, inference: Semantic.Inference) {
    const [targetExpr, targetExprId] = this.expr(assignment.expr, { unsafe: inference?.unsafe });
    const [valueExpr, valueExprId] = this.expr(assignment.value, {
      gonnaInstantiateStructWithType: targetExpr.type,
      unsafe: inference?.unsafe,
    });

    const lhsTypeUse = this.sr.typeUseNodes.get(targetExpr.type);
    const lhsType = this.sr.typeDefNodes.get(lhsTypeUse.type);

    if (
      assignment.operation === EAssignmentOperation.Assign &&
      lhsType.variant === Semantic.ENode.StructDatatype
    ) {
      // Try to find exact overload
      let exactMatchId: Semantic.SymbolId | undefined;
      lhsType.methods.forEach((m) => {
        const method = this.sr.symbolNodes.get(m);
        assert(method.variant === Semantic.ENode.FunctionSymbol);

        if (method.overloadedOperator !== EOverloadedOperator.Assign) return;

        const ftype = this.sr.e.getTypeDef(method.type);
        assert(ftype.variant === Semantic.ENode.FunctionDatatype);

        if (ftype.parameters.length !== 2) return;
        if (
          this.sr.e.getTypeUse(ftype.parameters[1].type).type !==
          this.sr.e.getTypeUse(valueExpr.type).type
        )
          return;

        if (exactMatchId !== undefined) {
          throw new CompilerError(`Operator access is ambiguous`, assignment.sourceloc);
        }
        exactMatchId = m;
      });

      if (exactMatchId) {
        const method = this.sr.e.getSymbol(exactMatchId);
        assert(method.variant === Semantic.ENode.FunctionSymbol);

        const ftype = this.sr.e.getTypeDef(method.type);
        assert(ftype.variant === Semantic.ENode.FunctionDatatype);

        const instanceIds: Semantic.InstanceId[] = [];

        assert(this.sr.e.inFunction);
        const functionSymbol = this.sr.e.getSymbol(this.sr.e.inFunction);
        assert(functionSymbol.variant === Semantic.ENode.FunctionSymbol);
        instanceIds.forEach((i) => functionSymbol.createsInstanceIds.add(i));

        // Note:
        // For control flow and write analysis, only target and value are required and
        // LHS handling is not required, since this is not a symbol value access with a primitive read
        // and instead an operator overload that translates into a function call
        // (and very likely then performs an actual symbol write inside of the operator).
        // We do not care about it here because the CallExpr then internally
        // will insert a write if the operator actually is a mutating method.

        const calledExpr = this.sr.b.addExpr(this.sr, {
          variant: Semantic.ENode.CallableExpr,
          functionSymbol: exactMatchId,
          instanceIds: [],
          isTemporary: true,
          sourceloc: assignment.sourceloc,
          thisExpr: targetExprId,
          type: makeTypeUse(
            this.sr,
            this.sr.b.addType(this.sr, {
              variant: Semantic.ENode.CallableDatatype,
              thisExprType: targetExpr.type,
              functionType: method.type,
              concrete: true,
            })[1],
            EDatatypeMutability.Const,
            false,
            assignment.sourceloc,
          )[1],
          flow: targetExpr.flow.withAll(valueExpr.flow),
          writes: targetExpr.writes.withAll(valueExpr.writes),
        })[1];

        assert(this.inFunction);
        return this.sr.b.callExpr(calledExpr, [valueExprId], this.inFunction, assignment.sourceloc);
      }

      throw new CompilerError(
        `Expression of type '${Semantic.serializeTypeUse(
          this.sr,
          targetExpr.type,
        )}' is not a valid LHS, no matching assignment operator overload exists`,
        assignment.sourceloc,
      );
    }

    // Fix assignment to unions. This is so you can assign a union if the union was already narrowed (unnarrowing it here)
    let targetExprFixed = targetExprId;
    if (targetExpr.variant === Semantic.ENode.UnionToValueCastExpr) {
      targetExprFixed = targetExpr.expr;
    }

    return this.sr.b.assignment(
      targetExprFixed,
      assignment.operation,
      valueExprId,
      this.currentContext.constraints,
      assignment.sourceloc,
      inference,
    );
  }

  elaborateParentSymbolFromCache(parentScopeId: Collect.ScopeId): Semantic.TypeDefId | null {
    let parentStructOrNS = null as Semantic.TypeDefId | null;
    const parentScope = this.sr.cc.scopeNodes.get(parentScopeId);
    if (parentScope.variant === Collect.ENode.StructLexicalScope) {
      // This parenting works by elaborating the lexical parent on demand. If we somehow got into it, to access one
      // of its children, then we must have the substitution context from the parent, and it must also be cached.
      // So we take the lexical parent, substitute all generics, and then use the cache to get the finished parent.
      const parentStructSymbol = this.sr.cc.symbolNodes.get(parentScope.owningSymbol);
      assert(parentStructSymbol.variant === Collect.ENode.TypeDefSymbol);
      const parentStruct = this.sr.cc.typeDefNodes.get(parentStructSymbol.typeDef);
      assert(parentStruct.variant === Collect.ENode.StructTypeDef);
      const parentGenericArgs = parentStruct.generics.map((g) => {
        const subst = this.currentContext.substitute.get(g);
        assert(subst);
        return subst;
      });

      const parentOwning = this.sr.cc.symbolNodes.get(parentScope.owningSymbol);
      assert(parentOwning.variant === Collect.ENode.TypeDefSymbol);
      const entries = this.sr.elaboratedStructDatatypes.get(parentOwning.typeDef);

      for (const cache of entries || []) {
        if (
          cache.canonicalizedGenerics.length === parentGenericArgs.length &&
          cache.canonicalizedGenerics.every(
            (g, i) => g === Semantic.canonicalizeGenericExpr(this.sr, parentGenericArgs[i]),
          )
        ) {
          parentStructOrNS = cache.result;
          break;
        }
      }
      assert(parentStructOrNS, "Parent struct not found in cache: Impossible");
    } else if (parentScope.variant === Collect.ENode.NamespaceScope) {
      const sym = this.sr.cc.symbolNodes.get(parentScope.owningSymbol);
      assert(sym.variant === Collect.ENode.TypeDefSymbol);
      parentStructOrNS = this.namespace(sym.typeDef);
    }
    return parentStructOrNS;
  }

  elaborateFunctionSignature(functionSymbolId: Collect.SymbolId): Semantic.SymbolId {
    const functionSymbol = this.sr.cc.symbolNodes.get(functionSymbolId);
    assert(functionSymbol.variant === Collect.ENode.FunctionSymbol);

    const genericPlaceholders = functionSymbol.generics.map((gId) => {
      const g = this.sr.cc.symbolNodes.get(gId);
      assert(g.variant === Collect.ENode.GenericTypeParameterSymbol);
      return this.sr.b.addType(this.sr, {
        variant: Semantic.ENode.GenericParameterDatatype,
        name: g.name,
        collectedParameter: gId,
        concrete: false,
      })[1];
    });

    const parameters = functionSymbol.parameters.map((p) => {
      const type = this.withContext(
        {
          context: Semantic.isolateElaborationContext(this.currentContext, {
            currentScope: functionSymbol.functionScope || functionSymbol.parentScope,
            genericsScope: functionSymbol.functionScope || functionSymbol.parentScope,
            constraints: ConstraintSet.empty(),
            instanceDeps: {
              instanceDependsOn: new Map(),
              structMembersDependOn: new Map(),
              symbolDependsOn: new Map(),
            },
          }),
          inAttemptExpr: null,
          inFunction: null,
        },
        () => this.lookupAndElaborateDatatype(p.type),
      );
      return {
        name: p.name,
        type: type,
      };
    });

    const parent = this.elaborateParentSymbolFromCache(functionSymbol.parentScope);

    const cacheCodename =
      (parent ? Semantic.serializeTypeDef(this.sr, parent) + "." : "") +
      functionSymbol.name +
      "|" +
      parameters.map((p) => Semantic.serializeTypeUse(this.sr, p.type)).join("|");

    if (this.sr.elaboratedFunctionSignatures.has(functionSymbolId)) {
      const signatures = this.sr.elaboratedFunctionSignatures.get(functionSymbolId)!;
      for (const signatureId of signatures) {
        const signature = this.sr.symbolNodes.get(signatureId);
        assert(signature.variant === Semantic.ENode.FunctionSignature);
        if (
          signature.genericPlaceholders.length === genericPlaceholders.length &&
          signature.genericPlaceholders.every((g, i) => g === genericPlaceholders[i]) &&
          signature.parentStructOrNS === parent
        ) {
          return signatureId;
        }
      }
    }

    const [signature, signatureId] = this.sr.b.addSymbol(this.sr, {
      variant: Semantic.ENode.FunctionSignature,
      genericPlaceholders: genericPlaceholders,
      originalFunction: functionSymbolId,
      extern: functionSymbol.extern,
      name: functionSymbol.name,
      parentStructOrNS: parent,
      parameters: parameters,
      returnType:
        functionSymbol.returnType &&
        this.withContext(
          {
            context: Semantic.isolateElaborationContext(this.currentContext, {
              currentScope: functionSymbol.functionScope || functionSymbol.parentScope,
              genericsScope: functionSymbol.functionScope || functionSymbol.parentScope,
              constraints: ConstraintSet.empty(),
              instanceDeps: {
                instanceDependsOn: new Map(),
                structMembersDependOn: new Map(),
                symbolDependsOn: new Map(),
              },
            }),
            inAttemptExpr: null,
            inFunction: null,
          },
          () => this.lookupAndElaborateDatatype(functionSymbol.returnType!),
        ),
    });

    for (const sigId of this.sr.elaboratedFunctionSignaturesByName.get(cacheCodename) || []) {
      const sig = this.sr.symbolNodes.get(sigId);
      assert(sig.variant === Semantic.ENode.FunctionSignature);
      if (
        sig.name === signature.name &&
        sig.parentStructOrNS === signature.parentStructOrNS &&
        sig.genericPlaceholders.length === signature.genericPlaceholders.length &&
        sig.genericPlaceholders.every((p, i) => signature.genericPlaceholders[i] === p) &&
        sig.parameters.length === signature.parameters.length &&
        sig.parameters.every((p, i) => signature.parameters[i].type === p.type)
      ) {
        const ori = this.sr.cc.symbolNodes.get(sig.originalFunction);
        assert(ori.variant === Collect.ENode.FunctionSymbol);
        throw new CompilerError(
          `A conflicting function with the same signature is already defined.${
            ori.sourceloc ? " Existing definition at: " + formatSourceLoc(ori.sourceloc) : ""
          }`,
          functionSymbol.sourceloc,
        );
      }
    }

    if (!this.sr.elaboratedFunctionSignatures.get(functionSymbolId)) {
      this.sr.elaboratedFunctionSignatures.set(functionSymbolId, []);
    }
    this.sr.elaboratedFunctionSignatures.get(functionSymbolId)!.push(signatureId);

    if (!this.sr.elaboratedFunctionSignaturesByName.get(cacheCodename)) {
      this.sr.elaboratedFunctionSignaturesByName.set(cacheCodename, []);
    }
    this.sr.elaboratedFunctionSignaturesByName.get(cacheCodename)!.push(signatureId);

    return signatureId;
  }

  lookupSymbolInNamespaceOrStructScope(
    symbolId: Collect.SymbolId,
    name: string,
    memberAccessExpr: Collect.MemberAccessExpr,
    inference: Semantic.Inference,
  ) {
    const symbol = this.sr.cc.symbolNodes.get(symbolId);

    if (symbol.variant === Collect.ENode.TypeDefSymbol) {
      const typedef = this.sr.cc.typeDefNodes.get(symbol.typeDef);
      if (typedef.variant === Collect.ENode.EnumTypeDef && typedef.unscoped) {
        const semanticTypedef = this.sr.typeDefNodes.get(this.enum(symbol.typeDef));
        assert(semanticTypedef.variant === Semantic.ENode.EnumDatatype);
        for (const e of semanticTypedef.values) {
          if (e.name === name) {
            return [this.sr.exprNodes.get(e.valueExpr), e.literalExpr] as const;
          }
        }
      }
    }

    if (symbol.variant === Collect.ENode.TypeDefSymbol && symbol.name === name) {
      const def = this.sr.cc.typeDefNodes.get(symbol.typeDef);
      if (def.variant === Collect.ENode.StructTypeDef) {
        const typedef = this.sr.cc.typeDefNodes.get(symbol.typeDef);
        assert(typedef.variant === Collect.ENode.StructTypeDef);
        // A struct nested in a struct
        const instantiated = this.instantiateAndElaborateStructWithGenerics(
          symbol.typeDef,
          memberAccessExpr.genericArgs.map((g) => this.expressionAsGenericArg(g)),
          memberAccessExpr.sourceloc,
        );
        return this.sr.b.datatypeDefAsValue(instantiated, memberAccessExpr.sourceloc);
      } else if (def.variant === Collect.ENode.NamespaceTypeDef) {
        const ns = this.namespace(symbol.typeDef);
        return this.sr.b.datatypeDefAsValue(ns, memberAccessExpr.sourceloc);
      } else if (def.variant === Collect.ENode.EnumTypeDef) {
        const e = this.enum(symbol.typeDef);
        return this.sr.b.datatypeDefAsValue(e, memberAccessExpr.sourceloc);
      }
    }

    if (symbol.variant === Collect.ENode.FunctionOverloadGroupSymbol && symbol.name === name) {
      // A method or a namespaced function

      const chosenOverloadId = this.FunctionOverloadChoose(
        symbolId,
        inference?.gonnaCallFunctionWithParameterValues,
        memberAccessExpr.sourceloc,
      );

      const funcsym = this.sr.cc.symbolNodes.get(chosenOverloadId);
      assert(funcsym.variant === Collect.ENode.FunctionSymbol);

      const paramPackTypes = this.prepareParameterPackTypes(
        name,
        funcsym.parameters,
        inference?.gonnaCallFunctionWithParameterValues,
        memberAccessExpr.sourceloc,
      );

      const functionSignatureId = this.elaborateFunctionSignature(chosenOverloadId);
      const functionSignature = this.sr.symbolNodes.get(functionSignatureId);
      assert(functionSignature.variant === Semantic.ENode.FunctionSignature);

      const functionSymbolId = this.elaborateFunctionSymbolWithGenerics(
        functionSignatureId,
        memberAccessExpr.genericArgs.map((g) => this.expressionAsGenericArg(g)),
        memberAccessExpr.sourceloc,
        paramPackTypes,
      );

      const functionSymbol = this.sr.symbolNodes.get(functionSymbolId);
      assert(functionSymbol.variant === Semantic.ENode.FunctionSymbol);
      return this.sr.b.symbolValue(functionSymbolId, memberAccessExpr.sourceloc);
    }

    return undefined;
  }

  lookupAndElaborateNamespaceMemberAccess(
    namespaceValueId: Semantic.ExprId,
    name: string,
    memberAccessExpr: Collect.MemberAccessExpr,
    inference: Semantic.Inference,
  ) {
    const namespace = this.sr.exprNodes.get(namespaceValueId);
    assert(namespace.variant === Semantic.ENode.DatatypeAsValueExpr);
    const semanticNamespace = this.sr.typeDefNodes.get(
      this.sr.typeUseNodes.get(namespace.type).type,
    );
    assert(semanticNamespace.variant === Semantic.ENode.NamespaceDatatype);
    const collectedNamespace = this.sr.cc.typeDefNodes.get(semanticNamespace.collectedNamespace);
    assert(collectedNamespace.variant === Collect.ENode.NamespaceTypeDef);
    const collectedNSSharedInstance = this.sr.cc.nsSharedInstances.get(
      collectedNamespace.sharedInstance,
    );
    assert(collectedNSSharedInstance.variant === Collect.ENode.NamespaceSharedInstance);

    for (const scopeId of collectedNSSharedInstance.namespaceScopes) {
      const scope = this.sr.cc.scopeNodes.get(scopeId);
      assert(scope.variant === Collect.ENode.NamespaceScope);
      for (const symbolId of scope.symbols) {
        const s = this.lookupSymbolInNamespaceOrStructScope(
          symbolId,
          name,
          memberAccessExpr,
          inference,
        );
        if (s) {
          return s;
        }
      }
    }

    throw new CompilerError(
      `Namespace '${collectedNamespace.name}' does not define any declarations named '${memberAccessExpr.memberName}'`,
      memberAccessExpr.sourceloc,
    );
  }

  lookupAndElaborateStaticStructAccess(
    namespaceOrStructValueId: Semantic.ExprId,
    name: string,
    memberAccessExpr: Collect.MemberAccessExpr,
    inference: Semantic.Inference,
  ) {
    const namespaceOrStructValue = this.sr.exprNodes.get(namespaceOrStructValueId);
    assert(namespaceOrStructValue.variant === Semantic.ENode.DatatypeAsValueExpr);
    const semanticStruct = this.sr.typeDefNodes.get(
      this.sr.typeUseNodes.get(namespaceOrStructValue.type).type,
    );
    assert(semanticStruct.variant === Semantic.ENode.StructDatatype);
    const collectedStruct = this.sr.cc.typeDefNodes.get(semanticStruct.originalCollectedDefinition);
    assert(collectedStruct.variant === Collect.ENode.StructTypeDef);
    const structScope = this.sr.cc.scopeNodes.get(collectedStruct.lexicalScope);
    assert(structScope.variant === Collect.ENode.StructLexicalScope);

    const typedef = this.sr.typeUseNodes.get(namespaceOrStructValue.type).type;

    let elaboratedStructCache = null as Semantic.StructDef | null;
    for (const [_, cache] of this.sr.elaboratedStructDatatypes) {
      for (const entry of cache) {
        if (entry.result === typedef) {
          elaboratedStructCache = entry;
        }
      }
    }
    assert(elaboratedStructCache);

    for (const symbolId of structScope.symbols) {
      const s = this.withContext(
        {
          context: Semantic.mergeSubstitutionContext(
            elaboratedStructCache.substitutionContext,
            this.currentContext,
            {
              currentScope: this.currentContext.currentScope,
              genericsScope: this.currentContext.currentScope,
              instanceDeps: {
                instanceDependsOn: new Map(),
                structMembersDependOn: new Map(),
                symbolDependsOn: new Map(),
              },
            },
          ),
          inAttemptExpr: null,
          inFunction: null,
        },
        () =>
          this.lookupSymbolInNamespaceOrStructScope(symbolId, name, memberAccessExpr, inference),
      );
      if (s) {
        const symbol = this.sr.exprNodes.get(s[1]);
        assert(symbol.variant === Semantic.ENode.SymbolValueExpr);
        const sym = this.sr.symbolNodes.get(symbol.symbol);

        if (sym.variant === Semantic.ENode.FunctionSymbol) {
          if (!sym.staticMethod) {
            throw new CompilerError(
              `Method ${Semantic.serializeFullSymbolName(
                this.sr,
                symbol.symbol,
              )} is not static but is used in a static context`,
              memberAccessExpr.sourceloc,
            );
          }
        }
        return s;
      }
    }

    throw new CompilerError(
      `Struct '${collectedStruct.name}' does not define any declarations named '${memberAccessExpr.memberName}'`,
      memberAccessExpr.sourceloc,
    );
  }

  makeArrayLiteral(
    arrayTypeUseId: Semantic.TypeUseId,
    elements: Collect.AggregateLiteralElement[],
    allocator: Semantic.ExprId | null,
    sourceloc: SourceLoc,
    _inference: Semantic.Inference,
  ): [Semantic.Expression, Semantic.ExprId] {
    const arrayUse = this.sr.typeUseNodes.get(arrayTypeUseId);
    const array = this.sr.typeDefNodes.get(arrayUse.type);
    assert(
      array.variant === Semantic.ENode.FixedArrayDatatype ||
        array.variant === Semantic.ENode.DynamicArrayDatatype,
    );

    const values: Semantic.ExprId[] = [];
    for (const m of elements) {
      if (m.key) {
        throw new CompilerError(
          `An array literal requires all elements to be plain values and not 'key: value'-pairs.`,
          sourceloc,
        );
      }

      const exprId = Conversion.MakeConversionOrThrow(
        this.sr,
        this.expr(m.value, {
          gonnaInstantiateStructWithType: array.datatype,
        })[1],
        array.datatype,
        this.currentContext.constraints,
        sourceloc,
        Conversion.Mode.Implicit,
        false,
      );

      values.push(exprId);
    }

    if (array.variant === Semantic.ENode.FixedArrayDatatype) {
      if (BigInt(array.length) !== BigInt(values.length)) {
        throw new CompilerError(
          `Array datatype requires ${array.length} elements, but ${values.length} are given`,
          sourceloc,
        );
      }
    }

    let mutability = arrayUse.mutability;
    if (mutability === EDatatypeMutability.Default) {
      mutability = EDatatypeMutability.Mut;
    }

    return this.sr.b.arrayLiteral(
      makeTypeUse(this.sr, arrayUse.type, mutability, arrayUse.inline, sourceloc)[1],
      values,
      this.inFunction,
      allocator,
      sourceloc,
    );
  }

  makeStructLiteral(
    typeUseId: Semantic.TypeUseId,
    elements: Collect.AggregateLiteralElement[],
    allocator: Semantic.ExprId | null,
    sourceloc: SourceLoc,
    inference: Semantic.Inference,
  ): [Semantic.StructLiteralExpr, Semantic.ExprId] {
    const structUse = this.sr.typeUseNodes.get(typeUseId);
    const struct = this.sr.typeDefNodes.get(structUse.type);
    assert(struct.variant === Semantic.ENode.StructDatatype);

    if (struct.opaque) {
      const originalSymbol = this.sr.cc.typeDefNodes.get(struct.originalCollectedDefinition);
      assert(originalSymbol.variant === Collect.ENode.StructTypeDef);

      let scopeId = this.currentContext.currentScope;
      let correctStruct = false;
      while (true) {
        let scope = this.sr.cc.scopeNodes.get(scopeId);
        if (
          scope.variant !== Collect.ENode.BlockScope &&
          scope.variant !== Collect.ENode.FunctionScope &&
          scope.variant !== Collect.ENode.StructLexicalScope
        ) {
          break;
        }

        if (scope.owningSymbol === originalSymbol.collectedTypeDefSymbol) {
          correctStruct = true;
          break;
        }
        scopeId = scope.parentScope;
      }

      if (!correctStruct) {
        throw new CompilerError(
          `Struct '${Semantic.serializeTypeDef(
            this.sr,
            structUse.type,
          )}' is marked as 'opaque' and therefore no struct literals are allowed outside of its own definition. Did you mean to call a constructor instead?`,
          sourceloc,
        );
      }
    }

    let remainingMembers = struct.members.map((mId) => {
      const m = this.sr.symbolNodes.get(mId);
      assert(m.variant === Semantic.ENode.VariableSymbol);
      return m.name;
    });
    const assignedMembers: string[] = [];
    const assign: {
      name: string;
      value: Semantic.ExprId;
    }[] = [];
    for (const m of elements) {
      if (!m.key) {
        throw new CompilerError(
          `A struct literal requires all elements to be 'key: value'-pairs. Direct symbols and spreading objects is not implemented yet.`,
          sourceloc,
        );
      }

      const variableId = struct.members.find((mmId) => {
        const mm = this.sr.symbolNodes.get(mmId);
        assert(mm.variant === Semantic.ENode.VariableSymbol);
        return mm.name === m.key;
      });

      if (!variableId) {
        throw new CompilerError(
          `${Semantic.serializeTypeDef(this.sr, structUse.type)} does not have a member named '${
            m.key
          }'`,
          sourceloc,
        );
      }
      const variable = this.sr.symbolNodes.get(variableId);
      assert(variable.variant === Semantic.ENode.VariableSymbol);

      if (assignedMembers.includes(m.key)) {
        throw new CompilerError(`Cannot assign member ${m.key} twice`, sourceloc);
      }

      const [_, eId] = this.expr(m.value, {
        gonnaInstantiateStructWithType: variable.type || undefined,
      });

      assert(variable.type);
      const convertedExprId = Conversion.MakeConversionOrThrow(
        this.sr,
        eId,
        variable.type,
        this.currentContext.constraints,
        m.sourceloc,
        Conversion.Mode.Implicit,
        inference?.unsafe || false,
      );

      remainingMembers = remainingMembers.filter((mm) => mm !== m.key);
      assign.push({
        value: convertedExprId,
        name: m.key,
      });
      assignedMembers.push(m.key);
    }

    for (const m of remainingMembers) {
      const defaultValue = struct.memberDefaultValues.find((v) => v.memberName === m);
      if (defaultValue) {
        remainingMembers = remainingMembers.filter((mm) => mm !== m);
        assign.push({
          name: m,
          value: defaultValue.value,
        });
        assignedMembers.push(m);
      }
    }

    assertCompilerError(
      remainingMembers.length === 0,
      `Members ${remainingMembers.join(", ")} were not assigned and no default value is known`,
      sourceloc,
    );

    let mutability = structUse.mutability;
    if (mutability === EDatatypeMutability.Default) {
      mutability = EDatatypeMutability.Mut;
    }

    return this.sr.b.structLiteral(
      makeTypeUse(this.sr, structUse.type, mutability, structUse.inline, sourceloc)[1],
      assign,
      this.inFunction,
      allocator,
      sourceloc,
    );
  }

  elaborateDatatypeMemberAccess(
    sr: Semantic.Context,
    datatypeAsValueExprId: Semantic.ExprId,
    typeUseId: Semantic.TypeUseId,
    memberAccessExpr: Collect.MemberAccessExpr,
    inference: Semantic.Inference,
  ) {
    const datatypeValueInstance = sr.typeUseNodes.get(typeUseId);
    const datatypeValue = sr.typeDefNodes.get(datatypeValueInstance.type);

    if (memberAccessExpr.memberName === "name") {
      return this.sr.b.literal(
        Semantic.serializeTypeUse(sr, typeUseId),
        memberAccessExpr.sourceloc,
      );
    }
    if (memberAccessExpr.memberName === "mangled") {
      const name = Semantic.mangleFullTypeUse(sr, typeUseId);
      return this.sr.b.literal(
        name.wasMangled ? "_H" + name.name : name.name,
        memberAccessExpr.sourceloc,
      );
    }

    if (datatypeValue.variant === Semantic.ENode.NamespaceDatatype) {
      return this.lookupAndElaborateNamespaceMemberAccess(
        datatypeAsValueExprId,
        memberAccessExpr.memberName,
        memberAccessExpr,
        inference,
      );
    } else if (datatypeValue.variant === Semantic.ENode.StructDatatype) {
      return this.lookupAndElaborateStaticStructAccess(
        datatypeAsValueExprId,
        memberAccessExpr.memberName,
        memberAccessExpr,
        inference,
      );
    } else if (datatypeValue.variant === Semantic.ENode.PrimitiveDatatype) {
      if (
        datatypeValue.primitive === EPrimitive.u8 ||
        datatypeValue.primitive === EPrimitive.u16 ||
        datatypeValue.primitive === EPrimitive.u32 ||
        datatypeValue.primitive === EPrimitive.u64 ||
        datatypeValue.primitive === EPrimitive.usize ||
        datatypeValue.primitive === EPrimitive.i8 ||
        datatypeValue.primitive === EPrimitive.i16 ||
        datatypeValue.primitive === EPrimitive.i32 ||
        datatypeValue.primitive === EPrimitive.i64 ||
        datatypeValue.primitive === EPrimitive.int
      ) {
        if (memberAccessExpr.memberName === "max" || memberAccessExpr.memberName === "min") {
          return this.sr.b.literalValue(
            {
              type: datatypeValue.primitive,
              unit: null,
              value: Conversion.getIntegerMinMax(datatypeValue.primitive)[
                memberAccessExpr.memberName === "min" ? 0 : 1
              ],
            },
            memberAccessExpr.sourceloc,
          );
        }
      }

      if (datatypeValue.primitive === EPrimitive.str) {
        if (memberAccessExpr.memberName === "fromByte") {
          const funcname = `__hz_str_from_byte`;

          let [func, funcId] = [null, null] as [
            Semantic.FunctionSymbol | null,
            Semantic.SymbolId | null,
          ];
          if (this.sr.syntheticFunctions.has(funcname)) {
            funcId = this.sr.syntheticFunctions.get(funcname)!;
            assert(funcId);
            const sym = this.sr.symbolNodes.get(funcId);
            assert(sym.variant === Semantic.ENode.FunctionSymbol);
            func = sym;
          } else {
            const functionType = makeRawFunctionDatatypeAvailable(this.sr, {
              parameters: [
                {
                  optional: false,
                  type: this.sr.b.u8Type(),
                },
              ],
              returnType: this.sr.b.strType(),
              requires: {
                final: true,
                pure: false,
                noreturn: false,
                noreturnIf: null,
              },
              sourceloc: memberAccessExpr.sourceloc,
              vararg: false,
            });

            const code = `__c__("return HZSTD_STRING_FROM_BYTE(hzstd_make_heap_allocator(), value);");`;

            [func, funcId] = this.sr.b.syntheticFunctionFromCode({
              functionTypeId: functionType,
              parameterNames: ["value"],
              funcname: funcname,
              bodySourceCode: code,
              currentScope: this.currentContext.currentScope,
              sourceloc: memberAccessExpr.sourceloc,
            });
            this.sr.syntheticFunctions.set(funcname, funcId);
          }

          assert(func && funcId);

          return sr.b.addExpr(this.sr, {
            variant: Semantic.ENode.SymbolValueExpr,
            instanceIds: [],
            symbol: funcId,
            isTemporary: true,
            sourceloc: memberAccessExpr.sourceloc,
            type: makeTypeUse(
              sr,
              func.type,
              EDatatypeMutability.Const,
              false,
              memberAccessExpr.sourceloc,
            )[1],
            flow: Semantic.FlowResult.fallthrough(),
            writes: Semantic.WriteResult.empty(),
          });
        }
      }
    } else if (datatypeValue.variant === Semantic.ENode.TaggedUnionDatatype) {
      if (!datatypeValue.members.find((m) => m.tag === memberAccessExpr.memberName)) {
        throw new CompilerError(
          `Type ${Semantic.serializeTypeUse(sr, typeUseId)} does not have a tag named '${
            memberAccessExpr.memberName
          }'`,
          memberAccessExpr.sourceloc,
        );
      }

      return this.sr.b.addExpr(this.sr, {
        variant: Semantic.ENode.UnionTagReferenceExpr,
        instanceIds: [],
        isTemporary: true,
        tag: memberAccessExpr.memberName,
        unionType: datatypeValueInstance.type,
        type: makeTypeUse(
          this.sr,
          this.sr.b.unionTagRefTypeDef(),
          EDatatypeMutability.Default,
          false,
          memberAccessExpr.sourceloc,
        )[1],
        sourceloc: memberAccessExpr.sourceloc,
        flow: Semantic.FlowResult.fallthrough(),
        writes: Semantic.WriteResult.empty(),
      });
    } else if (datatypeValue.variant === Semantic.ENode.EnumDatatype) {
      if (memberAccessExpr.genericArgs.length !== 0) {
        throw new CompilerError(`Enums do not take generic arguments`, memberAccessExpr.sourceloc);
      }

      for (const value of datatypeValue.values) {
        if (value.name === memberAccessExpr.memberName) {
          return [sr.exprNodes.get(value.literalExpr), value.literalExpr] as const;
        }
      }
    }

    throw new CompilerError(
      `Datatype ${Semantic.serializeTypeUse(sr, typeUseId)} does not have a member named '${
        memberAccessExpr.memberName
      }'`,
      memberAccessExpr.sourceloc,
    );
  }

  elaborateStatement(
    statementId: Collect.StatementId,
    inference: Semantic.Inference,
  ): {
    statementId: Semantic.StatementId | null;
    flow: Semantic.FlowResult;
    writes: Semantic.WriteResult;
  } {
    const s = this.sr.cc.statementNodes.get(statementId);

    switch (s.variant) {
      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.InlineCStatement: {
        const [e, eId] = this.expr(s.expr, undefined);

        const result = EvalCTFE(this.sr, eId);
        if (!result.ok) {
          throw new CompilerError(`This expression is not evaluable at compile time`, e.sourceloc);
        }

        const r = result.value[0];
        assert(r.variant === Semantic.ENode.LiteralExpr);
        if (
          r.literal.type !== EPrimitive.str &&
          r.literal.type !== EPrimitive.cstr &&
          r.literal.type !== EPrimitive.ccstr
        ) {
          throw new CompilerError(
            `This intrinsic can only take compile-time-evaluable string literals`,
            e.sourceloc,
          );
        }

        return {
          statementId: this.sr.b.addStatement(this.sr, {
            variant: Semantic.ENode.InlineCStatement,
            value: r.literal.value,
            sourceloc: s.sourceloc,
          })[1],
          flow: Semantic.FlowResult.fallthrough(),
          writes: Semantic.WriteResult.empty(),
        };
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.IfStatement: {
        if (s.comptime) {
          if (!s.condition) {
            throw new CompilerError(`Comptime 'if let' statements not supported yet`, s.sourceloc);
          }
          const [conditionExpr, conditionExprId] = this.expr(s.condition, undefined);
          if (EvalCTFEBoolean(this.sr, conditionExprId)) {
            const { flow, writes, scopeId } = this.makeAndElaborateBlockScope(s.thenBlock, {
              lastExprIsEmit: false,
              unsafe: inference?.unsafe,
            });
            const resultFlow = Semantic.FlowResult.empty();
            resultFlow.addAll(conditionExpr.flow);
            resultFlow.addAll(flow);
            const resultWrites = Semantic.WriteResult.empty();
            resultWrites.addAll(conditionExpr.writes);
            resultWrites.addAll(writes);
            // If true, control flow is exactly the flow of the 'then'-block. Only one comptime block can be active
            return {
              statementId: this.sr.b.exprStatement(
                this.sr.b.blockScopeExpr(scopeId, flow, writes)[1],
              )[1],
              flow: resultFlow,
              writes: resultWrites,
            };
          }

          for (const elif of s.elseif) {
            if (!elif.condition) {
              throw new CompilerError(
                `Comptime 'if let' statements not supported yet`,
                s.sourceloc,
              );
            }
            const [elifConditionExpr, elifConditionExprId] = this.expr(elif.condition, undefined);
            if (EvalCTFEBoolean(this.sr, elifConditionExprId)) {
              const { flow, writes, scopeId } = this.makeAndElaborateBlockScope(elif.thenBlock, {
                lastExprIsEmit: false,
                unsafe: inference?.unsafe,
              });
              const resultFlow = Semantic.FlowResult.empty();
              resultFlow.addAll(conditionExpr.flow);
              resultFlow.addAll(elifConditionExpr.flow);
              resultFlow.addAll(flow);
              const resultWrites = Semantic.WriteResult.empty();
              resultWrites.addAll(conditionExpr.writes);
              resultWrites.addAll(elifConditionExpr.writes);
              resultWrites.addAll(writes);
              // If true, control flow is exactly the flow of the 'then'-block. Only one comptime block can be active
              return {
                statementId: this.sr.b.exprStatement(
                  this.sr.b.blockScopeExpr(scopeId, flow, writes)[1],
                )[1],
                flow: resultFlow,
                writes: resultWrites,
              };
            }
          }

          if (s.elseBlock) {
            const { flow, writes, scopeId } = this.makeAndElaborateBlockScope(s.elseBlock, {
              lastExprIsEmit: false,
              unsafe: inference?.unsafe,
            });
            const resultFlow = Semantic.FlowResult.empty();
            resultFlow.addAll(conditionExpr.flow);
            // Add flows from all elseif conditions that were checked but not taken
            for (const elif of s.elseif) {
              const [elifConditionExpr] = this.expr(elif.condition!, undefined);
              resultFlow.addAll(elifConditionExpr.flow);
            }
            resultFlow.addAll(flow);
            const resultWrites = Semantic.WriteResult.empty();
            resultWrites.addAll(conditionExpr.writes);
            // Add writes from all elseif conditions that were checked but not taken
            for (const elif of s.elseif) {
              const [elifConditionExpr] = this.expr(elif.condition!, undefined);
              resultWrites.addAll(elifConditionExpr.writes);
            }
            resultWrites.addAll(writes);
            // If true, control flow is exactly the flow of the 'then'-block. Only one comptime block can be active
            return {
              statementId: this.sr.b.exprStatement(
                this.sr.b.blockScopeExpr(scopeId, flow, writes)[1],
              )[1],
              flow: resultFlow,
              writes: resultWrites,
            };
          }

          // Nothing applies, entire statement collapses to nothing
          // But we still need to track flows/writes from all condition evaluations
          const resultFlow = Semantic.FlowResult.fallthrough();
          resultFlow.addAll(conditionExpr.flow);
          const resultWrites = Semantic.WriteResult.empty();
          resultWrites.addAll(conditionExpr.writes);
          for (const elif of s.elseif) {
            const [elifConditionExpr] = this.expr(elif.condition!, undefined);
            resultFlow.addAll(elifConditionExpr.flow);
            resultWrites.addAll(elifConditionExpr.writes);
          }
          return {
            statementId: null,
            flow: resultFlow,
            writes: resultWrites,
          };
        } else {
          // Non-comptime
          const thenConstraints = ConstraintSet.empty();
          const branchFlows: {
            constraints: ConstraintSet;
            flow: Semantic.FlowResult;
          }[] = [];

          const resultFlow = Semantic.FlowResult.empty();
          const resultWrites = Semantic.WriteResult.empty();

          let resultingConditionId: Semantic.ExprId | null = null;
          if (s.letScopeId) {
            const scope = this.sr.cc.scopeNodes.get(s.letScopeId);
            assert(scope.variant === Collect.ENode.BlockScope);
            assert(scope.statements.length === 2);
            const letStatement = this.sr.cc.statementNodes.get(scope.statements[0]);
            assert(letStatement.variant === Collect.ENode.VariableDefinitionStatement);

            // If the let syntax is used, then the letScope contains the variable (as in let ID = <expr>)
            // and s.condition contains the if-guard if available

            assert(letStatement.value);
            const sym = this.sr.cc.symbolNodes.get(letStatement.variableSymbol);
            assert(sym.variant === Collect.ENode.VariableSymbol);
            const [variableSymbolExpr, variableSymbolExprId] = this.expr(
              Collect.makeExpr(this.sr.cc, {
                variant: Collect.ENode.SymbolValueExpr,
                genericArgs: [],
                name: sym.name,
                sourceloc: s.sourceloc,
              })[1],
              undefined,
            );
            resultFlow.addExitFlows(variableSymbolExpr.flow);
            resultWrites.addAll(variableSymbolExpr.writes);
            const variableAsBoolResult = Conversion.MakeConversion(
              this.sr,
              variableSymbolExprId,
              this.sr.b.boolType(),
              this.currentContext.constraints,
              s.sourceloc,
              Conversion.Mode.Implicit,
              false,
            );

            // If the variable itself is convertible to bool, we do not need a guard.
            // If it is not convertible to bool, we absolutely need a guard.

            if (variableAsBoolResult.ok) {
              assert(letStatement.value);
              this.buildLogicalConstraintSet(thenConstraints, variableAsBoolResult.expr);
              const [assignmentExpr, assignmentExprId] = this.sr.b.assignment(
                variableSymbolExprId,
                EAssignmentOperation.Rebind,
                this.expr(letStatement.value!, undefined)[1],
                this.currentContext.constraints,
                s.sourceloc,
                inference,
              );
              const conditionFromLet = this.sr.b.blockScopeExpr(
                this.sr.b.blockScope(
                  [this.sr.b.exprStatement(assignmentExprId)[1]],
                  variableAsBoolResult.expr,
                  s.sourceloc,
                )[1],
                Semantic.FlowResult.fallthrough().withAll(assignmentExpr.flow),
                Semantic.WriteResult.empty().withAll(assignmentExpr.writes),
              )[1];

              if (s.condition) {
                // Variable is convertible to bool and we have guard, combine both
                const [guardExpr, guardExprId] = this.expr(s.condition!, undefined);
                resultFlow.addExitFlows(guardExpr.flow);
                resultWrites.addAll(guardExpr.writes);
                resultingConditionId = this.withAdditionalConstraints(
                  thenConstraints,
                  () =>
                    this.sr.b.binaryExpr(
                      conditionFromLet,
                      Conversion.MakeConversionOrThrow(
                        this.sr,
                        guardExprId,
                        this.sr.b.boolType(),
                        this.currentContext.constraints,
                        s.sourceloc,
                        Conversion.Mode.Implicit,
                        false,
                      ),
                      EBinaryOperation.BoolAnd,
                      this.sr.b.boolType(),
                      s.sourceloc,
                    )[1],
                );
                this.buildLogicalConstraintSet(thenConstraints, guardExprId);
              } else {
                // Variable is convertible to bool but no guard, only use value
                resultingConditionId = conditionFromLet;
              }
            } else {
              if (s.condition) {
                // Variable is NOT convertible to bool but we have a guard, use only guard: Keep as-is
                const [e, eId] = this.expr(s.condition, undefined);
                resultingConditionId = eId;
                resultFlow.addExitFlows(e.flow);
                resultWrites.addAll(e.writes);
                this.buildLogicalConstraintSet(thenConstraints, resultingConditionId);
              } else {
                // Variable is neither convertible to bool nor we have a guard, error
                throw new CompilerError(
                  `The type of the 'if let' expression is not implicitly convertible to bool, therefore a guard of the form 'if let a; b' is required.`,
                  s.sourceloc,
                );
              }
            }
          } else {
            assert(s.condition);
            const [e, eId] = this.expr(s.condition, undefined);
            resultingConditionId = eId;
            resultFlow.addExitFlows(e.flow);
            resultWrites.addAll(e.writes);
            this.buildLogicalConstraintSet(thenConstraints, resultingConditionId);
          }

          // Before applying constraints
          const boolCondition = Conversion.MakeConversionOrThrow(
            this.sr,
            resultingConditionId,
            this.sr.b.boolType(),
            this.currentContext.constraints,
            s.sourceloc,
            Conversion.Mode.Implicit,
            false,
          );

          const [ifStatement, ifStatementId] = this.sr.b.addStatement<Semantic.IfStatement>(
            this.sr,
            {
              variant: Semantic.ENode.IfStatement,
              isLetBinding: Boolean(s.letScopeId),
              condition: boolCondition,
              then: -1 as Semantic.BlockScopeId,
              elseIfs: [],
              else: undefined,
              sourceloc: s.sourceloc,
            },
          );

          const { flow, writes, scopeId } = this.withAdditionalConstraints(thenConstraints, () =>
            this.makeAndElaborateBlockScope(s.thenBlock, {
              lastExprIsEmit: false,
              unsafe: inference?.unsafe,
            }),
          );
          ifStatement.then = scopeId;
          resultWrites.addAll(writes);
          branchFlows.push({
            flow: flow,
            constraints: thenConstraints,
          });

          const elseIfConstraints = new ConditionChain();
          s.elseif.forEach((e) => {
            assert(e.condition);

            // This contains all constraints from all previous conditions (and ONLY the conditions)
            const thisBranchPrevConstraints = elseIfConstraints.branchConstraints(
              thenConstraints.inverse(),
            );

            // Evaluate condition with the constraints from previous branches
            const [conditionExprData, conditionExpr] = this.withAdditionalConstraints(
              thisBranchPrevConstraints,
              () => this.expr(e.condition!, undefined),
            );
            resultFlow.addExitFlows(conditionExprData.flow);
            resultWrites.addAll(conditionExprData.writes);

            const boolCondition = Conversion.MakeConversionOrThrow(
              this.sr,
              conditionExpr,
              this.sr.b.boolType(),
              thisBranchPrevConstraints,
              s.sourceloc,
              Conversion.Mode.Implicit,
              false,
            );

            // This contains ONLY this elseIf's condition, so it can be inverted cleanly later
            const thisBranchConstraints = ConstraintSet.empty();
            this.buildLogicalConstraintSet(thisBranchConstraints, conditionExpr);
            elseIfConstraints.add(thisBranchConstraints);

            // This now contains ALL the conditions that actually apply to the scope
            const scopeConstraints = this.currentContext.constraints.clone();
            scopeConstraints.addAll(thisBranchPrevConstraints);
            scopeConstraints.addAll(thisBranchConstraints);

            const { flow, writes, scopeId } = this.withAdditionalConstraints(scopeConstraints, () =>
              this.makeAndElaborateBlockScope(e.thenBlock, {
                lastExprIsEmit: false,
                unsafe: inference?.unsafe,
              }),
            );
            resultWrites.addAll(writes);
            branchFlows.push({
              flow: flow,
              constraints: thisBranchConstraints,
            });

            ifStatement.elseIfs.push({
              condition: boolCondition,
              then: scopeId,
            });
          });

          if (s.elseBlock) {
            // This contains all constraints from all previous conditions (and ONLY the conditions)
            const thisBranchPrevConstraints = elseIfConstraints.branchConstraints(
              thenConstraints.inverse(),
            );

            // This now contains ALL the conditions that actually apply to the scope
            const scopeConstraints = this.currentContext.constraints.clone();
            scopeConstraints.addAll(thisBranchPrevConstraints);

            const { flow, writes, scopeId } = this.withAdditionalConstraints(scopeConstraints, () =>
              this.makeAndElaborateBlockScope(s.elseBlock!, {
                lastExprIsEmit: false,
                unsafe: inference?.unsafe,
              }),
            );
            resultWrites.addAll(writes);
            branchFlows.push({
              flow: flow,
              constraints: ConstraintSet.empty(),
            });
            ifStatement.else = scopeId;
          }

          for (const { flow } of branchFlows) {
            for (const e of flow.get()) {
              if (e === Semantic.FlowType.Raise || e === Semantic.FlowType.Return) {
                resultFlow.add(e);
              }
            }
          }

          if (!s.elseBlock) {
            branchFlows.push({
              flow: Semantic.FlowResult.fallthrough(),
              constraints: ConstraintSet.empty(), // IMPORTANT: no constraints
            });
          }

          if (branchFlows.some((b) => b.flow.has(Semantic.FlowType.Fallthrough))) {
            resultFlow.add(Semantic.FlowType.Fallthrough);
          }

          let fallthroughBranches = branchFlows.filter((f) =>
            f.flow.has(Semantic.FlowType.Fallthrough),
          );
          let nonFallthroughBranches = branchFlows.filter(
            (f) => !f.flow.has(Semantic.FlowType.Fallthrough),
          );

          let canNarrowAfterIf =
            (fallthroughBranches.length > 0 || !s.elseBlock) && nonFallthroughBranches.length > 0;
          if (canNarrowAfterIf) {
            const constraints = ConstraintSet.empty();
            nonFallthroughBranches.forEach((b) => constraints.addAll(b.constraints));
            this.currentContext.constraints.addAll(constraints.inverse());
          }

          return {
            statementId: ifStatementId,
            flow: resultFlow,
            writes: resultWrites,
          };
        }
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.WhileStatement: {
        let resultingConditionId: Semantic.ExprId | null = null;

        const resultFlow = Semantic.FlowResult.fallthrough();
        const resultWrites = Semantic.WriteResult.empty();

        const conditionConstraints = ConstraintSet.empty();
        if (s.letScopeId) {
          const scope = this.sr.cc.scopeNodes.get(s.letScopeId);
          assert(scope.variant === Collect.ENode.BlockScope);
          assert(scope.statements.length === 2);
          const letStatement = this.sr.cc.statementNodes.get(scope.statements[0]);
          assert(letStatement.variant === Collect.ENode.VariableDefinitionStatement);

          // If the let syntax is used, then the letScope contains the variable (as in let ID = <expr>)
          // and s.condition contains the if-guard if available

          assert(letStatement.value);
          const sym = this.sr.cc.symbolNodes.get(letStatement.variableSymbol);
          assert(sym.variant === Collect.ENode.VariableSymbol);
          const [variableSymbolExpr, variableSymbolExprId] = this.expr(
            Collect.makeExpr(this.sr.cc, {
              variant: Collect.ENode.SymbolValueExpr,
              genericArgs: [],
              name: sym.name,
              sourceloc: s.sourceloc,
            })[1],
            undefined,
          );
          resultFlow.addExitFlows(variableSymbolExpr.flow);
          resultWrites.addAll(variableSymbolExpr.writes);
          const variableAsBoolResult = Conversion.MakeConversion(
            this.sr,
            variableSymbolExprId,
            this.sr.b.boolType(),
            this.currentContext.constraints,
            s.sourceloc,
            Conversion.Mode.Implicit,
            false,
          );

          // If the variable itself is convertible to bool, we do not need a guard.
          // If it is not convertible to bool, we absolutely need a guard.

          if (variableAsBoolResult.ok) {
            assert(letStatement.value);
            this.buildLogicalConstraintSet(conditionConstraints, variableAsBoolResult.expr);
            const [assignmentExpr, assignmentExprId] = this.sr.b.assignment(
              variableSymbolExprId,
              EAssignmentOperation.Rebind,
              this.expr(letStatement.value!, undefined)[1],
              this.currentContext.constraints,
              s.sourceloc,
              inference,
            );
            const conditionFromLet = this.sr.b.blockScopeExpr(
              this.sr.b.blockScope(
                [this.sr.b.exprStatement(assignmentExprId)[1]],
                variableAsBoolResult.expr,
                s.sourceloc,
              )[1],
              Semantic.FlowResult.fallthrough().withAll(assignmentExpr.flow),
              Semantic.WriteResult.empty().withAll(assignmentExpr.writes),
            )[1];

            if (s.condition) {
              // Variable is convertible to bool and we have guard, combine both
              const [guardExpr, guardExprId] = this.expr(s.condition!, undefined);
              resultFlow.addExitFlows(guardExpr.flow);
              resultWrites.addAll(guardExpr.writes);
              resultingConditionId = this.withAdditionalConstraints(
                conditionConstraints,
                () =>
                  this.sr.b.binaryExpr(
                    conditionFromLet,
                    Conversion.MakeConversionOrThrow(
                      this.sr,
                      guardExprId,
                      this.sr.b.boolType(),
                      this.currentContext.constraints,
                      s.sourceloc,
                      Conversion.Mode.Implicit,
                      false,
                    ),
                    EBinaryOperation.BoolAnd,
                    this.sr.b.boolType(),
                    s.sourceloc,
                  )[1],
              );
              this.buildLogicalConstraintSet(conditionConstraints, guardExprId);
            } else {
              // Variable is convertible to bool but no guard, only use value
              resultingConditionId = conditionFromLet;
            }
          } else {
            if (s.condition) {
              // Variable is NOT convertible to bool but we have a guard, use only guard: Keep as-is
              const [e, eId] = this.expr(s.condition, undefined);
              resultingConditionId = eId;
              resultFlow.addExitFlows(e.flow);
              resultWrites.addAll(e.writes);
              this.buildLogicalConstraintSet(conditionConstraints, resultingConditionId);
            } else {
              // Variable is neither convertible to bool nor we have a guard, error
              throw new CompilerError(
                `The type of the 'while let' expression is not implicitly convertible to bool, therefore a 'while let ... if ...'-guard is required.`,
                s.sourceloc,
              );
            }
          }
        } else {
          assert(s.condition);
          const [e, eId] = this.expr(s.condition, undefined);
          resultingConditionId = eId;
          resultFlow.addExitFlows(e.flow);
          resultWrites.addAll(e.writes);
          this.buildLogicalConstraintSet(conditionConstraints, resultingConditionId);
        }

        assert(resultingConditionId);
        const boolCondition = Conversion.MakeConversionOrThrow(
          this.sr,
          resultingConditionId,
          this.sr.b.boolType(),
          this.currentContext.constraints,
          s.sourceloc,
          Conversion.Mode.Implicit,
          false,
        );

        const { flow, writes, scopeId } = this.withAdditionalConstraints(conditionConstraints, () =>
          this.makeAndElaborateBlockScope(s.block, {
            lastExprIsEmit: false,
            unsafe: inference?.unsafe,
          }),
        );
        resultFlow.addAll(flow);
        resultWrites.addAll(writes);

        return {
          statementId: this.sr.b.addStatement(this.sr, {
            variant: Semantic.ENode.WhileStatement,
            isLetBinding: Boolean(s.letScopeId),
            condition: boolCondition,
            then: scopeId,
            sourceloc: s.sourceloc,
          })[1],
          flow: resultFlow,
          writes: resultWrites,
        };
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.ReturnStatement: {
        if (!this.inFunction) {
          throw new CompilerError(
            `Cannot return in this context, it's not in a function context`,
            s.sourceloc,
          );
        }

        const functionSymbol = this.getSymbol(this.inFunction);
        assert(functionSymbol.variant === Semantic.ENode.FunctionSymbol);

        if (s.expr) {
          let eId: Semantic.ExprId;

          const returnType = functionSymbol.annotatedReturnType;
          if (returnType) {
            // The function return type is explicit, so do proper conversions
            eId = Conversion.MakeConversionOrThrow(
              this.sr,
              this.expr(s.expr, {
                gonnaInstantiateStructWithType: returnType,
              })[1],
              returnType,
              this.currentContext.constraints,
              s.sourceloc,
              Conversion.Mode.Implicit,
              false,
            );
          } else {
            // The function return type NOT known, so we must infer it
            const [result, resultId] = this.expr(s.expr, {
              gonnaInstantiateStructWithType: undefined,
            });
            eId = resultId;
            functionSymbol.returnedDatatypes.add(result.type);
          }

          const expression = this.sr.exprNodes.get(eId);
          assert(this.functionReturnsInstanceIds);
          expression.instanceIds.forEach((i) => this.functionReturnsInstanceIds!.add(i));

          const resultId = this.sr.b.addStatement(this.sr, {
            variant: Semantic.ENode.ReturnStatement,
            expr: eId,
            sourceloc: s.sourceloc,
          })[1];
          functionSymbol.returnStatements.add(resultId);
          return {
            statementId: resultId,
            flow: Semantic.FlowResult.return(),
            writes: Semantic.WriteResult.empty(),
          };
        } else {
          const resultId = this.sr.b.addStatement(this.sr, {
            variant: Semantic.ENode.ReturnStatement,
            sourceloc: s.sourceloc,
          })[1];
          functionSymbol.returnStatements.add(resultId);
          return {
            statementId: resultId,
            flow: Semantic.FlowResult.return(),
            writes: Semantic.WriteResult.empty(),
          };
        }
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.VariableDefinitionStatement: {
        let uninitialized = false;
        if (s.value) {
          const value = this.sr.cc.exprNodes.get(s.value);
          if (value.variant === Collect.ENode.SymbolValueExpr && value.name === "uninitialized") {
            if (value.genericArgs.length !== 0) {
              throw new CompilerError(
                `The 'uninitialized' directive requires 0 type arguments`,
                s.sourceloc,
              );
            }
            if (!inference?.unsafe) {
              throw new CompilerError(
                `The 'uninitialized' directive may only appear in an explicit unsafe block`,
                s.sourceloc,
              );
            }
            uninitialized = true;
          }
        }

        const collectedVariableSymbol = this.sr.cc.symbolNodes.get(s.variableSymbol);
        assert(collectedVariableSymbol.variant === Collect.ENode.VariableSymbol);
        const variableSymbolId = this.currentContext.elaboratedVariables.get(s.variableSymbol);
        assert(variableSymbolId);
        const variableSymbol = this.sr.symbolNodes.get(variableSymbolId);
        assert(variableSymbol.variant === Semantic.ENode.VariableSymbol);

        if (collectedVariableSymbol.type) {
          variableSymbol.type = this.withContext(
            {
              context: Semantic.isolateElaborationContext(this.currentContext, {
                currentScope: s.owningScope,
                genericsScope: s.owningScope,
                constraints: this.currentContext.constraints,
                instanceDeps: {
                  instanceDependsOn: new Map(),
                  structMembersDependOn: new Map(),
                  symbolDependsOn: new Map(),
                },
              }),
              inFunction: this.inFunction,
              inAttemptExpr: this.inAttemptExpr,
            },
            () => this.lookupAndElaborateDatatype(collectedVariableSymbol.type!),
          );
          assert(variableSymbol.type);
        }

        if (variableSymbol.type) {
          const typeUse = this.sr.typeUseNodes.get(variableSymbol.type);
          if (
            variableSymbol.mutability === EVariableMutability.Const &&
            typeUse.mutability === EDatatypeMutability.Mut
          ) {
            printWarningMessage(
              `This 'mut' modifier will be overruled by the 'const' declaration and have no effect`,
              s.sourceloc,
            );
          }
        }

        let valueId: Semantic.ExprId | undefined;
        if (s.value) {
          const sValue = this.sr.cc.exprNodes.get(s.value);
          if (sValue.variant === Collect.ENode.SymbolValueExpr && sValue.name === "default") {
            if (sValue.genericArgs.length !== 0) {
              throw new CompilerError(
                `'default' initializer cannot take any generics`,
                s.sourceloc,
              );
            }
            if (!variableSymbol.type) {
              throw new CompilerError(
                `Variable initializations with a 'default' initializer require an explicit datatype to be specified`,
                s.sourceloc,
              );
            }
            valueId = Conversion.MakeDefaultValue(this.sr, variableSymbol.type, s.sourceloc);
          } else {
            valueId =
              (!uninitialized &&
                s.value &&
                this.expr(s.value, {
                  gonnaInstantiateStructWithType: variableSymbol.type ?? undefined,
                  unsafe: inference?.unsafe,
                })[1]) ||
              undefined;
          }
        }
        const value = valueId && this.sr.exprNodes.get(valueId);

        if ((!valueId || !value) && !uninitialized) {
          throw new CompilerError(
            `Variable '${variableSymbol.name}' requires an initialization value`,
            s.sourceloc,
          );
        }

        if (value?.variant === Semantic.ENode.DatatypeAsValueExpr) {
          throw new CompilerError(`A variable cannot be assigned a datatype`, value.sourceloc);
        }

        if (!variableSymbol.type) {
          variableSymbol.type = value?.type || null;

          // if (variableSymbol.type && value) {
          //   const variableSymbolType = this.sr.typeUseNodes.get(variableSymbol.type);
          //   const variableSymbolTypeDef = this.sr.typeDefNodes.get(variableSymbolType.type);
          //   if (variableSymbol.mutability === EVariableMutability.Const) {
          //   } else {
          // THIS IS WRONG ISN'T IT???? REFERENCES????
          //     // If a const T value is assigned to a let variable,
          //     // a copy is made which makes the copied value fully mutable.
          //     variableSymbol.type = makeTypeUse(
          //       this.sr,
          //       variableSymbolType.type,
          //       EDatatypeMutability.Mut,
          //       variableSymbolType.inline,
          //       variableSymbolType.unique,
          //       s.sourceloc
          //     )[1];
          //   }
          // }
        }
        assert(variableSymbol.type);

        // Now change the mutability of the variable
        if (variableSymbol.mutability === EVariableMutability.Const) {
          const typeUse = this.sr.typeUseNodes.get(variableSymbol.type);
          if (typeUse.mutability !== EDatatypeMutability.Const) {
            variableSymbol.type = makeTypeUse(
              this.sr,
              typeUse.type,
              EDatatypeMutability.Const,
              typeUse.inline,
              s.sourceloc,
            )[1];
          }
        }

        variableSymbol.concrete = this.sr.typeDefNodes.get(
          this.sr.typeUseNodes.get(variableSymbol.type).type,
        ).concrete;
        const variableSymbolType = this.sr.typeUseNodes.get(variableSymbol.type);
        const variableSymbolTypeDef = this.sr.typeDefNodes.get(variableSymbolType.type);

        if (
          variableSymbolTypeDef.variant === Semantic.ENode.PrimitiveDatatype &&
          variableSymbolTypeDef.primitive === EPrimitive.void
        ) {
          throw new CompilerError(
            `A variable cannot be assigned a 'void' value`,
            value?.sourceloc || s.sourceloc,
          );
        }

        if (variableSymbolTypeDef.variant === Semantic.ENode.UnionTagRefDatatype) {
          throw new CompilerError(
            `A variable cannot be assigned a value of type ${Semantic.serializeTypeDef(
              this.sr,
              variableSymbolType.type,
            )}`,
            value?.sourceloc || s.sourceloc,
          );
        }

        if (variableSymbol.mutability === EVariableMutability.Const) {
          // assert(false, "TODO");
        } else {
          // if (variableSymbol)
        }

        if (variableSymbol.comptime) {
          assert(valueId);
          const r = EvalCTFE(this.sr, valueId);
          if (!r.ok) throw new CompilerError(r.error, s.sourceloc);
          variableSymbol.comptimeValue = r.value[1];
        }

        if (value) {
          Semantic.addSymbolDeps(this.sr.e.currentContext, variableSymbolId, value.instanceIds);
        }

        // if (value) {
        //   const valueType = sr.typeDefNodes.get(sr.typeUseNodes.get(value.type).type);
        //   if (
        //     variableSymbolTypeDef.variant === Semantic.ENode.StructDatatype &&
        //     valueType.variant === Semantic.ENode.StructDatatype &&
        //     (valueType.clonability === EClonability.NonClonableFromAttribute ||
        //       valueType.clonability === EClonability.NonClonableFromMembers) &&
        //     !value.isTemporary
        //   ) {
        //     const msg =
        //       valueType.clonability === EClonability.NonClonableFromAttribute
        //         ? "marked as 'nonclonable'"
        //         : "non-clonable because it contains raw pointers or other non-clonable structures";
        //     throw new CompilerError(
        //       `This assignment of type '${serializeTypeUse(
        //         sr,
        //         value.type
        //       )}' would create a copy of the struct, but the struct definition is ${msg}`,
        //       s.sourceloc
        //     );
        //   }
        // }

        return {
          statementId: this.sr.b.addStatement(this.sr, {
            variant: Semantic.ENode.VariableStatement,
            mutability: variableSymbol.mutability,
            comptime: collectedVariableSymbol.comptime,
            name: variableSymbol.name,
            variableSymbol: variableSymbolId,
            value:
              (valueId &&
                Conversion.MakeConversionOrThrow(
                  this.sr,
                  valueId,
                  variableSymbol.type,
                  this.currentContext.constraints,
                  s.sourceloc,
                  Conversion.Mode.Implicit,
                  inference?.unsafe || false,
                )) ||
              null,
            sourceloc: s.sourceloc,
          })[1],
          flow: Semantic.FlowResult.fallthrough(),
          writes: Semantic.WriteResult.empty().with(variableSymbolId),
        };
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.ExprStatement: {
        const [e, eId] = this.expr(s.expr, undefined);

        const typeUse = this.sr.typeUseNodes.get(e.type);
        if (Conversion.isNodiscardById(this.sr, typeUse.type)) {
          throw new CompilerError(
            `This expression produces a value of type '${Semantic.serializeTypeUse(this.sr, e.type)}' which must be handled`,
            s.sourceloc,
          );
        }

        return {
          statementId: this.sr.b.addStatement(this.sr, {
            variant: Semantic.ENode.ExprStatement,
            expr: eId,
            sourceloc: s.sourceloc,
          })[1],
          flow: e.flow,
          writes: e.writes,
        };
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.ForStatement: {
        if (s.comptime) {
          assert(false, "Comptime for loops are not implemented yet (comptime for-each is)");
        }

        const loopCondition = s.loopCondition
          ? Conversion.MakeConversionOrThrow(
              this.sr,
              this.expr(s.loopCondition, {})[1],
              this.sr.b.boolType(),
              this.currentContext.constraints,
              s.sourceloc,
              Conversion.Mode.Implicit,
              false,
            )
          : null;
        const loopIncrement = s.loopIncrement ? this.expr(s.loopIncrement, {})[1] : null;

        const { flow, writes, scopeId } = this.makeAndElaborateBlockScope(s.body, {
          lastExprIsEmit: false,
          unsafe: inference?.unsafe,
        });
        flow.add(Semantic.FlowType.Fallthrough);

        if (s.initStatement) {
          const {
            flow: letStatementFlow,
            writes: letStatementWrites,
            statementId,
          } = this.elaborateStatement(s.initStatement, {});
          flow.addAll(letStatementFlow);
          writes.addAll(letStatementWrites);
          return {
            statementId: this.sr.b.addStatement(this.sr, {
              variant: Semantic.ENode.ForStatement,
              body: scopeId,
              initStatement: statementId,
              loopCondition: loopCondition,
              loopIncrement: loopIncrement,
              sourceloc: s.sourceloc,
            })[1],
            flow: flow,
            writes: writes,
          };
        } else {
          return {
            statementId: this.sr.b.addStatement(this.sr, {
              variant: Semantic.ENode.ForStatement,
              body: scopeId,
              initStatement: null,
              loopCondition: loopCondition,
              loopIncrement: loopIncrement,
              sourceloc: s.sourceloc,
            })[1],
            flow: flow,
            writes: writes,
          };
        }
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.ForEachStatement: {
        if (s.comptime) {
          const valueId = this.expr(s.value, undefined)[1];
          const r = EvalCTFE(this.sr, valueId);
          if (!r.ok) throw new CompilerError(r.error, s.sourceloc);
          const comptimeValue = r.value[0];
          if (comptimeValue.variant !== Semantic.ENode.SymbolValueExpr) {
            throw new CompilerError(
              `For each loop over something other than a parameter pack is not implemented yet`,
              s.sourceloc,
            );
          }
          const comptimeExpr = this.sr.typeDefNodes.get(
            this.sr.typeUseNodes.get(comptimeValue.type).type,
          );
          if (comptimeExpr.variant !== Semantic.ENode.ParameterPackDatatype) {
            throw new CompilerError(
              `For each loop over something other than a parameter pack is not implemented yet`,
              s.sourceloc,
            );
          }

          if (!this.sr.syntheticScopeToVariableMap.has(s.body)) {
            this.sr.syntheticScopeToVariableMap.set(s.body, new Map());
          }
          const syntheticMap = this.sr.syntheticScopeToVariableMap.get(s.body)!;

          assert(comptimeExpr.parameters);

          let loopIndex: undefined | Semantic.VariableSymbol = undefined;
          let loopIndexId: undefined | Semantic.SymbolId = undefined;
          if (s.indexVariable) {
            [loopIndex, loopIndexId] = this.sr.b.addSymbol(this.sr, {
              variant: Semantic.ENode.VariableSymbol,
              comptime: true,
              comptimeValue: null,
              concrete: true,
              export: false,
              extern: EExternLanguage.None,
              memberOfStruct: null,
              mutability: EVariableMutability.Const,
              name: s.indexVariable,
              parentStructOrNS: null,
              sourceloc: s.sourceloc,
              type: makePrimitiveAvailable(
                this.sr,
                EPrimitive.int,
                EDatatypeMutability.Const,
                s.sourceloc,
              ),
              variableContext: EVariableContext.FunctionLocal,
            } satisfies Semantic.VariableSymbol);
          }

          const resultWrites = Semantic.WriteResult.empty();
          const resultFlow = Semantic.FlowResult.fallthrough();
          const allScopes: Semantic.StatementId[] = [];
          for (let i = 0; i < comptimeExpr.parameters.length; i++) {
            const semanticParamId = comptimeExpr.parameters[i];
            const paramValue = this.sr.symbolNodes.get(semanticParamId);
            assert(paramValue.variant === Semantic.ENode.VariableSymbol);
            assert(paramValue.type);

            syntheticMap.set(s.loopVariable, semanticParamId);
            if (s.indexVariable) {
              assert(loopIndexId && loopIndex);
              loopIndex.comptimeValue = this.sr.b.literalValue(
                {
                  type: EPrimitive.int,
                  unit: null,
                  value: BigInt(i),
                },
                s.sourceloc,
              )[1];
              syntheticMap.set(s.indexVariable, loopIndexId);
            }
            const { flow, writes, scopeId } = this.makeAndElaborateBlockScope(s.body, {
              lastExprIsEmit: false,
              unsafe: inference?.unsafe,
            });
            resultFlow.addAll(flow);
            resultWrites.addAll(writes);
            if (s.indexVariable) {
              syntheticMap.delete(s.indexVariable);
            }
            syntheticMap.delete(s.loopVariable);

            allScopes.push(
              this.sr.b.exprStatement(this.sr.b.blockScopeExpr(scopeId, flow, writes)[1])[1],
            );
          }

          resultFlow.add(Semantic.FlowType.Fallthrough);

          return {
            statementId: this.sr.b.exprStatement(
              this.sr.b.blockScopeExpr(
                this.sr.b.blockScope(allScopes, this.sr.b.noneExpr()[1], s.sourceloc)[1],
                resultFlow,
                resultWrites,
              )[1],
            )[1],
            flow: resultFlow,
            writes: resultWrites,
          };
        } else {
          // Runtime for-each loop: for element in array {}
          // Elaborate to semantic ForEachStatement, let lowering handle conversion to for-loop

          // Step 1: Elaborate the array expression
          const [arrayExpr, arrayExprId] = this.expr(s.value, undefined);
          const arrayTypeUse = this.sr.typeUseNodes.get(arrayExpr.type);
          const arrayType = this.sr.typeDefNodes.get(arrayTypeUse.type);

          // Step 2: Validate it's an array and extract element type
          if (
            arrayType.variant !== Semantic.ENode.FixedArrayDatatype &&
            arrayType.variant !== Semantic.ENode.DynamicArrayDatatype
          ) {
            throw new CompilerError(
              `For-each loop requires an array type, but got '${Semantic.serializeTypeUse(this.sr, arrayExpr.type)}'`,
              s.sourceloc,
            );
          }

          const elementTypeUse = arrayType.datatype;

          // Step 3: Create loop variable (element) with the array's element type
          const [_, loopVariableId] = this.sr.b.addSymbol(this.sr, {
            variant: Semantic.ENode.VariableSymbol,
            comptime: false,
            comptimeValue: null,
            concrete: true,
            export: false,
            extern: EExternLanguage.None,
            memberOfStruct: null,
            mutability: EVariableMutability.Const,
            name: s.loopVariable,
            parentStructOrNS: null,
            sourceloc: s.sourceloc,
            type: elementTypeUse,
            variableContext: EVariableContext.FunctionLocal,
          });

          // Step 4: Create index variable if specified
          let indexVariableId: Semantic.SymbolId | null = null;
          if (s.indexVariable) {
            indexVariableId = this.sr.b.addSymbol(this.sr, {
              variant: Semantic.ENode.VariableSymbol,
              comptime: false,
              comptimeValue: null,
              concrete: true,
              export: false,
              extern: EExternLanguage.None,
              memberOfStruct: null,
              mutability: EVariableMutability.Const,
              name: s.indexVariable,
              parentStructOrNS: null,
              sourceloc: s.sourceloc,
              type: makePrimitiveAvailable(
                this.sr,
                EPrimitive.int,
                EDatatypeMutability.Const,
                s.sourceloc,
              ),
              variableContext: EVariableContext.FunctionLocal,
            })[1];
          }

          // Step 5: Register variables in synthetic scope map so they're available in body
          if (!this.sr.syntheticScopeToVariableMap.has(s.body)) {
            this.sr.syntheticScopeToVariableMap.set(s.body, new Map());
          }
          const syntheticMap = this.sr.syntheticScopeToVariableMap.get(s.body)!;
          syntheticMap.set(s.loopVariable, loopVariableId);
          if (s.indexVariable && indexVariableId) {
            syntheticMap.set(s.indexVariable, indexVariableId);
          }

          // Step 6: Elaborate the loop body
          const { flow, writes, scopeId } = this.makeAndElaborateBlockScope(s.body, {
            lastExprIsEmit: false,
            unsafe: inference?.unsafe,
          });

          // Step 7: Clean up synthetic scope
          syntheticMap.delete(s.loopVariable);
          if (s.indexVariable) {
            syntheticMap.delete(s.indexVariable);
          }

          // Step 8: Emit ForEachStatement in clean semantic form
          // Lowering will convert this to a traditional for-loop
          flow.add(Semantic.FlowType.Fallthrough);

          return {
            statementId: this.sr.b.addStatement(this.sr, {
              variant: Semantic.ENode.ForEachStatement,
              arrayExpr: arrayExprId,
              loopVariable: loopVariableId,
              indexVariable: indexVariableId,
              body: scopeId,
              sourceloc: s.sourceloc,
            })[1],
            flow: flow,
            writes: writes,
          };
        }
      }

      case Collect.ENode.RaiseStatement: {
        const [e, eId] = s.expr ? this.expr(s.expr, undefined) : this.sr.b.noneExpr();

        if (!this.inAttemptExpr) {
          throw new CompilerError(
            `A 'raise' statement can only be used in conjunction with a attempt/else construct, no corresponding construct for this statement is found`,
            s.sourceloc,
          );
        }

        const expr = this.sr.exprNodes.get(this.inAttemptExpr);
        assert(expr.variant === Semantic.ENode.AttemptExpr);
        expr.errorTypesCaught.add(e.type);

        return {
          statementId: this.sr.b.addStatement(this.sr, {
            variant: Semantic.ENode.RaiseStatement,
            expr: eId,
            toAttemptExpr: this.inAttemptExpr,
            sourceloc: s.sourceloc,
          })[1],
          flow: Semantic.FlowResult.empty().with(Semantic.FlowType.Raise),
          writes: Semantic.WriteResult.empty(),
        };
      }

      default:
        assert(false);
    }
  }

  applyBinaryExprConstraints(
    constraints: ConstraintSet,
    exprId: Semantic.ExprId,
    literalExprId: Semantic.ExprId,
    operation: EBinaryOperation,
  ) {
    const expr = this.sr.exprNodes.get(exprId);
    const literalExpr = this.sr.exprNodes.get(literalExprId);
    assert(literalExpr.variant === Semantic.ENode.LiteralExpr);

    if (
      literalExpr.literal.type !== EPrimitive.i8 &&
      literalExpr.literal.type !== EPrimitive.i16 &&
      literalExpr.literal.type !== EPrimitive.i32 &&
      literalExpr.literal.type !== EPrimitive.i64 &&
      literalExpr.literal.type !== EPrimitive.int &&
      literalExpr.literal.type !== EPrimitive.usize &&
      literalExpr.literal.type !== EPrimitive.u8 &&
      literalExpr.literal.type !== EPrimitive.u16 &&
      literalExpr.literal.type !== EPrimitive.u32 &&
      literalExpr.literal.type !== EPrimitive.u64
    ) {
      return;
    }

    switch (operation) {
      case EBinaryOperation.Equal:
      case EBinaryOperation.NotEqual:
      case EBinaryOperation.GreaterEqual:
      case EBinaryOperation.GreaterThan:
      case EBinaryOperation.LessEqual:
      case EBinaryOperation.LessThan: {
        const path = this.extractConstraintPath(exprId);
        if (path) {
          constraints.addPath(path, {
            kind: "comparison",
            operation: operation,
            value: literalExprId,
          });
          return;
        }

        if (expr.variant === Semantic.ENode.SymbolValueExpr) {
          const symbol = this.sr.symbolNodes.get(expr.symbol);
          if (symbol.variant !== Semantic.ENode.VariableSymbol || !symbol.type) {
            return;
          }
          constraints.add({
            constraintValue: {
              kind: "comparison",
              operation: operation,
              value: literalExprId,
            },
            variableSymbol: expr.symbol,
          });
        }
      }
    }
  }

  extractConstraintPath(exprId: Semantic.ExprId): ConstraintPath | null {
    return this.sr.b.extractConstraintPath(exprId);
  }

  buildLogicalConstraintSet(constraints: ConstraintSet, exprId: Semantic.ExprId) {
    const expr = this.sr.exprNodes.get(exprId);
    const exprTypeUse = this.sr.typeUseNodes.get(expr.type);
    const exprTypeDef = this.sr.typeDefNodes.get(exprTypeUse.type);

    if (
      expr.variant === Semantic.ENode.ExplicitCastExpr &&
      Conversion.isBoolean(this.sr, this.sr.typeUseNodes.get(expr.type).type)
    ) {
      this.buildLogicalConstraintSet(constraints, expr.expr);
      return;
    }

    if (expr.variant === Semantic.ENode.UnaryExpr) {
      if (expr.operation === EUnaryOperation.Negate) {
        const c = ConstraintSet.empty();
        this.buildLogicalConstraintSet(c, expr.expr);
        constraints.addAll(c.inverse());
        return;
      }
    }

    if (expr.variant === Semantic.ENode.BinaryExpr) {
      if (expr.operation === EBinaryOperation.BoolAnd) {
        this.buildLogicalConstraintSet(constraints, expr.left);
        this.buildLogicalConstraintSet(constraints, expr.right);
        return;
      } else {
        const rightValue = EvalCTFE(this.sr, expr.right);
        if (rightValue.ok) {
          this.applyBinaryExprConstraints(
            constraints,
            expr.left,
            rightValue.value[1],
            expr.operation,
          );
          return;
        }

        const leftValue = EvalCTFE(this.sr, expr.left);
        if (leftValue.ok) {
          this.applyBinaryExprConstraints(
            constraints,
            expr.right,
            leftValue.value[1],
            expr.operation,
          );
        }
      }
      return;
    }

    if (expr.variant === Semantic.ENode.UnionTagCheckExpr) {
      let unionExpr = this.getExpr(expr.expr);

      // If the union expression has been narrowed (wrapped in UnionToUnionCastExpr), unwrap it
      while (
        unionExpr.variant === Semantic.ENode.UnionToUnionCastExpr &&
        unionExpr.castComesFromNarrowingAndMayBeUnwrapped
      ) {
        unionExpr = this.getExpr(unionExpr.expr);
      }

      // Try to extract constraint path (handles variables, members, and subscripts)
      const path = this.extractConstraintPath(expr.expr);
      if (path) {
        for (const comparisonType of expr.comparisonTypesAnd) {
          constraints.addPath(path, {
            kind: "union",
            operation: expr.invertCheck ? "isNot" : "is",
            typeDef: this.getTypeUse(comparisonType).type,
          });
        }
      }

      // Legacy: also add symbol-based constraint for backward compatibility
      if (unionExpr.variant === Semantic.ENode.SymbolValueExpr) {
        for (const comparisonType of expr.comparisonTypesAnd) {
          constraints.add({
            constraintValue: {
              kind: "union",
              operation: expr.invertCheck ? "isNot" : "is",
              typeDef: this.getTypeUse(comparisonType).type,
            },
            variableSymbol: unionExpr.symbol,
          });
        }
      }
    }

    // Boolean context narrowing: if (expr) where expr is union with null/none
    if (exprTypeDef.variant === Semantic.ENode.UntaggedUnionDatatype) {
      const memberDefs = exprTypeDef.members.map((m) => this.sr.typeUseNodes.get(m).type);
      const path = this.extractConstraintPath(exprId);

      if (path) {
        if (memberDefs.includes(this.sr.b.nullTypeDef())) {
          constraints.addPath(path, {
            kind: "union",
            operation: "isNot",
            typeDef: this.sr.b.nullTypeDef(),
          });
        }
        if (memberDefs.includes(this.sr.b.noneTypeDef())) {
          constraints.addPath(path, {
            kind: "union",
            operation: "isNot",
            typeDef: this.sr.b.noneTypeDef(),
          });
        }
      }

      // Legacy: keep symbol-based constraints for backward compatibility
      if (expr.variant === Semantic.ENode.SymbolValueExpr) {
        if (memberDefs.includes(this.sr.b.nullTypeDef())) {
          constraints.add({
            constraintValue: {
              kind: "union",
              operation: "isNot",
              typeDef: this.sr.b.nullTypeDef(),
            },
            variableSymbol: expr.symbol,
          });
        }
        if (memberDefs.includes(this.sr.b.noneTypeDef())) {
          constraints.add({
            constraintValue: {
              kind: "union",
              operation: "isNot",
              typeDef: this.sr.b.noneTypeDef(),
            },
            variableSymbol: expr.symbol,
          });
        }
      }
    }

    if (
      expr.variant === Semantic.ENode.SymbolValueExpr &&
      exprTypeDef.variant === Semantic.ENode.TaggedUnionDatatype
    ) {
      const okTag = exprTypeDef.members.find((m) => m.tag === "Ok");
      const errTag = exprTypeDef.members.find((m) => m.tag === "Err");
      if (okTag && errTag) {
        const path = this.extractConstraintPath(exprId);
        if (path) {
          constraints.addPath(path, {
            kind: "union",
            operation: "is",
            typeDef: this.sr.typeUseNodes.get(okTag.type).type,
          });
        }
        // Legacy
        constraints.add({
          constraintValue: {
            kind: "union",
            operation: "is",
            typeDef: this.sr.typeUseNodes.get(okTag.type).type,
          },
          variableSymbol: expr.symbol,
        });
      }
    }
  }

  structInstantiation(structInst: Collect.AggregateLiteralExpr, inference: Semantic.Inference) {
    let structId = undefined as Semantic.TypeUseId | undefined;
    if (structInst.structType) {
      structId = this.withContext(
        {
          context: Semantic.isolateElaborationContext(this.currentContext, {
            currentScope: this.currentContext.currentScope,
            genericsScope: this.currentContext.currentScope,
            constraints: this.currentContext.constraints,
            instanceDeps: {
              instanceDependsOn: new Map(),
              structMembersDependOn: new Map(),
              symbolDependsOn: new Map(),
            },
          }),
          inAttemptExpr: null,
          inFunction: null,
        },
        () => this.lookupAndElaborateDatatype(structInst.structType!),
      );
    } else if (inference?.gonnaInstantiateStructWithType) {
      structId = inference?.gonnaInstantiateStructWithType;
    }

    if (!structId) {
      throw new CompilerError(
        `This struct is anonymous and must be type-inferred, but there is not enough context to infer it. Either it is not directly passed to something that expects a specific type, or it is being passed to an overloaded function.`,
        structInst.sourceloc,
      );
    }

    const struct = this.sr.typeDefNodes.get(this.sr.typeUseNodes.get(structId).type);
    if (struct.variant === Semantic.ENode.StructDatatype) {
      return this.makeStructLiteral(
        structId,
        structInst.elements,
        structInst.allocator ? this.expr(structInst.allocator, undefined)[1] : null,
        structInst.sourceloc,
        inference,
      );
    }

    if (struct.variant === Semantic.ENode.UntaggedUnionDatatype) {
      if (struct.members.length === 2) {
        const a = struct.members[0];
        const b = struct.members[1];
        const aUse = this.sr.typeUseNodes.get(a);
        const bUse = this.sr.typeUseNodes.get(b);

        if (Conversion.isStruct(this.sr, aUse.type) && Conversion.isNoneById(this.sr, b)) {
          return this.makeStructLiteral(
            a,
            structInst.elements,
            structInst.allocator ? this.expr(structInst.allocator, undefined)[1] : null,
            structInst.sourceloc,
            inference,
          );
        } else if (Conversion.isStruct(this.sr, bUse.type) && Conversion.isNoneById(this.sr, a)) {
          return this.makeStructLiteral(
            b,
            structInst.elements,
            structInst.allocator ? this.expr(structInst.allocator, undefined)[1] : null,
            structInst.sourceloc,
            inference,
          );
        }
      }
    }

    if (
      struct.variant === Semantic.ENode.FixedArrayDatatype ||
      struct.variant === Semantic.ENode.DynamicArrayDatatype
    ) {
      return this.makeArrayLiteral(
        structId,
        structInst.elements,
        structInst.allocator ? this.expr(structInst.allocator, undefined)[1] : null,
        structInst.sourceloc,
        inference,
      );
    }

    throw new CompilerError(
      `Type '${Semantic.serializeTypeUse(
        this.sr,
        structId,
      )}' is not a valid type for an aggregate literal`,
      structInst.sourceloc,
    );
  }

  symbolValue(
    symbolValue: Collect.SymbolValueExpr,
    inference: Semantic.Inference,
  ): [Semantic.Expression, Semantic.ExprId] {
    if (symbolValue.name === "null") {
      return this.sr.b.literalValue(
        {
          type: EPrimitive.null,
        },
        symbolValue.sourceloc,
      );
    }
    if (symbolValue.name === "none") {
      return this.sr.b.literalValue(
        {
          type: EPrimitive.none,
        },
        symbolValue.sourceloc,
      );
    }

    const primitive = stringToPrimitive(symbolValue.name);
    if (primitive) {
      if (symbolValue.genericArgs.length > 0) {
        throw new CompilerError(`Type ${symbolValue.name} is not generic`, symbolValue.sourceloc);
      }
      return this.sr.b.datatypeUseAsValue(
        this.sr.b.primitiveType(primitive, symbolValue.sourceloc),
        symbolValue.sourceloc,
      );
    }

    let foundResult = Semantic.lookupSymbol(this.sr, symbolValue.name, {
      startLookupInScope: this.currentContext.currentScope,
      sourceloc: symbolValue.sourceloc,
    });

    if (foundResult.type === "semantic") {
      const found = this.sr.exprNodes.get(foundResult.id);
      if (found.variant === Semantic.ENode.SymbolValueExpr) {
        const variable = this.sr.symbolNodes.get(found.symbol);
        if (
          variable.variant === Semantic.ENode.VariableSymbol &&
          variable.comptime &&
          variable.comptimeValue
        ) {
          return [this.sr.exprNodes.get(variable.comptimeValue), variable.comptimeValue];
        }
      }
      return [this.sr.exprNodes.get(foundResult.id), foundResult.id];
    }

    let symbolId = foundResult.id;
    let symbol = this.sr.cc.symbolNodes.get(symbolId);

    if (
      symbol.variant === Collect.ENode.TypeDefSymbol &&
      this.sr.cc.typeDefNodes.get(symbol.typeDef).variant === Collect.ENode.TypeDefAlias
    ) {
      const alias = this.sr.cc.typeDefNodes.get(symbol.typeDef);
      assert(alias.variant === Collect.ENode.TypeDefAlias);

      const generics = symbolValue.genericArgs.map((g) => {
        return this.withContext(
          {
            context: this.currentContext,
            inAttemptExpr: null,
            inFunction: null,
          },
          () => this.expressionAsGenericArg(g),
        );
      });

      if (alias.generics.length !== generics.length) {
        throw new CompilerError(
          `Type ${alias.name} expects ${alias.generics.length} type parameters but got ${generics.length}`,
          alias.sourceloc,
        );
      }
      let context = Semantic.isolateElaborationContext(this.currentContext, {
        currentScope: alias.genericScope,
        genericsScope: symbol.inScope,
        constraints: this.currentContext.constraints,
        instanceDeps: {
          instanceDependsOn: new Map(),
          structMembersDependOn: new Map(),
          symbolDependsOn: new Map(),
        },
      });

      if (alias.generics.length !== 0) {
        assert(alias.genericScope);
        context = Semantic.isolateElaborationContext(context, {
          currentScope: alias.genericScope,
          genericsScope: context.currentScope,
          constraints: context.constraints,
          instanceDeps: {
            instanceDependsOn: new Map(),
            structMembersDependOn: new Map(),
            symbolDependsOn: new Map(),
          },
        });
        for (let i = 0; i < alias.generics.length; i++) {
          context.substitute.set(alias.generics[i], generics[i]);
        }
      }

      const newId = this.withContext(
        {
          context: context,
          inFunction: this.inFunction,
          inAttemptExpr: this.inAttemptExpr,
        },
        () => {
          return this.lookupAndElaborateDatatype(
            (this.sr.cc.typeDefNodes.get(symbol.typeDef) as Collect.TypeDefAlias).target,
          );
        },
      );

      const result = this.sr.b.datatypeUseAsValue(newId, symbolValue.sourceloc);
      return result;
    }

    if (symbol.variant === Collect.ENode.VariableSymbol) {
      if (symbolValue.genericArgs.length !== 0) {
        throw new CompilerError(
          `A variable access cannot have a type parameter list`,
          symbolValue.sourceloc,
        );
      }
      let elaboratedSymbolId = undefined as Semantic.SymbolId | undefined;
      if (symbol.variableContext === EVariableContext.Global) {
        // In case it's not elaborated yet, may happen
        this.topLevelSymbol(symbolId);
        elaboratedSymbolId = this.sr.elaboratedGlobalVariableSymbols.get(symbolId);
      } else {
        elaboratedSymbolId = this.currentContext.elaboratedVariables.get(symbolId);
      }
      assert(elaboratedSymbolId, "Variable was not elaborated here: " + symbol.name);
      const elaboratedSymbol = this.sr.symbolNodes.get(elaboratedSymbolId);
      if (elaboratedSymbol.variant === Semantic.ENode.VariableSymbol) {
        // assert(elaboratedSymbol.type);
        if (!elaboratedSymbol.type) {
          throw new CompilerError(
            `Symbol '${elaboratedSymbol.name}' cannot be used before it's declared`,
            symbolValue.sourceloc,
          );
        }
        if (elaboratedSymbol.comptime && elaboratedSymbol.comptimeValue) {
          return [
            this.sr.exprNodes.get(elaboratedSymbol.comptimeValue),
            elaboratedSymbol.comptimeValue,
          ];
        }

        const [symbolValueExpr, symbolValueExprId] = this.sr.b.symbolValue(
          elaboratedSymbolId,
          symbolValue.sourceloc,
        );

        const type = this.sr.typeDefNodes.get(this.sr.typeUseNodes.get(elaboratedSymbol.type).type);
        if (
          type.variant === Semantic.ENode.UntaggedUnionDatatype ||
          type.variant === Semantic.ENode.TaggedUnionDatatype
        ) {
          const members =
            type.variant === Semantic.ENode.UntaggedUnionDatatype
              ? type.members
              : type.members.map((m) => m.type);

          const narrowing = Conversion.typeNarrowing(this.sr);
          narrowing.addVariants(members);
          narrowing.constrainFromConstraints(this.currentContext.constraints, symbolValueExprId);

          assert(narrowing.possibleVariants.size <= members.length);
          if (narrowing.possibleVariants.size === 1) {
            // Only one value remains: Union to Value
            const tag = members.findIndex((m) => m === [...narrowing.possibleVariants][0]);
            assert(tag !== -1);

            const [result, resultId] = this.sr.b.addExpr(this.sr, {
              variant: Semantic.ENode.UnionToValueCastExpr,
              instanceIds: [],
              expr: symbolValueExprId,
              tag: tag,
              isTemporary: false,
              canBeUnwrappedForLHS: true,
              sourceloc: symbolValue.sourceloc,
              type: [...narrowing.possibleVariants][0],
              flow: symbolValueExpr.flow,
              writes: symbolValueExpr.writes,
            });
            return [result, resultId] as const;
          } else if (narrowing.possibleVariants.size !== members.length) {
            // If multiple values remain but they are not equal: Union to Union (e.g. A | B | null to A | B)

            // We do not need type checking since the source is the same union and narrowing can only remove members
            // Not like in Conversion, there we actually need it
            const newUnion = this.sr.b.untaggedUnionTypeUse(
              [...narrowing.possibleVariants],
              symbolValue.sourceloc,
            );

            return this.sr.b.addExpr(this.sr, {
              variant: Semantic.ENode.UnionToUnionCastExpr,
              instanceIds: [],
              expr: symbolValueExprId,
              castComesFromNarrowingAndMayBeUnwrapped: true,
              isTemporary: false,
              sourceloc: symbolValue.sourceloc,
              type: newUnion,
              flow: symbolValueExpr.flow,
              writes: symbolValueExpr.writes,
            });
          }
        }

        return [symbolValueExpr, symbolValueExprId] as const;
      } else if (
        elaboratedSymbol.variant === Semantic.ENode.TypeDefSymbol &&
        this.sr.typeDefNodes.get(elaboratedSymbol.datatype).variant ===
          Semantic.ENode.ParameterPackDatatype
      ) {
        return this.sr.b.symbolValue(elaboratedSymbolId, symbolValue.sourceloc);
      } else {
        assert(false);
      }
    } else if (symbol.variant === Collect.ENode.FunctionOverloadGroupSymbol) {
      const chosenOverloadId = this.FunctionOverloadChoose(
        symbolId,
        inference?.gonnaCallFunctionWithParameterValues,
        symbolValue.sourceloc,
      );

      const chosenOverload = this.sr.cc.symbolNodes.get(chosenOverloadId);
      assert(chosenOverload.variant === Collect.ENode.FunctionSymbol);

      if (chosenOverload.methodType === EMethodType.Method) {
        throw new CompilerError(
          `Function '${chosenOverload.name}' was accessed directly by name, but it is a method, which must be accessed through 'this.${chosenOverload.name}'`,
          symbolValue.sourceloc,
        );
      }

      const parameterPackTypes = this.prepareParameterPackTypes(
        symbol.name,
        chosenOverload.parameters,
        inference?.gonnaCallFunctionWithParameterValues,
        symbolValue.sourceloc,
      );

      const elaboratedSymbolId = this.elaborateFunctionSymbolWithGenerics(
        this.elaborateFunctionSignature(chosenOverloadId),
        symbolValue.genericArgs.map((g) => this.expressionAsGenericArg(g)),
        symbolValue.sourceloc,
        parameterPackTypes,
      );
      assert(elaboratedSymbolId);
      const elaboratedSymbol = this.sr.symbolNodes.get(elaboratedSymbolId);
      assert(elaboratedSymbol.variant === Semantic.ENode.FunctionSymbol);

      const elaboratedFunctionType = this.sr.typeDefNodes.get(elaboratedSymbol.type);
      if (elaboratedFunctionType.variant === Semantic.ENode.DeferredFunctionDatatype) {
        throw new CompilerError(
          `This function is not fully elaborated yet. If it is part of a recursive call chain, it requires an explicit return type and a " :: final" annotation.`,
          symbolValue.sourceloc,
        );
      }

      return this.sr.b.symbolValue(elaboratedSymbolId, symbolValue.sourceloc);
    } else if (symbol.variant === Collect.ENode.TypeDefSymbol) {
      const typedef = this.sr.cc.typeDefNodes.get(symbol.typeDef);
      if (typedef.variant === Collect.ENode.NamespaceTypeDef) {
        // This is for static function calls like Arena.create(); -> "Arena" is now a NamespaceValue
        const [elaboratedSymbolId] = this.topLevelSymbol(symbolId);
        assert(elaboratedSymbolId);
        const elaboratedSymbol = this.sr.symbolNodes.get(elaboratedSymbolId);
        assert(elaboratedSymbol.variant === Semantic.ENode.TypeDefSymbol);
        const type = this.sr.typeDefNodes.get(elaboratedSymbol.datatype);
        assert(
          type.variant === Semantic.ENode.NamespaceDatatype ||
            type.variant === Semantic.ENode.StructDatatype,
        );
        return this.sr.b.datatypeDefAsValue(elaboratedSymbol.datatype, symbolValue.sourceloc);
      } else if (typedef.variant === Collect.ENode.StructTypeDef) {
        // This is for static function calls like Arena.create(); -> "Arena" is now a NamespaceValue
        const genericArgs = symbolValue.genericArgs.map((g) => this.expressionAsGenericArg(g));
        const elaboratedSymbolId = this.instantiateAndElaborateStructWithGenerics(
          symbol.typeDef,
          genericArgs,
          symbolValue.sourceloc,
        );
        assert(elaboratedSymbolId);
        const elaboratedSymbol = this.sr.typeDefNodes.get(elaboratedSymbolId);
        assert(
          elaboratedSymbol.variant === Semantic.ENode.NamespaceDatatype ||
            elaboratedSymbol.variant === Semantic.ENode.StructDatatype,
        );
        return this.sr.b.datatypeDefAsValue(elaboratedSymbolId, symbolValue.sourceloc);
      } else if (typedef.variant === Collect.ENode.EnumTypeDef) {
        return this.sr.b.datatypeDefAsValue(this.enum(symbol.typeDef), symbolValue.sourceloc);
      }
    } else if (symbol.variant === Collect.ENode.GenericTypeParameterSymbol) {
      const mappedToId = this.currentContext.substitute.get(symbolId);
      if (mappedToId) {
        const mappedTo = this.sr.exprNodes.get(mappedToId);
        if (mappedTo.variant === Semantic.ENode.DatatypeAsValueExpr) {
          return [mappedTo, mappedToId];
        } else if (mappedTo.variant === Semantic.ENode.LiteralExpr) {
          return [mappedTo, mappedToId];
        } else {
          assert(false);
        }
      } else {
        const genericId = this.sr.b.addType(this.sr, {
          variant: Semantic.ENode.GenericParameterDatatype,
          name: symbol.name,
          collectedParameter: symbolId,
          concrete: false,
        })[1];
        return this.sr.b.datatypeDefAsValue(genericId, symbolValue.sourceloc);
      }
    }
    throw new CompilerError(
      `Symbol cannot be used as a value: Code ${symbol.variant}`,
      symbolValue.sourceloc,
    );
  }

  errorPropagationExpr(errPropExpr: Collect.ErrorPropagationExpr, inference: Semantic.Inference) {
    const [rightExpr, rightExprId] = this.expr(errPropExpr.expr, inference);

    const typeUse = this.sr.typeUseNodes.get(rightExpr.type);
    const typeDef = this.sr.typeDefNodes.get(typeUse.type);

    if (typeDef.variant !== Semantic.ENode.TaggedUnionDatatype) {
      throw new CompilerError(
        `The '?!' error propagation operator can only be used on expressions with a tagged union type`,
        errPropExpr.sourceloc,
      );
    }

    const srcOkTag = typeDef.members.find((m) => m.tag === "Ok");
    const srcErrTag = typeDef.members.find((m) => m.tag === "Err");

    if (!srcOkTag || !srcErrTag) {
      throw new CompilerError(
        `The '?!' error propagation operator can only be used on tagged union types that provide both a Ok and a Err tag.`,
        errPropExpr.sourceloc,
      );
    }

    const srcOkIndex = typeDef.members.findIndex((m) => m.tag === "Ok");
    const srcErrIndex = typeDef.members.findIndex((m) => m.tag === "Err");

    if (this.inAttemptExpr) {
      // short circuit and build an expr for lowering instead of rewriting to a return statement
      const expr = this.sr.exprNodes.get(this.inAttemptExpr);
      assert(expr.variant === Semantic.ENode.AttemptExpr);
      expr.errorTypesCaught.add(srcErrTag.type);

      return this.sr.b.addExpr(this.sr, {
        variant: Semantic.ENode.AttemptErrorPropagationExpr,
        expr: rightExprId,
        srcErrTagIndex: srcErrIndex,
        srcErrTagType: srcErrTag.type,
        srcOkTagIndex: srcOkIndex,
        srcOkTagType: srcOkTag.type,
        instanceIds: [],
        isTemporary: true,
        sourceloc: errPropExpr.sourceloc,
        toAttemptExpr: this.inAttemptExpr,
        type: srcOkTag.type,
        flow: Semantic.FlowResult.fallthrough()
          .with(Semantic.FlowType.Raise)
          .withAll(rightExpr.flow),
        writes: Semantic.WriteResult.empty().withAll(rightExpr.writes),
      });
    }

    assert(this.inFunction);
    const functionSymbol = this.sr.symbolNodes.get(this.inFunction);
    assert(functionSymbol.variant === Semantic.ENode.FunctionSymbol);
    const functionType = this.sr.typeDefNodes.get(functionSymbol.type);
    assert(
      functionType.variant === Semantic.ENode.FunctionDatatype ||
        functionType.variant === Semantic.ENode.DeferredFunctionDatatype,
    );

    const [tempVariable, tempVariableId] = this.sr.b.addSymbol(this.sr, {
      variant: Semantic.ENode.VariableSymbol,
      comptime: false,
      comptimeValue: null,
      concrete: false,
      export: false,
      extern: EExternLanguage.None,
      memberOfStruct: null,
      mutability: EVariableMutability.Default,
      name: makeTempName(),
      sourceloc: errPropExpr.sourceloc,
      parentStructOrNS: null,
      type: rightExpr.type,
      consumed: false,
      variableContext: EVariableContext.FunctionLocal,
    });

    const returnResult = () => {
      const errValue = this.sr.b.addExpr(this.sr, {
        variant: Semantic.ENode.UnionToValueCastExpr,
        expr: symbolValue(),
        instanceIds: [],
        sourceloc: errPropExpr.sourceloc,
        isTemporary: true,
        canBeUnwrappedForLHS: false,
        tag: srcErrIndex,
        type: srcErrTag.type,
        flow: Semantic.FlowResult.fallthrough(),
        writes: Semantic.WriteResult.empty(),
      })[1];
      if (functionType.variant === Semantic.ENode.FunctionDatatype) {
        return Conversion.MakeConversionOrThrow(
          this.sr,
          errValue,
          srcErrTag.type,
          ConstraintSet.empty(),
          errPropExpr.sourceloc,
          Conversion.Mode.Implicit,
          false,
        );
      } else {
        return errValue;
      }
    };

    const symbolValue = () =>
      this.sr.b.addExpr(this.sr, {
        variant: Semantic.ENode.SymbolValueExpr,
        instanceIds: [],
        symbol: tempVariableId,
        isTemporary: true,
        sourceloc: errPropExpr.sourceloc,
        type: rightExpr.type,
        flow: Semantic.FlowResult.fallthrough(),
        writes: Semantic.WriteResult.empty(),
      })[1];

    const returnStatement = () => {
      const statementId = this.sr.b.addStatement(this.sr, {
        variant: Semantic.ENode.ReturnStatement,
        expr: returnResult(),
        sourceloc: errPropExpr.sourceloc,
      })[1];
      functionSymbol.returnStatements.add(statementId);
      rightExpr.instanceIds.forEach((id) => functionSymbol.returnsInstanceIds.add(id));
      functionSymbol.returnedDatatypes.add(srcErrTag.type);
      return statementId;
    };

    const blockScopeId = this.sr.b.blockScope(
      [
        this.sr.b.addStatement(this.sr, {
          variant: Semantic.ENode.VariableStatement,
          name: tempVariable.name,
          comptime: false,
          sourceloc: errPropExpr.sourceloc,
          value: rightExprId,
          variableSymbol: tempVariableId,
        })[1],
        this.sr.b.addStatement(this.sr, {
          variant: Semantic.ENode.IfStatement,
          isLetBinding: false,
          condition: this.sr.b.addExpr(this.sr, {
            variant: Semantic.ENode.UnionTagCheckExpr,
            expr: rightExprId,
            instanceIds: [],
            isTemporary: true,
            sourceloc: errPropExpr.sourceloc,
            type: this.sr.b.boolType(),
            invertCheck: false,
            comparisonTypesAnd: [srcErrTag.type],
            flow: rightExpr.flow,
            writes: rightExpr.writes,
          })[1],
          elseIfs: [],
          sourceloc: errPropExpr.sourceloc,
          then: this.sr.b.blockScope(
            [returnStatement()],
            this.sr.b.noneExpr()[1],
            errPropExpr.sourceloc,
          )[1],
        })[1],
      ],
      this.sr.b.addExpr(this.sr, {
        variant: Semantic.ENode.UnionToValueCastExpr,
        expr: symbolValue(),
        instanceIds: [],
        isTemporary: true,
        canBeUnwrappedForLHS: false,
        sourceloc: errPropExpr.sourceloc,
        tag: srcOkIndex,
        type: srcOkTag.type,
        flow: rightExpr.flow,
        writes: rightExpr.writes,
      })[1],
      errPropExpr.sourceloc,
    )[1];

    return this.sr.b.blockScopeExpr(
      blockScopeId,
      Semantic.FlowResult.fallthrough().with(Semantic.FlowType.Return).withAll(rightExpr.flow),
      Semantic.WriteResult.empty().withAll(rightExpr.writes),
    );
  }

  exprIsType(exprIsType: Collect.ExprIsTypeExpr, inference: Semantic.Inference) {
    const comparisonType = this.lookupAndElaborateDatatype(exprIsType.comparisonType);
    const [sourceExpr, sourceExprId] = this.expr(exprIsType.expr, {
      unsafe: inference?.unsafe,
    });

    const sourceExprTypeUse = this.getTypeUse(sourceExpr.type);
    const sourceExprTypeDef = this.getTypeDef(sourceExprTypeUse.type);

    if (
      sourceExprTypeDef.variant === Semantic.ENode.UntaggedUnionDatatype ||
      sourceExprTypeDef.variant === Semantic.ENode.TaggedUnionDatatype
    ) {
      const memberTypes =
        sourceExprTypeDef.variant === Semantic.ENode.UntaggedUnionDatatype
          ? sourceExprTypeDef.members
          : sourceExprTypeDef.members.map((m) => m.type);
      if (!memberTypes.includes(comparisonType)) {
        throw new CompilerError(
          `This comparison is always false, as '${Semantic.serializeTypeUse(
            this.sr,
            comparisonType,
          )}' is not a member of the union '${Semantic.serializeTypeUse(this.sr, sourceExpr.type)}'.`,
          exprIsType.sourceloc,
        );
      }

      return this.sr.b.addExpr(this.sr, {
        variant: Semantic.ENode.UnionTagCheckExpr,
        instanceIds: [],
        expr: sourceExprId,
        type: this.sr.b.boolType(),
        comparisonTypesAnd: [comparisonType],
        sourceloc: exprIsType.sourceloc,
        invertCheck: false,
        isTemporary: true,
        flow: sourceExpr.flow,
        writes: sourceExpr.writes,
      });
    } else {
      // It is not a union, so the 'is' operator is not meaningful to distinguish anything, therefore
      // all other types will result in a compile time true/false constant.
      // Limiting is and making it a compile error would seriously negatively affect how pleasant the operator is to use.
      if (sourceExpr.type === comparisonType) {
        return this.sr.b.literal(true, exprIsType.sourceloc);
      } else {
        return this.sr.b.literal(false, exprIsType.sourceloc);
      }
    }
  }

  arraySubscript(arraySubscript: Collect.ArraySubscriptExpr) {
    if (arraySubscript.indices.length > 1) {
      throw new CompilerError(
        `Multidimensional array subscripting is not implemented yet`,
        arraySubscript.sourceloc,
      );
    }
    const [value, valueId] = this.expr(arraySubscript.expr, undefined);

    const rawIndex = arraySubscript.indices[0];
    if (rawIndex.type === "slice") {
      const indices: {
        start: Semantic.ExprId | null;
        end: Semantic.ExprId | null;
      }[] = [
        {
          end: null,
          start: null,
        },
      ];

      if (rawIndex.start) {
        const [startIndex, startIndexId] = this.expr(rawIndex.start, undefined);
        indices[0].start = startIndexId;
        const startIndexType = this.sr.typeDefNodes.get(
          this.sr.typeUseNodes.get(startIndex.type).type,
        );
        if (
          startIndexType.variant !== Semantic.ENode.PrimitiveDatatype ||
          !Conversion.isInteger(startIndexType.primitive)
        ) {
          throw new CompilerError(
            `Only integers can be used to index arrays`,
            arraySubscript.sourceloc,
          );
        }
      }
      if (rawIndex.end) {
        const [endIndex, endIndexId] = this.expr(rawIndex.end, undefined);
        indices[0].end = endIndexId;
        const endIndexType = this.sr.typeDefNodes.get(this.sr.typeUseNodes.get(endIndex.type).type);
        if (
          endIndexType.variant !== Semantic.ENode.PrimitiveDatatype ||
          !Conversion.isInteger(endIndexType.primitive)
        ) {
          throw new CompilerError(
            `Only integers can be used to index arrays`,
            arraySubscript.sourceloc,
          );
        }
      }

      const valueType = this.sr.typeDefNodes.get(this.sr.typeUseNodes.get(value.type).type);
      if (
        valueType.variant !== Semantic.ENode.FixedArrayDatatype &&
        valueType.variant !== Semantic.ENode.DynamicArrayDatatype
      ) {
        throw new CompilerError(
          `Expression of type ${Semantic.serializeTypeUse(this.sr, value.type)} cannot be subscripted`,
          arraySubscript.sourceloc,
        );
      }

      return this.sr.b.addExpr(this.sr, {
        variant: Semantic.ENode.ArraySliceExpr,
        instanceIds: [],
        expr: valueId,
        indices: indices,
        type: makeDynamicArrayDatatypeAvailable(
          this.sr,
          valueType.datatype,
          EDatatypeMutability.Const,
          false,
          arraySubscript.sourceloc,
        ),
        sourceloc: arraySubscript.sourceloc,
        isTemporary: true,
        flow: value.flow,
        writes: value.writes,
      });
    } else {
      const [index, indexId] = this.expr(rawIndex.value, undefined);
      const indexType = this.sr.typeDefNodes.get(this.sr.typeUseNodes.get(index.type).type);

      const exprTypeUse = this.sr.e.getTypeUse(value.type);
      const exprType = this.sr.e.getTypeDef(exprTypeUse.type);
      const valueType = this.sr.typeDefNodes.get(this.sr.typeUseNodes.get(value.type).type);
      if (
        exprType.variant === Semantic.ENode.FixedArrayDatatype ||
        exprType.variant === Semantic.ENode.DynamicArrayDatatype
      ) {
        if (
          indexType.variant !== Semantic.ENode.PrimitiveDatatype ||
          !Conversion.isInteger(indexType.primitive)
        ) {
          throw new CompilerError(
            `Only integers can be used to index arrays`,
            arraySubscript.sourceloc,
          );
        }

        if (
          valueType.variant !== Semantic.ENode.FixedArrayDatatype &&
          valueType.variant !== Semantic.ENode.DynamicArrayDatatype
        ) {
          throw new CompilerError(
            `Expression of type ${Semantic.serializeTypeUse(this.sr, value.type)} cannot be subscripted`,
            arraySubscript.sourceloc,
          );
        }

        return this.sr.b.addExpr(this.sr, {
          variant: Semantic.ENode.ArraySubscriptExpr,
          instanceIds: [],
          expr: valueId,
          indices: [indexId],
          type: valueType.datatype,
          sourceloc: arraySubscript.sourceloc,
          isTemporary: false,
          flow: value.flow,
          writes: value.writes,
        });
      } else if (
        exprType.variant === Semantic.ENode.PrimitiveDatatype &&
        // ONLY pure Haze strings are allowed, c strings cannot be indexed directly because the length is not known
        // and it cannot be bounds checked. If indexing is required, first convert the c string to a haze string.
        exprType.primitive === EPrimitive.str
      ) {
        if (arraySubscript.indices.length !== 1) {
          throw new CompilerError(
            `Strings cannot be indexed in multiple dimensions`,
            arraySubscript.sourceloc,
          );
        }
        return this.sr.b.addExpr(this.sr, {
          variant: Semantic.ENode.StringSubscriptExpr,
          expr: valueId,
          index: indexId,
          instanceIds: [],
          isTemporary: true,
          sourceloc: arraySubscript.sourceloc,
          type: this.sr.b.u8Type(),
          flow: value.flow,
          writes: value.writes,
        });
      } else if (exprType.variant === Semantic.ENode.StructDatatype) {
        const overloads = new Set<Semantic.SymbolId>();

        for (const mId of exprType.methods) {
          const method = this.sr.e.getSymbol(mId);
          assert(method.variant === Semantic.ENode.FunctionSymbol);

          if (method.overloadedOperator === EOverloadedOperator.Subscript) {
            overloads.add(mId);
          }
        }

        // First try to find exact match
        let exactMatchId = undefined as Semantic.SymbolId | undefined;
        for (const mId of overloads) {
          const method = this.sr.e.getSymbol(mId);
          assert(method.variant === Semantic.ENode.FunctionSymbol);

          const ftype = this.sr.e.getTypeDef(method.type);
          assert(ftype.variant === Semantic.ENode.FunctionDatatype);

          if (ftype.parameters.length !== 2) continue;
          if (
            this.sr.e.getTypeUse(ftype.parameters[1].type).type !==
            this.sr.e.getTypeUse(index.type).type
          ) {
            continue;
          }

          // Exact match found
          if (exactMatchId !== undefined) {
            throw new CompilerError(`Operator access is ambiguous`, value.sourceloc);
          }
          exactMatchId = mId;
        }
        if (exactMatchId) {
          const method = this.sr.e.getSymbol(exactMatchId);
          assert(method.variant === Semantic.ENode.FunctionSymbol);

          const ftype = this.sr.e.getTypeDef(method.type);
          assert(ftype.variant === Semantic.ENode.FunctionDatatype);

          const instanceIds: Semantic.InstanceId[] = [];

          assert(this.inFunction);
          const functionSymbol = this.sr.e.getSymbol(this.inFunction);
          assert(functionSymbol.variant === Semantic.ENode.FunctionSymbol);
          instanceIds.forEach((i) => functionSymbol.createsInstanceIds.add(i));

          return this.sr.b.addExpr(this.sr, {
            variant: Semantic.ENode.ExprCallExpr,
            instanceIds: instanceIds,
            arguments: [indexId],
            calledExpr: this.sr.b.addExpr(this.sr, {
              variant: Semantic.ENode.CallableExpr,
              functionSymbol: exactMatchId,
              instanceIds: [],
              isTemporary: true,
              sourceloc: arraySubscript.sourceloc,
              thisExpr: valueId,
              type: makeTypeUse(
                this.sr,
                this.sr.b.addType(this.sr, {
                  variant: Semantic.ENode.CallableDatatype,
                  thisExprType: value.type,
                  functionType: method.type,
                  concrete: true,
                })[1],
                EDatatypeMutability.Const,
                false,
                arraySubscript.sourceloc,
              )[1],
              flow: value.flow,
              writes: value.writes,
            })[1],
            type: ftype.returnType,
            sourceloc: arraySubscript.sourceloc,
            isTemporary: true,
            flow: value.flow,
            writes: value.writes,
          });
        }

        throw new CompilerError(
          `No exact overloaded operator in type '${Semantic.serializeTypeUse(
            this.sr,
            value.type,
          )}' for index type '${Semantic.serializeTypeUse(this.sr, index.type)}' is available`,
          value.sourceloc,
        );
      } else {
        throw new CompilerError(
          `Expression of type '${Semantic.serializeTypeUse(this.sr, value.type)}' cannot be subscripted`,
          value.sourceloc,
        );
      }
    }
  }

  parenthesisExpr(parenthesisExpr: Collect.ParenthesisExpr, inference: Semantic.Inference) {
    return this.expr(parenthesisExpr.expr, inference);
  }

  explicitCastExpr(
    castExpr: Collect.ExplicitCastExpr,
    inference: Semantic.Inference,
  ): [Semantic.Expression, Semantic.ExprId] {
    const targetType = this.lookupAndElaborateDatatype(castExpr.targetType);
    const castedExpr = this.sr.cc.exprNodes.get(castExpr.expr);
    let innerInference: Semantic.Inference | undefined = undefined;
    if (castedExpr.variant === Collect.ENode.AggregateLiteralExpr) {
      innerInference = {
        gonnaInstantiateStructWithType: targetType,
      };
    } else if (castedExpr.variant === Collect.ENode.ParenthesisExpr) {
      const innerExpr = this.sr.cc.exprNodes.get(castedExpr.expr);
      if (innerExpr.variant === Collect.ENode.AggregateLiteralExpr) {
        innerInference = {
          gonnaInstantiateStructWithType: targetType,
        };
      }
    }

    const result = Conversion.MakeConversionOrThrow(
      this.sr,
      this.expr(castExpr.expr, innerInference)[1],
      targetType,
      this.currentContext.constraints,
      castExpr.sourceloc,
      Conversion.Mode.Explicit,
      inference?.unsafe || false,
    );
    return [this.sr.exprNodes.get(result), result];
  }

  postIncr(postIncr: Collect.PostIncrExpr) {
    const [e, eId] = this.expr(postIncr.expr, undefined);

    const instanceIds: Semantic.InstanceId[] = [];
    const writes = this.sr.b.updateLHSDependencies(eId, instanceIds);

    return this.sr.b.addExpr(this.sr, {
      variant: Semantic.ENode.PostIncrExpr,
      instanceIds: [],
      type: e.type,
      expr: eId,
      operation: postIncr.operation,
      sourceloc: postIncr.sourceloc,
      isTemporary: true,
      flow: e.flow,
      writes: Semantic.WriteResult.empty().withAll(writes),
    });
  }

  preIncr(preIncr: Collect.PreIncrExpr) {
    const [e, eId] = this.expr(preIncr.expr, undefined);

    const instanceIds: Semantic.InstanceId[] = [];
    const writes = this.sr.b.updateLHSDependencies(eId, instanceIds);

    return this.sr.b.addExpr(this.sr, {
      variant: Semantic.ENode.PreIncrExpr,
      instanceIds: instanceIds,
      type: e.type,
      expr: eId,
      operation: preIncr.operation,
      sourceloc: preIncr.sourceloc,
      isTemporary: true,
      flow: e.flow,
      writes: Semantic.WriteResult.empty().withAll(writes),
    });
  }

  blockScopeExpr(blockScopeExpr: Collect.BlockScopeExpr, inference: Semantic.Inference) {
    const { flow, scope, scopeId, writes } = this.withScopes(
      {
        currentScope: blockScopeExpr.scope,
        genericsScope: blockScopeExpr.scope,
      },
      () => {
        return this.makeAndElaborateBlockScope(blockScopeExpr.scope, {
          lastExprIsEmit: true,
          unsafe: inference?.unsafe,
        });
      },
    );

    return this.sr.b.addExpr(this.sr, {
      variant: Semantic.ENode.BlockScopeExpr,
      instanceIds: [],
      block: scopeId,
      flow: flow,
      writes: writes,
      isTemporary: true,
      type: this.sr.exprNodes.get(scope.emittedExpr).type,
      sourceloc: blockScopeExpr.sourceloc,
    });
  }

  ternaryExpr(ternary: Collect.TernaryExpr, inference: Semantic.Inference) {
    const [condition, conditionId] = this.expr(ternary.condition, { unsafe: inference?.unsafe });

    const constraints = ConstraintSet.empty();
    this.buildLogicalConstraintSet(constraints, conditionId);

    let [then, thenId] = this.withAdditionalConstraints(constraints, () =>
      this.expr(ternary.then, inference),
    );
    let [_else, elseId] = this.withAdditionalConstraints(constraints.inverse(), () =>
      this.expr(ternary.else, inference),
    );

    const flow = Semantic.FlowResult.empty();
    flow.addAll(then.flow);
    flow.addAll(_else.flow);

    const writes = Semantic.WriteResult.empty();
    writes.addAll(then.writes);
    writes.addAll(_else.writes);

    const resultTypes: Semantic.TypeUseId[] = [];
    if (then.flow.has(Semantic.FlowType.Fallthrough)) {
      resultTypes.push(then.type);
    }
    if (_else.flow.has(Semantic.FlowType.Fallthrough)) {
      resultTypes.push(_else.type);
    }

    let resultType: Semantic.TypeUseId | undefined = undefined;
    if (resultTypes.length === 0) {
      resultType = this.sr.b.noneType();
    } else {
      resultType = this.sr.b.untaggedUnionTypeUse(resultTypes, ternary.sourceloc);
    }

    if (then.flow.has(Semantic.FlowType.Fallthrough)) {
      thenId = Conversion.MakeConversionOrThrow(
        this.sr,
        thenId,
        resultType,
        this.currentContext.constraints,
        condition.sourceloc,
        Conversion.Mode.Implicit,
        inference?.unsafe || false,
      );
    }
    if (_else.flow.has(Semantic.FlowType.Fallthrough)) {
      elseId = Conversion.MakeConversionOrThrow(
        this.sr,
        elseId,
        resultType,
        this.currentContext.constraints,
        condition.sourceloc,
        Conversion.Mode.Implicit,
        inference?.unsafe || false,
      );
    }

    return this.sr.b.addExpr(this.sr, {
      variant: Semantic.ENode.TernaryExpr,
      condition: Conversion.MakeConversionOrThrow(
        this.sr,
        conditionId,
        this.sr.b.boolType(),
        this.currentContext.constraints,
        condition.sourceloc,
        Conversion.Mode.Implicit,
        inference?.unsafe || false,
      ),
      then: thenId,
      else: elseId,
      flow: flow,
      writes: writes,
      instanceIds: [],
      isTemporary: true,
      sourceloc: ternary.sourceloc,
      type: resultType,
      thenProducesValue: then.flow.has(Semantic.FlowType.Fallthrough),
      elseProducesValue: _else.flow.has(Semantic.FlowType.Fallthrough),
    });
  }

  attemptExpr(attempt: Collect.AttemptExpr, inference: Semantic.Inference) {
    const uniqueId = makeTempId();
    const [attemptExpr, attemptExprId] = this.sr.b.addExpr<Semantic.AttemptExpr>(this.sr, {
      variant: Semantic.ENode.AttemptExpr,
      attemptScopeExpr: -1 as Semantic.ExprId,
      elseScopeExpr: -1 as Semantic.ExprId,
      instanceIds: [],
      attemptScopeReturnsType: null,
      elseScopeReturnsType: null,
      errorTypesCaught: new Set(),
      uniqueId,
      errorLabel: `__attempt_error_label_${uniqueId}`,
      resultLabel: `__attempt_result_label_${uniqueId}`,
      errorResultVarname: `__attempt_error_${uniqueId}`,
      isTemporary: true,
      hasErrorVar: Boolean(attempt.elseVar),
      sourceloc: attempt.sourceloc,
      type: -1 as Semantic.TypeUseId,
      errorUnionType: -1 as Semantic.TypeUseId,
      flow: Semantic.FlowResult.empty(),
      writes: Semantic.WriteResult.empty(),
    });

    // ───────────────────────────────────────────────────────────────────────────
    // Attempt block
    // ───────────────────────────────────────────────────────────────────────────
    const {
      flow: attemptFlow,
      writes: attemptWrites,
      scope: attemptScope,
      scopeId: attemptScopeId,
    } = this.withScopes(
      { currentScope: attempt.attemptScope, genericsScope: attempt.attemptScope },
      () => {
        this.inAttemptExpr = attemptExprId;
        return this.makeAndElaborateBlockScope(attempt.attemptScope, {
          lastExprIsEmit: true,
          unsafe: inference?.unsafe,
        });
      },
    );

    // ───────────────────────────────────────────────────────────────────────────
    // Else block
    // ───────────────────────────────────────────────────────────────────────────
    const errorUnion =
      attemptExpr.errorTypesCaught.size > 0
        ? this.sr.b.untaggedUnionTypeUse([...attemptExpr.errorTypesCaught], attempt.sourceloc)
        : this.sr.b.noneType();

    const elseBlockScope = this.sr.cc.scopeNodes.get(attempt.elseScope);
    assert(elseBlockScope.variant === Collect.ENode.BlockScope);

    let errorVarDefStatement: Collect.VariableDefinitionStatement | null = null;
    if (elseBlockScope.statements.length === 2) {
      const s = this.sr.cc.statementNodes.get(elseBlockScope.statements[0]);
      assert(s.variant === Collect.ENode.VariableDefinitionStatement);
      errorVarDefStatement = s;
    }

    const {
      flow: elseFlow,
      writes: elseWrites,
      scope: elseScope,
      scopeId: elseScopeId,
    } = this.withScopes(
      { currentScope: attempt.elseScope, genericsScope: attempt.elseScope },
      () => {
        if (errorVarDefStatement) {
          this.currentContext.elaborationTypeOverride.set(
            errorVarDefStatement.variableSymbol,
            errorUnion,
          );
        }
        return this.makeAndElaborateBlockScope(attempt.elseScope, {
          lastExprIsEmit: true,
          unsafe: inference?.unsafe,
        });
      },
    );

    // ───────────────────────────────────────────────────────────────────────────
    // FLOW + WRITES
    // ───────────────────────────────────────────────────────────────────────────
    const resultFlow = Semantic.FlowResult.empty();
    resultFlow.addAll(attemptFlow);
    resultFlow.addAll(elseFlow);

    const canFallthrough =
      attemptFlow.has(Semantic.FlowType.Fallthrough) || elseFlow.has(Semantic.FlowType.Fallthrough);

    if (canFallthrough) {
      resultFlow.add(Semantic.FlowType.Fallthrough);
    } else {
      resultFlow.add(Semantic.FlowType.NoReturn);
    }

    const resultWrites = Semantic.WriteResult.empty();
    resultWrites.addAll(attemptWrites);
    resultWrites.addAll(elseWrites);

    attemptExpr.flow = resultFlow;
    attemptExpr.writes = resultWrites;

    // ───────────────────────────────────────────────────────────────────────────
    // RESULT TYPE
    // ───────────────────────────────────────────────────────────────────────────
    const memberSet = new Set<Semantic.TypeUseId>();

    if (attemptFlow.has(Semantic.FlowType.Fallthrough)) {
      attemptExpr.attemptScopeReturnsType = this.sr.exprNodes.get(attemptScope.emittedExpr).type;
      memberSet.add(attemptExpr.attemptScopeReturnsType);
    }

    if (elseFlow.has(Semantic.FlowType.Fallthrough)) {
      attemptExpr.elseScopeReturnsType = this.sr.exprNodes.get(elseScope.emittedExpr).type;
      memberSet.add(attemptExpr.elseScopeReturnsType);
    }

    const resultUnion =
      memberSet.size > 0
        ? this.sr.b.untaggedUnionTypeUse([...memberSet], attempt.sourceloc)
        : this.sr.b.noneType();

    attemptExpr.type = resultUnion;
    attemptExpr.errorUnionType = errorUnion;

    // ───────────────────────────────────────────────────────────────────────────
    // BLOCK EXPRESSIONS
    // ───────────────────────────────────────────────────────────────────────────
    const attemptScopeExprId = this.sr.b.blockScopeExpr(
      attemptScopeId,
      attemptFlow,
      attemptWrites,
    )[1];

    attemptExpr.attemptScopeExpr = attemptExpr.attemptScopeReturnsType
      ? Conversion.MakeConversionOrThrow(
          this.sr,
          attemptScopeExprId,
          resultUnion,
          this.currentContext.constraints,
          attemptScope.sourceloc,
          Conversion.Mode.Implicit,
          false,
        )
      : attemptScopeExprId;

    const elseExprId = this.sr.b.blockScopeExpr(elseScopeId, elseFlow, elseWrites)[1];

    attemptExpr.elseScopeExpr = attemptExpr.elseScopeReturnsType
      ? Conversion.MakeConversionOrThrow(
          this.sr,
          elseExprId,
          resultUnion,
          this.currentContext.constraints,
          elseScope.sourceloc,
          Conversion.Mode.Implicit,
          false,
        )
      : elseExprId;

    // ───────────────────────────────────────────────────────────────────────────
    // ERROR VARIABLE
    // ───────────────────────────────────────────────────────────────────────────
    if (attemptExpr.hasErrorVar) {
      assert(elseScope.statements.length === 1);
      const vardef = this.sr.statementNodes.get(elseScope.statements[0]);
      assert(vardef.variant === Semantic.ENode.VariableStatement);

      vardef.value = this.sr.b.addExpr(this.sr, {
        variant: Semantic.ENode.SymbolValueExpr,
        instanceIds: [],
        isTemporary: false,
        sourceloc: attemptExpr.sourceloc,
        symbol: this.sr.b.variableSymbol(
          attemptExpr.errorResultVarname,
          errorUnion,
          false,
          null,
          EVariableMutability.Let,
          null,
          attemptExpr.sourceloc,
        )[1],
        flow: Semantic.FlowResult.fallthrough(),
        writes: Semantic.WriteResult.empty(),
        type: errorUnion,
      })[1];
    }

    return [attemptExpr, attemptExprId] as const;
  }

  typeLiteral(literal: Collect.TypeLiteralExpr) {
    return this.sr.b.datatypeUseAsValue(
      this.lookupAndElaborateDatatype(literal.datatype),
      literal.sourceloc,
    );
  }

  expressionAsGenericArg(collectExprId: Collect.ExprId) {
    const [expr, exprId] = this.sr.e.expr(collectExprId, undefined);
    if (expr.variant === Semantic.ENode.DatatypeAsValueExpr) {
      return exprId;
    } else if (expr.variant === Semantic.ENode.LiteralExpr) {
      return exprId;
    } else {
      throw new CompilerError(
        `This expression is not suitable as a generic type argument or literal value`,
        expr.sourceloc,
      );
    }
  }

  allocatorTypeDef() {
    const allocatorCollectSymbolId = Semantic.findBuiltinSymbolByName(
      this.sr,
      "hzstd_allocator_t",
      null,
    );
    const allocatorCollectSymbol = this.sr.cc.symbolNodes.get(allocatorCollectSymbolId);
    assert(allocatorCollectSymbol.variant === Collect.ENode.TypeDefSymbol);
    const allocatorSymbolId = this.withContext(
      {
        context: Semantic.makeElaborationContext({
          currentScope: this.sr.cc.moduleScopeId,
          genericsScope: this.sr.cc.moduleScopeId,
          constraints: ConstraintSet.empty(),
        }),
        inAttemptExpr: null,
        inFunction: null,
      },
      () => {
        return this.typeDefSymbol(allocatorCollectSymbol);
      },
    );
    assert(allocatorSymbolId.length === 1);
    const elaboratedAllocatorSymbol = this.sr.symbolNodes.get(allocatorSymbolId[0]);
    assert(elaboratedAllocatorSymbol.variant === Semantic.ENode.TypeDefSymbol);

    return elaboratedAllocatorSymbol.datatype;
  }

  allocatorTypeUse(sourceloc: SourceLoc) {
    return makeTypeUse(
      this.sr,
      this.allocatorTypeDef(),
      EDatatypeMutability.Default,
      true,
      sourceloc,
    );
  }

  private isParameterPackType(typeUseId: Semantic.TypeUseId): boolean {
    const typeUse = this.sr.typeUseNodes.get(typeUseId);
    const typeDef = this.sr.typeDefNodes.get(typeUse.type);
    return typeDef.variant === Semantic.ENode.ParameterPackDatatype;
  }
}

export function printSubstitutionContext(
  sr: Semantic.Context,
  context: Semantic.ElaborationContext,
) {
  console.info(`Substitutions: (${[...context.substitute.values()].length})`);
  for (const [fromId, toId] of context.substitute) {
    printCollectedSymbol(sr.cc, fromId, 0, false);
    console.info(` -> ${Semantic.serializeExpr(sr, toId)}`);
  }
}

function getFromFuncDefCache(
  sr: Semantic.Context,
  symbolId: Collect.SymbolId,
  args: {
    genericArgs: Semantic.ExprId[];
    paramPackTypes: Semantic.TypeUseId[];
    parentStructOrNS: Semantic.TypeDefId | null;
  },
) {
  const entries = sr.elaboratedFuncdefSymbols.get(symbolId);
  if (entries === undefined) return;

  const canonicalizedGenerics = args.genericArgs.map((g) =>
    Semantic.canonicalizeGenericExpr(sr, g),
  );

  for (const entry of entries) {
    if (
      entry.parentStructOrNS === args.parentStructOrNS &&
      entry.canonicalizedGenerics.length === canonicalizedGenerics.length &&
      entry.canonicalizedGenerics.every((g, index) => g === canonicalizedGenerics[index]) &&
      entry.paramPackTypes.length === args.paramPackTypes.length &&
      entry.paramPackTypes.every((g, index) => g === args.paramPackTypes[index])
    ) {
      return entry.result;
    }
  }

  return;
}

function insertIntoFuncDefCache(
  sr: Semantic.Context,
  symbolId: Collect.SymbolId,
  args: {
    genericArgs: Semantic.ExprId[];
    paramPackTypes: Semantic.TypeUseId[];
    substitutionContext: Semantic.ElaborationContext;
    result: Semantic.SymbolId;
    parentStructOrNS: Semantic.TypeDefId | null;
  },
) {
  const canonicalizedGenerics = args.genericArgs.map((g) =>
    Semantic.canonicalizeGenericExpr(sr, g),
  );

  let entries = sr.elaboratedFuncdefSymbols.get(symbolId);
  if (!entries) {
    sr.elaboratedFuncdefSymbols.set(symbolId, []);
    entries = sr.elaboratedFuncdefSymbols.get(symbolId)!;
  }

  entries.push({
    canonicalizedGenerics: canonicalizedGenerics,
    paramPackTypes: args.paramPackTypes,
    parentStructOrNS: args.parentStructOrNS,
    result: args.result,
    substitutionContext: args.substitutionContext,
  });
}

export function getFromStructDefCache(
  sr: Semantic.Context,
  symbolId: Collect.TypeDefId,
  args: {
    genericArgs: Semantic.ExprId[];
    parentStructOrNS: Semantic.TypeDefId | null;
  },
) {
  const entries = sr.elaboratedStructDatatypes.get(symbolId);
  if (entries === undefined) return;

  const canonicalizedGenerics = args.genericArgs.map((g) =>
    Semantic.canonicalizeGenericExpr(sr, g),
  );

  for (const entry of entries) {
    if (
      entry.parentStructOrNS === args.parentStructOrNS &&
      entry.canonicalizedGenerics.length === canonicalizedGenerics.length &&
      entry.canonicalizedGenerics.every((g, index) => g === canonicalizedGenerics[index])
    ) {
      return entry.result;
    }
  }

  return;
}

export function insertIntoStructDefCache(
  sr: Semantic.Context,
  symbolId: Collect.TypeDefId,
  args: {
    genericArgs: Semantic.ExprId[];
    substitutionContext: Semantic.ElaborationContext;
    result: Semantic.TypeDefId;
    resultAsTypeDefSymbol: Semantic.SymbolId;
    parentStructOrNS: Semantic.TypeDefId | null;
  },
) {
  const canonicalizedGenerics = args.genericArgs.map((g) =>
    Semantic.canonicalizeGenericExpr(sr, g),
  );

  let entries = sr.elaboratedStructDatatypes.get(symbolId);
  if (!entries) {
    sr.elaboratedStructDatatypes.set(symbolId, []);
    entries = sr.elaboratedStructDatatypes.get(symbolId)!;
  }

  entries.push({
    canonicalizedGenerics: canonicalizedGenerics,
    parentStructOrNS: args.parentStructOrNS,
    result: args.result,
    substitutionContext: args.substitutionContext,
    resultAsTypeDefSymbol: args.resultAsTypeDefSymbol,
  });
}

export function getFromEnumDefCache(
  sr: Semantic.Context,
  symbolId: Collect.TypeDefId,
  args: {
    parentStructOrNS: Semantic.TypeDefId | null;
  },
) {
  const entries = sr.elaboratedEnumSymbols.get(symbolId);
  if (entries === undefined) return;

  for (const entry of entries) {
    if (entry.parentStructOrNS === args.parentStructOrNS) {
      return entry.result;
    }
  }

  return;
}

export function insertIntoEnumDefCache(
  sr: Semantic.Context,
  symbolId: Collect.TypeDefId,
  args: {
    substitutionContext: Semantic.ElaborationContext;
    result: Semantic.TypeDefId;
    resultAsTypeDefSymbol: Semantic.SymbolId;
    parentStructOrNS: Semantic.TypeDefId | null;
  },
) {
  let entries = sr.elaboratedEnumSymbols.get(symbolId);
  if (!entries) {
    sr.elaboratedEnumSymbols.set(symbolId, []);
    entries = sr.elaboratedEnumSymbols.get(symbolId)!;
  }

  entries.push({
    parentStructOrNS: args.parentStructOrNS,
    result: args.result,
    substitutionContext: args.substitutionContext,
    resultAsTypeDefSymbol: args.resultAsTypeDefSymbol,
  });
}

export function makeRawPrimitiveAvailable(
  sr: Semantic.Context,
  primitive: EPrimitive,
): Semantic.TypeDefId {
  for (const id of sr.elaboratedPrimitiveTypes) {
    const s = sr.typeDefNodes.get(id);
    assert(s.variant === Semantic.ENode.PrimitiveDatatype);
    if (s.primitive === primitive) {
      return id;
    }
  }
  assert(primitive);
  const [_, sId] = sr.b.addType(sr, {
    variant: Semantic.ENode.PrimitiveDatatype,
    primitive: primitive,
    concrete: true,
  });
  sr.elaboratedPrimitiveTypes.push(sId);
  return sId;
}

export function makeVoidType(sr: Semantic.Context) {
  return makePrimitiveAvailable(sr, EPrimitive.void, EDatatypeMutability.Default, null);
}

export function makePrimitiveAvailable(
  sr: Semantic.Context,
  primitive: EPrimitive,
  mutability: EDatatypeMutability,
  sourceloc: SourceLoc,
): Semantic.TypeUseId {
  return makeTypeUse(sr, makeRawPrimitiveAvailable(sr, primitive), mutability, false, sourceloc)[1];
}

export function isTypeExprConcrete(sr: Semantic.Context, id: Semantic.ExprId) {
  const expr = sr.exprNodes.get(id);
  if (
    expr.variant === Semantic.ENode.LiteralExpr ||
    expr.variant === Semantic.ENode.DatatypeAsValueExpr
  ) {
    const typeInstance = sr.typeUseNodes.get(expr.type);
    const symbol = sr.typeDefNodes.get(typeInstance.type);
    assert("concrete" in symbol);
    return symbol.concrete;
  } else {
    assert(false);
  }
}

export function isTypeConcrete(sr: Semantic.Context, id: Semantic.TypeUseId) {
  const typeInstance = sr.typeUseNodes.get(id);
  const symbol = sr.typeDefNodes.get(typeInstance.type);
  assert("concrete" in symbol);
  return symbol.concrete;
}

export function IsExprDecisiveForOverloadResolution(sr: Semantic.Context, exprId: Collect.ExprId) {
  const expr = sr.cc.exprNodes.get(exprId);

  switch (expr.variant) {
    case Collect.ENode.AggregateLiteralExpr: {
      return expr.structType !== null;
    }

    case Collect.ENode.ParenthesisExpr: {
      return IsExprDecisiveForOverloadResolution(sr, expr.expr);
    }

    default:
      return true;
  }
}
