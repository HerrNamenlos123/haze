// import type { EExternLanguage } from "../shared/AST";
// import type { Brand, EMethodType } from "../shared/common";
// import { assert, type SourceLoc } from "../shared/Errors";
// import { Collect, type CollectionContext } from "./SymbolCollection";

// export namespace ImpExp {
//   export type Id = Brand<number, "ImpExp">;
//   export const enum ENode {
//     ExportScope,
//     FunctionOverloadGroup,
//     FunctionSymbol,
//     FunctionScope,
//     StructScope,
//     NamespaceScope,
//     BlockScope,
//     NamedDatatype,
//     ReferenceDatatype,
//     PointerDatatype,
//     FunctionDatatype,
//     NamespaceDefinitionSymbol,
//     NamespaceSharedInstance,
//     StructDefinitionSymbol,
//     GenericTypeParameter,
//   }

//   /// ===============================================================
//   /// ===                         Scopes                          ===
//   /// ===============================================================

//   export type ExportScope = {
//     variant: ENode.ExportScope;
//     symbols: Id[];
//   };

//   export type FunctionScope = {
//     variant: ENode.FunctionScope;
//     parentScope: Id;
//     owningSymbol: Id;
//     sourceloc: SourceLoc;
//     blockScope: Id;
//     symbols: Id[];
//   };

//   export type StructScope = {
//     variant: ENode.StructScope;
//     parentScope: Id;
//     owningSymbol: Id;
//     sourceloc: SourceLoc;
//     symbols: Id[];
//   };

//   export type NamespaceScope = {
//     variant: ENode.NamespaceScope;
//     parentScope: Id;
//     owningSymbol: Id;
//     sourceloc: SourceLoc;
//     symbols: Id[];
//   };

//   export type BlockScope = {
//     variant: ENode.BlockScope;
//     parentScope: Id;
//     owningSymbol: Id;
//     sourceloc: SourceLoc;
//     statements: Id[];
//     symbols: Id[];
//   };

//   export type Scope = ExportScope | FunctionScope | StructScope | NamespaceScope | BlockScope;

//   /// ===============================================================
//   /// ===                       Overloads                         ===
//   /// ===============================================================

//   export type FunctionOverloadGroup = {
//     variant: ENode.FunctionOverloadGroup;
//     parentScope: Id;
//     name: string;
//     overloads: Id[];
//   };

//   export type Overloads = FunctionOverloadGroup;

//   /// ===============================================================
//   /// ===                          Symbols                        ===
//   /// ===============================================================

//   export type FunctionSymbol = {
//     variant: ENode.FunctionSymbol;
//     parentScope: Id;
//     overloadGroup: Id;
//     generics: Id[];
//     returnType: Id;
//     parameters: {
//       name: string;
//       type: Id;
//       sourceloc: SourceLoc;
//     }[];
//     vararg: boolean;
//     export: boolean;
//     pub: boolean;
//     noemit: boolean;
//     methodType: EMethodType;
//     extern: EExternLanguage;
//     sourceloc: SourceLoc;
//     functionScope: Id | null;
//   };

//   export type Symbols = FunctionSymbol;

//   /// ===============================================================
//   /// ===                       Type Symbols                      ===
//   /// ===============================================================

//   export type NamedDatatype = {
//     variant: ENode.NamedDatatype;
//     name: string;
//     innerNested: Id | null;
//     genericArgs: Id[];
//     sourceloc: SourceLoc;
//   };

//   export type FunctionDatatype = {
//     variant: ENode.FunctionDatatype;
//     parameters: Id[];
//     returnType: Id;
//     vararg: boolean;
//     sourceloc: SourceLoc;
//   };

//   export type PointerDatatype = {
//     variant: ENode.PointerDatatype;
//     pointee: Id;
//     sourceloc: SourceLoc;
//   };

//   export type ReferenceDatatype = {
//     variant: ENode.ReferenceDatatype;
//     referee: Id;
//     sourceloc: SourceLoc;
//   };

//   export type StructDefinitionSymbol = {
//     variant: ENode.StructDefinitionSymbol;
//     parentScope: Id;
//     generics: Id[];
//     name: string;
//     export: boolean;
//     pub: boolean;
//     extern: EExternLanguage;
//     noemit: boolean;
//     sourceloc: SourceLoc;
//     structScope: Id;
//   };

//   export type NamespaceSharedInstance = {
//     variant: ENode.NamespaceSharedInstance;
//     fullyQualifiedName: string;
//     namespaceScopes: Id[];
//   };

//   export type NamespaceDefinitionSymbol = {
//     variant: ENode.NamespaceDefinitionSymbol;
//     parentScope: Id;
//     fullyQualifiedName: string;
//     name: string;
//     extern: EExternLanguage;
//     pub: boolean;
//     export: boolean;
//     sharedInstance: Id;
//     sourceloc: SourceLoc;
//     namespaceScope: Id;
//   };

//   export type GenericTypeParameter = {
//     variant: ENode.GenericTypeParameter;
//     name: string;
//     owningSymbol: Id;
//     sourceloc: SourceLoc;
//   };

//   export type Datatypes =
//     | NamedDatatype
//     | FunctionDatatype
//     | PointerDatatype
//     | ReferenceDatatype
//     | StructDefinitionSymbol
//     | NamespaceDefinitionSymbol
//     | NamespaceSharedInstance
//     | GenericTypeParameter;

//   export type Node = Scope | Overloads | FunctionSymbol | Datatypes;
// }

// function addNode<T extends ImpExp.Node>(cc: CollectionContext, node: T): [T, ImpExp.Id] {
//   const id = cc.exportedSymbols.nodes.length as ImpExp.Id;
//   cc.exportedSymbols.nodes.push(node);
//   return [cc.exportedSymbols.nodes[id] as T, id];
// }

// function getExportScope(cc: CollectionContext) {
//   if (cc.exportedSymbols.nodes.length === 0) {
//     const [scope, id] = addNode<ImpExp.ExportScope>(cc, {
//       variant: ImpExp.ENode.ExportScope,
//       symbols: [],
//     });
//     return id;
//   }

//   const filescope = cc.exportedSymbols.nodes[0];
//   assert(filescope.variant === ImpExp.ENode.ExportScope);
//   return 0 as ImpExp.Id;
// }

// function makeFunctionOverloadGroup(cc: CollectionContext, name: string) {
//   for (let i = 0; i < cc.exportedSymbols.nodes.length; i++) {
//     const node = cc.exportedSymbols.nodes[i];
//     if (node.variant === ImpExp.ENode.FunctionOverloadGroup && node.name === name) {
//       return [node, i as ImpExp.Id] as const;
//     }
//   }

//   return addNode<ImpExp.FunctionOverloadGroup>(cc, {
//     variant: ImpExp.ENode.FunctionOverloadGroup,
//     name: name,
//     overloads: [],
//     parentScope: getExportScope(cc),
//   });
// }

// function exportFunctionSymbol(
//   cc: CollectionContext,
//   symbol: Collect.FunctionSymbol,
//   parentScope: ImpExp.Id,
//   overloadGroup: ImpExp.Id
// ) {
//   const [functionSymbol, functionSymbolId] = addNode<ImpExp.FunctionSymbol>(cc, {
//     variant: ImpExp.ENode.FunctionSymbol,
//     export: symbol.export,
//     extern: symbol.extern,
//     functionScope: -1 as Collect.Id,
//     generics: symbol.generics.map((g) => ExportCollectedSymbol(cc, g)),
//     methodType: symbol.methodType,
//     noemit: symbol.noemit,
//     overloadGroup: overloadGroup,
//     parameters: symbol.parameters.map((p) => ({
//       name: p.name,
//       sourceloc: p.sourceloc,
//       type: ExportCollectedSymbol(cc, p.type),
//     })),
//     parentScope: parentScope,
//     pub: symbol.pub,
//     returnType: ExportCollectedSymbol(cc, symbol.returnType),
//     sourceloc: symbol.sourceloc,
//     vararg: symbol.vararg,
//   });
//   const [functionScope, functionScopeId] = addNode<ImpExp.FunctionScope>(cc, {
//     variant: ImpExp.ENode.FunctionScope,
//     blockScope: -1 as ImpExp.Id,
//     owningSymbol: functionSymbolId,
//     parentScope: parentScope,
//     sourceloc: symbol.sourceloc,
//     symbols: [],
//   });
//   functionSymbol.functionScope = functionScopeId;
//   return [functionSymbol, functionSymbolId] as const;
// }

// export function ExportCollectedSymbol(cc: CollectionContext, symbolId: Collect.Id): ImpExp.Id {
//   if (cc.exportCache.has(symbolId)) {
//     return cc.exportCache.get(symbolId)!;
//   }

//   const symbol = cc.nodes.get(symbolId);
//   switch (symbol.variant) {
//     case Collect.ENode.FunctionSymbol: {
//       const internalOverloadGroup = cc.nodes.get(symbol.overloadGroup);
//       assert(internalOverloadGroup.variant === Collect.ENode.FunctionOverloadGroup);
//       const [overloadGroup, overloadGroupId] = makeFunctionOverloadGroup(
//         cc,
//         internalOverloadGroup.name
//       );

//       const [functionSymbol, functionSymbolId] = exportFunctionSymbol(
//         cc,
//         symbol,
//         getExportScope(cc),
//         overloadGroupId
//       );
//       return functionSymbolId;
//     }

//     case Collect.ENode.NamedDatatype: {
//       return;
//     }

//     case Collect.ENode.GenericTypeParameter: {
//       return addNode(cc, {
//         variant: ImpExp.ENode.GenericTypeParameter,
//         name: symbol.name,
//         sourceloc: symbol.sourceloc,
//         owningSymbol: ExportCollectedSymbol(cc, symbol.owningSymbol),
//       })[1];
//     }

//     default:
//       assert(false, "" + symbol.variant);
//   }
// }
