import { EExternLanguage, type ASTDatatype } from "../shared/AST";
import { assertID, assertScope, stringToPrimitive } from "../shared/common";
import { CompilerError, ImpossibleSituation, InternalError } from "../shared/Errors";
import type { ID } from "../shared/store";
import type { Collect } from "../SymbolCollection/CollectSymbols";
import { elaborate } from "./Elaborate";
import { instantiateDatatype } from "./Instantiate";
import type { Semantic, SemanticResult } from "./SemanticSymbols";

export function resolveSymbol(
  sr: SemanticResult,
  scope: Collect.Scope,
  datatype: ASTDatatype,
  _genericContext?: Semantic.GenericContext,
): Semantic.Symbol & { id: ID } {
  const genericContext: Semantic.GenericContext = _genericContext || {
    symbolToSymbol: new Map<ID, ID>(),
  };

  switch (datatype.variant) {
    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "Deferred": {
      const dt = sr.typeTable.makeDatatypeAvailable({
        variant: "Deferred",
      });
      return sr.symbolTable.makeDatatypeSymbolAvailable(dt.id);
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "FunctionDatatype": {
      const dt = sr.typeTable.makeDatatypeAvailable({
        variant: "Function",
        vararg: datatype.ellipsis,
        functionReturnValue: resolveSymbol(sr, scope, datatype.returnType, genericContext).id,
        functionParameters: datatype.params.map(
          (p) => resolveSymbol(sr, scope, p.datatype, genericContext).id,
        ),
        generics: [],
      });
      return sr.symbolTable.makeDatatypeSymbolAvailable(dt.id);
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "NamedDatatype":
      const primitive = stringToPrimitive(datatype.name);
      if (primitive) {
        if (datatype.generics.length > 0) {
          throw new Error(`Type ${datatype.name} is not generic`);
        }
        return sr.symbolTable.makeDatatypeSymbolAvailable(
          sr.typeTable.makePrimitiveDatatypeAvailable(primitive).id,
        );
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

      switch (found.variant) {
        // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
        // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
        // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

        case "StructDefinition": {
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

          if (found.generics.length > 0) {
            for (let i = 0; i < found.generics.length; i++) {
              const g = datatype.generics[i];
              if (
                g.variant === "NumberConstant" ||
                g.variant === "StringConstant" ||
                g.variant === "BooleanConstant"
              ) {
                throw new InternalError("Constants not implemented in generics");
              }

              genericContext.symbolToSymbol.set(
                generics[i],
                resolveSymbol(sr, assertScope(datatype._collect.usedInScope), g, genericContext).id,
              );
            }
          }

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

          const structSym = sr.symbolTable.makeSymbolAvailable({
            variant: "Datatype",
            export: false,
            type: struct.id,
          });

          // Add members
          struct.members = found.members.map((m) => {
            return sr.symbolTable.makeSymbolAvailable({
              variant: "Variable",
              name: m.name,
              externLanguage: EExternLanguage.None,
              export: false,
              mutable: true,
              definedInCollectorScope: found._collect.scope!.id,
              sourceLoc: m.sourceloc,
              typeSymbol: resolveSymbol(sr, found._collect.scope!, m.type, genericContext).id,
              memberOfType: struct.id,
            }).id;
          });

          // Add methods
          struct.methods = found.methods
            .map((m) => {
              m._semantic.memberOfSymbol = structSym.id;
              return elaborate(sr, m);
            })
            .filter(Boolean)
            .map((m) => m!);

          const dt = instantiateDatatype(sr, struct.id, genericContext);
          const sym = sr.symbolTable.makeSymbolAvailable({
            variant: "Datatype",
            export: false,
            type: dt.id,
          });
          return sym;
        }

        // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
        // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
        // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

        case "NamespaceDefinition":
          if (datatype.nested) {
            return resolveSymbol(sr, found._collect.scope!, datatype.nested, genericContext);
          }
          throw new CompilerError(
            `Namespace cannot be used as a datatype here`,
            datatype.sourceloc,
          );

        // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
        // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
        // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

        case "GenericPlaceholder": {
          if (found.belongsToSymbol.variant !== "StructDefinition") {
            throw new ImpossibleSituation();
          }
          const structId = assertID(found.belongsToSymbol._semantic.type);
          const struct = sr.typeTable.get(structId) as Semantic.StructDatatype;

          const id = sr.symbolTable.makeSymbolAvailable({
            variant: "GenericParameter",
            name: found.name,
            belongsToStruct: struct.fullNamespacedName,
            sourceloc: found.sourceloc,
          });
          return id;
        }

        // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
        // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
        // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

        default:
          throw new CompilerError(
            `Symbol '${datatype.name}' cannot be used as a datatype here`,
            datatype.sourceloc,
          );
      }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    default:
      throw new ImpossibleSituation();
  }
}
