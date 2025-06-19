import type { Module } from "./Module";

// export namespace Datatype_OLD {
//   export class Struct {
//     getFlattenedMembers() {
//       const members = [] as Symbol.VariableSymbol[];
//       for (const member of this.members) {
//         if (member instanceof Symbol.VariableSymbol) {
//           members.push(member);
//         } else {
//           for (const inner of member.members) {
//             members.push(inner);
//           }
//         }
//       }
//       return members;
//     }

//     findMember(name: string) {
//       for (const member of this.members) {
//         if (member instanceof Symbol.VariableSymbol) {
//           if (member.name === name) {
//             return member;
//           }
//         } else {
//           for (const inner of member.members) {
//             if (inner.name === name) {
//               return inner;
//             }
//           }
//         }
//       }
//     }

//     findMethod(module: Module, name: string) {
//       for (const member of this.methods) {
//         const m = module.parsedStore
//           .getSymbol(member, this.isResolved)
//           .asFunctionSymbol();
//         if (m.name === name) {
//           return member;
//         }
//       }
//     }

//     serialize(module: Module): string {}

//     mangle(module: Module) {
//     }

//     resolve(module: Module): BaseDatatype {
//       const resolved = module.parsedStore.getTypeAlreadyResolved(this);
//       if (resolved) {
//         return resolved;
//       } else {
//         const hash = this.hash(module);
//         const resolved = new Struct(
//           module.parsedStore.makeResolvedTypeId(),
//           true,
//           this.name,
//           this.linkage,
//           this.members.map((m) => {
//             if (m instanceof Symbol.VariableSymbol) {
//               return module.parsedStore.resolveSymbol(m.id);
//             } else {
//               return module.parsedStore.resolveSymbol(
//                 m.id,
//               ) as Symbol.StructUnion;
//             }
//           }),
//           this.methods.map(
//             (m) =>
//               module.parsedStore.resolveSymbol(m.id) as Symbol.FunctionSymbol,
//           ),
//           this.parentSymbol &&
//             module.parsedStore.resolveSymbol(this.parentSymbol).id,
//         );
//         module.parsedStore.addResolvedType(hash, resolved);
//         return resolved;
//       }
//     }
//   }

//   export class RawPointer extends BaseDatatype {
//     constructor(
//       id: TypeId,
//       isResolved: boolean,
//       public pointee: SymbolId,
//     ) {
//       super(id, isResolved);
//     }

//     isRawPointer(): this is RawPointer {
//       return true;
//     }

//     serialize(module: Module): string {
//       return `RawPtr<${module.parsedStore.resolveSymbol(this.pointee).asDatatypeSymbol().type.serialize(module)}>`;
//     }

//     mangle(module: Module) {
//       let ptrMangled = "PI";
//       if (this.pointee) {
//         ptrMangled += module.parsedStore
//           .resolveType(
//             module.parsedStore.resolveSymbol(this.pointee).asDatatypeSymbol()
//               .type,
//           )
//           .mangle(module);
//       } else {
//         throw new InternalError("Pointer pointing to nothing");
//       }
//       ptrMangled += "E";
//       return ptrMangled;
//     }

//     resolve(module: Module): BaseDatatype {
//       const resolved = module.parsedStore.getTypeAlreadyResolved(this);
//       if (resolved) {
//         return resolved;
//       } else {
//         const mangled = this.mangle(module);
//         const resolved = new RawPointer(
//           module.parsedStore.makeResolvedTypeId(),
//           true,
//           module.parsedStore.resolveSymbol(this.pointee).id,
//         );
//         module.parsedStore.addResolvedType(mangled, resolved);
//         return resolved;
//       }
//     }
//   }

//     mangle(module: Module) {
//       const s = this.toString();
//       return s.length.toString() + s;
//     }

//     resolve(module: Module): BaseDatatype {
//       const resolved = module.parsedStore.getTypeAlreadyResolved(this);
//       if (resolved) {
//         return resolved;
//       } else {
//         const mangled = this.mangle(module);
//         const resolved = new Primitive(
//           module.parsedStore.makeResolvedTypeId(),
//           true,
//           this.primitive,
//         );
//         module.parsedStore.addResolvedType(mangled, resolved);
//         return resolved;
//       }
//     }
//   }

//   export class Namespace extends BaseDatatype {
//     constructor(
//       id: TypeId,
//       isResolved: boolean,
//       public name: string,
//       public symbolsScope: ScopeId,
//     ) {
//       super(id, isResolved);
//     }

//     isNamespace(): this is Namespace {
//       return true;
//     }

//     serialize(module: Module): string {
//       return this.name;
//     }

//     mangle(module: Module) {
//       return this.name.length.toString() + this.name;
//     }

//     hash(module: Module): Hash {
//       throw new InternalError("Namespaces are not supposed to be hashed");
//     }

//     resolve(module: Module): BaseDatatype {
//       throw new InternalError("Namespaces are not supposed to be resolved");
//     }
//   }
// }

// export namespace Symbol_OLD {
//   export abstract class BaseSymbol {
//     constructor(
//       public id: SymbolId,
//       public isResolved: boolean,
//     ) {}

//     isVariable(): this is VariableSymbol {
//       return false;
//     }
//     isStructUnion(): this is StructUnion {
//       return false;
//     }
//     isFunction(): this is FunctionSymbol {
//       return false;
//     }
//     isDatatype(): this is DatatypeSymbol {
//       return false;
//     }
//     isConstant(): this is ConstantSymbol {
//       return false;
//     }
//     isGeneric(module: Module) {
//       if (this.isFunction() || this.isDatatype() || this.isVariable()) {
//         let p = this.parentSymbol;
//         while (p) {
//           const dt = module.parsedStore.getSymbolOrFail(p).asDatatypeSymbol();
//           if (dt.type.isGeneric()) {
//             return true;
//           }
//           if (this.isFunction() || this.isDatatype() || this.isVariable()) {
//             p = dt.parentSymbol;
//           }
//         }
//       } else {
//         return false;
//       }
//     }
//     asDatatypeSymbol(): DatatypeSymbol {
//       if (this.isDatatype()) {
//         return this;
//       }
//       throw new InternalError(
//         "Symbol cast failed because the symbol is not a datatype symbol",
//       );
//     }
//     asVariableSymbol(): VariableSymbol {
//       if (this.isVariable()) {
//         return this;
//       }
//       throw new InternalError(
//         "Symbol cast failed because the symbol is not a variable symbol",
//       );
//     }
//     asFunctionSymbol(): FunctionSymbol {
//       if (this.isFunction()) {
//         return this;
//       }
//       throw new InternalError(
//         "Symbol cast failed because the symbol is not a function symbol",
//       );
//     }
//     queryDatatype(module: Module): Datatype.BaseDatatype {
//       if (this.isVariable() || this.isFunction()) {
//         return module.parsedStore.getSymbolOrFail(this.type).asDatatypeSymbol()
//           .type;
//       } else if (this.isConstant()) {
//         return module.parsedStore
//           .getSymbolOrFail(this.constant.type)
//           .asDatatypeSymbol().type;
//       } else if (this.isDatatype()) {
//         return this.type;
//       }
//       throw new ImpossibleSituation();
//     }
//     serialize(module: Module): string {
//       let name = "";
//       if (this.isDatatype() || this.isFunction() || this.isVariable()) {
//         if (this.parentSymbol) {
//           let p = this.queryParentSymbol(module);
//           while (p) {
//             name = `${p.queryDatatype(module).serialize(module)}.${name}`;
//             p = p.queryParentSymbol(module);
//           }
//         }
//         name += this.name;
//       }
//       const tp = this.queryDatatype(module);
//       return ` * ${name}: ${tp.serialize(module)}      [mangle]: ${this.mangle(module)} ${tp.isStruct() && tp.linkage !== ELinkage.Internal ? "(declared)" : ""}`;
//     }
//     abstract mangle(module: Module): string;
//     abstract getName(): string;
//     abstract getLocation(): Location;

//     abstract resolve(module: Module): BaseSymbol;
//   }

//   export class VariableSymbol extends BaseSymbol {
//     constructor(
//       id: SymbolId,
//       isResolved: boolean,
//       public name: string,
//       public type: TypeId,
//       public variableType: EVariableMutability,
//       public variableContext: EVariableContext,
//       public isExported: boolean,
//       public linkage: ELinkage,
//       public location: Location,
//       public parentSymbol?: SymbolId,
//       public ctx?: VariableDefinitionContext | VariableDeclarationContext,
//     ) {
//       super(id, isResolved);
//     }

//     isVariable(): this is VariableSymbol {
//       return true;
//     }

//     mangle(module: Module) {
//       if (this.variableContext === EVariableContext.Global) {
//         let mangled = "_H";
//         if (this.parentSymbol) {
//           let p = this.queryParentSymbol(module);
//           mangled += "N";
//           while (p) {
//             mangled += p.queryDatatype(module).mangle(module);
//             p = p.queryParentSymbol(module);
//           }
//         }
//         mangled += this.name.length.toString();
//         mangled += this.name;
//         if (this.parentSymbol) {
//           mangled += "E";
//         }
//         return mangled;
//       } else {
//         return this.name;
//       }
//     }
//     getName() {
//       return this.name;
//     }

//     getLocation() {
//       return this.location;
//     }

//     resolve(module: Module): BaseSymbol {
//       return new VariableSymbol(
//         module.parsedStore.makeResolvedSymbolId(),
//         true,
//         this.name,
//         module.parsedStore.resolveType(this.type),
//         this.variableType,
//         this.variableContext,
//         this.isExported,
//         this.linkage,
//         this.location,
//         this.parentSymbol,
//         this.ctx,
//       );
//     }
//   }

//   export class StructUnion extends BaseSymbol {
//     constructor(
//       id: SymbolId,
//       isResolved: boolean,
//       public location: Location,
//       public members: SymbolId[],
//       public parentSymbol?: SymbolId,
//       public ctx?: VariableDefinitionContext | VariableDeclarationContext,
//     ) {
//       super(id, isResolved);
//     }

//     isStructUnion(): this is StructUnion {
//       return true;
//     }

//     mangle(module: Module): string {
//       throw new InternalError("Mangling unions not implemented");
//     }

//     getName(): string {
//       throw new InternalError("Cannot get name of union");
//     }

//     getLocation() {
//       return this.location;
//     }

//     resolve(module: Module): BaseSymbol {
//       return new StructUnion(
//         module.parsedStore.makeResolvedSymbolId(),
//         true,
//         this.location,
//         this.members.map((m) => {
//           return module.parsedStore.resolveSymbol(m);
//         }),
//         this.parentSymbol,
//         this.ctx,
//       );
//     }
//   }

//   export class GenericParameterSymbol extends BaseSymbol {
//     public parentSymbol?: SymbolId = undefined;

//     constructor(
//       id: SymbolId,
//       public visibleName: string,
//       public location: Location,
//     ) {
//       super(id, false);
//     }

//     isDatatype(): this is DatatypeSymbol {
//       return true;
//     }

//     mangle(module: Module): string {
//       throw new Error("Generic placeholders cannot be mangled");
//     }

//     getName() {
//       return this.visibleName;
//     }

//     getLocation() {
//       return this.location;
//     }
//   }

//   export class FunctionSymbol extends BaseSymbol {
//     constructor(
//       id: SymbolId,
//       isResolved: boolean,
//       public name: string,
//       public type: TypeId,
//       public linkage: ELinkage,
//       public bodyScope: ScopeId,
//       public definedInScope: ScopeId,
//       public isExported: boolean,
//       public location: Location,
//       public kindOfFunction: EKindOfFunction,
//       public parentSymbol?: SymbolId,
//       public thisPointerExpr?: Expression,
//       public ctx?: ParserRuleContext,
//     ) {
//       super(id, isResolved);
//     }

//     isFunction(): this is FunctionSymbol {
//       return true;
//     }

//     isGeneric() {
//       return false;
//     }

//     mangle(module: Module) {
//       if (this.linkage === ELinkage.External_C) {
//         return this.name;
//       }
//       let mangled = "_H";
//       if (this.parentSymbol) {
//         let p = this.queryParentSymbol(module);
//         mangled += "N";
//         while (p) {
//           mangled += p.mangle(module);
//           p = p.queryParentSymbol(module);
//         }
//       }
//       mangled += this.name.length.toString();
//       mangled += this.name;
//       if (this.parentSymbol) {
//         mangled += "E";
//       }
//       return mangled;
//     }
//     getName() {
//       return this.name;
//     }

//     getLocation() {
//       return this.location;
//     }
//   }

//   export class DatatypeSymbol extends BaseSymbol {
//     public parentSymbol?: SymbolId = undefined;
//     // public originalGenericSourcecode?: string;

//     constructor(
//       id: SymbolId,
//       isResolved: boolean,
//       public name: string,
//       public type: TypeId,
//       public definedInScope: ScopeId,
//       public isExported: boolean,
//       public location: Location,
//     ) {
//       super(id, isResolved);
//     }

//     isDatatype(): this is DatatypeSymbol {
//       return true;
//     }

//     mangle(module: Module) {
//     }

//     getName() {
//       return this.name;
//     }

//     getLocation() {
//       return this.location;
//     }
//   }
