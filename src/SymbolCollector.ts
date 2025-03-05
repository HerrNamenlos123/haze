import {
  CdefinitiondeclContext,
  CommonDatatypeContext,
  FuncContext,
  FuncdeclContext,
  FunctionDatatypeContext,
  NamedfuncContext,
  ParamsContext,
  StructDeclContext,
  StructMemberContext,
  StructMethodContext,
  StructUnionFieldsContext,
  type ParamContext,
} from "./parser/HazeParser";
import type { Program } from "./Program";
import {
  Language,
  getDatatypeId,
  mangleSymbol,
  serializeSymbol,
  VariableType,
  type DatatypeSymbol,
  type FunctionSymbol,
  type MethodType,
  type VariableSymbol,
  isSymbolGeneric,
} from "./Symbol";
import HazeVisitor from "./parser/HazeVisitor";
import { CompilerError, ImpossibleSituation, InternalError } from "./Errors";
import {
  getStructMembers,
  isDeferred,
  type Datatype,
  type DatatypeId,
  type FunctionDatatype,
  type GenericPlaceholderDatatype,
  type StructDatatype,
  type StructMemberUnion,
} from "./Datatype";
import { Scope } from "./Scope";
import type { ParserRuleContext } from "antlr4";
import { visitCommonDatatypeImpl } from "./utils";

export class SymbolCollector extends HazeVisitor<any> {
  private program: Program;
  private structStack: DatatypeSymbol[];

  constructor(program: Program) {
    super();
    this.program = program;
    this.structStack = [];
  }

  visitParam = (ctx: ParamContext): [string, DatatypeId] => {
    return [ctx.ID().getText(), this.visit(ctx.datatype())];
  };

  visitParams = (
    ctx: ParamsContext,
  ): { params: [string, DatatypeId][]; vararg: boolean } => {
    const params = ctx.param_list().map((n) => this.visitParam(n));
    return { params: params, vararg: ctx.ellipsis() !== undefined };
  };

  visitCommonDatatype = (ctx: CommonDatatypeContext): DatatypeId => {
    return visitCommonDatatypeImpl(this, this.program, ctx);
  };

  visitCdefinitiondecl = (ctx: CdefinitiondeclContext): void => {
    const text = JSON.parse(ctx.STRING_LITERAL().getText());
    this.program.cDefinitionDecl.push(text);
  };

  visitFunctionDatatype = (ctx: FunctionDatatypeContext): DatatypeId => {
    const params = this.visitParams(ctx.functype().params());
    const { id } = this.program.datatypeDatabase.upsert({
      variant: "Function",
      generics: {},
      functionParameters: params.params,
      functionReturnType: this.visit(ctx.functype().datatype()),
      vararg: params.vararg,
    });
    return id;
  };

  visitFuncdecl = (ctx: FuncdeclContext): void => {
    if (!ctx.externlang()) {
      throw new CompilerError(
        "Currently function declarations need an extern language",
        this.program.getLoc(ctx),
      );
    }

    const lang = ctx.externlang().getText()[1];
    let functype = Language.Internal;
    if (lang === "C") {
      functype = Language.External_C;
    } else {
      throw new CompilerError(
        `Extern Language '${lang}' is not supported.`,
        this.program.getLoc(ctx),
      );
    }

    const signature = ctx.ID_list().map((n) => n.getText());
    if (signature.length > 1 && functype === Language.External_C) {
      throw new CompilerError(
        "Extern C functions cannot be namespaced",
        this.program.getLoc(ctx),
      );
    }

    if (signature.length > 1) {
      throw new InternalError(
        "Namespacing for external function is not implemented yet",
      );
    }

    this.implFunc(ctx, signature[0], functype);
  };

  private implFunc(
    ctx: FuncContext | NamedfuncContext | StructMethodContext | FuncdeclContext,
    name: string,
    language: Language = Language.Internal,
  ): FunctionSymbol {
    const parentScope = this.program.currentScope;
    const scope = this.program.pushScope(
      new Scope(this.program.getLoc(ctx), this.program.currentScope),
    );

    let returntype = this.program.datatypeDatabase.upsert({
      variant: "DeferredReturn",
    }).id;
    if (ctx.datatype()) {
      returntype = this.visit(ctx.datatype());
    } else if ("funcbody" in ctx && ctx.funcbody().expr()) {
      returntype = this.visit(ctx.funcbody().expr()).type;
    }

    const enclosingStructSymbol = this.structStack[this.structStack.length - 1];
    const enclosingStruct =
      this.structStack.length > 0
        ? (this.program.lookupDt(
            this.structStack[this.structStack.length - 1].type,
          ) as StructDatatype)
        : undefined;
    let methodType: MethodType = undefined;
    if (enclosingStruct && enclosingStruct.variant === "Struct") {
      if (name === "constructor") {
        methodType = "constructor";
      } else if (name === "destructor") {
        methodType = "destructor";
      }
    }

    const params = this.visitParams(ctx.params());
    const { id, type } = this.program.datatypeDatabase.upsert({
      variant: "Function",
      generics: {},
      functionParameters: params.params,
      functionReturnType: returntype,
      vararg: params.vararg,
    });
    const symbol: FunctionSymbol = {
      variant: "Function",
      name: name,
      language: language,
      type: id,
      methodType: methodType,
      body: scope,
      methodOfStructSymbol: enclosingStructSymbol,
      ctx: ctx,
    };

    if (enclosingStruct && enclosingStruct.variant === "Struct") {
      if (name === "destructor") {
        if (params.params.length !== 0) {
          throw new CompilerError(
            `Destructor of struct '${enclosingStruct.name}' cannot have any parameters`,
            this.program.getLoc(ctx),
          );
        }
      }
    }

    parentScope.defineSymbol(symbol, this.program.getLoc(ctx));
    console.log(
      "Define symbol ",
      mangleSymbol(symbol, this.program),
      "enclosed by",
      enclosingStructSymbol &&
        mangleSymbol(enclosingStructSymbol, this.program),
    );
    this.program.ctxToSymbolMap.set(ctx, symbol);

    if (
      !isSymbolGeneric(symbol, this.program) &&
      (!enclosingStruct || Object.keys(enclosingStruct.generics).length === 0)
    ) {
      this.program.concreteFunctions[mangleSymbol(symbol, this.program)] =
        symbol;
    }

    this.program.popScope();
    return symbol;
  }

  visitFunc = (ctx: FuncContext): FunctionSymbol => {
    return this.implFunc(ctx, this.program.makeAnonymousName());
  };

  visitNamedfunc = (ctx: NamedfuncContext): FunctionSymbol => {
    return this.implFunc(ctx, ctx.ID().getText());
  };

  visitStructMember = (ctx: StructMemberContext) => {
    const name = ctx.ID().getText();
    const datatype = this.visit(ctx.datatype());
    const symbol: VariableSymbol = {
      variant: "Variable",
      name: name,
      type: datatype,
      variableType: VariableType.MutableStructField,
    };
    return symbol;
  };

  visitStructUnionFields = (
    ctx: StructUnionFieldsContext,
  ): StructMemberUnion => {
    return {
      variant: "StructMemberUnion",
      symbols: ctx.structcontent_list().map((n) => this.visit(n)),
    };
  };

  visitStructDecl = (ctx: StructDeclContext): DatatypeSymbol => {
    const name = ctx.ID(0).getText();
    const parentScope = this.program.currentScope;
    const scope = this.program.pushScope(
      new Scope(this.program.getLoc(ctx), parentScope),
    );

    const lang = ctx.externlang()?.getText()[1];
    let language = Language.Internal;
    if (lang === "C") {
      language = Language.External_C;
    } else if (lang) {
      throw new CompilerError(
        `Language '${lang}' is not supported.`,
        this.program.getLoc(ctx),
      );
    }

    const genericsList: [string, null][] = ctx
      .ID_list()
      .slice(1)
      .map((n) => [n.getText(), null]);

    const { type, id } = this.program.datatypeDatabase.insertNew({
      variant: "Struct",
      name: name,
      language: language,
      generics: Object.fromEntries(genericsList),
      members: [],
      methods: [],
    }) as { type: StructDatatype; id: DatatypeId };
    const symbol: DatatypeSymbol = {
      variant: "Datatype",
      name: name,
      type: id,
      scope: scope,
    };

    parentScope.defineSymbol(symbol, this.program.getLoc(ctx));
    for (const [name, tp] of Object.entries(type.generics)) {
      const sym: DatatypeSymbol = {
        name: name,
        variant: "Datatype",
        scope: scope,
        type: this.program.datatypeDatabase.upsert({
          variant: "Generic",
          name: name,
        }).id,
      };
      scope.defineSymbol(sym, this.program.getLoc(ctx));
    }
    this.structStack.push(symbol);

    ctx.structcontent_list().forEach((c) => {
      const content: VariableSymbol | StructMemberUnion | FunctionSymbol =
        this.visit(c);
      if (content.variant === "Variable") {
        type.members.push(content);
      } else if (content.variant === "Function") {
        type.methods.push(content);
      } else if (content.variant === "StructMemberUnion") {
        type.members.push(content);
      } else {
        throw new ImpossibleSituation();
      }
    });

    this.structStack.pop();
    this.program.popScope();
    return symbol;
  };

  visitStructMethod = (ctx: StructMethodContext): FunctionSymbol => {
    const name = ctx.ID().getText();
    const symbol = this.implFunc(ctx, name);
    return symbol;
  };
}
