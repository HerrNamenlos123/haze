import {
  primitiveVariantToString,
  type Datatype,
  type EPrimitive,
} from "./Datatype";
import { ImpossibleSituation, Location, UnreachableCode } from "./Errors";
import type { Linkage, Symbol, VariableScope, VariableType } from "./Symbol";

export type ExportedTypesystem = {
  datatypes: StrippedDatatype[];
  symbols: StrippedSymbol[];
};

type DatatypeId = number;
type SymbolId = number;

type StrippedFunctionDatatype = {
  variant: "Function";
  typeId: number;
  functionParameters: [string, DatatypeId][];
  functionReturnType: DatatypeId;
  vararg: boolean;
};

type StrippedGenericPlaceholderDatatype = {
  variant: "Generic";
  typeId: number;
  name: string;
};

type StrippedStructMemberUnion = {
  variant: "StructMemberUnion";
  symbols: SymbolId[];
};

type StrippedStructDatatype = {
  variant: "Struct";
  typeId: number;
  name: string;
  generics: Record<string, DatatypeId | null>;
  language: Linkage;
  members: (SymbolId | StrippedStructMemberUnion)[];
  methods: SymbolId[];
  parentSymbol: SymbolId | null;
};

type StrippedRawPointerDatatype = {
  variant: "RawPointer";
  typeId: number;
  generics: Record<string, DatatypeId | null>;
};

type StrippedPrimitiveDatatype = {
  variant: "Primitive";
  typeId: number;
  primitive: string;
};

// type NamespaceDatatype = {
//   variant: "Namespace";
//   name: string;
//   symbolsScope: Scope;
//   parentSymbol?: DatatypeSymbol;
// };

type StrippedDatatype =
  | StrippedFunctionDatatype
  | StrippedStructDatatype
  //   | StrippedNamespaceDatatype
  | StrippedRawPointerDatatype
  | StrippedGenericPlaceholderDatatype
  | StrippedPrimitiveDatatype
  | StrippedFunctionDatatype;

type StrippedVariableSymbol = {
  variant: "Variable";
  symbolId: SymbolId;
  name: string;
  typeId: DatatypeId;
  variableType: VariableType;
  variableScope: VariableScope;
  parentSymbol: SymbolId | null;
  location: Location;
};

type StrippedFunctionSymbol = {
  variant: "Function";
  name: string;
  typeId: DatatypeId;
  language: Linkage;
  parentSymbol?: Symbol;
  // thisPointerExpr?: Expression;
  // scope: Scope;
  // specialMethod?: SpecialMethod;
  // ctx?: ParserRuleContext;
  wasAnalyzed: boolean;
  export: boolean;
  location: Location;
};

// type StrippedDatatypeSymbol<T = Datatype> = {
//   variant: "Datatype";
//   parentSymbol?: Symbol;
//   name: string;
//   type: T;
//   scope: Scope;
//   export: boolean;
//   location: Location;
// };

type StrippedSymbol = StrippedVariableSymbol;
//   | StrippedDatatypeSymbol
//   | StrippedFunctionSymbol;

export class TypeExporter {
  datatypes: {
    originalType: Datatype;
    strippedType: StrippedDatatype;
  }[] = [];
  symbols: {
    originalSymbol: Symbol;
    strippedSymbol: StrippedSymbol;
  }[] = [];
  nextId = 1;

  constructor() {}

  tryGetDatatypeId(datatype: Datatype): DatatypeId | undefined {
    const found = this.datatypes.find((d) => d.originalType === datatype);
    return found?.strippedType.typeId;
  }

  tryGetSymbolId(symbol: Symbol): SymbolId | undefined {
    const found = this.symbols.find((d) => d.originalSymbol === symbol);
    return found?.strippedSymbol.typeId;
  }

  getDatatypeId(datatype: Datatype): DatatypeId {
    switch (datatype.variant) {
      case "Primitive": {
        const id = this.tryGetDatatypeId(datatype);
        if (id) {
          return id;
        } else {
          this.datatypes.push({
            originalType: datatype,
            strippedType: {
              variant: "Primitive",
              primitive: primitiveVariantToString(datatype),
              typeId: this.nextId++,
            },
          });
          return this.nextId - 1;
        }
      }

      case "Struct": {
        const id = this.tryGetDatatypeId(datatype);
        if (id) {
          return id;
        } else {
          const struct: StrippedDatatype = {
            variant: "Struct",
            typeId: this.nextId++,
            name: datatype.name,
            generics: {},
            language: datatype.language,
            members: [],
            methods: [],
            parentSymbol: null,
          };
          this.datatypes.push({
            originalType: datatype,
            strippedType: struct,
          });

          for (const [name, tp] of datatype.generics.entries()) {
            if (tp) {
              struct.generics[name] = this.getDatatypeId(tp.type);
            } else {
              struct.generics[name] = null;
            }
          }

          for (const member of datatype.members) {
            if (member.variant === "Variable") {
              struct.members.push(this.getSymbolId(member));
            } else {
              struct.members.push({
                variant: "StructMemberUnion",
                symbols: member.symbols.map((s) => this.getSymbolId(s)),
              });
            }
          }

          for (const method of datatype.methods) {
            struct.methods.push(this.getSymbolId(method));
          }

          struct.parentSymbol = datatype.parentSymbol
            ? this.getSymbolId(datatype.parentSymbol)
            : null;

          return struct.typeId;
        }
      }

      case "Generic": {
        const id = this.tryGetDatatypeId(datatype);
        if (id) {
          return id;
        } else {
          this.datatypes.push({
            originalType: datatype,
            strippedType: {
              variant: "Generic",
              name: datatype.name,
              typeId: this.nextId++,
            },
          });
          return this.nextId - 1;
        }
      }

      case "RawPointer": {
        const id = this.tryGetDatatypeId(datatype);
        if (id) {
          return id;
        } else {
          const ptr: StrippedDatatype = {
            variant: "RawPointer",
            generics: {},
            typeId: this.nextId++,
          };
          this.datatypes.push({
            originalType: datatype,
            strippedType: ptr,
          });

          for (const [name, tp] of datatype.generics.entries()) {
            if (tp) {
              ptr.generics[name] = this.getDatatypeId(tp);
            } else {
              ptr.generics[name] = null;
            }
          }
          return this.nextId - 1;
        }
      }
    }
    throw new UnreachableCode();
  }

  getSymbolId(symbol: Symbol): SymbolId {
    switch (symbol.variant) {
      case "StringConstant": {
        throw new ImpossibleSituation();
      }
      case "LiteralConstant": {
        throw new ImpossibleSituation();
      }
      case "BooleanConstant": {
        throw new ImpossibleSituation();
      }

      case "Variable": {
        const id = this.tryGetSymbolId(symbol);
        if (id) {
          return id;
        } else {
          const variable: StrippedVariableSymbol = {
            variant: "Variable",
            typeId: 0,
            location: symbol.location,
            parentSymbol: null,
            name: symbol.name,
            symbolId: this.nextId++,
            variableScope: symbol.variableScope,
            variableType: symbol.variableType,
          };
          this.symbols.push({
            originalSymbol: symbol,
            strippedSymbol: variable,
          });
          variable.typeId = this.getDatatypeId(symbol.type);
          variable.parentSymbol = symbol.parentSymbol
            ? this.getSymbolId(symbol.parentSymbol)
            : null;
          return variable.symbolId;
        }
      }
    }
    throw new UnreachableCode();
  }

  addDatatype(datatype: Datatype) {
    this.getDatatypeId(datatype);
  }

  get(): ExportedTypesystem {
    const result: ExportedTypesystem = { datatypes: [], symbols: [] };
    for (const t of this.datatypes) {
      result.datatypes.push(t.strippedType);
    }
    for (const t of this.symbols) {
      result.symbols.push(t.strippedSymbol);
    }
    return result;
  }
}
