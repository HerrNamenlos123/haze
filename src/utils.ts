import type {
  Datatype,
  FunctionDatatype,
  Generics,
  StructDatatype,
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
import type { DatatypeSymbol } from "./Symbol";

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

    case "Struct":
      const newType: StructDatatype = {
        variant: "Struct",
        name: datatype.name,
        generics: datatype.generics,
        members: [],
        methods: [],
      };
      const tempScope = new Scope(scope.location, scope);
      defineGenericsInScope(datatype.generics, tempScope);
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

      const retScope = new Scope(loc, scope);
      const newType2: FunctionDatatype = {
        variant: "Function",
        functionParameters: [],
        functionReturnType: resolveGenerics(
          datatype.functionReturnType,
          retScope,
          loc,
        ),
      };

      //   defineGenericsInScope(datatype.functionReturnType.generics, retScope);
      const params: Array<[string, Datatype]> = [];
      for (let i = 0; i < datatype.functionParameters.length; i++) {
        const parScope = new Scope(loc, scope);
        // defineGenericsInScope(
        //   datatype.functionParameters[i][1].generics(),
        //   parScope,
        // );
        newType2.functionParameters.push([
          datatype.functionParameters[i][0],
          resolveGenerics(datatype.functionParameters[i][1], parScope, loc),
        ]);
      }
      return newType2;

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

    case "Struct":
      if (symbol.variant !== "Datatype") {
        throw new ImpossibleSituation();
      }
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
        structtype.generics.set(i, genericsProvided[index]);
        index++;
      }
      return structtype;

    default:
      throw new ImpossibleSituation();
  }
};
