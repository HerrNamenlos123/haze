import { logger } from "../log/log";
import { assertID } from "../shared/common";
import { assert, ImpossibleSituation, InternalError } from "../shared/Errors";
import type { SemanticSymbolId } from "../shared/store";
import { getSymbol, type Semantic, type SemanticResult } from "./SemanticSymbols";

export function instantiateSymbol(
  sr: SemanticResult,
  id: SemanticSymbolId,
  genericContext: Semantic.GenericContext,
  meta?: {
    newParentSymbol?: SemanticSymbolId;
  },
): Semantic.Symbol {
  logger.trace("instantiateSymbol() ");
  const symbol = sr.symbolTable.get(id);

  switch (symbol.variant) {
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
    // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

    case "Variable": {
      logger.trace("instantiateSymbol Variable");
      const typeSym = instantiateSymbol(sr, symbol.type, genericContext);
      const id = sr.symbolTable.makeSymbolAvailable({
        variant: "Variable",
        name: symbol.name,
        externLanguage: symbol.externLanguage,
        export: symbol.export,
        mutable: symbol.mutable,
        sourceLoc: symbol.sourceLoc,
        type: typeSym.id,
        memberOf: meta?.newParentSymbol && getSymbol(sr, meta.newParentSymbol).id,
        definedInScope: symbol.definedInScope,
        concrete: typeSym.concrete,
        variableContext: symbol.variableContext,
      });
      return id;
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
        return symbol as Semantic.Symbol;
      }
    }

    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
    // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

    case "FunctionDeclaration": {
      logger.trace("instantiateSymbol FunctionDeclaration");
      const typeSym = instantiateSymbol(sr, symbol.type!, genericContext);
      return sr.symbolTable.makeSymbolAvailable({
        variant: "FunctionDeclaration",
        export: symbol.export,
        sourceloc: symbol.sourceloc,
        externLanguage: symbol.externLanguage,
        method: symbol.method,
        name: symbol.name,
        type: typeSym.id,
        nestedParentTypeSymbol: meta?.newParentSymbol,
        concrete: typeSym.concrete,
      });
    }

    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
    // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

    case "FunctionDefinition": {
      logger.trace("instantiateSymbol FunctionDefinition");
      const typeSym = instantiateSymbol(sr, symbol.type!, genericContext);
      return sr.symbolTable.makeSymbolAvailable({
        variant: "FunctionDefinition",
        export: symbol.export,
        sourceloc: symbol.sourceloc,
        externLanguage: symbol.externLanguage,
        method: symbol.method,
        name: symbol.name,
        type: typeSym.id,
        scope: symbol.scope,
        methodOfSymbol: meta?.newParentSymbol,
        nestedParentTypeSymbol: meta?.newParentSymbol,
        concrete: typeSym.concrete,
      });
    }

    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
    // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

    case "FunctionDatatype": {
      let paramsConcrete = true;
      const params = symbol.functionParameters.map((p) => {
        const instantiated = instantiateSymbol(sr, p.type, genericContext);
        if (!instantiated.concrete) paramsConcrete = false;
        return {
          name: p.name,
          type: instantiated.id,
        };
      });
      const returnType = instantiateSymbol(sr, symbol.functionReturnValue, genericContext);
      const dt = sr.symbolTable.makeSymbolAvailable({
        variant: "FunctionDatatype",
        vararg: symbol.vararg,
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

    case "PrimitiveDatatype":
      return symbol;

    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
    // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

    case "StructDatatype": {
      if (genericContext.datatypesDone.has(symbol.id)) {
        const struct = getSymbol(sr, assertID(genericContext.datatypesDone.get(symbol.id)));
        return struct;
      }

      const struct = sr.symbolTable.makeSymbolAvailable({
        variant: "StructDatatype",
        name: symbol.name,
        genericSymbols: symbol.genericSymbols.map(
          (g) => instantiateSymbol(sr, g, genericContext).id,
        ),
        externLanguage: symbol.externLanguage,
        definedInNamespaceOrStruct: symbol.definedInNamespaceOrStruct,
        members: [],
        methods: [],
        fullNamespacedName: symbol.fullNamespacedName,
        namespaces: symbol.namespaces,
        concrete: true,
      });
      if (struct.concrete) {
        genericContext.datatypesDone.set(symbol.id, struct.id!);
      }
      assert(struct.variant === "StructDatatype");

      struct.members = symbol.members.map((m) => {
        const sym = instantiateSymbol(sr, m, genericContext, {
          newParentSymbol: struct.id,
        });
        if (!sym.concrete) struct.concrete = false;
        return sym.id;
      });

      struct.methods = symbol.methods.map((m) => {
        const sym = instantiateSymbol(sr, m, genericContext, {
          newParentSymbol: struct.id,
        });
        if (!sym.concrete) struct.concrete = false;
        return sym.id;
      });

      return struct;
    }

    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
    // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

    case "RawPointerDatatype": {
      const pointee = instantiateSymbol(sr, symbol.pointee, genericContext);
      const dt = sr.symbolTable.makeSymbolAvailable({
        variant: "RawPointerDatatype",
        pointee: pointee.id,
        concrete: pointee.concrete,
      });
      return dt;
    }

    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
    // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

    case "ReferenceDatatype": {
      const referee = instantiateSymbol(sr, symbol.referee, genericContext);
      const dt = sr.symbolTable.makeSymbolAvailable({
        variant: "ReferenceDatatype",
        referee: referee.id,
        concrete: referee.concrete,
      });
      console.log("Instantiated reference from ", dt);
      return dt;
    }

    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
    // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

    default:
      throw new InternalError("Unhandled variant");
  }
}
