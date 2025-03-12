import {
  serializeDatatype,
  type Datatype,
  type FunctionDatatype,
  type Generics,
  type NamespaceDatatype,
  type RawPointerDatatype,
  type StructDatatype,
  type StructMemberUnion,
} from "./Datatype";
import {
  CompilerError,
  ImpossibleSituation,
  InternalError,
  type Location,
} from "./Errors";
import {
  CommonDatatypeContext,
  FuncContext,
  FuncdeclContext,
  NamedfuncContext,
  ParamContext,
  ParamsContext,
  StructMethodContext,
} from "./parser/HazeParser";
import type HazeVisitor from "./parser/HazeVisitor";
import type { Program } from "./Program";
import { Scope } from "./Scope";
import {
  isSymbolGeneric,
  Language,
  mangleDatatype,
  mangleSymbol,
  serializeSymbol,
  type DatatypeSymbol,
  type FunctionSymbol,
  type SpecialMethod,
  type Symbol,
} from "./Symbol";
import * as _ from "lodash";

export const RESERVED_VARIABLE_NAMES = ["this", "ctx", "__returnval__"];
export const RESERVED_STRUCT_NAMES = ["RawPtr"]; // "Context"
export const INTERNAL_METHOD_NAMES = ["constructor", "sizeof"];
export const RESERVED_NAMESPACES = ["global"];

export type ParamPack = { params: [string, Datatype][]; vararg: boolean };

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

type ResolvageContext = {
  resolvedMangledType: Record<string, Datatype>;
};

export function resolveGenerics(
  datatype: Datatype,
  scope: Scope,
  loc: Location,
  resolvageContext: ResolvageContext = { resolvedMangledType: {} },
): Datatype {
  if (mangleDatatype(datatype) in resolvageContext.resolvedMangledType) {
    return resolvageContext.resolvedMangledType[mangleDatatype(datatype)];
  }
  switch (datatype.variant) {
    case "Generic":
      const symbol = scope.lookupSymbol(datatype.name, loc);
      //   if (symbol.type.isGeneric()) {
      //     return datatype;
      //   }
      return symbol.type;

    case "RawPointer": {
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
    }

    case "Namespace":
      return datatype;

    case "Struct": {
      if (!(mangleDatatype(datatype) in resolvageContext.resolvedMangledType)) {
        resolvageContext.resolvedMangledType[mangleDatatype(datatype)] =
          datatype;
      }
      const cloned: StructDatatype = {
        variant: "Struct",
        name: datatype.name,
        language: datatype.language,
        generics: new Map(datatype.generics),
        members: [],
        methods: [],
        parentSymbol: datatype.parentSymbol,
      };
      const tempScope = new Scope(scope.location, scope);
      defineGenericsInScope(datatype.generics, tempScope);
      for (const [name, tp] of datatype.generics) {
        const s = tempScope.tryLookupSymbol(name, loc);
        if (s) {
          cloned.generics.set(name, s.type);
        }
      }
      for (const member of datatype.members) {
        if (member.variant === "Variable") {
          cloned.members.push({
            variant: "Variable",
            name: member.name,
            variableType: member.variableType,
            parentSymbol: member.parentSymbol,
            type: resolveGenerics(
              member.type,
              tempScope,
              loc,
              resolvageContext,
            ),
          });
        } else {
          const newUnion: StructMemberUnion = {
            variant: "StructMemberUnion",
            symbols: [],
          };
          for (const inner of member.symbols) {
            newUnion.symbols.push({
              name: inner.name,
              type: resolveGenerics(
                inner.type,
                tempScope,
                loc,
                resolvageContext,
              ),
              variant: "Variable",
              variableType: inner.variableType,
            });
          }
          cloned.members.push(newUnion);
        }
      }
      for (const method of datatype.methods) {
        cloned.methods.push({
          name: method.name,
          type: resolveGenerics(
            method.type,
            scope,
            loc,
            resolvageContext,
          ) as FunctionDatatype,
          // type: method.type,
          variant: "Function",
          language: method.language,
          scope: method.scope,
          ctx: method.ctx,
          parentSymbol: method.parentSymbol,
          specialMethod: method.specialMethod,
          thisPointerExpr: method.thisPointerExpr,
          wasAnalyzed: method.wasAnalyzed,
        });
      }
      // const generics: Array<[string, Datatype | null]> = [];
      // for (let i = 0; i < datatype.generics().length; i++) {
      //   const sym = scope.lookupSymbol(datatype.generics()[i][0], loc);
      //   if (sym.type.isGeneric()) {
      //     generics.push([sym.name, null]);
      //   } else {
      //     generics.push([sym.name, sym.type]);
      //   }
      // }
      return cloned;
    }

    case "Function": {
      if (!(mangleDatatype(datatype) in resolvageContext.resolvedMangledType)) {
        resolvageContext.resolvedMangledType[mangleDatatype(datatype)] =
          datatype;
      }

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
          resolvageContext,
        ),
        vararg: datatype.vararg,
      };
      for (let i = 0; i < datatype.functionParameters.length; i++) {
        const parScope = new Scope(loc, scope);
        const par = datatype.functionParameters[i];
        if (par[1].variant === "Struct") {
          defineGenericsInScope(par[1].generics, parScope);
        }
        const t = resolveGenerics(par[1], parScope, loc, resolvageContext);
        newFunctype.functionParameters.push([par[0], t]);
      }
      return newFunctype;
    }

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
  resolvageContext?: { scope?: Scope },
): Datatype => {
  const name = ctx.ID().getText();

  const symbol = (resolvageContext?.scope || program.currentScope).lookupSymbol(
    name,
    program.getLoc(ctx),
  );

  if (symbol.variant !== "Datatype") {
    throw new ImpossibleSituation();
  }

  const genericsProvided: Datatype[] = ctx._generics.map((n) => _this.visit(n));
  switch (symbol.type.variant) {
    case "Primitive":
      if (genericsProvided.length > 0) {
        throw new CompilerError(
          `Type '${name}' expected no generic arguments but got ${genericsProvided.length}.`,
          program.getLoc(ctx),
        );
      }
      if (ctx._nested) {
        throw new CompilerError(
          `Type '${name}' is not a namespace`,
          program.getLoc(ctx),
        );
      }
      return symbol.type;

    case "Generic":
      if (ctx._nested) {
        throw new CompilerError(
          `Type '${name}' is not a namespace`,
          program.getLoc(ctx),
        );
      }
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
      if (ctx._nested) {
        throw new CompilerError(
          `Type '${name}' is not a namespace`,
          program.getLoc(ctx),
        );
      }
      return ptrtype;

    case "Struct":
      const structtype: StructDatatype = {
        variant: "Struct",
        name: symbol.type.name,
        generics: new Map(symbol.type.generics),
        language: symbol.type.language,
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
      if (ctx._nested) {
        throw new CompilerError(
          `Type '${name}' is not a namespace`,
          program.getLoc(ctx),
        );
      }
      return structtype;

    case "Namespace":
      if (genericsProvided.length != 0) {
        throw new CompilerError(
          `Namespace '${name}' cannot take generic arguments but got ${genericsProvided.length}.`,
          program.getLoc(ctx),
        );
      }
      datatypeSymbolUsed(symbol, program);

      if (!ctx._nested) {
        return symbol.type;
      } else {
        // We have <symbol.type>.<nesteddatatype>
        if (!(ctx._nested instanceof CommonDatatypeContext)) {
          throw new CompilerError(
            `Cannot use a function datatype inside a namespace`,
            program.getLoc(ctx),
          );
        }
        const second: Datatype = visitCommonDatatypeImpl(
          _this,
          program,
          ctx._nested,
          {
            scope: symbol.type.symbolsScope,
          },
        );
        if (second.variant !== "Struct") {
          throw new CompilerError(
            `Type '${serializeDatatype(second)}' is not a struct and cannot be namespaced`,
            program.getLoc(ctx),
          );
        }
        let p: StructDatatype | NamespaceDatatype | undefined = second;
        while (p?.parentSymbol) {
          if (
            p.parentSymbol.type.variant !== "Struct" &&
            p.parentSymbol.type.variant !== "Namespace"
          ) {
            throw new ImpossibleSituation();
          }
          p = p.parentSymbol.type;
        }
        if (p && serializeDatatype(p) !== serializeDatatype(symbol.type)) {
          p.parentSymbol = symbol;
        }
        return second;
      }

    default:
      throw new ImpossibleSituation();
  }
};

export function datatypeSymbolUsed(symbol: DatatypeSymbol, program: Program) {
  const mangled = mangleSymbol(symbol);
  if (!(mangled in program.concreteDatatypes)) {
    program.concreteDatatypes.set(mangled, symbol);
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

export function collectFunction(
  _this: HazeVisitor<any>,
  ctx: FuncContext | NamedfuncContext | StructMethodContext | FuncdeclContext,
  name: string,
  program: Program,
  parentSymbol: Symbol,
  functype: Language = Language.Internal,
): FunctionSymbol {
  const parentScope = program.currentScope;
  const scope = program.pushScope(
    new Scope(program.getLoc(ctx), program.currentScope),
  );

  let returntype: Datatype = program.getBuiltinType("none");
  if (ctx.datatype()) {
    returntype = _this.visit(ctx.datatype());
  } else if (!(ctx instanceof FuncdeclContext)) {
    if (returntype.variant === "Deferred" && ctx.funcbody().expr()) {
      const expr = _this.visit(ctx.funcbody().expr());
      returntype = expr.type;
    }
  }
  // else {
  //   returntype = this.program.getBuiltinType("none");
  // }

  let specialMethod: SpecialMethod = undefined;
  if (
    parentSymbol &&
    parentSymbol.variant === "Datatype" &&
    parentSymbol.type?.variant === "Struct"
  ) {
    if (name === "constructor") {
      specialMethod = "constructor";
    }
  }

  const params: ParamPack = _this.visit(ctx.params());
  const type: FunctionDatatype = {
    variant: "Function",
    functionParameters: params.params,
    functionReturnType: returntype,
    vararg: params.vararg,
  };
  const symbol: FunctionSymbol = {
    variant: "Function",
    name: name,
    language: functype,
    type: type,
    specialMethod: specialMethod,
    scope: scope,
    parentSymbol: parentSymbol,
    ctx: ctx,
    wasAnalyzed: false,
  };

  parentScope.defineSymbol(symbol, program.getLoc(ctx));

  if (
    !isSymbolGeneric(symbol) &&
    (!parentSymbol ||
      parentSymbol.type.variant === "Namespace" ||
      Object.keys("generics" in parentSymbol.type && parentSymbol.type.generics)
        .length === 0)
  ) {
    program.concreteFunctions.set(mangleSymbol(symbol), symbol);
  }

  program.popScope();
  return symbol;
}

export function visitParam(
  _this: HazeVisitor<any>,
  ctx: ParamContext,
): [string, Datatype] {
  return [ctx.ID().getText(), _this.visit(ctx.datatype())];
}

export function visitParams(
  _this: HazeVisitor<any>,
  ctx: ParamsContext,
): ParamPack {
  const params = ctx.param_list().map((n) => visitParam(_this, n));
  return { params: params, vararg: ctx.ellipsis() !== undefined };
}
