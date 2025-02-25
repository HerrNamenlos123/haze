import type { ParserRuleContext } from "antlr4";
import {
  primitiveVariantToString,
  serializeDatatype,
  type Datatype,
  type FunctionDatatype,
} from "./Datatype";
import { InternalError } from "./Errors";
import type { Scope } from "./Scope";

export enum VariableType {
  MutableVariable,
  ConstantVariable,
  Parameter,
  MutableStructField,
  ConstantStructField,
}

export enum FunctionType {
  Internal,
  External_C,
  External_CXX,
}

export type VariableSymbol = {
  variant: "Variable";
  name: string;
  type: Datatype;
  variableType: VariableType;
  parentSymbol?: Symbol;
};

export type SpecialMethod = undefined | "constructor" | "destructor";

export type FunctionSymbol = {
  variant: "Function";
  name: string;
  type: FunctionDatatype;
  functionType: FunctionType;
  parentSymbol?: Symbol;
  scope: Scope;
  thisPointer?: Datatype;
  specialMethod?: SpecialMethod;
  ctx: ParserRuleContext;
};

export type DatatypeSymbol<T = Datatype> = {
  variant: "Datatype";
  parentSymbol?: Symbol;
  name: string;
  type: T;
  scope: Scope;
};

export type ConstantSymbol = {
  variant: "Constant";
  type: Datatype;
  value: string | number | boolean;
};

export type Symbol =
  | VariableSymbol
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
  if (symbol.variant !== "Constant") {
    let p = symbol.parentSymbol;
    while (p) {
      if (isDatatypeGeneric(p.type)) {
        return true;
      }
      if (p.variant !== "Constant") {
        p = p.parentSymbol;
      }
    }
  }
  return false;
}

export function mangleDatatype(datatype: Datatype): string {
  switch (datatype.variant) {
    case "Primitive":
      const s = primitiveVariantToString(datatype);
      return s.length.toString() + s;

    case "Function":
      let mangled = "F";
      for (const [name, tp] of datatype.functionParameters) {
        mangled += mangleDatatype(tp);
      }
      mangled += "E";
      return mangled;

    case "Struct":
      let mangled2 = datatype.name.length.toString() + datatype.name;
      if (datatype.generics.size > 0) {
        mangled2 += "I";
        for (const [name, tp] of datatype.generics) {
          if (tp) {
            mangled2 += mangleDatatype(tp);
          } else {
            mangled2 += name + "_";
          }
        }
        mangled2 += "E";
      }
      return mangled2;

    default:
      throw new InternalError(
        "Cannot mangle datatype variant: " + datatype.variant,
      );
  }
}

export function mangleSymbol(symbol: Symbol): string {
  switch (symbol.variant) {
    case "Function":
      if (symbol.functionType === FunctionType.External_C) {
        return symbol.name;
      }
      let mangled = "_H";
      if (symbol.parentSymbol) {
        let p: Symbol | undefined = symbol.parentSymbol;
        mangled += "N";
        while (p) {
          mangled += mangleDatatype(p.type);
          if (p.variant !== "Constant") {
            p = p.parentSymbol;
          }
        }
      }
      mangled += symbol.name.length.toString();
      mangled += symbol.name;

      // if (symbol.type.generics.size > 0) {
      //     mangled += "I"
      //     for t in symbol.type.generics():
      //         if not t[1]:
      //             raise InternalError("Cannot mangle non-instantiated generic type")
      //         mangled += t[1].getMangledName()
      //     mangled += "E"
      // }

      if (symbol.parentSymbol) {
        mangled += "E";
      }

      for (const [name, tp] of symbol.type.functionParameters) {
        mangled += mangleDatatype(tp);
      }
      return mangled;

    case "Datatype":
      return "_H" + mangleDatatype(symbol.type);

    default:
      throw new InternalError(
        "Cannot mangle symbol variant: " + symbol.variant,
      );
  }
}

export function serializeSymbol(symbol: Symbol): string {
  let name = "";
  if (symbol.variant !== "Constant") {
    let p = symbol.parentSymbol;
    while (p) {
      name = `${serializeDatatype(p.type)}.${name}`;
      if (p.variant !== "Constant") {
        p = p.parentSymbol;
      }
    }
    name += symbol.name;
  }
  return ` * ${name}: ${serializeDatatype(symbol.type)}      [mangle]: ${mangleSymbol(symbol)}`;
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
