import {
  BooleanConstantContext,
  CdefinitiondeclContext,
  CommonDatatypeContext,
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
} from "./parser/grammar/autogen/HazeParser";
import type { Module } from "./Module";
import { HazeVisitor } from "./parser/grammar/autogen/HazeVisitor";
import { CompilerError, ImpossibleSituation, InternalError } from "./Errors";
import { ResolvedScope } from "./Scope";
import { Interval, type ParserRuleContext } from "antlr4ng";
import {
  collectFunction,
  collectVariableStatement,
  datatypeSymbolUsed,
  mangleSymbol,
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
import type { ParsedDatatype, ParsedSymbol } from "./ParsedTypes";
import { ELinkage, EVariableContext, EVariableMutability } from "./common";

export class SymbolCollector extends HazeVisitor<any> {
  private module: Module;
  private parentSymbolStack: ParsedSymbol.Symbol[];
  private parser?: Parser;

  constructor(module: Module) {
    super();
    this.module = module;
    this.parentSymbolStack = [];
  }

  collect = (ctx: ParserRuleContext, parser: Parser, filename: string) => {
    this.module.filename = filename;
    this.parser = parser;
    this.visit(ctx);
    this.parser = undefined;
    this.module.filename = undefined;
  };

  visitParam = (ctx: ParamContext): [string, ParsedDatatype.Datatype] => {
    return visitParam(this, ctx);
  };

  visitParams = (ctx: ParamsContext): ParamPack => {
    return visitParams(this, ctx);
  };

  visitCommonDatatype = (
    ctx: CommonDatatypeContext,
  ): ParsedSymbol.DatatypeSymbol => {
    return visitCommonDatatypeImpl(this, this.module, ctx);
  };

  visitCdefinitiondecl = (ctx: CdefinitiondeclContext): void => {
    const text = JSON.parse(ctx.STRING_LITERAL().getText());
    this.module.cDefinitionDecl.push(text);
  };

  visitFunctionDatatype = (
    ctx: FunctionDatatypeContext,
  ): ParsedSymbol.DatatypeSymbol => {
    const params = this.visitParams(ctx.functype().params());
    const type: ParsedDatatype.Function = {
      variant: "Function",
      functionParameters: params.params,
      functionReturnType: this.visit(ctx.functype().datatype()).type,
      vararg: params.vararg,
    };
    const symbol: Symbol = {
      name: "",
      scope: this.module.currentScope,
      type: type,
      variant: "Datatype",
      export: false,
      location: this.module.location(ctx),
    };
    datatypeSymbolUsed(symbol, this.module);
    return symbol;
  };

  visitFuncdecl = (ctx: FuncdeclContext): void => {
    // const extern = Boolean(ctx._extern);

    const lang = ctx.externlang()?.getText().slice(1, -1);
    let functype = ELinkage.Internal;
    if (lang === "C") {
      functype = ELinkage.External_C;
    } else if (functype) {
      throw new CompilerError(
        `Extern Language '${lang}' is not supported.`,
        this.module.location(ctx),
      );
    }

    const signature = ctx.ID().map((n) => n.getText());
    if (signature.length > 1 && functype === ELinkage.External_C) {
      throw new CompilerError(
        "Extern C functions cannot be namespaced",
        this.module.location(ctx),
      );
    }

    if (signature.length > 1) {
      throw new InternalError(
        "Namespacing for external function is not implemented yet",
      );
    }

    const symbol = collectFunction(
      this.module,
      this,
      ctx,
      signature[0],
      this.parentSymbolStack[this.parentSymbolStack.length - 1],
      functype,
    );
    if (symbol.isExported) {
      this.module.exportSymbols.set(mangleSymbol(this.module, symbol), symbol);
    }
  };

  visitNamedfunc = (ctx: NamedfuncContext): ParsedSymbol.FunctionSymbol => {
    return collectFunction(
      this.module,
      this,
      ctx,
      ctx.ID().getText(),
      this.parentSymbolStack[this.parentSymbolStack.length - 1],
    );
  };

  visitStructMember = (ctx: StructMemberContext) => {
    const datatypeSymbol: ParsedSymbol.DatatypeSymbol = this.visit(
      ctx.datatype(),
    );
    const symbol = this.module.parsedStore.createSymbol((id) => ({
      id,
      variant: "Variable",
      name: ctx.ID().getText(),
      type: datatypeSymbol.type,
      variableType: EVariableMutability.MutableStructField,
      variableContext: EVariableContext.MemberOfStruct,
      isExported: false,
      location: this.module.location(ctx),
      linkage: ELinkage.Internal,
    }));
    return symbol;
  };

  // visitStructUnionFields = (
  //   ctx: StructUnionFieldsContext,
  // ): StructMemberUnion => {
  //   return {
  //     variant: "StructMemberUnion",
  //     symbols: ctx.structcontent().map((n) => this.visit(n)),
  //   };
  // };

  visitStructDecl = (ctx: StructDeclContext): ParsedSymbol.DatatypeSymbol => {
    const name = ctx.ID(0)!.getText();
    const parentScope = this.module.currentScope;
    const scope = this.module.pushScope(
      this.module.parsedStore.createScope(
        this.module.location(ctx),
        parentScope.id,
      ),
    );

    if (RESERVED_STRUCT_NAMES.includes(name)) {
      throw new CompilerError(
        `'${name}' is a reserved name`,
        this.module.location(ctx),
      );
    }

    const genericsList: string[] = ctx
      .ID()
      .slice(1)
      .map((n) => n.getText());

    const lang = ctx.externlang()?.getText().slice(1, -1);
    let language = ELinkage.Internal;
    if (lang === "C") {
      language = ELinkage.External_C;
    } else if (lang) {
      throw new CompilerError(
        `Extern Language '${lang}' is not supported.`,
        this.module.location(ctx),
      );
    }

    let exports = false;
    if (ctx._export_) {
      exports = true;
    }

    const type = this.module.parsedStore.createDatatype((id) => ({
      id,
      variant: "Struct",
      name: name,
      language: language,
      generics: genericsList,
      members: [],
      methods: [],
      parentSymbol:
        this.parentSymbolStack[this.parentSymbolStack.length - 1].id,
    }));
    const symbol = this.module.parsedStore.createSymbol((id) => ({
      id,
      variant: "Datatype",
      name: name,
      type: type.id,
      definedInScope: scope.id,
      parentSymbol:
        this.parentSymbolStack[this.parentSymbolStack.length - 1].id,
      isExported: exports,
      location: this.module.location(ctx),
    }));

    if (genericsList.length > 0) {
      if (!this.parser?.parser || !ctx.stop) {
        throw new ImpossibleSituation();
      }
      let originalText = this.parser.parser.tokenStream.getTextFromInterval(
        new Interval(ctx.start?.tokenIndex || 0, ctx.stop.tokenIndex),
      );
      if (originalText.startsWith("export ")) {
        originalText = originalText.replace("export ", "");
      }
      // symbol.originalGenericSourcecode = originalText;
    }

    parentScope.defineSymbol(symbol);
    // for (const [name, tp] of type.generics) {
    //   const sym: DatatypeSymbol = {
    //     name: name,
    //     variant: "Datatype",
    //     scope: scope,
    //     type: { variant: "Generic", name: name },
    //     export: false,
    //     location: symbol.location,
    //   };
    //   scope.defineSymbol(sym);
    // }
    this.parentSymbolStack.push(symbol);

    ctx.structcontent().forEach((c) => {
      const content: ParsedSymbol.VariableSymbol | ParsedSymbol.FunctionSymbol =
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
      this.module.exportSymbols.set(mangleSymbol(symbol), symbol);
    }

    this.parentSymbolStack.pop();
    this.module.popScope();
    return symbol;
  };

  visitStructMethod = (
    ctx: StructMethodContext,
  ): ParsedSymbol.FunctionSymbol => {
    const name = ctx.ID().getText();
    const symbol = collectFunction(
      this,
      ctx,
      name,
      this.module,
      this.parentSymbolStack[this.parentSymbolStack.length - 1],
    );
    return symbol;
  };

  visitNamespace = (ctx: NamespaceContext): ParsedSymbol.DatatypeSymbol => {
    const names = ctx.ID().map((c) => c.getText());

    let symbol: Symbol | undefined =
      this.parentSymbolStack[this.parentSymbolStack.length - 1];
    do {
      let insertionSymbol: Symbol | undefined;
      let insertionScope: ResolvedScope;
      if (!symbol) {
        symbol = this.module.currentScope.tryLookupSymbolHere(names[0]);
        insertionScope = this.module.currentScope;
      } else {
        if (symbol.type.variant !== "Namespace") {
          throw new ImpossibleSituation();
        }
        insertionScope = symbol.type.symbolsScope;
        insertionSymbol = symbol;
        symbol = symbol.type.symbolsScope.tryLookupSymbolHere(names[0]);
      }
      if (!symbol) {
        const newScope = new ResolvedScope(
          this.module.location(ctx),
          this.module.currentScope,
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
          location: this.module.location(ctx),
        };
        insertionScope.defineSymbol(symbol);
      }
      names.splice(0, 1);
    } while (names.length > 0);

    if (symbol.variant !== "Datatype" || symbol.type.variant !== "Namespace") {
      throw new InternalError("Namespace is not a datatype");
    }

    this.module.pushScope(symbol.scope);
    this.parentSymbolStack.push(symbol as ParsedSymbol.DatatypeSymbol);

    ctx.namespacecontent().children?.forEach((n) => {
      this.visit(n);
    });

    this.parentSymbolStack.pop();
    this.module.popScope();

    if (ctx._export_) {
      this.module.exportSymbols.set(mangleSymbol(this.module, symbol), symbol);
    }

    return symbol;
  };

  visitGenericsvalue = (
    ctx: GenericsvalueContext,
  ): ConstantSymbol | DatatypeSymbol => {
    if (ctx.constant()) {
      return this.visit(ctx.constant()!) as ConstantSymbol;
    } else {
      return this.visit(ctx.datatype()!) as DatatypeSymbol;
    }
  };

  visitStringConstant = (ctx: StringConstantContext): StringConstantSymbol => {
    return visitStringConstantImpl(this, ctx, this.module);
  };

  visitLiteralConstant = (
    ctx: LiteralConstantContext,
  ): ParsedSymbol.ConstantSymbol => {
    return visitLiteralConstantImpl(this, ctx, this.module);
  };

  visitBooleanConstant = (
    ctx: BooleanConstantContext,
  ): ParsedSymbol.BooleanConstantSymbol => {
    return visitBooleanConstantImpl(this, ctx, this.module);
  };

  visitVariableDefinition = (ctx: VariableDefinitionContext): Statement => {
    return collectVariableStatement(
      this,
      ctx,
      this.module,
      VariableScope.Global,
      this.parentSymbolStack[this.parentSymbolStack.length - 1],
    );
  };

  visitVariableDeclaration = (ctx: VariableDeclarationContext): Statement => {
    return collectVariableStatement(
      this,
      ctx,
      this.module,
      VariableScope.Global,
      this.parentSymbolStack[this.parentSymbolStack.length - 1],
    );
  };
}
