import { assert, InternalError } from "../shared/Errors";
import { defineThisReference, elaborateScope } from "./Elaborate";
import { Semantic, type SemanticResult } from "./SemanticSymbols";

export function instantiateSymbol<T extends Semantic.Symbol>(
  sr: SemanticResult,
  symbol: T,
  genericContext: Semantic.GenericContext,
  meta?: {
    newMemberOf?: Semantic.StructDatatypeSymbol;
  },
): T {
  switch (symbol.variant) {
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
    // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

    case "Variable": {
      const type = instantiateSymbol(sr, symbol.type, genericContext);
      return {
        variant: "Variable",
        name: symbol.name,
        externLanguage: symbol.externLanguage,
        export: symbol.export,
        mutable: symbol.mutable,
        type: type,
        memberOf: meta?.newMemberOf,
        concrete: type.concrete,
        sourceloc: symbol.sourceloc,
        variableContext: symbol.variableContext,
      } satisfies Semantic.Symbol as T;
    }

    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
    // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

    case "GenericParameter": {
      const mappedTo = genericContext.mapping.get(symbol);
      if (mappedTo) {
        if (mappedTo === symbol) {
          throw new InternalError("Generic Mapping is circular - Parameter points to itself");
        }
        return instantiateSymbol(sr, mappedTo, genericContext) as T;
      } else {
        return symbol;
      }
    }

    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
    // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

    case "FunctionDeclaration": {
      const type = instantiateSymbol(sr, symbol.type, genericContext);
      return {
        variant: "FunctionDeclaration",
        export: symbol.export,
        sourceloc: symbol.sourceloc,
        externLanguage: symbol.externLanguage,
        methodType: symbol.methodType,
        name: symbol.name,
        type: type,
        nestedParentTypeSymbol: meta?.newMemberOf,
        concrete: type.concrete,
      } satisfies Semantic.Symbol as T;
    }

    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
    // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

    case "FunctionDefinition": {
      const funcTypeSym = instantiateSymbol(sr, symbol.type, genericContext);

      const scope: Semantic.BlockScope | undefined = undefined;
      if (funcTypeSym.concrete) {
        if (symbol.methodOf && !symbol.scope) {
          const struct = symbol.methodOf;
          assert(struct.variant === "StructDatatype");
          assert(symbol.collectedScope);

          const scope = new Semantic.BlockScope(
            symbol.sourceloc,
            symbol.collectedScope.rawStatements,
          );
          defineThisReference(sr, scope, struct, genericContext);
          elaborateScope(sr, scope, genericContext);
        }
      }

      return {
        variant: "FunctionDefinition",
        export: symbol.export,
        sourceloc: symbol.sourceloc,
        externLanguage: symbol.externLanguage,
        methodType: symbol.methodType,
        name: symbol.name,
        type: funcTypeSym,
        scope: scope,
        methodOf: meta?.newMemberOf,
        nestedParentTypeSymbol: meta?.newMemberOf,
        concrete: funcTypeSym.concrete,
      } satisfies Semantic.Symbol as T;
    }

    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
    // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

    case "FunctionDatatype": {
      const dt: Semantic.FunctionDatatypeSymbol = {
        variant: "FunctionDatatype",
        vararg: symbol.vararg,
        functionParameters: symbol.functionParameters.map((p) => ({
          name: p.name,
          type: instantiateSymbol(sr, p.type, genericContext),
        })),
        functionReturnValue: instantiateSymbol(sr, symbol.functionReturnValue, genericContext),
        generics: [],
        concrete: false,
      };
      dt.concrete =
        dt.functionReturnValue.concrete && dt.functionParameters.every((p) => p.type.concrete);
      return dt as T;
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
      const key: Semantic.DatatypeDoneMapKey = {
        symbol: symbol,
        generics: symbol.genericSymbols.map((g) => instantiateSymbol(sr, g, genericContext)),
      };

      if (genericContext.datatypesDone.has(key)) {
        return genericContext.datatypesDone.get(key) as T;
      }

      const struct: Semantic.StructDatatypeSymbol = {
        variant: "StructDatatype",
        name: symbol.name,
        genericSymbols: symbol.genericSymbols.map((g) => instantiateSymbol(sr, g, genericContext)),
        externLanguage: symbol.externLanguage,
        definedInNamespaceOrStruct: symbol.definedInNamespaceOrStruct,
        members: [],
        methods: [],
        fullNamespacedName: symbol.fullNamespacedName,
        namespaces: symbol.namespaces,
        collectedDeclaration: symbol.collectedDeclaration,
        scope: new Semantic.DeclScope(symbol.sourceloc, symbol.definedInNamespaceOrStruct?.scope),
        sourceloc: symbol.sourceloc,
        concrete: true,
      };
      if (struct.concrete) {
        genericContext.datatypesDone.set(key, struct);
      }
      assert(struct.variant === "StructDatatype");

      struct.members = symbol.members.map((m) => {
        const sym = instantiateSymbol(sr, m, genericContext, {
          newMemberOf: struct,
        });
        if (!sym.concrete) struct.concrete = false;
        return sym;
      });

      struct.methods = symbol.methods.map((m) => {
        const sym = instantiateSymbol(sr, m, genericContext, {
          newMemberOf: struct,
        });
        if (!sym.concrete) struct.concrete = false;
        return sym;
      });

      return struct as T;
    }

    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
    // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

    case "RawPointerDatatype": {
      const pointee = instantiateSymbol(sr, symbol.pointee, genericContext);
      return {
        variant: "RawPointerDatatype",
        pointee: pointee,
        concrete: pointee.concrete,
      } satisfies Semantic.Symbol as T;
    }

    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
    // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

    case "ReferenceDatatype": {
      const referee = instantiateSymbol(sr, symbol.referee, genericContext);
      return {
        variant: "ReferenceDatatype",
        referee: referee,
        concrete: referee.concrete,
      } satisfies Semantic.Symbol as T;
    }

    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
    // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
    // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

    default:
      throw new InternalError("Unhandled variant");
  }
}
