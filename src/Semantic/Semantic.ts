import { CompilerError, ImpossibleSituation, InternalError } from "../Errors";
import {
  EExternLanguage,
  type ASTDatatype,
  type ASTFunctionDatatype,
} from "../shared/AST";
import { primitiveToString, stringToPrimitive } from "../shared/common";
import type { ID } from "../shared/store";
import type { Collect } from "../SymbolCollection/CollectSymbols";
import { Semantic, type SemanticResult } from "./SemanticSymbols";

function resolveDatatype(
  sr: SemanticResult,
  scope: Collect.Scope,
  datatype: ASTDatatype,
): ID {
  if (datatype.variant === "Deferred") {
    throw new InternalError("Cannot resolve a deferred datatype");
  } else if (datatype.variant === "FunctionDatatype") {
    return sr.typeTable.makeDatatypeAvailable({
      variant: "Function",
      vararg: datatype.ellipsis,
      functionReturnValue: resolveDatatype(sr, scope, datatype.returnType),
      functionParameters: datatype.params.map((p) =>
        resolveDatatype(sr, scope, p.datatype),
      ),
      generics: [],
    });
  } else {
    const primitive = stringToPrimitive(datatype.name);
    if (primitive) {
      if (datatype.generics.length > 0) {
        throw new Error(`Type ${datatype.name} is not generic`);
      }
      return sr.typeTable.makeDatatypeAvailable({
        variant: "Primitive",
        primitive: primitive,
      });
    }

    const datatypes: ASTDatatype[] = [];
    let d: ASTDatatype | undefined = datatype;
    while (d) {
      if (d.variant !== "NamedDatatype") throw new ImpossibleSituation();
      datatypes.push(d);
      d = d.nestedParent;
    }
    const reversed = datatypes.reverse();

    let loopScope: Collect.Scope | undefined = scope;
    for (const d of reversed.slice(0, -1)) {
      if (d.variant !== "NamedDatatype") throw new ImpossibleSituation();
      const found: Collect.Symbol = loopScope!.symbolTable.lookupSymbol(
        d.name,
        d.sourceloc,
      );
      if (!found) {
        throw new CompilerError(
          `${d.name} was not declared in this scope`,
          d.sourceloc,
        );
      }
      if (found.variant === "StructDefinition") {
        throw new CompilerError(
          `Struct '${d.name}' cannot be used as a namespace`,
          d.sourceloc,
        );
      } else if (found.variant === "NamespaceDefinition") {
        loopScope = found._collect.scope;
      } else {
        throw new CompilerError(
          `Symbol '${d.name}' cannot be used as a datatype here`,
          d.sourceloc,
        );
      }
    }

    if (!loopScope) {
      throw new ImpossibleSituation();
    }

    const found: Collect.Symbol = loopScope.symbolTable.lookupSymbol(
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
      const id = sr.typeTable.makeDatatypeAvailable({
        variant: "Struct",
        name: found.name,
        externLanguage: found.externLanguage,
        members: [],
        methods: found.members.map((m) =>
          sr.symbolTable.makeSymbolAvailable({
            variant: "Variable",
            name: m.name,
            externLanguage: EExternLanguage.None,
            export: false,
            mutable: true,
            sourceLoc: m.sourceloc,
            type: resolveDatatype(sr, found._collect.definedInScope!, m.type),
            memberOfType: undefined,
          }),
        ),
        genericSymbols: [],
      });

      // Fix circular references
      const struct = sr.typeTable.datatypes.get(id) as Semantic.StructDatatype;
      struct.members.forEach(
        (m) =>
          ((
            sr.symbolTable.symbols.get(m)! as Semantic.VariableSymbol
          ).memberOfType = id),
      );

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
        type: resolveDatatype(sr, item._collect.definedInScope!, type),
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
        type: resolveDatatype(sr, item._collect.definedInScope!, type),
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
    const t = sr.typeTable.datatypes.get(id)!;
    switch (t.variant) {
      case "Function":
        return func(t.functionParameters, t.functionReturnValue, t.vararg);

      case "Primitive":
        return primitiveToString(t.primitive);

      case "Struct":
        return t.name;
    }
  };

  const params = (ps: ID[]) => {
    return ps
      .map((p) => {
        const s = sr.symbolTable.symbols.get(p) as Semantic.VariableSymbol;
        return `${s.name}: ${typeFunc(s.type)}`;
      })
      .join(", ");
  };

  const func = (ps: ID[], retType: ID, vararg: boolean) => {
    return `(${params(ps)}${vararg ? ", ..." : ""}) => ${typeFunc(retType)}`;
  };

  print("Datatype Table:");
  for (const [id, type] of sr.typeTable.datatypes) {
    switch (type.variant) {
      case "Function":
        print(` - FunctionType ${typeFunc(id)}`);
        break;

      case "Primitive":
        print(` - PrimitiveType ${typeFunc(id)}`);
        break;

      case "Struct":
        print(` - StructType ${typeFunc(id)}`);
        break;
    }
  }
  print("\n");

  print("Symbol Table:");
  for (const [id, symbol] of sr.symbolTable.symbols) {
    switch (symbol.variant) {
      case "Datatype":
        print(` - Datatype`);
        break;

      case "FunctionDeclaration":
        print(` - FuncDecl`);
        break;

      case "FunctionDefinition":
        print(
          ` - FuncDef ${symbol.namespacePath.map((p) => p + ".")}${symbol.name} ${typeFunc(symbol.type)}`,
        );
        break;

      case "GenericParameter":
        print(` - GenericParameter`);
        break;

      case "Variable":
        print(` - Variable`);
        break;
    }
  }
  print("\n");
}
