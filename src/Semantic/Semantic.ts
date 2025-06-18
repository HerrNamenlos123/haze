import { CompilerError, ImpossibleSituation, InternalError } from "../Errors";
import {
  EExternLanguage,
  type ASTDatatype,
  type ASTExpr,
  type ASTFunctionDatatype,
} from "../shared/AST";
import {
  assertID,
  assertScope,
  EPrimitive,
  primitiveToString,
  stringToPrimitive,
} from "../shared/common";
import { makeTypeId, type ID } from "../shared/store";
import type { Collect } from "../SymbolCollection/CollectSymbols";
import { assertSymbolVariant } from "../utils";
import { Semantic, type SemanticResult } from "./SemanticSymbols";

type GenericContext = {
  symbolToSymbol: Map<ID, ID>;
};

function getType(sr: SemanticResult, id: ID) {
  const type = sr.typeTable.get(id);
  if (!type) {
    throw new InternalError("Type does not exist " + id);
  }
  return type;
}

function getSymbol(sr: SemanticResult, id: ID): Semantic.Symbol & { id: ID } {
  const symbol = sr.symbolTable.get(id);
  if (!symbol) {
    throw new InternalError("Symbol does not exist " + id);
  }
  return symbol as Semantic.Symbol & { id: ID };
}

function getTypeFromSymbol(
  sr: SemanticResult,
  id: ID,
): Semantic.Datatype & { id: ID } {
  const symbol = getSymbol(sr, id);
  if (!symbol.id) {
    throw new InternalError("Symbol id is null");
  }
  return getType(sr, symbol.id) as Semantic.Datatype & { id: ID };
}

function instantiateDatatype(
  sr: SemanticResult,
  id: ID,
  genericContext: GenericContext,
): Semantic.Datatype & { id: ID } {
  const type = sr.typeTable.get(id);
  if (!type.id) throw new ImpossibleSituation();

  switch (type.variant) {
    case "Function":
      return sr.typeTable.makeDatatypeAvailable({
        variant: "Function",
        vararg: type.vararg,
        functionParameters: type.functionParameters.map(
          (p) => instantiateSymbol(sr, p, genericContext).id,
        ),
        functionReturnValue: instantiateSymbol(
          sr,
          type.functionReturnValue,
          genericContext,
        ).id,
        generics: [],
      });

    case "Primitive":
      return type as Semantic.Datatype & { id: ID };

    case "Struct": {
      const id = sr.typeTable.makeDatatypeAvailable({
        variant: "Struct",
        name: type.name,
        genericSymbols: type.genericSymbols.map(
          (g) => instantiateSymbol(sr, g, genericContext).id,
        ),
        externLanguage: type.externLanguage,
        members: type.members.map((m) => {
          return instantiateSymbol(sr, m, genericContext).id;
        }),
        methods: [],
        fullNamespacedName: type.fullNamespacedName,
        namespaces: type.namespaces,
      });
      return id;
    }

    default:
      throw new ImpossibleSituation();
  }
}

function instantiateSymbol(
  sr: SemanticResult,
  id: ID,
  genericContext: GenericContext,
): Semantic.Symbol & { id: ID } {
  const symbol = sr.symbolTable.get(id);

  switch (symbol.variant) {
    case "Variable": {
      const id = sr.symbolTable.makeSymbolAvailable({
        variant: "Variable",
        name: symbol.name,
        externLanguage: symbol.externLanguage,
        export: symbol.export,
        mutable: symbol.mutable,
        sourceLoc: symbol.sourceLoc,
        typeSymbol: instantiateSymbol(sr, symbol.typeSymbol, genericContext).id,
      });
      return id;
    }

    case "Datatype": {
      return sr.symbolTable.makeSymbolAvailable({
        variant: "Datatype",
        export: symbol.export,
        sourceloc: symbol.sourceloc,
        type: instantiateDatatype(sr, symbol.type, genericContext).id,
      });
    }

    case "GenericParameter": {
      const got = genericContext.symbolToSymbol.get(symbol.id!);
      if (!got) {
        throw new InternalError("Generic Parameter has no mapping");
      }
      return instantiateSymbol(sr, got, genericContext);
    }

    case "FunctionDeclaration": {
      return sr.symbolTable.makeSymbolAvailable({
        variant: "FunctionDeclaration",
        export: symbol.export,
        sourceloc: symbol.sourceloc,
        externLanguage: symbol.externLanguage,
        method: symbol.method,
        name: symbol.name,
        namespacePath: symbol.namespacePath,
        typeSymbol: instantiateSymbol(sr, symbol.typeSymbol!, genericContext)
          .id,
      });
    }

    case "FunctionDefinition": {
      return sr.symbolTable.makeSymbolAvailable({
        variant: "FunctionDefinition",
        export: symbol.export,
        sourceloc: symbol.sourceloc,
        externLanguage: symbol.externLanguage,
        method: symbol.method,
        name: symbol.name,
        namespacePath: symbol.namespacePath,
        typeSymbol: instantiateSymbol(sr, symbol.id!, genericContext).id,
        scope: symbol.scope,
      });
    }

    default:
      throw new InternalError("Unhandled variant: " + symbol.variant);
  }
}

function resolveSymbol(
  sr: SemanticResult,
  scope: Collect.Scope,
  datatype: ASTDatatype,
  _genericContext?: GenericContext,
): Semantic.Symbol & { id: ID } {
  const genericContext: GenericContext = _genericContext || {
    symbolToSymbol: new Map<ID, ID>(),
  };

  if (datatype.variant === "Deferred") {
    const dt = sr.typeTable.makeDatatypeAvailable({
      variant: "Deferred",
    });
    return sr.symbolTable.makeSymbolAvailable({
      variant: "Datatype",
      export: false,
      type: dt.id,
      sourceloc: scope.sourceloc,
    });
  } else if (datatype.variant === "FunctionDatatype") {
    const dt = sr.typeTable.makeDatatypeAvailable({
      variant: "Function",
      vararg: datatype.ellipsis,
      functionReturnValue: resolveSymbol(
        sr,
        scope,
        datatype.returnType,
        genericContext,
      ).id,
      functionParameters: datatype.params.map(
        (p) => resolveSymbol(sr, scope, p.datatype, genericContext).id,
      ),
      generics: [],
    });
    return sr.symbolTable.makeSymbolAvailable({
      variant: "Datatype",
      export: false,
      type: dt.id,
      sourceloc: datatype.sourceloc,
    });
  } else {
    const primitive = stringToPrimitive(datatype.name);
    if (primitive) {
      if (datatype.generics.length > 0) {
        throw new Error(`Type ${datatype.name} is not generic`);
      }
      const dt = sr.typeTable.makeDatatypeAvailable({
        variant: "Primitive",
        primitive: primitive,
      });
      return sr.symbolTable.makeSymbolAvailable({
        variant: "Datatype",
        export: false,
        type: dt.id,
        sourceloc: datatype.sourceloc,
      });
    }

    const found: Collect.Symbol = scope!.symbolTable.lookupSymbol(
      datatype.name,
      datatype.sourceloc,
    );
    if (!found) {
      throw new CompilerError(
        `${datatype.name} was not declared in this scope`,
        datatype.sourceloc,
      );
    }
    if (found.variant === "StructDefinition") {
      const generics = found.generics.map(
        (g) =>
          sr.symbolTable.makeSymbolAvailable({
            variant: "GenericParameter",
            name: g,
            belongsToStruct: found._collect.fullNamespacedName!,
            sourceloc: found.sourceloc,
          }).id,
      );

      if (found.generics.length !== datatype.generics.length) {
        throw new CompilerError(
          `Type ${found.name} expects ${found.generics.length} generics but received ${datatype.generics.length}`,
          datatype.sourceloc,
        );
      }

      // if (found.generics.length > 0) {
      //   for (let i = 0; i < found.generics.length; i++) {
      //     const g = datatype.generics[i];
      //     if (
      //       g.variant === "NumberConstant" ||
      //       g.variant === "StringConstant" ||
      //       g.variant === "BooleanConstant"
      //     ) {
      //       throw new InternalError("Constants not implemented in generics");
      //     }
      //     console.log("Mapping", found._collect.fullNamespacedName);
      //     genericContext.symbolToSymbol.set(
      //       generics[i],
      //       resolveSymbol(sr, scope!, g, genericContext).id,
      //     );
      //   }
      // }

      const struct = sr.typeTable.makeDatatypeAvailable({
        variant: "Struct",
        name: found.name,
        externLanguage: found.externLanguage,
        members: [],
        methods: [],
        genericSymbols: generics,
        fullNamespacedName: found._collect.fullNamespacedName!,
        namespaces: found._collect.namespaces!,
      });
      if (struct.variant !== "Struct") throw new ImpossibleSituation();
      found._semantic.type = struct.id;
      // console.log("Made struct ", struct.fullNamespacedName, generics);
      // PrettyPrintAnalyzed(sr);

      // Add members
      struct.members = found.members.map((m) => {
        console.log(
          "Resolving member of",
          found._collect.fullNamespacedName,
          found._collect.scope?.symbolTable.symbols.map((s) => s.name),
          m.type,
        );
        const type = resolveSymbol(
          sr,
          found._collect.scope!,
          m.type,
          genericContext,
        );
        return sr.symbolTable.makeSymbolAvailable({
          variant: "Variable",
          name: m.name,
          externLanguage: EExternLanguage.None,
          export: false,
          mutable: true,
          sourceLoc: m.sourceloc,
          typeSymbol: type.id,
        }).id;
      });

      // return struct;
      // const dt = instantiateDatatype(sr, struct.id, genericContext);
      return sr.symbolTable.makeSymbolAvailable({
        variant: "Datatype",
        export: false,
        type: struct.id,
        sourceloc: found.sourceloc,
      });
    } else if (found.variant === "NamespaceDefinition") {
      if (datatype.nested) {
        return resolveSymbol(
          sr,
          found._collect.scope!,
          datatype.nested,
          genericContext,
        );
      } else {
        throw new CompilerError(
          `Namespace cannot be used as a datatype here`,
          datatype.sourceloc,
        );
      }
    } else if (found.variant === "GenericPlaceholder") {
      if (found.belongsToSymbol.variant !== "StructDefinition") {
        throw new ImpossibleSituation();
      }
      const structId = found.belongsToSymbol._semantic.type;
      if (!structId) {
        throw new ImpossibleSituation();
      }
      const struct = sr.typeTable.get(structId) as Semantic.StructDatatype;

      const id = sr.symbolTable.makeSymbolAvailable({
        variant: "GenericParameter",
        name: found.name,
        belongsToStruct: struct.fullNamespacedName,
        sourceloc: found.sourceloc,
      });
      return id;
    } else {
      throw new CompilerError(
        `Symbol '${datatype.name}' cannot be used as a datatype here`,
        datatype.sourceloc,
      );
    }
  }
}

function analyzeExpr(
  sr: SemanticResult,
  scope: Collect.Scope,
  expr: ASTExpr,
): Semantic.Expression {
  switch (expr.variant) {
    case "BinaryExpr":
      break;

    case "ConstantExpr": {
      const dt = sr.typeTable.makeDatatypeAvailable({
        variant: "Primitive",
        primitive: EPrimitive.i32,
      });
      return {
        variant: "Constant",
        type: dt.id,
        value: expr.constant.value,
      };
    }

    case "ParenthesisExpr": {
      return analyzeExpr(sr, scope, expr.expr);
    }

    case "ExprCallExpr": {
      const calledExpr = analyzeExpr(sr, scope, expr.calledExpr);
      const args = expr.arguments.map((a) => analyzeExpr(sr, scope, a));
      const functype = getType(
        sr,
        calledExpr.type,
      ) as Semantic.FunctionDatatype;
      return {
        variant: "ExprCall",
        calledExpr: calledExpr,
        arguments: args,
        type: getTypeFromSymbol(sr, functype.functionReturnValue).id!,
      };
    }

    case "SymbolValueExpr": {
      const symbol = scope.symbolTable.lookupSymbol(expr.name, expr.sourceloc);
      if (
        symbol.variant === "VariableDefinitionStatement" ||
        symbol.variant === "GlobalVariableDefinition"
      ) {
        if (!symbol._semantic.symbol)
          throw new InternalError("Semantic Symbol missing");
        const variableSymbol = getSymbol(
          sr,
          symbol._semantic.symbol,
        ) as Semantic.VariableSymbol;

        return {
          variant: "SymbolValue",
          symbol: variableSymbol.id!,
          type: variableSymbol.typeSymbol,
        };
      } else if (
        symbol.variant === "FunctionDeclaration" ||
        symbol.variant === "FunctionDefinition"
      ) {
        analyze(sr, symbol);
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
          type: functionSymbol.typeSymbol,
        };
      } else {
        throw new CompilerError(
          `Symbol ${symbol.name} cannot be used as a value`,
          expr.sourceloc,
        );
      }
    }

    case "ExprMemberAccess": {
      const object = analyzeExpr(sr, scope, expr.expr);
      const structType = getTypeFromSymbol(sr, object.type);
      if (structType.variant !== "Struct") {
        throw new CompilerError(
          "This expression is not a struct and there are no members to access",
          expr.sourceloc,
        );
      }

      const memberId = structType.members.find((m) => {
        const mm = sr.symbolTable.get(m)! as Semantic.VariableSymbol;
        return mm.name === expr.member;
      });
      if (!memberId) {
        throw new CompilerError(
          `No such member in struct ${structType.name}`,
          expr.sourceloc,
        );
      }

      const member = getSymbol(sr, memberId) as Semantic.VariableSymbol;
      const memberType = getTypeFromSymbol(sr, member.typeSymbol);

      return {
        variant: "ExprMemberAccess",
        expr: object,
        memberName: expr.member,
        type: memberType.id!,
      };
    }

    case "StructInstantiationExpr": {
      const symbol = resolveSymbol(sr, scope, expr.datatype);
      if (symbol.variant !== "Datatype") throw new ImpossibleSituation();
      const type = getType(sr, symbol.type);
      if (type.variant !== "Struct")
        throw new CompilerError(
          "This type cannot be instantiated",
          expr.sourceloc,
        );

      let remainingMembers = type.members.map(
        (m) => (getSymbol(sr, m) as Semantic.VariableSymbol).name,
      );
      const assignedMembers: string[] = [];
      const assign: {
        name: string;
        value: Semantic.Expression;
      }[] = [];
      for (const m of expr.members) {
        const e = analyzeExpr(sr, scope, m.value);

        const variableId = type.members.find((mm) => {
          const s = getSymbol(sr, mm);
          if (s.variant !== "Variable") throw new ImpossibleSituation();
          return s.name === m.name;
        });

        if (!variableId) {
          throw new CompilerError(
            `Member with name ${m.name} does not exist`,
            expr.sourceloc,
          );
        }
        const variable = getSymbol(sr, variableId) as Semantic.VariableSymbol;
        const variableTypeSymbol = getSymbol(sr, variable.typeSymbol);
        if (
          variableTypeSymbol.variant !== "GenericParameter" &&
          variableTypeSymbol.variant !== "Datatype"
        )
          throw new ImpossibleSituation();

        if (assignedMembers.includes(m.name)) {
          throw new CompilerError(
            `Cannot assign member ${m.name} twice`,
            expr.sourceloc,
          );
        }

        if (variableTypeSymbol.variant !== "GenericParameter") {
          if (e.type !== variableTypeSymbol.type) {
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
        type: type.id!,
      };
    }

    default:
      throw new InternalError("Unhandled variant: " + expr.variant);
  }
}

function analyzeScope(
  sr: SemanticResult,
  scope: Collect.Scope,
  semanticScope: Semantic.Scope,
) {
  scope._semantic.returnTypeSymbols = [];
  for (const s of scope.statements) {
    switch (s.variant) {
      case "InlineCStatement":
        break;

      case "IfStatement":
        // analyzeExpr(sr, scope, s.condition);
        // analyzeScope(sr, assertScope(s.then._collect.scope));
        // for (const e of s.elseIfs) {
        //   analyzeExpr(sr, assertScope(e.then._collect.scope), e.condition);
        //   analyzeScope(sr, assertScope(e.then._collect.scope));
        // }
        // if (s.else) {
        //   // analyzeScope(sr, assertScope(s.else._collect.scope));
        // }
        break;

      case "WhileStatement":
        // analyzeExpr(sr, scope, s.condition);
        // analyzeScope(sr, assertScope(s.body._collect.scope));
        break;

      case "ReturnStatement":
        if (s.expr) {
          const expr = analyzeExpr(sr, scope, s.expr);
          scope._semantic.returnTypeSymbols.push(expr.type);
        }
        break;

      case "VariableDefinitionStatement": {
        const expr = s.expr && analyzeExpr(sr, scope, s.expr);
        let datatypeSym = s.datatype && resolveSymbol(sr, scope, s.datatype);
        if (!expr && !datatypeSym) throw new ImpossibleSituation();
        if (datatypeSym && datatypeSym.variant !== "Datatype")
          throw new ImpossibleSituation();
        let datatype = datatypeSym && getType(sr, datatypeSym.type);
        if (!datatype && expr) {
          datatype = getType(sr, expr.type);
        }
        if (!datatype?.id) throw new ImpossibleSituation();
        if (!expr)
          throw new InternalError("Zero initializing not implemented yet");

        const symbol = sr.symbolTable.makeSymbolAvailable({
          variant: "Variable",
          export: false,
          externLanguage: EExternLanguage.None,
          mutable: s.mutable,
          name: s.name,
          typeSymbol: datatype.id,
          sourceLoc: s.sourceloc,
        });
        s._semantic.symbol = symbol.id;

        semanticScope.statements.push({
          variant: "Variable",
          mutable: s.mutable,
          name: s.name,
          type: datatype.id,
          value: expr,
        });
        break;
      }

      case "ExprStatement":
        analyzeExpr(sr, scope, s.expr);
        break;
    }
  }
}

function analyze(sr: SemanticResult, item: Collect.Symbol) {
  switch (item.variant) {
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
        typeSymbol: resolveSymbol(sr, item._collect.definedInScope!, type).id,
        export: item.export,
        externLanguage: item.externLanguage,
        method: item._collect.method!,
        name: item.name,
        // namespacePath: item.namespacePath,
        namespacePath: [],
        sourceloc: item.sourceloc,
      }).id;
      break;
    }

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
        typeSymbol: resolveSymbol(sr, item._collect.definedInScope!, type).id,
        export: item.export,
        externLanguage: item.externLanguage,
        method: item._collect.method!,
        name: item.name,
        namespacePath: item._collect.namespacePath!,
        sourceloc: item.sourceloc,
        scope: new Semantic.Scope(item.sourceloc),
      });
      if (symbol.variant !== "FunctionDefinition") {
        throw new ImpossibleSituation();
      }

      item._semantic.symbol = symbol.id;

      if (item.funcbody._collect.scope) {
        analyzeScope(sr, item.funcbody._collect.scope, symbol.scope);
      }

      const scope = assertScope(item.funcbody._collect.scope);
      if (item.returnType!.variant === "Deferred") {
        if (
          scope._semantic.returnTypeSymbols &&
          scope._semantic.returnTypeSymbols.length > 0
        ) {
          if (scope._semantic.returnTypeSymbols) {
            for (const id of scope._semantic.returnTypeSymbols) {
              if (id !== scope._semantic.returnTypeSymbols[0]) {
                throw new CompilerError(
                  "Multiple different return types are not supported yet",
                  scope.sourceloc,
                );
              }
            }
          }

          const functypeSymbol = sr.symbolTable.get(
            symbol.typeSymbol,
          ) as Semantic.DatatypeSymbol;
          const functype = sr.typeTable.get(
            functypeSymbol.type,
          ) as Semantic.FunctionDatatype;
          functype.functionReturnValue = scope._semantic.returnTypeSymbols[0];
          symbol.typeSymbol = sr.typeTable.makeDatatypeAvailable(functype).id;
          symbol = sr.symbolTable.makeSymbolAvailable(symbol);
          item._semantic.symbol = symbol.id;
        } else {
          const functypeSymbol = sr.symbolTable.get(
            symbol.typeSymbol,
          ) as Semantic.DatatypeSymbol;
          const functype = sr.typeTable.get(
            functypeSymbol.type,
          ) as Semantic.FunctionDatatype;
          functype.functionReturnValue = sr.typeTable.makeDatatypeAvailable({
            variant: "Primitive",
            primitive: EPrimitive.none,
          }).id;
          symbol.typeSymbol = sr.typeTable.makeDatatypeAvailable(functype).id;
          symbol = sr.symbolTable.makeSymbolAvailable(symbol);
          item._semantic.symbol = symbol.id;
        }
      } else {
        if (scope._semantic.returnTypeSymbols) {
          for (const id of scope._semantic.returnTypeSymbols) {
            if (id !== scope._semantic.returnTypeSymbols[0]) {
              throw new CompilerError(
                "Multiple different return types are not supported yet",
                scope.sourceloc,
              );
            }
          }

          // TODO
        }
      }

      break;
    }

    case "NamespaceDefinition":
      for (const symbol of item._collect.scope!.symbolTable.symbols) {
        analyze(sr, symbol);
      }
      break;
  }
}

function analyzeGlobalScope(sr: SemanticResult, globalScope: Collect.Scope) {
  for (const symbol of globalScope.symbolTable.symbols) {
    analyze(sr, symbol);
  }
}

export function SemanticallyAnalyze(globalScope: Collect.Scope) {
  const sr: SemanticResult = {
    symbolTable: new Semantic.SymbolTable(),
    typeTable: new Semantic.TypeTable(),
  };
  analyzeGlobalScope(sr, globalScope);
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

      // case "GenericPlaceholder":
      //   return t.name;

      // case "Namespace":
      //   return t.name;
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
        print(` - [${id}] StructType ${typeFunc(id)}`);
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
        print(` - [${id}] FuncDecl`);
        break;

      case "FunctionDefinition":
        print(
          ` - [${id}] FuncDef ${symbol.namespacePath.map((p) => p + ".")}${symbol.name}() type=${symbol.typeSymbol}`,
        );
        break;

      case "GenericParameter":
        print(` - [${id}] GenericParameter ${symbol.name}`);
        break;

      case "Variable":
        print(
          ` - [${id}] Variable ${symbol.name} typeSymbol=${symbol.typeSymbol}`,
        );
        break;
    }
  }
  print("\n");
}
