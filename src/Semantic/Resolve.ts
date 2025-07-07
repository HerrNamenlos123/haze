import { EExternLanguage, type ASTConstant, type ASTDatatype } from "../shared/AST";
import { assertScope, EMethodType, EPrimitive, EVariableContext, stringToPrimitive } from "../shared/common";
import { assert, CompilerError, ImpossibleSituation } from "../shared/Errors";
import { Collect } from "../SymbolCollection/CollectSymbols";
import { elaborateBlockScope, elaborateBodies, elaborateSignature, inheritElaborationContext, type ElaborationContext } from "./Elaborate";
import { isDatatypeSymbol, Semantic, type SemanticResult } from "./SemanticSymbols";

export function makeFunctionDatatypeAvailable(parameters: Semantic.DatatypeSymbol[], returnType: Semantic.DatatypeSymbol, vararg: boolean, context: ElaborationContext): Semantic.FunctionDatatypeSymbol {
  for (const type of context.global.functionTypeCache) {
    if (type.parameters.length !== parameters.length) {
      continue;
    }
    let wrong = false;
    for (let i = 0; i < parameters.length; i++) {
      if (type.parameters[i] !== parameters[i]) {
        wrong = true;
        break;
      }
    }
    if (wrong) continue;
    if (type.returnType !== returnType) {
      continue;
    }
    if (type.vararg !== vararg) continue;

    // Everything matches
    return type;
  }

  // Nothing found
  const ftype: Semantic.FunctionDatatypeSymbol = {
    variant: "FunctionDatatype",
    parameters: parameters,
    returnType: returnType,
    vararg: vararg,
    concrete: parameters.every((p) => p.concrete) && returnType.concrete,
  };
  context.global.functionTypeCache.push(ftype);
  return ftype;
}

export function makeRawPointerDatatypeAvailable(pointee: Semantic.DatatypeSymbol, context: ElaborationContext): Semantic.RawPointerDatatypeSymbol {
  for (const type of context.global.rawPointerTypeCache) {
    if (type.pointee !== pointee) {
      continue;
    }
    return type;
  }

  // Nothing found
  const type: Semantic.RawPointerDatatypeSymbol = {
    variant: "RawPointerDatatype",
    pointee: pointee,
    concrete: pointee.concrete,
  };
  context.global.rawPointerTypeCache.push(type);
  return type;
}

export function makeReferenceDatatypeAvailable(referee: Semantic.DatatypeSymbol, context: ElaborationContext): Semantic.ReferenceDatatypeSymbol {
  for (const type of context.global.referenceTypeCache) {
    if (type.referee !== referee) {
      continue;
    }
    return type;
  }

  // Nothing found
  const type: Semantic.ReferenceDatatypeSymbol = {
    variant: "ReferenceDatatype",
    referee: referee,
    concrete: referee.concrete,
  };
  context.global.referenceTypeCache.push(type);
  return type;
}

export function resolveDatatype(
  sr: SemanticResult,
  rawAstDatatype: ASTDatatype | ASTConstant,
  rawAstScope: Collect.Scope,
  context: ElaborationContext,
): Semantic.DatatypeSymbol {
  switch (rawAstDatatype.variant) {
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
      const parameters = rawAstDatatype.params.map((p) =>
        resolveDatatype(sr, p.datatype, rawAstScope, context),
      );
      const returnValue = resolveDatatype(sr, rawAstDatatype.returnType, rawAstScope, context);
      return makeFunctionDatatypeAvailable(parameters, returnValue, rawAstDatatype.ellipsis, context);
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "RawPointerDatatype": {
      const pointee = resolveDatatype(sr, rawAstDatatype.pointee, rawAstScope, context);
      return makeRawPointerDatatypeAvailable(pointee, context);
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ReferenceDatatype": {
      const referee = resolveDatatype(sr, rawAstDatatype.referee, rawAstScope, context);
      return makeReferenceDatatypeAvailable(referee, context);
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "NamedDatatype":
      const primitive = stringToPrimitive(rawAstDatatype.name);
      if (primitive) {
        if (rawAstDatatype.generics.length > 0) {
          throw new Error(`Type ${rawAstDatatype.name} is not generic`);
        }
        return sr.globalNamespace.scope.makePrimitiveAvailable(primitive);
      }

      if (rawAstDatatype.name === "Callable") {
        if (rawAstDatatype.generics.length != 1) {
          throw new CompilerError(
            `Type Callable<> must take exactly 1 type parameter`,
            rawAstDatatype.sourceloc,
          );
        }
        if (rawAstDatatype.generics[0].variant !== "FunctionDatatype") {
          throw new CompilerError(
            `Type Callable<> must take a function datatype as the generic argument`,
            rawAstDatatype.sourceloc,
          );
        }
        const functype = resolveDatatype(sr, rawAstDatatype.generics[0], rawAstScope, context);
        assert(functype.variant === "FunctionDatatype");
        return {
          variant: "CallableDatatype",
          functionType: functype,
          thisExprType: undefined,
          concrete: functype.concrete,
        };
      }

      const found = rawAstScope.symbolTable.lookupSymbol(rawAstDatatype.name, rawAstDatatype.sourceloc);
      if (!found) {
        throw new CompilerError(
          `${rawAstDatatype.name} was not declared in this scope`,
          rawAstDatatype.sourceloc,
        );
      }

      switch (found.variant) {
        // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
        // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
        // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

        case "StructDefinition": {

          // This part resolves a struct datatype. It resolves all its generics.
          // If it was already done, skips. Then struct is created and stored, so members can reach it.
          // Then members and methods are added, if it is concrete.

          const generics = rawAstDatatype.generics.map((g) => resolveDatatype(sr, g, rawAstScope, context));

          for (const s of context.global.elaboratedStructDatatypes) {
            if (s.generics.length === generics.length && s.generics.every((g, index) => g === generics[index]) && s.originalSymbol === found) {
              return s.resultSymbol;
            }
          }

          if (found.generics.length !== generics.length) {
            throw new CompilerError(
              `Type ${found.name} expects ${found.generics.length} type parameters but got ${rawAstDatatype.generics.length}`,
              rawAstDatatype.sourceloc,
            );
          }

          const newContext = inheritElaborationContext(context);
          for (let i = 0; i < found.generics.length; i++) {
            newContext.local.substitute.set(found.generics[i], generics[i]);
          }

          const struct: Semantic.StructDatatypeSymbol = {
            variant: "StructDatatype",
            name: found.name,
            generics: generics,
            externLanguage: found.externLanguage,
            parent: context.global.currentNamespace,
            members: [],
            methods: [],
            rawAst: found,
            scope: new Semantic.DeclScope(found.sourceloc, assertScope(found._collect.scope), context.global.currentNamespace.scope),
            sourceloc: found.sourceloc,
            concrete: generics.every((g) => g.concrete),
          };

          if (struct.concrete) {
            context.global.elaboratedStructDatatypes.push({
              generics: generics,
              originalSymbol: found,
              resultSymbol: struct
            })

            struct.members = found.members.map((m) => {
              const type = resolveDatatype(sr, m.type, assertScope(found._collect.scope), newContext);
              return {
                variant: "Variable",
                name: m.name,
                export: false,
                externLanguage: EExternLanguage.None,
                mutable: true,
                sourceloc: m.sourceloc,
                type: type,
                variableContext: EVariableContext.MemberOfStruct,
                memberOf: struct,
                concrete: type.concrete,
              }
            });

            struct.methods = found.methods.map((m) => {
              const parameters = m.params.map((p) => resolveDatatype(sr, p.datatype, assertScope(found._collect.scope), newContext));
              assert(m.returnType);
              const returnType = resolveDatatype(sr, m.returnType, assertScope(found._collect.scope), newContext);
              const ftype = makeFunctionDatatypeAvailable(parameters, returnType, m.ellipsis, newContext);

              let methodType = EMethodType.NotAMethod;
              if (m.name === "drop") {
                methodType = EMethodType.Drop
              }

              assert(m.funcbody._collect.scope);
              const symbol = elaborateSignature(sr, m, m.funcbody._collect.scope, inheritElaborationContext(newContext, struct));
              assert(symbol && symbol.variant === "FunctionDefinition");
              elaborateBodies(sr, symbol, newContext);

              return symbol;
            });

            // Add drop function
            if (struct.methods.every((m) => m.name !== "drop")) {
              const dropType: Semantic.FunctionDatatypeSymbol = {
                variant: "FunctionDatatype",
                concrete: struct.concrete,
                parameters: [],
                returnType: sr.globalNamespace.scope.makePrimitiveAvailable(EPrimitive.none),
                vararg: false,
              };
              const drop: Semantic.FunctionDefinitionSymbol = {
                variant: "FunctionDefinition",
                export: false,
                concrete: struct.concrete,
                externLanguage: EExternLanguage.None,
                methodType: EMethodType.Drop,
                name: "drop",
                scope: new Semantic.BlockScope(struct.sourceloc, new Collect.Scope(struct.sourceloc, struct.scope.collectedScope)),
                type: dropType,
                methodOf: struct,
                parent: struct,
                sourceloc: struct.sourceloc,
              };
              struct.methods.push(drop);
            }

            sr.monomorphizedSymbols.push(struct);
          }

          return struct;
        }

        // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
        // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
        // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

        case "NamespaceDefinition":
          if (rawAstDatatype.nested) {
            return resolveDatatype(sr, rawAstDatatype.nested, rawAstScope, context);
          }
          throw new CompilerError(
            `Namespace cannot be used as a datatype here`,
            rawAstDatatype.sourceloc,
          );

        // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
        // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
        // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

        case "GenericParameter": {
          const mappedTo = context.local.substitute.get(found);
          if (mappedTo) {
            assert(isDatatypeSymbol(mappedTo));
            return mappedTo;
          } else {
            return {
              variant: "GenericParameterDatatype",
              name: found.name,
              concrete: false,
            };
          }
        }

        // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
        // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
        // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

        default:
          throw new CompilerError(
            `Symbol '${rawAstDatatype.name}' cannot be used as a datatype here`,
            rawAstDatatype.sourceloc,
          );
      }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    default:
      throw new ImpossibleSituation();
  }
}
