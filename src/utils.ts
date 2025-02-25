import {
  serializeDatatype,
  type Datatype,
  type FunctionDatatype,
  type Generics,
  type RawPointerDatatype,
  type StructDatatype,
} from "./Datatype";
import {
  CompilerError,
  ImpossibleSituation,
  InternalError,
  type Location,
} from "./Errors";
import type { CommonDatatypeContext } from "./parser/HazeParser";
import type HazeVisitor from "./parser/HazeVisitor";
import type { Program } from "./Program";
import { Scope } from "./Scope";
import {
  isSymbolGeneric,
  mangleDatatype,
  mangleSymbol,
  serializeSymbol,
  type DatatypeSymbol,
} from "./Symbol";

export function defineGenericsInScope(generics: Generics, scope: Scope) {
  for (const [name, tp] of generics) {
    if (tp) {
      scope.defineSymbol(
        { variant: "Datatype", name: name, type: tp, scope: scope },
        scope.location,
      );
    }
  }
}

export function resolveGenerics(
  datatype: Datatype,
  scope: Scope,
  loc: Location,
): Datatype {
  switch (datatype.variant) {
    case "Generic":
      const symbol = scope.lookupSymbol(datatype.name, loc);
      //   if (symbol.type.isGeneric()) {
      //     return datatype;
      //   }
      return symbol.type;

    case "RawPointer":
      const generics = new Map(datatype.generics);
      const tempScope2 = new Scope(scope.location, scope);
      defineGenericsInScope(datatype.generics, tempScope2);
      for (const [name, tp] of datatype.generics) {
        const s = tempScope2.tryLookupSymbol(name, loc);
        if (s) {
          generics.set(name, s.type);
        }
      }
      const newRawPtr: RawPointerDatatype = {
        variant: "RawPointer",
        generics: generics,
      };
      return newRawPtr;

    case "Struct":
      const newType: StructDatatype = {
        variant: "Struct",
        name: datatype.name,
        generics: new Map(datatype.generics),
        members: [],
        methods: [],
      };
      const tempScope = new Scope(scope.location, scope);
      defineGenericsInScope(datatype.generics, tempScope);
      for (const [name, tp] of datatype.generics) {
        const s = tempScope.tryLookupSymbol(name, loc);
        if (s) {
          newType.generics.set(name, s.type);
        }
      }
      for (const field of datatype.members) {
        newType.members.push({
          name: field.name,
          type: resolveGenerics(field.type, tempScope, loc),
          variant: "Variable",
          variableType: field.variableType,
        });
      }
      // for (const method of datatype.methods) {
      //   newType.methods.push({
      //     name: method.name,
      //     type: resolveGenerics(method.type, scope, loc) as FunctionDatatype,
      //     variant: "Function",
      //     functionType: method.functionType,
      //     scope: method.scope,
      //     ctx: method.ctx,
      //     isConstructor: method.isConstructor,
      //     parentSymbol: method.parentSymbol,
      //     thisPointer: method.thisPointer,
      //   });
      // }
      //   const generics: Array<[string, Datatype | null]> = [];
      //   for (let i = 0; i < datatype.generics().length; i++) {
      //     const sym = scope.lookupSymbol(datatype.generics()[i][0], loc);
      //     if (sym.type.isGeneric()) {
      //       generics.push([sym.name, null]);
      //     } else {
      //       generics.push([sym.name, sym.type]);
      //     }
      //   }
      //   const dt = Datatype.createStructDatatype(
      //     datatype.name(),
      //     generics,
      //     symbolTable,
      //   );
      //   return dt;
      return newType;

    case "Function":
      if (datatype.variant !== "Function") {
        throw new ImpossibleSituation();
      }

      const tempFuncScope = new Scope(loc, scope);

      if (datatype.functionReturnType.variant === "Struct") {
        defineGenericsInScope(
          datatype.functionReturnType.generics,
          tempFuncScope,
        );
      }

      const newFunctype: FunctionDatatype = {
        variant: "Function",
        functionParameters: [],
        functionReturnType: resolveGenerics(
          datatype.functionReturnType,
          tempFuncScope,
          loc,
        ),
      };
      for (let i = 0; i < datatype.functionParameters.length; i++) {
        const parScope = new Scope(loc, scope);
        const par = datatype.functionParameters[i];
        if (par[1].variant === "Struct") {
          defineGenericsInScope(par[1].generics, parScope);
        }
        const t = resolveGenerics(par[1], parScope, loc);
        newFunctype.functionParameters.push([par[0], t]);
      }
      return newFunctype;

    // case "":
    //   if (datatype.pointee() === null) {
    //     throw new UnreachableCode();
    //   }
    //   const pointee = resolveGenerics(datatype.pointee(), scope, loc);
    //   return Datatype.createPointerDatatype(pointee);

    case "Deferred":
      return datatype;

    case "Primitive":
      return datatype;
  }

  //   throw new InternalError(`Invalid variant: ${datatype.variant}`);
}

export const visitCommonDatatypeImpl = (
  _this: HazeVisitor<any>,
  program: Program,
  ctx: CommonDatatypeContext,
): Datatype => {
  const name = ctx.ID().getText();
  const symbol = program.currentScope.lookupSymbol(name, program.getLoc(ctx));
  if (symbol.variant !== "Datatype") {
    throw new ImpossibleSituation();
  }

  const genericsProvided: Datatype[] = ctx
    .datatype_list()
    .map((n) => _this.visit(n));
  switch (symbol.type.variant) {
    case "Primitive":
      if (genericsProvided.length > 0) {
        throw new CompilerError(
          `Type '${name}' expected no generic arguments but got ${genericsProvided.length}.`,
          program.getLoc(ctx),
        );
      }
      return symbol.type;

    case "Generic":
      return symbol.type;

    case "RawPointer":
      if (genericsProvided.length != symbol.type.generics.size) {
        throw new CompilerError(
          `Type '${name}<>' expected ${symbol.type.generics.size} generic arguments but got ${genericsProvided.length}.`,
          program.getLoc(ctx),
        );
      }

      const ptrGenerics = new Map(symbol.type.generics);
      let ptrIndex = 0;
      for (const i of symbol.type.generics.keys()) {
        if (genericsProvided[ptrIndex].variant !== "Generic") {
          ptrGenerics.set(i, genericsProvided[ptrIndex]);
        } else {
          ptrGenerics.set(i, undefined);
        }
        ptrIndex++;
      }

      const ptrtype: RawPointerDatatype = {
        variant: "RawPointer",
        generics: ptrGenerics,
      };

      if (
        ptrGenerics
          .entries()
          .every((e) => e[1] !== undefined && e[1].variant !== "Generic")
      ) {
        datatypeSymbolUsed(
          {
            name: symbol.name,
            scope: symbol.scope,
            type: ptrtype,
            variant: "Datatype",
            parentSymbol: symbol.parentSymbol,
          },
          program,
        );
      }
      return ptrtype;

    case "Struct":
      const structtype: StructDatatype = {
        variant: "Struct",
        name: symbol.name,
        generics: new Map(symbol.type.generics),
        members: symbol.type.members,
        methods: symbol.type.methods,
      };
      if (genericsProvided.length != symbol.type.generics.size) {
        throw new CompilerError(
          `Type '${name}<>' expected ${symbol.type.generics.size} generic arguments but got ${genericsProvided.length}.`,
          program.getLoc(ctx),
        );
      }
      let index = 0;
      for (const i of symbol.type.generics.keys()) {
        if (genericsProvided[index].variant !== "Generic") {
          structtype.generics.set(i, genericsProvided[index]);
        } else {
          structtype.generics.set(i, undefined);
        }
        index++;
      }
      if (
        structtype.generics
          .entries()
          .every((e) => e[1] !== undefined && e[1].variant !== "Generic")
      ) {
        datatypeSymbolUsed(
          {
            name: symbol.name,
            scope: symbol.scope,
            type: structtype,
            variant: "Datatype",
            parentSymbol: symbol.parentSymbol,
          },
          program,
        );
      }
      return structtype;

    default:
      throw new ImpossibleSituation();
  }
};

export function datatypeSymbolUsed(symbol: DatatypeSymbol, program: Program) {
  const mangled = mangleSymbol(symbol);
  if (!(mangled in program.concreteDatatypes)) {
    program.concreteDatatypes[mangled] = symbol;
  }
}

export function getNestedReturnTypes(scope: Scope) {
  const returnedTypes = [] as Datatype[];
  for (const statement of scope.statements) {
    if (statement.variant === "Return" && statement.expr) {
      returnedTypes.push(statement.expr.type);
    } else if (statement.variant === "Conditional") {
      returnedTypes.push(...getNestedReturnTypes(statement.if[1]));
      for (const elseIf of statement.elseIf) {
        returnedTypes.push(...getNestedReturnTypes(elseIf[1]));
      }
      if (statement.else) {
        returnedTypes.push(...getNestedReturnTypes(statement.else));
      }
    }
  }
  // Deduplicate
  const uniqueTypes = new Set(returnedTypes);
  return Array.from(uniqueTypes);
}
