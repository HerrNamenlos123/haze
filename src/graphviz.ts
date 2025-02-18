import type { Program } from "./Program";
import type { Scope } from "./Scope";

export function generateGraphviz(program: Program): string {
  let dot = `digraph ProgramStructure {\n`;
  dot += `  node [shape=box, style=filled, fillcolor=lightgray];\n`;

  // Add Scopes
  function addScope(scope: Scope, parentName?: string) {
    const scopeId = `Scope_${Math.random().toString(36).substr(2, 5)}`;
    dot += `  ${scopeId} [label="Scope\\n${scope.location}", shape=ellipse, fillcolor=lightyellow];\n`;

    if (parentName) {
      dot += `  ${parentName} -> ${scopeId};\n`;
    }

    // Add Symbols
    for (const symbol of scope.getSymbols()) {
      switch (symbol.variant) {
        case "Datatype":
          const symbolId = `Symbol_${symbol.name}`;
          let label = symbol.name;
          if (symbol.type?.variant === "Struct") {
            const genericTokens = [] as string[];
            if (symbol.type.generics instanceof Array) {
              for (const generic of symbol.type.generics) {
                genericTokens.push(generic);
              }
            } else {
              for (const generic of Object.keys(symbol.type.generics)) {
                label += ` ${generic}=${symbol.type.generics[generic]}`;
              }
            }
            if (genericTokens.length > 0) {
              label += `<${genericTokens.join(", ")}>`;
            }
          }
          dot += `  ${symbolId} [label="${symbol.type?.variant} ${label}", shape=box];\n`;
          dot += `  ${scopeId} -> ${symbolId};\n`;
          switch (symbol.type?.variant) {
            case "Struct":
              addScope(symbol.scope, symbolId);
              break;

            default:
              console.log("Unknown datatype variant: " + symbol.type?.variant);
              break;
          }
          break;

        default:
          console.log("Unknown symbol variant: " + symbol.variant);
          break;
      }
    }

    // // Recursively add child scopes
    // for (const childScope of scope.children) {
    //   addScope(childScope, scopeId);
    // }
  }

  // Start with the program's globalScope as the root
  addScope(program.globalScope);

  // Resolved Functions
  for (const funcName in program.resolvedFunctions) {
    const func = program.resolvedFunctions[funcName];
    dot += `  Function_${funcName} [label="Function: ${funcName}", shape=parallelogram, fillcolor=lightgreen];\n`;
    dot += `  Scope_${program.globalScope.location.toString().replace(/[^a-zA-Z0-9]/g, "_")} -> Function_${funcName};\n`;
  }

  // Resolved Datatypes
  for (const dtypeName in program.resolvedDatatypes) {
    const dtype = program.resolvedDatatypes[dtypeName];
    dot += `  Type_${dtypeName} [label="Type: ${dtypeName}", shape=hexagon, fillcolor=lightcoral];\n`;
    dot += `  Scope_${program.globalScope.location.toString().replace(/[^a-zA-Z0-9]/g, "_")} -> Type_${dtypeName};\n`;
  }

  dot += `}`;
  return dot;
}
