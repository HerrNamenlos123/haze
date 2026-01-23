import { HAZE_STDLIB_NAME, ModuleCompiler } from "../Module";
import {
  EAssignmentOperation,
  EBinaryOperation,
  EExternLanguage,
  EDatatypeMutability,
  EVariableMutability,
  BinaryOperationToString,
  UnaryOperationToString,
  IncrOperationToString,
  EOverloadedOperator,
} from "../shared/AST";
import {
  BrandedArray,
  EMethodType,
  EPrimitive,
  EVariableContext,
  primitiveToString,
  pushBrandedNode,
  stringToPrimitive,
  type NameSet,
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
  type CollectionContext,
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

import { EUnaryOperation, type EIncrOperation } from "../shared/AST";
import { type Brand, type LiteralValue } from "../shared/common";
import { makeTempId, makeTempName } from "../shared/store";

type Inference =
  | undefined
  | {
      gonnaCallFunctionWithParameterValues?: {
        index: number;
        exprId: Semantic.ExprId | null;
      }[];
      gonnaInstantiateStructWithType?: Semantic.TypeUseId;
      unsafe?: boolean;
    };

export class SemanticElaborator {
  currentContext: Semantic.ElaborationContext;
  inFunction: Semantic.SymbolId | null = null;
  inAttemptExpr: Semantic.ExprId | null = null;
  functionReturnsInstanceIds?: Set<Semantic.InstanceId>;

  constructor(
    public sr: SemanticResult,
    currentContext: Semantic.ElaborationContext,
  ) {
    this.currentContext = currentContext;
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

  binaryExpr(binaryExpr: Collect.BinaryExpr, inference: Inference) {
    if (binaryExpr.operation === EBinaryOperation.BoolAnd) {
      let [left, leftId] = this.expr(binaryExpr.left, inference);

      // This builds the constraints that apply to the expr itself, the right part of the AND
      const constraints = [...this.currentContext.constraints];
      this.buildConstraints(constraints, leftId, {});

      let [right, rightId] = [
        undefined as Semantic.Expression | undefined,
        undefined as Semantic.ExprId | undefined,
      ];
      this.withContext(
        {
          context: Semantic.isolateElaborationContext(this.currentContext, {
            constraints: constraints,
            currentScope: this.currentContext.currentScope,
            genericsScope: this.currentContext.genericsScope,
            instanceDeps: this.currentContext.instanceDeps,
          }),
          functionReturnsInstanceIds: this.functionReturnsInstanceIds,
          inFunction: this.inFunction,
          inAttemptExpr: this.inAttemptExpr,
        },
        () => {
          [right, rightId] = this.expr(binaryExpr.right, inference);
        },
      );
      assert(right);
      assert(rightId);
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
      let [right, rightId] = this.expr(binaryExpr.right, inference);
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
    } else if (
      binaryExpr.operation === EBinaryOperation.Equal ||
      binaryExpr.operation === EBinaryOperation.Unequal
    ) {
      let left = this.expr(binaryExpr.left, inference)[0];
      let right = this.expr(binaryExpr.right, inference)[0];
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

    let [left, leftId] = this.expr(binaryExpr.left, inference);
    let [right, rightId] = this.expr(binaryExpr.right, inference);
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
    inference: Inference,
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
        this.sr.b.sizeof(this.expr(callExpr.arguments[0], undefined)[1]);
      }
      if (collectedExpr.name === "alignof") {
        this.assertNoGenericArgs(collectedExpr, "alignof");
        this.assertParameterN(callExpr, 1, "alignof");
        this.sr.b.alignof(this.expr(callExpr.arguments[0], undefined)[1]);
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
        const value = EvalCTFEBoolean(
          this.sr,
          this.expr(callExpr.arguments[0], undefined)[1],
          callExpr.sourceloc,
        );
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

    const argumentSourcelocs = callExpr.arguments.map((a) => this.sr.cc.exprNodes.get(a).sourceloc);

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
      let [resolvedFunction, resolvedFunctionId] = [
        null as Semantic.FunctionSymbol | null,
        null as Semantic.SymbolId | null,
      ];
      if (calledExpr.variant === Semantic.ENode.SymbolValueExpr) {
        const symbol = this.sr.symbolNodes.get(calledExpr.symbol);
        assert(symbol.variant === Semantic.ENode.FunctionSymbol);
        resolvedFunction = symbol;
        resolvedFunctionId = calledExpr.symbol;
      }

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

      // This is the handling for noreturn_if assertions like assert()
      if (resolvedFunction && resolvedFunctionId && calledExprType.requires.noreturnIf) {
        const noReturnIf = calledExprType.requires.noreturnIf;
        let [e, eId] = [this.sr.cc.exprNodes.get(noReturnIf.expr), noReturnIf.expr];

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
          const paramIndex = resolvedFunction.parameterNames.findIndex((p) => p === name);
          if (paramIndex === -1) {
            throw new CompilerError(
              `The condition accesses a symbol ('${name}') which is not a parameter of the function. For now, only parameters may be accessed in conditions.`,
              e.sourceloc,
            );
          }

          assert(paramIndex >= 0 && paramIndex < actualArgs.length);
          const passedArgId = actualArgs[paramIndex];

          assert(paramIndex >= 0 && paramIndex < calledExprType.parameters.length);
          const param = calledExprType.parameters[paramIndex];
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

          const result = EvalCTFE(this.sr, passedArgId);
          if (result.ok) {
            if (
              result.value[0].variant === Semantic.ENode.LiteralExpr &&
              result.value[0].literal.type === EPrimitive.bool
            ) {
              // The condition is already known at compile time, skip the condition
              // This is where assert(false) turns into noreturn
              // If condition is true, just ignore all constraints
              if (!result.value[0].literal.value) {
                this.currentContext.scopeNoFallthrough.add(this.currentContext.currentScope);
                if (!this.currentContext.scopeCanExitEarly.has(this.currentContext.currentScope)) {
                  this.currentContext.scopeNoReturn.add(this.currentContext.currentScope);
                }
              }
            }
          } else {
            // The condition is not known at compile time, build normal constraints

            // This is the actual point where constraints like assert() are applied to the remaining scope
            this.buildConstraints(this.currentContext.constraints, passedArgId, {
              inverse: !negateCondition,
            });
          }
        }
      }

      // This is the handling for if -> noreturn
      if (calledExprType.requires.noreturn) {
        this.currentContext.scopeNoFallthrough.add(this.currentContext.currentScope);
        if (!this.currentContext.scopeCanExitEarly.has(this.currentContext.currentScope)) {
          this.currentContext.scopeNoReturn.add(this.currentContext.currentScope);
        }
      }

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

      let elaboratedStructCache = null as StructDef | null;
      for (const [key, cache] of this.sr.elaboratedStructDatatypes) {
        for (const entry of cache) {
          if (entry.result === calledExprTypeUse.type) {
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
        () =>
          this.elaborateFunctionSymbolWithGenerics(
            this.elaborateFunctionSignature(constructorId),
            [],
            callExpr.sourceloc,
            parameterPackTypes,
          ),
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

      return Semantic.addExpr(this.sr, {
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
    inference: Inference,
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
          return Semantic.addExpr(this.sr, {
            variant: Semantic.ENode.UnionTagCheckExpr,
            expr: eId,
            instanceIds: [],
            comparisonTypesAnd: [errTag.type],
            invertCheck: false,
            isTemporary: true,
            sourceloc: e.sourceloc,
            type: this.sr.b.boolType(),
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

  literalExpr(literalExpr: Collect.LiteralExpr, inference: Inference) {
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
    inference: Inference,
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

    const [enumType, enumTypeId] = Semantic.addType<Semantic.EnumDatatypeDef>(this.sr, {
      variant: Semantic.ENode.EnumDatatype,
      concrete: true,
      extern: enumValue.extern,
      name: enumValue.name,
      noemit: enumValue.noemit,
      originalCollectedSymbol: enumId,
      parentStructOrNS: parentNamespace,
      sourceloc: enumValue.sourceloc,
      export: enumValue.export,
      values: [],
      type: -1 as Semantic.TypeUseId,
    });
    const [enumSymbol, enumSymbolId] = this.sr.b.typeDefSymbol(enumTypeId);

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
        const [valueResult, valueResultId] = EvalCTFEOrFail(
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
        const usedValues = new Set<bigint>();
        for (const value of enumValue.values) {
          if (value.value) {
            const [valueResult, valueResultId] = EvalCTFEOrFail(
              this.sr,
              this.expr(value.value, undefined)[1],
              enumValue.values[0].sourceloc,
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
            nextValue = valueResult.literal.value + 1n;

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
                `Multiple fields with value ${valueResult.literal.value} not allowed`,
                value.sourceloc,
              );
            }
            usedValues.add(valueResult.literal.value);
          } else {
            while (usedValues.has(nextValue)) {
              nextValue++;
            }

            const v = nextValue++;
            enumType.values.push({
              name: value.name,
              type: enumDatatypeId,
              valueExpr: this.sr.b.literal(v, value.sourceloc)[1],
              literalExpr: this.sr.b.literalValue(
                {
                  type: "enum",
                  enumType: enumTypeId,
                  valueName: value.name,
                },
                value.sourceloc,
              )[1],
            });

            if (usedValues.has(v)) {
              throw new CompilerError(
                `Multiple fields with value ${v} not allowed`,
                value.sourceloc,
              );
            }
            usedValues.add(v);
          }
        }
      } else {
        const usedValues = new Set<string>();
        for (const value of enumValue.values) {
          if (value.value) {
            const [valueResult, valueResultId] = EvalCTFEOrFail(
              this.sr,
              this.expr(value.value, undefined)[1],
              enumValue.values[0].sourceloc,
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
    inference: Inference,
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

      return Semantic.addExpr(this.sr, {
        variant: Semantic.ENode.CallableExpr,
        functionSymbol: funcId,
        instanceIds: [],
        isTemporary: true,
        sourceloc: memberAccess.sourceloc,
        thisExpr: objectId,
        type: makeTypeUse(
          this.sr,
          Semantic.addType(this.sr, {
            variant: Semantic.ENode.CallableDatatype,
            concrete: true,
            functionType: func.type,
            thisExprType: object.type,
          })[1],
          EDatatypeMutability.Default,
          false,
          memberAccess.sourceloc,
        )[1],
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

        return Semantic.addExpr(this.sr, {
          variant: Semantic.ENode.CallableExpr,
          functionSymbol: funcId,
          instanceIds: [],
          isTemporary: true,
          sourceloc: memberAccess.sourceloc,
          thisExpr: objectId,
          type: makeTypeUse(
            this.sr,
            Semantic.addType(this.sr, {
              variant: Semantic.ENode.CallableDatatype,
              concrete: true,
              functionType: func.type,
              thisExprType: object.type,
            })[1],
            EDatatypeMutability.Default,
            false,
            memberAccess.sourceloc,
          )[1],
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
      if (memberAccess.memberName === "length") {
        return this.sr.b.memberAccessRaw(
          objectId,
          "length",
          this.sr.b.intType(),
          true,
          memberAccess.sourceloc,
        );
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

        return Semantic.addExpr(this.sr, {
          variant: Semantic.ENode.CallableExpr,
          functionSymbol: funcId,
          instanceIds: [],
          isTemporary: true,
          sourceloc: memberAccess.sourceloc,
          thisExpr: objectId,
          type: makeTypeUse(
            this.sr,
            Semantic.addType(this.sr, {
              variant: Semantic.ENode.CallableDatatype,
              concrete: true,
              functionType: func.type,
              thisExprType: object.type,
            })[1],
            EDatatypeMutability.Default,
            false,
            memberAccess.sourceloc,
          )[1],
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

        return Semantic.addExpr(this.sr, {
          variant: Semantic.ENode.CallableExpr,
          functionSymbol: funcId,
          instanceIds: [],
          isTemporary: true,
          sourceloc: memberAccess.sourceloc,
          thisExpr: objectId,
          type: makeTypeUse(
            this.sr,
            Semantic.addType(this.sr, {
              variant: Semantic.ENode.CallableDatatype,
              concrete: true,
              functionType: func.type,
              thisExprType: object.type,
            })[1],
            EDatatypeMutability.Default,
            false,
            memberAccess.sourceloc,
          )[1],
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

      return this.sr.b.memberAccess(objectId, memberAccess.memberName, memberAccess.sourceloc);
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
      let elaboratedStructCache = null as StructDef | null;
      for (const [key, cache] of this.sr.elaboratedStructDatatypes) {
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

      return Semantic.addExpr(this.sr, {
        variant: Semantic.ENode.CallableExpr,
        instanceIds: [],
        thisExpr: objectId,
        functionSymbol: elaboratedMethodId,
        type: makeTypeUse(
          this.sr,
          Semantic.addType(this.sr, {
            variant: Semantic.ENode.CallableDatatype,
            thisExprType: object.type,
            // TODO: Fix
            // thisExprType: wasReference
            //   ? object.type
            //   : makeReferenceDatatypeAvailable(
            //       sr,
            //       object.type,
            //       EDatatypeMutability.Const,
            //       expr.sourceloc
            //     ),
            functionType: elaboratedMethod.type,
            concrete: this.sr.typeDefNodes.get(elaboratedMethod.type).concrete,
          })[1],
          EDatatypeMutability.Const,
          false,
          memberAccess.sourceloc,
        )[1],
        sourceloc: memberAccess.sourceloc,
        isTemporary: true,
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
      const [defSym, defSymId] = Semantic.addSymbol(this.sr, {
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
        return [this.sr.b.cInject(symbol.value, symbol.export, symbol.sourceloc)];
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

  instantiateAndElaborateStruct(
    definedStructTypeId: Collect.TypeDefId, // The defining struct datatype to be instantiated (e.g. struct Foo<T> {})
  ) {
    const definedStructType = this.sr.cc.typeDefNodes.get(definedStructTypeId);
    assert(definedStructType.variant === Collect.ENode.StructTypeDef);

    const genericArgs = definedStructType.generics.map((g) => {
      const substitute = this.currentContext.substitute.get(g);
      assert(substitute);
      return substitute;
    });

    const parentStructOrNS = this.elaborateParentSymbolFromCache(definedStructType.parentScope);

    // If already existing, return cached to prevent loops
    const existing = getFromStructDefCache(this.sr, definedStructTypeId, {
      genericArgs: genericArgs,
      parentStructOrNS: parentStructOrNS,
    });
    if (existing) {
      return existing;
    }

    const [struct, structId] = Semantic.addType<Semantic.StructDatatypeDef>(this.sr, {
      variant: Semantic.ENode.StructDatatype,
      name: definedStructType.name,
      generics: genericArgs,
      extern: definedStructType.extern,
      noemit: definedStructType.noemit,
      opaque: definedStructType.opaque,
      plain: definedStructType.plain,
      parentStructOrNS: parentStructOrNS,
      members: [],
      export: definedStructType.export,
      memberDefaultValues: [],
      methods: [],
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
        resultAsTypeDefSymbol: Semantic.addSymbol(this.sr, {
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

      const elaborateMember = (symbol: Collect.VariableSymbol) => {
        assert(symbol.type);
        const typeId = this.withContext(
          {
            context: Semantic.isolateElaborationContext(this.currentContext, {
              // Start lookup in the struct itself, these are members, so both the type and
              // its generics must be found from within the struct
              currentScope: definedStructType.lexicalScope,
              genericsScope: definedStructType.lexicalScope,
              constraints: [],
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
        const typeInstance = this.sr.typeUseNodes.get(typeId);
        const type = this.sr.typeDefNodes.get(typeInstance.type);
        const [variable, variableId] = Semantic.addSymbol(this.sr, {
          variant: Semantic.ENode.VariableSymbol,
          name: symbol.name,
          export: false,
          extern: EExternLanguage.None,
          mutability: EVariableMutability.Default,
          sourceloc: symbol.sourceloc,
          memberOfStruct: structId,
          type: typeId,
          consumed: false,
          variableContext: EVariableContext.MemberOfStruct,
          parentStructOrNS: structId,
          comptime: false,
          comptimeValue: null,
          concrete: type.concrete,
        });
        struct.members.push(variableId);
        const defaultValue = definedStructType.defaultMemberValues.find(
          (v) => v.name === symbol.name,
        );
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
          struct.memberDefaultValues.push({
            memberName: variable.name,
            value: Conversion.MakeConversionOrThrow(
              this.sr,
              defaultExprId,
              typeId,
              [],
              symbol.sourceloc,
              Conversion.Mode.Implicit,
              false,
            ),
          });
        }
      };

      const elaborateMethod = (symbol: Collect.FunctionOverloadGroupSymbol) => {
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
          const funcId = this.elaborateFunctionSymbol(signature, structId, []);
          const func = this.sr.symbolNodes.get(funcId);
          assert(funcId && func && func.variant === Semantic.ENode.FunctionSymbol);
          struct.methods.push(funcId);
        });
      };

      const elaborateTypedef = (symbol: Collect.TypeDefSymbol) => {
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
          struct.nestedStructs.push(subStructId);
        }
      };

      // FIRST elaborate types and members
      [...fieldScope.symbols, ...lexicalScope.symbols].forEach((symbolId) => {
        const symbol = this.sr.cc.symbolNodes.get(symbolId);
        if (symbol.variant === Collect.ENode.VariableSymbol) {
          elaborateMember(symbol);
        } else if (symbol.variant === Collect.ENode.FunctionOverloadGroupSymbol) {
          // Do not do functions yet, they may refer to members
        } else if (symbol.variant === Collect.ENode.TypeDefSymbol) {
          // Do not do typedefs including sub-structs yet, they may refer to members
        } else if (symbol.variant === Collect.ENode.GenericTypeParameterSymbol) {
          // Skip this, don't elaborate, it's only used for resolving and instantiation
        } else {
          assert(false, "unexpected type: " + symbol.variant);
        }
      });

      // NOW elaborate methods (as they may refer to members of the parent)
      [...fieldScope.symbols, ...lexicalScope.symbols].forEach((symbolId) => {
        const symbol = this.sr.cc.symbolNodes.get(symbolId);
        if (symbol.variant === Collect.ENode.VariableSymbol) {
          // already done
        } else if (symbol.variant === Collect.ENode.FunctionOverloadGroupSymbol) {
          elaborateMethod(symbol);
        } else if (symbol.variant === Collect.ENode.TypeDefSymbol) {
          elaborateTypedef(symbol);
        } else if (symbol.variant === Collect.ENode.GenericTypeParameterSymbol) {
          // Skip this, don't elaborate, it's only used for resolving and instantiation
        } else {
          assert(false, "unexpected type: " + symbol.variant);
        }
      });
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
        const [variable, variableId] = Semantic.addSymbol(this.sr, {
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

  elaborateBlockScope(
    args: {
      sourceScopeId: Collect.ScopeId;
      targetScopeId: Semantic.BlockScopeId;
    },
    lastExprIsEmit: boolean,
    inference: Inference,
  ) {
    const scope = this.sr.cc.scopeNodes.get(args.sourceScopeId);
    assert(scope.variant === Collect.ENode.BlockScope);

    const blockScope = this.sr.blockScopeNodes.get(args.targetScopeId);
    assert(blockScope.variant === Semantic.ENode.BlockScope);

    const newContext = Semantic.isolateElaborationContext(this.currentContext, {
      currentScope: args.sourceScopeId,
      genericsScope: args.sourceScopeId,
      constraints: blockScope.constraints,
      instanceDeps: this.currentContext.instanceDeps,
    });

    let noReturn = false;
    let canExitEarly = false;
    let willExitEarly = false;
    let noFallthrough = false;
    this.withContext(
      {
        context: newContext,
        inFunction: this.inFunction,
        functionReturnsInstanceIds: this.functionReturnsInstanceIds,
        inAttemptExpr: this.inAttemptExpr,
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

          const statementId = this.elaborateStatement(sId, {
            gonnaInstantiateStructWithType: gonnaInstantiateStructWithType,
            unsafe: scope.unsafe,
          });
          const statement = this.sr.statementNodes.get(statementId);

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

        // NOTE
        // the noReturn attribute has to be solved via the currentContext Set and not just via returned noReturn flags,
        // because expressions have to set it and we cannot return flags from every expression.
        // It may look weirdly complicated in just this function but it is required because of expressions.
        if (this.currentContext.scopeNoReturn.has(args.sourceScopeId)) {
          noReturn = true;
        }
        if (this.currentContext.scopeCanExitEarly.has(args.sourceScopeId)) {
          canExitEarly = true;
        }
        if (this.currentContext.scopeWillExitEarly.has(args.sourceScopeId)) {
          willExitEarly = true;
        }
        if (this.currentContext.scopeNoFallthrough.has(args.sourceScopeId)) {
          noFallthrough = true;
        }
      },
    );

    if (canExitEarly) {
      this.currentContext.scopeCanExitEarly.add(args.sourceScopeId);
    }
    if (willExitEarly) {
      this.currentContext.scopeWillExitEarly.add(args.sourceScopeId);
    }
    if (noReturn) {
      this.currentContext.scopeNoReturn.add(args.sourceScopeId);
    }
    if (noFallthrough) {
      this.currentContext.scopeNoFallthrough.add(args.sourceScopeId);
    }

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
      noReturn: noReturn,
      canExitEarly: canExitEarly,
      willExitEarly: willExitEarly,
      noFallthrough: noFallthrough,
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

              const [paramPack, paramPackId] = Semantic.addType(this.sr, {
                variant: Semantic.ENode.ParameterPackDatatype,
                parameters: paramPackTypes.map((t, i) => {
                  const [variable, variableId] = Semantic.addSymbol(this.sr, {
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
              const paramPackVariableId = Semantic.addSymbol(this.sr, {
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
              noreturnIf: func.requires.noreturnIf,
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

        let [symbol, symbolId] = Semantic.addSymbol<Semantic.FunctionSymbol>(this.sr, {
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

          let blockScopeResult: {
            willExitEarly: boolean;
            canExitEarly: boolean;
            noReturn: boolean;
            noFallthrough: boolean;
          } | null = null;
          if (func.functionScope) {
            const functionScope = this.sr.cc.scopeNodes.get(func.functionScope);
            assert(functionScope.variant === Collect.ENode.FunctionScope);

            const bodyScopeId = Semantic.addBlockScope<Semantic.BlockScope>(this.sr, {
              variant: Semantic.ENode.BlockScope,
              statements: [],
              emittedExpr: -1 as Semantic.ExprId,
              constraints: [],
              sourceloc: functionScope.sourceloc,
            })[1];

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
              const variableId = Semantic.addSymbol(this.sr, {
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

            symbol.scope = bodyScopeId;
            blockScopeResult = this.withContext(
              {
                context: newContext,
                inFunction: symbolId,
                functionReturnsInstanceIds: symbol.returnsInstanceIds,
                inAttemptExpr: null,
              },
              () => {
                return this.elaborateBlockScope(
                  {
                    sourceScopeId: functionScope.blockScope,
                    targetScopeId: bodyScopeId,
                  },
                  false,
                  undefined,
                );
              },
            );

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
          }

          Semantic.getInstanceDepsGraph(
            symbol.instanceDepsSnapshot,
            symbol.returnsInstanceIds,
          ).forEach((d) => symbol.returnsInstanceIds.add(d));

          // Add "none" as a returned value if nothing is returned
          if (
            blockScopeResult &&
            !blockScopeResult.noFallthrough &&
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
                noreturn: func.requires.noreturn || (blockScopeResult?.noReturn ?? false),
                noreturnIf: func.requires.noreturnIf,
              },
              sourceloc: func.sourceloc,
            });
            const functype = this.sr.typeDefNodes.get(symbol.type);
            assert(functype.variant === Semantic.ENode.FunctionDatatype);

            // Fix returning "none" if nothing is returned but the function returns "none", except it returns 'void'
            if (
              blockScopeResult &&
              !blockScopeResult.noFallthrough &&
              !Conversion.isVoidById(this.sr, functype.returnType)
            ) {
              assert(symbol.scope);
              const bodyScope = this.sr.blockScopeNodes.get(symbol.scope);
              const statementId = Semantic.addStatement(this.sr, {
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
                      [],
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
            Semantic.addType(this.sr, {
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
              Semantic.addType(this.sr, {
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
                        constraints: [],
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
                return aliasedTypeId;
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

  assignmentExpr(assignment: Collect.ExprAssignmentExpr, inference: Inference) {
    const [targetExpr, targetExprId] = this.expr(assignment.expr, inference);
    const [valueExpr, valueExprId] = this.expr(assignment.value, inference);

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

        return Semantic.addExpr(this.sr, {
          variant: Semantic.ENode.ExprCallExpr,
          instanceIds: instanceIds,
          arguments: [valueExprId],
          calledExpr: Semantic.addExpr(this.sr, {
            variant: Semantic.ENode.CallableExpr,
            functionSymbol: exactMatchId,
            instanceIds: [],
            isTemporary: true,
            sourceloc: assignment.sourceloc,
            thisExpr: targetExprId,
            type: makeTypeUse(
              this.sr,
              Semantic.addType(this.sr, {
                variant: Semantic.ENode.CallableDatatype,
                thisExprType: targetExpr.type,
                functionType: method.type,
                concrete: true,
              })[1],
              EDatatypeMutability.Const,
              false,
              assignment.sourceloc,
            )[1],
          })[1],
          type: ftype.returnType,
          sourceloc: assignment.sourceloc,
          isTemporary: true,
        });
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
      return Semantic.addType(this.sr, {
        variant: Semantic.ENode.GenericParameterDatatype,
        name: g.name,
        collectedParameter: gId,
        concrete: false,
      })[1];
    });

    const parent = this.elaborateParentSymbolFromCache(functionSymbol.parentScope);

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

    const cacheCodename =
      (parent ? Semantic.serializeTypeDef(this.sr, parent) + "." : "") + functionSymbol.name;

    const [signature, signatureId] = Semantic.addSymbol(this.sr, {
      variant: Semantic.ENode.FunctionSignature,
      genericPlaceholders: genericPlaceholders,
      originalFunction: functionSymbolId,
      extern: functionSymbol.extern,
      name: functionSymbol.name,
      parentStructOrNS: parent,
      parameters: functionSymbol.parameters.map((p) => {
        const type = this.withContext(
          {
            context: Semantic.isolateElaborationContext(this.currentContext, {
              currentScope: functionSymbol.functionScope || functionSymbol.parentScope,
              genericsScope: functionSymbol.functionScope || functionSymbol.parentScope,
              constraints: [],
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
      }),
      returnType:
        functionSymbol.returnType &&
        this.withContext(
          {
            context: Semantic.isolateElaborationContext(this.currentContext, {
              currentScope: functionSymbol.functionScope || functionSymbol.parentScope,
              genericsScope: functionSymbol.functionScope || functionSymbol.parentScope,
              constraints: [],
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
    inference: Inference,
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

    if (
      symbol.variant === Collect.ENode.TypeDefSymbol &&
      symbol.name === name &&
      this.sr.cc.typeDefNodes.get(symbol.typeDef).variant === Collect.ENode.StructTypeDef
    ) {
      const typedef = this.sr.cc.typeDefNodes.get(symbol.typeDef);
      assert(typedef.variant === Collect.ENode.StructTypeDef);
      // A struct nested in a struct
      const instantiated = this.instantiateAndElaborateStructWithGenerics(
        symbol.typeDef,
        memberAccessExpr.genericArgs.map((g) => this.expressionAsGenericArg(g)),
        memberAccessExpr.sourceloc,
      );
      return this.sr.b.datatypeDefAsValue(instantiated, memberAccessExpr.sourceloc);
    } else if (
      symbol.variant === Collect.ENode.FunctionOverloadGroupSymbol &&
      symbol.name === name
    ) {
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
    } else {
      return undefined;
    }
  }

  lookupAndElaborateNamespaceMemberAccess(
    namespaceValueId: Semantic.ExprId,
    name: string,
    memberAccessExpr: Collect.MemberAccessExpr,
    inference: Inference,
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
    inference: Inference,
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

    let elaboratedStructCache = null as StructDef | null;
    for (const [key, cache] of this.sr.elaboratedStructDatatypes) {
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
    inference: Inference,
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
    inference: Inference,
  ): [Semantic.Expression, Semantic.ExprId] {
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

      const [e, eId] = this.expr(m.value, {
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
    sr: SemanticResult,
    datatypeAsValueExprId: Semantic.ExprId,
    typeUseId: Semantic.TypeUseId,
    memberAccessExpr: Collect.MemberAccessExpr,
    inference: Inference,
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

          return Semantic.addExpr(this.sr, {
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

      return Semantic.addExpr(this.sr, {
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

  elaborateStatement(statementId: Collect.StatementId, inference: Inference): Semantic.StatementId {
    const s = this.sr.cc.statementNodes.get(statementId);

    switch (s.variant) {
      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.InlineCStatement:
        return Semantic.addStatement(this.sr, {
          variant: Semantic.ENode.InlineCStatement,
          value: s.value,
          sourceloc: s.sourceloc,
        })[1];

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.IfStatement: {
        if (s.comptime) {
          if (!s.condition) {
            throw new CompilerError(`Comptime 'if let' statements not supported yet`, s.sourceloc);
          }
          const conditionId = this.expr(s.condition, undefined)[1];
          const conditionValue = EvalCTFEBoolean(this.sr, conditionId, s.sourceloc);
          if (conditionValue) {
            const thenScopeId = Semantic.addBlockScope(this.sr, {
              variant: Semantic.ENode.BlockScope,
              statements: [],
              emittedExpr: -1 as Semantic.ExprId,
              constraints: [...this.currentContext.constraints],
              sourceloc: s.sourceloc,
            })[1];
            const result = this.elaborateBlockScope(
              {
                targetScopeId: thenScopeId,
                sourceScopeId: s.thenBlock,
              },
              false,
              undefined,
            );
            return Semantic.addStatement(this.sr, {
              variant: Semantic.ENode.ExprStatement,
              expr: Semantic.addExpr(this.sr, {
                variant: Semantic.ENode.BlockScopeExpr,
                instanceIds: [],
                block: thenScopeId,
                isTemporary: true,
                noreturn: result.noReturn,
                type: this.sr.b.voidType(),
                sourceloc: s.sourceloc,
              })[1],
              sourceloc: s.sourceloc,
            })[1];
          }

          for (const elif of s.elseif) {
            if (!elif.condition) {
              throw new CompilerError(
                `Comptime 'if let' statements not supported yet`,
                s.sourceloc,
              );
            }
            const conditionId = this.expr(elif.condition, undefined)[1];
            if (EvalCTFEBoolean(this.sr, conditionId, s.sourceloc)) {
              const thenScopeId = Semantic.addBlockScope(this.sr, {
                variant: Semantic.ENode.BlockScope,
                statements: [],
                emittedExpr: -1 as Semantic.ExprId,
                sourceloc: s.sourceloc,
                constraints: [...this.currentContext.constraints],
              })[1];
              const result = this.elaborateBlockScope(
                {
                  targetScopeId: thenScopeId,
                  sourceScopeId: elif.thenBlock,
                },
                false,
                undefined,
              );
              return Semantic.addStatement(this.sr, {
                variant: Semantic.ENode.ExprStatement,
                expr: Semantic.addExpr(this.sr, {
                  variant: Semantic.ENode.BlockScopeExpr,
                  instanceIds: [],
                  block: thenScopeId,
                  isTemporary: true,
                  noreturn: result.noReturn,
                  type: this.sr.b.voidType(),
                  sourceloc: s.sourceloc,
                })[1],
                sourceloc: s.sourceloc,
              })[1];
            }
          }

          if (s.elseBlock) {
            const thenScopeId = Semantic.addBlockScope(this.sr, {
              variant: Semantic.ENode.BlockScope,
              emittedExpr: -1 as Semantic.ExprId,
              sourceloc: s.sourceloc,
              statements: [],
              constraints: [...this.currentContext.constraints],
            })[1];
            const result = this.elaborateBlockScope(
              {
                targetScopeId: thenScopeId,
                sourceScopeId: s.elseBlock,
              },
              false,
              undefined,
            );
            return Semantic.addStatement(this.sr, {
              variant: Semantic.ENode.ExprStatement,
              expr: Semantic.addExpr(this.sr, {
                variant: Semantic.ENode.BlockScopeExpr,
                instanceIds: [],
                block: thenScopeId,
                isTemporary: true,
                noreturn: result.noReturn,
                type: this.sr.b.voidType(),
                sourceloc: s.sourceloc,
              })[1],
              sourceloc: s.sourceloc,
            })[1];
          }

          // Nothing was true, emit empty scope statement
          return Semantic.addStatement(this.sr, {
            variant: Semantic.ENode.ExprStatement,
            expr: Semantic.addExpr(this.sr, {
              variant: Semantic.ENode.BlockScopeExpr,
              instanceIds: [],
              block: Semantic.addBlockScope(this.sr, {
                variant: Semantic.ENode.BlockScope,
                statements: [],
                emittedExpr: this.sr.b.noneExpr()[1],
                constraints: [...this.currentContext.constraints],
                sourceloc: s.sourceloc,
              })[1],
              isTemporary: true,
              noreturn: false,
              type: this.sr.b.voidType(),
              sourceloc: s.sourceloc,
            })[1],
            sourceloc: s.sourceloc,
          })[1];
        } else {
          // Non-comptime
          let resultingConditionId: Semantic.ExprId | null = null;
          const constraints = [...this.currentContext.constraints];
          const elseConstraints = [...this.currentContext.constraints];
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
            const varType = this.expr(letStatement.value, undefined)[0].type;
            const variableSymbolExprId = this.expr(
              Collect.makeExpr(this.sr.cc, {
                variant: Collect.ENode.SymbolValueExpr,
                genericArgs: [],
                name: sym.name,
                sourceloc: s.sourceloc,
              })[1],
              undefined,
            )[1];
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
              this.buildConstraints(constraints, variableAsBoolResult.expr, {});
              this.buildConstraints(elseConstraints, variableAsBoolResult.expr, { inverse: true });
              const conditionFromLet = Semantic.addExpr(this.sr, {
                variant: Semantic.ENode.BlockScopeExpr,
                block: Semantic.addBlockScope(this.sr, {
                  variant: Semantic.ENode.BlockScope,
                  constraints: this.currentContext.constraints,
                  emittedExpr: variableAsBoolResult.expr,
                  statements: [
                    Semantic.addStatement(this.sr, {
                      variant: Semantic.ENode.ExprStatement,
                      expr: Semantic.addExpr(this.sr, {
                        variant: Semantic.ENode.ExprAssignmentExpr,
                        instanceIds: [],
                        isTemporary: true,
                        operation: EAssignmentOperation.Rebind,
                        target: variableSymbolExprId,
                        type: varType,
                        value: this.expr(letStatement.value!, undefined)[1],
                        sourceloc: s.sourceloc,
                      })[1],
                      sourceloc: s.sourceloc,
                    })[1],
                  ],
                  sourceloc: s.sourceloc,
                })[1],
                instanceIds: [],
                noreturn: false,
                isTemporary: true,
                sourceloc: s.sourceloc,
                type: this.sr.b.boolType(),
              })[1];

              if (s.condition) {
                // Variable is convertible to bool and we have guard, combine both
                resultingConditionId = this.withContext(
                  {
                    context: Semantic.isolateElaborationContext(this.currentContext, {
                      constraints: constraints,
                      currentScope: this.currentContext.currentScope,
                      genericsScope: this.currentContext.genericsScope,
                      instanceDeps: this.currentContext.instanceDeps,
                    }),
                    functionReturnsInstanceIds: this.functionReturnsInstanceIds,
                    inFunction: this.inFunction,
                    inAttemptExpr: this.inAttemptExpr,
                  },
                  () =>
                    this.sr.b.binaryExpr(
                      conditionFromLet,
                      Conversion.MakeConversionOrThrow(
                        this.sr,
                        this.expr(s.condition!, undefined)[1],
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
              } else {
                // Variable is convertible to bool but no guard, only use value
                resultingConditionId = conditionFromLet;
              }
            } else {
              if (s.condition) {
                // Variable is NOT convertible to bool but we have a guard, use only guard: Keep as-is
                resultingConditionId = this.expr(s.condition, undefined)[1];
                this.buildConstraints(constraints, resultingConditionId, {});
                this.buildConstraints(elseConstraints, resultingConditionId, { inverse: true });
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
            resultingConditionId = this.expr(s.condition, undefined)[1];
            this.buildConstraints(constraints, resultingConditionId, {});
            this.buildConstraints(elseConstraints, resultingConditionId, { inverse: true });
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

          const thenScopeId = Semantic.addBlockScope(this.sr, {
            variant: Semantic.ENode.BlockScope,
            statements: [],
            emittedExpr: -1 as Semantic.ExprId,
            constraints: constraints,
            sourceloc: s.sourceloc,
          })[1];
          const result = this.withContext(
            {
              context: Semantic.isolateElaborationContext(this.currentContext, {
                constraints: constraints,
                currentScope: this.currentContext.currentScope,
                genericsScope: this.currentContext.genericsScope,
                instanceDeps: this.currentContext.instanceDeps,
              }),
              inFunction: this.inFunction,
              inAttemptExpr: this.inAttemptExpr,
              functionReturnsInstanceIds: this.functionReturnsInstanceIds,
            },
            () => {
              return this.elaborateBlockScope(
                {
                  targetScopeId: thenScopeId,
                  sourceScopeId: s.thenBlock,
                },
                false,
                undefined,
              );
            },
          );

          // If the body of if does not return, then the inverse of the condition applies to the body after the if
          if (result.willExitEarly || result.noReturn) {
            this.buildConstraints(this.currentContext.constraints, resultingConditionId, {
              inverse: true,
            });
          }

          let noFallthrough = result.noFallthrough;
          if (result.canExitEarly || result.willExitEarly) {
            this.currentContext.scopeCanExitEarly.add(this.currentContext.currentScope);
          }

          const elseIfs = s.elseif.map((e) => {
            assert(e.condition);
            // Evaluate condition with the constraints from previous branches
            const conditionExpr = this.withContext(
              {
                context: Semantic.isolateElaborationContext(this.currentContext, {
                  constraints: elseConstraints,
                  currentScope: this.currentContext.currentScope,
                  genericsScope: this.currentContext.genericsScope,
                  instanceDeps: this.currentContext.instanceDeps,
                }),
                inFunction: this.inFunction,
                inAttemptExpr: this.inAttemptExpr,
                functionReturnsInstanceIds: this.functionReturnsInstanceIds,
              },
              () => this.expr(e.condition!, undefined)[1],
            );
            const innerConstraints = [...elseConstraints]; // Start with constraints from previous branches
            this.buildConstraints(innerConstraints, conditionExpr, {});
            this.buildConstraints(elseConstraints, conditionExpr, { inverse: true });
            const boolCondition = Conversion.MakeConversionOrThrow(
              this.sr,
              conditionExpr,
              this.sr.b.boolType(),
              elseConstraints,
              s.sourceloc,
              Conversion.Mode.Implicit,
              false,
            );

            const innerThenScopeId = Semantic.addBlockScope(this.sr, {
              variant: Semantic.ENode.BlockScope,
              statements: [],
              emittedExpr: -1 as Semantic.ExprId,
              sourceloc: s.sourceloc,
              constraints: innerConstraints,
            })[1];
            const innerScopeResult = this.withContext(
              {
                context: Semantic.isolateElaborationContext(this.currentContext, {
                  constraints: innerConstraints,
                  currentScope: this.currentContext.currentScope,
                  genericsScope: this.currentContext.genericsScope,
                  instanceDeps: this.currentContext.instanceDeps,
                }),
                inFunction: this.inFunction,
                inAttemptExpr: this.inAttemptExpr,
                functionReturnsInstanceIds: this.functionReturnsInstanceIds,
              },
              () =>
                this.elaborateBlockScope(
                  {
                    targetScopeId: innerThenScopeId,
                    sourceScopeId: e.thenBlock,
                  },
                  false,
                  undefined,
                ),
            );

            if (!innerScopeResult.noFallthrough) {
              noFallthrough = false;
            }

            return {
              condition: boolCondition,
              then: innerThenScopeId,
            };
          });

          let elseScopeId = undefined as Semantic.BlockScopeId | undefined;
          if (s.elseBlock) {
            elseScopeId = Semantic.addBlockScope(this.sr, {
              variant: Semantic.ENode.BlockScope,
              statements: [],
              emittedExpr: -1 as Semantic.ExprId,
              constraints: elseConstraints,
              sourceloc: s.sourceloc,
            })[1];
            const elseResult = this.withContext(
              {
                context: Semantic.isolateElaborationContext(this.currentContext, {
                  constraints: elseConstraints,
                  currentScope: this.currentContext.currentScope,
                  genericsScope: this.currentContext.genericsScope,
                  instanceDeps: this.currentContext.instanceDeps,
                }),
                inFunction: this.inFunction,
                inAttemptExpr: this.inAttemptExpr,
                functionReturnsInstanceIds: this.functionReturnsInstanceIds,
              },
              () =>
                this.elaborateBlockScope(
                  {
                    targetScopeId: elseScopeId!,
                    sourceScopeId: s.elseBlock!,
                  },
                  false,
                  undefined,
                ),
            );

            if (!elseResult.noFallthrough) {
              noFallthrough = false;
            }
          } else {
            noFallthrough = false;
          }

          if (noFallthrough) {
            this.currentContext.scopeNoFallthrough.add(this.currentContext.currentScope);
          }

          return Semantic.addStatement(this.sr, {
            variant: Semantic.ENode.IfStatement,
            isLetBinding: Boolean(s.letScopeId),
            condition: boolCondition,
            then: thenScopeId,
            elseIfs: elseIfs,
            else: elseScopeId,
            sourceloc: s.sourceloc,
          })[1];
        }
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.WhileStatement: {
        let resultingConditionId: Semantic.ExprId | null = null;

        const constraints = [...this.currentContext.constraints];
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
          const varType = this.expr(letStatement.value, undefined)[0].type;
          const variableSymbolExprId = this.expr(
            Collect.makeExpr(this.sr.cc, {
              variant: Collect.ENode.SymbolValueExpr,
              genericArgs: [],
              name: sym.name,
              sourceloc: s.sourceloc,
            })[1],
            undefined,
          )[1];
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
            this.buildConstraints(constraints, variableAsBoolResult.expr, {});
            const conditionFromLet = Semantic.addExpr(this.sr, {
              variant: Semantic.ENode.BlockScopeExpr,
              block: Semantic.addBlockScope(this.sr, {
                variant: Semantic.ENode.BlockScope,
                constraints: this.currentContext.constraints,
                emittedExpr: variableAsBoolResult.expr,
                statements: [
                  Semantic.addStatement(this.sr, {
                    variant: Semantic.ENode.ExprStatement,
                    expr: Semantic.addExpr(this.sr, {
                      variant: Semantic.ENode.ExprAssignmentExpr,
                      instanceIds: [],
                      isTemporary: true,
                      operation: EAssignmentOperation.Rebind,
                      target: variableSymbolExprId,
                      type: varType,
                      value: this.expr(letStatement.value!, undefined)[1],
                      sourceloc: s.sourceloc,
                    })[1],
                    sourceloc: s.sourceloc,
                  })[1],
                ],
                sourceloc: s.sourceloc,
              })[1],
              instanceIds: [],
              noreturn: false,
              isTemporary: true,
              sourceloc: s.sourceloc,
              type: this.sr.b.boolType(),
            })[1];

            if (s.condition) {
              // Variable is convertible to bool and we have guard, combine both
              resultingConditionId = this.withContext(
                {
                  context: Semantic.isolateElaborationContext(this.currentContext, {
                    constraints: constraints,
                    currentScope: this.currentContext.currentScope,
                    genericsScope: this.currentContext.genericsScope,
                    instanceDeps: this.currentContext.instanceDeps,
                  }),
                  functionReturnsInstanceIds: this.functionReturnsInstanceIds,
                  inFunction: this.inFunction,
                  inAttemptExpr: this.inAttemptExpr,
                },
                () =>
                  this.sr.b.binaryExpr(
                    conditionFromLet,
                    Conversion.MakeConversionOrThrow(
                      this.sr,
                      this.expr(s.condition!, undefined)[1],
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
            } else {
              // Variable is convertible to bool but no guard, only use value
              resultingConditionId = conditionFromLet;
            }
          } else {
            if (s.condition) {
              // Variable is NOT convertible to bool but we have a guard, use only guard: Keep as-is
              resultingConditionId = this.expr(s.condition, undefined)[1];
              this.buildConstraints(constraints, resultingConditionId, {});
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
          resultingConditionId = this.expr(s.condition, undefined)[1];
          this.buildConstraints(constraints, resultingConditionId, {});
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

        const thenScopeId = Semantic.addBlockScope(this.sr, {
          variant: Semantic.ENode.BlockScope,
          emittedExpr: -1 as Semantic.ExprId,
          statements: [],
          constraints: constraints,
          sourceloc: s.sourceloc,
        })[1];

        this.withContext(
          {
            context: Semantic.isolateElaborationContext(this.currentContext, {
              constraints: constraints,
              currentScope: this.currentContext.currentScope,
              genericsScope: this.currentContext.genericsScope,
              instanceDeps: this.currentContext.instanceDeps,
            }),
            functionReturnsInstanceIds: this.functionReturnsInstanceIds,
            inFunction: this.inFunction,
            inAttemptExpr: this.inAttemptExpr,
          },
          () => {
            this.elaborateBlockScope(
              {
                targetScopeId: thenScopeId,
                sourceScopeId: s.block,
              },
              false,
              undefined,
            );
          },
        );

        return Semantic.addStatement(this.sr, {
          variant: Semantic.ENode.WhileStatement,
          isLetBinding: Boolean(s.letScopeId),
          condition: boolCondition,
          then: thenScopeId,
          sourceloc: s.sourceloc,
        })[1];
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

        this.currentContext.scopeCanExitEarly.add(this.currentContext.currentScope);
        this.currentContext.scopeWillExitEarly.add(this.currentContext.currentScope);
        this.currentContext.scopeNoFallthrough.add(this.currentContext.currentScope);

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

          const resultId = Semantic.addStatement(this.sr, {
            variant: Semantic.ENode.ReturnStatement,
            expr: eId,
            sourceloc: s.sourceloc,
          })[1];
          functionSymbol.returnStatements.add(resultId);
          return resultId;
        } else {
          const resultId = Semantic.addStatement(this.sr, {
            variant: Semantic.ENode.ReturnStatement,
            sourceloc: s.sourceloc,
          })[1];
          functionSymbol.returnStatements.add(resultId);
          return resultId;
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

        return Semantic.addStatement(this.sr, {
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
        })[1];
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

        return Semantic.addStatement(this.sr, {
          variant: Semantic.ENode.ExprStatement,
          expr: eId,
          sourceloc: s.sourceloc,
        })[1];
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.ForStatement: {
        if (s.comptime) {
          assert(false, "Comptime for loops are not implemented yet (comptime for-each is)");
        }

        const initStatement = s.initStatement ? this.elaborateStatement(s.initStatement, {}) : null;
        const loopCondition = s.loopCondition
          ? Conversion.MakeConversionOrThrow(
              this.sr,
              this.expr(s.loopCondition, {})[1],
              this.sr.b.boolType(),
              [...this.currentContext.constraints],
              s.sourceloc,
              Conversion.Mode.Implicit,
              false,
            )
          : null;
        const loopIncrement = s.loopIncrement ? this.expr(s.loopIncrement, {})[1] : null;

        const bodyId = Semantic.addBlockScope(this.sr, {
          variant: Semantic.ENode.BlockScope,
          statements: [],
          emittedExpr: -1 as Semantic.ExprId,
          constraints: [...this.currentContext.constraints],
          sourceloc: s.sourceloc,
        })[1];

        this.elaborateBlockScope(
          {
            sourceScopeId: s.body,
            targetScopeId: bodyId,
          },
          false,
          {},
        );

        return Semantic.addStatement(this.sr, {
          variant: Semantic.ENode.ForStatement,
          body: bodyId,
          initStatement: initStatement,
          loopCondition: loopCondition,
          loopIncrement: loopIncrement,
          sourceloc: s.sourceloc,
        })[1];
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
            [loopIndex, loopIndexId] = Semantic.addSymbol(this.sr, {
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

          const allScopes: Semantic.StatementId[] = [];
          for (let i = 0; i < comptimeExpr.parameters.length; i++) {
            const thenScopeId = Semantic.addBlockScope(this.sr, {
              variant: Semantic.ENode.BlockScope,
              statements: [],
              emittedExpr: -1 as Semantic.ExprId,
              constraints: [...this.currentContext.constraints],
              sourceloc: s.sourceloc,
            })[1];

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
            const thenScopeResult = this.elaborateBlockScope(
              {
                targetScopeId: thenScopeId,
                sourceScopeId: s.body,
              },
              false,
              undefined,
            );
            if (s.indexVariable) {
              syntheticMap.delete(s.indexVariable);
            }
            syntheticMap.delete(s.loopVariable);

            allScopes.push(
              Semantic.addStatement(this.sr, {
                variant: Semantic.ENode.ExprStatement,
                expr: Semantic.addExpr(this.sr, {
                  variant: Semantic.ENode.BlockScopeExpr,
                  instanceIds: [],
                  block: thenScopeId,
                  noreturn: thenScopeResult.noReturn,
                  sourceloc: s.sourceloc,
                  isTemporary: true,
                  type: this.sr.b.voidType(),
                })[1],
                sourceloc: s.sourceloc,
              })[1],
            );
          }

          return Semantic.addStatement(this.sr, {
            variant: Semantic.ENode.ExprStatement,
            expr: Semantic.addExpr(this.sr, {
              variant: Semantic.ENode.BlockScopeExpr,
              instanceIds: [],
              block: Semantic.addBlockScope(this.sr, {
                variant: Semantic.ENode.BlockScope,
                statements: allScopes,
                emittedExpr: this.sr.b.noneExpr()[1],
                constraints: [...this.currentContext.constraints],
                sourceloc: s.sourceloc,
              })[1],
              sourceloc: s.sourceloc,
              isTemporary: true,
              type: this.sr.b.voidType(),
            })[1],
            sourceloc: s.sourceloc,
          })[1];
        } else {
          assert(false, "Non-comptime for each not implemented yet");
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

        this.currentContext.scopeCanExitEarly.add(this.currentContext.currentScope);
        this.currentContext.scopeWillExitEarly.add(this.currentContext.currentScope);
        this.currentContext.scopeNoFallthrough.add(this.currentContext.currentScope);

        return Semantic.addStatement(this.sr, {
          variant: Semantic.ENode.RaiseStatement,
          expr: eId,
          toAttemptExpr: this.inAttemptExpr,
          sourceloc: s.sourceloc,
        })[1];
      }

      default:
        assert(false);
    }
  }

  applyBinaryExprConstraints(
    constraints: Semantic.Constraint[],
    symbolValueExprId: Semantic.ExprId,
    literalExprId: Semantic.ExprId,
    operation: EBinaryOperation,
    args: { inverse?: boolean },
  ) {
    const symbolValueExpr = this.sr.exprNodes.get(symbolValueExprId);
    assert(symbolValueExpr.variant === Semantic.ENode.SymbolValueExpr);
    const literalExpr = this.sr.exprNodes.get(literalExprId);
    assert(literalExpr.variant === Semantic.ENode.LiteralExpr);

    const symbol = this.sr.symbolNodes.get(symbolValueExpr.symbol);
    if (symbol.variant !== Semantic.ENode.VariableSymbol || !symbol.type) {
      return;
    }

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

    const invertBinaryOperation = (op: EBinaryOperation) => {
      switch (op) {
        case EBinaryOperation.Equal:
          return EBinaryOperation.Unequal;
        case EBinaryOperation.Unequal:
          return EBinaryOperation.Equal;
        case EBinaryOperation.GreaterEqual:
          return EBinaryOperation.LessThan;
        case EBinaryOperation.GreaterThan:
          return EBinaryOperation.LessEqual;
        case EBinaryOperation.LessEqual:
          return EBinaryOperation.GreaterThan;
        case EBinaryOperation.LessThan:
          return EBinaryOperation.GreaterEqual;
        default:
          assert(false);
      }
    };

    switch (operation) {
      case EBinaryOperation.Equal:
      case EBinaryOperation.Unequal:
      case EBinaryOperation.GreaterEqual:
      case EBinaryOperation.GreaterThan:
      case EBinaryOperation.LessEqual:
      case EBinaryOperation.LessThan:
        constraints.push({
          constraintValue: {
            kind: "comparison",
            operation: args?.inverse ? invertBinaryOperation(operation) : operation,
            value: literalExprId,
          },
          variableSymbol: symbolValueExpr.symbol,
        });
    }
  }

  buildConstraints(
    constraints: Semantic.Constraint[],
    exprId: Semantic.ExprId,
    args: { inverse?: boolean },
  ) {
    const expr = this.sr.exprNodes.get(exprId);
    const exprTypeUse = this.sr.typeUseNodes.get(expr.type);
    const exprTypeDef = this.sr.typeDefNodes.get(exprTypeUse.type);

    if (expr.variant === Semantic.ENode.UnaryExpr) {
      if (expr.operation === EUnaryOperation.Negate) {
        this.buildConstraints(constraints, expr.expr, {
          inverse: !args?.inverse,
        });
        return;
      }
    }

    if (expr.variant === Semantic.ENode.BinaryExpr) {
      if (expr.operation === EBinaryOperation.BoolAnd) {
        this.buildConstraints(constraints, expr.left, args);
        this.buildConstraints(constraints, expr.right, args);
        return;
      } else {
        const leftExpr = this.sr.exprNodes.get(expr.left);
        const rightExpr = this.sr.exprNodes.get(expr.right);
        if (leftExpr.variant === Semantic.ENode.SymbolValueExpr) {
          const rightValue = EvalCTFE(this.sr, expr.right);
          if (rightValue.ok) {
            this.applyBinaryExprConstraints(
              constraints,
              expr.left,
              rightValue.value[1],
              expr.operation,
              args,
            );
          }
        } else if (rightExpr.variant === Semantic.ENode.SymbolValueExpr) {
          const leftValue = EvalCTFE(this.sr, expr.left);
          if (leftValue.ok) {
            this.applyBinaryExprConstraints(
              constraints,
              expr.right,
              leftValue.value[1],
              expr.operation,
              args,
            );
          }
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

      if (unionExpr.variant === Semantic.ENode.SymbolValueExpr) {
        for (const comparisonType of expr.comparisonTypesAnd) {
          let invert = expr.invertCheck;
          if (args?.inverse) {
            invert = !invert;
          }
          constraints.push({
            constraintValue: {
              kind: "union",
              operation: invert ? "isNot" : "is",
              typeDef: this.getTypeUse(comparisonType).type,
            },
            variableSymbol: unionExpr.symbol,
          });
        }
      }
    }

    if (
      expr.variant === Semantic.ENode.SymbolValueExpr &&
      exprTypeDef.variant === Semantic.ENode.UntaggedUnionDatatype
    ) {
      const memberDefs = exprTypeDef.members.map((m) => this.sr.typeUseNodes.get(m).type);
      if (memberDefs.includes(this.sr.b.nullTypeDef())) {
        let invert = args?.inverse || false;
        constraints.push({
          constraintValue: {
            kind: "union",
            operation: invert ? "is" : "isNot",
            typeDef: this.sr.b.nullTypeDef(),
          },
          variableSymbol: expr.symbol,
        });
      }
      if (memberDefs.includes(this.sr.b.noneTypeDef())) {
        let invert = args?.inverse || false;
        constraints.push({
          constraintValue: {
            kind: "union",
            operation: invert ? "is" : "isNot",
            typeDef: this.sr.b.noneTypeDef(),
          },
          variableSymbol: expr.symbol,
        });
      }
    }

    if (
      expr.variant === Semantic.ENode.SymbolValueExpr &&
      exprTypeDef.variant === Semantic.ENode.TaggedUnionDatatype
    ) {
      let invert = args?.inverse || false;
      const okTag = exprTypeDef.members.find((m) => m.tag === "Ok");
      const errTag = exprTypeDef.members.find((m) => m.tag === "Err");
      if (okTag && errTag) {
        constraints.push({
          constraintValue: {
            kind: "union",
            operation: invert ? "isNot" : "is",
            typeDef: this.sr.typeUseNodes.get(okTag.type).type,
          },
          variableSymbol: expr.symbol,
        });
      }
    }
  }

  structInstantiation(structInst: Collect.AggregateLiteralExpr, inference: Inference) {
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
    } else if (
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
    } else {
      throw new CompilerError(
        `Type '${Semantic.serializeTypeUse(
          this.sr,
          structId,
        )}' is not a valid type for an aggregate literal`,
        structInst.sourceloc,
      );
    }
  }

  symbolValue(
    symbolValue: Collect.SymbolValueExpr,
    inference: Inference,
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

            const [result, resultId] = Semantic.addExpr(this.sr, {
              variant: Semantic.ENode.UnionToValueCastExpr,
              instanceIds: [],
              expr: symbolValueExprId,
              tag: tag,
              isTemporary: false,
              canBeUnwrappedForLHS: true,
              sourceloc: symbolValue.sourceloc,
              type: [...narrowing.possibleVariants][0],
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

            return Semantic.addExpr(this.sr, {
              variant: Semantic.ENode.UnionToUnionCastExpr,
              instanceIds: [],
              expr: symbolValueExprId,
              castComesFromNarrowingAndMayBeUnwrapped: true,
              isTemporary: false,
              sourceloc: symbolValue.sourceloc,
              type: newUnion,
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
        const [generic, genericId] = Semantic.addType(this.sr, {
          variant: Semantic.ENode.GenericParameterDatatype,
          name: symbol.name,
          collectedParameter: symbolId,
          concrete: false,
        });
        return this.sr.b.datatypeDefAsValue(genericId, symbolValue.sourceloc);
      }
    }
    throw new CompilerError(
      `Symbol cannot be used as a value: Code ${symbol.variant}`,
      symbolValue.sourceloc,
    );
  }

  errorPropagationExpr(errPropExpr: Collect.ErrorPropagationExpr, inference: Inference) {
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

      return Semantic.addExpr(this.sr, {
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

    const [tempVariable, tempVariableId] = Semantic.addSymbol(this.sr, {
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
      const errValue = Semantic.addExpr(this.sr, {
        variant: Semantic.ENode.UnionToValueCastExpr,
        expr: symbolValue(),
        instanceIds: [],
        sourceloc: errPropExpr.sourceloc,
        isTemporary: true,
        canBeUnwrappedForLHS: false,
        tag: srcErrIndex,
        type: srcErrTag.type,
      })[1];
      if (functionType.variant === Semantic.ENode.FunctionDatatype) {
        return Conversion.MakeConversionOrThrow(
          this.sr,
          errValue,
          srcErrTag.type,
          [],
          errPropExpr.sourceloc,
          Conversion.Mode.Implicit,
          false,
        );
      } else {
        return errValue;
      }
    };

    const symbolValue = () =>
      Semantic.addExpr(this.sr, {
        variant: Semantic.ENode.SymbolValueExpr,
        instanceIds: [],
        symbol: tempVariableId,
        isTemporary: true,
        sourceloc: errPropExpr.sourceloc,
        type: rightExpr.type,
      })[1];

    const returnStatement = () => {
      const statementId = Semantic.addStatement(this.sr, {
        variant: Semantic.ENode.ReturnStatement,
        expr: returnResult(),
        sourceloc: errPropExpr.sourceloc,
      })[1];
      functionSymbol.returnStatements.add(statementId);
      rightExpr.instanceIds.forEach((id) => functionSymbol.returnsInstanceIds.add(id));
      functionSymbol.returnedDatatypes.add(srcErrTag.type);
      return statementId;
    };

    return Semantic.addExpr(this.sr, {
      variant: Semantic.ENode.BlockScopeExpr,
      block: Semantic.addBlockScope(this.sr, {
        variant: Semantic.ENode.BlockScope,
        constraints: [],
        emittedExpr: Semantic.addExpr(this.sr, {
          variant: Semantic.ENode.UnionToValueCastExpr,
          expr: symbolValue(),
          instanceIds: [],
          isTemporary: true,
          canBeUnwrappedForLHS: false,
          sourceloc: errPropExpr.sourceloc,
          tag: srcOkIndex,
          type: srcOkTag.type,
        })[1],
        statements: [
          Semantic.addStatement(this.sr, {
            variant: Semantic.ENode.VariableStatement,
            name: tempVariable.name,
            comptime: false,
            sourceloc: errPropExpr.sourceloc,
            value: rightExprId,
            variableSymbol: tempVariableId,
          })[1],
          Semantic.addStatement(this.sr, {
            variant: Semantic.ENode.IfStatement,
            isLetBinding: false,
            condition: Semantic.addExpr(this.sr, {
              variant: Semantic.ENode.UnionTagCheckExpr,
              expr: rightExprId,
              instanceIds: [],
              isTemporary: true,
              sourceloc: errPropExpr.sourceloc,
              type: this.sr.b.boolType(),
              invertCheck: false,
              comparisonTypesAnd: [srcErrTag.type],
            })[1],
            elseIfs: [],
            sourceloc: errPropExpr.sourceloc,
            then: Semantic.addBlockScope(this.sr, {
              variant: Semantic.ENode.BlockScope,
              constraints: [],
              emittedExpr: this.sr.b.noneExpr()[1],
              statements: [returnStatement()],
              sourceloc: errPropExpr.sourceloc,
            })[1],
          })[1],
        ],
        sourceloc: errPropExpr.sourceloc,
      })[1],
      instanceIds: [],
      noreturn: false, // dont care
      isTemporary: true,
      sourceloc: errPropExpr.sourceloc,
      type: srcOkTag.type,
    });
  }

  exprIsType(exprIsType: Collect.ExprIsTypeExpr, inference: Inference) {
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
          )}' is not a member of the union '${Semantic.serializeTypeUse(
            this.sr,
            sourceExpr.type,
          )}'.`,
          exprIsType.sourceloc,
        );
      }

      return Semantic.addExpr(this.sr, {
        variant: Semantic.ENode.UnionTagCheckExpr,
        instanceIds: [],
        expr: sourceExprId,
        type: this.sr.b.boolType(),
        comparisonTypesAnd: [comparisonType],
        sourceloc: exprIsType.sourceloc,
        invertCheck: false,
        isTemporary: true,
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
          `Expression of type ${Semantic.serializeTypeUse(
            this.sr,
            value.type,
          )} cannot be subscripted`,
          arraySubscript.sourceloc,
        );
      }

      return Semantic.addExpr(this.sr, {
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
            `Expression of type ${Semantic.serializeTypeUse(
              this.sr,
              value.type,
            )} cannot be subscripted`,
            arraySubscript.sourceloc,
          );
        }

        return Semantic.addExpr(this.sr, {
          variant: Semantic.ENode.ArraySubscriptExpr,
          instanceIds: [],
          expr: valueId,
          indices: [indexId],
          type: valueType.datatype,
          sourceloc: arraySubscript.sourceloc,
          isTemporary: false,
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
        return Semantic.addExpr(this.sr, {
          variant: Semantic.ENode.StringSubscriptExpr,
          expr: valueId,
          index: indexId,
          instanceIds: [],
          isTemporary: true,
          sourceloc: arraySubscript.sourceloc,
          type: this.sr.b.u8Type(),
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

          return Semantic.addExpr(this.sr, {
            variant: Semantic.ENode.ExprCallExpr,
            instanceIds: instanceIds,
            arguments: [indexId],
            calledExpr: Semantic.addExpr(this.sr, {
              variant: Semantic.ENode.CallableExpr,
              functionSymbol: exactMatchId,
              instanceIds: [],
              isTemporary: true,
              sourceloc: arraySubscript.sourceloc,
              thisExpr: valueId,
              type: makeTypeUse(
                this.sr,
                Semantic.addType(this.sr, {
                  variant: Semantic.ENode.CallableDatatype,
                  thisExprType: value.type,
                  functionType: method.type,
                  concrete: true,
                })[1],
                EDatatypeMutability.Const,
                false,
                arraySubscript.sourceloc,
              )[1],
            })[1],
            type: ftype.returnType,
            sourceloc: arraySubscript.sourceloc,
            isTemporary: true,
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
          `Expression of type '${Semantic.serializeTypeUse(
            this.sr,
            value.type,
          )}' cannot be subscripted`,
          value.sourceloc,
        );
      }
    }
  }

  parenthesisExpr(parenthesisExpr: Collect.ParenthesisExpr, inference: Inference) {
    return this.expr(parenthesisExpr.expr, inference);
  }

  explicitCastExpr(
    castExpr: Collect.ExplicitCastExpr,
    inference: Inference,
  ): [Semantic.Expression, Semantic.ExprId] {
    const result = Conversion.MakeConversionOrThrow(
      this.sr,
      this.expr(castExpr.expr, undefined)[1],
      this.lookupAndElaborateDatatype(castExpr.targetType),
      this.currentContext.constraints,
      castExpr.sourceloc,
      Conversion.Mode.Explicit,
      inference?.unsafe || false,
    );
    return [this.sr.exprNodes.get(result), result];
  }

  postIncr(postIncr: Collect.PostIncrExpr) {
    const [e, eId] = this.expr(postIncr.expr, undefined);
    return Semantic.addExpr(this.sr, {
      variant: Semantic.ENode.PostIncrExpr,
      instanceIds: [],
      type: e.type,
      expr: eId,
      operation: postIncr.operation,
      sourceloc: postIncr.sourceloc,
      isTemporary: true,
    });
  }

  preIncr(preIncr: Collect.PreIncrExpr) {
    const [e, eId] = this.expr(preIncr.expr, undefined);
    return Semantic.addExpr(this.sr, {
      variant: Semantic.ENode.PreIncrExpr,
      instanceIds: [],
      type: e.type,
      expr: eId,
      operation: preIncr.operation,
      sourceloc: preIncr.sourceloc,
      isTemporary: true,
    });
  }

  blockScopeExpr(blockScopeExpr: Collect.BlockScopeExpr, inference: Inference) {
    const blockScope = this.sr.cc.scopeNodes.get(blockScopeExpr.scope);
    assert(blockScope.variant === Collect.ENode.BlockScope);
    const [scope, scopeId] = Semantic.addBlockScope(this.sr, {
      variant: Semantic.ENode.BlockScope,
      statements: [],
      emittedExpr: -1 as Semantic.ExprId,
      constraints: [...this.currentContext.constraints],
      sourceloc: blockScope.sourceloc,
    });
    const result = this.withContext(
      {
        context: Semantic.isolateElaborationContext(this.currentContext, {
          currentScope: blockScopeExpr.scope,
          genericsScope: blockScopeExpr.scope,
          constraints: this.currentContext.constraints,
          instanceDeps: this.currentContext.instanceDeps,
        }),
        inFunction: this.inFunction,
        inAttemptExpr: this.inAttemptExpr,
        functionReturnsInstanceIds: this.functionReturnsInstanceIds,
      },
      () => {
        return this.elaborateBlockScope(
          {
            targetScopeId: scopeId,
            sourceScopeId: blockScopeExpr.scope,
          },
          true,
          inference,
        );
      },
    );

    if (result.canExitEarly) {
      this.currentContext.scopeCanExitEarly.add(this.currentContext.currentScope);
    }
    if (result.noFallthrough) {
      this.currentContext.scopeNoFallthrough.add(this.currentContext.currentScope);
    }
    if (result.noReturn) {
      this.currentContext.scopeNoReturn.add(this.currentContext.currentScope);
    }
    if (result.willExitEarly) {
      this.currentContext.scopeWillExitEarly.add(this.currentContext.currentScope);
    }

    assert(scope.emittedExpr !== -1);
    return Semantic.addExpr(this.sr, {
      variant: Semantic.ENode.BlockScopeExpr,
      instanceIds: [],
      block: scopeId,
      isTemporary: true,
      type: this.sr.exprNodes.get(scope.emittedExpr).type,
      sourceloc: blockScopeExpr.sourceloc,
    });
  }

  attemptExpr(attempt: Collect.AttemptExpr, inference: Inference) {
    const uniqueId = makeTempId();
    const [attemptExpr, attemptExprId] = Semantic.addExpr<Semantic.AttemptExpr>(this.sr, {
      variant: Semantic.ENode.AttemptExpr,
      attemptScopeExpr: -1 as Semantic.ExprId,
      elseScopeExpr: -1 as Semantic.ExprId,
      instanceIds: [],
      attemptScopeReturnsType: null,
      elseScopeReturnsType: null,
      errorTypesCaught: new Set(),
      uniqueId: makeTempId(),
      errorLabel: `__attempt_error_label_${uniqueId}`,
      resultLabel: `__attempt_result_label_${uniqueId}`,
      errorResultVarname: `__attempt_error_${uniqueId}`,
      isTemporary: true,
      hasErrorVar: Boolean(attempt.elseVar),
      sourceloc: attempt.sourceloc,
      type: -1 as Semantic.TypeUseId,
      errorUnionType: -1 as Semantic.TypeUseId,
    });

    const attemptBlockScope = this.sr.cc.scopeNodes.get(attempt.attemptScope);
    assert(attemptBlockScope.variant === Collect.ENode.BlockScope);
    const [attemptScope, attemptScopeId] = Semantic.addBlockScope<Semantic.BlockScope>(this.sr, {
      variant: Semantic.ENode.BlockScope,
      statements: [],
      emittedExpr: -1 as Semantic.ExprId,
      constraints: [...this.currentContext.constraints],
      sourceloc: attemptBlockScope.sourceloc,
    });
    const attemptScopeResult = this.withContext(
      {
        context: Semantic.isolateElaborationContext(this.currentContext, {
          currentScope: attempt.attemptScope,
          genericsScope: attempt.attemptScope,
          constraints: this.currentContext.constraints,
          instanceDeps: this.currentContext.instanceDeps,
        }),
        inFunction: this.inFunction,
        inAttemptExpr: attemptExprId,
        functionReturnsInstanceIds: this.functionReturnsInstanceIds,
      },
      () => {
        return this.elaborateBlockScope(
          {
            targetScopeId: attemptScopeId,
            sourceScopeId: attempt.attemptScope,
          },
          true,
          inference,
        );
      },
    );

    const errorUnion =
      attemptExpr.errorTypesCaught.size > 0
        ? this.sr.b.untaggedUnionTypeUse([...attemptExpr.errorTypesCaught], attempt.sourceloc)
        : this.sr.b.noneType();

    const elseBlockScope = this.sr.cc.scopeNodes.get(attempt.elseScope);
    assert(elseBlockScope.variant === Collect.ENode.BlockScope);
    const [elseScope, elseScopeId] = Semantic.addBlockScope(this.sr, {
      variant: Semantic.ENode.BlockScope,
      statements: [],
      emittedExpr: -1 as Semantic.ExprId,
      constraints: [...this.currentContext.constraints],
      sourceloc: elseBlockScope.sourceloc,
    });

    let errorVarDefStatement: Collect.VariableDefinitionStatement | null = null;
    if (elseBlockScope.statements.length === 2) {
      const statement = this.sr.cc.statementNodes.get(elseBlockScope.statements[0]);
      assert(statement.variant === Collect.ENode.VariableDefinitionStatement);
      errorVarDefStatement = statement;
    }

    const elseScopeResult = this.withContext(
      {
        context: Semantic.isolateElaborationContext(this.currentContext, {
          currentScope: attempt.elseScope,
          genericsScope: attempt.elseScope,
          constraints: this.currentContext.constraints,
          instanceDeps: this.currentContext.instanceDeps,
        }),
        inFunction: this.inFunction,
        inAttemptExpr: this.inAttemptExpr,
        functionReturnsInstanceIds: this.functionReturnsInstanceIds,
      },
      () => {
        // Override type of the 'e' variable, will be picked up at variable elaboration
        if (errorVarDefStatement) {
          this.currentContext.elaborationTypeOverride.set(
            errorVarDefStatement.variableSymbol,
            errorUnion,
          );
        }
        return this.elaborateBlockScope(
          {
            targetScopeId: elseScopeId,
            sourceScopeId: attempt.elseScope,
          },
          true,
          inference,
        );
      },
    );

    const memberSet = new Set<Semantic.TypeUseId>();
    if (!attemptScopeResult.noReturn && !attemptScopeResult.willExitEarly) {
      attemptExpr.attemptScopeReturnsType = this.sr.exprNodes.get(attemptScope.emittedExpr).type;
      memberSet.add(attemptExpr.attemptScopeReturnsType);
    }
    if (!elseScopeResult.noReturn && !elseScopeResult.willExitEarly) {
      attemptExpr.elseScopeReturnsType = this.sr.exprNodes.get(elseScope.emittedExpr).type;
      memberSet.add(attemptExpr.elseScopeReturnsType);
    }

    const resultUnion =
      memberSet.size > 0
        ? this.sr.b.untaggedUnionTypeUse([...memberSet], attempt.sourceloc)
        : this.sr.b.noneType();

    attemptExpr.type = resultUnion;

    const attemptScopeExprId = this.sr.b.blockScopeExpr(attemptScopeId)[1];
    if (attemptExpr.attemptScopeReturnsType) {
      attemptExpr.attemptScopeExpr = Conversion.MakeConversionOrThrow(
        this.sr,
        attemptScopeExprId,
        resultUnion,
        this.currentContext.constraints,
        attemptScope.sourceloc,
        Conversion.Mode.Implicit,
        false,
      );
    } else {
      attemptExpr.attemptScopeExpr = attemptScopeExprId;
    }

    const elseExprId = this.sr.b.blockScopeExpr(elseScopeId)[1];
    if (attemptExpr.elseScopeReturnsType) {
      attemptExpr.elseScopeExpr = Conversion.MakeConversionOrThrow(
        this.sr,
        elseExprId,
        resultUnion,
        this.currentContext.constraints,
        elseScope.sourceloc,
        Conversion.Mode.Implicit,
        false,
      );
    } else {
      attemptExpr.elseScopeExpr = elseExprId;
    }

    // Insert the error variable
    if (attemptExpr.hasErrorVar) {
      assert(elseScope.statements.length === 1);
      const vardefStatement = this.sr.statementNodes.get(elseScope.statements[0]);
      assert(vardefStatement.variant === Semantic.ENode.VariableStatement);
      vardefStatement.value = Semantic.addExpr(this.sr, {
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
        type: errorUnion,
      })[1];
    }

    attemptExpr.errorUnionType = errorUnion;

    console.log(attemptScopeResult, elseScopeResult);
    // Handle control flow analysis
    console.error(
      "FIX THIS: The control flow analysis for attempt/else blocks is completely broken, but it cannot be fixed because we don't know where it escapes to. We need a solution so we know whether it escapes to the function with a return statement (which also applies to the parent) or if it escapes to the else block with an error (which does NOT apply to the parent). Find a way to distinguish both, and then try hard to actually get the control flow right.",
    );
    if (elseScopeResult.canExitEarly) {
      this.currentContext.scopeCanExitEarly.add(this.currentContext.currentScope);
    }
    if (elseScopeResult.willExitEarly) {
      this.currentContext.scopeWillExitEarly.add(this.currentContext.currentScope);
    }
    if (
      (attemptScopeResult.willExitEarly || attemptScopeResult.noReturn) &&
      (elseScopeResult.willExitEarly || elseScopeResult.noReturn)
    ) {
      this.currentContext.scopeNoFallthrough.add(this.currentContext.currentScope);
    }
    if (attemptScopeResult.noReturn && elseScopeResult.noReturn) {
      this.currentContext.scopeNoReturn.add(this.currentContext.currentScope);
    }

    assert(attemptBlockScope.emittedExpr !== -1 && elseBlockScope.emittedExpr !== -1);
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
          constraints: [],
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

export class SemanticBuilder {
  constructor(public sr: SemanticResult) {}

  binaryExpr(
    left: Semantic.ExprId,
    right: Semantic.ExprId,
    operation: EBinaryOperation,
    resultType: Semantic.TypeUseId,
    sourceloc: SourceLoc,
  ) {
    return Semantic.addExpr(this.sr, {
      variant: Semantic.ENode.BinaryExpr,
      instanceIds: [],
      left: left,
      operation: operation,
      right: right,
      type: resultType,
      isTemporary: true,
      sourceloc: sourceloc,
    });
  }

  blockScopeExpr(blockScopeId: Semantic.BlockScopeId) {
    const blockScope = this.sr.blockScopeNodes.get(blockScopeId);
    return Semantic.addExpr(this.sr, {
      variant: Semantic.ENode.BlockScopeExpr,
      block: blockScopeId,
      instanceIds: [],
      isTemporary: true,
      sourceloc: blockScope.sourceloc,
      type: blockScope.emittedExpr
        ? this.sr.exprNodes.get(blockScope.emittedExpr).type
        : this.sr.b.voidType(),
    });
  }

  callExpr(
    exprId: Semantic.ExprId,
    callArguments: Semantic.ExprId[],
    inFunction: Semantic.SymbolId,
    sourceloc: SourceLoc,
  ) {
    const expr = this.sr.exprNodes.get(exprId);
    const ftypeUse = this.sr.typeUseNodes.get(expr.type);
    const ftypeDef = this.sr.typeDefNodes.get(ftypeUse.type);

    assert(
      ftypeDef.variant === Semantic.ENode.FunctionDatatype ||
        ftypeDef.variant === Semantic.ENode.CallableDatatype,
    );

    const instanceIds: Semantic.InstanceId[] = [];
    // if (producesAllocation) {
    //   instanceIds.push(Semantic.makeInstanceId(this.sr));
    // }

    const functionSymbol = this.sr.e.getSymbol(inFunction);
    assert(functionSymbol.variant === Semantic.ENode.FunctionSymbol);
    instanceIds.forEach((i) => functionSymbol.createsInstanceIds.add(i));

    let returnType: Semantic.TypeUseId | null = null;
    if (ftypeDef.variant === Semantic.ENode.FunctionDatatype) {
      returnType = ftypeDef.returnType;
      if (!ftypeDef.requires.pure) {
        functionSymbol.isImpure = true;
      }
    } else {
      const functype = this.sr.typeDefNodes.get(ftypeDef.functionType);
      assert(functype.variant === Semantic.ENode.FunctionDatatype);
      returnType = functype.returnType;
      if (!functype.requires.pure) {
        functionSymbol.isImpure = true;
      }
    }

    return Semantic.addExpr(this.sr, {
      variant: Semantic.ENode.ExprCallExpr,
      instanceIds: instanceIds,
      calledExpr: exprId,
      arguments: callArguments,
      isTemporary: true,
      type: returnType,
      sourceloc: sourceloc,
    });
  }

  unaryExpr(
    exprId: Semantic.ExprId,
    operation: EUnaryOperation,
    resultType: Semantic.TypeUseId,
    sourceloc: SourceLoc,
  ) {
    const expr = this.sr.exprNodes.get(exprId);
    return Semantic.addExpr(this.sr, {
      variant: Semantic.ENode.UnaryExpr,
      instanceIds: [],
      expr: exprId,
      operation: operation,
      type: resultType,
      isTemporary: true,
      sourceloc: sourceloc,
    });
  }

  elaborateRegex(pattern: string, flags: Set<string>) {
    const id = internRegex(this.sr, pattern, flags);

    let regexData = this.sr.elaboratedRegexTable.get(id);
    if (!regexData) {
      regexData = {
        id: id,
        flags: flags,
        pattern: pattern,
      };
      this.sr.elaboratedRegexTable.set(id, regexData);
    }

    return id;
  }

  literalValue(literal: LiteralValue, sourceloc: SourceLoc) {
    if (literal.type === "enum") {
      const enumType = this.sr.typeDefNodes.get(literal.enumType);
      assert(enumType.variant === Semantic.ENode.EnumDatatype);
      return Semantic.addExpr(this.sr, {
        variant: Semantic.ENode.LiteralExpr,
        instanceIds: [],
        literal: literal,
        sourceloc: sourceloc,
        isTemporary: true,
        type: makeTypeUse(
          this.sr,
          literal.enumType,
          EDatatypeMutability.Default,
          false,
          sourceloc,
        )[1],
      });
    } else if (literal.type === EPrimitive.Regex) {
      literal.id = this.elaborateRegex(literal.pattern, literal.flags);
      return Semantic.addExpr(this.sr, {
        variant: Semantic.ENode.LiteralExpr,
        instanceIds: [],
        literal: literal,
        sourceloc: sourceloc,
        isTemporary: true,
        type: makePrimitiveAvailable(this.sr, literal.type, EDatatypeMutability.Const, sourceloc),
      });
    } else {
      return Semantic.addExpr(this.sr, {
        variant: Semantic.ENode.LiteralExpr,
        instanceIds: [],
        literal: literal,
        sourceloc: sourceloc,
        isTemporary: true,
        type: makePrimitiveAvailable(this.sr, literal.type, EDatatypeMutability.Const, sourceloc),
      });
    }
  }

  literal(value: boolean | number | bigint | string, sourceloc: SourceLoc) {
    if (typeof value === "bigint") {
      return this.literalValue(
        {
          type: EPrimitive.int,
          unit: null,
          value: value,
        },
        sourceloc,
      );
    } else if (typeof value === "number") {
      return this.literalValue(
        {
          type: EPrimitive.real,
          unit: null,
          value: value,
        },
        sourceloc,
      );
    } else if (typeof value === "boolean") {
      return this.literalValue(
        {
          type: EPrimitive.bool,
          value: value,
        },
        sourceloc,
      );
    } else if (typeof value === "string") {
      return this.literalValue(
        {
          type: EPrimitive.str,
          prefix: null,
          value: value,
        },
        sourceloc,
      );
    } else {
      assert(false);
    }
  }

  datatypeDefAsValue(type: Semantic.TypeDefId, sourceloc: SourceLoc) {
    return Semantic.addExpr(this.sr, {
      variant: Semantic.ENode.DatatypeAsValueExpr,
      instanceIds: [],
      symbol: type,
      type: makeTypeUse(this.sr, type, EDatatypeMutability.Default, false, sourceloc)[1],
      isTemporary: false,
      sourceloc: sourceloc,
    });
  }

  datatypeUseAsValue(type: Semantic.TypeUseId, sourceloc: SourceLoc) {
    return Semantic.addExpr(this.sr, {
      variant: Semantic.ENode.DatatypeAsValueExpr,
      instanceIds: [],
      symbol: type,
      type: type,
      isTemporary: false,
      sourceloc: sourceloc,
    });
  }

  sizeof(valueExprId: Semantic.ExprId) {
    const valueExpr = this.sr.exprNodes.get(valueExprId);
    return Semantic.addExpr(this.sr, {
      variant: Semantic.ENode.SizeofExpr,
      instanceIds: [],
      valueExpr: valueExprId,
      type: this.intType(),
      isTemporary: false,
      sourceloc: valueExpr.sourceloc,
    });
  }

  alignof(valueExprId: Semantic.ExprId) {
    const valueExpr = this.sr.exprNodes.get(valueExprId);
    return Semantic.addExpr(this.sr, {
      variant: Semantic.ENode.AlignofExpr,
      instanceIds: [],
      valueExpr: valueExprId,
      type: this.intType(),
      isTemporary: false,
      sourceloc: valueExpr.sourceloc,
    });
  }

  symbolValue(symbolId: Semantic.SymbolId, sourceloc: SourceLoc) {
    const symbol = this.sr.symbolNodes.get(symbolId);
    if (symbol.variant === Semantic.ENode.FunctionSymbol) {
      // Currently dependencies don't go across function borders at all
      return Semantic.addExpr(this.sr, {
        variant: Semantic.ENode.SymbolValueExpr,
        instanceIds: [],
        symbol: symbolId,
        type: makeTypeUse(this.sr, symbol.type, EDatatypeMutability.Default, false, sourceloc)[1],
        isTemporary: false,
        sourceloc: sourceloc,
      });
    } else if (symbol.variant === Semantic.ENode.VariableSymbol) {
      assert(symbol.type);
      return Semantic.addExpr(this.sr, {
        variant: Semantic.ENode.SymbolValueExpr,
        instanceIds: Semantic.getSymbolDeps(this.sr.e.currentContext.instanceDeps, symbolId),
        symbol: symbolId,
        type: symbol.type,
        isTemporary: false,
        sourceloc: sourceloc,
      });
    } else {
      assert(false);
    }
  }

  variableSymbol(
    name: string,
    type: Semantic.TypeUseId,
    comptime: boolean,
    comptimeValue: Semantic.ExprId | null,
    mutability: EVariableMutability,
    parentStructOrNS: Semantic.TypeDefId | null,
    sourceloc: SourceLoc,
  ) {
    return Semantic.addSymbol(this.sr, {
      variant: Semantic.ENode.VariableSymbol,
      type: type,
      export: false,
      extern: EExternLanguage.None,
      comptime: comptime,
      comptimeValue: comptimeValue,
      name: name,
      memberOfStruct: null,
      mutability: mutability,
      variableContext: EVariableContext.Global,
      parentStructOrNS: parentStructOrNS,
      sourceloc: sourceloc,
      consumed: false,
      dependsOn: new Set(),
      concrete: true,
    });
  }

  typeDefSymbol(datatype: Semantic.TypeDefId) {
    return Semantic.addSymbol(this.sr, {
      variant: Semantic.ENode.TypeDefSymbol,
      datatype: datatype,
    });
  }

  makeStringFormatFunc(
    fragments: Semantic.ExprId[],
    allocator: Semantic.ExprId | null,
    sourceloc: SourceLoc,
  ) {
    const fmtNsId = Semantic.findBuiltinSymbolByName(this.sr, "fmt", null);
    const fmtNsDef = this.sr.cc.symbolNodes.get(fmtNsId);
    assert(fmtNsDef.variant === Collect.ENode.TypeDefSymbol);
    const fmtNs = this.sr.cc.typeDefNodes.get(fmtNsDef.typeDef);
    assert(fmtNs.variant === Collect.ENode.NamespaceTypeDef);

    const symbolId = Semantic.findBuiltinSymbolByName(
      this.sr,
      allocator ? "fmt.formatWithAllocator" : "fmt.format",
      null,
    );
    const chosenOverloadId = this.sr.e.FunctionOverloadChoose(symbolId, [], sourceloc);

    let elaboratedNsContext = null as Semantic.ElaborationContext | null;
    for (const cache of this.sr.elaboratedNamespaceSymbols) {
      if (cache.originalSharedInstance === fmtNs.sharedInstance) {
        elaboratedNsContext = cache.substitutionContext;
      }
    }
    assert(elaboratedNsContext);

    const elaboratedMethodId = this.sr.e.withContext(
      {
        context: Semantic.mergeSubstitutionContext(elaboratedNsContext, this.sr.e.currentContext, {
          currentScope: this.sr.e.currentContext.currentScope,
          genericsScope: this.sr.e.currentContext.currentScope,
          instanceDeps: {
            instanceDependsOn: new Map(),
            structMembersDependOn: new Map(),
            symbolDependsOn: new Map(),
          },
        }),
        inAttemptExpr: null,
        inFunction: null,
      },
      () =>
        this.sr.e.elaborateFunctionSymbolWithGenerics(
          this.sr.e.elaborateFunctionSignature(chosenOverloadId),
          [],
          sourceloc,
          [
            ...fragments.map((f) => {
              const expr = this.sr.exprNodes.get(f);
              return expr.type;
            }),
          ],
        ),
    );
    assert(elaboratedMethodId);
    const elaboratedMethod = this.sr.symbolNodes.get(elaboratedMethodId);
    assert(elaboratedMethod.variant === Semantic.ENode.FunctionSymbol);

    const functype = this.sr.e.getTypeDef(elaboratedMethod.type);
    assert(functype.variant === Semantic.ENode.FunctionDatatype);
    return this.sr.b.symbolValue(elaboratedMethodId, sourceloc);
  }

  callStringFormatFunc(
    fragments: Semantic.ExprId[],
    allocator: Semantic.ExprId | null,
    sourceloc: SourceLoc,
  ) {
    assert(this.sr.e.inFunction);
    return this.sr.b.callExpr(
      this.makeStringFormatFunc(fragments, allocator, sourceloc)[1],
      allocator ? [allocator, ...fragments] : fragments,
      this.sr.e.inFunction,
      sourceloc,
    );
  }

  makeSysPanicFunc(sourceloc: SourceLoc) {
    const fmtNsId = Semantic.findBuiltinSymbolByName(this.sr, "sys", null);
    const fmtNsDef = this.sr.cc.symbolNodes.get(fmtNsId);
    assert(fmtNsDef.variant === Collect.ENode.TypeDefSymbol);
    const fmtNs = this.sr.cc.typeDefNodes.get(fmtNsDef.typeDef);
    assert(fmtNs.variant === Collect.ENode.NamespaceTypeDef);

    const symbolId = Semantic.findBuiltinSymbolByName(this.sr, "sys.panic", null);
    const chosenOverloadId = this.sr.e.FunctionOverloadChoose(symbolId, [], sourceloc);

    let elaboratedNsContext = null as Semantic.ElaborationContext | null;
    for (const cache of this.sr.elaboratedNamespaceSymbols) {
      if (cache.originalSharedInstance === fmtNs.sharedInstance) {
        elaboratedNsContext = cache.substitutionContext;
      }
    }
    assert(elaboratedNsContext);

    const elaboratedMethodId = this.sr.e.withContext(
      {
        context: Semantic.mergeSubstitutionContext(elaboratedNsContext, this.sr.e.currentContext, {
          currentScope: this.sr.e.currentContext.currentScope,
          genericsScope: this.sr.e.currentContext.currentScope,
          instanceDeps: {
            instanceDependsOn: new Map(),
            structMembersDependOn: new Map(),
            symbolDependsOn: new Map(),
          },
        }),
        inAttemptExpr: null,
        inFunction: null,
      },
      () =>
        this.sr.e.elaborateFunctionSymbolWithGenerics(
          this.sr.e.elaborateFunctionSignature(chosenOverloadId),
          [],
          sourceloc,
          [this.strType()],
        ),
    );
    assert(elaboratedMethodId);
    const elaboratedMethod = this.sr.symbolNodes.get(elaboratedMethodId);
    assert(elaboratedMethod.variant === Semantic.ENode.FunctionSymbol);

    const functype = this.sr.e.getTypeDef(elaboratedMethod.type);
    assert(functype.variant === Semantic.ENode.FunctionDatatype);
    return this.sr.b.symbolValue(elaboratedMethodId, sourceloc);
  }

  callSysPanic(message: string, sourceloc: SourceLoc) {
    assert(this.sr.e.inFunction);
    return this.sr.b.callExpr(
      this.makeSysPanicFunc(sourceloc)[1],
      [this.literal(message, sourceloc)[1]],
      this.sr.e.inFunction,
      sourceloc,
    );
  }

  cInject(value: string, _export: boolean, sourceloc: SourceLoc) {
    const [_, directiveId] = Semantic.addSymbol(this.sr, {
      variant: Semantic.ENode.CInjectDirectiveSymbol,
      value: value,
      sourceloc: sourceloc,
    });
    this.sr.cInjections.push(directiveId);
    if (_export) {
      this.sr.exportedSymbols.add(directiveId);
    }
    return directiveId;
  }

  updateLHSDependencies(lhsId: Semantic.ExprId, dependencies: Semantic.InstanceId[]): void {
    const lhs = this.sr.exprNodes.get(lhsId);
    switch (lhs.variant) {
      case Semantic.ENode.ArraySubscriptExpr: {
        lhs.instanceIds.forEach((id) =>
          Semantic.addInstanceDeps(this.sr.e.currentContext.instanceDeps, id, dependencies),
        );
        break;
      }

      case Semantic.ENode.SymbolValueExpr: {
        Semantic.addSymbolDeps(this.sr.e.currentContext, lhs.symbol, dependencies);
        this.sr.e.currentContext.constraints = this.sr.e.currentContext.constraints.filter((c) => {
          return c.variableSymbol !== lhs.symbol;
        });
        break;
      }

      case Semantic.ENode.MemberAccessExpr: {
        const struct = this.sr.e.getTypeDef(
          this.sr.e.getTypeUse(this.sr.e.getExpr(lhs.expr).type).type,
        );
        assert(struct.variant === Semantic.ENode.StructDatatype);

        const member = struct.members.find((m) => {
          const mem = this.sr.symbolNodes.get(m);
          return mem.variant === Semantic.ENode.VariableSymbol && mem.name === lhs.memberName;
        });
        assert(member);
        for (const inst of lhs.instanceIds) {
          Semantic.addStructMemberInstanceDeps(
            this.sr.e.currentContext.instanceDeps,
            inst,
            member,
            dependencies,
          );
        }
        break;
      }

      // This is a special case for value narrowing and here, it is the easiest to fix, although not very nice
      case Semantic.ENode.UnionToValueCastExpr: {
        const unionExpr = this.sr.exprNodes.get(lhs.expr);
        if (unionExpr.variant !== Semantic.ENode.SymbolValueExpr || !lhs.canBeUnwrappedForLHS) {
          throw new CompilerError(`This expression is not a valid LHS`, lhs.sourceloc);
        }

        Semantic.addSymbolDeps(this.sr.e.currentContext, unionExpr.symbol, dependencies);
        break;
      }

      // This is a special case for value narrowing and here, it is the easiest to fix, although not very nice
      case Semantic.ENode.UnionToUnionCastExpr: {
        const unionExpr = this.sr.exprNodes.get(lhs.expr);
        if (
          unionExpr.variant !== Semantic.ENode.SymbolValueExpr ||
          !lhs.castComesFromNarrowingAndMayBeUnwrapped
        ) {
          throw new CompilerError(`This expression is not a valid LHS`, lhs.sourceloc);
        }

        Semantic.addSymbolDeps(this.sr.e.currentContext, unionExpr.symbol, dependencies);
        break;
      }

      case Semantic.ENode.StructLiteralExpr:
      case Semantic.ENode.ValueToUnionCastExpr:
      case Semantic.ENode.StringConstructExpr:
      case Semantic.ENode.PostIncrExpr:
      case Semantic.ENode.PreIncrExpr:
      case Semantic.ENode.LiteralExpr:
      case Semantic.ENode.UnaryExpr:
      case Semantic.ENode.ExplicitCastExpr:
      case Semantic.ENode.ExprAssignmentExpr:
      case Semantic.ENode.DereferenceExpr:
      case Semantic.ENode.DatatypeAsValueExpr:
      case Semantic.ENode.CallableExpr:
      case Semantic.ENode.BlockScopeExpr:
      case Semantic.ENode.BinaryExpr:
      case Semantic.ENode.ArraySliceExpr:
      case Semantic.ENode.ArrayLiteralExpr:
      case Semantic.ENode.SizeofExpr:
      case Semantic.ENode.AlignofExpr:
      case Semantic.ENode.AddressOfExpr:
      case Semantic.ENode.ExprCallExpr:
      default:
        throw new CompilerError(`This expression is not a valid LHS`, lhs.sourceloc);
      // assert(false, (lhs as any).variant.toString());
    }
  }

  assignment(
    targetId: Semantic.ExprId,
    operation: EAssignmentOperation,
    valueId: Semantic.ExprId,
    constraints: Semantic.Constraint[],
    sourceloc: SourceLoc,
    inference: Inference,
  ) {
    let target = this.sr.exprNodes.get(targetId);
    const value = this.sr.exprNodes.get(valueId);

    if (
      (target.variant === Semantic.ENode.UnionToValueCastExpr && target.canBeUnwrappedForLHS) ||
      (target.variant === Semantic.ENode.UnionToUnionCastExpr &&
        target.castComesFromNarrowingAndMayBeUnwrapped)
    ) {
      targetId = target.expr;
      target = this.sr.exprNodes.get(target.expr);
    }

    if (target.isTemporary) {
      throw new CompilerError(
        `Cannot assign to a temporary of type ${Semantic.serializeTypeUse(this.sr, target.type)}`,
        sourceloc,
      );
    }

    // An assignment like let d = (a = b) makes a now dependent on b, as well as the result on b
    // I don't think the result would ever depend on a, right? ... right??    .....    .....   right????
    this.updateLHSDependencies(targetId, value.instanceIds);

    return Semantic.addExpr(this.sr, {
      variant: Semantic.ENode.ExprAssignmentExpr,
      instanceIds: [...value.instanceIds],
      value: Conversion.MakeConversionOrThrow(
        this.sr,
        valueId,
        target.type,
        constraints,
        sourceloc,
        Conversion.Mode.Implicit,
        inference?.unsafe || false,
      ),
      target: targetId,
      type: target.type,
      operation: operation,
      sourceloc: sourceloc,
      isTemporary: true,
    });
  }

  syntheticFunctionFromCode(args: {
    functionTypeId: Semantic.TypeDefId;
    parameterNames: string[];
    funcname: string;
    bodySourceCode: string;
    currentScope: Collect.ScopeId;
    sourceloc: SourceLoc;
  }): [Semantic.FunctionSymbol, Semantic.SymbolId] {
    const fType = this.sr.typeDefNodes.get(args.functionTypeId);
    assert(fType.variant === Semantic.ENode.FunctionDatatype);
    assert(args.parameterNames.length === fType.parameters.length);

    const fullSource = `${args.funcname}(${fType.parameters
      .map(
        (p, i) =>
          `${args.parameterNames[i]}${p.optional ? "?" : ""}: ${Semantic.serializeTypeUse(
            this.sr,
            p.type,
          )}`,
      )
      .join(", ")}): ${Semantic.serializeTypeUse(this.sr, fType.returnType)} :: final { \n${
      args.bodySourceCode
    } \n}`;

    let scopeId = this.sr.e.currentContext.currentScope;
    while (true) {
      let scope = this.sr.cc.scopeNodes.get(scopeId);
      if (
        scope.variant === Collect.ENode.BlockScope ||
        scope.variant === Collect.ENode.NamespaceScope ||
        scope.variant === Collect.ENode.FunctionScope
      ) {
        scopeId = scope.parentScope;
        continue;
      }

      break;
    }

    let scope = this.sr.cc.scopeNodes.get(scopeId);
    assert(
      scope.variant === Collect.ENode.ModuleScope || scope.variant === Collect.ENode.FileScope,
    );

    this.sr.moduleCompiler.collectImmediate(fullSource, {
      inScope: scopeId,
    });

    const [e, _] = this.sr.e.expr(
      Collect.makeExpr(this.sr.cc, {
        variant: Collect.ENode.SymbolValueExpr,
        genericArgs: [],
        name: args.funcname,
        sourceloc: args.sourceloc,
      })[1],
      {},
    );

    assert(e.variant === Semantic.ENode.SymbolValueExpr);
    const symbol = this.sr.symbolNodes.get(e.symbol);
    assert(symbol.variant === Semantic.ENode.FunctionSymbol);

    return [symbol, e.symbol];
  }

  memberAccessRaw(
    exprId: Semantic.ExprId,
    name: string,
    memberType: Semantic.TypeUseId,
    temporary: boolean,
    sourceloc: SourceLoc,
  ) {
    const expr = this.sr.e.getExpr(exprId);

    const typeDef = this.sr.e.getTypeDef(this.sr.e.getTypeUse(expr.type).type);

    const dependsOn = new Set<Semantic.InstanceId>();
    if (typeDef.variant === Semantic.ENode.StructDatatype) {
      const member = typeDef.members.find((m) => {
        const mem = this.sr.symbolNodes.get(m);
        return mem.variant === Semantic.ENode.VariableSymbol && mem.name === name;
      });
      assert(member);

      const memberSym = this.sr.symbolNodes.get(member);
      assert(memberSym.variant === Semantic.ENode.VariableSymbol);

      for (const inst of expr.instanceIds) {
        // Get ONLY the dependencies of the specific struct member being accessed
        Semantic.getStructMemberInstanceDeps(
          this.sr.e.currentContext.instanceDeps,
          inst,
          member,
        ).forEach((d) => dependsOn.add(d));
      }
    } else if (
      typeDef.variant === Semantic.ENode.PrimitiveDatatype &&
      typeDef.primitive === EPrimitive.str &&
      name === "length"
    ) {
      // No work required
    } else if (typeDef.variant === Semantic.ENode.DynamicArrayDatatype && name === "length") {
      // No work required
    } else {
      assert(false);
    }

    return Semantic.addExpr(this.sr, {
      variant: Semantic.ENode.MemberAccessExpr,
      instanceIds: [...dependsOn],
      expr: exprId,
      memberName: name,
      type: memberType,
      sourceloc: sourceloc,
      isTemporary: temporary,
    });
  }

  memberAccess(exprId: Semantic.ExprId, name: string, sourceloc: SourceLoc) {
    const expr = this.sr.exprNodes.get(exprId);
    const exprType = this.sr.typeDefNodes.get(this.sr.typeUseNodes.get(expr.type).type);
    assert(exprType.variant === Semantic.ENode.StructDatatype);

    let memberType: Semantic.TypeUseId | null = null;
    for (const m of exprType.members) {
      const symbol = this.sr.symbolNodes.get(m);
      if (symbol.variant === Semantic.ENode.VariableSymbol && symbol.name === name) {
        memberType = symbol.type;
        break;
      }
    }
    assert(memberType);

    return this.memberAccessRaw(exprId, name, memberType, false, sourceloc);
  }

  arrayLiteral(
    arrayTypeId: Semantic.TypeUseId,
    elements: Semantic.ExprId[],
    inFunction: Semantic.SymbolId | null,
    allocator: Semantic.ExprId | null,
    sourceloc: SourceLoc,
  ) {
    const structTypeUse = this.sr.typeUseNodes.get(arrayTypeId);
    const structType = this.sr.typeDefNodes.get(structTypeUse.type);
    assert(
      structType.variant === Semantic.ENode.FixedArrayDatatype ||
        structType.variant === Semantic.ENode.DynamicArrayDatatype,
    );

    const e = Semantic.addExpr<Semantic.ArrayLiteralExpr>(this.sr, {
      variant: Semantic.ENode.ArrayLiteralExpr,
      instanceIds: [Semantic.makeInstanceId(this.sr)],
      elements: elements,
      type: arrayTypeId,
      inFunction: inFunction,
      allocator: allocator,
      sourceloc: sourceloc,
      isTemporary: true,
    });

    if (allocator) {
      this.sr.e.assertExprAllocatorType(allocator, sourceloc);
    }

    if (inFunction) {
      // Structs as struct default values are not inside functions
      const functionSymbol = this.sr.e.getSymbol(inFunction);
      assert(functionSymbol.variant === Semantic.ENode.FunctionSymbol);
      e[0].instanceIds.forEach((i) => functionSymbol.createsInstanceIds.add(i));
    }

    return e;
  }

  structLiteral(
    structTypeId: Semantic.TypeUseId,
    assign: {
      name: string;
      value: Semantic.ExprId;
    }[],
    inFunction: Semantic.SymbolId | null,
    allocator: Semantic.ExprId | null,
    sourceloc: SourceLoc,
  ) {
    const structTypeUse = this.sr.typeUseNodes.get(structTypeId);
    const structType = this.sr.typeDefNodes.get(structTypeUse.type);
    assert(structType.variant === Semantic.ENode.StructDatatype);

    const e = Semantic.addExpr<Semantic.StructLiteralExpr>(this.sr, {
      variant: Semantic.ENode.StructLiteralExpr,
      instanceIds: [Semantic.makeInstanceId(this.sr)],
      assign: assign,
      type: structTypeId,
      inFunction: inFunction,
      allocator: allocator,
      sourceloc: sourceloc,
      isTemporary: true,
    });

    if (allocator) {
      this.sr.e.assertExprAllocatorType(allocator, sourceloc);
    }

    if (inFunction) {
      // Structs as struct default values are not inside functions
      const functionSymbol = this.sr.e.getSymbol(inFunction);
      assert(functionSymbol.variant === Semantic.ENode.FunctionSymbol);
      e[0].instanceIds.forEach((i) => functionSymbol.createsInstanceIds.add(i));
    }

    for (const a of assign) {
      const member = structType.members.find((m) => {
        const varsym = this.sr.symbolNodes.get(m);
        return varsym.variant === Semantic.ENode.VariableSymbol && varsym.name === a.name;
      });
      assert(member);

      const value = this.sr.e.getExpr(a.value);
      Semantic.addStructMemberInstanceDeps(
        this.sr.e.currentContext.instanceDeps,
        e[0].instanceIds[0],
        member,
        value.instanceIds,
      );
    }

    return e;
  }

  namespaceType(
    name: string,
    parentStructOrNS: Semantic.TypeDefId | null,
    collectedNamespace: Collect.TypeDefId,
    _export: boolean,
  ) {
    return Semantic.addType<Semantic.NamespaceDatatypeDef>(this.sr, {
      variant: Semantic.ENode.NamespaceDatatype,
      name: name,
      parentStructOrNS: parentStructOrNS,
      symbols: [],
      export: _export,
      concrete: true,
      collectedNamespace: collectedNamespace,
    });
  }

  paramPackTypeUse(mutability: EDatatypeMutability, sourceloc: SourceLoc) {
    return makeTypeUse(
      this.sr,
      Semantic.addType(this.sr, {
        variant: Semantic.ENode.ParameterPackDatatype,
        parameters: null,
        concrete: true,
      })[1],
      mutability,
      false,
      sourceloc,
    )[1];
  }

  paramPackTypeDef() {
    return Semantic.addType(this.sr, {
      variant: Semantic.ENode.ParameterPackDatatype,
      parameters: null,
      concrete: true,
    })[1];
  }

  untaggedUnionTypeUse(members: Semantic.TypeUseId[], sourceloc: SourceLoc) {
    const canonicalMemberSet = new Set<Semantic.TypeUseId>();

    const processMember = (mId: Semantic.TypeUseId) => {
      const mUse = this.sr.e.getTypeUse(mId);
      const mDef = this.sr.e.getTypeDef(mUse.type);

      if (mDef.variant === Semantic.ENode.UntaggedUnionDatatype) {
        for (const i of mDef.members) {
          processMember(i);
        }
      } else {
        canonicalMemberSet.add(mId);
      }
    };

    for (const mId of members) {
      processMember(mId);
    }

    const canonicalMembers = [...canonicalMemberSet];
    canonicalMembers.sort((a, b) => {
      const aUse = this.sr.e.getTypeUse(a);
      const bUse = this.sr.e.getTypeUse(b);
      const aDef = this.sr.e.getTypeDef(aUse.type);
      const bDef = this.sr.e.getTypeDef(bUse.type);

      const getVariantRank = (typeDef: Semantic.TypeDef) => {
        switch (typeDef.variant) {
          case Semantic.ENode.StructDatatype:
            return 1;
          case Semantic.ENode.FixedArrayDatatype:
            return 2;
          case Semantic.ENode.DynamicArrayDatatype:
            return 3;
          case Semantic.ENode.CallableDatatype:
            return 4;
          case Semantic.ENode.FunctionDatatype:
            return 5;
          case Semantic.ENode.PrimitiveDatatype:
            return 6;
          default:
            return 99; // Handle unknown/other variants last
        }
      };

      const rankA = getVariantRank(aDef);
      const rankB = getVariantRank(bDef);

      if (rankA !== rankB) {
        return rankA - rankB; // Ascending rank (lower rank comes first)
      }

      const getStructRank = (typeUse: Semantic.TypeUse, typeDef: Semantic.TypeDef) => {
        if (typeDef.variant !== Semantic.ENode.StructDatatype) {
          return 0;
        }
        if (typeUse.inline) {
          return 2;
        } else {
          return 1;
        }
      };
      const structRankA = getStructRank(aUse, aDef);
      const structRankB = getStructRank(bUse, bDef);
      if (structRankA !== structRankB) {
        return structRankA - structRankB; // Ascending rank (lower rank comes first)
      }

      if (
        aDef.variant === Semantic.ENode.StructDatatype &&
        bDef.variant === Semantic.ENode.StructDatatype &&
        aDef.name !== bDef.name
      ) {
        return aDef.name.localeCompare(bDef.name);
      }

      if (
        aDef.variant === Semantic.ENode.PrimitiveDatatype &&
        bDef.variant === Semantic.ENode.PrimitiveDatatype
      ) {
        return aDef.primitive - bDef.primitive;
      }

      return a - b;
    });

    canonicalMembers.forEach((m) => {
      const def = this.sr.typeDefNodes.get(this.sr.typeUseNodes.get(m).type);
      if (def.variant === Semantic.ENode.PrimitiveDatatype && def.primitive === EPrimitive.void) {
        throw new InternalError("Union cannot have a void datatype");
      }
    });

    return makeTypeUse(
      this.sr,
      Semantic.addType(this.sr, {
        variant: Semantic.ENode.UntaggedUnionDatatype,
        members: canonicalMembers,
        concrete: !members.some((m) => !isTypeConcrete(this.sr, m)),
      })[1],
      EDatatypeMutability.Const,
      false,
      sourceloc,
    )[1];
  }

  taggedUnionTypeUse(
    members: { tag: string; type: Semantic.TypeUseId }[],
    nodiscard: boolean,
    sourceloc: SourceLoc,
  ) {
    return makeTypeUse(
      this.sr,
      Semantic.addType(this.sr, {
        variant: Semantic.ENode.TaggedUnionDatatype,
        members: members,
        nodiscard: nodiscard,
        concrete: !members.some((m) => !isTypeConcrete(this.sr, m.type)),
      })[1],
      EDatatypeMutability.Const,
      false,
      sourceloc,
    )[1];
  }

  noneExpr() {
    return this.literalValue(
      {
        type: EPrimitive.none,
      },
      null,
    );
  }

  primitiveType(primitive: EPrimitive, sourceloc: SourceLoc): Semantic.TypeUseId {
    return makePrimitiveAvailable(this.sr, primitive, EDatatypeMutability.Const, sourceloc);
  }

  intType() {
    return this.primitiveType(EPrimitive.int, null);
  }

  nullType() {
    return this.primitiveType(EPrimitive.null, null);
  }

  noneType() {
    return this.primitiveType(EPrimitive.none, null);
  }

  optionalIntType() {
    return this.untaggedUnionTypeUse([this.intType(), this.noneType()], null);
  }

  boolType() {
    return this.primitiveType(EPrimitive.bool, null);
  }

  strType() {
    return this.primitiveType(EPrimitive.str, null);
  }

  voidType() {
    return this.primitiveType(EPrimitive.void, null);
  }

  u8Type() {
    return this.primitiveType(EPrimitive.u8, null);
  }

  usizeType() {
    return this.primitiveType(EPrimitive.usize, null);
  }

  nullTypeDef() {
    return makeRawPrimitiveAvailable(this.sr, EPrimitive.null);
  }

  noneTypeDef() {
    return makeRawPrimitiveAvailable(this.sr, EPrimitive.none);
  }

  unionTagRefTypeDef() {
    return Semantic.addType(this.sr, {
      variant: Semantic.ENode.UnionTagRefDatatype,
      concrete: true,
    })[1];
  }

  doesUnionContain(unionId: Semantic.TypeUseId, typeId: Semantic.TypeUseId) {
    const union = this.sr.typeDefNodes.get(this.sr.typeUseNodes.get(unionId).type);
    assert(union.variant === Semantic.ENode.UntaggedUnionDatatype);

    return union.members.some((m) => m === typeId);
  }
}

export function printSubstitutionContext(sr: SemanticResult, context: Semantic.ElaborationContext) {
  console.info(`Substitutions: (${[...context.substitute.values()].length})`);
  for (const [fromId, toId] of context.substitute) {
    printCollectedSymbol(sr.cc, fromId, 0, false);
    console.info(` -> ${Semantic.serializeExpr(sr, toId)}`);
  }
}

type FuncDef = {
  canonicalizedGenerics: string[];
  paramPackTypes: Semantic.TypeUseId[];
  substitutionContext: Semantic.ElaborationContext;
  result: Semantic.SymbolId;
  parentStructOrNS: Semantic.TypeDefId | null;
};
type FuncDefCache = Map<Collect.SymbolId, FuncDef[]>;

function getFromFuncDefCache(
  sr: SemanticResult,
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
  sr: SemanticResult,
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

type StructDef = {
  canonicalizedGenerics: string[];
  substitutionContext: Semantic.ElaborationContext;
  parentStructOrNS: Semantic.TypeDefId | null;
  result: Semantic.TypeDefId;
  resultAsTypeDefSymbol: Semantic.SymbolId;
};
type StructDefCache = Map<Collect.TypeDefId, StructDef[]>;

export function getFromStructDefCache(
  sr: SemanticResult,
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
  sr: SemanticResult,
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

type EnumDef = {
  substitutionContext: Semantic.ElaborationContext;
  parentStructOrNS: Semantic.TypeDefId | null;
  result: Semantic.TypeDefId;
  resultAsTypeDefSymbol: Semantic.SymbolId;
};
type EnumDefCache = Map<Collect.TypeDefId, EnumDef[]>;

export function getFromEnumDefCache(
  sr: SemanticResult,
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
  sr: SemanticResult,
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

export function internRegex(sr: SemanticResult, pattern: string, flags: Set<string>) {
  const flagsSorted = [...flags];
  flagsSorted.sort((a, b) => a.localeCompare(b));
  const key = pattern + flagsSorted.join("");

  let value = sr.elaboratedRegexInternMap.get(key);
  if (value === undefined) {
    value = sr.nextRegexId++;
    sr.elaboratedRegexInternMap.set(key, value);
  }
  return value;
}

export type RegexData = {
  pattern: string;
  flags: Set<string>;
  id: bigint;
};

export type SemanticResult = {
  cc: CollectionContext;

  moduleCompiler: ModuleCompiler;

  e: SemanticElaborator; // "e" = "Elaborator"
  b: SemanticBuilder; // "b" = "Builder"

  nextInstanceId: Semantic.InstanceId;

  blockScopeNodes: BrandedArray<Semantic.BlockScopeId, Semantic.BlockScope>;
  symbolNodes: BrandedArray<Semantic.SymbolId, Semantic.Symbol>;
  exprNodes: BrandedArray<Semantic.ExprId, Semantic.Expression>;
  statementNodes: BrandedArray<Semantic.StatementId, Semantic.Statement>;
  typeDefNodes: BrandedArray<Semantic.TypeDefId, Semantic.TypeDef>;
  typeUseNodes: BrandedArray<Semantic.TypeUseId, Semantic.TypeUse>;

  overloadedOperators: Semantic.FunctionSymbol[];

  elaboratedFunctionSignatures: Map<Collect.SymbolId, Semantic.SymbolId[]>;
  elaboratedFunctionSignaturesByName: Map<string, Semantic.SymbolId[]>;

  elaboratedStructDatatypes: StructDefCache;
  elaboratedFuncdefSymbols: FuncDefCache;
  elaboratedNamespaceSymbols: {
    originalSharedInstance: Collect.NSSharedInstanceId;
    substitutionContext: Semantic.ElaborationContext;
    result: Semantic.TypeDefId;
  }[];
  elaboratedEnumSymbols: EnumDefCache;

  // Those are GlobalVariableDefinitionSymbols
  elaboratedGlobalVariableDefinitionSymbols: Set<Semantic.SymbolId>;

  // Those are VariableSymbols
  elaboratedGlobalVariableSymbols: Map<Collect.SymbolId, Semantic.SymbolId>;
  // Function-local variable symbols are cached per function call because they are separate for each generic instance.

  elaboratedPrimitiveTypes: Semantic.TypeDefId[];
  functionTypeCache: Semantic.TypeDefId[];
  deferredFunctionTypeCache: Semantic.TypeDefId[];
  fixedArrayTypeCache: Semantic.TypeDefId[];
  dynamicArrayTypeCache: Semantic.TypeDefId[];
  typeInstanceCache: Semantic.TypeUseId[];

  syntheticFunctions: Map<string, Semantic.SymbolId>;

  syntheticScopeToVariableMap: Map<Collect.ScopeId, Map<string, Semantic.SymbolId>>;

  nextRegexId: bigint;
  elaboratedRegexInternMap: Map<string, bigint>; // This maps the pattern/flag key to the ID
  elaboratedRegexTable: Map<bigint, RegexData>; // This maps the regex ID to the actual data

  exportedCollectedSymbols: Set<number>;

  exportedSymbols: Set<Semantic.SymbolId>;
  exportedTypeAliases: Set<Collect.TypeDefId>;

  cInjections: Semantic.SymbolId[];
  globalMainFunction: Semantic.SymbolId | null;
};

export function makeRawPrimitiveAvailable(
  sr: SemanticResult,
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
  const [_, sId] = Semantic.addType(sr, {
    variant: Semantic.ENode.PrimitiveDatatype,
    primitive: primitive,
    concrete: true,
  });
  sr.elaboratedPrimitiveTypes.push(sId);
  return sId;
}

export function makeVoidType(sr: SemanticResult) {
  return makePrimitiveAvailable(sr, EPrimitive.void, EDatatypeMutability.Default, null);
}

export function makePrimitiveAvailable(
  sr: SemanticResult,
  primitive: EPrimitive,
  mutability: EDatatypeMutability,
  sourceloc: SourceLoc,
): Semantic.TypeUseId {
  return makeTypeUse(sr, makeRawPrimitiveAvailable(sr, primitive), mutability, false, sourceloc)[1];
}

export function isTypeExprConcrete(sr: SemanticResult, id: Semantic.ExprId) {
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

export function isTypeConcrete(sr: SemanticResult, id: Semantic.TypeUseId) {
  const typeInstance = sr.typeUseNodes.get(id);
  const symbol = sr.typeDefNodes.get(typeInstance.type);
  assert("concrete" in symbol);
  return symbol.concrete;
}

export function IsExprDecisiveForOverloadResolution(sr: SemanticResult, exprId: Collect.ExprId) {
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

export namespace Semantic {
  export type SymbolId = Brand<number, "SemanticSymbol">;
  export type StatementId = Brand<number, "SemanticStatement">;
  export type ExprId = Brand<number, "SemanticExpr">;
  export type BlockScopeId = Brand<number, "SemanticBlockScope">;
  export type TypeDefId = Brand<number, "SemanticTypeDef">;
  export type TypeUseId = Brand<number, "SemanticTypeUse">;
  export type InstanceId = Brand<number, "SemanticInstance">;

  export enum ENode {
    CInjectDirectiveSymbol,
    // Symbols
    VariableSymbol,
    GlobalVariableDefinitionSymbol,
    FunctionSymbol,
    FunctionSignature,
    StructSignature,
    TypeDefSymbol,
    // Datatypes
    FunctionDatatype,
    DeferredFunctionDatatype,
    BlockScope,
    EnumDatatype,
    StructDatatype,
    CallableDatatype,
    ParameterPackDatatype,
    PrimitiveDatatype,
    GenericParameterDatatype,
    NamespaceDatatype,
    FixedArrayDatatype,
    DynamicArrayDatatype,
    SliceDatatype,
    UntaggedUnionDatatype,
    TaggedUnionDatatype,
    UnionTagRefDatatype,
    // Statements
    InlineCStatement,
    WhileStatement,
    IfStatement,
    ForStatement,
    VariableStatement,
    ExprStatement,
    BlockScopeExpr,
    ReturnStatement,
    RaiseStatement,
    // Expressions
    ParenthesisExpr,
    AttemptErrorPropagationExpr,
    BinaryExpr,
    LiteralExpr,
    UnaryExpr,
    ExprCallExpr,
    SymbolValueExpr,
    DatatypeAsValueExpr,
    UnionTagReferenceExpr,
    SizeofExpr,
    AlignofExpr,
    ExplicitCastExpr,
    AttemptExpr,
    ValueToUnionCastExpr,
    UnionToValueCastExpr,
    UnionToUnionCastExpr,
    UnionTagCheckExpr,
    MemberAccessExpr,
    CallableExpr,
    AddressOfExpr,
    DereferenceExpr,
    ExprAssignmentExpr,
    StructLiteralExpr,
    PreIncrExpr,
    PostIncrExpr,
    ArrayLiteralExpr,
    ArraySubscriptExpr,
    ArraySliceExpr,
    StringSubscriptExpr,
    StringConstructExpr,
    // Dummy
    Dummy,
  }

  export function addBlockScope<T extends Semantic.BlockScope>(
    sr: SemanticResult,
    n: T,
  ): [T, BlockScopeId] {
    return pushBrandedNode(sr.blockScopeNodes, n) as [T, BlockScopeId];
  }

  export function addTypeInstance<T extends Semantic.TypeUse>(
    sr: SemanticResult,
    n: T,
  ): [T, TypeUseId] {
    return pushBrandedNode(sr.typeUseNodes, n) as [T, TypeUseId];
  }

  export function addStatement<T extends Semantic.Statement>(
    sr: SemanticResult,
    n: T,
  ): [T, StatementId] {
    return pushBrandedNode(sr.statementNodes, n) as [T, StatementId];
  }

  export function addType<T extends Semantic.TypeDef>(sr: SemanticResult, n: T): [T, TypeDefId] {
    return pushBrandedNode(sr.typeDefNodes, n) as [T, TypeDefId];
  }

  export function addSymbol<T extends Semantic.Symbol>(sr: SemanticResult, n: T): [T, SymbolId] {
    return pushBrandedNode(sr.symbolNodes, n) as [T, SymbolId];
  }

  export function addExpr<T extends Semantic.Expression>(sr: SemanticResult, n: T): [T, ExprId] {
    return pushBrandedNode(sr.exprNodes, n) as [T, ExprId];
  }

  export type ConstraintValue =
    | {
        kind: "comparison";
        operation: EBinaryOperation;
        value: Semantic.ExprId;
      }
    | {
        kind: "union";
        operation: "is" | "isNot";
        typeUse?: Semantic.TypeUseId;
        typeDef?: Semantic.TypeDefId;
      };

  export type Constraint = {
    variableSymbol: Semantic.SymbolId;
    constraintValue: ConstraintValue;
  };

  export type CInjectDirectiveSymbol = {
    variant: ENode.CInjectDirectiveSymbol;
    value: string;
    sourceloc: SourceLoc;
  };

  export type VariableSymbol = {
    variant: ENode.VariableSymbol;
    name: string;
    memberOfStruct: TypeDefId | null;
    type: TypeUseId | null;
    mutability: EVariableMutability;
    export: boolean;
    extern: EExternLanguage;
    variableContext: EVariableContext;
    parentStructOrNS: TypeDefId | null;
    sourceloc: SourceLoc;
    comptime: boolean;
    comptimeValue: ExprId | null;
    concrete: boolean;
  };

  export type GlobalVariableDefinitionSymbol = {
    variant: ENode.GlobalVariableDefinitionSymbol;
    variableSymbol: SymbolId;
    name: string;
    value: ExprId | null;
    export: boolean;
    extern: EExternLanguage;
    parentStructOrNS: TypeDefId | null;
    sourceloc: SourceLoc;
    comptime: boolean;
    concrete: boolean;
  };

  export type FunctionSignature = {
    variant: ENode.FunctionSignature;
    originalFunction: Collect.SymbolId;
    genericPlaceholders: Semantic.TypeDefId[];
    name: string;
    extern: EExternLanguage;
    parentStructOrNS: TypeDefId | null;
    parameters: {
      name: string;
      type: TypeUseId;
    }[];
    returnType: Semantic.TypeUseId | null;
  };

  export type FunctionSymbol = {
    variant: ENode.FunctionSymbol;
    staticMethod: boolean;
    name: string;
    type: TypeDefId;
    noemit: boolean;
    generics: Semantic.ExprId[];
    parameterNames: string[];
    parameterPack: boolean;
    methodRequiredMutability: EDatatypeMutability.Const | EDatatypeMutability.Mut | null;
    extern: EExternLanguage;
    scope: Semantic.BlockScopeId | null;
    overloadedOperator?: EOverloadedOperator;
    export: boolean;
    createsInstanceIds: Set<Semantic.InstanceId>;
    returnsInstanceIds: Set<Semantic.InstanceId>;
    returnStatements: Set<Semantic.StatementId>;
    isImpure: boolean;
    returnedDatatypes: Set<Semantic.TypeUseId>;
    instanceDepsSnapshot: InstanceDeps;
    annotatedReturnType: Semantic.TypeUseId | null;
    methodType: EMethodType;
    methodOf: TypeDefId | null;
    sourceloc: SourceLoc;
    parentStructOrNS: TypeDefId | null;
    originalCollectedFunction: Collect.SymbolId;
    concrete: boolean;
  };

  export type TypeDefSymbol = {
    variant: ENode.TypeDefSymbol;
    datatype: TypeDefId;
  };

  export type BlockScope = {
    variant: ENode.BlockScope;
    statements: StatementId[];
    emittedExpr: ExprId;
    constraints: Constraint[];
    sourceloc: SourceLoc;
  };

  export type FunctionRequireBlock = {
    final: boolean;
    pure: boolean;
    noreturn: boolean;
    noreturnIf: {
      expr: Collect.ExprId;
    } | null;
  };

  export type FunctionDatatypeDef = {
    variant: ENode.FunctionDatatype;
    parameters: {
      optional: boolean;
      type: TypeUseId;
    }[];
    returnType: TypeUseId;
    vararg: boolean;
    requires: FunctionRequireBlock;
    concrete: boolean;
  };

  export type DeferredFunctionDatatypeDef = {
    variant: ENode.DeferredFunctionDatatype;
    parameters: {
      optional: boolean;
      type: TypeUseId;
    }[];
    vararg: boolean;
    concrete: boolean;
  };

  export type EnumValue = {
    name: string;
    type: TypeUseId;
    valueExpr: ExprId; // This is the actual integer value, used for code generation (e.g. 0 or "red")
    literalExpr: ExprId; // This is the high level literal, used for further elaboration (e.g. Color.Red)
  };

  export type EnumDatatypeDef = {
    variant: ENode.EnumDatatype;
    name: string;
    noemit: boolean;
    export: boolean;
    extern: EExternLanguage;
    values: EnumValue[];
    parentStructOrNS: TypeDefId | null;
    sourceloc: SourceLoc;
    type: TypeUseId;
    concrete: boolean;
    originalCollectedSymbol: Collect.TypeDefId;
  };

  export type StructDatatypeDef = {
    variant: ENode.StructDatatype;
    name: string;
    noemit: boolean;
    generics: ExprId[];
    opaque: boolean;
    plain: boolean;
    export: boolean;
    extern: EExternLanguage;
    members: Semantic.SymbolId[];
    memberDefaultValues: {
      memberName: string;
      value: Semantic.ExprId;
    }[];
    methods: Semantic.SymbolId[];
    nestedStructs: Semantic.TypeDefId[];
    parentStructOrNS: TypeDefId | null;
    sourceloc: SourceLoc;
    concrete: boolean;
    originalCollectedDefinition: Collect.TypeDefId;
    originalCollectedSymbol: Collect.SymbolId;
  };

  export type ParameterPackDatatypeDef = {
    variant: ENode.ParameterPackDatatype;
    parameters: Semantic.SymbolId[] | null;
    concrete: boolean;
  };

  export type CallableDatatypeDef = {
    variant: ENode.CallableDatatype;
    thisExprType?: TypeUseId;
    functionType: TypeDefId;
    concrete: boolean;
  };

  export type PrimitiveDatatypeDef = {
    variant: ENode.PrimitiveDatatype;
    primitive: EPrimitive;
    concrete: boolean;
  };

  export type FixedArrayDatatypeDef = {
    variant: ENode.FixedArrayDatatype;
    datatype: TypeUseId;
    length: bigint;
    concrete: boolean;
  };

  export type DynamicArrayDatatypeDef = {
    variant: ENode.DynamicArrayDatatype;
    datatype: TypeUseId;
    concrete: boolean;
  };

  export type SliceDatatypeDef = {
    variant: ENode.SliceDatatype;
    datatype: TypeUseId;
    concrete: boolean;
  };

  export type UntaggedUnionDatatypeDef = {
    variant: ENode.UntaggedUnionDatatype;
    members: TypeUseId[];
    concrete: boolean;
  };

  export type TaggedUnionDatatypeDef = {
    variant: ENode.TaggedUnionDatatype;
    members: {
      tag: string;
      type: TypeUseId;
    }[];
    nodiscard: boolean;
    concrete: boolean;
  };

  export type UnionTagRefDatatypeDef = {
    variant: ENode.UnionTagRefDatatype;
    concrete: boolean;
  };

  export type GenericParameterDatatypeDef = {
    variant: ENode.GenericParameterDatatype;
    name: string;
    collectedParameter: Collect.SymbolId;
    concrete: boolean;
  };

  export type NamespaceDatatypeDef = {
    variant: ENode.NamespaceDatatype;
    name: string;
    export: boolean;
    parentStructOrNS: TypeDefId | null;
    symbols: Semantic.SymbolId[];
    collectedNamespace: Collect.TypeDefId;
    concrete: boolean; // For consistency, always true
  };

  export type TypeDef =
    | GenericParameterDatatypeDef
    | NamespaceDatatypeDef
    | DeferredFunctionDatatypeDef
    | FunctionDatatypeDef
    | StructDatatypeDef
    | EnumDatatypeDef
    | FixedArrayDatatypeDef
    | DynamicArrayDatatypeDef
    | SliceDatatypeDef
    | ParameterPackDatatypeDef
    | UntaggedUnionDatatypeDef
    | TaggedUnionDatatypeDef
    | CallableDatatypeDef
    | PrimitiveDatatypeDef
    | UnionTagRefDatatypeDef;

  export type TypeUse = {
    type: TypeDefId;
    mutability: EDatatypeMutability;
    inline: boolean;
    sourceloc: SourceLoc;
  };

  export type Symbol =
    | CInjectDirectiveSymbol
    | VariableSymbol
    | GlobalVariableDefinitionSymbol
    | FunctionSignature
    | TypeDefSymbol
    | FunctionSymbol;

  export type ExprMemberAccessExpr = {
    variant: ENode.MemberAccessExpr;
    instanceIds: InstanceId[];
    expr: ExprId;
    memberName: string;
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type CallableExpr = {
    variant: ENode.CallableExpr;
    instanceIds: InstanceId[];
    thisExpr: ExprId;
    functionSymbol: SymbolId;
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type SymbolValueExpr = {
    variant: ENode.SymbolValueExpr;
    instanceIds: InstanceId[];
    symbol: SymbolId;
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type DatatypeAsValueExpr = {
    variant: ENode.DatatypeAsValueExpr;
    instanceIds: InstanceId[];
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type UnionTagReferenceExpr = {
    variant: ENode.UnionTagReferenceExpr;
    instanceIds: InstanceId[];
    unionType: TypeDefId;
    tag: string;
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type SizeofExpr = {
    variant: ENode.SizeofExpr;
    instanceIds: InstanceId[];
    valueExpr: ExprId;
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type AlignofExpr = {
    variant: ENode.AlignofExpr;
    instanceIds: InstanceId[];
    valueExpr: ExprId;
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type ExprAssignmentExpr = {
    variant: ENode.ExprAssignmentExpr;
    instanceIds: InstanceId[];
    value: ExprId;
    target: ExprId;
    type: TypeUseId;
    operation: EAssignmentOperation;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type DereferenceExpr = {
    variant: ENode.DereferenceExpr;
    instanceIds: InstanceId[];
    expr: ExprId;
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type AddressOfExpr = {
    variant: ENode.AddressOfExpr;
    instanceIds: InstanceId[];
    expr: ExprId;
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type ExplicitCastExpr = {
    variant: ENode.ExplicitCastExpr;
    instanceIds: InstanceId[];
    expr: ExprId;
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type AttemptExpr = {
    variant: ENode.AttemptExpr;
    instanceIds: InstanceId[];
    attemptScopeExpr: ExprId;
    attemptScopeReturnsType: TypeUseId | null;
    elseScopeExpr: ExprId;
    elseScopeReturnsType: TypeUseId | null;
    errorTypesCaught: Set<TypeUseId>;
    errorLabel: string;
    resultLabel: string;
    errorResultVarname: string;
    errorUnionType: TypeUseId;
    uniqueId: bigint;
    hasErrorVar: boolean;
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type ValueToUnionCastExpr = {
    variant: ENode.ValueToUnionCastExpr;
    instanceIds: InstanceId[];
    expr: ExprId;
    type: TypeUseId;
    index: number;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type UnionToValueCastExpr = {
    variant: ENode.UnionToValueCastExpr;
    instanceIds: InstanceId[];
    expr: ExprId;
    type: TypeUseId;
    canBeUnwrappedForLHS: boolean; // This is if the cast originates from a constrained symbol value access
    tag: number;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type UnionToUnionCastExpr = {
    variant: ENode.UnionToUnionCastExpr;
    instanceIds: InstanceId[];
    expr: ExprId;
    type: TypeUseId;
    castComesFromNarrowingAndMayBeUnwrapped: boolean;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type UnionTagCheckExpr = {
    variant: ENode.UnionTagCheckExpr;
    instanceIds: InstanceId[];
    expr: ExprId;
    type: TypeUseId;
    comparisonTypesAnd: TypeUseId[];
    invertCheck: boolean;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type AttemptErrorPropagationExpr = {
    variant: ENode.AttemptErrorPropagationExpr;
    instanceIds: InstanceId[];
    expr: ExprId;
    type: TypeUseId;
    srcOkTagIndex: number;
    srcOkTagType: TypeUseId;
    srcErrTagIndex: number;
    srcErrTagType: TypeUseId;
    toAttemptExpr: ExprId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type BinaryExpr = {
    variant: ENode.BinaryExpr;
    instanceIds: InstanceId[];
    left: ExprId;
    right: ExprId;
    operation: EBinaryOperation;
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type UnaryExpr = {
    variant: ENode.UnaryExpr;
    instanceIds: InstanceId[];
    expr: ExprId;
    operation: EUnaryOperation;
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type PostIncrExpr = {
    variant: ENode.PostIncrExpr;
    instanceIds: InstanceId[];
    expr: ExprId;
    operation: EIncrOperation;
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type PreIncrExpr = {
    variant: ENode.PreIncrExpr;
    instanceIds: InstanceId[];
    expr: ExprId;
    operation: EIncrOperation;
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type ExprCallExpr = {
    variant: ENode.ExprCallExpr;
    instanceIds: InstanceId[];
    calledExpr: ExprId;
    arguments: ExprId[];
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type StructLiteralExpr = {
    variant: ENode.StructLiteralExpr;
    instanceIds: InstanceId[];
    assign: {
      name: string;
      value: ExprId;
    }[];
    type: TypeUseId;
    inFunction: SymbolId | null;
    allocator: ExprId | null;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type LiteralExpr = {
    variant: ENode.LiteralExpr;
    instanceIds: InstanceId[];
    literal: LiteralValue;
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type ArrayLiteralExpr = {
    variant: ENode.ArrayLiteralExpr;
    instanceIds: InstanceId[];
    elements: ExprId[];
    type: TypeUseId;
    inFunction: SymbolId | null;
    allocator: ExprId | null;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type ArraySubscriptExpr = {
    variant: ENode.ArraySubscriptExpr;
    instanceIds: InstanceId[];
    expr: ExprId;
    indices: ExprId[];
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type ArraySliceExpr = {
    variant: ENode.ArraySliceExpr;
    instanceIds: InstanceId[];
    expr: ExprId;
    indices: {
      start: ExprId | null;
      end: ExprId | null;
    }[];
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type StringSubscriptExpr = {
    variant: ENode.StringSubscriptExpr;
    instanceIds: InstanceId[];
    expr: ExprId;
    index: ExprId;
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type StringConstructExpr = {
    variant: ENode.StringConstructExpr;
    instanceIds: InstanceId[];
    value: {
      variant: "data-length";
      data: ExprId;
      length: ExprId;
    };
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type BlockScopeExpr = {
    variant: ENode.BlockScopeExpr;
    instanceIds: InstanceId[];
    block: BlockScopeId;
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type Expression =
    | ExprMemberAccessExpr
    | SymbolValueExpr
    | DatatypeAsValueExpr
    | UnionTagReferenceExpr
    | SizeofExpr
    | AlignofExpr
    | BlockScopeExpr
    | ExprAssignmentExpr
    | UnaryExpr
    | BinaryExpr
    | CallableExpr
    | PreIncrExpr
    | PostIncrExpr
    | AddressOfExpr
    | DereferenceExpr
    | ExplicitCastExpr
    | AttemptExpr
    | ValueToUnionCastExpr
    | StringSubscriptExpr
    | UnionToValueCastExpr
    | UnionToUnionCastExpr
    | UnionTagCheckExpr
    | AttemptErrorPropagationExpr
    | ExprCallExpr
    | StructLiteralExpr
    | LiteralExpr
    | ArrayLiteralExpr
    | ArraySubscriptExpr
    | ArraySliceExpr
    | StringConstructExpr;

  // =============================================

  export type InlineCStatement = {
    variant: ENode.InlineCStatement;
    value: string;
    sourceloc: SourceLoc;
  };

  export type ReturnStatement = {
    variant: ENode.ReturnStatement;
    expr?: ExprId;
    sourceloc: SourceLoc;
  };

  export type RaiseStatement = {
    variant: ENode.RaiseStatement;
    expr: ExprId;
    toAttemptExpr: ExprId;
    sourceloc: SourceLoc;
  };

  export type IfStatement = {
    variant: ENode.IfStatement;
    isLetBinding: boolean;
    condition: ExprId;
    then: BlockScopeId;
    elseIfs: {
      condition: ExprId;
      then: BlockScopeId;
    }[];
    else?: BlockScopeId;
    sourceloc: SourceLoc;
  };

  export type ForStatement = {
    variant: ENode.ForStatement;
    initStatement: StatementId | null;
    loopCondition: ExprId | null;
    loopIncrement: ExprId | null;
    body: BlockScopeId;
    sourceloc: SourceLoc;
  };

  export type WhileStatement = {
    variant: ENode.WhileStatement;
    isLetBinding: boolean;
    condition: ExprId;
    then: BlockScopeId;
    sourceloc: SourceLoc;
  };

  export type VariableStatement = {
    variant: ENode.VariableStatement;
    name: string;
    value: ExprId | null;
    comptime: boolean;
    variableSymbol: SymbolId;
    sourceloc: SourceLoc;
  };

  export type ExprStatement = {
    variant: ENode.ExprStatement;
    expr: ExprId;
    sourceloc: SourceLoc;
  };

  export type Statement =
    | InlineCStatement
    | ReturnStatement
    | RaiseStatement
    | VariableStatement
    | IfStatement
    | ForStatement
    | WhileStatement
    | ExprStatement;

  export function canonicalizeGenericExpr(sr: SemanticResult, exprId: Semantic.ExprId) {
    const expr = sr.exprNodes.get(exprId);
    if (expr.variant === Semantic.ENode.DatatypeAsValueExpr) {
      return expr.type.toString();
    } else if (expr.variant === Semantic.ENode.LiteralExpr) {
      if (expr.literal.type === EPrimitive.null) {
        return "null";
      } else if (expr.literal.type === EPrimitive.none) {
        return "none";
      } else if (expr.literal.type === EPrimitive.Regex) {
        return "Regex";
      } else if (expr.literal.type === "enum") {
        return expr.literal.enumType.toString() + "|" + expr.literal.valueName;
      } else {
        return primitiveToString(expr.literal.type) + "_" + expr.literal.value.toString();
      }
    } else {
      throw new CompilerError(
        `This expression is not suitable as a generic type argument or literal value`,
        expr.sourceloc,
      );
    }
  }

  export function tryLookupSymbol(
    sr: SemanticResult,
    name: string,
    args: { startLookupInScope: Collect.ScopeId; sourceloc: SourceLoc; pubRequired?: boolean },
  ):
    | { type: "semantic"; id: Semantic.ExprId }
    | { type: "collect"; id: Collect.SymbolId }
    | undefined {
    const cc = sr.cc;
    const scope = cc.scopeNodes.get(args.startLookupInScope);

    if (sr.syntheticScopeToVariableMap.has(args.startLookupInScope)) {
      const map = sr.syntheticScopeToVariableMap.get(args.startLookupInScope)!;
      if (map.has(name)) {
        const symbolId = map.get(name)!;
        const symbol = sr.symbolNodes.get(symbolId);
        assert(symbol.variant === Semantic.ENode.VariableSymbol);
        assert(symbol.type);
        return {
          id: sr.b.symbolValue(symbolId, args.sourceloc)[1],
          type: "semantic",
        };
      }
    }

    const lookupDirect = (symbols: Set<Collect.SymbolId>) => {
      for (const id of symbols) {
        const s = cc.symbolNodes.get(id);
        if (s.variant === Collect.ENode.FunctionOverloadGroupSymbol && s.name === name) {
          if (
            [...s.overloads].some((o) => {
              const func = cc.symbolNodes.get(o);
              assert(func.variant === Collect.ENode.FunctionSymbol);
              return !args.pubRequired || func.pub;
            })
          ) {
            return id;
          }
        } else if (s.variant === Collect.ENode.TypeDefSymbol && s.name === name) {
          const typedef = sr.cc.typeDefNodes.get(s.typeDef);
          if (typedef.variant === Collect.ENode.StructTypeDef && typedef.name === name) {
            if (!args.pubRequired || typedef.pub) {
              return id;
            }
          } else if (typedef.variant === Collect.ENode.NamespaceTypeDef && typedef.name === name) {
            if (!args.pubRequired || typedef.pub) {
              // Caution: This lookup needs to return the actual namespace definition and NOT the shared instance.
              // Because the lookup must also resolve generics and to do that, it needs to know the correct scopes
              // and the parent scope stack must be valid, which is not the case with the shared instance as it has multiple.
              return id;
            }
          } else if (typedef.variant === Collect.ENode.TypeDefAlias && typedef.name === name) {
            return id;
          } else if (typedef.variant === Collect.ENode.EnumTypeDef && typedef.name === name) {
            return id;
          }
        } else if (s.variant === Collect.ENode.GenericTypeParameterSymbol && s.name === name) {
          return id;
        } else if (s.variant === Collect.ENode.VariableSymbol && s.name === name) {
          if (!args.pubRequired) {
            return id;
          }
        }
      }
    };

    switch (scope.variant) {
      case Collect.ENode.NamespaceScope: {
        const ns = cc.symbolNodes.get(scope.owningSymbol);
        assert(ns.variant === Collect.ENode.TypeDefSymbol);
        const nsTd = cc.typeDefNodes.get(ns.typeDef);
        assert(nsTd.variant === Collect.ENode.NamespaceTypeDef);
        const instance = cc.nsSharedInstances.get(nsTd.sharedInstance);
        assert(instance.variant === Collect.ENode.NamespaceSharedInstance);
        for (const nsScope of instance.namespaceScopes) {
          const sc = cc.scopeNodes.get(nsScope);
          assert(sc.variant === Collect.ENode.NamespaceScope);
          const found = lookupDirect(sc.symbols);
          if (found) {
            return {
              id: found,
              type: "collect",
            };
          }
        }
        return tryLookupSymbol(sr, name, {
          startLookupInScope: scope.parentScope,
          sourceloc: args.sourceloc,
        });
      }

      case Collect.ENode.ModuleScope:
      case Collect.ENode.UnitScope:
      case Collect.ENode.FileScope:
      case Collect.ENode.BlockScope:
      case Collect.ENode.TypeDefScope:
      case Collect.ENode.StructLexicalScope:
      case Collect.ENode.FunctionScope: {
        const found = lookupDirect(scope.symbols);
        if (found) {
          return {
            id: found,
            type: "collect",
          };
        }

        if (scope.variant === Collect.ENode.ModuleScope) {
          return undefined;
        }

        if (scope.variant === Collect.ENode.FileScope) {
          // File Scope -> Don't go higher but look in adjacent files in the same unit, then go higher
          const unitScope = cc.scopeNodes.get(scope.parentScope);
          assert(unitScope.variant === Collect.ENode.UnitScope);

          for (const file of unitScope.scopes) {
            if (file === args.startLookupInScope) continue; // Prevent infinite recursion with itself

            const fileScope = cc.scopeNodes.get(file);
            assert(fileScope.variant === Collect.ENode.FileScope);

            const found = lookupDirect(fileScope.symbols);
            if (found) {
              return {
                id: found,
                type: "collect",
              };
            }
          }

          return tryLookupSymbol(sr, name, {
            startLookupInScope: scope.parentScope,
            sourceloc: args.sourceloc,
          });
        } else {
          // Not a file scope -> Can go higher
          return tryLookupSymbol(sr, name, {
            startLookupInScope: scope.parentScope,
            sourceloc: args.sourceloc,
          });
        }
      }

      default:
        assert(false, "Unknown scope type: " + (scope as any).variant);
    }
  }

  export function lookupSymbol(
    sr: SemanticResult,
    name: string,
    args: { startLookupInScope: Collect.ScopeId; sourceloc: SourceLoc },
  ) {
    const found = tryLookupSymbol(sr, name, args);
    if (found) return found;
    throw new CompilerError(`Symbol '${name}' was not declared in this scope`, args.sourceloc);
  }

  export function findBuiltinSymbolByName(
    sr: SemanticResult,
    symbolPath: string,
    sourceloc: SourceLoc,
  ): Collect.SymbolId {
    const names = symbolPath.split(".");

    let scope = sr.cc.moduleScopeId;
    let symbolId: Collect.SymbolId | undefined;

    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const isLast = i === names.length - 1;

      const symbolResult = tryLookupSymbol(sr, name, {
        startLookupInScope: scope,
        sourceloc,
      });

      if (!symbolResult) {
        throw new InternalError(
          `Symbol '${symbolPath}' was expected to be defined but '${name}' could not be found`,
        );
      }

      if (symbolResult.type === "semantic") {
        throw new InternalError(`Symbol '${name}' resolved to a semantic expression, not a symbol`);
      }
      symbolId = symbolResult.id;

      const symbol = sr.cc.symbolNodes.get(symbolId);
      if (!isLast) {
        // Intermediate symbol must introduce a scope
        if (symbol.variant !== Collect.ENode.TypeDefSymbol) {
          throw new InternalError(
            `Symbol '${name}' of '${symbolPath}' was expected to be a namespace or struct, but it is not`,
          );
        }

        const symbolDef = sr.cc.typeDefNodes.get(symbol.typeDef);
        if (symbolDef.variant === Collect.ENode.StructTypeDef) {
          scope = symbolDef.lexicalScope;
        } else if (symbolDef.variant === Collect.ENode.NamespaceTypeDef) {
          scope = symbolDef.namespaceScope;
        } else {
          throw new InternalError(
            `Symbol '${name}' of '${symbolPath}' was expected to be a namespace or struct, but it is not`,
          );
        }
      }
    }

    assert(symbolId);
    return symbolId;
  }

  export function getInstanceDepsGraph(deps: InstanceDeps, instanceIds: Set<Semantic.InstanceId>) {
    const instances = new Set<Semantic.InstanceId>();

    const processInstance = (inst: Semantic.InstanceId) => {
      if (instances.has(inst)) {
        return;
      }

      instances.add(inst);
      getInstanceDeps(deps, inst).forEach((d) => {
        processInstance(d);
      });
      getAllStructMemberInstanceDeps(deps, inst).forEach((d) => {
        processInstance(d);
      });
    };

    instanceIds.forEach((d) => {
      processInstance(d);
    });
    return instances;
  }

  export function getSymbolDeps(deps: InstanceDeps, symbolId: Semantic.SymbolId) {
    let map = deps.symbolDependsOn.get(symbolId);
    if (!map) {
      return [];
    }

    return [...map];
  }

  export function addSymbolDeps(
    context: ElaborationContext,
    symbolId: Semantic.SymbolId,
    dependency: Semantic.InstanceId | Semantic.InstanceId[],
  ) {
    let map = context.instanceDeps.symbolDependsOn.get(symbolId);

    if (!map) {
      const set = new Set<Semantic.InstanceId>();
      context.instanceDeps.symbolDependsOn.set(symbolId, set);
      map = set;
    }

    if (Array.isArray(dependency)) {
      for (const d of dependency) {
        map.add(d);
      }
    } else {
      map.add(dependency);
    }
  }

  export function getInstanceDeps(deps: InstanceDeps, instanceId: Semantic.InstanceId) {
    let map = deps.instanceDependsOn.get(instanceId);
    if (!map) {
      return [];
    }

    return [...map];
  }

  export function addInstanceDeps(
    deps: InstanceDeps,
    instanceId: Semantic.InstanceId,
    dependency: Semantic.InstanceId | Semantic.InstanceId[],
  ) {
    let map = deps.instanceDependsOn.get(instanceId);

    if (!map) {
      const set = new Set<Semantic.InstanceId>();
      deps.instanceDependsOn.set(instanceId, set);
      map = set;
    }

    if (Array.isArray(dependency)) {
      for (const d of dependency) {
        map.add(d);
      }
    } else {
      map.add(dependency);
    }
  }

  export function getAllStructMemberInstanceDeps(
    deps: InstanceDeps,
    instanceId: Semantic.InstanceId,
  ) {
    let innerMap = deps.structMembersDependOn.get(instanceId);
    if (!innerMap) {
      return new Set<Semantic.InstanceId>();
    }

    const all = new Set<Semantic.InstanceId>();
    innerMap.forEach((e, k) => {
      e.forEach((i) => {
        all.add(i);
      });
    });
    return all;
  }

  export function getStructMemberInstanceDeps(
    deps: InstanceDeps,
    instanceId: Semantic.InstanceId,
    member: Semantic.SymbolId,
  ) {
    let innerMap = deps.structMembersDependOn.get(instanceId);
    if (!innerMap) {
      return new Set<Semantic.InstanceId>();
    }

    let set = innerMap.get(member);
    if (!set) {
      set = new Set<Semantic.InstanceId>();
      innerMap.set(member, set);
    }

    return [...set];
  }

  export function addStructMemberInstanceDeps(
    deps: InstanceDeps,
    instanceId: Semantic.InstanceId,
    member: Semantic.SymbolId,
    dependency: Semantic.InstanceId | Semantic.InstanceId[],
  ) {
    let innerMap = deps.structMembersDependOn.get(instanceId);
    if (!innerMap) {
      innerMap = new Map<Semantic.SymbolId, Set<Semantic.InstanceId>>();
      deps.structMembersDependOn.set(instanceId, innerMap);
    }

    let set = innerMap.get(member);
    if (!set) {
      set = new Set<Semantic.InstanceId>();
      innerMap.set(member, set);
    }

    if (Array.isArray(dependency)) {
      for (const d of dependency) {
        set.add(d);
      }
    } else {
      set.add(dependency);
    }
  }

  export type InstanceDeps = {
    instanceDependsOn: Map<Semantic.InstanceId, Set<Semantic.InstanceId>>;
    structMembersDependOn: Map<
      Semantic.InstanceId,
      Map<Semantic.SymbolId, Set<Semantic.InstanceId>>
    >;
    symbolDependsOn: Map<Semantic.SymbolId, Set<Semantic.InstanceId>>;
  };

  export type ElaborationContext = {
    substitute: Map<Collect.SymbolId, Semantic.ExprId>;
    currentScope: Collect.ScopeId; // This is the scope in which we are elaborating and it changes (e.g. A<i32> when elaborating A<i32>.B)
    genericsScope: Collect.ScopeId; // This is the scope for generics which does not change (e.g. A<i32>.B<u8> => i32 and u8 are elaborated in the same scope)
    constraints: Constraint[];
    instanceDeps: InstanceDeps;

    elaborationTypeOverride: Map<Collect.SymbolId, Semantic.TypeUseId>;
    elaboratedVariables: Map<Collect.SymbolId, Semantic.SymbolId>;
    scopeNoReturn: Set<Collect.ScopeId>;
    scopeNoFallthrough: Set<Collect.ScopeId>;
    scopeCanExitEarly: Set<Collect.ScopeId>;
    scopeWillExitEarly: Set<Collect.ScopeId>;
  };

  export function makeElaborationContext(args: {
    currentScope: Collect.ScopeId;
    genericsScope: Collect.ScopeId;
    constraints: Constraint[];
  }): ElaborationContext {
    return {
      substitute: new Map(),
      constraints: args.constraints,
      currentScope: args.currentScope,
      genericsScope: args.genericsScope,
      instanceDeps: {
        instanceDependsOn: new Map(),
        structMembersDependOn: new Map(),
        symbolDependsOn: new Map(),
      },
      scopeNoReturn: new Set(),
      scopeCanExitEarly: new Set(),
      scopeNoFallthrough: new Set(),
      scopeWillExitEarly: new Set(),
      elaboratedVariables: new Map(),
      elaborationTypeOverride: new Map(),
    };
  }

  export function isolateElaborationContext(
    parent: ElaborationContext,
    args: {
      currentScope: Collect.ScopeId;
      genericsScope: Collect.ScopeId;
      constraints: Constraint[];
      instanceDeps: InstanceDeps;
    },
  ): ElaborationContext {
    return {
      substitute: new Map(parent.substitute),
      constraints: [...args.constraints],
      currentScope: args.currentScope,
      genericsScope: args.genericsScope,
      instanceDeps: args.instanceDeps,

      scopeNoReturn: new Set(parent.scopeNoReturn),
      scopeCanExitEarly: new Set(parent.scopeCanExitEarly),
      scopeWillExitEarly: new Set(parent.scopeWillExitEarly),
      scopeNoFallthrough: new Set(parent.scopeNoFallthrough),
      elaboratedVariables: new Map(parent.elaboratedVariables),
      elaborationTypeOverride: new Map(parent.elaborationTypeOverride),
    };
  }

  export function mergeSubstitutionContext(
    a: ElaborationContext,
    b: ElaborationContext,
    args: {
      currentScope: Collect.ScopeId;
      genericsScope: Collect.ScopeId;
      instanceDeps: InstanceDeps;
    },
  ): ElaborationContext {
    // THE ORDER OF [a, b] IS VERY IMPORTANT, DO NOT MIX UP!!!
    return {
      substitute: new Map([...a.substitute, ...b.substitute]),
      constraints: [...a.constraints, ...b.constraints],
      currentScope: args.currentScope,
      genericsScope: args.genericsScope,
      instanceDeps: args.instanceDeps,
      scopeNoReturn: new Set([...a.scopeNoReturn, ...b.scopeNoReturn]),
      scopeCanExitEarly: new Set([...a.scopeCanExitEarly, ...b.scopeCanExitEarly]),
      scopeWillExitEarly: new Set([...a.scopeWillExitEarly, ...b.scopeWillExitEarly]),
      scopeNoFallthrough: new Set([...a.scopeNoFallthrough, ...b.scopeNoFallthrough]),
      elaboratedVariables: new Map([...a.elaboratedVariables, ...b.elaboratedVariables]),
      elaborationTypeOverride: new Map([
        ...a.elaborationTypeOverride,
        ...b.elaborationTypeOverride,
      ]),
    };
  }

  export function makeInstanceId(sr: SemanticResult) {
    return sr.nextInstanceId++ as Semantic.InstanceId;
  }

  export function SemanticallyAnalyze(
    moduleCompiler: ModuleCompiler,
    cc: CollectionContext,
    isLibrary: boolean,
    moduleName: string,
    moduleVersion: string,
  ) {
    const sr: SemanticResult = {
      overloadedOperators: [],

      moduleCompiler: moduleCompiler,
      cc: cc,

      e: undefined as any,
      b: undefined as any,

      nextInstanceId: 1 as Semantic.InstanceId,

      elaboratedFunctionSignatures: new Map(),
      elaboratedFunctionSignaturesByName: new Map(),

      elaboratedStructDatatypes: new Map(),
      elaboratedFuncdefSymbols: new Map(),
      elaboratedEnumSymbols: new Map(),
      elaboratedPrimitiveTypes: [],
      elaboratedNamespaceSymbols: [],
      elaboratedGlobalVariableDefinitionSymbols: new Set(),
      functionTypeCache: [],
      deferredFunctionTypeCache: [],
      fixedArrayTypeCache: [],
      dynamicArrayTypeCache: [],
      typeInstanceCache: [],

      syntheticFunctions: new Map(),

      blockScopeNodes: new BrandedArray<Semantic.BlockScopeId, Semantic.BlockScope>([]),
      symbolNodes: new BrandedArray<Semantic.SymbolId, Semantic.Symbol>([]),
      typeDefNodes: new BrandedArray<Semantic.TypeDefId, Semantic.TypeDef>([]),
      statementNodes: new BrandedArray<Semantic.StatementId, Semantic.Statement>([]),
      typeUseNodes: new BrandedArray<Semantic.TypeUseId, Semantic.TypeUse>([]),
      exprNodes: new BrandedArray<Semantic.ExprId, Semantic.Expression>([]),

      syntheticScopeToVariableMap: new Map(),

      exportedCollectedSymbols: new Set(),
      elaboratedGlobalVariableSymbols: new Map(),
      exportedTypeAliases: new Set(),

      elaboratedRegexInternMap: new Map(),
      elaboratedRegexTable: new Map(),
      nextRegexId: 0n,

      cInjections: [],
      globalMainFunction: null,

      exportedSymbols: new Set(),
    };

    const context = makeElaborationContext({
      currentScope: cc.moduleScopeId,
      genericsScope: cc.moduleScopeId,
      constraints: [],
    });

    sr.e = new SemanticElaborator(sr, context);
    sr.b = new SemanticBuilder(sr);

    sr.e.topLevelScope(cc.moduleScopeId);

    if (moduleName !== HAZE_STDLIB_NAME) {
      if (!isLibrary) {
        if (!sr.globalMainFunction) {
          throw new CompilerError("No main function is defined in global scope", null);
        }

        const mainFunctionSymbol = sr.symbolNodes.get(sr.globalMainFunction);
        assert(mainFunctionSymbol.variant === Semantic.ENode.FunctionSymbol);
        const mainFunctionType = sr.typeDefNodes.get(mainFunctionSymbol.type);
        assert(mainFunctionType.variant === Semantic.ENode.FunctionDatatype);
        const returnType = sr.typeDefNodes.get(
          sr.typeUseNodes.get(mainFunctionType.returnType).type,
        );
        if (
          returnType.variant !== Semantic.ENode.PrimitiveDatatype ||
          returnType.primitive !== EPrimitive.int
        ) {
          throw new CompilerError("Main function must return int", mainFunctionSymbol.sourceloc);
        }
      } else {
        if (sr.globalMainFunction) {
          throw new CompilerError(
            "main function is defined, but not allowed because module is built as library",
            null,
          );
        }
      }
    }

    return sr;
  }

  export function serializeMutability(typeUse: TypeUse) {
    let s = "";
    if (typeUse.inline) {
      s += "inline ";
    }

    if (typeUse.mutability === EDatatypeMutability.Const) {
      s += "const ";
    } else if (typeUse.mutability === EDatatypeMutability.Mut) {
      s += "mut ";
    }

    return s;
  }

  export function serializeTypeUse(sr: SemanticResult, datatypeId: Semantic.TypeUseId): string {
    const datatype = sr.typeUseNodes.get(datatypeId);
    const names = getNamespaceChainFromDatatype(sr, datatype.type);
    return serializeMutability(datatype) + names.map((n) => n.pretty).join(".");
  }

  export function serializeLiteralType(sr: SemanticResult, value: LiteralValue) {
    if (value.type === "enum") {
      const enumType = sr.typeDefNodes.get(value.enumType);
      assert(enumType.variant === Semantic.ENode.EnumDatatype && enumType.parentStructOrNS);
      const parent = Semantic.getNamespaceChainFromDatatype(sr, enumType.parentStructOrNS);
      return `${parent.map((p) => p.pretty).join(".")}.${value.valueName}`;
    } else {
      return primitiveToString(value.type);
    }
  }

  export function serializeLiteralValue(sr: SemanticResult, value: LiteralValue) {
    if (value.type === EPrimitive.str) {
      return `${JSON.stringify(value.value)}`;
    } else if (value.type === EPrimitive.cstr || value.type === EPrimitive.ccstr) {
      return `${JSON.stringify(value.value)}`;
    } else if (value.type === EPrimitive.bool) {
      return `${value.value ? "true" : "false"}`;
    } else {
      if (value.type === EPrimitive.int || value.type === EPrimitive.real) {
        return `${value.value}`;
      } else if (value.type === EPrimitive.null) {
        return `null`;
      } else if (value.type === EPrimitive.Regex) {
        return `r"${value.pattern}"${[...value.flags].join("")}`;
      } else if (value.type === EPrimitive.none) {
        return `none`;
      } else if (value.type === "enum") {
        const enumType = sr.typeDefNodes.get(value.enumType);
        assert(enumType.variant === Semantic.ENode.EnumDatatype && enumType.parentStructOrNS);
        const parent = Semantic.getNamespaceChainFromDatatype(sr, enumType.parentStructOrNS);
        return `${parent.map((p) => p.pretty).join(".")}.${value.valueName}`;
      } else {
        return `(${value.value} as ${primitiveToString(value.type)})`;
      }
    }
  }

  export function getTypeDefChainFromDatatype(
    sr: SemanticResult,
    typeId: Semantic.TypeDefId,
  ): Semantic.TypeDefId[] {
    const type = sr.typeDefNodes.get(typeId);

    if (
      type.variant !== Semantic.ENode.StructDatatype &&
      type.variant !== Semantic.ENode.EnumDatatype &&
      type.variant !== Semantic.ENode.NamespaceDatatype
    ) {
      return [typeId];
    }

    if (type.parentStructOrNS) {
      return [...getTypeDefChainFromDatatype(sr, type.parentStructOrNS), typeId];
    } else {
      return [typeId];
    }
  }

  export function getNamespaceChainFromDatatype(sr: SemanticResult, typeId: Semantic.TypeDefId) {
    const type = sr.typeDefNodes.get(typeId);

    if (
      type.variant !== Semantic.ENode.StructDatatype &&
      type.variant !== Semantic.ENode.EnumDatatype &&
      type.variant !== Semantic.ENode.NamespaceDatatype
    ) {
      const mangle = mangleTypeDef(sr, typeId);
      return [
        {
          pretty: serializeTypeDef(sr, typeId),
          mangled: mangle.name,
          wasMangled: mangle.wasMangled,
          isMonomorphized: false,
          isExported: false,
        },
      ];
    }

    let current = {
      pretty: type.name,
      mangled: type.name.length + type.name,
      wasMangled: true,
      isMonomorphized: false,
      isExported: type.export,
    };
    if (type.variant === Semantic.ENode.StructDatatype && type.generics.length > 0) {
      current.isMonomorphized = true;
      current.pretty += `<${type.generics.map((g) => serializeExpr(sr, g)).join(", ")}>`;
      current.mangled += `I${type.generics
        .map((g) => {
          const expr = sr.exprNodes.get(g);
          if (expr.variant === Semantic.ENode.DatatypeAsValueExpr) {
            return mangleTypeUse(sr, expr.type).name;
          } else if (expr.variant === Semantic.ENode.LiteralExpr) {
            return mangleLiteralValue(sr, g).name;
          } else {
            assert(false);
          }
        })
        .join("")}E`;
    }

    let fragments = [current];
    if (type.parentStructOrNS) {
      fragments = [...getNamespaceChainFromDatatype(sr, type.parentStructOrNS), current];
    }
    return fragments;
  }

  export function getNamespaceChainFromSymbol(sr: SemanticResult, symbolId: Semantic.SymbolId) {
    const symbol = sr.symbolNodes.get(symbolId);
    assert(
      symbol.variant === Semantic.ENode.FunctionSymbol ||
        symbol.variant === Semantic.ENode.VariableSymbol ||
        symbol.variant === Semantic.ENode.FunctionSignature ||
        symbol.variant === Semantic.ENode.GlobalVariableDefinitionSymbol,
    );

    let current = {
      pretty: symbol.name,
      mangled: symbol.name.length + symbol.name,
      isMonomorphized: false,
      isExported: symbol.variant !== Semantic.ENode.FunctionSignature && symbol.export,
    };
    if (symbol.variant === Semantic.ENode.FunctionSymbol && symbol.generics.length > 0) {
      current.isMonomorphized = true;
      current.pretty += `<${symbol.generics.map((g) => serializeExpr(sr, g)).join(", ")}>`;
      current.mangled += `I${symbol.generics
        .map((g) => {
          const expr = sr.exprNodes.get(g);
          if (expr.variant === Semantic.ENode.DatatypeAsValueExpr) {
            return mangleTypeUse(sr, expr.type).name;
          } else if (expr.variant === Semantic.ENode.LiteralExpr) {
            return mangleLiteralValue(sr, g).name;
          } else {
            assert(false);
          }
        })
        .join("")}E`;
    }

    let fragments = [current];
    if (symbol.parentStructOrNS) {
      fragments = [...getNamespaceChainFromDatatype(sr, symbol.parentStructOrNS), current];
    }
    return fragments;
  }

  export function serializeTypeDef(sr: SemanticResult, datatypeId: Semantic.TypeDefId): string {
    const datatype = sr.typeDefNodes.get(datatypeId);

    switch (datatype.variant) {
      case Semantic.ENode.PrimitiveDatatype:
        return primitiveToString(datatype.primitive);

      case Semantic.ENode.GenericParameterDatatype:
        return datatype.name;

      case Semantic.ENode.EnumDatatype:
      case Semantic.ENode.StructDatatype:
        if (datatype.extern === EExternLanguage.Extern_C) {
          return datatype.name;
        }
        return getNamespaceChainFromDatatype(sr, datatypeId)
          .map((n) => n.pretty)
          .join(".");

      case Semantic.ENode.FunctionDatatype: {
        let blocks = [] as string[];
        if (datatype.requires.final) {
          blocks.push("final");
        }
        if (datatype.requires.noreturn) {
          blocks.push("noreturn");
        }
        if (datatype.requires.pure) {
          blocks.push("pure");
        }
        if (datatype.requires.noreturnIf) {
          blocks.push(
            `noreturn_if(${printCollectedExpr(sr.cc, datatype.requires.noreturnIf.expr)})`,
          );
        }
        return `(${datatype.parameters
          .map((p, i) => `arg_${i}${p.optional ? "?" : ""}: ${serializeTypeUse(sr, p.type)}`)
          .join(", ")}${datatype.vararg ? ", ..." : ""}) => (${serializeTypeUse(
          sr,
          datatype.returnType,
        )}) ${blocks.length > 0 ? ":: " + blocks.join(", ") : ""}`;
      }

      case Semantic.ENode.DeferredFunctionDatatype:
        return `(${datatype.parameters.map((p) => serializeTypeUse(sr, p.type)).join(", ")}${
          datatype.vararg ? ", ..." : ""
        }) :: deferred`;

      case Semantic.ENode.CallableDatatype:
        return `Callable<${serializeTypeDef(sr, datatype.functionType)}>(this=${
          datatype.thisExprType ? serializeTypeUse(sr, datatype.thisExprType) : ""
        })`;

      case Semantic.ENode.NamespaceDatatype:
        return getNamespaceChainFromDatatype(sr, datatypeId)
          .map((n) => n.pretty)
          .join(".");

      case Semantic.ENode.FixedArrayDatatype:
        return `[${datatype.length}]${serializeTypeUse(sr, datatype.datatype)}`;

      case Semantic.ENode.DynamicArrayDatatype:
        return `${serializeMutability(sr.typeUseNodes.get(datatype.datatype))}[]${serializeTypeUse(
          sr,
          datatype.datatype,
        )}`;

      case Semantic.ENode.UntaggedUnionDatatype: {
        return datatype.members.map((m) => serializeTypeUse(sr, m)).join(" | ");
      }

      case Semantic.ENode.TaggedUnionDatatype: {
        return (
          `${datatype.nodiscard ? "nodiscard " : ""}union { ` +
          datatype.members.map((m) => `${m.tag}: ${serializeTypeUse(sr, m.type)}`).join(", ") +
          " }"
        );
      }

      case Semantic.ENode.UnionTagRefDatatype: {
        return "<union-tag>";
      }

      case Semantic.ENode.ParameterPackDatatype:
        if (datatype.parameters === null) {
          return "...";
        } else {
          return `Pack[${datatype.parameters.map((p) => {
            const param = sr.symbolNodes.get(p);
            assert(param.variant === Semantic.ENode.VariableSymbol);
            assert(param.type);
            return `${param.name}: ${serializeTypeUse(sr, param.type)}`;
          })}]`;
        }

      default:
        throw new InternalError("Not handled: ");
    }
  }

  export function isSymbolExported(sr: SemanticResult, symbolId: Semantic.SymbolId) {
    const symbol = sr.symbolNodes.get(symbolId);
    assert(
      symbol.variant === Semantic.ENode.FunctionSymbol ||
        symbol.variant === Semantic.ENode.FunctionSignature ||
        symbol.variant === Semantic.ENode.GlobalVariableDefinitionSymbol,
    );

    if (symbol.extern === EExternLanguage.Extern_C) {
      return false;
    }

    const names = getNamespaceChainFromSymbol(sr, symbolId);
    return names.some((n) => n.isExported) || ("export" in symbol && symbol.export);
  }

  export function isSymbolMonomorphized(sr: SemanticResult, symbolId: Semantic.SymbolId) {
    const symbol = sr.symbolNodes.get(symbolId);
    assert(
      symbol.variant === Semantic.ENode.FunctionSymbol ||
        symbol.variant === Semantic.ENode.FunctionSignature ||
        symbol.variant === Semantic.ENode.GlobalVariableDefinitionSymbol,
    );

    if (symbol.extern === EExternLanguage.Extern_C) {
      return false;
    }

    const names = getNamespaceChainFromSymbol(sr, symbolId);
    return names.some((n) => n.isMonomorphized);
  }

  export function serializeFullSymbolName(sr: SemanticResult, symbolId: Semantic.SymbolId) {
    const symbol = sr.symbolNodes.get(symbolId);
    assert(
      symbol.variant === Semantic.ENode.FunctionSymbol ||
        symbol.variant === Semantic.ENode.FunctionSignature ||
        symbol.variant === Semantic.ENode.GlobalVariableDefinitionSymbol,
    );

    if (symbol.extern === EExternLanguage.Extern_C) {
      return symbol.name;
    }

    const names = getNamespaceChainFromSymbol(sr, symbolId);
    return names.map((n) => n.pretty).join(".");
  }

  export function mangleFullTypeUse(sr: SemanticResult, typeUseId: Semantic.TypeUseId) {
    const type = sr.typeUseNodes.get(typeUseId);

    const names = getNamespaceChainFromDatatype(sr, type.type);

    const use = mangleTypeUse(sr, typeUseId);
    return {
      name:
        use.name +
        names
          .slice(1)
          .map((n) => n.pretty)
          .join(""),
      wasMangled: use.wasMangled || names.slice(1).some((n) => n.wasMangled),
    };
  }

  export function mangleSymbol(sr: SemanticResult, symbolId: Semantic.SymbolId) {
    const symbol = sr.symbolNodes.get(symbolId);
    assert(
      symbol.variant === Semantic.ENode.FunctionSymbol ||
        symbol.variant === Semantic.ENode.VariableSymbol ||
        symbol.variant === Semantic.ENode.GlobalVariableDefinitionSymbol,
    );

    if (symbol.extern === EExternLanguage.Extern_C) {
      return {
        name: symbol.name,
        wasMangled: false,
      };
    }

    let functionParameterPart = "";
    if (symbol.variant === Semantic.ENode.FunctionSymbol) {
      const ftype = sr.typeDefNodes.get(symbol.type);
      assert(ftype.variant === Semantic.ENode.FunctionDatatype);
      functionParameterPart += ftype.parameters.map((p) => mangleTypeUse(sr, p.type).name).join("");
      if (ftype.parameters.length === 0 && !ftype.vararg) {
        functionParameterPart += "v";
      }
      if (ftype.vararg) {
        functionParameterPart += "V";
      }
    }

    const names = getNamespaceChainFromSymbol(sr, symbolId);
    if (names.length === 1) {
      return {
        name: names[0].mangled + functionParameterPart,
        wasMangled: true,
      };
    } else {
      return {
        name: `N${names.map((n) => n.mangled).join("")}E` + functionParameterPart,
        wasMangled: true,
      };
    }
  }

  let CallableUniqueCounter = 1;
  const CallableManglingHashStore = new Map<Semantic.CallableDatatypeDef, number>();

  export function makeNameSetSymbol(sr: SemanticResult, symbolId: Semantic.SymbolId): NameSet {
    const mangled = mangleSymbol(sr, symbolId);
    const pretty = serializeFullSymbolName(sr, symbolId);
    return {
      mangledName: mangled.name,
      prettyName: pretty,
      wasMangled: mangled.wasMangled,
    };
  }

  export function makeNameSetTypeDef(sr: SemanticResult, typeDefId: Semantic.TypeDefId): NameSet {
    const mangled = mangleTypeDef(sr, typeDefId);
    const pretty = serializeTypeDef(sr, typeDefId);
    return {
      mangledName: mangled.name,
      prettyName: pretty,
      wasMangled: mangled.wasMangled,
    };
  }

  export function makeNameSetTypeUse(sr: SemanticResult, typeUseId: Semantic.TypeUseId): NameSet {
    const mangled = mangleTypeUse(sr, typeUseId);
    const pretty = serializeTypeUse(sr, typeUseId);
    return {
      mangledName: mangled.name,
      prettyName: pretty,
      wasMangled: mangled.wasMangled,
    };
  }

  export function mangleTypeUse(sr: SemanticResult, typeInstanceId: Semantic.TypeUseId) {
    const typeInstance = sr.typeUseNodes.get(typeInstanceId);

    const def = mangleTypeDef(sr, typeInstance.type);

    if (
      sr.typeDefNodes.get(typeInstance.type).variant === Semantic.ENode.StructDatatype ||
      sr.typeDefNodes.get(typeInstance.type).variant === Semantic.ENode.DynamicArrayDatatype
    ) {
      if (typeInstance.inline) {
        def.name = "i" + def.name;
      } else {
        def.name = "p" + def.name;
      }
      def.wasMangled = true;
    }

    if (sr.typeDefNodes.get(typeInstance.type).variant !== Semantic.ENode.ParameterPackDatatype) {
      if (typeInstance.mutability === EDatatypeMutability.Const) {
        def.name = "c" + def.name;
        def.wasMangled = true;
      } else if (typeInstance.mutability === EDatatypeMutability.Mut) {
        def.name = "m" + def.name;
        def.wasMangled = true;
      }
    }

    return def;
  }

  export function mangleTypeDef(
    sr: SemanticResult,
    typeId: Semantic.TypeDefId,
  ): { name: string; wasMangled: boolean } {
    const type = sr.typeDefNodes.get(typeId);

    switch (type.variant) {
      case Semantic.ENode.StructDatatype: {
        if (type.extern === EExternLanguage.Extern_C) {
          return {
            name: type.name,
            wasMangled: false,
          };
        }

        const names = getNamespaceChainFromDatatype(sr, typeId);
        if (names.length === 1) {
          return {
            name: names[0].mangled,
            wasMangled: true,
          };
        } else {
          return {
            name: `N${names.map((n) => n.mangled).join("")}E`,
            wasMangled: true,
          };
        }
      }

      case Semantic.ENode.NamespaceDatatype: {
        const names = getNamespaceChainFromDatatype(sr, typeId);
        if (names.length === 1) {
          return {
            name: names[0].mangled,
            wasMangled: true,
          };
        } else {
          return {
            name: `N${names.map((n) => n.mangled).join("")}E`,
            wasMangled: true,
          };
        }
      }

      case Semantic.ENode.CallableDatatype: {
        if (!CallableManglingHashStore.has(type)) {
          CallableManglingHashStore.set(type, CallableUniqueCounter++);
        }
        const uniqueID = CallableManglingHashStore.get(type);
        assert(uniqueID);
        return {
          name: "__Callable__" + uniqueID.toString(),
          wasMangled: true,
        };
      }

      case Semantic.ENode.PrimitiveDatatype: {
        if (type.primitive === EPrimitive.Regex) {
          return {
            name: "hzstd_regex_t",
            wasMangled: false,
          };
        } else {
          return {
            name: "hzstd_" + primitiveToString(type.primitive) + "_t",
            wasMangled: false,
          };
        }
      }

      case Semantic.ENode.FunctionDatatype: {
        let params = "";
        for (const p of type.parameters) {
          const ppt = sr.typeUseNodes.get(p.type);
          const pp = sr.typeDefNodes.get(ppt.type);
          if (pp.variant === Semantic.ENode.ParameterPackDatatype) {
            assert(pp.parameters !== null, "Cannot mangle an unresolved parameter pack");
            for (const packParam of pp.parameters) {
              const packParamS = sr.symbolNodes.get(packParam);
              assert(packParamS.variant === Semantic.ENode.VariableSymbol);
              assert(packParamS.type);
              params += mangleTypeUse(sr, packParamS.type).name;
            }
          } else {
            params += mangleTypeUse(sr, p.type).name;
          }
        }
        return {
          name: "F" + params + "E" + mangleTypeUse(sr, type.returnType).name,
          wasMangled: true,
        };
      }

      case Semantic.ENode.FixedArrayDatatype: {
        return {
          name: "A" + type.length + "_" + mangleTypeUse(sr, type.datatype).name,
          wasMangled: true,
        };
      }

      case Semantic.ENode.DynamicArrayDatatype: {
        return {
          name: "D" + mangleTypeUse(sr, type.datatype).name,
          wasMangled: true,
        };
      }

      case Semantic.ENode.SliceDatatype: {
        return {
          name: "S" + mangleTypeUse(sr, type.datatype).name,
          wasMangled: true,
        };
      }

      case Semantic.ENode.UntaggedUnionDatatype: {
        return {
          name:
            "U" +
            type.members.length.toString() +
            "_" +
            type.members.map((m) => mangleTypeUse(sr, m).name).join("_"),
          wasMangled: true,
        };
      }

      case Semantic.ENode.TaggedUnionDatatype: {
        return {
          name:
            "T" +
            type.members.length.toString() +
            "_" +
            type.members.map((m) => `${m.tag}${mangleTypeUse(sr, m.type).name}`).join("_"),
          wasMangled: true,
        };
      }

      case Semantic.ENode.EnumDatatype: {
        if (type.extern === EExternLanguage.Extern_C) {
          return {
            name: type.name,
            wasMangled: false,
          };
        }
        return {
          name: type.parentStructOrNS
            ? mangleTypeDef(sr, type.parentStructOrNS).name
            : "" + type.name.length + type.name,
          wasMangled: true,
        };
      }

      case Semantic.ENode.ParameterPackDatatype: {
        assert(type.parameters !== null);
        return {
          name: type.parameters
            .map((p) => {
              const sym = sr.symbolNodes.get(p);
              assert(sym.variant === Semantic.ENode.VariableSymbol && sym.type);
              return mangleTypeUse(sr, sym.type).name;
            })
            .join(""),
          wasMangled: true,
        };
      }

      default:
        throw new InternalError("Unhandled variant: " + type.variant);
    }
  }

  export function mangleLiteralValue(sr: SemanticResult, exprId: ExprId) {
    const expr = sr.exprNodes.get(exprId);
    assert(expr.variant === Semantic.ENode.LiteralExpr);
    const literal = expr.literal;
    const literalType = literal.type;
    if (literalType === EPrimitive.bool) {
      return {
        name: `Lb${literal.value ? "1" : "0"}E`,
        wasMangled: true,
      };
    } else if (
      literalType === EPrimitive.str ||
      literalType === EPrimitive.cstr ||
      literalType === EPrimitive.ccstr
    ) {
      const utf8 = new TextEncoder().encode(literal.value);
      let base64 = btoa(String.fromCharCode(...utf8));
      // make it C-identifier-safe: base64 → base64url (replace +/ with _)
      base64 = base64.replace(/\+/g, "_").replace(/\//g, "_").replace(/=+$/, "");
      return {
        name: `Ls${base64}E`,
        wasMangled: true,
      };
    } else if (literalType === EPrimitive.null) {
      return {
        name: "4null",
        wasMangled: true,
      };
    } else if (literalType === EPrimitive.none) {
      return {
        name: "4none",
        wasMangled: true,
      };
    } else if (literalType === EPrimitive.Regex) {
      return {
        name: "5Regex",
        wasMangled: true,
      };
    } else if (literalType === "enum") {
      const enumType = sr.typeDefNodes.get(literal.enumType);
      assert(enumType.variant === Semantic.ENode.EnumDatatype && enumType.parentStructOrNS);
      const parent = mangleTypeDef(sr, enumType.parentStructOrNS);
      if (parent.wasMangled) {
        return {
          name: parent.name + literal.valueName.length + literal.valueName,
          wasMangled: true,
        };
      } else {
        return {
          name: literal.valueName,
          wasMangled: false,
        };
      }
    } else {
      if (Number.isInteger(literalType)) {
        assert(typeof literal.value === "bigint");
        return {
          name: literal.value < 0 ? `Lin${-literal.value}E` : `Li${literal.value}E`,
          wasMangled: true,
        };
      } else {
        const repr = literal.value.toString().replace("-", "n").replace(".", "_");
        return {
          name: `Lf${repr}E`,
          wasMangled: true,
        };
      }
    }
  }

  export function serializeExpr(sr: SemanticResult, exprId: Semantic.ExprId): string {
    const expr = sr.exprNodes.get(exprId);

    switch (expr.variant) {
      case Semantic.ENode.BinaryExpr:
        return `(${serializeExpr(sr, expr.left)} ${BinaryOperationToString(
          expr.operation,
        )} ${serializeExpr(sr, expr.right)})`;

      case Semantic.ENode.ValueToUnionCastExpr: {
        return `(${serializeExpr(sr, expr.expr)} as (${serializeTypeUse(sr, expr.type)}))`;
      }

      case Semantic.ENode.UnionToValueCastExpr: {
        return `(${serializeExpr(sr, expr.expr)} as tag ${expr.tag})`;
      }

      case Semantic.ENode.UnionTagCheckExpr: {
        return `(${serializeExpr(sr, expr.expr)} tag check TBD...)`;
      }

      case Semantic.ENode.UnionToUnionCastExpr: {
        return `(${serializeExpr(sr, expr.expr)} as (${serializeTypeUse(sr, expr.type)}))`;
      }

      case Semantic.ENode.UnaryExpr:
        return `(${UnaryOperationToString(expr.operation)} ${serializeExpr(sr, expr.expr)})`;

      case Semantic.ENode.SizeofExpr:
        return `sizeof(${serializeExpr(sr, expr.valueExpr)})`;

      case Semantic.ENode.AlignofExpr:
        return `alignof(${serializeExpr(sr, expr.valueExpr)})`;

      case Semantic.ENode.ExplicitCastExpr:
        return `(${serializeExpr(sr, expr.expr)} as ${serializeTypeUse(sr, expr.type)})`;

      case Semantic.ENode.ExprCallExpr:
        return `(${serializeExpr(sr, expr.calledExpr)}(${expr.arguments
          .map((a) => serializeExpr(sr, a))
          .join(", ")}))`;

      case Semantic.ENode.PostIncrExpr:
        return `((${serializeExpr(sr, expr.expr)})${IncrOperationToString(expr.operation)})`;

      case Semantic.ENode.PreIncrExpr:
        return `(${IncrOperationToString(expr.operation)}(${serializeExpr(sr, expr.expr)}))`;

      case Semantic.ENode.SymbolValueExpr: {
        const symbol = sr.symbolNodes.get(expr.symbol);
        if (symbol.variant === Semantic.ENode.VariableSymbol) {
          return symbol.name;
        } else if (symbol.variant === Semantic.ENode.FunctionSymbol) {
          const generic =
            symbol.generics.length > 0
              ? "<" + symbol.generics.map((g) => serializeExpr(sr, g)).join(", ") + ">"
              : "";
          return serializeFullSymbolName(sr, expr.symbol) + generic;
        }
        throw new InternalError("Symbol not supported: " + symbol.variant);
      }

      case Semantic.ENode.StructLiteralExpr:
        return `${serializeTypeUse(sr, expr.type)} { ${expr.assign
          .map((a) => `${a.name}: ${serializeExpr(sr, a.value)}`)
          .join(", ")} }`;

      case Semantic.ENode.LiteralExpr: {
        return serializeLiteralValue(sr, expr.literal);
      }

      case Semantic.ENode.MemberAccessExpr:
        return `(${serializeExpr(sr, expr.expr)}.${expr.memberName})`;

      case Semantic.ENode.CallableExpr:
        return `Callable(${serializeFullSymbolName(sr, expr.functionSymbol)}, this=${serializeExpr(
          sr,
          expr.thisExpr,
        )})`;

      case Semantic.ENode.BlockScopeExpr: {
        return `do { ... }`;
      }

      case Semantic.ENode.AddressOfExpr:
        return `&${serializeExpr(sr, expr.expr)}`;

      case Semantic.ENode.DereferenceExpr:
        return `*${serializeExpr(sr, expr.expr)}`;

      case Semantic.ENode.ExprAssignmentExpr:
        return `${serializeExpr(sr, expr.target)} = ${serializeExpr(sr, expr.value)}`;

      case Semantic.ENode.DatatypeAsValueExpr:
        return `${serializeTypeUse(sr, expr.type)}`;

      case Semantic.ENode.ArrayLiteralExpr: {
        return `(${Semantic.serializeTypeUse(sr, expr.type)} {${expr.elements
          .map((v) => serializeExpr(sr, v))
          .join(", ")}})`;
      }

      case Semantic.ENode.ArraySubscriptExpr: {
        const indices: string[] = [];
        for (const index of expr.indices) {
          indices.push(serializeExpr(sr, index));
        }
        return `${serializeExpr(sr, expr.expr)}[${indices.join(", ")}]`;
      }

      case Semantic.ENode.StringSubscriptExpr: {
        const indices: string[] = [];
        indices.push(serializeExpr(sr, expr.index));
        return `${serializeExpr(sr, expr.expr)}[${indices.join(", ")}]`;
      }

      case Semantic.ENode.StringConstructExpr: {
        if (expr.value.variant === "data-length") {
          return `str(${serializeExpr(sr, expr.value.data)}, ${serializeExpr(
            sr,
            expr.value.length,
          )})`;
        } else {
          assert(false);
        }
      }

      case Semantic.ENode.ArraySliceExpr: {
        const indices: string[] = [];
        for (const index of expr.indices) {
          if (index.start && index.end) {
            indices.push(serializeExpr(sr, index.start) + ":" + serializeExpr(sr, index.end));
          } else if (index.start) {
            indices.push(serializeExpr(sr, index.start));
          } else if (index.end) {
            indices.push(serializeExpr(sr, index.end));
          } else {
            assert(false);
          }
        }
        return `${serializeExpr(sr, expr.expr)}[${indices.join(", ")}]`;
      }

      default:
        assert(false, Semantic.ENode[expr.variant]);
    }
  }
}

// const gray = "\x1b[90m";
// const reset = "\x1b[0m";

// const print = (str: string, indent = 0, color = reset) => {
//   console.info(color + " ".repeat(indent) + str + reset);
// };

// function printSymbol(sr: SemanticResult, symbolId: Semantic.SymbolId, indent: number) { const symbol = sr.symbolNodes.get(symbolId);
//   switch (symbol.variant) {
//     case Semantic.ENode.NamespaceDatatype:
//       print(`Namespace ${symbol.name} {`, indent);
//       for (const s of symbol.symbols) {
//         printSymbol(sr, s, indent + 2);
//       }
//       print(`}`, indent);
//       break;

//     case Semantic.ENode.VariableSymbol:
//       print(`Variable Symbol ${symbol.name};`, indent);
//       break;

//     case Semantic.ENode.FunctionSymbol:
//       if (symbol.scope) {
//         print(
//           `Function ${getParentNames(sr, symbolId)}: ${serializeDatatype(sr, symbol.type)} {`,
//           indent
//         );
//         printSymbol(sr, symbol.scope, indent + 2);
//         print(`}`, indent);
//       } else {
//         print(
//           `Function ${getParentNames(sr, symbolId)}: ${serializeDatatype(sr, symbol.type)};`,
//           indent
//         );
//       }
//       break;

//     case Semantic.ENode.PrimitiveDatatype:
//       print(`${serializeDatatype(sr, symbolId)}`, indent);
//       break;

//     case Semantic.ENode.StructDatatype: {
//       print(`Struct ${serializeDatatype(sr, symbolId)} {`, indent);
//       for (const memberId of symbol.members) {
//         const member = sr.nodes.get(memberId);
//         assert(member.variant === Semantic.ENode.VariableSymbol);
//         assert(member.type);
//         print(`${member.name}: ${serializeDatatype(sr, member.type)}`, indent + 2);
//       }
//       for (const method of symbol.methods) {
//         printSymbol(sr, method, indent + 2);
//       }
//       print(`}`, indent);
//       break;
//     }

//     case Semantic.ENode.InlineCStatement:
//       print(`InlineC "${symbol.value}"`, indent);
//       break;

//     case Semantic.ENode.ReturnStatement:
//       print(`Return ${symbol.expr ? serializeExpr(sr, symbol.expr) : ""}`, indent);
//       break;

//     case Semantic.ENode.VariableStatement: {
//       const variableSymbol = sr.nodes.get(symbol.variableSymbol);
//       assert(variableSymbol.variant === Semantic.ENode.VariableSymbol);
//       assert(variableSymbol.type);
//       print(
//         `var ${symbol.name}: ${serializeDatatype(sr, variableSymbol.type)} ${
//           symbol.value ? "= " + serializeExpr(sr, symbol.value) : ""
//         }`,
//         indent
//       );
//       break;
//     }

//     case Semantic.ENode.IfStatement:
//       print(`If ${serializeExpr(sr, symbol.condition)}`, indent);
//       printSymbol(sr, symbol.then, indent + 2);
//       for (const elseif of symbol.elseIfs) {
//         print(`else if ${serializeExpr(sr, elseif.condition)}`, indent);
//         printSymbol(sr, elseif.then, indent + 2);
//       }
//       if (symbol.else) {
//         print(`else`, indent);
//         printSymbol(sr, symbol.else, indent + 2);
//       }
//       break;

//     case Semantic.ENode.WhileStatement:
//       print(`While ${serializeExpr(sr, symbol.condition)}`, indent);
//       printSymbol(sr, symbol.then, indent + 2);
//       break;

//     case Semantic.ENode.ExprStatement:
//       print(`Expr ${serializeExpr(sr, symbol.expr)};`, indent);
//       break;

//     case Semantic.ENode.BlockScope:
//       print("Block {", indent);
//       for (const sId of symbol.statements) {
//         printSymbol(sr, sId, indent + 2);
//       }
//       print("}", indent);
//       break;

//     case Semantic.ENode.BlockScopeStatement:
//       printSymbol(sr, symbol.block, indent + 2);
//       break;

//     default:
//       assert(false, "Unhandled case " + symbol.variant);
//   }
// }

// export function PrettyPrintAnalyzed(sr: SemanticResult) {
//   // printSymbol(sr.globalNamespace, 0);

//   print("");
//   print("Elaborated Structs:");
//   for (const symbol of sr.elaboratedStructDatatypes) {
//     print("");
//     printSymbol(sr, symbol.resultSymbol, 0);
//   }

//   print("Elaborated Functions:");
//   for (const symbol of sr.elaboratedFuncdefSymbols) {
//     print("");
//     printSymbol(sr, symbol.resultSymbol, 0);
//   }
//   print("\n");
// }
