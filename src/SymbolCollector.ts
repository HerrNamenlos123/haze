import {
  CommonDatatypeContext,
  ExternblockContext,
  ExternfuncdefContext,
  FuncContext,
  FunctionDatatypeContext,
  NamedfuncContext,
  StructDeclContext,
  StructMemberContext,
  StructMethodContext,
  type ParamContext,
} from "./parser/HazeParser";
import type { Program } from "./Program";
import {
  FunctionType,
  isSymbolGeneric,
  mangleSymbol,
  serializeSymbol,
  VariableType,
  type DatatypeSymbol,
  type FunctionSymbol,
  type VariableSymbol,
} from "./Symbol";
import HazeVisitor from "./parser/HazeVisitor";
import { CompilerError, ImpossibleSituation, InternalError } from "./Errors";
import {
  type Datatype,
  type FunctionDatatype,
  type GenericPlaceholderDatatype,
  type StructDatatype,
} from "./Datatype";
import { Scope } from "./Scope";
import type { ParserRuleContext } from "antlr4";
import { visitCommonDatatypeImpl } from "./utils";

export class SymbolCollector extends HazeVisitor<any> {
  private program: Program;
  private currentFunctionType: FunctionType | undefined;
  private structStack: DatatypeSymbol<StructDatatype>[];

  constructor(program: Program) {
    super();
    this.program = program;
    this.currentFunctionType = undefined;
    this.structStack = [];
  }

  visitParam = (ctx: ParamContext): [string, Datatype] => {
    return [ctx.ID().getText(), this.visit(ctx.datatype())];
  };

  visitCommonDatatype = (ctx: CommonDatatypeContext): Datatype => {
    return visitCommonDatatypeImpl(this, this.program, ctx);
  };

  visitFunctionDatatype = (ctx: FunctionDatatypeContext): Datatype => {
    const type: FunctionDatatype = {
      variant: "Function",
      functionParameters: ctx
        .functype()
        .params()
        .param_list()
        .map((n) => [n.ID().getText(), this.visit(n.datatype())]),
      functionReturnType: this.visit(ctx.functype().datatype()),
    };
    return type;
  };

  visitExternblock = (ctx: ExternblockContext): void => {
    const lang = ctx.externlang().getText()[1];
    if (lang === "C") {
      if (this.currentFunctionType) {
        throw new CompilerError(
          "Extern blocks cannot be nested",
          this.program.getLoc(ctx),
        );
      }
      this.currentFunctionType = FunctionType.External_C;
      this.visitChildren(ctx);
      this.currentFunctionType = undefined;
    } else {
      throw new CompilerError(
        `Extern Language '${lang}' is not supported.`,
        this.program.getLoc(ctx),
      );
    }
  };

  visitExternfuncdef = (ctx: ExternfuncdefContext): void => {
    if (!this.currentFunctionType) {
      throw new ImpossibleSituation();
    }

    const signature = ctx.ID_list().map((n) => n.getText());
    if (
      signature.length > 1 &&
      this.currentFunctionType === FunctionType.External_C
    ) {
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
  };

  private implFunc(
    ctx: FuncContext | NamedfuncContext | StructMethodContext,
    name: string,
  ): FunctionSymbol {
    const parentScope = this.program.currentScope;
    const scope = this.program.pushScope(
      new Scope(this.program.getLoc(ctx), this.program.currentScope),
    );

    if (this.currentFunctionType) {
      throw new ImpossibleSituation();
    }

    let returntype: Datatype = { variant: "Deferred" };
    if (ctx.datatype()) {
      returntype = this.visit(ctx.datatype());
    } else {
      if (ctx.funcbody().expr()) {
        const expr = this.visit(ctx.funcbody().expr());
        returntype = expr.type;
      }
    }

    const parentSymbol = this.structStack[this.structStack.length - 1];
    let isConstructor = undefined as boolean | undefined;
    let thisPointerType = undefined as Datatype | undefined;
    if (parentSymbol && parentSymbol.type?.variant === "Struct") {
      if (name === "constructor") {
        isConstructor = true;
        if (returntype.variant === "Deferred") {
          returntype = parentSymbol.type;
        } else {
          throw new CompilerError(
            `Constructor of struct '${parentSymbol.name}' returns the struct itself implicitly`,
            this.program.getLoc(ctx),
          );
        }
      } else {
        thisPointerType = parentSymbol.type;
      }
    }

    const type: FunctionDatatype = {
      variant: "Function",
      functionParameters: ctx
        .params()
        .param_list()
        .map((n) => this.visitParam(n)),
      functionReturnType: returntype,
    };
    const symbol: FunctionSymbol = {
      variant: "Function",
      name: name,
      functionType: FunctionType.Internal,
      type: type,
      isConstructor: isConstructor,
      thisPointer: thisPointerType,
      scope: scope,
      parentSymbol: parentSymbol,
      ctx: ctx,
    };
    parentScope.defineSymbol(symbol, this.program.getLoc(ctx));
    this.program.ctxToSymbolMap.set(ctx, symbol);

    if (symbol.functionType !== FunctionType.Internal) {
      this.program.externFunctions[mangleSymbol(symbol)] = symbol;
    } else {
      if (
        !isSymbolGeneric(symbol) &&
        (!parentSymbol || Object.keys(parentSymbol.type.generics).length === 0)
      ) {
        this.program.concreteFunctions[mangleSymbol(symbol)] = symbol;
      }
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

    const type: StructDatatype = {
      variant: "Struct",
      name: name,
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
      const content: VariableSymbol | FunctionSymbol = this.visit(c);
      if (content.variant === "Variable") {
        type.members.push(content);
      } else {
        type.methods.push(content);
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
