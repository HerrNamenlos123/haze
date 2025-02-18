import type { Location } from "./Errors";
import type { MethodSymbol, MemberSymbol, VariableSymbol } from "./Symbol";

export enum Primitive {
  none = 1,
  unknown = 2,
  boolean = 3,
  booleanptr = 4,
  i8 = 5,
  i16 = 6,
  i32 = 7,
  i64 = 8,
  u8 = 9,
  u16 = 10,
  u32 = 11,
  u64 = 12,
  stringview = 13,
}

/**
 * Explanation what is a datatype:
 *
 *  - Base Datatypes are the most basic form or generic form of datatypes.
 *    Those are primitives, or generic types (such as "Array<T>"). Other base datatypes can be referenced.
 *    Once they are built, they are immutable.
 *
 *  - Concrete types are base types but instantiated for usage.
 *    For primitives, this will be a straight copy.
 *    For generic types, it will be a mix of other concrete types, that all were built out of the base types.
 *    e.g. "Array<T=Box<T=i32>>" <-- All of those are also concrete
 *    Only concrete types can be used for anything. Even primitives need to be instantiated from "Base" to "Concrete".
 */

export type BaseGenerics = string[];

export type BaseFunctionDatatype = {
  variant: "Function";
  concrete: false;
  functionParameters: [string, BaseDatatype][];
  functionReturnType: BaseDatatype;
  generics: BaseGenerics;
};

export type BaseStructDatatype = {
  variant: "Struct";
  concrete: false;
  name: string;
  generics: BaseGenerics;
  members: MemberSymbol[];
  methods: MethodSymbol[];
};

export type BasePrimitiveDatatype = {
  variant: "Primitive";
  concrete: false;
  primitive: Primitive;
};

export type BaseGenericDatatype = {
  variant: "Generic";
  concrete: false;
  name: string;
};

export type BaseDatatype =
  | BasePrimitiveDatatype
  | BaseFunctionDatatype
  | BaseStructDatatype
  | BaseGenericDatatype;

export type ConcreteGenerics = Record<string, ConcreteDatatype>;

export type ConcreteFunctionDatatype = {
  variant: "Function";
  concrete: true;
  functionParameters: [string, ConcreteDatatype][];
  functionReturnType: ConcreteDatatype;
  generics: ConcreteGenerics;
};

export type ConcreteStructDatatype = {
  variant: "Struct";
  concrete: true;
  name: string;
  generics: ConcreteGenerics;
  members: { name: string; type: ConcreteDatatype }[];
  methods: { name: string; type: ConcreteDatatype }[];
};

export type ConcretePrimitiveDatatype = {
  variant: "Primitive";
  concrete: true;
  primitive: Primitive;
};

export type ConcreteDatatype =
  | ConcretePrimitiveDatatype
  | ConcreteFunctionDatatype
  | ConcreteStructDatatype;

export type Datatype = BaseDatatype | ConcreteDatatype;

export function primitiveVariantToString(dt: BasePrimitiveDatatype): string {
  switch (dt.primitive) {
    case Primitive.none:
      return "none";
    case Primitive.unknown:
      return "unknown";
    case Primitive.boolean:
      return "boolean";
    case Primitive.booleanptr:
      return "booleanptr";
    case Primitive.i8:
      return "i8";
    case Primitive.i16:
      return "i16";
    case Primitive.i32:
      return "i32";
    case Primitive.i64:
      return "i64";
    case Primitive.u8:
      return "u8";
    case Primitive.u16:
      return "u16";
    case Primitive.u32:
      return "u32";
    case Primitive.u64:
      return "u64";
    case Primitive.stringview:
      return "stringview";
  }
  throw new Error("Datatype has no string representation");
}

// function getDisplayName(type: Datatype): string {
//   switch (type.variant) {
//     case "Primitive":
//       return primitiveVariantToString(type);
//     case "Function":
//       const genericArr: string[] = [];
//       for (const [name, tp] of type.generics) {
//         let nm = name;
//         if (tp) {
//           nm += ` = ${getDisplayName(tp)}`;
//         }
//         genericArr.push(nm);
//       }
//       const params = type.functionParameters.map((f) => getDisplayName(f[1]));
//       const s = genericArr.length > 0 ? `<${genericArr.join(", ")}> ` : "";
//       return `${s}(${params.join(", ")}) -> ${this._functionReturnType.getDisplayName()}`;
//     case Datatype.Variants.Pointer:
//       return `Ptr<${this._pointee.getDisplayName()}>`;
//     case Datatype.Variants.ResolutionDeferred:
//       return "__Deferred";
//     case Datatype.Variants.Struct:
//       if (this._name.startsWith("__anonym_")) {
//         const val = "struct {";
//         for (const symbol of this._structMemberSymbols!.symbols) {
//           val += `${symbol.name}: ${symbol.type.getDisplayName()}, `;
//         }
//         if (this._structMemberSymbols!.symbols.length > 0) {
//           val = val.slice(0, -2);
//         }
//         val += "}";
//         return val;
//       } else {
//         let s = this._name;
//         if (this._generics.length > 0) {
//           const g = this._generics.map((gg) =>
//             gg[1] ? `${gg[0]} = ${gg[1].getDisplayName()}` : gg[0],
//           );
//           s += `<${g.join(", ")}> `;
//         }
//         if (this._structMemberSymbols) {
//           s += "{";
//           s += this._structMemberSymbols.symbols
//             .map((m) => `${m.name}: ${m.type}`)
//             .join(", ");
//           s += "}";
//         }
//         return s;
//       }
//     default:
//       throw new Error("Invalid variant");
//   }
// }

// function getMangledName(): string {
//   switch (this._variant) {
//     case Datatype.Variants.Primitive:
//       return Datatype.primitiveVariantToString(this._primitiveVariant);
//     case Datatype.Variants.Pointer:
//       throw new InternalError("Cannot mangle pointer");
//     case Datatype.Variants.ResolutionDeferred:
//       throw new InternalError("Cannot mangle deferred");
//     case Datatype.Variants.Struct:
//       let mangled = this._name.length.toString();
//       mangled += this._name;
//       if (this._generics.length > 0) {
//         mangled += "I";
//         for (const [name, tp] of this._generics) {
//           if (!tp) {
//             throw new InternalError(
//               `Generic placeholder '${name}' is missing value`,
//               getCallerLocation(),
//             );
//           }
//           mangled += tp.getMangledName();
//         }
//         mangled += "E";
//       }
//       return mangled;
//     case Datatype.Variants.Function:
//       let mangled = "F";
//       for (const [name, tp] of this._functionParameters) {
//         mangled += tp.getMangledName();
//       }
//       mangled += "E";
//       return mangled;
//   }
//   throw new InternalError(`Invalid variant ${this._variant}`);
// }

// function areAllGenericsResolved(): boolean {
//   if (!this.isGeneric()) {
//     return true;
//   }
//   switch (this._variant) {
//     case Datatype.Variants.Primitive:
//       return true;
//     case Datatype.Variants.GenericPlaceholder:
//       return false;
//     case Datatype.Variants.ResolutionDeferred:
//       throw new InternalError(
//         "Deferred type should no longer be in this stage",
//       );
//     case Datatype.Variants.Pointer:
//       return !!this._pointee && this._pointee.areAllGenericsResolved();
//     case Datatype.Variants.Function:
//       if (
//         this._functionReturnType &&
//         !this._functionReturnType.areAllGenericsResolved()
//       ) {
//         return false;
//       }
//       for (const [name, type] of this._functionParameters) {
//         if (!type.areAllGenericsResolved()) {
//           return false;
//         }
//       }
//       for (const [name, tp] of this._generics) {
//         if (!tp) {
//           return false;
//         }
//       }
//       return true;
//     case Datatype.Variants.Struct:
//       for (const vsym of this.structSymbolTable().getFiltered(VariableSymbol)) {
//         const vsymbol = vsym as VariableSymbol;
//         if (!vsymbol.type.areAllGenericsResolved()) {
//           return false;
//         }
//       }
//       for (const [name, tp] of this._generics) {
//         if (!tp) {
//           return false;
//         }
//       }
//       return true;
//   }
//   throw new InternalError(`Invalid variant ${this._variant}`);
// }

// function isGeneric(): boolean {
//   switch (this._variant) {
//     case Datatype.Variants.Primitive:
//       return false;

//     case Datatype.Variants.GenericPlaceholder:
//       return true;

//     case Datatype.Variants.ResolutionDeferred:
//       return false;

//     case Datatype.Variants.Pointer:
//       return !!this._pointee && this._pointee.isGeneric();

//     case Datatype.Variants.Function:
//       if (this._functionReturnType && this._functionReturnType.isGeneric()) {
//         return true;
//       }
//       for (const [name, type] of this._functionParameters) {
//         if (type.isGeneric()) {
//           return true;
//         }
//       }
//       return this._generics.length > 0;

//     case Datatype.Variants.Struct:
//       const vsyms = this.structSymbolTable().getFiltered(VariableSymbol);
//       for (const vsym of vsyms) {
//         const vsymbol = vsym as VariableSymbol;
//         if (vsymbol.type.isGeneric()) {
//           return true;
//         }
//       }
//       return this._generics.length > 0;
//   }
//   throw new InternalError(`Invalid variant ${this._variant}`);
// }

// function containsUnknown(): boolean {
//   switch (this._variant) {
//     case Datatype.Variants.Primitive:
//       return this.isUnknown();
//     case Datatype.Variants.Function:
//       if (!this._functionReturnType) {
//         throw new InternalError("bullshit happening");
//       }
//       if (this._functionReturnType.isUnknown()) {
//         return true;
//       }
//       for (const [name, type] of this._functionParameters) {
//         if (type.isUnknown()) {
//           return true;
//         }
//       }
//       return false;
//   }
//   throw new InternalError(`Invalid variant ${this._variant}`);
// }

// function generateDefinitionCCode(): string {
//   switch (this._variant) {
//     case Datatype.Variants.Primitive:
//       return "";

//     case Datatype.Variants.Struct:
//       const out = `typedef struct __${this.generateUsageCode()}__ {`;
//       for (const memberSymbol of this.structSymbolTable().symbols) {
//         if (memberSymbol instanceof VariableSymbol) {
//           out += `    ${memberSymbol.type.generateUsageCode()} ${memberSymbol.name};`;
//         }
//       }
//       out += `}} ${this.generateUsageCode()};`;
//       return out;

//     case Datatype.Variants.Function:
//       if (!this._functionParameters || !this._functionReturnType) {
//         throw new InternalError(
//           "Function is missing functionReturnType or functionParameters",
//         );
//       }
//       const params = this._functionParameters.map(([name, tp]) =>
//         tp.generateUsageCode(),
//       );
//       return `typedef ${this._functionReturnType.generateUsageCode()} (*${this.generateUsageCode()})(${params.join(", ")});`;
//   }
//   throw new InternalError(`Invalid variant ${this._variant}`);
// }

// function generateUsageCode(): string {
//   switch (this._variant) {
//     case Datatype.Variants.Primitive:
//       switch (this._primitiveVariant) {
//         case Primitive.none:
//           return "void";
//         case Primitive.unknown:
//           throw new InternalError(
//             "Type 'unknown' is compiler internal and must not appear in generated C-code",
//           );
//         case Primitive.boolean:
//           return "bool";
//         case Primitive.booleanptr:
//           return "bool*";
//         case Primitive.i8:
//           return "int8_t";
//         case Primitive.i16:
//           return "int16_t";
//         case Primitive.i32:
//           return "int32_t";
//         case Primitive.i64:
//           return "int64_t";
//         case Primitive.u8:
//           return "uint8_t";
//         case Primitive.u16:
//           return "uint16_t";
//         case Primitive.u32:
//           return "uint32_t";
//         case Primitive.u64:
//           return "uint64_t";
//         case Primitive.stringview:
//           return "char*";
//       }
//       throw new UnreachableCode();

//     case Datatype.Variants.Pointer:
//       if (!this._pointee) {
//         throw new InternalError("bullshit happening");
//       }
//       return `${this._pointee.generateUsageCode()}*`;

//     case Datatype.Variants.ResolutionDeferred:
//       throw new InternalError("Cannot generate usage code for deferred");
//     case Datatype.Variants.Struct:
//       return `_H${this.getMangledName()}`;
//     case Datatype.Variants.Function:
//       return `_H${this.getMangledName()}`;
//   }
//   throw new InternalError(`Invalid variant ${this._variant}`);
// }

// function isSame(other: Datatype): boolean {
//   if (this.isPrimitive() && other.isPrimitive()) {
//     return this._primitiveVariant === other._primitiveVariant;
//   }

//   if (this.isPointer() && other.isPointer()) {
//     if (!this._pointee || !other._pointee) {
//       return false;
//     }
//     return this._pointee.isSame(other._pointee);
//   }

//   if (this.isFunction() && other.isFunction()) {
//     if (!this._functionReturnType || !other._functionReturnType) {
//       return false;
//     }
//     if (!this._functionReturnType.isSame(other._functionReturnType)) {
//       return false;
//     }
//     if (this._functionParameters.length !== other._functionParameters.length) {
//       return false;
//     }
//     for (let i = 0; i < this._functionParameters.length; i++) {
//       if (
//         !this._functionParameters[i][1].isSame(other._functionParameters[i][1])
//       ) {
//         return false;
//       }
//     }
//     return true;
//   }

//   if (this.isStruct() && other.isStruct()) {
//     const aMembers = this.structSymbolTable().getFiltered(VariableSymbol);
//     const bMembers = other.structSymbolTable().getFiltered(VariableSymbol);
//     if (aMembers.length !== bMembers.length) {
//       return false;
//     }
//     for (let i = 0; i < aMembers.length; i++) {
//       if (
//         aMembers[i].name !== bMembers[i].name ||
//         !aMembers[i].type.isSame(bMembers[i].type)
//       ) {
//         return false;
//       }
//     }
//     return true;
//   }
//   return false;
// }

// function implicitConversion(
//   _from: Datatype,
//   to: Datatype,
//   expr: string,
//   loc: Location,
// ): string {
//   if (_from.isSame(to)) {
//     return expr;
//   }

//   if (_from.isPrimitive() && to.isPrimitive()) {
//     if (_from.isInteger() && to.isInteger()) {
//       return `(${to.generateUsageCode()})(${expr})`;
//     }
//     throw new InternalError(
//       `No implicit conversion from ${_from.getDisplayName()} to ${to.getDisplayName()}`,
//     );
//   }

//   if (_from.isPointer() && to.isPointer()) {
//     throw new CompilerError(
//       "Pointer types are not convertible. Polymorphism is not implemented yet",
//       loc,
//     );
//   }

//   if (_from.isFunction() && to.isFunction()) {
//     if (!_from._functionReturnType || !to._functionReturnType) {
//       throw new InternalError("bullshit happening");
//     }
//     if (_from._functionReturnType.isSame(to._functionReturnType)) {
//       if (_from._functionParameters.length === to._functionParameters.length) {
//         let equal = true;
//         for (let i = 0; i < _from._functionParameters.length; i++) {
//           if (
//             !_from._functionParameters[i][1].isSame(
//               to._functionParameters[i][1],
//             )
//           ) {
//             equal = false;
//           }
//         }
//         if (equal) {
//           return expr;
//         }
//       }
//     }
//     throw new CompilerError(
//       `No implicit conversion from '${_from.getDisplayName()}' to '${to.getDisplayName()}'`,
//       loc,
//     );
//   }

//   if (_from.isStruct() && to.isStruct()) {
//     const aList = _from.structSymbolTable().getFiltered(VariableSymbol);
//     const bList = to.structSymbolTable().getFiltered(VariableSymbol);

//     if (aList.length !== bList.length) {
//       throw new CompilerError(
//         `No implicit conversion from '${_from.getDisplayName()}' to '${to.getDisplayName()}': different number of fields`,
//         loc,
//       );
//     }

//     const exactMatchInTheOther = (
//       a: VariableSymbol,
//       bList: VariableSymbol[],
//     ) => {
//       for (const b of bList) {
//         if (a.name === b.name && a.type.isSame(b.type)) {
//           return true;
//         }
//       }
//       return false;
//     };

//     let equal = true;
//     for (const a of aList) {
//       if (!exactMatchInTheOther(a, bList)) {
//         equal = false;
//       }
//     }
//     for (const b of bList) {
//       if (!exactMatchInTheOther(b, aList)) {
//         equal = false;
//       }
//     }

//     if (equal) {
//       return expr;
//     }

//     throw new CompilerError(
//       `No implicit conversion from '${_from.getDisplayName()}' to '${to.getDisplayName()}'`,
//       loc,
//     );
//   }

//   throw new CompilerError(
//     `No implicit conversion from '${_from.getDisplayName()}' to '${to.getDisplayName()}'`,
//     loc,
//   );
// }
