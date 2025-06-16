// import type { Symbol } from "./Datatype";
// import type { Module } from "./Module";
// import { OutputWriter } from "./OutputWriter";
// import { ResolvedScope } from "./Scope";
// import { defineGenericsInScope } from "./utils";

// namespace Emit {
//   export function generateDeclarationCCode(
//     _datatype: Symbol.DatatypeSymbol,
//     program: Module,
//   ): OutputWriter {
//     const writer = new OutputWriter();
//     const scope = new ResolvedScope(_datatype.scope.location, _datatype.scope);
//     if (_datatype.type.variant === "Struct") {
//       defineGenericsInScope(_datatype.type.generics, scope);
//     }
//     const datatype: DatatypeSymbol = {
//       name: _datatype.name,
//       scope: _datatype.scope,
//       parentSymbol: _datatype.parentSymbol,
//       type: resolveGenerics(_datatype.type, scope, _datatype.scope.location),
//       export: _datatype.export,
//       location: _datatype.location,
//     };
//     switch (datatype.type.variant) {
//       case "Primitive":
//         return writer;

//       case "Struct":
//         if (!datatype.type.language) {
//           const struct = generateUsageCode(datatype.type, program);
//           writer.writeLine(`struct ${struct}_;`);
//           writer.writeLine(`typedef struct ${struct}_ ${struct};`);
//         }
//         return writer;

//       case "RawPointer":
//         const generic = datatype.type.pointee;
//         if (!generic) {
//           throw new ImpossibleSituation();
//         }
//         if ("constant" in generic) {
//           throw new InternalError("Cannot have constant in pointer");
//         }
//         writer.writeLine(
//           `typedef ${generateUsageCode(generic.type, program)}* ${mangleSymbol(datatype)};`,
//         );
//         return writer;

//       case "Function":
//         const params = datatype.type.functionParameters.map(([name, tp]) =>
//           generateUsageCode(tp, program),
//         );
//         if (datatype.type.vararg) {
//           params.push("...");
//         }
//         writer.write(
//           `typedef ${generateUsageCode(datatype.type.functionReturnType, program)} (*${generateUsageCode(datatype.type, program)})(${generateUsageCode(program.getBuiltinPrimitive("Context"), program)}* ctx${params.length > 0 ? ", " : ""}${params.join(", ")});`,
//         );
//         return writer;

//       case "Namespace":
//         return writer;
//     }
//     throw new InternalError(`Invalid variant ${datatype.type.variant}`);
//   }

//   export function generateDefinitionCCode(
//     _datatype: DatatypeSymbol,
//     program: Module,
//   ): OutputWriter {
//     const writer = new OutputWriter();
//     const scope = new ResolvedScope(_datatype.scope.location, _datatype.scope);
//     if (_datatype.type.variant === "Struct") {
//       defineGenericsInScope(_datatype.type.generics, scope);
//     }
//     const datatype: DatatypeSymbol = {
//       name: _datatype.name,
//       scope: _datatype.scope,
//       variant: _datatype.variant,
//       parentSymbol: _datatype.parentSymbol,
//       type: resolveGenerics(_datatype.type, scope, _datatype.scope.location),
//       export: _datatype.export,
//       location: _datatype.location,
//     };
//     switch (datatype.type.variant) {
//       case "Primitive":
//         return writer;

//       case "Struct":
//         if (!datatype.type.language) {
//           writer
//             .writeLine(`struct ${generateUsageCode(datatype.type, program)}_ {`)
//             .pushIndent();
//           for (const memberSymbol of datatype.type.members) {
//             if (memberSymbol.variant === "Variable") {
//               if (
//                 memberSymbol.type.variant === "Struct" &&
//                 memberSymbol.type.name === "__C_Array"
//               ) {
//                 const typeGeneric = memberSymbol.type.generics.get("_Arr_T");
//                 const sizeGeneric = memberSymbol.type.generics.get("_Arr_Size");
//                 if (!typeGeneric || !sizeGeneric) {
//                   throw new ImpossibleSituation();
//                 }
//                 if (typeGeneric.variant !== "Datatype") {
//                   throw new CompilerError(
//                     `A C-Array cannot take a constant as a datatype`,
//                     datatype.location,
//                   );
//                 }
//                 if (
//                   sizeGeneric.variant !== "LiteralConstant" ||
//                   !isInteger(sizeGeneric.type)
//                 ) {
//                   throw new CompilerError(
//                     `A C-Array can only take integer constants as size parameters`,
//                     datatype.location,
//                   );
//                 }
//                 writer.writeLine(
//                   `${generateUsageCode(typeGeneric.type, program)} ${memberSymbol.name}[${sizeGeneric.value.toString()}];`,
//                 );
//               } else {
//                 writer.writeLine(
//                   `${generateUsageCode(memberSymbol.type, program)} ${memberSymbol.name};`,
//                 );
//               }
//             } else {
//               writer.writeLine("union {").pushIndent();
//               for (const innerMember of memberSymbol.symbols) {
//                 writer.writeLine(
//                   `${generateUsageCode(innerMember.type, program)} ${innerMember.name};`,
//                 );
//               }
//               writer.popIndent().writeLine("};");
//             }
//           }
//           writer.popIndent().writeLine(`};`);
//         }
//         return writer;

//       case "RawPointer":
//         return writer;

//       case "Function":
//         return writer;

//       case "Namespace":
//         return writer;
//     }
//     throw new InternalError(`Invalid variant ${datatype.type.variant}`);
//   }

//   export function generateUsageCode(dt: Datatype, program: Module): string {
//     switch (dt.variant) {
//       case "Primitive":
//         switch (dt.primitive) {
//           case EPrimitive.none:
//             return "void";
//           case EPrimitive.unknown:
//             throw new InternalError(
//               "Type 'unknown' is compiler internal and must not appear in generated C-code",
//             );
//           case EPrimitive.boolean:
//             return "char";
//           case EPrimitive.booleanptr:
//             return "char*";
//           case EPrimitive.i8:
//             return "int8_t";
//           case EPrimitive.i16:
//             return "int16_t";
//           case EPrimitive.i32:
//             return "int32_t";
//           case EPrimitive.i64:
//             return "int64_t";
//           case EPrimitive.u8:
//             return "uint8_t";
//           case EPrimitive.u16:
//             return "uint16_t";
//           case EPrimitive.u32:
//             return "uint32_t";
//           case EPrimitive.u64:
//             return "uint64_t";
//           case EPrimitive.f32:
//             return "float";
//           case EPrimitive.f64:
//             return "double";
//           case EPrimitive.stringview:
//             return "char*";
//         }
//         throw new UnreachableCode();

//       case "RawPointer":
//         const ptrGeneric = dt.pointee.type;
//         if (!ptrGeneric) {
//           throw new ImpossibleSituation();
//         }
//         if ("constant" in ptrGeneric) {
//           throw new ImpossibleSituation();
//         }
//         return `${generateUsageCode(ptrGeneric, program)}*`;

//       case "Unresolved":
//         throw new InternalError(
//           "Cannot generate usage code for unresolved type",
//         );

//       case "Struct":
//         if (dt.language === ELinkage.Internal) {
//           return `_H${mangleDatatype(dt)}`;
//         } else {
//           return `${mangleDatatype(dt)}`;
//         }

//       case "Function":
//         return `_H${mangleDatatype(dt)}`;

//       case "Generic":
//         throw new InternalError("Cannot generate usage code for generic");

//       case "Namespace":
//         throw new InternalError(
//           "Cannot generate usage code for a namespace",
//           getCallerLocation(3),
//         );
//     }
//     // throw new InternalError(`Invalid variant ${dt.variant}`);
//   }

//   export function generateDatatypeDeclarationHazeCode(
//     datatype: Datatype,
//   ): OutputWriter {
//     const writer = new OutputWriter();
//     switch (datatype.variant) {
//       case "Primitive":
//         return writer;

//       case "Unresolved":
//         throw new ImpossibleSituation();

//       case "Struct": {
//         let generics: string[] = [];
//         for (const [name, tp] of datatype.generics) {
//           if (tp !== undefined) {
//             throw new ImpossibleSituation();
//           }
//           generics.push(name);
//         }
//         writer.write(
//           `struct ${datatype.name}${generics.length > 0 ? "<" + generics.join(",") + ">" : ""} {`,
//         );
//         for (const member of datatype.members) {
//           if (member.variant === "Variable") {
//             writer.write(
//               `${member.name}: ${generateDatatypeUsageHazeCode(member.type).get()};`,
//             );
//           } else {
//             writer.write(`unsafe_union {`);
//             for (const inner of member.symbols) {
//               writer.write(
//                 `${inner.name}: ${generateDatatypeUsageHazeCode(inner.type).get()};`,
//               );
//             }
//             writer.write(`}`);
//           }
//         }
//         for (const method of datatype.methods) {
//           let out = method.name + "(";
//           const params = [] as string[];
//           for (const [name, tp] of method.type.functionParameters) {
//             params.push(`${name}:${generateDatatypeUsageHazeCode(tp).get()}`);
//           }
//           if (method.type.vararg) {
//             params.push("...");
//           }
//           out += params.join(",");
//           out += `):${generateDatatypeUsageHazeCode(method.type.functionReturnType).get()};`;
//           writer.write(out);
//         }
//         writer.write("}");
//         return writer;
//       }

//       case "RawPointer": {
//         return writer;
//       }

//       case "Namespace": {
//         for (const symbol of datatype.symbolsScope.getSymbols()) {
//           writer.writeLine(generateSymbolUsageHazeCode(symbol));
//         }
//         return writer;
//       }
//     }
//     throw new InternalError("Invalid datatype: " + datatype.variant);
//   }

//   export function generateConstantUsageHazeCode(
//     constant: ConstantSymbol,
//   ): OutputWriter {
//     const writer = new OutputWriter();
//     switch (constant.variant) {
//       case "LiteralConstant": {
//         writer.write(constant.value.toString());
//         if (constant.unit) {
//           writer.write(constant.unit);
//         }
//         return writer;
//       }

//       case "StringConstant":
//       case "BooleanConstant": {
//         writer.write(constant.value.toString());
//         return writer;
//       }
//     }
//     throw new UnreachableCode();
//   }

//   export function generateDatatypeUsageHazeCode(
//     datatype: Datatype,
//   ): OutputWriter {
//     const writer = new OutputWriter();
//     switch (datatype.variant) {
//       case "Primitive":
//         writer.write(primitiveVariantToString(datatype));
//         return writer;

//       case "Unresolved":
//         throw new ImpossibleSituation();

//       case "Struct": {
//         let generics: string[] = [];
//         for (const [name, tp] of datatype.generics) {
//           if (tp === undefined) {
//             generics.push(name);
//           } else if (tp.variant !== "Datatype") {
//             generics.push(generateConstantUsageHazeCode(tp).get());
//           } else {
//             generics.push(generateDatatypeUsageHazeCode(tp.type).get());
//           }
//         }
//         const namespaces = [] as string[];
//         let p: Symbol | undefined = datatype.parentSymbol;
//         while (p) {
//           if (p.variant !== "Datatype" || p.type.variant !== "Namespace") {
//             throw new InternalError("Unexpected parent");
//           }
//           namespaces.unshift(p.type.name);
//           p = p.parentSymbol;
//         }
//         writer.write(
//           `${namespaces.map((n) => n + ".").join("")}${datatype.name}${generics.length > 0 ? "<" + generics.join(",") + ">" : ""}`,
//         );
//         return writer;
//       }

//       case "RawPointer": {
//         writer.write(
//           `RawPtr<${generateDatatypeUsageHazeCode(datatype.pointee.type).get()}>`,
//         );
//         return writer;
//       }

//       case "Generic": {
//         writer.write(`${datatype.name}`);
//         return writer;
//       }
//     }
//     throw new UnreachableCode();
//   }

//   export function generateSymbolUsageHazeCode(symbol: Symbol) {
//     const writer = new OutputWriter();
//     switch (symbol.variant) {
//       case "Datatype": {
//         const namespaces = [] as string[];
//         let p = symbol.parentSymbol;
//         while (p) {
//           if (p.variant !== "Datatype" || p.type.variant !== "Namespace") {
//             throw new InternalError("Unexpected parent");
//           }
//           namespaces.unshift(p.type.name);
//           p = p.parentSymbol;
//         }
//         let out = "";
//         if (symbol.type.variant === "Struct" && symbol.type.generics.size > 0) {
//           if (!symbol.originalGenericSourcecode) {
//             throw new InternalError("Generic struct is missing ctx");
//           }
//           out = symbol.originalGenericSourcecode;
//         } else {
//           out = generateDatatypeDeclarationHazeCode(symbol.type).get();
//         }
//         if (namespaces.length > 0) {
//           writer.write(`namespace ${namespaces.join(".")} {${out}}`);
//         } else {
//           writer.write(out);
//         }
//         return writer;
//       }

//       case "Function": {
//         const namespaces = [] as string[];
//         let p = symbol.parentSymbol;
//         while (p) {
//           if (p.variant === "Function") {
//             // noop
//           } else if (p.variant === "Datatype") {
//             if (p.type.variant === "Struct") {
//               // noop
//             } else if (p.type.variant !== "Namespace") {
//               throw new InternalError("Unexpected parent: " + p.type.variant);
//             }
//             namespaces.unshift(p.type.name);
//           } else {
//             throw new InternalError("Unexpected symbol type: " + p.variant);
//           }
//           p = p.parentSymbol;
//         }
//         let tp = "";
//         if (symbol.extern == ELinkage.External) {
//           tp += "extern ";
//         } else if (symbol.extern == ELinkage.External_C) {
//           tp += 'extern "C" ';
//         }
//         tp += symbol.name + "(";
//         const params = [] as string[];
//         for (const [name, tp] of symbol.type.functionParameters) {
//           params.push(`${name}:${generateDatatypeUsageHazeCode(tp).get()}`);
//         }
//         if (symbol.type.vararg) {
//           params.push("...");
//         }
//         tp += params.join(",");
//         tp += `):${generateDatatypeUsageHazeCode(symbol.type.functionReturnType).get()};`;
//         if (namespaces.length > 0) {
//           writer.write(`namespace ${namespaces.join(".")} {${tp}}`);
//         } else {
//           writer.write(tp);
//         }
//         return writer;
//       }

//       case "Variable": {
//         const namespaces = [] as string[];
//         let p = symbol.parentSymbol;
//         while (p) {
//           if (p.variant === "Function") {
//             // noop
//           } else if (p.variant === "Datatype") {
//             if (p.type.variant === "Struct") {
//               // noop
//             } else if (p.type.variant !== "Namespace") {
//               throw new InternalError("Unexpected parent: " + p.type.variant);
//             }
//             namespaces.unshift(p.type.name);
//           } else {
//             throw new InternalError("Unexpected symbol type: " + p.variant);
//           }
//           p = p.parentSymbol;
//         }
//         let out = "";
//         if (symbol.extern == ELinkage.External) {
//           out += "extern ";
//         } else if (symbol.extern == ELinkage.External_C) {
//           out += 'extern "C" ';
//         }
//         switch (symbol.variableType) {
//           case EVariableMutability.ConstantStructField:
//           case EVariableMutability.ConstantVariable:
//             out += "const ";
//             break;

//           case EVariableMutability.MutableStructField:
//           case EVariableMutability.MutableVariable:
//             out += "let ";
//             break;

//           case EVariableMutability.Parameter:
//             throw new ImpossibleSituation();
//         }
//         out +=
//           symbol.name +
//           ":" +
//           generateDatatypeUsageHazeCode(symbol.type).get() +
//           ";";
//         if (namespaces.length > 0) {
//           writer.write(`namespace ${namespaces.join(".")} {${out}}`);
//         } else {
//           writer.write(out);
//         }
//         return writer;
//       }
//     }
//     throw new UnreachableCode();
//   }

//   export function isSame(a: Datatype, b: Datatype): boolean {
//     if (a.variant === "Primitive" && b.variant === "Primitive") {
//       return a.primitive === b.primitive;
//     }

//     if (a.variant === "RawPointer" && b.variant === "RawPointer") {
//       return isSame(a.pointee.type, b.pointee.type);
//     }

//     if (a.variant === "Function" && b.variant === "Function") {
//       if (!a.functionReturnType || !b.functionReturnType) {
//         return false;
//       }
//       if (!isSame(a.functionReturnType, b.functionReturnType)) {
//         return false;
//       }
//       if (a.functionParameters.length !== b.functionParameters.length) {
//         return false;
//       }
//       for (let i = 0; i < a.functionParameters.length; i++) {
//         if (!isSame(a.functionParameters[i][1], b.functionParameters[i][1])) {
//           return false;
//         }
//       }
//       return true;
//     }

//     if (a.variant === "Struct" && b.variant === "Struct") {
//       if (a.members.length !== b.members.length) {
//         return false;
//       }
//       for (let i = 0; i < a.members.length; i++) {
//         const aa: VariableSymbol | StructMemberUnion = a.members[i];
//         const bb: VariableSymbol | StructMemberUnion = b.members[i];
//         if (aa.variant !== bb.variant) {
//           return false;
//         }
//         if (aa.variant === "Variable" && bb.variant === "Variable") {
//           // Prevent infinite recursion if: struct Test { member: RawPtr<Test> }
//           if (aa.type === a && bb.type !== b) {
//             return false;
//           }
//           if (aa.type !== a && bb.type === b) {
//             return false;
//           }
//           if (aa.type.variant !== bb.type.variant) {
//             return false;
//           }
//           if (
//             aa.type.variant === "RawPointer" &&
//             bb.type.variant === "RawPointer"
//           ) {
//             if (
//               mangleDatatype(aa.type.pointee.type) !==
//               mangleDatatype(bb.type.pointee.type)
//             ) {
//               return false;
//             }
//           }
//         } else if (
//           aa.variant === "StructMemberUnion" &&
//           bb.variant === "StructMemberUnion"
//         ) {
//           for (let j = 0; j < aa.symbols.length; j++) {
//             if (
//               aa.symbols[i].name !== bb.symbols[i].name ||
//               !isSame(aa.symbols[i].type, bb.symbols[i].type)
//             ) {
//               return false;
//             }
//           }
//         }
//       }
//       return true;
//     }
//     return false;
//   }

//   const exactMatchInTheOther = (
//     a: VariableSymbol | StructMemberUnion,
//     bList: (VariableSymbol | StructMemberUnion)[],
//   ) => {
//     if (a.variant === "Variable") {
//       for (const b of bList) {
//         if (b.variant === "Variable") {
//           if (a.name === b.name && isSame(a.type, b.type)) {
//             return true;
//           }
//         }
//       }
//     } else {
//       for (const b of bList) {
//         if (b.variant === "StructMemberUnion") {
//           for (const inner of a.symbols) {
//             if (!exactMatchInTheOther(inner, b.symbols)) {
//               return false;
//             }
//           }
//           for (const inner of b.symbols) {
//             if (!exactMatchInTheOther(inner, a.symbols)) {
//               return false;
//             }
//           }
//           return true;
//         }
//       }
//     }
//     return false;
//   };

//   export function implicitConversion(
//     _from: Datatype,
//     _to: Datatype,
//     expr: string,
//     scope: ResolvedScope,
//     loc: Location,
//     program: Module,
//   ): string {
//     const from = resolveGenerics(_from, scope, loc);
//     const to = resolveGenerics(_to, scope, loc);

//     if (isSame(from, to)) {
//       return expr;
//     }

//     if (from.variant === "Primitive" && to.variant === "Primitive") {
//       if (isInteger(from) && isBoolean(to)) {
//         return `(${expr} != 0)`;
//       }
//       if (isBoolean(from) && isInteger(to)) {
//         return `(${expr} ? 1 : 0)`;
//       }
//       if (isInteger(from) && isInteger(to)) {
//         return `(${generateUsageCode(to, program)})(${expr})`;
//       }
//       if (isFloat(from) && isFloat(to)) {
//         return `(${generateUsageCode(to, program)})(${expr})`;
//       }
//       if (isInteger(from) && isFloat(to)) {
//         return `(${generateUsageCode(to, program)})(${expr})`;
//       }
//       if (isFloat(from) && isInteger(to)) {
//         printWarningMessage(
//           `Implicit conversion from ${serializeDatatype(from)} to ${serializeDatatype(to)} may lose precision`,
//           loc,
//         );
//         return `(${generateUsageCode(to, program)})(${expr})`;
//       }
//       throw new CompilerError(
//         `No implicit conversion from ${serializeDatatype(from)} to ${serializeDatatype(to)}`,
//         loc,
//       );
//     }

//     if (
//       from.variant === "RawPointer" &&
//       to.variant === "Primitive" &&
//       to.primitive === EPrimitive.boolean
//     ) {
//       return `(${expr} != 0)`;
//     }

//     if (from.variant === "RawPointer" && to.variant === "RawPointer") {
//       if (isSame(from.pointee.type, to.pointee.type)) {
//         return expr;
//       }
//       if (
//         to.pointee.type.variant === "Primitive" &&
//         to.pointee.type.primitive === EPrimitive.none
//       ) {
//         return `(void*)(${expr})`;
//       }
//       throw new CompilerError(
//         `No implicit conversion from ${serializeDatatype(from)} to ${serializeDatatype(to)}`,
//         loc,
//       );
//     }

//     if (from.variant === "Function" && to.variant === "Function") {
//       if (isSame(from.functionReturnType, to.functionReturnType)) {
//         if (from.functionParameters.length === to.functionParameters.length) {
//           let equal = true;
//           for (let i = 0; i < from.functionParameters.length; i++) {
//             if (
//               !isSame(
//                 from.functionParameters[i][1],
//                 to.functionParameters[i][1],
//               )
//             ) {
//               equal = false;
//             }
//           }
//           if (equal) {
//             return expr;
//           }
//         }
//       }
//       throw new CompilerError(
//         `No implicit conversion from '${serializeDatatype(from)}' to '${serializeDatatype(to)}'`,
//         loc,
//       );
//     }

//     if (from.variant === "Struct" && to.variant === "Struct") {
//       if (from.members.length !== to.members.length) {
//         throw new CompilerError(
//           `No implicit conversion from '${serializeDatatype(from)}' to '${serializeDatatype(to)}': different number of fields`,
//           loc,
//         );
//       }

//       let equal = true;
//       for (const a of from.members) {
//         if (!exactMatchInTheOther(a, to.members)) {
//           equal = false;
//         }
//       }
//       for (const b of to.members) {
//         if (!exactMatchInTheOther(b, from.members)) {
//           equal = false;
//         }
//       }

//       if (equal) {
//         return expr;
//       }

//       throw new CompilerError(
//         `No implicit conversion from '${serializeDatatype(from)}' to '${serializeDatatype(to)}'`,
//         loc,
//       );
//     }

//     throw new CompilerError(
//       `No implicit conversion from '${serializeDatatype(from)}' to '${serializeDatatype(to)}'`,
//       loc,
//     );
//   }

//   export function explicitConversion(
//     _from: Datatype,
//     _to: Datatype,
//     expr: string,
//     scope: ResolvedScope,
//     loc: Location,
//     program: Module,
//   ): string {
//     const from = resolveGenerics(_from, scope, loc);
//     const to = resolveGenerics(_to, scope, loc);

//     if (isSame(from, to)) {
//       return expr;
//     }

//     if (from.variant === "Primitive" && to.variant === "Primitive") {
//       if (isInteger(from) && isBoolean(to)) {
//         return `(${expr} != 0)`;
//       }
//       if (isBoolean(from) && isInteger(to)) {
//         return `(${expr} ? 1 : 0)`;
//       }
//       if (isInteger(from) && isInteger(to)) {
//         return `(${generateUsageCode(to, program)})(${expr})`;
//       }
//       if (isFloat(from) && isFloat(to)) {
//         return `(${generateUsageCode(to, program)})(${expr})`;
//       }
//       if (isInteger(from) && isFloat(to)) {
//         return `(${generateUsageCode(to, program)})(${expr})`;
//       }
//       if (isFloat(from) && isInteger(to)) {
//         return `(${generateUsageCode(to, program)})(${expr})`;
//       }
//       throw new CompilerError(
//         `No explicit conversion from ${serializeDatatype(from)} to ${serializeDatatype(to)}`,
//         loc,
//       );
//     }

//     if (
//       from.variant === "RawPointer" &&
//       to.variant === "Primitive" &&
//       to.primitive === EPrimitive.boolean
//     ) {
//       return `(${expr} != 0)`;
//     }

//     if (
//       from.variant === "Primitive" &&
//       from.primitive === EPrimitive.stringview &&
//       to.variant === "RawPointer" &&
//       to.pointee.type.variant === "Primitive" &&
//       to.pointee.type.primitive === EPrimitive.u8
//     ) {
//       return `(${generateUsageCode(to, program)})(${expr})`;
//     }

//     if (
//       to.variant === "Primitive" &&
//       to.primitive === EPrimitive.stringview &&
//       from.variant === "RawPointer" &&
//       from.pointee.type.variant === "Primitive" &&
//       from.pointee.type.primitive === EPrimitive.u8
//     ) {
//       return `(${generateUsageCode(to, program)})(${expr})`;
//     }

//     if (from.variant === "RawPointer" && isInteger(to)) {
//       return `(${generateUsageCode(to, program)})(${expr})`;
//     }
//     if (to.variant === "RawPointer" && isInteger(from)) {
//       return `(${generateUsageCode(to, program)})(${expr})`;
//     }

//     if (from.variant === "RawPointer" && to.variant === "RawPointer") {
//       return `(${generateUsageCode(to.pointee.type, program)}*)(${expr})`;
//     }

//     if (from.variant === "Function" && to.variant === "Function") {
//       if (isSame(from.functionReturnType, to.functionReturnType)) {
//         if (from.functionParameters.length === to.functionParameters.length) {
//           let equal = true;
//           for (let i = 0; i < from.functionParameters.length; i++) {
//             if (
//               !isSame(
//                 from.functionParameters[i][1],
//                 to.functionParameters[i][1],
//               )
//             ) {
//               equal = false;
//             }
//           }
//           if (equal) {
//             return expr;
//           }
//         }
//       }
//       throw new CompilerError(
//         `No explicit conversion from '${serializeDatatype(from)}' to '${serializeDatatype(to)}'`,
//         loc,
//       );
//     }

//     if (from.variant === "Struct" && to.variant === "Struct") {
//       if (from.members.length !== to.members.length) {
//         throw new CompilerError(
//           `No explicit conversion from '${serializeDatatype(from)}' to '${serializeDatatype(to)}': different number of fields`,
//           loc,
//         );
//       }

//       let equal = true;
//       for (const a of from.members) {
//         if (!exactMatchInTheOther(a, to.members)) {
//           equal = false;
//         }
//       }
//       for (const b of to.members) {
//         if (!exactMatchInTheOther(b, from.members)) {
//           equal = false;
//         }
//       }

//       if (equal) {
//         return expr;
//       }

//       throw new CompilerError(
//         `No explicit conversion from '${serializeDatatype(from)}' to '${serializeDatatype(to)}'`,
//         loc,
//       );
//     }

//     throw new CompilerError(
//       `No explicit conversion from '${serializeDatatype(from)}' to '${serializeDatatype(to)}'`,
//       loc,
//     );
//   }
// }
