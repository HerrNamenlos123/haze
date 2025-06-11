// import type {
//   BaseStructDatatype,
//   ConcreteStructDatatype,
//   Datatype,
//   FunctionDatatype,
// } from "./Datatype";
// import { ImpossibleSituation } from "./Errors";
// import type { Module } from "./Module";
// import type { Scope } from "./Scope";
// import type { DatatypeSymbol, FunctionSymbol } from "./Symbol";

// export function generateGraphviz(program: Module): string {
//   let out = `graph TD\n`;

//   function addStruct(symbol: DatatypeSymbol, type: BaseStructDatatype) {
//     const symbolId = `${symbol.name}`;
//     let label = symbol.name;
//     const genericTokens = [] as string[];
//     if (type.generics instanceof Array) {
//       for (const generic of type.generics) {
//         genericTokens.push(generic);
//       }
//     } else {
//       for (const generic of Object.keys(type.generics)) {
//         label += ` ${generic}=${type.generics[generic]}`;
//       }
//     }
//     if (genericTokens.length > 0) {
//       label += `<${genericTokens.join(", ")}>`;
//     }

//     out += `subgraph `;
//     out += `${symbolId}["${type?.variant} ${label}"]\n`;

//     for (const member of type.members) {
//       out += `  ${symbolId}.${member.name}["${member.name}"]\n`;
//     }

//     for (const method of type.methods) {
//       out += `  ${symbolId}.${method.name}["${method.name}"]\n`;
//     }

//     out += `end\n`;
//     addScope(symbol.scope, symbolId);
//     return `${symbolId}`;
//   }

//   function addDatatypeSymbol(scopeId: string, symbol: DatatypeSymbol) {
//     switch (symbol.type?.variant) {
//       case "Struct":
//         if (!symbol.type.concrete) {
//           const structId = addStruct(symbol, symbol.type);
//           out += `  ${scopeId} --> ${structId}\n`;
//         } else {
//           throw new Error("Not implemented");
//         }
//         break;

//       default:
//         console.log("Unknown datatype variant: " + symbol.type?.variant);
//         break;
//     }
//   }

//   function addFunctionSymbol(scopeId: string, symbol: FunctionSymbol) {
//     if (symbol.type.variant !== "Function") {
//       throw new ImpossibleSituation();
//     }
//     let symbolId = "";
//     let parent = symbol.parentSymbol;
//     while (parent) {
//       symbolId += `${parent.name}.`;
//       parent = parent.parentSymbol;
//     }
//     symbolId += `${symbol.name}`;
//     let label = symbol.name;
//     out += `${symbolId}["${label}"]\n`;
//     addScope(symbol.scope, symbolId);
//   }

//   // Add Scopes
//   function addScope(scope: Scope, parentName?: string) {
//     const scopeId = `Scope_${Math.random().toString(36).substr(2, 5)}`;
//     out += `  ${scopeId}["Scope ${scope.location}"]\n`;

//     if (parentName) {
//       out += `  ${parentName} --> ${scopeId}\n`;
//     }

//     // Add Symbols
//     for (const symbol of scope.getSymbols()) {
//       switch (symbol.variant) {
//         case "Datatype":
//           addDatatypeSymbol(scopeId, symbol);
//           break;

//         case "Function":
//           addFunctionSymbol(scopeId, symbol);
//           break;

//         default:
//           console.log("Unknown symbol variant: " + symbol.variant);
//           break;
//       }
//     }

//     // // Recursively add child scopes
//     // for (const childScope of scope.children) {
//     //   addScope(childScope, scopeId);
//     // }
//   }

//   // Start with the program's globalScope as the root
//   addScope(program.globalScope);

//   // // Resolved Functions
//   // for (const funcName in program.resolvedFunctions) {
//   //   const func = program.resolvedFunctions[funcName];
//   //   out += `  Function_${funcName} [label="Function: ${funcName}", shape=parallelogram, fillcolor=lightgreen];\n`;
//   //   out += `  Scope_${program.globalScope.location.toString().replace(/[^a-zA-Z0-9]/g, "_")} -> Function_${funcName};\n`;
//   // }

//   // // Resolved Datatypes
//   // for (const dtypeName in program.resolvedDatatypes) {
//   //   const dtype = program.resolvedDatatypes[dtypeName];
//   //   out += `  Type_${dtypeName} [label="Type: ${dtypeName}", shape=hexagon, fillcolor=lightcoral];\n`;
//   //   out += `  Scope_${program.globalScope.location.toString().replace(/[^a-zA-Z0-9]/g, "_")} -> Type_${dtypeName};\n`;
//   // }

//   return out;
// }
