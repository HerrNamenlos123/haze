import type { VariableStatement } from "typescript";
import {
  isNone,
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
  getCallerLocation,
  ImpossibleSituation,
  InternalError,
  Location,
} from "./Errors";
import type { Expression } from "./Expression";
import {
  CommonDatatypeContext,
  DatatypeimplContext,
  FuncContext,
  FuncdeclContext,
  NamedfuncContext,
  ParamContext,
  ParamsContext,
  StructMethodContext,
  VariableDeclarationContext,
  VariableDefinitionContext,
} from "./parser/HazeParser";
import type HazeVisitor from "./parser/HazeVisitor";
import type { Module } from "./Module";
import { Scope } from "./Scope";
import type {
  Statement,
  VariableDeclarationStatement,
  VariableDefinitionStatement,
} from "./Statement";
import {
  isSymbolGeneric,
  Linkage,
  mangleDatatype,
  mangleSymbol,
  serializeSymbol,
  VariableScope,
  VariableType,
  type DatatypeSymbol,
  type FunctionSymbol,
  type SpecialMethod,
  type Symbol,
  type VariableSymbol,
} from "./Symbol";
import * as _ from "lodash";
import type { ParserRuleContext } from "antlr4";

export const RESERVED_VARIABLE_NAMES = ["this", "ctx", "__returnval__"];
export const RESERVED_STRUCT_NAMES = ["RawPtr"]; // "Context"
export const INTERNAL_METHOD_NAMES = ["constructor", "sizeof"];
export const RESERVED_NAMESPACES = ["global"];

export type ParamPack = { params: [string, Datatype][]; vararg: boolean };

export function defineGenericsInScope(generics: Generics, scope: Scope) {
  for (const [name, tp] of generics) {
    if (tp) {
      scope.defineSymbol({
        variant: "Datatype",
        name: name,
        type: tp,
        scope: scope,
        export: false,
        location: scope.location,
      });
    }
  }
}

type ResolvageContext = {
  resolvedMangledType: Record<string, Datatype>;
};

// export function setFilename(ctx: ParserRuleContext, filename?: string) {
//   if (!filename) {
//     throw new InternalError("Missing filename", getCallerLocation(2));
//   }
//   if (!(ctx as any).filename) {
//     (ctx as any).filename = filename;
//   }
// }

// export function forwardFilename(
//   from: ParserRuleContext,
//   to: ParserRuleContext,
// ) {
//   if (!(from as any).filename) {
//     throw new InternalError("Missing filename", getCallerLocation(2));
//   }
//   if (!(to as any).filename) {
//     (to as any).filename = from;
//   }
// }

// export function location(ctx: ParserRuleContext) {
//   const filename = (ctx as any).filename as string;
//   if (!filename) {
//     throw new InternalError("Ctx missing filename", getCallerLocation(2));
//   }
//   return new Location(filename, ctx.start.line, ctx.start.column);
// }

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
            variableScope: member.variableScope,
            parentSymbol: member.parentSymbol,
            ctx: member.ctx,
            type: resolveGenerics(
              member.type,
              tempScope,
              loc,
              resolvageContext,
            ),
            export: member.export,
            location: member.location,
            extern: member.extern,
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
              parentSymbol: inner.parentSymbol,
              variableType: inner.variableType,
              variableScope: inner.variableScope,
              ctx: inner.ctx,
              export: inner.export,
              location: inner.location,
              extern: inner.extern,
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
            tempScope,
            loc,
            resolvageContext,
          ) as FunctionDatatype,
          // type: method.type,
          variant: "Function",
          extern: method.extern,
          scope: method.scope,
          ctx: method.ctx,
          parentSymbol: method.parentSymbol,
          specialMethod: method.specialMethod,
          thisPointerExpr: method.thisPointerExpr,
          wasAnalyzed: method.wasAnalyzed,
          export: method.export,
          location: method.location,
          declared: method.declared,
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

function lookupDatatype(
  _this: HazeVisitor<any>,
  ctx: DatatypeimplContext,
  program: Module,
  parentSymbol?: DatatypeSymbol,
): DatatypeSymbol {
  const name = ctx.ID().getText();
  let symbol: Symbol;
  if (!parentSymbol) {
    symbol = program.currentScope.lookupSymbol(
      ctx.ID().getText(),
      program.location(ctx),
    );
  } else {
    if (parentSymbol.type.variant !== "Namespace") {
      throw new CompilerError(
        `Symbol '${serializeSymbol(parentSymbol)}' cannot be used as a namespace`,
        program.location(ctx),
      );
    }
    const s = parentSymbol.type.symbolsScope.tryLookupSymbolHere(name);
    if (!s) {
      throw new CompilerError(
        `Type '${ctx.ID().getText()}' was not declared in this scope`,
        program.location(ctx),
      );
    }
    symbol = s;
  }

  if (symbol.variant !== "Datatype") {
    throw new CompilerError(
      `Symbol '${serializeSymbol(symbol)}' cannot be used as a datatype`,
      program.location(ctx),
    );
  }

  const genericsProvided: Datatype[] = ctx._generics.map((n) => _this.visit(n));
  switch (symbol.type.variant) {
    case "Primitive":
      if (genericsProvided.length > 0) {
        throw new CompilerError(
          `Type '${name}' expected no generic arguments but got ${genericsProvided.length}.`,
          symbol.location,
        );
      }
      return symbol;

    case "Generic":
      return symbol;

    case "RawPointer": {
      const newSymbol: DatatypeSymbol<RawPointerDatatype> = {
        name: symbol.name,
        scope: symbol.scope,
        variant: "Datatype",
        parentSymbol: symbol.parentSymbol,
        export: symbol.export,
        location: symbol.location,
        type: {
          variant: "RawPointer",
          generics: new Map(symbol.type.generics),
        },
      };
      if (genericsProvided.length != symbol.type.generics.size) {
        throw new CompilerError(
          `Type '${name}<>' expected ${symbol.type.generics.size} generic arguments but got ${genericsProvided.length}.`,
          symbol.location,
        );
      }

      let ptrIndex = 0;
      for (const i of symbol.type.generics.keys()) {
        if (genericsProvided[ptrIndex].variant !== "Generic") {
          newSymbol.type.generics.set(i, genericsProvided[ptrIndex]);
        } else {
          newSymbol.type.generics.set(i, undefined);
        }
        ptrIndex++;
      }

      if (
        newSymbol.type.generics
          .entries()
          .every((e) => e[1] !== undefined && e[1].variant !== "Generic")
      ) {
        datatypeSymbolUsed(newSymbol, program);
      }
      return newSymbol;
    }

    case "Struct": {
      const newSymbol: DatatypeSymbol<StructDatatype> = {
        name: symbol.name,
        scope: symbol.scope,
        variant: "Datatype",
        parentSymbol: symbol.parentSymbol,
        export: symbol.export,
        location: symbol.location,
        type: {
          variant: "Struct",
          name: symbol.type.name,
          generics: new Map(symbol.type.generics),
          language: symbol.type.language,
          members: symbol.type.members,
          methods: symbol.type.methods,
          parentSymbol: symbol.type.parentSymbol,
        },
      };
      if (genericsProvided.length != symbol.type.generics.size) {
        throw new CompilerError(
          `Type '${name}<>' expected ${symbol.type.generics.size} generic arguments but got ${genericsProvided.length}.`,
          symbol.location,
        );
      }
      let index = 0;
      for (const i of symbol.type.generics.keys()) {
        if (genericsProvided[index].variant !== "Generic") {
          newSymbol.type.generics.set(i, genericsProvided[index]);
        } else {
          newSymbol.type.generics.set(i, undefined);
        }
        index++;
      }
      if (
        newSymbol.type.generics
          .entries()
          .every((e) => e[1] !== undefined && e[1].variant !== "Generic")
      ) {
        datatypeSymbolUsed(newSymbol, program);
      }
      return newSymbol;
    }

    case "Namespace":
      return symbol;

    default:
      throw new ImpossibleSituation();
  }
}

export const visitCommonDatatypeImpl = (
  _this: HazeVisitor<any>,
  program: Module,
  ctx: CommonDatatypeContext,
): Datatype => {
  const datatypes = ctx.datatypeimpl_list();

  if (datatypes.length === 0) {
    throw new ImpossibleSituation();
  }

  let symbol: DatatypeSymbol | undefined = undefined;
  do {
    symbol = lookupDatatype(_this, datatypes[0], program, symbol);
    datatypes.splice(0, 1);
  } while (datatypes.length > 0);

  if (symbol?.variant !== "Datatype") {
    throw new ImpossibleSituation();
  }

  return symbol.type;
};

export function datatypeSymbolUsed(symbol: DatatypeSymbol, program: Module) {
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
  program: Module,
  parentSymbol: Symbol,
  functype: Linkage = Linkage.Internal,
): FunctionSymbol {
  const parentScope = program.currentScope;
  const scope = program.pushScope(
    new Scope(program.location(ctx), program.currentScope),
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

  let exports = false;
  if (ctx instanceof NamedfuncContext || ctx instanceof FuncdeclContext) {
    if (ctx._export_) {
      exports = true;
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
    extern: functype,
    type: type,
    specialMethod: specialMethod,
    scope: scope,
    parentSymbol: parentSymbol,
    ctx: ctx,
    wasAnalyzed: false,
    export: exports,
    location: program.location(ctx),
    declared:
      ctx instanceof FuncdeclContext ||
      (ctx instanceof StructMethodContext && !ctx.funcbody()),
  };

  parentScope.defineSymbol(symbol);

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
  return { params: params, vararg: ctx.ellipsis() !== null };
}

export function collectVariableStatement(
  _this: HazeVisitor<any>,
  ctx: VariableDefinitionContext | VariableDeclarationContext,
  program: Module,
  variableScope: VariableScope,
  parentSymbol?: Symbol,
): VariableDefinitionStatement | VariableDeclarationStatement {
  const name = ctx.ID().getText();
  if (RESERVED_VARIABLE_NAMES.includes(name)) {
    throw new CompilerError(
      `'${name}' is not a valid variable name.`,
      program.location(ctx),
    );
  }
  const mutable = ctx.variablemutability().getText() === "let";

  let datatype: Datatype = { variant: "Deferred" };
  let expr: Expression | undefined;
  if (ctx instanceof VariableDefinitionContext) {
    if (ctx.datatype()) {
      datatype = _this.visit(ctx.datatype());
    }
    if (!datatype) {
      throw new ImpossibleSituation();
    }
  } else {
    datatype = _this.visit(ctx.datatype());
    if (!datatype) {
      throw new ImpossibleSituation();
    }
  }

  if (isNone(datatype) || datatype.variant === "Namespace") {
    throw new CompilerError(
      `'${serializeDatatype(datatype)}' is not a valid variable type.`,
      program.location(ctx),
    );
  }

  let exports = false;
  if (ctx instanceof NamedfuncContext || ctx instanceof FuncdeclContext) {
    if (ctx._export_) {
      exports = true;
    }
  }

  let extern = Linkage.Internal;
  if (ctx._extern) {
    const lang = ctx.externlang()?.getText().slice(1, -1);
    if (lang === "C") {
      extern = Linkage.External_C;
    } else if (lang) {
      throw new CompilerError(
        `Extern language ${lang} is not supported`,
        program.location(ctx),
      );
    } else {
      extern = Linkage.External;
    }
  }

  const symbol: VariableSymbol = {
    variableType: mutable
      ? VariableType.MutableVariable
      : VariableType.ConstantVariable,
    variableScope: variableScope,
    name: name,
    type: datatype,
    variant: "Variable",
    parentSymbol: parentSymbol,
    ctx: ctx,
    export: exports,
    location: program.location(ctx),
    extern: extern,
  };
  program.currentScope.defineSymbol(symbol);

  const statement: VariableDefinitionStatement | VariableDeclarationStatement =
    ctx instanceof VariableDefinitionContext
      ? {
          variant: "VariableDefinition",
          ctx: ctx,
          symbol: symbol,
          expr: expr!,
          location: symbol.location,
        }
      : {
          variant: "VariableDeclaration",
          ctx: ctx,
          symbol: symbol,
          location: symbol.location,
        };

  if (variableScope === VariableScope.Global) {
    program.concreteGlobalStatements.set(mangleSymbol(symbol), statement);
  }

  return statement;
}

export function analyzeVariableStatement(
  _this: HazeVisitor<any>,
  program: Module,
  statement: VariableDefinitionStatement | VariableDeclarationStatement,
): Statement {
  if (statement.variant === "VariableDefinition") {
    statement.expr = _this.visit(statement.ctx.expr()) as Expression;
    statement.symbol.type = statement.expr.type;
    if (statement.ctx.datatype()) {
      statement.symbol.type = _this.visit(statement.ctx.datatype());
    }
  } else {
    statement.symbol.type = _this.visit(statement.ctx.datatype());
  }
  if (!statement.symbol.type || statement.symbol.type.variant === "Generic") {
    throw new ImpossibleSituation();
  }

  if (
    isNone(statement.symbol.type) ||
    statement.symbol.type.variant === "Namespace"
  ) {
    throw new CompilerError(
      `'${serializeDatatype(statement.symbol.type)}' is not a valid variable type.`,
      statement.location,
    );
  }

  if (statement.variant === "VariableDefinition") {
    return {
      variant: "VariableDefinition",
      ctx: statement.ctx,
      symbol: statement.symbol,
      expr: statement.expr,
      location: statement.location,
    };
  } else {
    return {
      variant: "VariableDeclaration",
      ctx: statement.ctx,
      symbol: statement.symbol,
      location: statement.location,
    };
  }
}
