import {
  BooleanConstantContext,
  CdefinitiondeclContext,
  CommonDatatypeContext,
  FuncContext,
  FuncdeclContext,
  FunctionDatatypeContext,
  GenericsvalueContext,
  LiteralConstantContext,
  NamedfuncContext,
  NamespaceContext,
  ParamsContext,
  StringConstantContext,
  StructDeclContext,
  StructMemberContext,
  StructMethodContext,
  StructUnionFieldsContext,
  VariableDeclarationContext,
  VariableDefinitionContext,
  type ParamContext,
} from "./parser/HazeParser";
import type { Module } from "./Module";
import {
  Linkage,
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
  type ConstantSymbol,
  type StringConstantSymbol,
  type BooleanConstantSymbol,
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
import { Interval, type ParserRuleContext } from "antlr4";
import {
  collectFunction,
  collectVariableStatement,
  datatypeSymbolUsed,
  RESERVED_STRUCT_NAMES,
  visitBooleanConstantImpl,
  visitCommonDatatypeImpl,
  visitLiteralConstantImpl,
  visitParam,
  visitParams,
  visitStringConstantImpl,
  type ParamPack,
} from "./utils";
import type { Statement } from "./Statement";
import type { Parser } from "./parser";

export class SymbolCollector extends HazeVisitor<any> {
  private program: Module;
  private parentSymbolStack: DatatypeSymbol<
    StructDatatype | NamespaceDatatype
  >[];
  private parser?: Parser;

  constructor(program: Module) {
    super();
    this.program = program;
    this.parentSymbolStack = [];
  }

  collect = (ctx: ParserRuleContext, parser: Parser, filename: string) => {
    this.program.filename = filename;
    this.parser = parser;
    this.visit(ctx);
    this.parser = undefined;
    this.program.filename = undefined;
  };

  visitParam = (ctx: ParamContext): [string, Datatype] => {
    return visitParam(this, ctx);
  };

  visitParams = (ctx: ParamsContext): ParamPack => {
    return visitParams(this, ctx);
  };

  visitCommonDatatype = (ctx: CommonDatatypeContext): DatatypeSymbol => {
    return visitCommonDatatypeImpl(this, this.program, ctx);
  };

  visitCdefinitiondecl = (ctx: CdefinitiondeclContext): void => {
    const text = JSON.parse(ctx.STRING_LITERAL().getText());
    this.program.cDefinitionDecl.push(text);
  };

  visitFunctionDatatype = (ctx: FunctionDatatypeContext): DatatypeSymbol => {
    const params = this.visitParams(ctx.functype().params());
    const type: FunctionDatatype = {
      variant: "Function",
      functionParameters: params.params,
      functionReturnType: this.visit(ctx.functype().datatype()).type,
      vararg: params.vararg,
    };
    const symbol: Symbol = {
      name: "",
      scope: this.program.currentScope,
      type: type,
      variant: "Datatype",
      export: false,
      location: this.program.location(ctx),
    };
    datatypeSymbolUsed(symbol, this.program);
    return symbol;
  };

  visitFuncdecl = (ctx: FuncdeclContext): void => {
    // const extern = Boolean(ctx._extern);

    const lang = ctx.externlang()?.getText().slice(1, -1);
    let functype = Linkage.Internal;
    if (lang === "C") {
      functype = Linkage.External_C;
    } else if (functype) {
      throw new CompilerError(
        `Extern Language '${lang}' is not supported.`,
        this.program.location(ctx),
      );
    }

    const signature = ctx.ID_list().map((n) => n.getText());
    if (signature.length > 1 && functype === Linkage.External_C) {
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

    const symbol = collectFunction(
      this,
      ctx,
      signature[0],
      this.program,
      this.parentSymbolStack[this.parentSymbolStack.length - 1],
      functype,
    );
    if (symbol.export) {
      this.program.exportSymbols.set(mangleSymbol(symbol), symbol);
    }
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
    const datatypeSymbol: DatatypeSymbol = this.visit(ctx.datatype());
    const symbol: VariableSymbol = {
      variant: "Variable",
      name: name,
      type: datatypeSymbol.type,
      variableType: VariableType.MutableStructField,
      variableScope: VariableScope.Member,
      export: false,
      location: this.program.location(ctx),
      extern: Linkage.Internal,
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

    const lang = ctx.externlang()?.getText().slice(1, -1);
    let language = Linkage.Internal;
    if (lang === "C") {
      language = Linkage.External_C;
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

    if (genericsList.length > 0) {
      if (!this.parser?.parser || !ctx.stop) {
        throw new ImpossibleSituation();
      }
      const tokens = this.parser.parser.getTokenStream();
      let originalText = tokens.getText(
        new Interval(ctx.start.tokenIndex, ctx.stop.tokenIndex),
      );
      if (originalText.startsWith("export ")) {
        originalText = originalText.replace("export ", "");
      }
      symbol.originalGenericSourcecode = originalText;
    }

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
      this.program.exportSymbols.set(mangleSymbol(symbol), symbol);
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

    if (ctx._export_) {
      this.program.exportSymbols.set(mangleSymbol(symbol), symbol);
    }

    return symbol;
  };

  visitGenericsvalue = (
    ctx: GenericsvalueContext,
  ): ConstantSymbol | DatatypeSymbol => {
    if (ctx.constant()) {
      return this.visit(ctx.constant()) as ConstantSymbol;
    } else {
      return this.visit(ctx.datatype()) as DatatypeSymbol;
    }
  };

  visitStringConstant = (ctx: StringConstantContext): StringConstantSymbol => {
    return visitStringConstantImpl(this, ctx, this.program);
  };

  visitLiteralConstant = (ctx: LiteralConstantContext): ConstantSymbol => {
    return visitLiteralConstantImpl(this, ctx, this.program);
  };

  visitBooleanConstant = (
    ctx: BooleanConstantContext,
  ): BooleanConstantSymbol => {
    return visitBooleanConstantImpl(this, ctx, this.program);
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
