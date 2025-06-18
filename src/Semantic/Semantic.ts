import { CompilerError, ImpossibleSituation, InternalError } from "../Errors";
import {
  EExternLanguage,
  type ASTDatatype,
  type ASTFunctionDatatype,
} from "../shared/AST";
import { primitiveToString, stringToPrimitive } from "../shared/common";
import { makeTypeId, type ID } from "../shared/store";
import type { Collect } from "../SymbolCollection/CollectSymbols";
import { Semantic, type SemanticResult } from "./SemanticSymbols";

type GenericContext = {
  symbolToSymbol: Map<ID, ID>;
};

function instantiateDatatype(
  sr: SemanticResult,
  id: ID,
  genericContext: GenericContext,
): ID {
  const type = sr.typeTable.get(id);

  switch (type.variant) {
    case "Function":
      return sr.typeTable.makeDatatypeAvailable({
        variant: "Function",
        vararg: type.vararg,
        functionParameters: type.functionParameters.map((p) =>
          instantiateDatatype(sr, p, genericContext),
        ),
        functionReturnValue: instantiateDatatype(
          sr,
          type.functionReturnValue,
          genericContext,
        ),
        generics: [],
      });

    case "Primitive":
      return id;

    case "Struct": {
      const id = sr.typeTable.makeDatatypeAvailable({
        variant: "Struct",
        name: type.name,
        genericSymbols: type.genericSymbols.map((g) =>
          instantiateSymbol(sr, g, genericContext),
        ),
        externLanguage: type.externLanguage,
        members: type.members.map((m) => {
          return instantiateSymbol(sr, m, genericContext);
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
): ID {
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
        typeSymbol: instantiateSymbol(sr, symbol.typeSymbol, genericContext),
      });
      return id;
    }

    case "Datatype": {
      return sr.symbolTable.makeSymbolAvailable({
        variant: "Datatype",
        export: symbol.export,
        sourceloc: symbol.sourceloc,
        type: instantiateDatatype(sr, symbol.type, genericContext),
      });
    }

    case "GenericParameter": {
      const got = genericContext.symbolToSymbol.get(symbol.id!);
      if (!got) {
        throw new InternalError("Generic Parameter has no mapping");
      }
      return instantiateSymbol(sr, got, genericContext);
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
): ID {
  const genericContext: GenericContext = _genericContext || {
    symbolToSymbol: new Map<ID, ID>(),
  };

  if (datatype.variant === "Deferred") {
    throw new InternalError("Cannot resolve a deferred datatype");
  } else if (datatype.variant === "FunctionDatatype") {
    const dt = sr.typeTable.makeDatatypeAvailable({
      variant: "Function",
      vararg: datatype.ellipsis,
      functionReturnValue: resolveSymbol(
        sr,
        scope,
        datatype.returnType,
        genericContext,
      ),
      functionParameters: datatype.params.map((p) =>
        resolveSymbol(sr, scope, p.datatype, genericContext),
      ),
      generics: [],
    });
    return sr.symbolTable.makeSymbolAvailable({
      variant: "Datatype",
      export: false,
      type: dt,
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
        type: dt,
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
      const generics = found.generics.map((g) =>
        sr.symbolTable.makeSymbolAvailable({
          variant: "GenericParameter",
          name: g,
          belongsToStruct: found._collect.fullNamespacedName!,
          sourceLoc: found.sourceloc,
        }),
      );

      const structId = sr.typeTable.makeDatatypeAvailable({
        variant: "Struct",
        name: found.name,
        externLanguage: found.externLanguage,
        members: [],
        methods: [],
        genericSymbols: generics,
        fullNamespacedName: found._collect.fullNamespacedName!,
        namespaces: found._collect.namespaces!,
      });
      const struct = sr.typeTable.get(structId) as Semantic.StructDatatype;
      found._semantic.type = structId;

      // Add members
      struct.members = found.members.map((m) =>
        sr.symbolTable.makeSymbolAvailable({
          variant: "Variable",
          name: m.name,
          externLanguage: EExternLanguage.None,
          export: false,
          mutable: true,
          sourceLoc: m.sourceloc,
          typeSymbol: resolveSymbol(
            sr,
            found._collect.scope!,
            m.type,
            genericContext,
          ),
        }),
      );

      if (struct.genericSymbols.length !== datatype.generics.length) {
        throw new CompilerError(
          `Type ${found.name} expects ${found.generics.length} generics but received ${datatype.generics.length}`,
          datatype.sourceloc,
        );
      }
      if (struct.genericSymbols.length > 0) {
        for (let i = 0; i < struct.genericSymbols.length; i++) {
          const g = datatype.generics[i];
          if (
            g.variant === "NumberConstant" ||
            g.variant === "StringConstant" ||
            g.variant === "BooleanConstant"
          ) {
            throw new InternalError("Constants not implemented in generics");
          }
          genericContext.symbolToSymbol.set(
            struct.genericSymbols[i],
            resolveSymbol(sr, scope, g, genericContext),
          );
        }
      }

      return instantiateDatatype(sr, structId, genericContext);
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
        sourceLoc: found.sourceloc,
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

function analyze(sr: SemanticResult, item: Collect.Symbol) {
  switch (item.variant) {
    case "FunctionDeclaration": {
      if (
        item.externLanguage === EExternLanguage.Extern_C &&
        item._collect.definedInNamespace !== undefined
      ) {
        throw new CompilerError(
          `Functions declared as extern "C" cannot live in a namespace`,
          item.sourceloc,
        );
      }

      const type: ASTFunctionDatatype = {
        variant: "FunctionDatatype",
        params: item.params,
        ellipsis: item.ellipsis,
        returnType: item.returnType!,
        sourceloc: item.sourceloc,
      };

      sr.symbolTable.defineSymbol({
        variant: "FunctionDeclaration",
        typeSymbol: resolveSymbol(sr, item._collect.definedInScope!, type),
        export: item.export,
        externLanguage: item.externLanguage,
        method: item._collect.method!,
        name: item.name,
        // namespacePath: item.namespacePath,
        namespacePath: [],
        sourceloc: item.sourceloc,
      });
      break;
    }

    case "FunctionDefinition": {
      if (
        item.externLanguage === EExternLanguage.Extern_C &&
        item._collect.definedInNamespace !== undefined
      ) {
        throw new CompilerError(
          `Functions declared as extern "C" cannot live in a namespace`,
          item.sourceloc,
        );
      }

      const type: ASTFunctionDatatype = {
        variant: "FunctionDatatype",
        params: item.params,
        ellipsis: item.ellipsis,
        returnType: item.returnType!,
        sourceloc: item.sourceloc,
      };

      sr.symbolTable.defineSymbol({
        variant: "FunctionDefinition",
        typeSymbol: resolveSymbol(sr, item._collect.definedInScope!, type),
        export: item.export,
        externLanguage: item.externLanguage,
        method: item._collect.method!,
        name: item.name,
        namespacePath: item._collect.namespacePath!,
        sourceloc: item.sourceloc,
        scope: new Semantic.Scope(item.sourceloc),
      });
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
        let s = t.name;

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
