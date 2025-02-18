import {
  CommonDatatypeContext,
  ExternblockContext,
  ExternfuncdefContext,
  FunctionDatatypeContext,
  NamedObjectExprContext,
  StructDeclContext,
  StructFieldDeclContext,
  StructFuncDeclContext,
  type ParamContext,
} from "./parser/HazeParser";
import type { Program } from "./Program";
import {
  FunctionType,
  type DatatypeSymbol,
  type FunctionSymbol,
  type MemberSymbol,
  type MethodSymbol,
} from "./Symbol";
import HazeVisitor from "./parser/HazeVisitor";
import { CompilerError, ImpossibleSituation, InternalError } from "./Errors";
import type {
  BaseDatatype,
  BaseFunctionDatatype,
  BaseGenericDatatype,
  BaseStructDatatype,
  ConcreteDatatype,
  Datatype,
} from "./Datatype";
import { Scope } from "./Scope";

export class SymbolCollector extends HazeVisitor<any> {
  private program: Program;
  private currentFunctionType: FunctionType | undefined;
  private structStack: DatatypeSymbol[];
  private currentFunctionSymbols: FunctionSymbol[];

  constructor(program: Program) {
    super();
    this.program = program;
    this.currentFunctionType = undefined;
    this.structStack = [];
    this.currentFunctionSymbols = [];
  }

  visitParam = (ctx: ParamContext): [string, BaseDatatype] => {
    return [ctx.ID().getText(), this.visit(ctx.datatype())];
  };

  visitCommonDatatype = (ctx: CommonDatatypeContext): BaseDatatype => {
    const name = ctx.ID().getText();
    const baseType = this.program.findBaseDatatype(name);
    if (!baseType) {
      const d: BaseGenericDatatype = {
        variant: "Generic",
        concrete: false,
        name: name,
      };
      return d;
    }

    const genericsProvided: BaseDatatype[] = ctx
      .datatype_list()
      .map((n) => this.visit(n));
    switch (baseType.variant) {
      case "Primitive":
        if (genericsProvided.length > 0) {
          throw new CompilerError(
            `Type '${name}' expected no generic arguments but got ${genericsProvided.length}.`,
            this.program.getLoc(ctx),
          );
        }
        return baseType;

      case "Struct":
        if (genericsProvided.length > 0) {
          throw new CompilerError(
            `Type '${name}<>' expected ${baseType.generics.length} generic arguments but got ${genericsProvided.length}.`,
            this.program.getLoc(ctx),
          );
        }
        return baseType;

      default:
        throw new ImpossibleSituation();
    }
  };

  visitFunctionDatatype = (ctx: FunctionDatatypeContext): BaseDatatype => {
    const type: BaseFunctionDatatype = {
      variant: "Function",
      concrete: false,
      functionParameters: ctx
        .functype()
        .params()
        .param_list()
        .map((n) => [n.ID().getText(), this.visit(n.datatype())]),
      functionReturnType: this.visit(ctx.functype().datatype()),
      generics: [],
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

    // const name = signature[signature.length - 1];
    // const symbol = new FunctionSymbol(
    //   name,
    //   null,
    //   Datatype.createFunctionType(
    //     [],
    //     Datatype.createPrimitiveType(Datatype.PrimitiveVariants.none),
    //   ),
    //   this.currentFunctionType,
    //   null,
    //   null,
    //   false,
    //   [],
    //   ctx,
    // );

    // const params: [string, Datatype][] = [];
    // for (let i = 0; i < ctx.params().param().length; i++) {
    //   const name = ctx.params().param()[i].ID().getText();
    //   const datatype = this.visit(ctx.params().param()[i].datatype());
    //   params.push([name, datatype]);
    // }

    // this.currentFunctionSymbols.push(symbol);
    // this.visitChildren(ctx);
    // this.currentFunctionSymbols.pop();

    // const returntype = symbol.type.functionReturnType();
    // if (ctx.returntype()) {
    //   returntype = this.visit(ctx.returntype());
    // }

    // symbol.type = Datatype.createFunctionType(params, returntype);
    // this.program.globalScope.defineSymbol(symbol, this.program.getLoc(ctx));
    // this.program.externFunctionRefs.push(
    //   new ExternFunctionRef(
    //     FunctionLinkage.External_C,
    //     this.program.getLoc(ctx),
    //     symbol,
    //   ),
    // );
    // this.setNodeSymbol(ctx, symbol);
  };

  private implFunc(
    ctx:
      | HazeParser.FuncContext
      | HazeParser.NamedfuncContext
      | HazeParser.StructFuncDeclContext,
    name: string,
  ): FunctionSymbol {
    const scope = this.db.pushScope(
      new Scope(this.program.getLoc(ctx), this.db.getCurrentScope()),
    );

    if (this.currentFunctionType) {
      throw new ImpossibleSituation();
    }

    const symbol = new FunctionSymbol(
      name,
      this.structStack[this.structStack.length - 1],
      Datatype.createFunctionType([], Datatype.createDeferredType()),
      FunctionLinkage.Haze,
      scope,
      null,
      false,
      [],
      ctx,
    );
    this.setNodeSymbol(ctx, symbol);

    const params: [string, Datatype][] = [];
    for (let i = 0; i < ctx.params().param().length; i++) {
      const nm = ctx.params().param()[i].ID().getText();
      const datatype = this.visit(ctx.params().param()[i].datatype());
      params.push([nm, datatype]);
      if (symbol.scope) {
        symbol.scope.defineSymbol(
          new VariableSymbol(nm, symbol, datatype, VariableType.Parameter),
          this.program.getLoc(ctx),
        );
      }
    }

    let returntype = Datatype.createDeferredType();
    if (ctx.returntype()) {
      returntype = this.visit(ctx.returntype());
    } else {
      if (ctx.funcbody().expr()) {
        const expr = this.visit(ctx.funcbody().expr());
        returntype = expr.type;
      }
    }

    if (symbol.parentSymbol && symbol.parentSymbol.type.isStruct()) {
      if (name === "constructor") {
        symbol.isConstructor = true;
        if (returntype.isDeferred()) {
          returntype = symbol.parentSymbol.type;
        } else {
          throw new CompilerError(
            `Constructor of struct '${symbol.parentSymbol.name}' returns the struct itself implicitly`,
            this.program.getLoc(ctx),
          );
        }
      } else {
        symbol.thisPointerType = Datatype.createPointerDatatype(
          symbol.parentSymbol.type,
        );
        if (!symbol.scope) {
          throw new ImpossibleSituation();
        }
        symbol.scope.defineSymbol(
          new VariableSymbol(
            "this",
            symbol,
            symbol.thisPointerType,
            VariableType.Parameter,
          ),
          this.program.getLoc(ctx),
        );
      }
    }

    symbol.type = Datatype.createFunctionType(params, returntype);
    this.program.globalScope.defineSymbol(symbol, this.program.getLoc(ctx));

    this.db.popScope();
    this.setNodeSymbol(ctx, symbol);
    return symbol;
  }

  public visitFunc(ctx: HazeParser.FuncContext): FunctionSymbol {
    return this.implFunc(ctx, this.db.makeAnonymousFunctionName());
  }

  public visitNamedfunc(ctx: HazeParser.NamedfuncContext): FunctionSymbol {
    return this.implFunc(ctx, ctx.ID().getText());
  }

  visitStructMember = (ctx: StructFieldDeclContext) => {
    const name = ctx.ID().getText();
    const datatype = this.visit(ctx.datatype());
    const symbol: MemberSymbol = {
      variant: "Member",
      name: name,
      type: datatype,
    };
    return symbol;
  };

  visitStructDecl = (ctx: StructDeclContext): DatatypeSymbol => {
    const name = ctx.ID(0).getText();
    const parentScope = this.program.currentScope;
    const scope = this.program.pushScope(
      new Scope(this.program.getLoc(ctx), parentScope),
    );

    const genericsList = ctx
      .ID_list()
      .slice(1)
      .map((n) => n.getText());
    // genericsList.forEach((generic) => {
    //   scope.defineSymbol(
    //     new GenericPlaceholderSymbol(generic[0]),
    //     this.program.getLoc(ctx),
    //   );
    // });

    const type: BaseStructDatatype = {
      variant: "Struct",
      concrete: false,
      name: name,
      generics: genericsList,
      members: [],
      methods: [],
    };
    const symbol: DatatypeSymbol = {
      variant: "Datatype",
      name: name,
      type: type,
      scope: scope,
    };
    parentScope.defineSymbol(symbol, this.program.getLoc(ctx));
    this.structStack.push(symbol);

    ctx.structcontent_list().forEach((c) => {
      const content: MemberSymbol | MethodSymbol = this.visit(c);
      if (content.variant === "Member") {
        type.members.push(content);
      } else {
        type.methods.push(content);
      }
    });

    this.structStack.pop();
    this.program.popScope();
    return symbol;
  };

  // visitStructMethod = (ctx: StructFuncDeclContext): FunctionSymbol => {
  //   const name = ctx.ID().getText();
  //   // return this.implFunc(ctx, name);
  //   const symbol: MethodSymbol = {
  //     variant: "Method",
  //     name: name,
  //   };
  //   return symbol;
  // };
}
