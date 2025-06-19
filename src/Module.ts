import type { ModuleConfig } from "./shared/Config";

export class Module {
  moduleConfig: ModuleConfig;
  filename?: string;

  private anonymousStuffCounter = 0;

  constructor(moduleConfig: ModuleConfig) {
    this.moduleConfig = moduleConfig;

    // const array: DatatypeSymbol<StructDatatype> = {
    //   variant: "Datatype",
    //   name: "__C_Array",
    //   type: {
    //     variant: "Struct",
    //     generics: new Map()
    //       .set("_Arr_T", undefined)
    //       .set("_Arr_Size", undefined),
    //     language: Linkage.Internal,
    //     members: [],
    //     methods: [],
    //     name: "__C_Array",
    //   },
    //   scope: this.parsedStore.globalScope,
    //   export: false,
    //   location: this.parsedStore.globalScope.location,
    // };
    // this.parsedStore.globalScope.defineSymbol(array);

    // if (this.moduleConfig.nostdlib) {
    //   const symbol: DatatypeSymbol = {
    //     variant: "Datatype",
    //     name: "Context",
    //     scope: this.parsedStore.globalScope,
    //     type: {
    //       variant: "Struct",
    //       generics: new Map(),
    //       language: Linkage.Internal,
    //       members: [],
    //       methods: [],
    //       name: "Context",
    //     },
    //     export: false,
    //     location: this.parsedStore.globalScope.location,
    //   };
    //   this.parsedStore.globalScope.defineSymbol(symbol);
    // }
  }

  makeAnonymousName() {
    return `__anonym_${this.anonymousStuffCounter++}`;
  }

  makeTempVarname() {
    return `__temp_${this.anonymousStuffCounter++}`;
  }
}
