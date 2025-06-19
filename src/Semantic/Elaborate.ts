import { logger } from "../log/log";
import {
  EBinaryOperation,
  EExternLanguage,
  type ASTExpr,
  type ASTFunctionDatatype,
  type ASTStatement,
} from "../shared/AST";
import { assertScope, EMethodType, EPrimitive, primitiveToString } from "../shared/common";
import { CompilerError, ImpossibleSituation, InternalError } from "../shared/Errors";
import type { ID } from "../shared/store";
import type { Collect } from "../SymbolCollection/CollectSymbols";
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
      symbolToSymbol: new Map<ID, ID>(),
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
              ).id,
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
              ).id,
            };
          } else if (Conversion.isFloat(leftType) && Conversion.isFloat(rightType)) {
            return {
              variant: "BinaryExpr",
              left: a,
              operation: expr.operation,
              right: b,
              typeSymbol: sr.symbolTable.makeDatatypeSymbolAvailable(
                sr.typeTable.makePrimitiveDatatypeAvailable(EPrimitive.f64).id,
              ).id,
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
              ).id,
            };
          }
          break;

        case EBinaryOperation.LessEqal:
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
              ).id,
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
              ).id,
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
              ).id,
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
            sr.typeTable.makeDatatypeAvailable({ variant: "Deferred" }).id,
          ).id,
        };
      }

      throw new InternalError("No known binary result for types ");
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ConstantExpr": {
      const dt = sr.typeTable.makePrimitiveDatatypeAvailable(EPrimitive.i32);
      const sym = sr.symbolTable.makeDatatypeSymbolAvailable(dt.id);
      return {
        variant: "Constant",
        typeSymbol: sym.id,
        value: expr.constant.value,
      };
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
      const functype = getTypeFromSymbol(sr, calledExpr.typeSymbol) as Semantic.FunctionDatatype;
      return {
        variant: "ExprCall",
        calledExpr: calledExpr,
        arguments: args,
        typeSymbol: getSymbol(sr, functype.functionReturnValue).id!,
      };
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "SymbolValueExpr": {
      if (expr.name === "this") {
        let s: Semantic.Scope | undefined = scope;
        while (s) {
          if (scope.collectScope._semantic.forFunctionSymbol) {
            const symbol = getSymbol(sr, scope.collectScope._semantic.forFunctionSymbol);
            if (
              symbol.variant === "FunctionDefinition" &&
              symbol.method !== EMethodType.NotAMethod &&
              symbol.methodOfSymbol
            ) {
              const structType = getTypeFromSymbol(sr, symbol.methodOfSymbol);
              if (structType.variant !== "Struct") {
                throw new ImpossibleSituation();
              }
              return {
                variant: "SymbolValueThisPointer",
                typeSymbol: symbol.methodOfSymbol!,
              };
            }
            break;
          }
          s = s.parentScope;
        }
      }

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
        };
      } else if (
        symbol.variant === "FunctionDeclaration" ||
        symbol.variant === "FunctionDefinition"
      ) {
        elaborate(sr, symbol, genericContext);
        if (!symbol._semantic.symbol) throw new ImpossibleSituation();
        const rawFunctionSymbol = getSymbol(sr, symbol._semantic.symbol) as
          | Semantic.FunctionDeclarationSymbol
          | Semantic.FunctionDefinitionSymbol;

        const functionSymbol = instantiateSymbol(sr, rawFunctionSymbol.id!, {
          symbolToSymbol: new Map(),
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
        };
      } else {
        throw new CompilerError(`Symbol ${symbol.name} cannot be used as a value`, expr.sourceloc);
      }
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
        };
      } else if (methodId) {
        const method = getSymbol(sr, methodId) as
          | Semantic.FunctionDeclarationSymbol
          | Semantic.FunctionDefinitionSymbol;
        const methodTypeSymbol = getSymbol(sr, method.typeSymbol);

        return {
          variant: "ExprMemberAccess",
          expr: object,
          method: method.id,
          memberName: expr.member,
          typeSymbol: methodTypeSymbol.id!,
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
      symbolToSymbol: new Map<ID, ID>(),
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

      let typeSymbolId: ID | undefined = undefined;
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
        definedInCollectorScope: scope.id,
        sourceLoc: s.sourceloc,
        memberOfType: undefined,
      });
      s._semantic.symbol = symbol.id;

      return {
        variant: "VariableStatement",
        mutable: s.mutable,
        name: s.name,
        typeSymbol: typeSymbolId,
        value: expr,
      };
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExprStatement":
      return {
        variant: "ExprStatement",
        expr: elaborateExpr(sr, scope, s.expr, genericContext),
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
      symbolToSymbol: new Map<ID, ID>(),
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
): ID {
  logger.trace("elaborate()");
  if (!genericContext) {
    genericContext = {
      symbolToSymbol: new Map<ID, ID>(),
      elaborateCurrentStructOrNamespace: null,
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

      item._semantic.symbol = sr.symbolTable.defineSymbol({
        variant: "FunctionDeclaration",
        typeSymbol: resolveDatatype(sr, item._collect.definedInScope!, type, genericContext).id,
        export: item.export,
        externLanguage: item.externLanguage,
        method: item._collect.method!,
        name: item.name,
        // namespacePath: item.namespacePath,
        sourceloc: item.sourceloc,
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

      let symbol = sr.symbolTable.defineSymbol({
        variant: "FunctionDefinition",
        typeSymbol: resolveDatatype(sr, item._collect.definedInScope!, type, genericContext).id,
        export: item.export,
        externLanguage: item.externLanguage,
        method: item._collect.method!,
        name: item.name,
        sourceloc: item.sourceloc,
        scope: new Semantic.Scope(item.sourceloc, item.funcbody._collect.scope!),
      });
      if (symbol.variant !== "FunctionDefinition") {
        throw new ImpossibleSituation();
      }
      item._semantic.symbol = symbol.id;

      if (item.funcbody._collect.scope) {
        item.funcbody._collect.scope._semantic.forFunctionSymbol = symbol.id;
        symbol.scope = elaborateScope(
          sr,
          item.funcbody._collect.scope,
          genericContext,
          symbol.scope,
        );
      }

      if (item.returnType!.variant === "Deferred") {
        if (symbol.scope.returnedTypes.length > 0) {
          if (!hasOnlyDuplicates(symbol.scope.returnedTypes)) {
            throw new InternalError("Multiple different return types not supported yet");
          }

          const functypeSymbol = sr.symbolTable.get(symbol.typeSymbol) as Semantic.DatatypeSymbol;
          const functype = sr.typeTable.get(functypeSymbol.type) as Semantic.FunctionDatatype;
          functype.functionReturnValue =
            symbol.scope.returnedTypes[0] ||
            sr.symbolTable.makeDatatypeSymbolAvailable(
              sr.typeTable.makePrimitiveDatatypeAvailable(EPrimitive.none).id,
            ).id;
          symbol.typeSymbol = sr.typeTable.makeDatatypeAvailable(functype).id;
          symbol = sr.symbolTable.makeSymbolAvailable(symbol);
          item._semantic.symbol = symbol.id;
        } else {
          const functypeSymbol = sr.symbolTable.get(symbol.typeSymbol) as Semantic.DatatypeSymbol;
          const functype = sr.typeTable.get(functypeSymbol.type) as Semantic.FunctionDatatype;
          functype.functionReturnValue = sr.symbolTable.makeDatatypeSymbolAvailable(
            sr.typeTable.makePrimitiveDatatypeAvailable(EPrimitive.none).id,
          ).id;
          symbol.typeSymbol = sr.typeTable.makeDatatypeAvailable(functype).id;
          symbol = sr.symbolTable.makeSymbolAvailable(symbol);
          item._semantic.symbol = symbol.id;
        }
      } else {
        if (!hasOnlyDuplicates(symbol.scope.returnedTypes)) {
          throw new InternalError("Multiple different return types not supported yet");
        }
      }

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

      let symbol = sr.symbolTable.defineSymbol({
        variant: "FunctionDefinition",
        typeSymbol: resolveDatatype(sr, item._collect.definedInScope!, type, genericContext).id,
        export: false,
        externLanguage: EExternLanguage.None,
        method: EMethodType.Method,
        name: item.name,
        sourceloc: item.sourceloc,
        methodOfSymbol: item._semantic.memberOfSymbol,
        scope: new Semantic.Scope(item.sourceloc, assertScope(item.funcbody._collect.scope)),
        nestedParentTypeSymbol: item._semantic.memberOfSymbol,
      });
      if (symbol.variant !== "FunctionDefinition") {
        throw new ImpossibleSituation();
      }
      item._semantic.symbol = symbol.id;

      if (item.funcbody._collect.scope) {
        item.funcbody._collect.scope._semantic.forFunctionSymbol = symbol.id;
        symbol.scope = elaborateScope(
          sr,
          item.funcbody._collect.scope,
          genericContext,
          symbol.scope,
        );
      }

      if (item.returnType!.variant === "Deferred") {
        if (symbol.scope.returnedTypes.length > 0) {
          if (!hasOnlyDuplicates(symbol.scope.returnedTypes)) {
            throw new InternalError("Multiple different return types not supported yet");
          }

          const functypeSymbol = sr.symbolTable.get(symbol.typeSymbol) as Semantic.DatatypeSymbol;
          const functype = sr.typeTable.get(functypeSymbol.type) as Semantic.FunctionDatatype;
          functype.functionReturnValue =
            symbol.scope.returnedTypes[0] ||
            sr.symbolTable.makeDatatypeSymbolAvailable(
              sr.typeTable.makePrimitiveDatatypeAvailable(EPrimitive.none).id,
            ).id;
          symbol.typeSymbol = sr.typeTable.makeDatatypeAvailable(functype).id;
          symbol = sr.symbolTable.makeSymbolAvailable(symbol);
          item._semantic.symbol = symbol.id;
        } else {
          const functypeSymbol = sr.symbolTable.get(symbol.typeSymbol) as Semantic.DatatypeSymbol;
          const functype = sr.typeTable.get(functypeSymbol.type) as Semantic.FunctionDatatype;
          functype.functionReturnValue = sr.symbolTable.makeDatatypeSymbolAvailable(
            sr.typeTable.makePrimitiveDatatypeAvailable(EPrimitive.none).id,
          ).id;
          symbol.typeSymbol = sr.typeTable.makeDatatypeAvailable(functype).id;
          symbol = sr.symbolTable.makeSymbolAvailable(symbol);
          item._semantic.symbol = symbol.id;
        }
      } else {
        if (!hasOnlyDuplicates(symbol.scope.returnedTypes)) {
          throw new InternalError("Multiple different return types not supported yet");
        }
      }

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
      });
      if (struct.variant !== "Struct") throw new ImpossibleSituation();
      item._semantic.type = struct.id;

      const structSym = sr.symbolTable.makeSymbolAvailable({
        variant: "Datatype",
        export: false,
        type: struct.id,
      });
      item._semantic.symbol = structSym.id;

      // Add members
      struct.members = item.members.map((m) => {
        return sr.symbolTable.makeSymbolAvailable({
          variant: "Variable",
          name: m.name,
          externLanguage: EExternLanguage.None,
          export: false,
          mutable: true,
          definedInCollectorScope: item._collect.scope!.id,
          sourceLoc: m.sourceloc,
          typeSymbol: resolveDatatype(sr, item._collect.scope!, m.type, genericContext).id,
          memberOfType: struct.id,
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

      return sr.symbolTable.makeDatatypeSymbolAvailable(struct.id).id;
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
      symbolToSymbol: new Map<ID, ID>(),
      elaborateCurrentStructOrNamespace: null,
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
  return sr;
}

export function PrettyPrintAnalyzed(sr: SemanticResult) {
  const indent = 0;

  const print = (str: string, _indent = 0) => {
    console.log(" ".repeat(indent + _indent) + str);
  };

  const typeFunc = (id: ID): string => {
    const t = sr.typeTable.get(id);
    if (!t) {
      throw new ImpossibleSituation();
    }
    switch (t.variant) {
      case "Function":
        return func(t.functionParameters, t.functionReturnValue, t.vararg);

      case "Primitive":
        return primitiveToString(t.primitive);

      case "Struct": {
        let s = t.fullNamespacedName.join(".");

        if (t.genericSymbols.length > 0) {
          s += " generics=[" + t.genericSymbols.join(", ") + "]";
        }

        return "(" + s + ")";
      }

      case "Deferred":
        return "_deferred_";

      case "Namespace":
        return t.name;
    }
  };

  const params = (ps: ID[]) => {
    return ps
      .map((p) => {
        const s = sr.symbolTable.get(p) as Semantic.VariableSymbol;
        return `${s.name}: ${s.typeSymbol}`;
      })
      .join(", ");
  };

  const func = (ps: ID[], retType: ID, vararg: boolean) => {
    return `(${params(ps)}${vararg ? ", ..." : ""}) => ${retType}`;
  };

  print("Datatype Table:");
  for (const [id, type] of sr.typeTable.getAll()) {
    switch (type.variant) {
      case "Function":
        print(` - [${id}] FunctionType ${typeFunc(id)}`);
        break;

      case "Primitive":
        print(` - [${id}] PrimitiveType ${typeFunc(id)}`);
        break;

      case "Struct":
        print(
          ` - [${id}] StructType ${typeFunc(id)} members=${type.members.map((id) => id).join(", ")}`,
        );
        break;

      case "Deferred":
        print(` - [${id}] Deferred`);
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
        print(` - [${id}] Datatype type=${symbol.type}`);
        break;

      case "FunctionDeclaration":
        print(` - [${id}] FuncDecl ${symbol.name}() type=${symbol.typeSymbol}`);
        break;

      case "FunctionDefinition":
        print(` - [${id}] FuncDef ${symbol.name}() type=${symbol.typeSymbol}`);
        break;

      case "GenericParameter":
        print(` - [${id}] GenericParameter ${symbol.name}`);
        break;

      case "Variable":
        print(
          ` - [${id}] Variable ${symbol.name} typeSymbol=${symbol.typeSymbol} memberOf=${symbol.memberOfType}`,
        );
        break;
    }
  }
  print("\n");
}
