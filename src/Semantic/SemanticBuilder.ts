import {
  EAssignmentOperation,
  EDatatypeMutability,
  EExternLanguage,
  EVariableMutability,
  type EBinaryOperation,
  type EUnaryOperation,
} from "../shared/AST";
import { EPrimitive, EVariableContext, pushBrandedNode, type LiteralValue } from "../shared/common";
import { assert, CompilerError, InternalError, type SourceLoc } from "../shared/Errors";
import { Collect } from "../SymbolCollection/SymbolCollection";
import {
  ConstraintSet,
  type ConstraintPath,
  type ConstraintPathSubscriptIndex,
} from "./Constraint";
import { Conversion } from "./Conversion";
import { EvalCTFE } from "./CTFE";
import { isTypeConcrete, makePrimitiveAvailable, makeRawPrimitiveAvailable } from "./Elaborate";
import { makeTypeUse } from "./LookupDatatype";
import { Semantic } from "./SemanticTypes";

export class SemanticBuilder {
  constructor(public sr: Semantic.Context) {}

  addBlockScope<T extends Semantic.BlockScope>(
    sr: Semantic.Context,
    n: T,
  ): [T, Semantic.BlockScopeId] {
    return pushBrandedNode(sr.blockScopeNodes, n) as [T, Semantic.BlockScopeId];
  }

  addTypeInstance<T extends Semantic.TypeUse>(sr: Semantic.Context, n: T): [T, Semantic.TypeUseId] {
    return pushBrandedNode(sr.typeUseNodes, n) as [T, Semantic.TypeUseId];
  }

  addStatement<T extends Semantic.Statement>(
    sr: Semantic.Context,
    n: T,
  ): [T, Semantic.StatementId] {
    return pushBrandedNode(sr.statementNodes, n) as [T, Semantic.StatementId];
  }

  addType<T extends Semantic.TypeDef>(sr: Semantic.Context, n: T): [T, Semantic.TypeDefId] {
    return pushBrandedNode(sr.typeDefNodes, n) as [T, Semantic.TypeDefId];
  }

  addSymbol<T extends Semantic.Symbol>(sr: Semantic.Context, n: T): [T, Semantic.SymbolId] {
    return pushBrandedNode(sr.symbolNodes, n) as [T, Semantic.SymbolId];
  }

  addExpr<T extends Semantic.Expression>(sr: Semantic.Context, n: T): [T, Semantic.ExprId] {
    return pushBrandedNode(sr.exprNodes, n) as [T, Semantic.ExprId];
  }

  binaryExpr(
    leftId: Semantic.ExprId,
    rightId: Semantic.ExprId,
    operation: EBinaryOperation,
    resultType: Semantic.TypeUseId,
    sourceloc: SourceLoc,
  ) {
    const left = this.sr.exprNodes.get(leftId);
    const right = this.sr.exprNodes.get(rightId);
    return this.addExpr(this.sr, {
      variant: Semantic.ENode.BinaryExpr,
      instanceIds: [],
      left: leftId,
      operation: operation,
      right: rightId,
      type: resultType,
      isTemporary: true,
      sourceloc: sourceloc,
      flow: left.flow.withAll(right.flow),
      writes: left.writes.withAll(right.writes),
    });
  }

  exprStatement(exprId: Semantic.ExprId) {
    const expr = this.sr.exprNodes.get(exprId);
    return this.addStatement(this.sr, {
      variant: Semantic.ENode.ExprStatement,
      expr: exprId,
      sourceloc: expr.sourceloc,
    });
  }

  blockScope(
    statements: Semantic.StatementId[],
    emittedExpr: Semantic.ExprId,
    sourceloc: SourceLoc,
  ) {
    return this.addBlockScope(this.sr, {
      variant: Semantic.ENode.BlockScope,
      statements: statements,
      emittedExpr: emittedExpr,
      sourceloc: sourceloc,
    });
  }

  blockScopeExpr(
    blockScopeId: Semantic.BlockScopeId,
    flow: Semantic.FlowResult,
    writes: Semantic.WriteResult,
  ) {
    const blockScope = this.sr.blockScopeNodes.get(blockScopeId);
    return this.addExpr(this.sr, {
      variant: Semantic.ENode.BlockScopeExpr,
      block: blockScopeId,
      flow: flow,
      writes: writes,
      instanceIds: [],
      isTemporary: true,
      sourceloc: blockScope.sourceloc,
      type: blockScope.emittedExpr
        ? this.sr.exprNodes.get(blockScope.emittedExpr).type
        : this.sr.b.voidType(),
    });
  }

  callableExpr(
    functionSymbolId: Semantic.SymbolId,
    envType: Semantic.EnvBlockType,
    envValue: Semantic.EnvBlockValue,
    sourceloc: SourceLoc,
  ) {
    const functionSymbol = this.sr.symbolNodes.get(functionSymbolId);
    assert(functionSymbol.variant === Semantic.ENode.FunctionSymbol);
    return this.sr.b.addExpr(this.sr, {
      variant: Semantic.ENode.CallableExpr,
      functionSymbol: functionSymbolId,
      instanceIds: [],
      isTemporary: true,
      sourceloc: sourceloc,
      envType: envType,
      envValue: envValue,
      type: makeTypeUse(
        this.sr,
        this.sr.b.addType(this.sr, {
          variant: Semantic.ENode.CallableDatatype,
          concrete: true,
          functionType: functionSymbol.type,
          envType: envType,
        })[1],
        EDatatypeMutability.Default,
        false,
        sourceloc,
      )[1],
      flow: Semantic.FlowResult.fallthrough(),
      writes: Semantic.WriteResult.empty(),
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

    let ftype: Semantic.FunctionDatatypeDef | null =
      ftypeDef.variant === Semantic.ENode.FunctionDatatype ? ftypeDef : null;
    if (ftypeDef.variant === Semantic.ENode.CallableDatatype) {
      const f = this.sr.typeDefNodes.get(ftypeDef.functionType);
      assert(f.variant === Semantic.ENode.FunctionDatatype);
      ftype = f;
    }
    assert(ftype);

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

    const resultFlow = Semantic.FlowResult.empty();
    const resultWrites = Semantic.WriteResult.empty();
    resultFlow.addAll(expr.flow);
    resultWrites.addAll(expr.writes);
    callArguments.forEach((a) => {
      const e = this.sr.exprNodes.get(a);
      resultFlow.addAll(e.flow);
      resultWrites.addAll(e.writes);
    });
    resultFlow.remove(Semantic.FlowType.Fallthrough);

    let isFallthrough = true;

    // This is the handling for noreturn_if assertions like assert()
    if (ftype.requires.noreturnIf) {
      const noReturnIf = ftype.requires.noreturnIf;

      assert(noReturnIf.argIndex !== null);
      const passedArgId = callArguments[noReturnIf.argIndex];

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
            isFallthrough = false;
            resultFlow.add(Semantic.FlowType.NoReturn);
          }
        }
      } else {
        // The condition is not known at compile time, build normal constraints

        // This is the actual point where constraints like assert() are applied to the remaining scope
        const c = ConstraintSet.empty();
        this.sr.e.buildLogicalConstraintSet(c, passedArgId);
        this.sr.e.currentContext.constraints.addAll(
          noReturnIf.operation === "noreturn-if-truthy" ? c.inverse() : c,
        );
      }
    }

    // This is the handling for noreturn like "sys.panic()";
    if (ftype.requires.noreturn) {
      isFallthrough = false;
      resultFlow.add(Semantic.FlowType.NoReturn);
    }

    if (isFallthrough) {
      resultFlow.add(Semantic.FlowType.Fallthrough);
    }

    return this.addExpr(this.sr, {
      variant: Semantic.ENode.ExprCallExpr,
      instanceIds: instanceIds,
      calledExpr: exprId,
      arguments: callArguments,
      isTemporary: true,
      type: returnType,
      sourceloc: sourceloc,
      flow: resultFlow,
      writes: resultWrites,
    });
  }

  unaryExpr(
    exprId: Semantic.ExprId,
    operation: EUnaryOperation,
    resultType: Semantic.TypeUseId,
    sourceloc: SourceLoc,
  ) {
    const expr = this.sr.exprNodes.get(exprId);
    return this.addExpr(this.sr, {
      variant: Semantic.ENode.UnaryExpr,
      instanceIds: [],
      expr: exprId,
      operation: operation,
      type: resultType,
      isTemporary: true,
      sourceloc: sourceloc,
      flow: expr.flow,
      writes: expr.writes,
    });
  }

  private internRegex(sr: Semantic.Context, pattern: string, flags: Set<string>) {
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

  elaborateRegex(pattern: string, flags: Set<string>) {
    const id = this.internRegex(this.sr, pattern, flags);

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
      return this.addExpr(this.sr, {
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
        flow: Semantic.FlowResult.fallthrough(),
        writes: Semantic.WriteResult.empty(),
      });
    } else if (literal.type === EPrimitive.Regex) {
      literal.id = this.elaborateRegex(literal.pattern, literal.flags);
      return this.addExpr(this.sr, {
        variant: Semantic.ENode.LiteralExpr,
        instanceIds: [],
        literal: literal,
        sourceloc: sourceloc,
        isTemporary: true,
        type: makePrimitiveAvailable(this.sr, literal.type, EDatatypeMutability.Const, sourceloc),
        flow: Semantic.FlowResult.fallthrough(),
        writes: Semantic.WriteResult.empty(),
      });
    } else {
      return this.addExpr(this.sr, {
        variant: Semantic.ENode.LiteralExpr,
        instanceIds: [],
        literal: literal,
        sourceloc: sourceloc,
        isTemporary: true,
        type: makePrimitiveAvailable(this.sr, literal.type, EDatatypeMutability.Const, sourceloc),
        flow: Semantic.FlowResult.fallthrough(),
        writes: Semantic.WriteResult.empty(),
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
    return this.addExpr(this.sr, {
      variant: Semantic.ENode.DatatypeAsValueExpr,
      instanceIds: [],
      type: makeTypeUse(this.sr, type, EDatatypeMutability.Default, false, sourceloc)[1],
      isTemporary: false,
      sourceloc: sourceloc,
      flow: Semantic.FlowResult.fallthrough(),
      writes: Semantic.WriteResult.empty(),
    });
  }

  datatypeUseAsValue(type: Semantic.TypeUseId, sourceloc: SourceLoc) {
    return this.addExpr(this.sr, {
      variant: Semantic.ENode.DatatypeAsValueExpr,
      instanceIds: [],
      type: type,
      isTemporary: false,
      sourceloc: sourceloc,
      flow: Semantic.FlowResult.fallthrough(),
      writes: Semantic.WriteResult.empty(),
    });
  }

  sizeof(valueExprId: Semantic.ExprId) {
    const valueExpr = this.sr.exprNodes.get(valueExprId);
    return this.addExpr(this.sr, {
      variant: Semantic.ENode.SizeofExpr,
      instanceIds: [],
      valueExpr: valueExprId,
      type: this.intType(),
      isTemporary: false,
      sourceloc: valueExpr.sourceloc,
      flow: Semantic.FlowResult.fallthrough(),
      writes: Semantic.WriteResult.empty(),
    });
  }

  alignof(valueExprId: Semantic.ExprId) {
    const valueExpr = this.sr.exprNodes.get(valueExprId);
    return this.addExpr(this.sr, {
      variant: Semantic.ENode.AlignofExpr,
      instanceIds: [],
      valueExpr: valueExprId,
      type: this.intType(),
      isTemporary: false,
      sourceloc: valueExpr.sourceloc,
      flow: Semantic.FlowResult.fallthrough(),
      writes: Semantic.WriteResult.empty(),
    });
  }

  symbolValue(symbolId: Semantic.SymbolId, sourceloc: SourceLoc) {
    const symbol = this.sr.symbolNodes.get(symbolId);
    if (symbol.variant === Semantic.ENode.FunctionSymbol) {
      // Currently dependencies don't go across function borders at all
      return this.addExpr(this.sr, {
        variant: Semantic.ENode.SymbolValueExpr,
        instanceIds: [],
        symbol: symbolId,
        type: makeTypeUse(this.sr, symbol.type, EDatatypeMutability.Default, false, sourceloc)[1],
        isTemporary: false,
        sourceloc: sourceloc,
        flow: Semantic.FlowResult.fallthrough(),
        writes: Semantic.WriteResult.empty(),
      });
    } else if (symbol.variant === Semantic.ENode.VariableSymbol) {
      assert(symbol.type);
      return this.addExpr(this.sr, {
        variant: Semantic.ENode.SymbolValueExpr,
        instanceIds: Semantic.getSymbolDeps(this.sr.e.currentContext.instanceDeps, symbolId),
        symbol: symbolId,
        type: symbol.type,
        isTemporary: false,
        sourceloc: sourceloc,
        flow: Semantic.FlowResult.fallthrough(),
        writes: Semantic.WriteResult.empty(),
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
    return this.addSymbol(this.sr, {
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
    return this.addSymbol(this.sr, {
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
          null,
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
          null,
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
    const [_, directiveId] = this.addSymbol(this.sr, {
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

  extractConstraintPath(exprId: Semantic.ExprId): ConstraintPath | null {
    const expr = this.sr.exprNodes.get(exprId);

    // Base case: variable reference
    if (expr.variant === Semantic.ENode.SymbolValueExpr) {
      return {
        root: { kind: "symbol" as const, symbolId: expr.symbol },
        path: [],
      };
    }

    // Member access: obj.member
    if (expr.variant === Semantic.ENode.MemberAccessExpr) {
      const basePath = this.extractConstraintPath(expr.expr);
      if (!basePath) {
        return null;
      }

      // Find the member symbol by name
      const exprTypeUse = this.sr.typeUseNodes.get(this.sr.exprNodes.get(expr.expr).type);
      const exprTypeDef = this.sr.typeDefNodes.get(exprTypeUse.type);

      if (
        exprTypeDef.variant === Semantic.ENode.DynamicArrayDatatype ||
        exprTypeDef.variant === Semantic.ENode.FixedArrayDatatype
      ) {
        for (const fieldId of exprTypeDef.syntheticFields) {
          const field = this.sr.symbolNodes.get(fieldId);
          assert(field.variant === Semantic.ENode.VariableSymbol);
          if (field.name === expr.memberName) {
            return {
              root: basePath.root,
              path: [...basePath.path, { kind: "member" as const, member: fieldId }],
            };
          }
        }
      }

      if (exprTypeDef.variant === Semantic.ENode.StructDatatype) {
        const memberSymbol = exprTypeDef.members.find((m) => {
          const sym = this.sr.symbolNodes.get(m);
          return sym.variant === Semantic.ENode.VariableSymbol && sym.name === expr.memberName;
        });
        if (!memberSymbol) return null;

        return {
          root: basePath.root,
          path: [...basePath.path, { kind: "member" as const, member: memberSymbol }],
        };
      }

      return null;
    }

    // Array subscript: arr[index]
    if (expr.variant === Semantic.ENode.ArraySubscriptExpr) {
      const basePath = this.extractConstraintPath(expr.expr);
      if (!basePath) return null;

      // Only support single index for now
      if (expr.indices.length !== 1) return null;

      const indexExpr = this.sr.exprNodes.get(expr.indices[0]);
      let subscriptIndex: ConstraintPathSubscriptIndex;

      // Check if index is a literal
      if (indexExpr.variant === Semantic.ENode.LiteralExpr) {
        const literalValue = Semantic.serializeLiteralValue(this.sr, indexExpr.literal);
        subscriptIndex = { kind: "literal", value: literalValue };
      }
      // Check if index is a variable reference
      else if (indexExpr.variant === Semantic.ENode.SymbolValueExpr) {
        subscriptIndex = { kind: "variable", symbol: indexExpr.symbol };
      }
      // Complex expression - not supported for path-based narrowing
      else {
        return null;
      }

      return {
        root: basePath.root,
        path: [...basePath.path, { kind: "subscript", index: subscriptIndex }],
      };
    }

    // Cannot extract path from other expression types
    return null;
  }

  updateLHSDependencies(
    lhsId: Semantic.ExprId,
    dependencies: Semantic.InstanceId[],
  ): Semantic.WriteResult {
    const lhs = this.sr.exprNodes.get(lhsId);
    switch (lhs.variant) {
      case Semantic.ENode.ArraySubscriptExpr: {
        // Extract path for array subscript and delete it + children
        const path = this.extractConstraintPath(lhsId);
        if (path) {
          this.sr.e.currentContext.constraints.deletePathAndChildren(path);
        }

        lhs.instanceIds.forEach((id) =>
          Semantic.addInstanceDeps(this.sr.e.currentContext.instanceDeps, id, dependencies),
        );
        return Semantic.WriteResult.empty();
      }

      case Semantic.ENode.SymbolValueExpr: {
        Semantic.addSymbolDeps(this.sr.e.currentContext, lhs.symbol, dependencies);
        // Delete symbol-based constraints (legacy)
        this.sr.e.currentContext.constraints.deleteSymbol(lhs.symbol);
        // Delete path-based constraints for this symbol and all paths using it
        this.sr.e.currentContext.constraints.deleteSymbolWrites(lhs.symbol);
        return Semantic.WriteResult.empty().with(lhs.symbol);
      }

      case Semantic.ENode.MemberAccessExpr: {
        // Extract path for member access and delete it + children
        const path = this.extractConstraintPath(lhsId);
        if (path) {
          this.sr.e.currentContext.constraints.deletePathAndChildren(path);
        }

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
        return Semantic.WriteResult.empty();
      }

      // This is a special case for value narrowing and here, it is the easiest to fix, although not very nice
      case Semantic.ENode.UnionToValueCastExpr: {
        const unionExpr = this.sr.exprNodes.get(lhs.expr);
        if (unionExpr.variant !== Semantic.ENode.SymbolValueExpr || !lhs.canBeUnwrappedForLHS) {
          throw new CompilerError(`This expression is not a valid LHS`, lhs.sourceloc);
        }
        return this.updateLHSDependencies(lhs.expr, dependencies);
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
        return this.updateLHSDependencies(lhs.expr, dependencies);
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

  //   valueAssignment() {
  //   return this.assignment(targetId);
  // }

  assignment(
    targetId: Semantic.ExprId,
    operation: EAssignmentOperation,
    valueId: Semantic.ExprId,
    constraints: ConstraintSet,
    sourceloc: SourceLoc,
    inference: Semantic.Inference,
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
    const writes = this.updateLHSDependencies(targetId, value.instanceIds);

    return this.addExpr(this.sr, {
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
      flow: target.flow.withAll(value.flow),
      writes: target.writes.withAll(value.writes).withAll(writes),
    });
  }

  syntheticFunctionFromCode(args: {
    functionTypeId: Semantic.TypeDefId;
    parameterNames: string[];
    funcname: string;
    bodySourceCode: string;
    currentScope: Collect.ScopeId;
    sourceloc: SourceLoc;
    envType: Semantic.EnvBlockType;
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
        scope.variant === Collect.ENode.StructLexicalScope ||
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

    // Inject a synthetic env block
    symbol.envType = args.envType;

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

    return this.addExpr(this.sr, {
      variant: Semantic.ENode.MemberAccessExpr,
      instanceIds: [...dependsOn],
      expr: exprId,
      memberName: name,
      type: memberType,
      sourceloc: sourceloc,
      isTemporary: temporary,
      flow: expr.flow,
      writes: expr.writes,
    });
  }

  memberAccess(
    exprId: Semantic.ExprId,
    name: string,
    constraints: ConstraintSet,
    sourceloc: SourceLoc,
  ) {
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

    const [resultExpr, resultExprId] = this.memberAccessRaw(
      exprId,
      name,
      memberType,
      false,
      sourceloc,
    );

    // This is for taking accesses like foo.bar and wrapping them in a union cast if the member is narrowed.
    const memberTypeUse = this.sr.typeUseNodes.get(memberType);
    const memberTypeDef = this.sr.typeDefNodes.get(memberTypeUse.type);
    if (
      memberTypeDef.variant === Semantic.ENode.UntaggedUnionDatatype ||
      memberTypeDef.variant === Semantic.ENode.TaggedUnionDatatype
    ) {
      const members =
        memberTypeDef.variant === Semantic.ENode.UntaggedUnionDatatype
          ? memberTypeDef.members
          : memberTypeDef.members.map((m) => m.type);

      const narrowing = Conversion.typeNarrowing(this.sr);
      narrowing.addVariants(members);
      narrowing.constrainFromConstraints(constraints, resultExprId);

      assert(narrowing.possibleVariants.size <= members.length);
      if (narrowing.possibleVariants.size === 1) {
        // Only one value remains: Union to Value
        const tag = members.findIndex((m) => m === [...narrowing.possibleVariants][0]);
        assert(tag !== -1);

        const [result, resultId] = this.addExpr(this.sr, {
          variant: Semantic.ENode.UnionToValueCastExpr,
          instanceIds: [],
          expr: resultExprId,
          tag: tag,
          isTemporary: false,
          canBeUnwrappedForLHS: true,
          sourceloc: resultExpr.sourceloc,
          type: [...narrowing.possibleVariants][0],
          flow: resultExpr.flow,
          writes: resultExpr.writes,
        });
        return [result, resultId] as const;
      } else if (narrowing.possibleVariants.size !== members.length) {
        // If multiple values remain but they are not equal: Union to Union (e.g. A | B | null to A | B)

        // We do not need type checking since the source is the same union and narrowing can only remove members
        // Not like in Conversion, there we actually need it
        const newUnion = this.sr.b.untaggedUnionTypeUse(
          [...narrowing.possibleVariants],
          expr.sourceloc,
        );

        return this.addExpr(this.sr, {
          variant: Semantic.ENode.UnionToUnionCastExpr,
          instanceIds: [],
          expr: resultExprId,
          castComesFromNarrowingAndMayBeUnwrapped: true,
          isTemporary: false,
          sourceloc: resultExpr.sourceloc,
          type: newUnion,
          flow: resultExpr.flow,
          writes: resultExpr.writes,
        });
      }
    }

    return [resultExpr, resultExprId] as const;
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

    const flow = Semantic.FlowResult.fallthrough();
    const writes = Semantic.WriteResult.empty();
    elements.forEach((eId) => {
      const e = this.sr.exprNodes.get(eId);
      flow.addAll(e.flow);
      writes.addAll(e.writes);
    });
    const e = this.addExpr<Semantic.ArrayLiteralExpr>(this.sr, {
      variant: Semantic.ENode.ArrayLiteralExpr,
      instanceIds: [Semantic.makeInstanceId(this.sr)],
      elements: elements,
      type: arrayTypeId,
      inFunction: inFunction,
      allocator: allocator,
      sourceloc: sourceloc,
      isTemporary: true,
      flow: flow,
      writes: writes,
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
  ): [Semantic.StructLiteralExpr, Semantic.ExprId] {
    const structTypeUse = this.sr.typeUseNodes.get(structTypeId);
    const structType = this.sr.typeDefNodes.get(structTypeUse.type);
    assert(structType.variant === Semantic.ENode.StructDatatype);

    const [literal, literalId] = this.addExpr<Semantic.StructLiteralExpr>(this.sr, {
      variant: Semantic.ENode.StructLiteralExpr,
      instanceIds: [Semantic.makeInstanceId(this.sr)],
      assign: assign,
      type: structTypeId,
      inFunction: inFunction,
      allocator: allocator,
      sourceloc: sourceloc,
      isTemporary: true,
      flow: Semantic.FlowResult.fallthrough(),
      writes: Semantic.WriteResult.empty(),
    });

    if (allocator) {
      this.sr.e.assertExprAllocatorType(allocator, sourceloc);
    }

    if (inFunction) {
      // Structs as struct default values are not inside functions
      const functionSymbol = this.sr.e.getSymbol(inFunction);
      assert(functionSymbol.variant === Semantic.ENode.FunctionSymbol);
      literal.instanceIds.forEach((i) => functionSymbol.createsInstanceIds.add(i));
    }

    for (const a of assign) {
      const member = structType.members.find((m) => {
        const varsym = this.sr.symbolNodes.get(m);
        return varsym.variant === Semantic.ENode.VariableSymbol && varsym.name === a.name;
      });
      assert(member);

      const value = this.sr.e.getExpr(a.value);
      literal.flow.addAll(value.flow);
      literal.writes.addAll(value.writes);

      Semantic.addStructMemberInstanceDeps(
        this.sr.e.currentContext.instanceDeps,
        literal.instanceIds[0],
        member,
        value.instanceIds,
      );
    }

    return [literal, literalId] as const;
  }

  namespaceType(
    name: string,
    parentStructOrNS: Semantic.TypeDefId | null,
    collectedNamespace: Collect.TypeDefId,
    _export: boolean,
  ) {
    return this.addType<Semantic.NamespaceDatatypeDef>(this.sr, {
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
      this.addType(this.sr, {
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
    return this.addType(this.sr, {
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

    // Canonicalization: Create a stable key from the sorted members
    // This ensures that unions with the same members always have the same TypeDefId
    const canonicalKey = canonicalMembers.map((id) => id.toString()).join(",");

    const existingUnionId = this.sr.elaboratedUntaggedUnions.get(canonicalKey);
    if (existingUnionId !== undefined) {
      // Reuse the existing union TypeDef
      return makeTypeUse(this.sr, existingUnionId, EDatatypeMutability.Const, false, sourceloc)[1];
    }

    // Create new union and cache it
    const [_, unionTypeDefId] = this.addType(this.sr, {
      variant: Semantic.ENode.UntaggedUnionDatatype,
      members: canonicalMembers,
      concrete: !members.some((m) => !isTypeConcrete(this.sr, m)),
    });

    this.sr.elaboratedUntaggedUnions.set(canonicalKey, unionTypeDefId);

    return makeTypeUse(this.sr, unionTypeDefId, EDatatypeMutability.Const, false, sourceloc)[1];
  }

  taggedUnionTypeUse(
    members: { tag: string; type: Semantic.TypeUseId }[],
    nodiscard: boolean,
    sourceloc: SourceLoc,
  ) {
    // Canonicalization: Create a stable key from the members (tags + types) and nodiscard flag
    // This ensures that tagged unions with the same structure always have the same TypeDefId
    const canonicalKey = `${nodiscard ? "nodiscard:" : ""}${members
      .map((m) => `${m.tag}:${m.type}`)
      .join(",")}`;

    const existingUnionId = this.sr.elaboratedTaggedUnions.get(canonicalKey);
    if (existingUnionId !== undefined) {
      // Reuse the existing union TypeDef
      return makeTypeUse(this.sr, existingUnionId, EDatatypeMutability.Const, false, sourceloc)[1];
    }

    // Create new tagged union and cache it
    const [_, unionTypeDefId] = this.addType(this.sr, {
      variant: Semantic.ENode.TaggedUnionDatatype,
      members: members,
      nodiscard: nodiscard,
      concrete: !members.some((m) => !isTypeConcrete(this.sr, m.type)),
    });

    this.sr.elaboratedTaggedUnions.set(canonicalKey, unionTypeDefId);

    return makeTypeUse(this.sr, unionTypeDefId, EDatatypeMutability.Const, false, sourceloc)[1];
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

  cptrType() {
    return this.primitiveType(EPrimitive.cptr, null);
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
    return this.addType(this.sr, {
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
