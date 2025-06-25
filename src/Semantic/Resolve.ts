import { logger } from "../log/log";
import { type ASTDatatype } from "../shared/AST";
import { assertID, stringToPrimitive } from "../shared/common";
import { assert, CompilerError, ImpossibleSituation, InternalError } from "../shared/Errors";
import type { Collect } from "../SymbolCollection/CollectSymbols";
import { elaborate } from "./Elaborate";
import { instantiateSymbol } from "./Instantiate";
import { Semantic, type SemanticResult } from "./SemanticSymbols";

export function resolveDatatype(
  sr: SemanticResult,
  datatype: ASTDatatype,
  scope: Semantic.DeclScope | Semantic.BlockScope,
  collectScope: Collect.Scope,
  genericContext: Semantic.GenericContext | null,
): Semantic.DatatypeSymbol {
  logger.trace("resolveDatatype()");
  if (!genericContext) {
    genericContext = {
      mapping: new Map(),
      datatypesDone: new Map(),
    };
  }

  switch (datatype.variant) {
    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "Deferred": {
      return {
        variant: "DeferredDatatype",
        concrete: false,
      };
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
          type: resolved,
        };
      });
      return {
        variant: "FunctionDatatype",
        vararg: datatype.ellipsis,
        functionReturnValue: returnValue,
        functionParameters: parameters,
        generics: [],
        concrete: returnValue.concrete && paramsConcrete,
      };
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "RawPointerDatatype": {
      const type = resolveDatatype(sr, scope, datatype.pointee, genericContext);
      return {
        variant: "RawPointerDatatype",
        pointee: type,
        concrete: type.concrete,
      };
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ReferenceDatatype": {
      const type = resolveDatatype(sr, scope, datatype.referee, genericContext);
      return {
        variant: "ReferenceDatatype",
        referee: type,
        concrete: type.concrete,
      };
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
        return sr.globalScope.makePrimitiveAvailable(primitive);
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

        return {
          variant: "CallableDatatype",
          functionType: functype,
          thisExprType: undefined,
          concrete: functype.concrete,
        };
      }

      const found = scope.symbolTable.lookupSymbol(datatype.name, datatype.sourceloc);
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
          const struct = instantiateSymbol(sr, elaborate(sr, found, collectScope, genericContext), genericContext);
          assert(struct.variant === "StructDatatype");

          if (struct.genericSymbols.length !== datatype.generics.length) {
            throw new CompilerError(
              `Type ${found.name} expects ${found.genericSymbols.length} generics but received ${datatype.generics.length}`,
              datatype.sourceloc,
            );
          }

          const newGenericContext: Semantic.GenericContext = {
            mapping: new Map(genericContext.mapping),
            currentStructOrNamespace: genericContext.currentStructOrNamespace,
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
              const to = resolveDatatype(sr, scope, g, genericContext);
              newGenericContext.mapping.set(from, to);
            }
          }

          const dt = instantiateSymbol(sr, struct, newGenericContext);
          return dt;
        }

        // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
        // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
        // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

        case "Namespace":
          if (datatype.nested) {
            return resolveDatatype(sr, scope, datatype.nested, genericContext);
          }
          throw new CompilerError(
            `Namespace cannot be used as a datatype here`,
            datatype.sourceloc,
          );

        // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
        // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
        // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

        case "GenericParameter": {
          return {
            variant: "GenericParameter",
            name: found.name,
            sourceloc: found.sourceloc,
            concrete: false,
          } satisfies Semantic.DatatypeSymbol;
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
