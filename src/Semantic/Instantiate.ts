// import { assert } from "../shared/Errors";
// import { defineThisReference, elaborateBlockScope } from "./Elaborate";
// import { Semantic, type SemanticResult } from "./SemanticSymbols";

// function instantiateSymbol<T extends Semantic.Symbol>(
//   sr: SemanticResult,
//   symbol: T,
//   genericContext: Semantic.GenericContext,
//   meta?: {
//     newMemberOf?: Semantic.StructDatatypeSymbol;
//   },
// ): T {
//   switch (symbol.variant) {
//     // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈
//     // ◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆
//     // ◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈◇◈

//     case "FunctionDefinition": {
//       const funcTypeSym = instantiateSymbol(sr, symbol.type, genericContext);

//       const scope: Semantic.BlockScope | undefined = undefined;
//       if (funcTypeSym.concrete) {
//         if (symbol.methodOf && !symbol.scope) {
//           const struct = symbol.methodOf;
//           assert(struct.variant === "StructDatatype");
//           assert(symbol.collectedScope);

//           const scope = new Semantic.BlockScope(symbol.sourceloc, symbol.collectedScope);
//           defineThisReference(sr, scope, struct, genericContext);
//           elaborateBlockScope(sr, scope, genericContext);
//         }
//       }

//       return {
//         variant: "FunctionDefinition",
//         export: symbol.export,
//         sourceloc: symbol.sourceloc,
//         externLanguage: symbol.externLanguage,
//         methodType: symbol.methodType,
//         name: symbol.name,
//         type: funcTypeSym,
//         scope: scope,
//         methodOf: meta?.newMemberOf,
//         parent: meta?.newMemberOf,
//         concrete: funcTypeSym.concrete,
//       } satisfies Semantic.Symbol as T;
//     }
//   }
// }
