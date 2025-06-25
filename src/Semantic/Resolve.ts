import { logger } from "../log/log";
import { type ASTDatatype } from "../shared/AST";
import { assertID, assertScope, stringToPrimitive } from "../shared/common";
import { assert, CompilerError, ImpossibleSituation, InternalError } from "../shared/Errors";
import type { Collect } from "../SymbolCollection/CollectSymbols";
import { elaborate, PrettyPrintAnalyzed } from "./Elaborate";
import { instantiateSymbol } from "./Instantiate";
import { getSymbol, type Semantic, type SemanticResult } from "./SemanticSymbols";

export function resolveDatatype(
  sr: SemanticResult,
  scope: Collect.Scope,
  datatype: ASTDatatype,
  genericContext: Semantic.GenericContext | null,
): Semantic.Symbol {
  logger.trace("resolveDatatype()");
  if (!genericContext) {
    genericContext = {
      symbolToSymbol: new Map(),
      elaborateCurrentStructOrNamespace: null,
      datatypesDone: new Map(),
    };
  }

  switch (datatype.variant) {
    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "Deferred": {
      const dt = sr.symbolTable.makeSymbolAvailable({
        variant: "DeferredDatatype",
        concrete: false,
      });
      return dt;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "FunctionDatatype": {
      const returnValue = resolveDatatype(sr, scope, datatype.returnType, genericContext);
      let paramsConcrete = true;
      const parameters = datatype.params.map((p) => {
        const resolved = resolveDatatype(sr, scope, p.datatype, genericContext);
        if (!resolved.concrete) paramsConcrete = false;
        return {
          name: p.name,
          type: resolved.id,
        };
      });
      const dt = sr.symbolTable.makeSymbolAvailable({
        variant: "FunctionDatatype",
        vararg: datatype.ellipsis,
        functionReturnValue: returnValue.id,
        functionParameters: parameters,
        generics: [],
        concrete: returnValue.concrete && paramsConcrete,
      });
      return dt;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "RawPointerDatatype": {
      const type = resolveDatatype(sr, scope, datatype.pointee, genericContext);
      const dt = sr.symbolTable.makeSymbolAvailable({
        variant: "RawPointerDatatype",
        pointee: type.id,
        concrete: type.concrete,
      });
      return dt;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ReferenceDatatype": {
      const type = resolveDatatype(sr, scope, datatype.referee, genericContext);
      const dt = sr.symbolTable.makeSymbolAvailable({
        variant: "ReferenceDatatype",
        referee: type.id,
        concrete: type.concrete,
      });
      return dt;
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
        return sr.symbolTable.makePrimitiveAvailable(primitive);
      }

      if (datatype.name === "Callable") {
        if (datatype.generics.length != 1) {
          throw new CompilerError(
            `Type Callable<> must take exactly 1 generic argument`,
            datatype.sourceloc,
          );
        }
        if (datatype.generics[0].variant !== "FunctionDatatype") {
          throw new CompilerError(
            `Type Callable<> must take a function datatype as the generic argument`,
            datatype.sourceloc,
          );
        }
        const functype = resolveDatatype(sr, scope, datatype.generics[0], genericContext);
        assert(functype.variant === "FunctionDatatype");

        const sym = sr.symbolTable.makeSymbolAvailable({
          variant: "CallableDatatype",
          functionType: functype.id,
          thisExprType: undefined,
          concrete: functype.concrete,
        });
        return sym;
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
          const struct = getSymbol(sr, elaborate(sr, found, null)!);
          assert(struct.variant === "StructDatatype");

          if (struct.genericSymbols.length !== datatype.generics.length) {
            throw new CompilerError(
              `Type ${found.name} expects ${found.generics.length} generics but received ${datatype.generics.length}`,
              datatype.sourceloc,
            );
          }

          const newGenericContext: Semantic.GenericContext = {
            symbolToSymbol: new Map(genericContext.symbolToSymbol),
            elaborateCurrentStructOrNamespace: genericContext.elaborateCurrentStructOrNamespace,
            datatypesDone: new Map(genericContext.datatypesDone),
          };

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

              const from = struct.genericSymbols[i];
              const to = resolveDatatype(
                sr,
                assertScope(datatype._collect.usedInScope),
                g,
                genericContext,
              ).id;
              newGenericContext.symbolToSymbol.set(from, to);
              logger.debug(`Mapping generic parameter from ${from} to ${to}`);
            }
          }

          const dt = instantiateSymbol(sr, struct.id, newGenericContext);
          return dt;
        }

        // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
        // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
        // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

        case "NamespaceDefinition":
          if (datatype.nested) {
            return resolveDatatype(sr, found._collect.scope!, datatype.nested, genericContext);
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
          const struct = sr.symbolTable.get(assertID(found.belongsToSymbol._semantic.symbol));
          assert(struct.variant === "StructDatatype");

          const id = sr.symbolTable.makeSymbolAvailable({
            variant: "GenericParameter",
            name: found.name,
            belongsToStruct: struct.fullNamespacedName,
            sourceloc: found.sourceloc,
            concrete: false,
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
