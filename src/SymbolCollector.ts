import {
  CdefinitiondeclContext,
  CommonDatatypeContext,
  FuncContext,
  FuncdeclContext,
  FunctionDatatypeContext,
  LinkerhintContext,
  NamedfuncContext,
  NamespaceContext,
  ParamsContext,
  PostbuildcmdContext,
  PrebuildcmdContext,
  StructDeclContext,
  StructMemberContext,
  StructMethodContext,
  StructUnionFieldsContext,
  VariableDeclarationContext,
  VariableDefinitionContext,
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
  VariableScope,
  type Symbol,
} from "./Symbol";
import HazeVisitor from "./parser/HazeVisitor";
import { CompilerError, ImpossibleSituation, InternalError } from "./Errors";
import {
  getStructMembers,
  type Datatype,
  type FunctionDatatype,
  type GenericPlaceholderDatatype,
  type NamespaceDatatype,
  type StructDatatype,
  type StructMemberUnion,
} from "./Datatype";
import { Scope } from "./Scope";
import type { ParserRuleContext } from "antlr4";
import {
  collectFunction,
  collectVariableStatement,
  datatypeSymbolUsed,
  RESERVED_STRUCT_NAMES,
  visitCommonDatatypeImpl,
  visitParam,
  visitParams,
  type ParamPack,
} from "./utils";
import type { Statement } from "./Statement";

export class SymbolCollector extends HazeVisitor<any> {
  private program: Program;
  private parentSymbolStack: DatatypeSymbol<
    StructDatatype | NamespaceDatatype
  >[];

  constructor(program: Program) {
    super();
    this.program = program;
    this.parentSymbolStack = [];
  }

  collect = (ctx: ParserRuleContext, filename: string) => {
    this.program.filename = filename;
    this.visit(ctx);
    this.program.filename = undefined;
  };

  visitParam = (ctx: ParamContext): [string, Datatype] => {
    return visitParam(this, ctx);
  };

  visitParams = (ctx: ParamsContext): ParamPack => {
    return visitParams(this, ctx);
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
        export: false,
        location: this.program.location(ctx),
      },
      this.program,
    );
    return type;
  };

  visitFuncdecl = (ctx: FuncdeclContext): void => {
    if (!ctx.externlang()) {
      throw new CompilerError(
        "Currently function declarations need an extern language",
        this.program.location(ctx),
      );
    }

    const lang = ctx.externlang().getText()[1];
    let functype = Language.Internal;
    if (lang === "C") {
      functype = Language.External_C;
    } else {
      throw new CompilerError(
        `Extern Language '${lang}' is not supported.`,
        this.program.location(ctx),
      );
    }

    const signature = ctx.ID_list().map((n) => n.getText());
    if (signature.length > 1 && functype === Language.External_C) {
      throw new CompilerError(
        "Extern C functions cannot be namespaced",
        this.program.location(ctx),
      );
    }

    if (signature.length > 1) {
      throw new InternalError(
        "Namespacing for external function is not implemented yet",
      );
    }

    collectFunction(
      this,
      ctx,
      signature[0],
      this.program,
      this.parentSymbolStack[this.parentSymbolStack.length - 1],
      functype,
    );
  };

  // Disabled because anonymous functions are collected in the semantic analyzer
  // visitFunc = (ctx: FuncContext): FunctionSymbol => {
  //   return collectFunction(
  //     this,
  //     ctx,
  //     this.program.makeAnonymousName(),
  //     this.program,
  //     this.parentSymbolStack[this.parentSymbolStack.length - 1],
  //   );
  // };

  visitNamedfunc = (ctx: NamedfuncContext): FunctionSymbol => {
    return collectFunction(
      this,
      ctx,
      ctx.ID().getText(),
      this.program,
      this.parentSymbolStack[this.parentSymbolStack.length - 1],
    );
  };

  visitStructMember = (ctx: StructMemberContext) => {
    const name = ctx.ID().getText();
    const datatype = this.visit(ctx.datatype());
    const symbol: VariableSymbol = {
      variant: "Variable",
      name: name,
      type: datatype,
      variableType: VariableType.MutableStructField,
      variableScope: VariableScope.Member,
      export: false,
      location: this.program.location(ctx),
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
      new Scope(this.program.location(ctx), parentScope),
    );

    if (RESERVED_STRUCT_NAMES.includes(name)) {
      throw new CompilerError(
        `'${name}' is a reserved name`,
        this.program.location(ctx),
      );
    }

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
        this.program.location(ctx),
      );
    }

    let exports = false;
    if (ctx._export_) {
      exports = true;
    }

    const type: StructDatatype = {
      variant: "Struct",
      name: name,
      language: language,
      generics: new Map<string, undefined>(genericsList),
      members: [],
      methods: [],
      parentSymbol: this.parentSymbolStack[this.parentSymbolStack.length - 1],
    };
    const symbol: DatatypeSymbol<StructDatatype> = {
      variant: "Datatype",
      name: name,
      type: type,
      scope: scope,
      parentSymbol: this.parentSymbolStack[this.parentSymbolStack.length - 1],
      export: exports,
      location: this.program.location(ctx),
    };

    parentScope.defineSymbol(symbol);
    for (const [name, tp] of type.generics) {
      const sym: DatatypeSymbol = {
        name: name,
        variant: "Datatype",
        scope: scope,
        type: { variant: "Generic", name: name },
        export: false,
        location: symbol.location,
      };
      scope.defineSymbol(sym);
    }
    this.parentSymbolStack.push(symbol);

    ctx.structcontent_list().forEach((c) => {
      const content: VariableSymbol | StructMemberUnion | FunctionSymbol =
        this.visit(c);
      if (content.variant === "Variable") {
        type.members.push(content);
      } else if (content.variant === "Function") {
        if (symbol.type.language) {
          throw new CompilerError(
            `A declared struct cannot have methods`,
            symbol.location,
          );
        }
        type.methods.push(content);
      } else if (content.variant === "StructMemberUnion") {
        type.members.push(content);
      } else {
        throw new ImpossibleSituation();
      }
    });

    if (symbol.export) {
      this.program.exportDatatypes.set(mangleSymbol(symbol), symbol);
    }

    this.parentSymbolStack.pop();
    this.program.popScope();
    return symbol;
  };

  visitStructMethod = (ctx: StructMethodContext): FunctionSymbol => {
    const name = ctx.ID().getText();
    const symbol = collectFunction(
      this,
      ctx,
      name,
      this.program,
      this.parentSymbolStack[this.parentSymbolStack.length - 1],
    );
    return symbol;
  };

  visitNamespace = (ctx: NamespaceContext): DatatypeSymbol => {
    const names = ctx.ID_list().map((c) => c.getText());

    let symbol: Symbol | undefined =
      this.parentSymbolStack[this.parentSymbolStack.length - 1];
    do {
      let insertionSymbol: Symbol | undefined;
      let insertionScope: Scope;
      if (!symbol) {
        symbol = this.program.currentScope.tryLookupSymbolHere(names[0]);
        insertionScope = this.program.currentScope;
      } else {
        if (symbol.type.variant !== "Namespace") {
          throw new ImpossibleSituation();
        }
        insertionScope = symbol.type.symbolsScope;
        insertionSymbol = symbol;
        symbol = symbol.type.symbolsScope.tryLookupSymbolHere(names[0]);
      }
      if (!symbol) {
        const newScope = new Scope(
          this.program.location(ctx),
          this.program.currentScope,
        );
        if (insertionSymbol && insertionSymbol.variant !== "Datatype") {
          throw new ImpossibleSituation();
        }
        symbol = {
          name: names[0],
          variant: "Datatype",
          scope: newScope,
          type: {
            variant: "Namespace",
            name: names[0],
            symbolsScope: newScope,
            parentSymbol: insertionSymbol,
          },
          parentSymbol: insertionSymbol,
          export: false,
          location: this.program.location(ctx),
        };
        insertionScope.defineSymbol(symbol);
      }
      names.splice(0, 1);
    } while (names.length > 0);

    if (symbol.variant !== "Datatype" || symbol.type.variant !== "Namespace") {
      throw new InternalError("Namespace is not a datatype");
    }

    this.program.pushScope(symbol.scope);
    this.parentSymbolStack.push(symbol as DatatypeSymbol<NamespaceDatatype>);

    ctx.namespacecontent().children?.forEach((n) => {
      this.visit(n);
    });

    this.parentSymbolStack.pop();
    this.program.popScope();

    return symbol;
  };

  visitPrebuildcmd = (ctx: PrebuildcmdContext): void => {
    const cmd = JSON.parse(ctx.STRING_LITERAL().getText()) as string;
    this.program.prebuildCmds.push(cmd);
  };

  visitPostbuildcmd = (ctx: PostbuildcmdContext): void => {
    const cmd = JSON.parse(ctx.STRING_LITERAL().getText()) as string;
    this.program.postbuildCmds.push(cmd);
  };

  visitLinkerhint = (ctx: LinkerhintContext): void => {
    const cmd = JSON.parse(ctx.STRING_LITERAL().getText()) as string;
    this.program.linkerFlags.push(cmd);
  };

  visitVariableDefinition = (ctx: VariableDefinitionContext): Statement => {
    return collectVariableStatement(
      this,
      ctx,
      this.program,
      VariableScope.Global,
      this.parentSymbolStack[this.parentSymbolStack.length - 1],
    );
  };

  visitVariableDeclaration = (ctx: VariableDeclarationContext): Statement => {
    return collectVariableStatement(
      this,
      ctx,
      this.program,
      VariableScope.Global,
      this.parentSymbolStack[this.parentSymbolStack.length - 1],
    );
  };
}
