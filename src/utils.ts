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
  BooleanConstantContext,
  CommonDatatypeContext,
  DatatypeimplContext,
  FuncContext,
  FuncdeclContext,
  LiteralConstantContext,
  NamedfuncContext,
  ParamContext,
  ParamsContext,
  StringConstantContext,
  StructMethodContext,
  VariableDeclarationContext,
  VariableDefinitionContext,
} from "./grammar/autogen/HazeParser";
import type { HazeVisitor } from "./grammar/autogen/HazeVisitor";
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
  type BooleanConstantSymbol,
  type ConstantSymbol,
  type DatatypeSymbol,
  type FunctionSymbol,
  type LiteralUnit,
  type SpecialMethod,
  type StringConstantSymbol,
  type Symbol,
  type VariableSymbol,
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
      if (tp.variant === "Datatype") {
        scope.defineSymbol({
          variant: "Datatype",
          name: name,
          type: tp.type,
          scope: scope,
          export: false,
          location: scope.location,
        });
      } else {
        scope.defineSymbol({
          variant: "ConstantLookup",
          constant: tp,
          location: tp.location,
          name: name,
          type: tp.type,
        });
      }
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
      if (
        datatype.pointee.type.variant === "Struct" &&
        datatype.pointee.type.generics.size > 0
      ) {
        const tempScope = new Scope(scope.location, scope);
        defineGenericsInScope(datatype.pointee.type.generics, tempScope);
        const newRawPtr: RawPointerDatatype = {
          variant: "RawPointer",
          pointee: {
            variant: "Datatype",
            export: datatype.pointee.export,
            location: datatype.pointee.location,
            name: datatype.pointee.name,
            scope: datatype.pointee.scope,
            type: resolveGenerics(
              datatype.pointee.type,
              tempScope,
              loc,
              resolvageContext,
            ),
            originalGenericSourcecode:
              datatype.pointee.originalGenericSourcecode,
            parentSymbol: datatype.pointee.parentSymbol,
          },
        };
        return newRawPtr;
      } else {
        return datatype;
      }
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
        let s = tempScope.tryLookupSymbol(name, loc);
        while (s && s.type.variant === "Generic") {
          if (s.variant === "Datatype") {
            s = s.scope.parentScope?.tryLookupSymbol(s.type.name, loc);
          } else if (s.variant === "ConstantLookup") {
            s = tempScope.tryLookupSymbol(s.type.name, loc);
          } else {
            throw new ImpossibleSituation();
          }
        }
        if (s) {
          if (s.variant === "Datatype") {
            cloned.generics.set(name, s);
          } else if (s.variant === "ConstantLookup") {
            cloned.generics.set(name, s.constant);
          } else {
            throw new InternalError("Wrong type");
          }
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
          variant: "Function",
          extern: method.extern,
          scope: method.scope,
          definedInScope: method.definedInScope,
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
  const genericsProvided: (DatatypeSymbol | ConstantSymbol)[] =
    ctx._generics.map((n) => _this.visitGenericsvalue!(n));

  if (name === "RawPtr") {
    if (genericsProvided.length != 1) {
      throw new CompilerError(
        `Type '${name}<>' expected 1 generic argument but got ${genericsProvided.length}.`,
        program.location(ctx),
      );
    }
    if (!genericsProvided[0] || genericsProvided[0].variant !== "Datatype") {
      throw new ImpossibleSituation();
    }
    const newSymbol: DatatypeSymbol<RawPointerDatatype> = {
      name: "RawPtr",
      scope: program.currentScope,
      variant: "Datatype",
      parentSymbol: undefined,
      export: false,
      location: program.location(ctx),
      type: {
        variant: "RawPointer",
        pointee: genericsProvided[0],
      },
    };
    datatypeSymbolUsed(newSymbol, program);
    return newSymbol;
  }

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
    // let ptrIndex = 0;
    // for (const i of symbol.type.generics.keys()) {
    //   if (genericsProvided[ptrIndex].variant !== "Generic") {
    //     newSymbol.type.generics.set(i, genericsProvided[ptrIndex]);
    //   } else {
    //     newSymbol.type.generics.set(i, undefined);
    //   }
    //   ptrIndex++;
    // }
    symbol = s;
  }

  if (symbol.variant !== "Datatype") {
    throw new CompilerError(
      `Symbol '${serializeSymbol(symbol)}' cannot be used as a datatype`,
      program.location(ctx),
    );
  }

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
        newSymbol.type.generics.set(i, genericsProvided[index]);
        index++;
      }
      if (
        newSymbol.type.generics
          .entries()
          .every((e) => e[1] !== undefined && e[1].type.variant !== "Generic")
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
): DatatypeSymbol => {
  const datatypes = ctx.datatypeimpl();

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

  return symbol;
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
    const tp: DatatypeSymbol = _this.visit(ctx.datatype()!);
    returntype = tp.type;
  } else if (!(ctx instanceof FuncdeclContext)) {
    if (returntype.variant === "Deferred" && ctx.funcbody()!.expr()) {
      const expr: Expression = _this.visit(ctx.funcbody()!.expr()!);
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
    definedInScope: parentScope,
    parentSymbol: parentSymbol,
    ctx: ctx,
    wasAnalyzed: false,
    export: exports,
    location: program.location(ctx),
    declared:
      ctx instanceof FuncdeclContext ||
      (ctx instanceof StructMethodContext && !ctx.funcbody()),
  };

  const existingSymbol = parentScope.tryLookupSymbol(
    symbol.name,
    symbol.location,
  );
  if (existingSymbol && existingSymbol.variant !== "Function") {
    throw new CompilerError(
      `Symbol ${symbol.name} cannot be redeclared as a different type`,
      symbol.location,
    );
  }
  if (existingSymbol && existingSymbol.declared && !symbol.declared) {
    existingSymbol.definedInScope.replaceSymbol(symbol);
  } else {
    parentScope.defineSymbol(symbol);
  }

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
  return [ctx.ID().getText(), _this.visit(ctx.datatype()).type];
}

export function visitParams(
  _this: HazeVisitor<any>,
  ctx: ParamsContext,
): ParamPack {
  const params = ctx.param().map((n) => visitParam(_this, n));
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
      datatype = _this.visit(ctx.datatype()!).type;
    }
    if (!datatype) {
      throw new ImpossibleSituation();
    }
  } else {
    datatype = _this.visit(ctx.datatype()!).type;
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
      statement.symbol.type = _this.visit(statement.ctx.datatype()!).type;
    }
  } else {
    statement.symbol.type = _this.visit(statement.ctx.datatype()!).type;
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

export function visitLiteralConstantImpl(
  _this: HazeVisitor<any>,
  ctx: LiteralConstantContext,
  program: Module,
): ConstantSymbol {
  const match = ctx.getText().match(/^(\d+(?:\.\d+)?)(s|ms|us|ns|m|h|d)?$/);
  if (!match) {
    throw new InternalError("Could not parse literal", program.location(ctx));
  }
  const [, valueStr, unitStr] = match;
  const isFloat = valueStr.indexOf(".") !== -1;
  let value = isFloat ? parseFloat(valueStr) : parseInt(valueStr);

  if (Number.isNaN(value)) {
    throw new CompilerError(
      `Could not parse '${ctx.getText()}'.`,
      program.location(ctx),
    );
  }

  let type = isFloat
    ? program.getBuiltinType("f64")
    : program.getBuiltinType("i64");
  let unit: LiteralUnit | undefined = undefined;

  if (unitStr) {
    switch (unitStr) {
      case "s":
      case "ms":
      case "us":
      case "ns":
      case "m":
      case "h":
      case "d":
        (type = program.getBuiltinType("Duration")), (unit = unitStr);
        break;

      default:
        throw new CompilerError(
          `'${unitStr}' is not a valid unit`,
          program.location(ctx),
        );
    }
  }

  return {
    variant: "LiteralConstant",
    type: type,
    value: value,
    location: program.location(ctx),
    unit: unit,
  };
}

export function visitStringConstantImpl(
  _this: HazeVisitor<any>,
  ctx: StringConstantContext,
  program: Module,
): StringConstantSymbol {
  return {
    variant: "StringConstant",
    type: program.getBuiltinType("stringview"),
    value: ctx.getText(),
    location: program.location(ctx),
  };
}

export function visitBooleanConstantImpl(
  _this: HazeVisitor<any>,
  ctx: BooleanConstantContext,
  program: Module,
): BooleanConstantSymbol {
  const text = ctx.getText();
  let value = false;
  if (text === "true") {
    value = true;
  } else if (text !== "false") {
    throw new InternalError(`Invalid boolean constant: ${text}`);
  }
  return {
    variant: "BooleanConstant",
    type: program.getBuiltinType("boolean"),
    value: value,
    location: program.location(ctx),
  };
}
