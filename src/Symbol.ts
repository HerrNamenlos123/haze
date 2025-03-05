import type { ParserRuleContext } from "antlr4";
import {
  primitiveVariantToString,
  serializeDatatype,
  type Datatype,
  type DatatypeId,
  type FunctionDatatype,
  type StructDatatype,
} from "./Datatype";
import {
  getCallerLocation,
  ImpossibleSituation,
  InternalError,
} from "./Errors";
import type { Scope } from "./Scope";
import type { Expression } from "./Expression";
import type { Program } from "./Program";

export enum VariableType {
  MutableVariable,
  ConstantVariable,
  Parameter,
  MutableStructField,
  ConstantStructField,
}

export enum Language {
  Internal,
  External_C,
  External_CXX,
}

export type VariableSymbol = {
  variant: "Variable";
  name: string;
  type: DatatypeId;
  variableType: VariableType;
  memberOfStruct?: DatatypeId;
};

export type MethodType = undefined | "constructor" | "destructor";

export type FunctionSymbol = {
  variant: "Function";
  name: string;
  type: DatatypeId;
  language: Language;
  methodOfStructExpr?: Expression;
  methodOfStructSymbol?: DatatypeSymbol;
  methodType?: MethodType;
  body?: Scope;
  ctx: ParserRuleContext;
};

export type DatatypeSymbol = {
  variant: "Datatype";
  name: string;
  type: DatatypeId;
  scope: Scope;
};

export type StringConstantSymbol = {
  variant: "StringConstant";
  type: DatatypeId;
  value: string;
};

export type BooleanConstantSymbol = {
  variant: "BooleanConstant";
  type: DatatypeId;
  value: boolean;
};

export type LiteralUnit = "s" | "ms" | "us" | "ns" | "m" | "h" | "d";

export type LiteralConstantSymbol = {
  variant: "LiteralConstant";
  type: DatatypeId;
  value: number;
  unit?: LiteralUnit;
};

export type ConstantSymbol =
  | StringConstantSymbol
  | BooleanConstantSymbol
  | LiteralConstantSymbol;

export type Symbol =
  | VariableSymbol
  | DatatypeSymbol
  | FunctionSymbol
  | ConstantSymbol;

export function isDatatypeGeneric(datatype: Datatype) {
  switch (datatype.variant) {
    case "DeferredReturn":
      throw new InternalError("Cannot determine if __Deferred type is generic");

    case "Function":
      return false;

    case "Generic":
      return true;

    case "Primitive":
      return false;

    case "Struct":
      return Object.keys(datatype.generics).length > 0;
  }
}

export function isSymbolGeneric(symbol: Symbol, program: Program) {
  const type = program.lookupDt(symbol.type);
  if (isDatatypeGeneric(type)) {
    return true;
  }
  // if (
  //   symbol.variant === "Datatype" && type.variant === "Struct"
  // ) {
  //   let p = type.;
  //   while (p) {
  //     if (isDatatypeGeneric(p.type)) {
  //       return true;
  //     }
  //     if (
  //       p.variant === "Variable" ||
  //       p.variant === "Function" ||
  //       p.variant === "Datatype"
  //     ) {
  //       p = p.parentSymbol;
  //     }
  //   }
  // }
  return false;
}

export function getDatatypeId(datatype: Datatype): DatatypeId {
  switch (datatype.variant) {
    case "Primitive":
      const s = primitiveVariantToString(datatype);
      return s.length.toString() + s;

    case "Function":
      let mangled = "F";
      for (const [name, tp] of datatype.functionParameters) {
        mangled += tp;
      }
      mangled += "E";
      return mangled;

    case "Struct":
      if (datatype.language === Language.Internal) {
        let mangled2 = datatype.name.length.toString() + datatype.name;
        if (Object.keys(datatype.generics).length > 0) {
          mangled2 += "I";
          for (const [name, tp] of Object.entries(datatype.generics)) {
            if (tp) {
              mangled2 += tp;
            } else {
              mangled2 += name + "_";
            }
          }
          mangled2 += "E";
        }
        return mangled2;
      } else {
        return datatype.name;
      }

    case "RawPointer":
      let ptrMangled = "PI";
      const tp = datatype.generics["__Pointee"];
      if (tp) {
        ptrMangled += tp;
      } else {
        ptrMangled += "__Pointee_";
      }
      ptrMangled += "E";
      return ptrMangled;

    case "DeferredReturn":
      return "__DeferredReturn";

    case "Generic":
      return datatype.name;

    // default:
    //   throw new InternalError(
    //     "Cannot mangle datatype variant: " + datatype.variant,
    //   );
  }
}

export function mangleSymbol(symbol: Symbol, program: Program): string {
  const type = program.lookupDt(symbol.type);
  switch (symbol.variant) {
    case "Function":
      if (symbol.language === Language.External_C) {
        return symbol.name;
      }
      let mangled = "_H";
      let p = symbol.methodOfStructSymbol;
      if (p) {
        mangled += "N";
        mangled += p.type;
      }
      mangled += symbol.name.length.toString();
      mangled += symbol.name;

      if (Object.keys((type as FunctionDatatype).generics).length > 0) {
        mangled += "I";
        for (const [name, tp] of Object.entries(
          (type as FunctionDatatype).generics,
        )) {
          mangled += tp ? tp : name + "_";
        }
        mangled += "E";
      }

      if (symbol.methodOfStructSymbol) {
        mangled += "E";
      }

      for (const [name, tp] of (type as FunctionDatatype).functionParameters) {
        mangled += serializeDatatype(tp, program);
      }

      return mangled;

    case "Datatype":
      if (type.variant === "Struct" && type.language === Language.Internal) {
        return "_H" + symbol.type;
      } else {
        return symbol.type;
      }

    default:
      throw new InternalError(
        "Cannot mangle symbol variant: " + symbol.variant,
      );
  }
}

export function serializeSymbol(symbol: Symbol, program: Program): string {
  if (
    symbol.variant === "StringConstant" ||
    symbol.variant === "BooleanConstant" ||
    symbol.variant === "LiteralConstant"
  ) {
    return "ConstantSymbol";
  }
  let name = "";
  // let p = symbol;
  // while (p) {
  //   name = `${serializeDatatype(p.type)}.${name}`;
  //   if (
  //     p.variant === "Datatype" ||
  //     p.variant === "Function" ||
  //     p.variant === "Variable"
  //   ) {
  //     p = p.parentSymbol;
  //   }
  // }
  name += symbol.name;
  const type = program.lookupDt(symbol.type);
  return ` * ${name}: ${serializeDatatype(symbol.type, program)}      [mangle]: ${mangleSymbol(symbol, program)} ${type.variant === "Struct" && type.language}`;
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
