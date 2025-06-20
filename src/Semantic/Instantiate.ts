import { logger } from "../log/log";
import { ImpossibleSituation, InternalError } from "../shared/Errors";
import type { ID } from "../shared/store";
import { PrettyPrintAnalyzed } from "./Elaborate";
import { getType, getTypeFromSymbol, type Semantic, type SemanticResult } from "./SemanticSymbols";

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

    case "Function": {
      let paramsConcrete = true;
      const params = type.functionParameters.map((p) => {
        const instantiated = instantiateSymbol(sr, p.type, genericContext);
        if (!instantiated.concrete) paramsConcrete = false;
        return {
          name: p.name,
          type: instantiated.id,
        };
      });
      const returnType = instantiateSymbol(sr, type.functionReturnValue, genericContext);
      const dt = sr.typeTable.makeDatatypeAvailable({
        variant: "Function",
        vararg: type.vararg,
        functionParameters: params,
        functionReturnValue: returnType.id,
        generics: [],
        concrete: returnType.concrete && paramsConcrete,
      });
      return dt;
    }

    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
    // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

    case "Primitive":
      return type as Semantic.Datatype & { id: ID };

    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
    // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

    case "Struct": {
      if (genericContext.datatypesDone.has(type.id)) {
        const struct = getType(sr, genericContext.datatypesDone.get(type.id)!);
        return struct as Semantic.Datatype & { id: ID };
      }

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
        concrete: true,
      }) as Semantic.StructDatatype;
      genericContext.datatypesDone.set(type.id, struct.id!);

      struct.members = type.members.map((m) => {
        const sym = instantiateSymbol(sr, m, genericContext, {
          newParentSymbol: struct.id,
        });
        if (!sym.concrete) struct.concrete = false;
        return sym.id;
      });

      struct.methods = type.methods.map((m) => {
        const sym = instantiateSymbol(sr, m, genericContext, {
          newParentSymbol: struct.id,
        });
        if (!sym.concrete) struct.concrete = false;
        return sym.id;
      });

      return struct as Semantic.Datatype & { id: ID };
    }

    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
    // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

    case "RawPointer": {
      const pointee = instantiateSymbol(sr, type.pointee, genericContext);
      const dt = sr.typeTable.makeDatatypeAvailable({
        variant: "RawPointer",
        pointee: pointee.id,
        concrete: pointee.concrete,
      });
      return dt;
    }

    default:
      throw new InternalError("Unhandled variant: " + type.variant);
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
      const typeSym = instantiateSymbol(sr, symbol.typeSymbol, genericContext);
      const id = sr.symbolTable.makeSymbolAvailable({
        variant: "Variable",
        name: symbol.name,
        externLanguage: symbol.externLanguage,
        export: symbol.export,
        mutable: symbol.mutable,
        sourceLoc: symbol.sourceLoc,
        typeSymbol: typeSym.id,
        memberOfType: meta?.newParentSymbol,
        definedInCollectorScope: symbol.definedInCollectorScope,
        concrete: typeSym.concrete,
        variableContext: symbol.variableContext,
      });
      return id;
    }

    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
    // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

    case "Datatype": {
      logger.trace("instantiateSymbol Datatype");
      const type = instantiateDatatype(sr, symbol.type, genericContext);
      return sr.symbolTable.makeSymbolAvailable({
        variant: "Datatype",
        export: symbol.export,
        type: type.id,
        concrete: type.concrete,
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
      const typeSym = instantiateSymbol(sr, symbol.typeSymbol!, genericContext);
      return sr.symbolTable.makeSymbolAvailable({
        variant: "FunctionDeclaration",
        export: symbol.export,
        sourceloc: symbol.sourceloc,
        externLanguage: symbol.externLanguage,
        method: symbol.method,
        name: symbol.name,
        typeSymbol: typeSym.id,
        nestedParentTypeSymbol: meta?.newParentSymbol,
        concrete: typeSym.concrete,
      });
    }

    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
    // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

    case "FunctionDefinition": {
      logger.trace("instantiateSymbol FunctionDefinition");
      const typeSym = instantiateSymbol(sr, symbol.typeSymbol!, genericContext);
      return sr.symbolTable.makeSymbolAvailable({
        variant: "FunctionDefinition",
        export: symbol.export,
        sourceloc: symbol.sourceloc,
        externLanguage: symbol.externLanguage,
        method: symbol.method,
        name: symbol.name,
        typeSymbol: typeSym.id,
        scope: symbol.scope,
        methodOfSymbol: meta?.newParentSymbol,
        nestedParentTypeSymbol: meta?.newParentSymbol,
        concrete: typeSym.concrete,
      });
    }

    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
    // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

    default:
      throw new InternalError("Unhandled variant");
  }
}
