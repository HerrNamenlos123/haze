import { logger } from "../log/log";
import { ImpossibleSituation, InternalError } from "../shared/Errors";
import type { ID } from "../shared/store";
import { PrettyPrintAnalyzed } from "./Elaborate";
import type { Semantic, SemanticResult } from "./SemanticSymbols";

export function instantiateDatatype(
  sr: SemanticResult,
  id: ID,
  genericContext: Semantic.GenericContext,
): Semantic.Datatype & { id: ID } {
  logger.trace("instantiateDatatype()");
  const type = sr.typeTable.get(id);
  if (!type.id) throw new ImpossibleSituation();

  switch (type.variant) {
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
    // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

    case "Function":
      return sr.typeTable.makeDatatypeAvailable({
        variant: "Function",
        vararg: type.vararg,
        functionParameters: type.functionParameters.map((p) => ({
          name: p.name,
          typeSymbol: instantiateSymbol(sr, p.typeSymbol, genericContext).id,
        })),
        functionReturnValue: instantiateSymbol(sr, type.functionReturnValue, genericContext).id,
        generics: [],
      });

    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
    // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

    case "Primitive":
      return type as Semantic.Datatype & { id: ID };

    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
    // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

    case "Struct": {
      const struct = sr.typeTable.makeDatatypeAvailable({
        variant: "Struct",
        name: type.name,
        genericSymbols: type.genericSymbols.map((g) => instantiateSymbol(sr, g, genericContext).id),
        externLanguage: type.externLanguage,
        definedInNamespaceOrStruct: type.definedInNamespaceOrStruct,
        members: [],
        methods: [],
        fullNamespacedName: type.fullNamespacedName,
        namespaces: type.namespaces,
      }) as Semantic.StructDatatype;

      struct.members = type.members.map((m) => {
        return instantiateSymbol(sr, m, genericContext, {
          newParentSymbol: struct.id,
        }).id;
      });

      struct.methods = type.methods.map((m) => {
        return instantiateSymbol(sr, m, genericContext, {
          newParentSymbol: struct.id,
        }).id;
      });

      return struct as Semantic.Datatype & { id: ID };
    }

    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
    // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

    default:
      throw new ImpossibleSituation();
  }
}

export function instantiateSymbol(
  sr: SemanticResult,
  id: ID,
  genericContext: Semantic.GenericContext,
  meta?: {
    newParentSymbol?: ID;
  },
): Semantic.Symbol & { id: ID } {
  logger.trace("instantiateSymbol() ");
  const symbol = sr.symbolTable.get(id);

  switch (symbol.variant) {
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
    // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

    case "Variable": {
      logger.trace("instantiateSymbol Variable");
      const id = sr.symbolTable.makeSymbolAvailable({
        variant: "Variable",
        name: symbol.name,
        externLanguage: symbol.externLanguage,
        export: symbol.export,
        mutable: symbol.mutable,
        sourceLoc: symbol.sourceLoc,
        typeSymbol: instantiateSymbol(sr, symbol.typeSymbol, genericContext).id,
        memberOfType: meta?.newParentSymbol,
        definedInCollectorScope: symbol.definedInCollectorScope,
      });
      return id;
    }

    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
    // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

    case "Datatype": {
      logger.trace("instantiateSymbol Datatype");
      return sr.symbolTable.makeSymbolAvailable({
        variant: "Datatype",
        export: symbol.export,
        type: instantiateDatatype(sr, symbol.type, genericContext).id,
      });
    }

    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
    // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

    case "GenericParameter": {
      logger.trace("instantiateSymbol GenericParameter");
      const mappedTo = genericContext.symbolToSymbol.get(symbol.id!);
      if (mappedTo) {
        if (mappedTo === symbol.id) {
          throw new InternalError("Generic Mapping is circular - Parameter points to itself");
        }
        return instantiateSymbol(sr, mappedTo, genericContext);
      } else {
        return symbol as Semantic.Symbol & { id: ID };
      }
    }

    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
    // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

    case "FunctionDeclaration": {
      logger.trace("instantiateSymbol FunctionDeclaration");
      return sr.symbolTable.makeSymbolAvailable({
        variant: "FunctionDeclaration",
        export: symbol.export,
        sourceloc: symbol.sourceloc,
        externLanguage: symbol.externLanguage,
        method: symbol.method,
        name: symbol.name,
        typeSymbol: instantiateSymbol(sr, symbol.typeSymbol!, genericContext).id,
        nestedParentTypeSymbol: meta?.newParentSymbol,
      });
    }

    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
    // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

    case "FunctionDefinition": {
      logger.trace("instantiateSymbol FunctionDefinition");
      return sr.symbolTable.makeSymbolAvailable({
        variant: "FunctionDefinition",
        export: symbol.export,
        sourceloc: symbol.sourceloc,
        externLanguage: symbol.externLanguage,
        method: symbol.method,
        name: symbol.name,
        typeSymbol: instantiateSymbol(sr, symbol.typeSymbol!, genericContext).id,
        scope: symbol.scope,
        methodOfSymbol: meta?.newParentSymbol,
        nestedParentTypeSymbol: meta?.newParentSymbol,
      });
    }

    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
    // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

    default:
      throw new InternalError("Unhandled variant");
  }
}
