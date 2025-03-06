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
  isSymbolGeneric,
  mangleSymbol,
  serializeSymbol,
  VariableType,
  type DatatypeSymbol,
  type FunctionSymbol,
  type SpecialMethod,
  type VariableSymbol,
} from "./Symbol";
import HazeVisitor from "./parser/HazeVisitor";
import { CompilerError, ImpossibleSituation, InternalError } from "./Errors";
import {
  getStructMembers,
  type Datatype,
  type FunctionDatatype,
  type GenericPlaceholderDatatype,
  type StructDatatype,
  type StructMemberUnion,
} from "./Datatype";
import { Scope } from "./Scope";
import type { ParserRuleContext } from "antlr4";
import { datatypeSymbolUsed, visitCommonDatatypeImpl } from "./utils";

export class SymbolCollector extends HazeVisitor<any> {
  private program: Program;
  private structStack: DatatypeSymbol<StructDatatype>[];

  constructor(program: Program) {
    super();
    this.program = program;
    this.structStack = [];
  }

  visitParam = (ctx: ParamContext): [string, Datatype] => {
    return [ctx.ID().getText(), this.visit(ctx.datatype())];
  };

  visitParams = (
    ctx: ParamsContext,
  ): { params: [string, Datatype][]; vararg: boolean } => {
    const params = ctx.param_list().map((n) => this.visitParam(n));
    return { params: params, vararg: ctx.ellipsis() !== undefined };
  };

  visitCommonDatatype = (ctx: CommonDatatypeContext): Datatype => {
    return visitCommonDatatypeImpl(this, this.program, ctx);
  };

  visitCdefinitiondecl = (ctx: CdefinitiondeclContext): void => {
    const text = JSON.parse(ctx.STRING_LITERAL().getText());
    this.program.cDefinitionDecl.push(text);
  };

  visitFunctionDatatype = (ctx: FunctionDatatypeContext): Datatype => {
    const params = this.visitParams(ctx.functype().params());
    const type: FunctionDatatype = {
      variant: "Function",
      functionParameters: params.params,
      functionReturnType: this.visit(ctx.functype().datatype()),
      vararg: params.vararg,
    };
    datatypeSymbolUsed(
      {
        name: "",
        scope: this.program.currentScope,
        type: type,
        variant: "Datatype",
      },
      this.program,
    );
    return type;
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
    functype: Language = Language.Internal,
  ): FunctionSymbol {
    const parentScope = this.program.currentScope;
    const scope = this.program.pushScope(
      new Scope(this.program.getLoc(ctx), this.program.currentScope),
    );

    let returntype: Datatype = this.program.getBuiltinType("none");
    if (ctx.datatype()) {
      returntype = this.visit(ctx.datatype());
    } else if (!(ctx instanceof FuncdeclContext)) {
      if (returntype.variant === "Deferred" && ctx.funcbody().expr()) {
        const expr = this.visit(ctx.funcbody().expr());
        returntype = expr.type;
      }
    }
    // else {
    //   returntype = this.program.getBuiltinType("none");
    // }

    const parentSymbol = this.structStack[this.structStack.length - 1];
    let specialMethod: SpecialMethod = undefined;
    if (parentSymbol && parentSymbol.type?.variant === "Struct") {
      if (name === "constructor") {
        specialMethod = "constructor";
      } else if (name === "destructor") {
        specialMethod = "destructor";
      }
    }

    const params = this.visitParams(ctx.params());
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
    };

    if (parentSymbol && parentSymbol.type?.variant === "Struct") {
      if (name === "destructor") {
        if (type.functionParameters.length !== 0) {
          throw new CompilerError(
            `Destructor of struct '${parentSymbol.name}' cannot have any parameters`,
            this.program.getLoc(ctx),
          );
        }
      }
    }

    parentScope.defineSymbol(symbol, this.program.getLoc(ctx));
    this.program.ctxToSymbolMap.set(ctx, symbol);

    if (
      !isSymbolGeneric(symbol) &&
      (!parentSymbol || Object.keys(parentSymbol.type.generics).length === 0)
    ) {
      this.program.concreteFunctions[mangleSymbol(symbol)] = symbol;
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

    const genericsList: [string, undefined][] = ctx
      .ID_list()
      .slice(1)
      .map((n) => [n.getText(), undefined]);

    const lang = ctx.externlang()?.getText()[1];
    let language = Language.Internal;
    if (lang === "C") {
      language = Language.External_C;
    } else if (lang) {
      throw new CompilerError(
        `Extern Language '${lang}' is not supported.`,
        this.program.getLoc(ctx),
      );
    }

    const type: StructDatatype = {
      variant: "Struct",
      name: name,
      language: language,
      generics: new Map<string, undefined>(genericsList),
      members: [],
      methods: [],
    };
    const symbol: DatatypeSymbol<StructDatatype> = {
      variant: "Datatype",
      name: name,
      type: type,
      scope: scope,
    };

    parentScope.defineSymbol(symbol, this.program.getLoc(ctx));
    for (const [name, tp] of type.generics) {
      const sym: DatatypeSymbol = {
        name: name,
        variant: "Datatype",
        scope: scope,
        type: { variant: "Generic", name: name },
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
        if (symbol.type.language) {
          throw new CompilerError(
            `A declared struct cannot have methods`,
            this.program.getLoc(ctx),
          );
        }
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
