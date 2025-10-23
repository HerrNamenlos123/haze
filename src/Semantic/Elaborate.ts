import { HAZE_STDLIB_NAME } from "../Module";
import {
  EAssignmentOperation,
  EBinaryOperation,
  EExternLanguage,
  EDatatypeMutability,
  EVariableMutability,
  BinaryOperationToString,
  UnaryOperationToString,
  IncrOperationToString,
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
  type SourceLoc,
} from "../shared/Errors";
import {
  Collect,
  funcSymHasParameterPack,
  printCollectedDatatype,
  printCollectedExpr,
  printCollectedSymbol,
  type CollectionContext,
} from "../SymbolCollection/SymbolCollection";
import { Conversion } from "./Conversion";
import { EvalCTFE, EvalCTFEBoolean } from "./CTFE";
import {
  makeStackArrayDatatypeAvailable,
  makeDynamicArrayDatatypeAvailable,
  makeTypeUse,
  makeRawFunctionDatatypeAvailable,
  makeFunctionDatatypeAvailable,
} from "./LookupDatatype";

import type { EIncrOperation, EUnaryOperation } from "../shared/AST";
import { type Brand, type LiteralValue } from "../shared/common";

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
  expectedReturnType?: Semantic.TypeUseId;
  functionReturnsInstanceIds?: Set<Semantic.InstanceId>;

  constructor(public sr: SemanticResult, currentContext: Semantic.ElaborationContext) {
    this.currentContext = currentContext;
  }

  withContext<T>(
    args: {
      context: Semantic.ElaborationContext;
      expectedReturnType?: Semantic.TypeUseId;
      functionReturnsInstanceIds?: Set<Semantic.InstanceId>;
    },
    fn: () => T
  ): T {
    const oldContext = this.currentContext;
    this.currentContext = args.context;
    const oldReturn = this.expectedReturnType;
    this.expectedReturnType = args.expectedReturnType;
    const oldReturnIds = this.functionReturnsInstanceIds;
    this.functionReturnsInstanceIds = args.functionReturnsInstanceIds;

    const result = fn();

    this.functionReturnsInstanceIds = oldReturnIds;
    this.expectedReturnType = oldReturn;
    this.currentContext = oldContext;
    return result;
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
    let [left, leftId] = this.expr(binaryExpr.left, inference);
    let [right, rightId] = this.expr(binaryExpr.right, inference);

    // Datatypes are being compared (e.g. typeof(x) == int)
    if (
      (binaryExpr.operation === EBinaryOperation.Equal ||
        binaryExpr.operation === EBinaryOperation.Unequal) &&
      left.variant === Semantic.ENode.DatatypeAsValueExpr &&
      right.variant === Semantic.ENode.DatatypeAsValueExpr
    ) {
      return this.sr.b.literal(
        binaryExpr.operation === EBinaryOperation.Equal && left.type === right.type,
        binaryExpr.sourceloc
      );
    }

    let resultType = undefined as Semantic.TypeUseId | undefined;
    if (
      binaryExpr.operation === EBinaryOperation.BoolAnd ||
      binaryExpr.operation === EBinaryOperation.BoolOr
    ) {
      leftId = Conversion.MakeConversionOrThrow(
        this.sr,
        leftId,
        this.sr.b.boolType(),
        this.currentContext.constraints,
        left.sourceloc,
        Conversion.Mode.Implicit,
        inference?.unsafe
      );
      rightId = Conversion.MakeConversionOrThrow(
        this.sr,
        rightId,
        this.sr.b.boolType(),
        this.currentContext.constraints,
        right.sourceloc,
        Conversion.Mode.Implicit,
        inference?.unsafe
      );
      resultType = this.sr.b.boolType();
    } else {
      resultType = Conversion.makeBinaryResultType(
        this.sr,
        leftId,
        rightId,
        binaryExpr.operation,
        binaryExpr.sourceloc
      );
    }

    if (!resultType) {
      throw new CompilerError(`BINARY UNKNOWN ERROR: FIX THIS`, binaryExpr.sourceloc);
    }

    return this.sr.b.binaryExpr(
      leftId,
      rightId,
      binaryExpr.operation,
      resultType,
      binaryExpr.sourceloc
    );
  }

  exprs(exprs: Collect.ExprId[]) {
    return exprs.map((a) => this.expr(a, undefined)[1]);
  }

  assertNoGenericArgs(expr: Collect.SymbolValueExpr, functionName: string) {
    if (expr.genericArgs.length !== 0) {
      throw new CompilerError(
        `The ${functionName} function cannot take any type parameters`,
        expr.sourceloc
      );
    }
  }

  assertParameterN(expr: Collect.ExprCallExpr, n: number | [number, number], functionName: string) {
    if (Array.isArray(n)) {
      if (expr.arguments.length < n[0] || expr.arguments.length > n[1]) {
        throw new CompilerError(
          `The ${functionName} function must take between ${n[0]} and ${n[1]} parameters`,
          expr.sourceloc
        );
      }
    } else {
      if (expr.arguments.length !== n) {
        throw new CompilerError(
          `The ${functionName} function must take exactly ${n} parameter(s)`,
          expr.sourceloc
        );
      }
    }
  }

  callExpr(
    callExpr: Collect.ExprCallExpr,
    inference: Inference
  ): [Semantic.Expression, Semantic.ExprId] {
    const collectedExpr = this.sr.cc.exprNodes.get(callExpr.calledExpr);
    if (collectedExpr.variant === Collect.ENode.SymbolValueExpr) {
      if (collectedExpr.name === "typeof") {
        this.assertNoGenericArgs(collectedExpr, "typeof");
        this.assertParameterN(callExpr, 1, "typeof");
        return this.sr.b.datatypeUseAsValue(
          this.sr.exprNodes.get(this.expr(callExpr.arguments[0], undefined)[1]).type,
          collectedExpr.sourceloc
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
            (s.literal.type !== EPrimitive.str && s.literal.type !== EPrimitive.cstr)
          ) {
            throw new CompilerError(
              "The static_assert function requires the second parameter to be a string, or omitted",
              collectedExpr.sourceloc
            );
          } else {
            second = s;
          }
        }
        const value = EvalCTFEBoolean(
          this.sr,
          this.expr(callExpr.arguments[0], undefined)[1],
          callExpr.sourceloc
        );
        if (value) {
          return this.sr.b.literal(true, collectedExpr.sourceloc);
        } else {
          let str = second ? Semantic.serializeLiteralValue(second?.literal) : undefined;
          if (second && second.literal.type === EPrimitive.str) {
            str = second.literal.value; // Bypass and don't escape it to make message look better
          }
          throw new CompilerError(
            `static_assert evaluated to false${str ? ": " + str : ""}`,
            callExpr.sourceloc
          );
        }
      }

      const primitive = stringToPrimitive(collectedExpr.name);
      if (primitive) {
        const callingArguments = callExpr.arguments.map((a) => this.expr(a, undefined)[1]);
        assertCompilerError(
          collectedExpr.genericArgs.length === 0,
          "Primitive constructors cannot take any type parameters",
          collectedExpr.sourceloc
        );
        if (primitive === EPrimitive.str) {
          assertCompilerError(
            callingArguments.length >= 1 && callingArguments.length <= 2,
            "'str' constructor must take one or two parameters",
            collectedExpr.sourceloc
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
              primitive
            )} constructor does not provide an overload that can take following types: (${callingArguments
              .map((a) => {
                return Semantic.serializeTypeUse(this.sr, this.sr.exprNodes.get(a).type);
              })
              .join(", ")})`,
            callExpr.sourceloc
          );
        }
        throw new CompilerError(
          `Primitive ${primitiveToString(primitive)} is not constructible`,
          callExpr.sourceloc
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
    const calledExprType = this.getTypeDef(this.getTypeUse(calledExpr.type).type);

    const convertArgs = (
      givenArgs: Semantic.ExprId[],
      requiredTypes: Semantic.TypeUseId[],
      vararg: boolean
    ) => {
      const newRequiredTypes = requiredTypes.filter((t) => {
        const tt = this.getTypeDef(this.getTypeUse(t).type);
        return tt.variant !== Semantic.ENode.ParameterPackDatatype;
      });
      if (vararg || requiredTypes.length !== newRequiredTypes.length) {
        assertCompilerError(
          givenArgs.length >= newRequiredTypes.length,
          `This call requires at least ${newRequiredTypes.length} arguments but only ${givenArgs.length} were given`,
          calledExpr.sourceloc
        );
      } else {
        assertCompilerError(
          givenArgs.length === newRequiredTypes.length,
          `This call requires ${newRequiredTypes.length} arguments but ${givenArgs.length} were given`,
          calledExpr.sourceloc
        );
      }
      return givenArgs.map((a, index) => {
        if (index < newRequiredTypes.length) {
          return Conversion.MakeConversionOrThrow(
            this.sr,
            a,
            newRequiredTypes[index],
            this.currentContext.constraints,
            callExpr.sourceloc,
            Conversion.Mode.Implicit,
            inference?.unsafe
          );
        } else {
          return a;
        }
      });
    };

    const getActualCallingArguments = (
      expectedParameterTypes: Semantic.TypeUseId[]
    ): Semantic.ExprId[] => {
      return callExpr.arguments.map((a, i) => {
        const alreadyKnown = decisiveArguments.find((d) => d.index === i);
        if (alreadyKnown && alreadyKnown.exprId) {
          return alreadyKnown.exprId;
        } else {
          let structType = undefined as Semantic.TypeUseId | undefined;
          if (i < expectedParameterTypes.length) {
            structType = expectedParameterTypes[i];
          }
          return this.sr.e.expr(a, {
            gonnaInstantiateStructWithType: structType,
            unsafe: inference?.unsafe,
          })[1];
        }
      });
    };

    if (calledExprType.variant === Semantic.ENode.CallableDatatype) {
      const ftype = this.sr.typeDefNodes.get(calledExprType.functionType);
      assert(ftype.variant === Semantic.ENode.FunctionDatatype);
      let parametersWithoutThis = ftype.parameters;
      if (calledExprType.thisExprType) {
        parametersWithoutThis = parametersWithoutThis.slice(1);
      }
      return this.sr.b.callExpr(
        calledExprId,
        convertArgs(
          getActualCallingArguments(parametersWithoutThis),
          parametersWithoutThis,
          ftype.vararg
        ),
        callExpr.sourceloc
      );
    }

    if (calledExprType.variant === Semantic.ENode.FunctionDatatype) {
      return this.sr.b.callExpr(
        calledExprId,
        convertArgs(
          getActualCallingArguments(calledExprType.parameters),
          calledExprType.parameters,
          calledExprType.vararg
        ),
        callExpr.sourceloc
      );
    } else if (calledExprType.variant === Semantic.ENode.StructDatatype) {
      const original = this.sr.cc.typeDefNodes.get(calledExprType.originalCollectedSymbol);
      assert(original.variant === Collect.ENode.StructTypeDef);
      const constructorId = [...calledExprType.methods].find((methodId) => {
        const method = this.sr.symbolNodes.get(methodId);
        assert(method.variant === Semantic.ENode.FunctionSymbol);
        return method.name === "constructor";
      });
      if (!constructorId) {
        throw new CompilerError(
          `Struct ${calledExprType.name} is called, but it does not provide a constructor`,
          callExpr.sourceloc
        );
      }
      const constructor = this.sr.symbolNodes.get(constructorId);
      assert(constructor.variant === Semantic.ENode.FunctionSymbol);

      const constructorFunctype = this.getTypeDef(constructor.type);
      assert(constructorFunctype.variant === Semantic.ENode.FunctionDatatype);
      return this.sr.b.callExpr(
        this.sr.b.symbolValue(constructorId, callExpr.sourceloc)[1],
        convertArgs(
          getActualCallingArguments(constructorFunctype.parameters),
          constructorFunctype.parameters,
          constructorFunctype.vararg
        ),
        callExpr.sourceloc
      );
    } else if (calledExprType.variant === Semantic.ENode.PrimitiveDatatype) {
      throw new CompilerError(
        `Expression of type ${primitiveToString(calledExprType.primitive)} is not callable`,
        callExpr.sourceloc
      );
    }
    assert(false, "All cases handled ");
  }

  unaryExpr(unaryExpr: Collect.UnaryExpr) {
    const [e, eId] = this.sr.e.expr(unaryExpr.expr, undefined);
    console.log("TODO: Implement runtime overflow checking for unary negating signed integers");
    return this.sr.b.unaryExpr(eId, unaryExpr.operation, unaryExpr.sourceloc);
  }

  literalExpr(literalExpr: Collect.LiteralExpr) {
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
      const [min, max] = Conversion.getIntegerMinMax(literalExpr.literal.type);
      if (literalExpr.literal.value < min || literalExpr.literal.value > max) {
        throw new CompilerError(
          `Value ${literalExpr.literal.value} is out of range for literal type ${primitiveToString(
            literalExpr.literal.type
          )}`,
          literalExpr.sourceloc
        );
      }
    }

    return this.sr.b.literalValue(literalExpr.literal, literalExpr.sourceloc);
  }

  expr(exprId: Collect.ExprId, inference: Inference): [Semantic.Expression, Semantic.ExprId] {
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
        return this.unaryExpr(expr);

      case Collect.ENode.LiteralExpr:
        return this.literalExpr(expr);

      case Collect.ENode.StructInstantiationExpr:
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

      case Collect.ENode.LiteralExpr:
        return this.literalExpr(expr);

      case Collect.ENode.TypeLiteralExpr:
        return this.typeLiteral(expr);

      default:
        assert(false, "All cases handled: " + Collect.ENode[expr.variant]);
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

    const [ns, nsId] = this.sr.b.namespaceType(namespace.name, parentNamespace, namespaceId);
    this.sr.elaboratedNamespaceSymbols.push({
      originalSharedInstance: namespace.sharedInstance,
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
          },
          () => {
            const sym = this.sr.e.topLevelSymbol(symbolId);
            for (const s of sym) {
              ns.symbols.push(s);
            }
          }
        );
      }
    }
    return nsId;
  }

  memberAccess(memberAccess: Collect.MemberAccessExpr, inference: Inference) {
    const [object, objectId] = this.expr(memberAccess.expr, inference);
    let objectType = this.sr.typeDefNodes.get(this.sr.typeUseNodes.get(object.type).type);

    if (object.variant === Semantic.ENode.DatatypeAsValueExpr) {
      return this.elaborateDatatypeMemberAccess(this.sr, objectId, object.type, memberAccess, {
        gonnaCallFunctionWithParameterValues: inference?.gonnaCallFunctionWithParameterValues,
      });
    }

    if (objectType.variant === Semantic.ENode.ParameterPackDatatype) {
      if (memberAccess.memberName === "length") {
        if (objectType.parameters === null) {
          throw new CompilerError(
            `Parameter Pack is not substituted yet and does not have enough context to know its length`,
            memberAccess.sourceloc
          );
        }
        return this.sr.b.literalValue(
          {
            type: EPrimitive.usize,
            unit: null,
            value: BigInt(objectType.parameters.length),
          },
          memberAccess.sourceloc
        );
      }
      throw new CompilerError(
        `Parameter Pack does not have a member named '${memberAccess.memberName}'`,
        memberAccess.sourceloc
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
          this.sr.b.usizeType(),
          true,
          memberAccess.sourceloc
        );
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
          object.type
        )}' does not have a member named '${memberAccess.memberName}'`,
        memberAccess.sourceloc
      );
    }

    if (objectType.variant === Semantic.ENode.DynamicArrayDatatype) {
      if (memberAccess.memberName === "length") {
        return this.sr.b.memberAccessRaw(
          objectId,
          "length",
          this.sr.b.usizeType(),
          true,
          memberAccess.sourceloc
        );
      }
      throw new CompilerError(
        `Datatype '${Semantic.serializeTypeUse(
          this.sr,
          object.type
        )}' does not have a member named '${memberAccess.memberName}'`,
        memberAccess.sourceloc
      );
    }

    if (objectType.variant !== Semantic.ENode.StructDatatype) {
      throw new CompilerError(
        "Cannot access member of non-structural type " +
          Semantic.serializeTypeUse(this.sr, object.type),
        memberAccess.sourceloc
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
          memberAccess.sourceloc
        );
      }
      const member = this.sr.symbolNodes.get(memberId);
      assert(member.variant === Semantic.ENode.VariableSymbol && member.type);

      return this.sr.b.memberAccess(objectId, memberAccess.memberName, memberAccess.sourceloc);
    }

    const collectedStruct = this.sr.cc.typeDefNodes.get(objectType.originalCollectedSymbol);
    assert(collectedStruct.variant === Collect.ENode.StructTypeDef);
    const structScope = this.sr.cc.scopeNodes.get(collectedStruct.structScope);
    assert(structScope.variant === Collect.ENode.StructScope);
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
        memberAccess.sourceloc
      );

      const collectedMethod = this.sr.cc.symbolNodes.get(chosenOverloadId);
      assert(collectedMethod.variant === Collect.ENode.FunctionSymbol);

      let objectTypeId = object.type;
      const objectType = this.sr.typeDefNodes.get(this.sr.typeUseNodes.get(objectTypeId).type);

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
        memberAccess.sourceloc
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
            }
          ),
        },
        () =>
          this.elaborateFunctionSymbolWithGenerics(
            this.elaborateFunctionSignature(chosenOverloadId),
            memberAccess.genericArgs.map((g) => this.expressionAsGenericArg(g)),
            memberAccess.sourceloc,
            this.sr.typeUseNodes.get(objectTypeId).type,
            parameterPackTypes
          )
      );
      assert(elaboratedMethodId);
      const elaboratedMethod = this.sr.symbolNodes.get(elaboratedMethodId);
      assert(elaboratedMethod.variant === Semantic.ENode.FunctionSymbol);

      if (elaboratedMethod.staticMethod) {
        throw new CompilerError(
          `Method ${Semantic.serializeFullSymbolName(
            this.sr,
            elaboratedMethodId
          )} is static but is called through an object`,
          memberAccess.sourceloc
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
          memberAccess.sourceloc
        )[1],
        sourceloc: memberAccess.sourceloc,
        isTemporary: true,
      });
    }

    throw new CompilerError(
      `No attribute named '${memberAccess.memberName}' in struct ${objectType.name}`,
      memberAccess.sourceloc
    );
  }

  typeDefSymbol(typeDefSymbol: Collect.TypeDefSymbol) {
    const typedef = this.sr.cc.typeDefNodes.get(typeDefSymbol.typeDef);
    switch (typedef.variant) {
      case Collect.ENode.TypeDefAlias: {
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
                typedef.sourceloc
              )
            )[1],
          ];
        }
        return [];
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
          []
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
    if (type === null) {
      if (!variableSymbol.globalValueInitializer) {
        throw new CompilerError(
          `A global constant is by definition immutable and is always required to be initialized with a value that can be evaluated at compile time.`,
          variableSymbol.sourceloc
        );
      }
      const [expr, exprId] = this.sr.e.expr(variableSymbol.globalValueInitializer, undefined);
      type = expr.type;
      comptimeValue = exprId;
    }

    const [variable, variableId] = this.sr.b.variableSymbol(
      variableSymbol.name,
      type,
      variableSymbol.comptime || Boolean(comptimeValue),
      comptimeValue,
      variableSymbol.mutability,
      this.elaborateParentSymbolFromCache(variableSymbol.inScope),
      variableSymbol.sourceloc
    );
    this.sr.elaboratedGlobalVariableSymbols.set(variableSymbolId, variableId);

    return [variableId];
  }

  topLevelSymbol(symbolId: Collect.SymbolId): Semantic.SymbolId[] {
    const symbol = this.sr.cc.symbolNodes.get(symbolId);
    switch (symbol.variant) {
      case Collect.ENode.TypeDefSymbol:
        return this.typeDefSymbol(symbol);

      case Collect.ENode.FunctionOverloadGroupSymbol:
        return this.functionOverloadGroup(symbol);

      case Collect.ENode.VariableSymbol:
        return this.variableSymbol(symbol, symbolId);

      // case Collect.ENode.GlobalVariableDefinition: {
      //   for (const s of sr.elaboratedGlobalVariableDefinitions) {
      //     if (s.originalSymbol === nodeId) {
      //       return [s.result];
      //     }
      //   }
      //   let [elaboratedValue, elaboratedValueId] = [
      //     undefined as Semantic.Expression | undefined,
      //     null as Semantic.ExprId | null,
      //   ];

      //   const [variableSymbolId] = elaborateTopLevelSymbol(sr, node.variableSymbol, {
      //     context: args.context,
      //   });
      //   assert(variableSymbolId);
      //   const variableSymbol = sr.symbolNodes.get(variableSymbolId);
      //   assert(variableSymbol.variant === Semantic.ENode.VariableSymbol);

      //   if (!variableSymbol.type && elaboratedValue) {
      //     variableSymbol.type = elaboratedValue.type;
      //   }
      //   assert(variableSymbol.type);
      //   assert(isTypeConcrete(sr, variableSymbol.type));

      //   if (node.value) {
      //     const value = sr.cc.nodes.get(node.value);
      //     if (value.variant === Collect.ENode.SymbolValueExpr && value.name === "default") {
      //       if (value.genericArgs.length !== 0) {
      //         throw new CompilerError(
      //           `'default' initializer cannot take any generics`,
      //           node.sourceloc
      //         );
      //       }
      //       elaboratedValueId = Conversion.MakeDefaultValue(
      //         sr,
      //         variableSymbol.type,
      //         node.sourceloc
      //       );
      //       assert(elaboratedValueId);
      //       elaboratedValue = sr.exprNodes.get(elaboratedValueId);
      //     } else {
      //       [elaboratedValue, elaboratedValueId] = elaborateExpr(sr, node.value, {
      //         scope: args.context.currentScope,
      //         elaboratedVariables: new Map(),
      //         context: args.context,
      //         blockScope: null,
      //         isMonomorphized: false,
      //         expectedReturnType: makePrimitiveAvailable(
      //           sr,
      //           EPrimitive.void,
      //           EDatatypeMutability.Default,
      //           node.sourceloc
      //         ),
      //         unsafe: false,
      //       });
      //     }
      //   }

      //   if (variableSymbol.comptime) {
      //     assert(elaboratedValueId);
      //     const r = EvalCTFE(sr, elaboratedValueId);
      //     if (!r.ok) throw new CompilerError(r.error, node.sourceloc);
      //     variableSymbol.comptimeValue = r.value[1];
      //   }

      //   const [s, sId] = Semantic.addSymbol(sr, {
      //     variant: Semantic.ENode.GlobalVariableDefinitionSymbol,
      //     export: variableSymbol.export,
      //     extern: variableSymbol.extern,
      //     name: variableSymbol.name,
      //     comptime: variableSymbol.comptime,
      //     value: elaboratedValueId,
      //     sourceloc: node.sourceloc,
      //     variableSymbol: variableSymbolId,
      //     parentStructOrNS: variableSymbol.parentStructOrNS,
      //     concrete: true,
      //   });
      //   sr.elaboratedGlobalVariableDefinitions.push({
      //     originalSymbol: nodeId,
      //     result: sId,
      //   });
      //   return [sId];
      // }

      case Collect.ENode.CInjectDirective: {
        return [this.sr.b.cInject(symbol.value, symbol.sourceloc)];
      }

      default:
        assert(false, "Global Symbol " + symbol.variant);
    }
  }

  instantiateAndElaborateStructWithGenerics(
    definedStructTypeId: Collect.TypeDefId,
    genericArgs: Semantic.ExprId[],
    sourceloc: SourceLoc
  ) {
    const definedStructType = this.sr.cc.typeDefNodes.get(definedStructTypeId);
    assert(definedStructType.variant === Collect.ENode.StructTypeDef);

    if (definedStructType.generics.length !== genericArgs.length) {
      throw new CompilerError(
        `Type ${definedStructType.name} expects ${definedStructType.generics.length} type parameters but got ${genericArgs.length}`,
        sourceloc
      );
    }

    let context = this.currentContext;

    if (definedStructType.generics.length !== 0) {
      assert(definedStructType.structScope);
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
      },
      () => {
        return this.instantiateAndElaborateStruct(definedStructTypeId);
      }
    );
  }

  instantiateAndElaborateStruct(
    definedStructTypeId: Collect.TypeDefId // The defining struct datatype to be instantiated (e.g. struct Foo<T> {})
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
      parentStructOrNS: parentStructOrNS,
      members: [],
      memberDefaultValues: [],
      methods: [],
      nestedStructs: [],
      sourceloc: definedStructType.sourceloc,
      concrete: genericArgs.every((g) => isTypeExprConcrete(this.sr, g)),
      originalCollectedSymbol: definedStructTypeId,
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

      const structScope = this.sr.cc.scopeNodes.get(definedStructType.structScope);
      assert(structScope.variant === Collect.ENode.StructScope);

      structScope.symbols.forEach((symbolId) => {
        const symbol = this.sr.cc.symbolNodes.get(symbolId);
        if (symbol.variant === Collect.ENode.VariableSymbol) {
          assert(symbol.type);
          const typeId = this.withContext(
            {
              context: Semantic.isolateElaborationContext(this.currentContext, {
                // Start lookup in the struct itself, these are members, so both the type and
                // its generics must be found from within the struct
                currentScope: definedStructType.structScope,
                genericsScope: definedStructType.structScope,
                constraints: [],
                instanceDeps: {
                  instanceDependsOn: new Map(),
                  structMembersDependOn: new Map(),
                  symbolDependsOn: new Map(),
                },
              }),
            },
            () => {
              return this.lookupAndElaborateDatatype(symbol.type!);
            }
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
            variableContext: EVariableContext.MemberOfStruct,
            parentStructOrNS: structId,
            comptime: false,
            comptimeValue: null,
            concrete: type.concrete,
          });
          struct.members.push(variableId);
          const defaultValue = definedStructType.defaultMemberValues.find(
            (v) => v.name === symbol.name
          );
          if (defaultValue) {
            const value = this.sr.cc.exprNodes.get(defaultValue.value);
            let defaultExprId: Semantic.ExprId;
            if (value.variant === Collect.ENode.SymbolValueExpr && value.name === "default") {
              if (value.genericArgs.length !== 0) {
                throw new CompilerError(
                  `'default' initializer cannot take any generics`,
                  symbol.sourceloc
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
                false
              ),
            });
          }
        } else if (symbol.variant === Collect.ENode.FunctionOverloadGroupSymbol) {
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
              def.sourceloc
            );
            struct.nestedStructs.push(subStructId);
          }
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
              expectedReturnType: this.expectedReturnType,
            },
            () => this.lookupAndElaborateDatatype(symbol.type!)
          );
        } else if (symbol.variableContext === EVariableContext.ThisReference) {
          if (this.currentContext.elaboratedVariables.has(variableSymbolId)) {
            break;
          } else {
            assert(
              false,
              "Variable definition statement for This-Reference was encountered, but it's not yet in the variableMap. It should already be elaborated by the parent."
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
    sourceloc: SourceLoc
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
          sourceloc
        );
      }

      if (givenArguments.length < numParametersWithoutPack) {
        throw new CompilerError(
          `Function ${functionName} requires at least ${numParametersWithoutPack} parameters, but ${givenArguments.length} are given`,
          sourceloc
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
    usageSourceLocation: SourceLoc
  ) {
    const overloadGroup = this.sr.cc.symbolNodes.get(overloadGroupId);
    assert(overloadGroup.variant === Collect.ENode.FunctionOverloadGroupSymbol);

    if (overloadGroup.overloads.size === 1) {
      return [...overloadGroup.overloads][0];
    }

    if (calledWithArgs === undefined) {
      throw new CompilerError(
        `Function '${overloadGroup.name}' is overloaded but not directly called, so there is not enough context to disambiguate the overload. Overloaded functions must be immediately called to disambiguate the call using the given arguments`,
        usageSourceLocation
      );
    }

    // First find exact matches
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
      signature.parameters.forEach((p, i) => {
        const passed = calledWithArgs.find((a) => a.index === i);
        if (!passed || !passed.exprId) {
          // This parameter is not passed or is not concrete, so hope that the others are enough for a match
          // matches = false;
          // reason = `Parameter #${i + 1} does not have a concrete type`;
          return;
        }

        const expression = this.sr.exprNodes.get(passed.exprId);
        if (expression.type !== p.type) {
          matches = false;
          reason = `Parameter #${i + 1} has unrelated type: ${Semantic.serializeTypeUse(
            this.sr,
            expression.type
          )} != ${Semantic.serializeTypeUse(this.sr, p.type)}`;
          return;
        }
        // Else it fits
      });

      matchingSignatures.push({
        matches: matches,
        signature: signatureId,
        reason: reason,
      });
    }

    if (matchingSignatures.filter((s) => s.matches).length === 1) {
      const signature = this.sr.symbolNodes.get(
        matchingSignatures.find((s) => s.matches)!.signature
      );
      assert(signature.variant === Semantic.ENode.FunctionSignature);
      return signature.originalFunction;
    }

    if (matchingSignatures.filter((s) => s.matches).length === 0) {
      let str = `No candidate for call to overloaded function '${overloadGroup.name}' matches arguments\n`;
      for (const candidate of matchingSignatures) {
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
      for (const candidate of matchingSignatures) {
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
    inference: Inference
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

    this.withContext(
      {
        context: newContext,
        expectedReturnType: this.expectedReturnType,
        functionReturnsInstanceIds: this.functionReturnsInstanceIds,
      },
      () => {
        for (const sId of scope.symbols) {
          const sym = this.sr.cc.symbolNodes.get(sId);
          if (sym.variant === Collect.ENode.VariableSymbol) {
            this.elaborateVariableSymbolInScope(sId);
          } else if (sym.variant === Collect.ENode.TypeDefSymbol) {
            const symbols = this.typeDefSymbol(sym);
          } else {
            assert(false);
          }
        }

        for (const sId of scope.statements) {
          const statement = this.elaborateStatement(sId, {
            gonnaInstantiateStructWithType: this.expectedReturnType,
            unsafe: scope.unsafe,
          });
          blockScope.statements.push(statement);
        }

        if (scope.emittedExpr) {
          blockScope.emittedExpr = this.expr(scope.emittedExpr, inference)[1];
        }
      }
    );
  }

  elaborateFunctionSymbolWithGenerics(
    functionSignatureId: Semantic.SymbolId,
    genericArgs: Semantic.ExprId[],
    usageSourceLocation: SourceLoc,
    parentStructOrNS: Semantic.TypeDefId | null,
    paramPackTypes: Semantic.TypeUseId[]
  ) {
    const functionSignature = this.sr.symbolNodes.get(functionSignatureId);
    assert(functionSignature.variant === Semantic.ENode.FunctionSignature);
    const func = this.sr.cc.symbolNodes.get(functionSignature.originalFunction);
    assert(func.variant === Collect.ENode.FunctionSymbol);

    if (func.generics.length !== genericArgs.length) {
      throw new CompilerError(
        `Function ${func.name} expects ${func.generics.length} type parameters but got ${genericArgs.length}`,
        usageSourceLocation
      );
    }

    if (
      !func.functionScope &&
      (func.generics.length !== 0 ||
        funcSymHasParameterPack(this.sr.cc, functionSignature.originalFunction))
    ) {
      throw new CompilerError(
        `Non-Extern function '${func.name}' is generic or uses a parameter pack, but does not define a body. (Generic functions cannot be forward declared)`,
        func.sourceloc
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
        expectedReturnType: functionSignature.returnType,
      },
      () => {
        return this.elaborateFunctionSymbol(
          functionSignatureId,
          functionSignature.parentStructOrNS,
          paramPackTypes
        );
      }
    );
  }

  elaborateFunctionSymbol(
    functionSignatureId: Semantic.SymbolId,
    parentStructOrNS: Semantic.TypeDefId | null,
    paramPackTypes: Semantic.TypeUseId[]
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

        const expectedReturnType = this.lookupAndElaborateDatatype(func.returnType);

        if (func.vararg && func.extern !== EExternLanguage.Extern_C) {
          throw new CompilerError(
            `A C-Style Vararg parameter pack may only be used on extern "C" functions`,
            func.sourceloc
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
                  func.sourceloc
                );
              }
              if (func.extern !== EExternLanguage.None) {
                throw new CompilerError(
                  `A Parameter Pack may not be used on an exported function`,
                  func.sourceloc
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
                    variableContext: EVariableContext.FunctionParameter,
                    sourceloc: func.sourceloc,
                  });
                  return variableId;
                }),
                concrete: true,
              });
              const [paramPackVariable, paramPackVariableId] = Semantic.addSymbol(this.sr, {
                variant: Semantic.ENode.VariableSymbol,
                comptime: false,
                comptimeValue: null,
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
                  func.sourceloc
                )[1],
                variableContext: EVariableContext.FunctionParameter,
                sourceloc: func.sourceloc,
              });
              newContext.elaboratedVariables.set(packVariable, paramPackVariableId);
              return makeTypeUse(
                this.sr,
                paramPackId,
                EDatatypeMutability.Const,
                false,
                func.sourceloc
              )[1];
            }
            return this.lookupAndElaborateDatatype(p.type);
          })
          .filter((p) => Boolean(p))
          .map((p) => p!);

        if (func.methodType === EMethodType.Method && !func.staticMethod) {
          parameterNames.unshift("this");
          assert(parentStructOrNS);
          parameters.unshift(
            makeTypeUse(
              this.sr,
              parentStructOrNS,
              EDatatypeMutability.Mut,
              false,
              func.sourceloc
            )[1]
          );
        }

        const ftype = makeRawFunctionDatatypeAvailable(this.sr, {
          parameters: parameters,
          returnType: expectedReturnType,
          vararg: func.vararg,
          sourceloc: func.sourceloc,
        });

        let [symbol, symbolId] = Semantic.addSymbol<Semantic.FunctionSymbol>(this.sr, {
          variant: Semantic.ENode.FunctionSymbol,
          type: ftype,
          export: func.export,
          generics: genericArgs,
          staticMethod: func.staticMethod,
          parameterPack: parameterPack,
          methodOf: parentStructOrNS,
          methodType: func.methodType,
          parentStructOrNS: parentStructOrNS,
          noemit: func.noemit,
          extern: func.extern,
          parameterNames: parameterNames,
          name: func.name,
          sourceloc: func.sourceloc,
          returnsInstanceIds: new Set(),
          instanceDepsSnapshot: this.sr.e.currentContext.instanceDeps,
          scope: null,
          concrete: this.sr.typeDefNodes.get(ftype).concrete,
        });

        if (symbol.concrete) {
          insertIntoFuncDefCache(this.sr, functionSignature.originalFunction, {
            genericArgs: genericArgs,
            paramPackTypes: paramPackTypes,
            parentStructOrNS: parentStructOrNS,
            result: symbolId,
            substitutionContext: newContext,
          });

          if (func.functionScope) {
            const [bodyScope, bodyScopeId] = Semantic.addBlockScope(this.sr, {
              variant: Semantic.ENode.BlockScope,
              statements: [],
              emittedExpr: null,
              constraints: [],
            });

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
                EDatatypeMutability.Mut,
                false,
                func.sourceloc
              )[1];
              const [variable, variableId] = Semantic.addSymbol(this.sr, {
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
              });
              newContext.elaboratedVariables.set(collectedThisRefId, variableId);
            }

            for (const sId of functionScope.symbols) {
              const symbol = this.sr.cc.symbolNodes.get(sId);
              if (symbol.variant === Collect.ENode.VariableSymbol) {
                this.withContext(
                  {
                    context: newContext,
                    expectedReturnType: expectedReturnType,
                  },
                  () => {
                    this.elaborateVariableSymbolInScope(sId);
                  }
                );
              }
            }

            symbol.scope = bodyScopeId;
            this.withContext(
              {
                context: newContext,
                expectedReturnType: expectedReturnType,
                functionReturnsInstanceIds: symbol.returnsInstanceIds,
              },
              () => {
                this.elaborateBlockScope(
                  {
                    sourceScopeId: functionScope.blockScope,
                    targetScopeId: bodyScopeId,
                  },
                  undefined
                );
              }
            );

            if (func.name === "main" && parentStructOrNS) {
              const modulePrefix = getModuleGlobalNamespaceName(
                this.sr.cc.config.name,
                this.sr.cc.config.version
              );
              const parent = this.sr.typeDefNodes.get(parentStructOrNS);
              if ("name" in parent && parent.name === modulePrefix) {
                if (this.sr.globalMainFunction !== null) {
                  const existing = this.sr.symbolNodes.get(this.sr.globalMainFunction);
                  assert(existing.variant === Semantic.ENode.FunctionSymbol);
                  if (existing.sourceloc) {
                    throw new CompilerError(
                      `Multiply defined main function: Previous definition at ${formatSourceLoc(
                        existing.sourceloc
                      )}`,
                      func.sourceloc
                    );
                  } else {
                    throw new CompilerError(`Multiply defined main function`, func.sourceloc);
                  }
                }
                this.sr.globalMainFunction = symbolId;
              }
            }
          }
        }

        return symbolId;
      }
    );
  }

  lookupAndElaborateDatatype(typeId: Collect.TypeUseId): Semantic.TypeUseId {
    const type = this.sr.cc.typeUseNodes.get(typeId);

    switch (type.variant) {
      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.FunctionDatatype: {
        return makeFunctionDatatypeAvailable(this.sr, {
          parameters: type.parameters.map((p) => this.lookupAndElaborateDatatype(p)),
          returnType: this.lookupAndElaborateDatatype(type.returnType),
          vararg: type.vararg,
          mutability: type.mutability,
          sourceloc: type.sourceloc,
        });
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
          type.sourceloc
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
          type.sourceloc
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
              type.sourceloc
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
                type.genericArgs[0]
              )}' cannot be used as a generic substitute`,
              type.sourceloc
            );
          }
          if (
            farg.variant !== Collect.ENode.TypeLiteralExpr ||
            this.sr.cc.typeUseNodes.get(farg.datatype).variant !== Collect.ENode.FunctionDatatype
          ) {
            throw new CompilerError(
              `Type Callable<> must take a function datatype as the generic argument`,
              type.sourceloc
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
            type.sourceloc
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
                  mappedTo
                )}', which cannot be used as a datatype`,
                type.sourceloc
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
              type.sourceloc
            )[1];
          }
        } else if (found.variant === Collect.ENode.TypeDefSymbol) {
          const typedef = this.sr.cc.typeDefNodes.get(found.typeDef);
          if (typedef.variant === Collect.ENode.TypeDefAlias) {
            const aliasedTypeId = this.lookupAndElaborateDatatype(typedef.target);
            if (type.innerNested) {
              const aliasedType = this.sr.typeDefNodes.get(
                this.sr.typeUseNodes.get(aliasedTypeId).type
              );
              if (aliasedType.variant !== Semantic.ENode.NamespaceDatatype) {
                throw new CompilerError(
                  `Type '${Semantic.serializeTypeUse(
                    this.sr,
                    aliasedTypeId
                  )}' cannot be used as a namespace`,
                  type.sourceloc
                );
              }
              const collectedNamespace = this.sr.cc.typeDefNodes.get(
                aliasedType.collectedNamespace
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
                },
                () => {
                  return this.lookupAndElaborateDatatype(type.innerNested!);
                }
              );
            }
            return aliasedTypeId;
          } else if (typedef.variant === Collect.ENode.StructTypeDef) {
            const generics = type.genericArgs.map((g) => {
              return this.withContext(
                {
                  context: this.currentContext,
                },
                () => this.expressionAsGenericArg(g)
              );
            });
            const structId = this.instantiateAndElaborateStructWithGenerics(
              found.typeDef,
              generics,
              type.sourceloc
            );
            const struct = this.sr.typeDefNodes.get(structId);
            assert(struct.variant === Semantic.ENode.StructDatatype);
            const structScope = this.sr.cc.scopeNodes.get(typedef.structScope);
            assert(structScope.variant === Collect.ENode.StructScope);

            if (type.innerNested) {
              // Here we need to merge the context from the parent into the child
              let cachedParentSubstitutions = undefined as Semantic.ElaborationContext | undefined;
              const entry = this.sr.elaboratedStructDatatypes.get(found.typeDef);

              for (const cache of entry || []) {
                if (
                  cache.canonicalizedGenerics.length === generics.length &&
                  cache.canonicalizedGenerics.every(
                    (g, i) => g === Semantic.canonicalizeGenericExpr(this.sr, generics[i])
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
                      currentScope: typedef.structScope,
                      genericsScope: this.currentContext.genericsScope,
                      instanceDeps: {
                        instanceDependsOn: new Map(),
                        structMembersDependOn: new Map(),
                        symbolDependsOn: new Map(),
                      },
                    }
                  ),
                },
                () => {
                  return this.lookupAndElaborateDatatype(type.innerNested!);
                }
              );
            } else {
              return makeTypeUse(
                this.sr,
                structId,
                type.mutability,
                type.inline,
                type.sourceloc
              )[1];
            }
          } else if (typedef.variant === Collect.ENode.NamespaceTypeDef) {
            if (!type.innerNested) {
              return makeTypeUse(
                this.sr,
                this.namespace(found.typeDef),
                type.mutability,
                type.inline,
                type.sourceloc
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
              },
              () => {
                return this.lookupAndElaborateDatatype(type.innerNested!);
              }
            );
          }
        }
        throw new CompilerError(
          `Symbol '${type.name}' cannot be used as a datatype here`,
          type.sourceloc
        );
      }

      case Collect.ENode.ParameterPack: {
        return this.sr.b.paramPackTypeUse(EDatatypeMutability.Default, type.sourceloc);
      }

      case Collect.ENode.UnionDatatype: {
        return this.sr.b.unionTypeUse(
          type.members.map((m) => this.lookupAndElaborateDatatype(m)),
          type.sourceloc
        );
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      default:
        assert(false, (type as any).variant.toString());
    }
  }

  assignmentExpr(assignment: Collect.ExprAssignmentExpr, inference: Inference) {
    return this.sr.b.assignment(
      this.expr(assignment.expr, inference)[1],
      assignment.operation,
      this.expr(assignment.value, inference)[1],
      this.currentContext.constraints,
      assignment.sourceloc,
      inference
    );
  }

  elaborateParentSymbolFromCache(parentScopeId: Collect.ScopeId): Semantic.TypeDefId | null {
    let parentStructOrNS = null as Semantic.TypeDefId | null;
    const parentScope = this.sr.cc.scopeNodes.get(parentScopeId);
    if (parentScope.variant === Collect.ENode.StructScope) {
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
            (g, i) => g === Semantic.canonicalizeGenericExpr(this.sr, parentGenericArgs[i])
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

    if (this.sr.elaboratedFunctionSignatures.has(functionSymbolId)) {
      const signatures = this.sr.elaboratedFunctionSignatures.get(functionSymbolId)!;
      for (const signatureId of signatures) {
        const signature = this.sr.symbolNodes.get(signatureId);
        assert(signature.variant === Semantic.ENode.FunctionSignature);
        if (
          signature.genericPlaceholders.length === genericPlaceholders.length &&
          signature.genericPlaceholders.every((g, i) => g === genericPlaceholders[i])
        ) {
          return signatureId;
        }
      }
    }

    const parent = this.elaborateParentSymbolFromCache(functionSymbol.parentScope);

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
          },
          () => this.lookupAndElaborateDatatype(p.type)
        );
        return {
          name: p.name,
          type: type,
        };
      }),
      returnType: this.withContext(
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
        },
        () => this.lookupAndElaborateDatatype(functionSymbol.returnType)
      ),
    });

    for (const sigId of this.sr.elaboratedFunctionSignaturesByName.get(cacheCodename) || []) {
      const sig = this.sr.symbolNodes.get(sigId);
      assert(sig.variant === Semantic.ENode.FunctionSignature);
      if (
        sig.name === signature.name &&
        sig.parentStructOrNS === signature.parentStructOrNS &&
        sig.parameters.length === signature.parameters.length &&
        sig.parameters.every((p, i) => signature.parameters[i].type === p.type)
      ) {
        const ori = this.sr.cc.symbolNodes.get(sig.originalFunction);
        assert(ori.variant === Collect.ENode.FunctionSymbol);
        throw new CompilerError(
          `A conflicting function with the same signature is already defined.${
            ori.sourceloc ? " Existing definition at: " + formatSourceLoc(ori.sourceloc) : ""
          }`,
          functionSymbol.sourceloc
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
    inference: Inference
  ) {
    const symbol = this.sr.cc.symbolNodes.get(symbolId);
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
        memberAccessExpr.sourceloc
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
        memberAccessExpr.sourceloc
      );

      const funcsym = this.sr.cc.symbolNodes.get(chosenOverloadId);
      assert(funcsym.variant === Collect.ENode.FunctionSymbol);

      const paramPackTypes = this.prepareParameterPackTypes(
        name,
        funcsym.parameters,
        inference?.gonnaCallFunctionWithParameterValues,
        memberAccessExpr.sourceloc
      );

      const functionSymbolId = this.elaborateFunctionSymbolWithGenerics(
        this.elaborateFunctionSignature(chosenOverloadId),
        memberAccessExpr.genericArgs.map((g) => this.expressionAsGenericArg(g)),
        memberAccessExpr.sourceloc,
        this.elaborateParentSymbolFromCache(symbol.parentScope),
        paramPackTypes
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
    inference: Inference
  ) {
    const namespace = this.sr.exprNodes.get(namespaceValueId);
    assert(namespace.variant === Semantic.ENode.DatatypeAsValueExpr);
    const semanticNamespace = this.sr.typeDefNodes.get(
      this.sr.typeUseNodes.get(namespace.type).type
    );
    assert(semanticNamespace.variant === Semantic.ENode.NamespaceDatatype);
    const collectedNamespace = this.sr.cc.typeDefNodes.get(semanticNamespace.collectedNamespace);
    assert(collectedNamespace.variant === Collect.ENode.NamespaceTypeDef);
    const collectedNSSharedInstance = this.sr.cc.nsSharedInstances.get(
      collectedNamespace.sharedInstance
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
          inference
        );
        if (s) {
          return s;
        }
      }
    }
    throw new CompilerError(
      `Namespace '${collectedNamespace.name}' does not define any declarations named '${memberAccessExpr.memberName}'`,
      memberAccessExpr.sourceloc
    );
  }

  lookupAndElaborateStaticStructAccess(
    namespaceOrStructValueId: Semantic.ExprId,
    name: string,
    memberAccessExpr: Collect.MemberAccessExpr,
    inference: Inference
  ) {
    const namespaceOrStructValue = this.sr.exprNodes.get(namespaceOrStructValueId);
    assert(namespaceOrStructValue.variant === Semantic.ENode.DatatypeAsValueExpr);
    const semanticStruct = this.sr.typeDefNodes.get(
      this.sr.typeUseNodes.get(namespaceOrStructValue.type).type
    );
    assert(semanticStruct.variant === Semantic.ENode.StructDatatype);
    const collectedStruct = this.sr.cc.typeDefNodes.get(semanticStruct.originalCollectedSymbol);
    assert(collectedStruct.variant === Collect.ENode.StructTypeDef);
    const structScope = this.sr.cc.scopeNodes.get(collectedStruct.structScope);
    assert(structScope.variant === Collect.ENode.StructScope);

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
            }
          ),
        },
        () => this.lookupSymbolInNamespaceOrStructScope(symbolId, name, memberAccessExpr, inference)
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
                symbol.symbol
              )} is not static but is used in a static context`,
              memberAccessExpr.sourceloc
            );
          }
        }
        return s;
      }
    }
    throw new CompilerError(
      `Struct '${collectedStruct.name}' does not define any declarations named '${memberAccessExpr.memberName}'`,
      memberAccessExpr.sourceloc
    );
  }

  makeStructInstantiation(
    structId: Semantic.TypeDefId,
    memberValues: {
      name: string;
      value: Collect.ExprId;
    }[],
    inline: boolean,
    expectedReturnType: Semantic.TypeUseId | undefined,
    sourceloc: SourceLoc,
    inference: Inference
  ): [Semantic.Expression, Semantic.ExprId] {
    const struct = this.sr.typeDefNodes.get(structId);
    assert(struct.variant === Semantic.ENode.StructDatatype);

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
    for (const m of memberValues) {
      const variableId = struct.members.find((mmId) => {
        const mm = this.sr.symbolNodes.get(mmId);
        assert(mm.variant === Semantic.ENode.VariableSymbol);
        return mm.name === m.name;
      });

      if (!variableId) {
        throw new CompilerError(
          `${Semantic.serializeTypeDef(this.sr, structId)} does not have a member named '${
            m.name
          }'`,
          sourceloc
        );
      }
      const variable = this.sr.symbolNodes.get(variableId);
      assert(variable.variant === Semantic.ENode.VariableSymbol);

      if (assignedMembers.includes(m.name)) {
        throw new CompilerError(`Cannot assign member ${m.name} twice`, sourceloc);
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
        sourceloc,
        Conversion.Mode.Implicit,
        inference?.unsafe
      );

      remainingMembers = remainingMembers.filter((mm) => mm !== m.name);
      assign.push({
        value: convertedExprId,
        name: m.name,
      });
      assignedMembers.push(m.name);
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
      sourceloc
    );

    return this.sr.b.structLiteral(
      makeTypeUse(this.sr, structId, EDatatypeMutability.Const, inline, sourceloc)[1],
      assign,
      sourceloc
    );
  }

  elaborateDatatypeMemberAccess(
    sr: SemanticResult,
    datatypeAsValueExprId: Semantic.ExprId,
    typeUseId: Semantic.TypeUseId,
    memberAccessExpr: Collect.MemberAccessExpr,
    inference: Inference
  ) {
    const datatypeValueInstance = sr.typeUseNodes.get(typeUseId);
    const datatypeValue = sr.typeDefNodes.get(datatypeValueInstance.type);

    if (memberAccessExpr.memberName === "name") {
      return this.sr.b.literal(
        Semantic.serializeFullTypeUse(sr, typeUseId),
        memberAccessExpr.sourceloc
      );
    }
    if (memberAccessExpr.memberName === "mangled") {
      const name = Semantic.mangleFullTypeUse(sr, typeUseId);
      return this.sr.b.literal(
        name.wasMangled ? "_H" + name.name : name.name,
        memberAccessExpr.sourceloc
      );
    }

    if (datatypeValue.variant === Semantic.ENode.NamespaceDatatype) {
      return this.lookupAndElaborateNamespaceMemberAccess(
        datatypeAsValueExprId,
        memberAccessExpr.memberName,
        memberAccessExpr,
        inference
      );
    } else if (datatypeValue.variant === Semantic.ENode.StructDatatype) {
      return this.lookupAndElaborateStaticStructAccess(
        datatypeAsValueExprId,
        memberAccessExpr.memberName,
        memberAccessExpr,
        inference
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
            memberAccessExpr.sourceloc
          );
        }
      }

      throw new CompilerError(
        `Datatype ${Semantic.serializeTypeUse(sr, typeUseId)} does not have a member named '${
          memberAccessExpr.memberName
        }'`,
        memberAccessExpr.sourceloc
      );
    } else {
      assert(false, datatypeValue.variant.toString());
    }
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
        const [condition, conditionId] = this.expr(s.condition, undefined);
        if (s.comptime) {
          const conditionValue = EvalCTFEBoolean(this.sr, conditionId, s.sourceloc);
          if (conditionValue) {
            const [thenScope, thenScopeId] = Semantic.addBlockScope(this.sr, {
              variant: Semantic.ENode.BlockScope,
              statements: [],
              emittedExpr: null,
              constraints: [...this.currentContext.constraints],
            });
            this.elaborateBlockScope(
              {
                targetScopeId: thenScopeId,
                sourceScopeId: s.thenBlock,
              },
              undefined
            );
            return Semantic.addStatement(this.sr, {
              variant: Semantic.ENode.ExprStatement,
              expr: Semantic.addExpr(this.sr, {
                variant: Semantic.ENode.BlockScopeExpr,
                instanceIds: [],
                block: thenScopeId,
                isTemporary: true,
                type: this.sr.b.voidType(),
                sourceloc: s.sourceloc,
              })[1],
              sourceloc: s.sourceloc,
            })[1];
          }

          for (const elif of s.elseif) {
            const [condition, conditionId] = this.expr(elif.condition, undefined);
            if (EvalCTFEBoolean(this.sr, conditionId, s.sourceloc)) {
              const [thenScope, thenScopeId] = Semantic.addBlockScope(this.sr, {
                variant: Semantic.ENode.BlockScope,
                statements: [],
                emittedExpr: null,
                constraints: [...this.currentContext.constraints],
              });
              this.elaborateBlockScope(
                {
                  targetScopeId: thenScopeId,
                  sourceScopeId: elif.thenBlock,
                },
                undefined
              );
              return Semantic.addStatement(this.sr, {
                variant: Semantic.ENode.ExprStatement,
                expr: Semantic.addExpr(this.sr, {
                  variant: Semantic.ENode.BlockScopeExpr,
                  instanceIds: [],
                  block: thenScopeId,
                  isTemporary: true,
                  type: this.sr.b.voidType(),
                  sourceloc: s.sourceloc,
                })[1],
                sourceloc: s.sourceloc,
              })[1];
            }
          }

          if (s.elseBlock) {
            const [thenScope, thenScopeId] = Semantic.addBlockScope(this.sr, {
              variant: Semantic.ENode.BlockScope,
              emittedExpr: null,
              statements: [],
              constraints: [...this.currentContext.constraints],
            });
            this.elaborateBlockScope(
              {
                targetScopeId: thenScopeId,
                sourceScopeId: s.elseBlock,
              },
              undefined
            );
            return Semantic.addStatement(this.sr, {
              variant: Semantic.ENode.ExprStatement,
              expr: Semantic.addExpr(this.sr, {
                variant: Semantic.ENode.BlockScopeExpr,
                instanceIds: [],
                block: thenScopeId,
                isTemporary: true,
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
                emittedExpr: null,
                constraints: [...this.currentContext.constraints],
              })[1],
              isTemporary: true,
              type: this.sr.b.voidType(),
              sourceloc: s.sourceloc,
            })[1],
            sourceloc: s.sourceloc,
          })[1];
        } else {
          const [thenScope, thenScopeId] = Semantic.addBlockScope(this.sr, {
            variant: Semantic.ENode.BlockScope,
            statements: [],
            emittedExpr: null,
            constraints: [...this.currentContext.constraints],
          });
          this.buildConstraints(thenScope.constraints, conditionId);
          return this.withContext(
            {
              context: Semantic.isolateElaborationContext(this.currentContext, {
                constraints: thenScope.constraints,
                currentScope: this.currentContext.currentScope,
                genericsScope: this.currentContext.genericsScope,
                instanceDeps: this.currentContext.instanceDeps,
              }),
              expectedReturnType: this.expectedReturnType,
              functionReturnsInstanceIds: this.functionReturnsInstanceIds,
            },
            () => {
              this.elaborateBlockScope(
                {
                  targetScopeId: thenScopeId,
                  sourceScopeId: s.thenBlock,
                },
                undefined
              );
              const elseIfs = s.elseif.map((e) => {
                const [innerThenScope, innerThenScopeId] = Semantic.addBlockScope(this.sr, {
                  variant: Semantic.ENode.BlockScope,
                  statements: [],
                  emittedExpr: null,
                  constraints: [...this.currentContext.constraints],
                });
                this.elaborateBlockScope(
                  {
                    targetScopeId: innerThenScopeId,
                    sourceScopeId: e.thenBlock,
                  },
                  undefined
                );
                return {
                  condition: this.expr(e.condition, undefined)[1],
                  then: innerThenScopeId,
                };
              });

              let [elseScope, elseScopeId] = [
                undefined as undefined | Semantic.BlockScope,
                undefined as Semantic.BlockScopeId | undefined,
              ];
              if (s.elseBlock) {
                [elseScope, elseScopeId] = Semantic.addBlockScope(this.sr, {
                  variant: Semantic.ENode.BlockScope,
                  statements: [],
                  emittedExpr: null,
                  constraints: [...this.currentContext.constraints],
                });
                this.elaborateBlockScope(
                  {
                    targetScopeId: elseScopeId,
                    sourceScopeId: s.elseBlock,
                  },
                  undefined
                );
              }
              return Semantic.addStatement(this.sr, {
                variant: Semantic.ENode.IfStatement,
                condition: conditionId,
                then: thenScopeId,
                elseIfs: elseIfs,
                else: elseScopeId,
                sourceloc: s.sourceloc,
              })[1];
            }
          );
        }
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.WhileStatement: {
        const [condition, conditionId] = this.expr(s.condition, undefined);
        const [thenScope, thenScopeId] = Semantic.addBlockScope(this.sr, {
          variant: Semantic.ENode.BlockScope,
          emittedExpr: null,
          statements: [],
          constraints: [...this.currentContext.constraints],
        });
        this.elaborateBlockScope(
          {
            targetScopeId: thenScopeId,
            sourceScopeId: s.block,
          },
          undefined
        );
        return Semantic.addStatement(this.sr, {
          variant: Semantic.ENode.WhileStatement,
          condition: conditionId,
          then: thenScopeId,
          sourceloc: s.sourceloc,
        })[1];
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.ReturnStatement: {
        if (s.expr) {
          if (!this.expectedReturnType) {
            throw new CompilerError(
              `Cannot return in this context, it's not in a function context`,
              s.sourceloc
            );
          }
          const eId = Conversion.MakeConversionOrThrow(
            this.sr,
            this.expr(s.expr, {
              gonnaInstantiateStructWithType: this.expectedReturnType,
            })[1],
            this.expectedReturnType,
            this.currentContext.constraints,
            s.sourceloc,
            Conversion.Mode.Implicit,
            false
          );

          const expression = this.sr.exprNodes.get(eId);
          assert(this.functionReturnsInstanceIds);
          expression.instanceIds.forEach((i) => this.functionReturnsInstanceIds!.add(i));

          return Semantic.addStatement(this.sr, {
            variant: Semantic.ENode.ReturnStatement,
            expr: eId,
            sourceloc: s.sourceloc,
          })[1];
        } else {
          return Semantic.addStatement(this.sr, {
            variant: Semantic.ENode.ReturnStatement,
            sourceloc: s.sourceloc,
          })[1];
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
                s.sourceloc
              );
            }
            if (!inference?.unsafe) {
              throw new CompilerError(
                `The 'uninitialized' directive may only appear in an explicit unsafe block`,
                s.sourceloc
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
              expectedReturnType: this.expectedReturnType,
            },
            () => this.lookupAndElaborateDatatype(collectedVariableSymbol.type!)
          );
          assert(variableSymbol.type);
        }

        let valueId: Semantic.ExprId | undefined;
        if (s.value) {
          const sValue = this.sr.cc.exprNodes.get(s.value);
          if (sValue.variant === Collect.ENode.SymbolValueExpr && sValue.name === "default") {
            if (sValue.genericArgs.length !== 0) {
              throw new CompilerError(
                `'default' initializer cannot take any generics`,
                s.sourceloc
              );
            }
            if (!variableSymbol.type) {
              throw new CompilerError(
                `Variable initializations with a 'default' initializer require an explicit datatype to be specified`,
                s.sourceloc
              );
            }
            valueId = Conversion.MakeDefaultValue(this.sr, variableSymbol.type, s.sourceloc);
          } else {
            valueId =
              (!uninitialized &&
                s.value &&
                this.expr(s.value, {
                  gonnaInstantiateStructWithType: variableSymbol.type ?? undefined,
                })[1]) ||
              undefined;
          }
        }
        const value = valueId && this.sr.exprNodes.get(valueId);

        if (value?.variant === Semantic.ENode.DatatypeAsValueExpr) {
          throw new CompilerError(
            `A struct/namespace datatype cannot be written into a variable`,
            value.sourceloc
          );
        }

        if ((!valueId || !value) && !uninitialized) {
          throw new CompilerError(
            `Variable '${variableSymbol.name}' requires an initialization value`,
            s.sourceloc
          );
        }

        if (!variableSymbol.type) {
          variableSymbol.type = value?.type || null;

          if (variableSymbol.type && value) {
            const variableSymbolType = this.sr.typeUseNodes.get(variableSymbol.type);
            const variableSymbolTypeDef = this.sr.typeDefNodes.get(variableSymbolType.type);
            if (variableSymbol.mutability === EVariableMutability.Const) {
            } else {
              // If a const T value is assigned to a let variable,
              // a copy is made which makes the copied value fully mutable.
              variableSymbol.type = makeTypeUse(
                this.sr,
                variableSymbolType.type,
                EDatatypeMutability.Mut,
                variableSymbolType.inline,
                s.sourceloc
              )[1];
            }
          }
        }
        assert(variableSymbol.type);
        variableSymbol.concrete = this.sr.typeDefNodes.get(
          this.sr.typeUseNodes.get(variableSymbol.type).type
        ).concrete;
        const variableSymbolType = this.sr.typeUseNodes.get(variableSymbol.type);
        const variableSymbolTypeDef = this.sr.typeDefNodes.get(variableSymbolType.type);

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
                inference?.unsafe
              )) ||
            null,
          sourceloc: s.sourceloc,
        })[1];
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.ExprStatement:
        return Semantic.addStatement(this.sr, {
          variant: Semantic.ENode.ExprStatement,
          expr: this.expr(s.expr, undefined)[1],
          sourceloc: s.sourceloc,
        })[1];

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.ForEachStatement: {
        if (s.comptime) {
          const [value, valueId] = this.expr(s.value, undefined);
          const r = EvalCTFE(this.sr, valueId);
          if (!r.ok) throw new CompilerError(r.error, s.sourceloc);
          const [comptimeValue, comptimeValueId] = r.value;
          if (comptimeValue.variant !== Semantic.ENode.SymbolValueExpr) {
            throw new CompilerError(
              `For each loop over something other than a parameter pack is not implemented yet`,
              s.sourceloc
            );
          }
          const comptimeExpr = this.sr.typeDefNodes.get(
            this.sr.typeUseNodes.get(comptimeValue.type).type
          );
          if (comptimeExpr.variant !== Semantic.ENode.ParameterPackDatatype) {
            throw new CompilerError(
              `For each loop over something other than a parameter pack is not implemented yet`,
              s.sourceloc
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
                EPrimitive.usize,
                EDatatypeMutability.Const,
                s.sourceloc
              ),
              variableContext: EVariableContext.FunctionLocal,
            } satisfies Semantic.VariableSymbol);
          }

          const allScopes: Semantic.StatementId[] = [];
          for (let i = 0; i < comptimeExpr.parameters.length; i++) {
            const [thenScope, thenScopeId] = Semantic.addBlockScope(this.sr, {
              variant: Semantic.ENode.BlockScope,
              statements: [],
              emittedExpr: null,
              constraints: [...this.currentContext.constraints],
            });

            const semanticParamId = comptimeExpr.parameters[i];
            const paramValue = this.sr.symbolNodes.get(semanticParamId);
            assert(paramValue.variant === Semantic.ENode.VariableSymbol);
            assert(paramValue.type);

            syntheticMap.set(s.loopVariable, semanticParamId);
            if (s.indexVariable) {
              assert(loopIndexId && loopIndex);
              loopIndex.comptimeValue = this.sr.b.literalValue(
                {
                  type: EPrimitive.usize,
                  unit: null,
                  value: BigInt(i),
                },
                s.sourceloc
              )[1];
              syntheticMap.set(s.indexVariable, loopIndexId);
            }
            this.elaborateBlockScope(
              {
                targetScopeId: thenScopeId,
                sourceScopeId: s.body,
              },
              undefined
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
                  sourceloc: s.sourceloc,
                  isTemporary: true,
                  type: this.sr.b.voidType(),
                })[1],
                sourceloc: s.sourceloc,
              })[1]
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
                emittedExpr: null,
                constraints: [...this.currentContext.constraints],
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

      default:
        assert(false);
    }
  }

  applyBinaryExprConstraints(
    constraints: Semantic.Constraint[],
    symbolValueExprId: Semantic.ExprId,
    literalExprId: Semantic.ExprId,
    operation: EBinaryOperation
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
            operation: operation,
            value: literalExprId,
          },
          variableSymbol: symbolValueExpr.symbol,
        });
    }
  }

  buildConstraints(constraints: Semantic.Constraint[], exprId: Semantic.ExprId) {
    const expr = this.sr.exprNodes.get(exprId);
    const exprTypeUse = this.sr.typeUseNodes.get(expr.type);
    const exprTypeDef = this.sr.typeDefNodes.get(exprTypeUse.type);

    if (expr.variant === Semantic.ENode.BinaryExpr) {
      if (expr.operation === EBinaryOperation.BoolAnd) {
        this.buildConstraints(constraints, expr.left);
        this.buildConstraints(constraints, expr.right);
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
              expr.operation
            );
          }
        } else if (rightExpr.variant === Semantic.ENode.SymbolValueExpr) {
          const leftValue = EvalCTFE(this.sr, expr.left);
          if (leftValue.ok) {
            this.applyBinaryExprConstraints(
              constraints,
              expr.right,
              leftValue.value[1],
              expr.operation
            );
          }
        }
      }
    }

    if (
      expr.variant === Semantic.ENode.SymbolValueExpr &&
      exprTypeDef.variant === Semantic.ENode.UnionDatatype
    ) {
      const memberDefs = exprTypeDef.members.map((m) => this.sr.typeUseNodes.get(m).type);
      if (memberDefs.includes(this.sr.b.nullTypeDef())) {
        constraints.push({
          constraintValue: {
            kind: "union",
            operation: "isNot",
            typeDef: this.sr.b.nullTypeDef(),
          },
          variableSymbol: expr.symbol,
        });
      }
      if (memberDefs.includes(this.sr.b.noneTypeDef())) {
        constraints.push({
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

  structInstantiation(structInst: Collect.StructInstantiationExpr, inference: Inference) {
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
        },
        () => this.lookupAndElaborateDatatype(structInst.structType!)
      );
    } else if (inference?.gonnaInstantiateStructWithType) {
      structId = inference?.gonnaInstantiateStructWithType;
    }

    if (!structId) {
      throw new CompilerError(
        `This struct is anonymous and must be type-inferred, but there is not enough context to infer it. Either it is not directly passed to something that expects a specific type, or it is being passed to an overloaded function.`,
        structInst.sourceloc
      );
    }

    const struct = this.sr.typeDefNodes.get(this.sr.typeUseNodes.get(structId).type);
    if (struct.variant !== Semantic.ENode.StructDatatype) {
      throw new CompilerError(
        `Non-structural type '${Semantic.serializeTypeUse(
          this.sr,
          structId
        )}' cannot be instantiated as a struct`,
        structInst.sourceloc
      );
    }

    const structTypeUse = this.sr.typeUseNodes.get(structId);
    return this.makeStructInstantiation(
      structTypeUse.type,
      structInst.members,
      structTypeUse.inline,
      this.expectedReturnType,
      structInst.sourceloc,
      inference
    );
  }

  symbolValue(
    symbolValue: Collect.SymbolValueExpr,
    inference: Inference
  ): [Semantic.Expression, Semantic.ExprId] {
    if (symbolValue.name === "null") {
      return this.sr.b.literalValue(
        {
          type: EPrimitive.null,
        },
        symbolValue.sourceloc
      );
    }
    if (symbolValue.name === "none") {
      return this.sr.b.literalValue(
        {
          type: EPrimitive.none,
        },
        symbolValue.sourceloc
      );
    }

    const primitive = stringToPrimitive(symbolValue.name);
    if (primitive) {
      if (symbolValue.genericArgs.length > 0) {
        throw new CompilerError(`Type ${symbolValue.name} is not generic`, symbolValue.sourceloc);
      }
      return this.sr.b.datatypeUseAsValue(
        this.sr.b.primitiveType(primitive, symbolValue.sourceloc),
        symbolValue.sourceloc
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
      const newId = this.withContext(
        {
          context: Semantic.isolateElaborationContext(this.currentContext, {
            currentScope: symbol.inScope,
            genericsScope: symbol.inScope,
            constraints: this.currentContext.constraints,
            instanceDeps: {
              instanceDependsOn: new Map(),
              structMembersDependOn: new Map(),
              symbolDependsOn: new Map(),
            },
          }),
        },
        () =>
          this.lookupAndElaborateDatatype(
            (this.sr.cc.typeDefNodes.get(symbol.typeDef) as Collect.TypeDefAlias).target
          )
      );
      return this.sr.b.datatypeUseAsValue(newId, symbolValue.sourceloc);
    }

    if (symbol.variant === Collect.ENode.VariableSymbol) {
      if (symbolValue.genericArgs.length !== 0) {
        throw new CompilerError(
          `A variable access cannot have a type parameter list`,
          symbolValue.sourceloc
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
            symbolValue.sourceloc
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
          symbolValue.sourceloc
        );

        const type = this.sr.typeDefNodes.get(this.sr.typeUseNodes.get(elaboratedSymbol.type).type);
        if (type.variant === Semantic.ENode.UnionDatatype) {
          const narrowing = Conversion.typeNarrowing(this.sr);
          narrowing.addVariants(type.members);
          narrowing.constrainFromConstraints(this.currentContext.constraints, symbolValueExprId);

          if (narrowing.possibleVariants.size === 1) {
            const index = type.members.findIndex((m) => m === [...narrowing.possibleVariants][0]);
            assert(index !== -1);

            return Semantic.addExpr(this.sr, {
              variant: Semantic.ENode.UnionToValueCastExpr,
              instanceIds: [],
              expr: symbolValueExprId,
              index: index,
              isTemporary: true,
              sourceloc: symbolValue.sourceloc,
              type: [...narrowing.possibleVariants][0],
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
        symbolValue.sourceloc
      );

      const chosenOverload = this.sr.cc.symbolNodes.get(chosenOverloadId);
      assert(chosenOverload.variant === Collect.ENode.FunctionSymbol);

      if (chosenOverload.methodType === EMethodType.Method) {
        throw new CompilerError(
          `Function '${chosenOverload.name}' was accessed directly by name, but it is a method, which must be accessed through 'this.${chosenOverload.name}'`,
          symbolValue.sourceloc
        );
      }

      const parameterPackTypes = this.prepareParameterPackTypes(
        symbol.name,
        chosenOverload.parameters,
        inference?.gonnaCallFunctionWithParameterValues,
        symbolValue.sourceloc
      );

      const elaboratedSymbolId = this.elaborateFunctionSymbolWithGenerics(
        this.elaborateFunctionSignature(chosenOverloadId),
        symbolValue.genericArgs.map((g) => this.expressionAsGenericArg(g)),
        symbolValue.sourceloc,
        this.elaborateParentSymbolFromCache(symbol.parentScope),
        parameterPackTypes
      );
      assert(elaboratedSymbolId);
      const elaboratedSymbol = this.sr.symbolNodes.get(elaboratedSymbolId);
      assert(elaboratedSymbol.variant === Semantic.ENode.FunctionSymbol);
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
            type.variant === Semantic.ENode.StructDatatype
        );
        return this.sr.b.datatypeDefAsValue(elaboratedSymbol.datatype, symbolValue.sourceloc);
      } else if (typedef.variant === Collect.ENode.StructTypeDef) {
        // This is for static function calls like Arena.create(); -> "Arena" is now a NamespaceValue
        const genericArgs = symbolValue.genericArgs.map((g) => this.expressionAsGenericArg(g));
        const elaboratedSymbolId = this.instantiateAndElaborateStructWithGenerics(
          symbol.typeDef,
          genericArgs,
          symbolValue.sourceloc
        );
        assert(elaboratedSymbolId);
        const elaboratedSymbol = this.sr.typeDefNodes.get(elaboratedSymbolId);
        assert(
          elaboratedSymbol.variant === Semantic.ENode.NamespaceDatatype ||
            elaboratedSymbol.variant === Semantic.ENode.StructDatatype
        );
        return this.sr.b.datatypeDefAsValue(elaboratedSymbolId, symbolValue.sourceloc);
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
      symbolValue.sourceloc
    );
  }

  arrayLiteral(arrayLiteral: Collect.ArrayLiteralExpr) {
    const values = arrayLiteral.values.map((v) => this.expr(v, undefined));
    let type = null as Semantic.TypeUseId | null;
    for (let i = 0; i < values.length; i++) {
      const [value, valueId] = values[i];
      if (type === null) {
        type = value.type;
      }
      if (type !== value.type) {
        throw new CompilerError(
          `Array type mismatch: Value #${i + 1} has type ${Semantic.serializeTypeUse(
            this.sr,
            value.type
          )}, but ${Semantic.serializeTypeUse(
            this.sr,
            type
          )} was expected. Cannot deduce array type from multiple different value types.`,
          arrayLiteral.sourceloc
        );
      }
    }
    if (values.length === 0) {
      throw new CompilerError(
        `Array literal must contain at least one value`,
        arrayLiteral.sourceloc
      );
    }
    assert(type);
    return Semantic.addExpr(this.sr, {
      variant: Semantic.ENode.ArrayLiteralExpr,
      instanceIds: [],
      values: values.map((v) => v[1]),
      type: makeStackArrayDatatypeAvailable(
        this.sr,
        type,
        values.length,
        EDatatypeMutability.Const,
        false,
        arrayLiteral.sourceloc
      ),
      sourceloc: arrayLiteral.sourceloc,
      isTemporary: true,
    });
  }

  arraySubscript(arraySubscript: Collect.ArraySubscriptExpr) {
    if (arraySubscript.indices.length > 1) {
      throw new CompilerError(
        `Multidimensional array subscripting is not implemented yet`,
        arraySubscript.sourceloc
      );
    }
    const [value, valueId] = this.expr(arraySubscript.expr, undefined);
    const [index, indexId] = this.expr(arraySubscript.indices[0], undefined);
    const indexType = this.sr.typeDefNodes.get(this.sr.typeUseNodes.get(index.type).type);
    if (
      indexType.variant !== Semantic.ENode.PrimitiveDatatype ||
      !Conversion.isInteger(indexType.primitive)
    ) {
      throw new CompilerError(
        `Only integers can be used to index arrays`,
        arraySubscript.sourceloc
      );
    }

    const valueType = this.sr.typeDefNodes.get(this.sr.typeUseNodes.get(value.type).type);
    if (
      valueType.variant !== Semantic.ENode.FixedArrayDatatype &&
      valueType.variant !== Semantic.ENode.DynamicArrayDatatype
    ) {
      throw new CompilerError(
        `Expression of type ${Semantic.serializeTypeUse(
          this.sr,
          value.type
        )} cannot be subscripted`,
        arraySubscript.sourceloc
      );
    }

    return Semantic.addExpr(this.sr, {
      variant: Semantic.ENode.ArraySubscriptExpr,
      instanceIds: [],
      expr: valueId,
      indices: [indexId],
      type: valueType.datatype,
      sourceloc: arraySubscript.sourceloc,
      isTemporary: true,
    });
  }

  parenthesisExpr(parenthesisExpr: Collect.ParenthesisExpr, inference: Inference) {
    return this.expr(parenthesisExpr.expr, inference);
  }

  explicitCastExpr(
    castExpr: Collect.ExplicitCastExpr,
    inference: Inference
  ): [Semantic.Expression, Semantic.ExprId] {
    const result = Conversion.MakeConversionOrThrow(
      this.sr,
      this.expr(castExpr.expr, undefined)[1],
      this.lookupAndElaborateDatatype(castExpr.targetType),
      this.currentContext.constraints,
      castExpr.sourceloc,
      Conversion.Mode.Explicit,
      inference?.unsafe
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

  arraySlice(arraySlice: Collect.ArraySliceExpr) {
    if (arraySlice.indices.length > 1) {
      throw new CompilerError(
        `Multidimensional array subscripting is not implemented yet`,
        arraySlice.sourceloc
      );
    }
    const [value, valueId] = this.expr(arraySlice.expr, undefined);

    const indices: {
      start: Semantic.ExprId | null;
      end: Semantic.ExprId | null;
    }[] = [
      {
        end: null,
        start: null,
      },
    ];

    if (arraySlice.indices[0].start) {
      const [startIndex, startIndexId] = this.expr(arraySlice.indices[0].start, undefined);
      indices[0].start = startIndexId;
      const startIndexType = this.sr.typeDefNodes.get(
        this.sr.typeUseNodes.get(startIndex.type).type
      );
      if (
        startIndexType.variant !== Semantic.ENode.PrimitiveDatatype ||
        !Conversion.isInteger(startIndexType.primitive)
      ) {
        throw new CompilerError(`Only integers can be used to index arrays`, arraySlice.sourceloc);
      }
    }
    if (arraySlice.indices[0].end) {
      const [endIndex, endIndexId] = this.expr(arraySlice.indices[0].end, undefined);
      indices[0].end = endIndexId;
      const endIndexType = this.sr.typeDefNodes.get(this.sr.typeUseNodes.get(endIndex.type).type);
      if (
        endIndexType.variant !== Semantic.ENode.PrimitiveDatatype ||
        !Conversion.isInteger(endIndexType.primitive)
      ) {
        throw new CompilerError(`Only integers can be used to index arrays`, arraySlice.sourceloc);
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
          value.type
        )} cannot be subscripted`,
        arraySlice.sourceloc
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
        arraySlice.sourceloc
      ),
      sourceloc: arraySlice.sourceloc,
      isTemporary: true,
    });
  }

  blockScopeExpr(blockScopeExpr: Collect.BlockScopeExpr, inference: Inference) {
    const blockScope = this.sr.cc.scopeNodes.get(blockScopeExpr.scope);
    assert(blockScope.variant === Collect.ENode.BlockScope);
    const [scope, scopeId] = Semantic.addBlockScope(this.sr, {
      variant: Semantic.ENode.BlockScope,
      statements: [],
      emittedExpr: null,
      constraints: [...this.currentContext.constraints],
    });
    this.withContext(
      {
        context: Semantic.isolateElaborationContext(this.currentContext, {
          currentScope: blockScopeExpr.scope,
          genericsScope: blockScopeExpr.scope,
          constraints: this.currentContext.constraints,
          instanceDeps: this.currentContext.instanceDeps,
        }),
        expectedReturnType: this.expectedReturnType,
        functionReturnsInstanceIds: this.functionReturnsInstanceIds,
      },
      () => {
        this.elaborateBlockScope(
          {
            targetScopeId: scopeId,
            sourceScopeId: blockScopeExpr.scope,
          },
          inference
        );
      }
    );

    let resultType = null as Semantic.TypeUseId | null;
    if (scope.emittedExpr) {
      const emittedExpr = this.sr.exprNodes.get(scope.emittedExpr);
      resultType = emittedExpr.type;
    }
    return Semantic.addExpr(this.sr, {
      variant: Semantic.ENode.BlockScopeExpr,
      instanceIds: [],
      block: scopeId,
      isTemporary: true,
      type: resultType || makeVoidType(this.sr),
      sourceloc: blockScopeExpr.sourceloc,
    });
  }

  typeLiteral(literal: Collect.TypeLiteralExpr) {
    return this.sr.b.datatypeUseAsValue(
      this.lookupAndElaborateDatatype(literal.datatype),
      literal.sourceloc
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
        expr.sourceloc
      );
    }
  }

  arenaTypeDef() {
    const arenaCollectSymbolId = Semantic.lookupSymbolByName(this.sr, "Arena", null);
    const arenaCollectSymbol = this.sr.cc.symbolNodes.get(arenaCollectSymbolId);
    assert(arenaCollectSymbol.variant === Collect.ENode.TypeDefSymbol);
    const arenaSymbolId = this.withContext(
      {
        context: Semantic.makeElaborationContext({
          currentScope: this.sr.cc.moduleScopeId,
          genericsScope: this.sr.cc.moduleScopeId,
          constraints: [],
        }),
      },
      () => {
        return this.typeDefSymbol(arenaCollectSymbol);
      }
    );
    assert(arenaSymbolId.length === 1);
    const elaboratedArenaSymbol = this.sr.symbolNodes.get(arenaSymbolId[0]);
    assert(elaboratedArenaSymbol.variant === Semantic.ENode.TypeDefSymbol);

    return elaboratedArenaSymbol.datatype;
  }

  arenaTypeUse(inline: boolean, sourceloc: SourceLoc) {
    return makeTypeUse(
      this.sr,
      this.arenaTypeDef(),
      EDatatypeMutability.Default,
      inline,
      sourceloc
    );
  }
}

export class SemanticBuilder {
  constructor(public sr: SemanticResult) {}

  binaryExpr(
    left: Semantic.ExprId,
    right: Semantic.ExprId,
    operation: EBinaryOperation,
    resultType: Semantic.TypeUseId,
    sourceloc: SourceLoc
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

  callExpr(exprId: Semantic.ExprId, callArguments: Semantic.ExprId[], sourceloc: SourceLoc) {
    const expr = this.sr.exprNodes.get(exprId);
    const ftypeUse = this.sr.typeUseNodes.get(expr.type);
    const ftypeDef = this.sr.typeDefNodes.get(ftypeUse.type);

    assert(
      ftypeDef.variant === Semantic.ENode.FunctionDatatype ||
        ftypeDef.variant === Semantic.ENode.CallableDatatype
    );
    let extern = false;
    if (expr.variant === Semantic.ENode.SymbolValueExpr) {
      const symbol = this.sr.symbolNodes.get(expr.symbol);
      if (symbol.variant === Semantic.ENode.FunctionSymbol) {
        if (symbol.extern) {
          extern = true;
        }
      }
    }

    let returnType: Semantic.TypeUseId | null = null;
    if (ftypeDef.variant === Semantic.ENode.FunctionDatatype) {
      returnType = ftypeDef.returnType;
    } else {
      const functype = this.sr.typeDefNodes.get(ftypeDef.functionType);
      assert(functype.variant === Semantic.ENode.FunctionDatatype);
      returnType = functype.returnType;
    }

    return Semantic.addExpr(this.sr, {
      variant: Semantic.ENode.ExprCallExpr,
      instanceIds: [],
      calledExpr: exprId,
      arguments: callArguments,
      isTemporary: true,
      type: returnType,
      takesParentArena: !extern,
      takesReturnArena: !extern,
      sourceloc: sourceloc,
    });
  }

  unaryExpr(exprId: Semantic.ExprId, operation: EUnaryOperation, sourceloc: SourceLoc) {
    const expr = this.sr.exprNodes.get(exprId);
    return Semantic.addExpr(this.sr, {
      variant: Semantic.ENode.UnaryExpr,
      instanceIds: [],
      expr: exprId,
      operation: operation,
      type: Conversion.makeUnaryResultType(this.sr, expr.type, operation, sourceloc),
      isTemporary: true,
      sourceloc: sourceloc,
    });
  }

  // symbolValue(symbolId: SymbolValue) {
  //   return Semantic.addExpr(this.sr, {
  //     variant: Semantic.ENode.SymbolValueExpr,
  //     // symbol: sym,
  //     // type: Conversion.makeUnaryResultType(this.sr, expr.type, operation, sourceloc),
  //     // isTemporary: true,
  //     sourceloc: sourceloc,
  //   });
  // }

  literalValue(literal: LiteralValue, sourceloc: SourceLoc) {
    return Semantic.addExpr(this.sr, {
      variant: Semantic.ENode.LiteralExpr,
      instanceIds: [],
      literal: literal,
      sourceloc: sourceloc,
      isTemporary: true,
      type: makePrimitiveAvailable(this.sr, literal.type, EDatatypeMutability.Const, sourceloc),
    });
  }

  literal(value: boolean | number | bigint | string, sourceloc: SourceLoc) {
    if (typeof value === "bigint") {
      return this.literalValue(
        {
          type: EPrimitive.int,
          unit: null,
          value: value,
        },
        sourceloc
      );
    } else if (typeof value === "number") {
      return this.literalValue(
        {
          type: EPrimitive.real,
          unit: null,
          value: value,
        },
        sourceloc
      );
    } else if (typeof value === "boolean") {
      return this.literalValue(
        {
          type: EPrimitive.bool,
          value: value,
        },
        sourceloc
      );
    } else if (typeof value === "string") {
      return this.literalValue(
        {
          type: EPrimitive.str,
          value: value,
        },
        sourceloc
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
      type: this.usizeType(),
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
      type: this.usizeType(),
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
    sourceloc: SourceLoc
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

  cInject(value: string, sourceloc: SourceLoc) {
    const [_, directiveId] = Semantic.addSymbol(this.sr, {
      variant: Semantic.ENode.CInjectDirectiveSymbol,
      value: value,
      sourceloc: sourceloc,
    });
    this.sr.cInjections.push(directiveId);
    return directiveId;
  }

  updateLHSDependencies(lhsId: Semantic.ExprId, dependencies: Semantic.InstanceId[]): void {
    const lhs = this.sr.exprNodes.get(lhsId);
    switch (lhs.variant) {
      case Semantic.ENode.ArraySubscriptExpr: {
        assert(false, "Array subscript not implemented correctly yet");
      }

      case Semantic.ENode.SymbolValueExpr: {
        Semantic.addSymbolDeps(this.sr.e.currentContext, lhs.symbol, dependencies);
        break;
      }

      case Semantic.ENode.MemberAccessExpr: {
        const struct = this.sr.e.getTypeDef(
          this.sr.e.getTypeUse(this.sr.e.getExpr(lhs.expr).type).type
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
            dependencies
          );
        }
        break;
      }

      case Semantic.ENode.StructInstantiationExpr:
      case Semantic.ENode.ValueToUnionCastExpr:
      case Semantic.ENode.UnionToValueCastExpr:
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
      case Semantic.ENode.ExprCallExpr: {
        throw new CompilerError(`This expression is not a valid LHS`, lhs.sourceloc);
      }

      default:
        assert(false, (lhs as any).variant.toString());
    }
  }

  assignment(
    targetId: Semantic.ExprId,
    operation: EAssignmentOperation,
    valueId: Semantic.ExprId,
    constraints: Semantic.Constraint[],
    sourceloc: SourceLoc,
    inference: Inference
  ) {
    const target = this.sr.exprNodes.get(targetId);
    const value = this.sr.exprNodes.get(valueId);

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
        inference?.unsafe
      ),
      target: targetId,
      type: target.type,
      operation: operation,
      sourceloc: sourceloc,
      isTemporary: true,
    });
  }

  memberAccessRaw(
    exprId: Semantic.ExprId,
    name: string,
    memberType: Semantic.TypeUseId,
    temporary: boolean,
    sourceloc: SourceLoc
  ) {
    const expr = this.sr.e.getExpr(exprId);

    const struct = this.sr.e.getTypeDef(this.sr.e.getTypeUse(expr.type).type);
    assert(struct.variant === Semantic.ENode.StructDatatype);

    const member = struct.members.find((m) => {
      const mem = this.sr.symbolNodes.get(m);
      return mem.variant === Semantic.ENode.VariableSymbol && mem.name === name;
    });
    assert(member);

    const memberSym = this.sr.symbolNodes.get(member);
    assert(memberSym.variant === Semantic.ENode.VariableSymbol);

    const dependsOn = new Set<Semantic.InstanceId>();
    for (const inst of expr.instanceIds) {
      // Get ONLY the dependencies of the specific struct member being accessed
      Semantic.getStructMemberInstanceDeps(
        this.sr.e.currentContext.instanceDeps,
        inst,
        member
      ).forEach((d) => dependsOn.add(d));
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

  structLiteral(
    structTypeId: Semantic.TypeUseId,
    assign: {
      name: string;
      value: Semantic.ExprId;
    }[],
    sourceloc: SourceLoc
  ) {
    const structTypeUse = this.sr.typeUseNodes.get(structTypeId);
    const structType = this.sr.typeDefNodes.get(structTypeUse.type);
    assert(structType.variant === Semantic.ENode.StructDatatype);

    const e = Semantic.addExpr<Semantic.StructInstantiationExpr>(this.sr, {
      variant: Semantic.ENode.StructInstantiationExpr,
      instanceIds: [Semantic.makeInstanceId(this.sr)],
      assign: assign,
      type: structTypeId,
      sourceloc: sourceloc,
      isTemporary: true,
    });

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
        value.instanceIds
      );
    }

    return e;
  }

  namespaceType(
    name: string,
    parentStructOrNS: Semantic.TypeDefId | null,
    collectedNamespace: Collect.TypeDefId
  ) {
    return Semantic.addType<Semantic.NamespaceDatatypeDef>(this.sr, {
      variant: Semantic.ENode.NamespaceDatatype,
      name: name,
      parentStructOrNS: parentStructOrNS,
      symbols: [],
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
      sourceloc
    )[1];
  }

  paramPackTypeDef() {
    return Semantic.addType(this.sr, {
      variant: Semantic.ENode.ParameterPackDatatype,
      parameters: null,
      concrete: true,
    })[1];
  }

  unionTypeUse(members: Semantic.TypeUseId[], sourceloc: SourceLoc) {
    return makeTypeUse(
      this.sr,
      Semantic.addType(this.sr, {
        variant: Semantic.ENode.UnionDatatype,
        members: members,
        concrete: !members.some((m) => !isTypeConcrete(this.sr, m)),
      })[1],
      EDatatypeMutability.Const,
      false,
      sourceloc
    )[1];
  }

  primitiveType(primitive: EPrimitive, sourceloc: SourceLoc): Semantic.TypeUseId {
    return makePrimitiveAvailable(this.sr, primitive, EDatatypeMutability.Const, sourceloc);
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

  usizeType() {
    return this.primitiveType(EPrimitive.usize, null);
  }

  nullTypeDef() {
    return makeRawPrimitiveAvailable(this.sr, EPrimitive.null);
  }

  noneTypeDef() {
    return makeRawPrimitiveAvailable(this.sr, EPrimitive.none);
  }

  doesUnionContain(unionId: Semantic.TypeUseId, typeId: Semantic.TypeUseId) {
    const union = this.sr.typeDefNodes.get(this.sr.typeUseNodes.get(unionId).type);
    assert(union.variant === Semantic.ENode.UnionDatatype);

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
  }
) {
  const entries = sr.elaboratedFuncdefSymbols.get(symbolId);
  if (entries === undefined) return;

  const canonicalizedGenerics = args.genericArgs.map((g) =>
    Semantic.canonicalizeGenericExpr(sr, g)
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
  }
) {
  const canonicalizedGenerics = args.genericArgs.map((g) =>
    Semantic.canonicalizeGenericExpr(sr, g)
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
  }
) {
  const entries = sr.elaboratedStructDatatypes.get(symbolId);
  if (entries === undefined) return;

  const canonicalizedGenerics = args.genericArgs.map((g) =>
    Semantic.canonicalizeGenericExpr(sr, g)
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
  }
) {
  const canonicalizedGenerics = args.genericArgs.map((g) =>
    Semantic.canonicalizeGenericExpr(sr, g)
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

export type SemanticResult = {
  cc: CollectionContext;

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
    result: Semantic.TypeDefId;
  }[];
  elaboratedGlobalVariableDefinitions: {
    originalSymbol: Collect.SymbolId;
    result: Semantic.SymbolId;
  }[];
  elaboratedGlobalVariableSymbols: Map<Collect.SymbolId, Semantic.SymbolId>;
  // Function-local variable symbols are cached per function call because they are separate for each generic instance.

  elaboratedPrimitiveTypes: Semantic.TypeDefId[];
  functionTypeCache: Semantic.TypeDefId[];
  fixedArrayTypeCache: Semantic.TypeDefId[];
  dynamicArrayTypeCache: Semantic.TypeDefId[];
  typeInstanceCache: Semantic.TypeUseId[];

  syntheticScopeToVariableMap: Map<Collect.ScopeId, Map<string, Semantic.SymbolId>>;

  exportedCollectedSymbols: Set<number>;

  cInjections: Semantic.SymbolId[];
  globalMainFunction: Semantic.SymbolId | null;
};

export function makeRawPrimitiveAvailable(
  sr: SemanticResult,
  primitive: EPrimitive
): Semantic.TypeDefId {
  for (const id of sr.elaboratedPrimitiveTypes) {
    const s = sr.typeDefNodes.get(id);
    assert(s.variant === Semantic.ENode.PrimitiveDatatype);
    if (s.primitive === primitive) {
      return id;
    }
  }
  const [s, sId] = Semantic.addType(sr, {
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
  sourceloc: SourceLoc
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
    case Collect.ENode.StructInstantiationExpr: {
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
    BlockScope,
    StructDatatype,
    CallableDatatype,
    ParameterPackDatatype,
    PrimitiveDatatype,
    GenericParameterDatatype,
    NamespaceDatatype,
    FixedArrayDatatype,
    DynamicArrayDatatype,
    UnionDatatype,
    // Statements
    InlineCStatement,
    WhileStatement,
    IfStatement,
    VariableStatement,
    ExprStatement,
    BlockScopeExpr,
    ReturnStatement,
    // Expressions
    ParenthesisExpr,
    BinaryExpr,
    LiteralExpr,
    UnaryExpr,
    ExprCallExpr,
    SymbolValueExpr,
    DatatypeAsValueExpr,
    SizeofExpr,
    AlignofExpr,
    ExplicitCastExpr,
    ValueToUnionCastExpr,
    UnionToValueCastExpr,
    MemberAccessExpr,
    CallableExpr,
    AddressOfExpr,
    DereferenceExpr,
    ExprAssignmentExpr,
    StructInstantiationExpr,
    PreIncrExpr,
    PostIncrExpr,
    ArrayLiteralExpr,
    ArraySubscriptExpr,
    ArraySliceExpr,
    StringConstructExpr,
    // Dummy
    Dummy,
  }

  export function addBlockScope<T extends Semantic.BlockScope>(
    sr: SemanticResult,
    n: T
  ): [T, BlockScopeId] {
    return pushBrandedNode(sr.blockScopeNodes, n) as [T, BlockScopeId];
  }

  export function addTypeInstance<T extends Semantic.TypeUse>(
    sr: SemanticResult,
    n: T
  ): [T, TypeUseId] {
    return pushBrandedNode(sr.typeUseNodes, n) as [T, TypeUseId];
  }

  export function addStatement<T extends Semantic.Statement>(
    sr: SemanticResult,
    n: T
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
    returnType: Semantic.TypeUseId;
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
    extern: EExternLanguage;
    scope: Semantic.BlockScopeId | null;
    export: boolean;
    returnsInstanceIds: Set<Semantic.InstanceId>;
    instanceDepsSnapshot: InstanceDeps;
    methodType: EMethodType;
    methodOf: TypeDefId | null;
    sourceloc: SourceLoc;
    parentStructOrNS: TypeDefId | null;
    concrete: boolean;
  };

  export type TypeDefSymbol = {
    variant: ENode.TypeDefSymbol;
    datatype: TypeDefId;
  };

  export type BlockScope = {
    variant: ENode.BlockScope;
    statements: StatementId[];
    emittedExpr: ExprId | null;
    constraints: Constraint[];
  };

  export type FunctionDatatypeDef = {
    variant: ENode.FunctionDatatype;
    parameters: TypeUseId[];
    returnType: TypeUseId;
    vararg: boolean;
    concrete: boolean;
  };

  export type StructDatatypeDef = {
    variant: ENode.StructDatatype;
    name: string;
    noemit: boolean;
    generics: ExprId[];
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
    originalCollectedSymbol: Collect.TypeDefId;
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
    length: number;
    concrete: boolean;
  };

  export type DynamicArrayDatatypeDef = {
    variant: ENode.DynamicArrayDatatype;
    datatype: TypeUseId;
    concrete: boolean;
  };

  export type UnionDatatypeDef = {
    variant: ENode.UnionDatatype;
    members: TypeUseId[];
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
    parentStructOrNS: TypeDefId | null;
    symbols: Semantic.SymbolId[];
    collectedNamespace: Collect.TypeDefId;
    concrete: boolean; // For consistency, always true
  };

  export type TypeDef =
    | GenericParameterDatatypeDef
    | NamespaceDatatypeDef
    | FunctionDatatypeDef
    | StructDatatypeDef
    | FixedArrayDatatypeDef
    | DynamicArrayDatatypeDef
    | ParameterPackDatatypeDef
    | UnionDatatypeDef
    | CallableDatatypeDef
    | PrimitiveDatatypeDef;

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

  export type ValueToUnionCastExpr = {
    variant: ENode.ValueToUnionCastExpr;
    instanceIds: InstanceId[];
    expr: ExprId;
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type UnionToValueCastExpr = {
    variant: ENode.UnionToValueCastExpr;
    instanceIds: InstanceId[];
    expr: ExprId;
    type: TypeUseId;
    index: number;
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
    takesParentArena: boolean;
    takesReturnArena: boolean;
    sourceloc: SourceLoc;
  };

  export type StructInstantiationExpr = {
    variant: ENode.StructInstantiationExpr;
    instanceIds: InstanceId[];
    assign: {
      name: string;
      value: ExprId;
    }[];
    type: TypeUseId;
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
    values: ExprId[];
    type: TypeUseId;
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
    | ValueToUnionCastExpr
    | UnionToValueCastExpr
    | ExprCallExpr
    | StructInstantiationExpr
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

  export type IfStatement = {
    variant: ENode.IfStatement;
    condition: ExprId;
    then: BlockScopeId;
    elseIfs: {
      condition: ExprId;
      then: BlockScopeId;
    }[];
    else?: BlockScopeId;
    sourceloc: SourceLoc;
  };

  export type WhileStatement = {
    variant: ENode.WhileStatement;
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
    | VariableStatement
    | IfStatement
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
      } else {
        return primitiveToString(expr.literal.type) + "_" + expr.literal.value.toString();
      }
    } else {
      throw new CompilerError(
        `This expression is not suitable as a generic type argument or literal value`,
        expr.sourceloc
      );
    }
  }

  export function tryLookupSymbol(
    sr: SemanticResult,
    name: string,
    args: { startLookupInScope: Collect.ScopeId; sourceloc: SourceLoc; pubRequired?: boolean }
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
      case Collect.ENode.StructScope:
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
    args: { startLookupInScope: Collect.ScopeId; sourceloc: SourceLoc }
  ) {
    const found = tryLookupSymbol(sr, name, args);
    if (found) return found;
    throw new CompilerError(`Symbol '${name}' was not declared in this scope`, args.sourceloc);
  }

  export function lookupSymbolByName(sr: SemanticResult, symbolPath: string, sourceloc: SourceLoc) {
    const names = symbolPath.split(".");

    assert(names.length === 1, "namespaces not supported yet");

    // First find the first top level symbol
    const moduleScope = sr.cc.scopeNodes.get(sr.cc.moduleScopeId) as Collect.ModuleScope;

    // Find globally in root (stdlib)
    const symbol = tryLookupSymbol(sr, names[0], {
      startLookupInScope: sr.cc.moduleScopeId,
      sourceloc: sourceloc,
    });

    if (symbol) {
      if (symbol.type === "collect") {
        return symbol.id;
      } else {
        assert(false, "Expected to find symbol but found Semantic expression");
      }
    }
    assert(false, "Symbol not found");
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
    dependency: Semantic.InstanceId | Semantic.InstanceId[]
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
    dependency: Semantic.InstanceId | Semantic.InstanceId[]
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
    instanceId: Semantic.InstanceId
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
    member: Semantic.SymbolId
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
    dependency: Semantic.InstanceId | Semantic.InstanceId[]
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

    elaboratedVariables: Map<Collect.SymbolId, Semantic.SymbolId>;
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
      elaboratedVariables: new Map(),
    };
  }

  export function isolateElaborationContext(
    parent: ElaborationContext,
    args: {
      currentScope: Collect.ScopeId;
      genericsScope: Collect.ScopeId;
      constraints: Constraint[];
      instanceDeps: InstanceDeps;
    }
  ): ElaborationContext {
    return {
      substitute: new Map(parent.substitute),
      constraints: [...args.constraints],
      currentScope: args.currentScope,
      genericsScope: args.genericsScope,
      instanceDeps: args.instanceDeps,

      elaboratedVariables: new Map(parent.elaboratedVariables),
    };
  }

  export function mergeSubstitutionContext(
    a: ElaborationContext,
    b: ElaborationContext,
    args: {
      currentScope: Collect.ScopeId;
      genericsScope: Collect.ScopeId;
      instanceDeps: InstanceDeps;
    }
  ): ElaborationContext {
    return {
      substitute: new Map([...a.substitute, ...b.substitute]),
      constraints: [...a.constraints, ...b.constraints],
      currentScope: args.currentScope,
      genericsScope: args.genericsScope,
      instanceDeps: args.instanceDeps,
      elaboratedVariables: new Map([...a.elaboratedVariables, ...b.elaboratedVariables]),
    };
  }

  export function makeInstanceId(sr: SemanticResult) {
    return sr.nextInstanceId++ as Semantic.InstanceId;
  }

  export function SemanticallyAnalyze(
    cc: CollectionContext,
    isLibrary: boolean,
    moduleName: string,
    moduleVersion: string
  ) {
    const sr: SemanticResult = {
      overloadedOperators: [],
      cc: cc,

      e: undefined as any,
      b: undefined as any,

      nextInstanceId: 1 as Semantic.InstanceId,

      elaboratedFunctionSignatures: new Map(),
      elaboratedFunctionSignaturesByName: new Map(),

      elaboratedStructDatatypes: new Map(),
      elaboratedFuncdefSymbols: new Map(),
      elaboratedPrimitiveTypes: [],
      elaboratedNamespaceSymbols: [],
      elaboratedGlobalVariableDefinitions: [],
      functionTypeCache: [],
      fixedArrayTypeCache: [],
      dynamicArrayTypeCache: [],
      typeInstanceCache: [],

      blockScopeNodes: new BrandedArray<Semantic.BlockScopeId, Semantic.BlockScope>([]),
      symbolNodes: new BrandedArray<Semantic.SymbolId, Semantic.Symbol>([]),
      typeDefNodes: new BrandedArray<Semantic.TypeDefId, Semantic.TypeDef>([]),
      statementNodes: new BrandedArray<Semantic.StatementId, Semantic.Statement>([]),
      typeUseNodes: new BrandedArray<Semantic.TypeUseId, Semantic.TypeUse>([]),
      exprNodes: new BrandedArray<Semantic.ExprId, Semantic.Expression>([]),

      syntheticScopeToVariableMap: new Map(),

      exportedCollectedSymbols: new Set(),
      elaboratedGlobalVariableSymbols: new Map(),

      cInjections: [],
      globalMainFunction: null,
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
          sr.typeUseNodes.get(mainFunctionType.returnType).type
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
            null
          );
        }
      }
    }

    return sr;
  }

  export function serializeMutability(m: EDatatypeMutability) {
    if (m === EDatatypeMutability.Const) {
      return "const ";
    } else if (m === EDatatypeMutability.Mut) {
      return "mut ";
    } else {
      return "";
    }
  }

  export function serializeTypeUse(sr: SemanticResult, datatypeId: Semantic.TypeUseId): string {
    const datatype = sr.typeUseNodes.get(datatypeId);
    return (
      serializeMutability(datatype.mutability) +
      (datatype.inline ? "inline " : "") +
      serializeTypeDef(sr, datatype.type)
    );
  }

  export function serializeLiteralValue(value: LiteralValue) {
    if (value.type === EPrimitive.str) {
      return `${JSON.stringify(value.value)}`;
    } else if (value.type === EPrimitive.cstr) {
      return `${JSON.stringify(value.value)}`;
    } else if (value.type === EPrimitive.bool) {
      return `${value.value ? "true" : "false"}`;
    } else {
      if (value.type === EPrimitive.int || value.type === EPrimitive.real) {
        return `${value.value}`;
      } else if (value.type === EPrimitive.null) {
        return `null`;
      } else if (value.type === EPrimitive.none) {
        return `none`;
      } else {
        return `${primitiveToString(value.type)}(${value.value})`;
      }
    }
  }

  export function getNamespaceChainFromDatatype(sr: SemanticResult, typeId: Semantic.TypeDefId) {
    const type = sr.typeDefNodes.get(typeId);

    if (
      type.variant !== Semantic.ENode.StructDatatype &&
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
      isExported: false,
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
        symbol.variant === Semantic.ENode.FunctionSignature ||
        symbol.variant === Semantic.ENode.GlobalVariableDefinitionSymbol
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

      case Semantic.ENode.StructDatatype:
        if (datatype.extern === EExternLanguage.Extern_C) {
          return datatype.name;
        }
        return getNamespaceChainFromDatatype(sr, datatypeId)
          .map((n) => n.pretty)
          .join(".");

      case Semantic.ENode.FunctionDatatype:
        return `(${datatype.parameters.map((p) => serializeTypeUse(sr, p)).join(", ")}${
          datatype.vararg ? ", ..." : ""
        }) => ${serializeTypeUse(sr, datatype.returnType)}`;

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
        return `${serializeMutability(datatype.datatype)}[]${serializeTypeUse(
          sr,
          datatype.datatype
        )}`;

      case Semantic.ENode.UnionDatatype:
        return datatype.members.map((m) => serializeTypeUse(sr, m)).join(" | ");

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
        symbol.variant === Semantic.ENode.GlobalVariableDefinitionSymbol
    );

    if (symbol.extern === EExternLanguage.Extern_C) {
      return false;
    }

    const names = getNamespaceChainFromSymbol(sr, symbolId);
    return names.some((n) => n.isExported);
  }

  export function isSymbolMonomorphized(sr: SemanticResult, symbolId: Semantic.SymbolId) {
    const symbol = sr.symbolNodes.get(symbolId);
    assert(
      symbol.variant === Semantic.ENode.FunctionSymbol ||
        symbol.variant === Semantic.ENode.FunctionSignature ||
        symbol.variant === Semantic.ENode.GlobalVariableDefinitionSymbol
    );

    if (symbol.extern === EExternLanguage.Extern_C) {
      return false;
    }

    const names = getNamespaceChainFromSymbol(sr, symbolId);
    return names.some((n) => n.isMonomorphized);
  }

  export function serializeFullTypeUse(sr: SemanticResult, typeUseId: Semantic.TypeUseId) {
    const type = sr.typeUseNodes.get(typeUseId);

    const names = getNamespaceChainFromDatatype(sr, type.type);
    return serializeMutability(type.mutability) + names.map((n) => n.pretty).join(".");
  }

  export function serializeFullSymbolName(sr: SemanticResult, symbolId: Semantic.SymbolId) {
    const symbol = sr.symbolNodes.get(symbolId);
    assert(
      symbol.variant === Semantic.ENode.FunctionSymbol ||
        symbol.variant === Semantic.ENode.FunctionSignature ||
        symbol.variant === Semantic.ENode.GlobalVariableDefinitionSymbol
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
        symbol.variant === Semantic.ENode.GlobalVariableDefinitionSymbol
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
      functionParameterPart += ftype.parameters.map((p) => mangleTypeUse(sr, p).name).join("");
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

    if (sr.typeDefNodes.get(typeInstance.type).variant === Semantic.ENode.StructDatatype) {
      if (typeInstance.inline) {
        def.name = "i" + def.name;
      } else {
        def.name = "p" + def.name;
      }
    }

    if (sr.typeDefNodes.get(typeInstance.type).variant !== Semantic.ENode.ParameterPackDatatype) {
      if (typeInstance.mutability === EDatatypeMutability.Const) {
        if (def.wasMangled) {
          def.name = "c" + def.name;
        }
      } else if (typeInstance.mutability === EDatatypeMutability.Mut) {
        if (def.wasMangled) {
          def.name = "m" + def.name;
        }
      }
    }

    return def;
  }

  export function mangleTypeDef(
    sr: SemanticResult,
    typeId: Semantic.TypeDefId
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
        const name = primitiveToString(type.primitive);
        return {
          name: name.length + name,
          wasMangled: true,
        };
      }

      case Semantic.ENode.FunctionDatatype: {
        let params = "";
        for (const p of type.parameters) {
          const ppt = sr.typeUseNodes.get(p);
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
            params += mangleTypeUse(sr, p).name;
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
          name: "S" + mangleTypeUse(sr, type.datatype).name,
          wasMangled: true,
        };
      }

      case Semantic.ENode.UnionDatatype: {
        return {
          name:
            "U" +
            type.members.length.toString() +
            "_" +
            type.members.map((m) => mangleTypeUse(sr, m).name).join("_"),
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
    } else if (literalType === EPrimitive.str || literalType === EPrimitive.cstr) {
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
    } else {
      if (Number.isInteger(literalType)) {
        return {
          name: literalType < 0 ? `Lin${-literal.value}E` : `Li${literal.value}E`,
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
          expr.operation
        )} ${serializeExpr(sr, expr.right)})`;

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

      case Semantic.ENode.StructInstantiationExpr:
        return `${serializeTypeUse(sr, expr.type)} { ${expr.assign
          .map((a) => `${a.name}: ${serializeExpr(sr, a.value)}`)
          .join(", ")} }`;

      case Semantic.ENode.LiteralExpr: {
        return serializeLiteralValue(expr.literal);
      }

      case Semantic.ENode.MemberAccessExpr:
        return `(${serializeExpr(sr, expr.expr)}.${expr.memberName})`;

      case Semantic.ENode.CallableExpr:
        return `Callable(${serializeFullSymbolName(sr, expr.functionSymbol)}, this=${serializeExpr(
          sr,
          expr.thisExpr
        )})`;

      case Semantic.ENode.AddressOfExpr:
        return `&${serializeExpr(sr, expr.expr)}`;

      case Semantic.ENode.DereferenceExpr:
        return `*${serializeExpr(sr, expr.expr)}`;

      case Semantic.ENode.ExprAssignmentExpr:
        return `${serializeExpr(sr, expr.target)} = ${serializeExpr(sr, expr.value)}`;

      case Semantic.ENode.DatatypeAsValueExpr:
        return `${serializeTypeUse(sr, expr.type)}`;

      case Semantic.ENode.ArrayLiteralExpr:
        return `[${expr.values.map((v) => serializeExpr(sr, v)).join(", ")}]`;

      case Semantic.ENode.ArraySubscriptExpr: {
        const indices: string[] = [];
        for (const index of expr.indices) {
          indices.push(serializeExpr(sr, index));
        }
        return `${serializeExpr(sr, expr.expr)}[${indices.join(", ")}]`;
      }

      case Semantic.ENode.StringConstructExpr: {
        if (expr.value.variant === "data-length") {
          return `str(${serializeExpr(sr, expr.value.data)}, ${serializeExpr(
            sr,
            expr.value.length
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
        assert(false, expr.variant.toString());
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
