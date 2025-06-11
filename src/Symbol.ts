import type { ParserRuleContext } from "antlr4ng";
import {
  primitiveVariantToString,
  serializeDatatype,
  type Datatype,
  type FunctionDatatype,
  type StructMemberUnion,
} from "./Datatype";
import {
  ImpossibleSituation,
  InternalError,
  Location,
  UnreachableCode,
} from "./Errors";
import type { Scope } from "./Scope";
import type { Expression } from "./Expression";
import type {
  VariableDeclarationContext,
  VariableDefinitionContext,
} from "./grammar/autogen/HazeParser";

export enum VariableType {
  MutableVariable,
  ConstantVariable,
  Parameter,
  MutableStructField,
  ConstantStructField,
}

export enum VariableScope {
  Local,
  Member,
  Global,
}

export enum Linkage {
  Internal,
  External,
  External_C,
}

export type VariableSymbol = {
  variant: "Variable";
  name: string;
  type: Datatype;
  variableType: VariableType;
  variableScope: VariableScope;
  parentSymbol?: Symbol;
  ctx?: VariableDefinitionContext | VariableDeclarationContext;
  export: boolean;
  extern: Linkage;
  location: Location;
};

export type SpecialMethod = undefined | "constructor";

export type FunctionSymbol = {
  variant: "Function";
  name: string;
  type: FunctionDatatype;
  extern: Linkage;
  parentSymbol?: Symbol;
  thisPointerExpr?: Expression;
  scope: Scope;
  definedInScope: Scope;
  specialMethod?: SpecialMethod;
  ctx?: ParserRuleContext;
  wasAnalyzed: boolean;
  export: boolean;
  location: Location;
  declared: boolean;
};

export type DatatypeSymbol<T = Datatype> = {
  variant: "Datatype";
  parentSymbol?: Symbol;
  name: string;
  type: T;
  scope: Scope;
  export: boolean;
  location: Location;
  originalGenericSourcecode?: string;
};

export type ConstantLookupSymbol = {
  variant: "ConstantLookup";
  type: Datatype;
  name: string;
  constant: ConstantSymbol;
  location: Location;
};

export type StringConstantSymbol = {
  variant: "StringConstant";
  type: Datatype;
  value: string;
  location: Location;
};

export type BooleanConstantSymbol = {
  variant: "BooleanConstant";
  type: Datatype;
  value: boolean;
  location: Location;
};

export type LiteralUnit = "s" | "ms" | "us" | "ns" | "m" | "h" | "d";

export type LiteralConstantSymbol = {
  variant: "LiteralConstant";
  type: Datatype;
  value: number;
  unit?: LiteralUnit;
  location: Location;
};

export type ConstantSymbol =
  | StringConstantSymbol
  | BooleanConstantSymbol
  | LiteralConstantSymbol;

export type Symbol =
  | VariableSymbol
  | ConstantLookupSymbol
  | DatatypeSymbol
  | FunctionSymbol
  | ConstantSymbol;

export function isDatatypeGeneric(datatype: Datatype) {
  switch (datatype.variant) {
    case "Deferred":
      throw new InternalError("Cannot determine if __Deferred type is generic");

    case "Function":
      return false;

    case "Generic":
      return true;

    case "Primitive":
      return false;

    case "Struct":
      return datatype.generics.size > 0;
  }
}

export function isSymbolGeneric(symbol: Symbol) {
  if (isDatatypeGeneric(symbol.type)) {
    return true;
  }
  if (
    symbol.variant === "Variable" ||
    symbol.variant === "Function" ||
    symbol.variant === "Datatype"
  ) {
    let p = symbol.parentSymbol;
    while (p) {
      if (isDatatypeGeneric(p.type)) {
        return true;
      }
      if (
        p.variant === "Variable" ||
        p.variant === "Function" ||
        p.variant === "Datatype"
      ) {
        p = p.parentSymbol;
      }
    }
  }
  return false;
}

export function mangleDatatype(datatype: Datatype): string {
  if (!datatype) {
    throw new InternalError("");
  }
  switch (datatype.variant) {
    case "Primitive":
      const s = primitiveVariantToString(datatype);
      return s.length.toString() + s;

    case "Namespace":
      return datatype.name.length.toString() + datatype.name;

    case "Function":
      let mangled = "F";
      for (const [name, tp] of datatype.functionParameters) {
        mangled += mangleDatatype(tp);
      }
      mangled += "E";
      mangled += mangleDatatype(datatype.functionReturnType);
      return mangled;

    case "Struct":
      let nesting = "";
      if (datatype.parentSymbol) {
        let p: Datatype | undefined = datatype.parentSymbol.type;
        while (p) {
          if (p.variant !== "Struct" && p.variant !== "Namespace") {
            throw new ImpossibleSituation();
          }
          nesting = mangleDatatype(p) + nesting;
          p = p.parentSymbol?.type;
        }
      }
      if (datatype.language === Linkage.Internal) {
        let innerMangling = datatype.name.length.toString() + datatype.name;
        if (datatype.generics.size > 0) {
          innerMangling += "I";
          for (const [name, tp] of datatype.generics) {
            if (tp) {
              if (tp.variant === "Datatype") {
                innerMangling += mangleDatatype(tp.type);
              } else {
                innerMangling += tp.value.toString().replaceAll(".", "_");
              }
            } else {
              innerMangling += name + "_";
            }
          }
          innerMangling += "E";
        }

        if (nesting !== "") {
          return `N${nesting}${innerMangling}E`;
        } else {
          return innerMangling;
        }
      } else {
        return datatype.name;
      }

    case "RawPointer":
      let ptrMangled = "PI";
      if (datatype.pointee) {
        ptrMangled += mangleDatatype(datatype.pointee.type);
      } else {
        throw new InternalError("Pointer pointing to nothing");
      }
      ptrMangled += "E";
      return ptrMangled;

    case "Generic":
      return datatype.name;

    default:
      throw new InternalError(
        "Cannot mangle datatype variant: " + datatype.variant,
      );
  }
}

export function mangleSymbol(symbol: Symbol): string {
  switch (symbol.variant) {
    case "Function": {
      if (symbol.extern === Linkage.External_C) {
        return symbol.name;
      }
      let mangled = "_H";
      if (symbol.parentSymbol) {
        let p: Symbol | undefined = symbol.parentSymbol;
        mangled += "N";
        while (p) {
          mangled += mangleDatatype(p.type);
          if (
            p.variant === "Variable" ||
            p.variant === "Function" ||
            p.variant === "Datatype"
          ) {
            p = p.parentSymbol;
          }
        }
      }
      mangled += symbol.name.length.toString();
      mangled += symbol.name;
      if (symbol.parentSymbol) {
        mangled += "E";
      }
      return mangled;
    }

    case "Datatype":
      if (symbol.type.variant === "Struct" && symbol.type.language) {
        return mangleDatatype(symbol.type);
      } else {
        return "_H" + mangleDatatype(symbol.type);
      }

    case "Variable": {
      if (symbol.variableScope === VariableScope.Global) {
        let mangled = "_H";
        if (symbol.parentSymbol) {
          let p: Symbol | undefined = symbol.parentSymbol;
          mangled += "N";
          while (p) {
            mangled += mangleDatatype(p.type);
            if (
              p.variant === "Variable" ||
              p.variant === "Function" ||
              p.variant === "Datatype"
            ) {
              p = p.parentSymbol;
            }
          }
        }
        mangled += symbol.name.length.toString();
        mangled += symbol.name;
        if (symbol.parentSymbol) {
          mangled += "E";
        }
        return mangled;
      } else {
        return symbol.name;
      }
    }

    default:
      throw new InternalError(
        "Cannot mangle symbol variant: " + symbol.variant,
      );
  }
}

export function serializeSymbol(symbol: Symbol): string {
  let name = "";
  if (
    symbol.variant === "Datatype" ||
    symbol.variant === "Function" ||
    symbol.variant === "Variable"
  ) {
    let p = symbol.parentSymbol;
    while (p) {
      name = `${serializeDatatype(p.type)}.${name}`;
      if (
        p.variant === "Datatype" ||
        p.variant === "Function" ||
        p.variant === "Variable"
      ) {
        p = p.parentSymbol;
      }
    }
    name += symbol.name;
  }
  return ` * ${name}: ${serializeDatatype(symbol.type)}      [mangle]: ${mangleSymbol(symbol)} ${symbol.type.variant === "Struct" && symbol.type.language ? "(declared)" : ""}`;
}

// let s = ""
// switch (symbol.functionType) {
//     case FunctionType.External_C:
//         s += "extern-c "
// }

// let name = symbol.name
// let p = symbol.parentSymbol
// while (p) {
//     name = `${mangleDatatype(p.type)}.${name}`
//     p = p.parentSymbol
// }
// s += name

// s += "("
// const params = [] as string[];
// if (symbol.thisPointer) {
//     params.append(`this: ${self.thisPointerType}`)
// }
// for n, type in self.type.functionParameters():
//     params.append(f"{n}: {type}")
// s += ", ".join(params)
// s += f") -> {self.type.functionReturnType()}"

// match self._variant:
//     case Datatype.Variants.Primitive:
//         return Datatype.primitiveVariantToString(self._primitiveVariant)
//     case Datatype.Variants.Pointer:
//         raise InternalError("Cannot mangle pointer")
//     case Datatype.Variants.ResolutionDeferred:
//         raise InternalError("Cannot mangle deferred")
//     case Datatype.Variants.Struct:
//         mangled = str(len(self._name))
//         mangled += self._name
//         if len(self._generics) > 0:
//             mangled += "I"
//             for name, tp in self._generics:
//                 if not tp:
//                     raise InternalError(
//                         f"Generic placeholder '{name}' is missing value",
//                         getCallerLocation(),
//                     )
//                 mangled += tp.getMangledName()
//             mangled += "E"
//         return mangled
//     case Datatype.Variants.Function:
//         mangled = "F"
//         for name, tp in self._functionParameters:
//             mangled += tp.getMangledName()
//         mangled += "E"
//         return mangled
// raise InternalError("Invalid variant " + str(self._variant))
