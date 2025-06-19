import type { SemanticResult } from "../Semantic/SemanticSymbols";
import type { ID } from "../shared/store";
import type { CollectResult } from "../SymbolCollection/CollectSymbols";

export namespace Lowered {
  export type Module = {
    cr: CollectResult;
    sr: SemanticResult;

    cDeclarations: string[];

    datatypes: Map<ID, Datatype>;
  };

  export type Datatype = StructDatatype;

  export type NamespaceDatatype = {
    variant: "Namespace";
    name: string;
    parent: ID;
  };

  export type StructDatatype = {
    variant: "Struct";
    name: string;
    generics: ID;
    parent: ID;
  };

  //   export type FunctionDeclaration = {
  //     variant: "FunctionDeclaration";
  //     name: string;
  //     parent: ID;
  //   };
}
