import {
  CompilerError,
  InternalError,
  printErrorMessage,
  type SourceLoc,
} from "../Errors";
import {
  EExternLanguage,
  ELiteralUnit,
  type ASTBooleanConstant,
  type ASTCInjectDirective,
  type ASTConstant,
  type ASTDatatype,
  type ASTFunctionDeclaration,
  type ASTGlobalVariableDefinition,
  type ASTNamedDatatype,
  type ASTNumberConstant,
  type ASTParam,
  type ASTRoot,
  type ASTStringConstant,
  type ASTStructDefinition,
  type ASTStructMemberDefinition,
  type ASTStructMethodDefinition,
  type ASTTopLevelDeclaration,
} from "../shared/AST/ASTRoot";
import { HazeLexer } from "./grammar/autogen/HazeLexer";
import {
  BooleanConstantContext,
  CInjectDirectiveContext,
  ConstantExprContext,
  DatatypeFragmentContext,
  ExternLanguageContext,
  FunctionDeclarationContext,
  GenericLiteralConstantContext,
  GenericLiteralContext,
  GenericLiteralDatatypeContext,
  GlobalVariableDefinitionContext,
  HazeParser,
  LiteralConstantContext,
  NamedDatatypeContext,
  NumberConstantContext,
  ParamsContext,
  ProgContext,
  StringConstantContext,
  StructDefinitionContext,
  StructMemberContext,
  StructMemberValueContext,
  StructMethodContext,
  TopLevelDeclarationContext,
} from "./grammar/autogen/HazeParser";
import {
  BaseErrorListener,
  CharStream,
  CommonTokenStream,
  ParserRuleContext,
} from "antlr4ng";
import { HazeVisitor } from "./grammar/autogen/HazeVisitor";

export namespace Parser {
  class HazeErrorListener extends BaseErrorListener {
    filename: string;

    constructor(filename: string) {
      super();
      this.filename = filename;
    }

    syntaxError(
      recognizer: any,
      offendingSymbol: any,
      line: number,
      column: number,
      msg: string,
      e: any,
    ) {
      printErrorMessage(
        msg,
        { filename: this.filename, line, column },
        "SyntaxError",
      );
    }
  }

  async function parseFile(filename: string) {
    const file = Bun.file(filename);
    const text = await file.text();
    return parse(text, filename);
  }

  function parse(text: string, errorListenerFilename: string) {
    const errorListener = new HazeErrorListener(errorListenerFilename);
    let inputStream = CharStream.fromString(text);
    let lexer = new HazeLexer(inputStream);
    lexer.removeErrorListeners();
    lexer.addErrorListener(errorListener);

    let tokenStream = new CommonTokenStream(lexer);
    const parser = new HazeParser(tokenStream);
    parser.removeErrorListeners();
    parser.addErrorListener(errorListener);

    if (parser.numberOfSyntaxErrors != 0) {
      return;
    }
    const ast = parser.prog();
    if (parser.numberOfSyntaxErrors != 0) {
      return;
    }
    return ast;
  }

  function transformAST(ctx: ProgContext, filename: string): ASTRoot {
    const transformer = new ASTTransformer(filename);
    const ast: ASTRoot = transformer.visit(ctx);
    // console.log(ast);
    console.log(JSON.stringify(ast, undefined, 4));
    return ast;
  }

  export async function parseFileToAST(filename: string) {
    const ctx = await parseFile(filename);
    if (!ctx) {
      return;
    }
    return transformAST(ctx, filename);
  }
}

class ASTTransformer extends HazeVisitor<any> {
  constructor(public filename: string) {
    super();
  }

  loc(ctx: ParserRuleContext): SourceLoc {
    return {
      filename: this.filename,
      line: ctx.start?.line ?? 0,
      column: ctx.start?.column ?? 0,
    };
  }

  exlang(
    ctx:
      | FunctionDeclarationContext
      | GlobalVariableDefinitionContext
      | StructDefinitionContext,
  ): EExternLanguage {
    if (!Boolean(ctx._extern)) {
      return EExternLanguage.None;
    } else if (ctx._externLang?.getText() === '"C"') {
      return EExternLanguage.Extern_C;
    } else {
      return EExternLanguage.Extern;
    }
  }

  mutability(ctx: GlobalVariableDefinitionContext): boolean {
    if (!ctx._mutability) {
      throw new InternalError("Mutability field of variable is not available");
    }
    if (ctx._mutability.text === "let") {
      return true;
    } else if (ctx._mutability.text === "const") {
      return false;
    } else {
      throw new InternalError(
        "Mutability field of variable is neither let nor const",
      );
    }
  }

  visitProg = (ctx: ProgContext): ASTRoot => {
    return ctx.children.map((c) => this.visit(c));
  };

  visitCInjectDirective = (
    ctx: CInjectDirectiveContext,
  ): ASTCInjectDirective => {
    return {
      variant: "CInjectDirective",
      code: ctx.STRING_LITERAL().getText(),
      sourceloc: this.loc(ctx),
    };
  };

  visitNumberConstant = (ctx: NumberConstantContext): ASTNumberConstant => {
    return {
      variant: "NumberConstant",
      sourceloc: this.loc(ctx),
      value: Number(ctx.NUMBER_LITERAL().getText()),
    };
  };

  visitStringConstant = (ctx: StringConstantContext): ASTStringConstant => {
    return {
      variant: "StringConstant",
      sourceloc: this.loc(ctx),
      value: ctx.STRING_LITERAL().getText().slice(1, -1),
    };
  };

  visitBooleanConstant = (ctx: BooleanConstantContext): ASTBooleanConstant => {
    return {
      variant: "BooleanConstant",
      sourceloc: this.loc(ctx),
      value: ctx.getText() === "true" ? true : false,
    };
  };

  visitLiteralConstant = (ctx: LiteralConstantContext): ASTNumberConstant => {
    function parseUnit(input: string): [number, string] {
      const match = input.match(/^(-?\d*\.?\d+)([a-zA-Z%]+)$/);
      if (!match) throw new Error(`Invalid format: "${input}"`);
      return [parseFloat(match[1]), match[2]];
    }
    const [value, unit] = parseUnit(ctx.UNIT_LITERAL().getText());

    let literalUnit: ELiteralUnit | undefined = undefined;
    switch (unit) {
      case undefined:
        break;

      case "s":
        literalUnit = ELiteralUnit.s;
        break;

      case "ms":
        literalUnit = ELiteralUnit.ms;
        break;

      case "us":
        literalUnit = ELiteralUnit.us;
        break;

      case "ns":
        literalUnit = ELiteralUnit.ns;
        break;

      case "h":
        literalUnit = ELiteralUnit.h;
        break;

      case "m":
        literalUnit = ELiteralUnit.m;
        break;

      case "d":
        literalUnit = ELiteralUnit.d;
        break;

      default:
        throw new CompilerError(
          `The unit '${unit}' is not known to the compiler`,
          this.loc(ctx),
        );
    }

    return {
      variant: "NumberConstant",
      sourceloc: this.loc(ctx),
      value: value,
      unit: literalUnit,
    };
  };

  visitGenericLiteralDatatype = (
    ctx: GenericLiteralDatatypeContext,
  ): ASTDatatype => {
    return this.visit(ctx.datatype());
  };

  visitGenericLiteralConstant = (
    ctx: GenericLiteralConstantContext,
  ): ASTConstant => {
    return this.visit(ctx.constant());
  };

  visitDatatypeFragment = (ctx: DatatypeFragmentContext) => {
    return {
      name: ctx.ID().getText(),
      generics: ctx._generics.map(
        (g) => this.visit(g) as ASTDatatype | ASTConstant,
      ),
      sourceloc: this.loc(ctx),
    };
  };

  visitNamedDatatype = (ctx: NamedDatatypeContext): ASTNamedDatatype => {
    const fragments = ctx
      .datatypeFragment()
      .map((c) => this.visitDatatypeFragment(c));
    const datatypes: ASTNamedDatatype[] = [];
    for (const fragment of fragments) {
      datatypes.push({
        variant: "NamedDatatype",
        name: fragment.name,
        sourceloc: fragment.sourceloc,
        generics: fragment.generics,
        nestedParent: datatypes[datatypes.length - 1],
      });
    }
    return datatypes[datatypes.length - 1];
  };

  visitParams = (
    ctx: ParamsContext,
  ): { params: ASTParam[]; ellipsis: boolean } => {
    const params = ctx.param().map(
      (p) =>
        ({
          datatype: this.visit(p.datatype()),
          name: p.ID().getText(),
          sourceloc: this.loc(p),
        }) satisfies ASTParam,
    );
    return {
      params: params,
      ellipsis: Boolean(ctx.ellipsis()),
    };
  };

  visitFunctionDeclaration = (
    ctx: FunctionDeclarationContext,
  ): ASTFunctionDeclaration => {
    const names = ctx.ID().map((c) => c.getText());
    const params = this.visitParams(ctx.params());
    return {
      variant: "FunctionDeclaration",
      export: Boolean(ctx._export_),
      externLanguage: this.exlang(ctx),
      name: names[names.length - 1],
      namespacePath: names.slice(0, -1),
      sourceloc: this.loc(ctx),
      params: params.params,
      ellipsis: params.ellipsis,
      returnType: (ctx.datatype() && this.visit(ctx.datatype()!)) || undefined,
    };
  };

  visitGlobalVariableDefinition = (
    ctx: GlobalVariableDefinitionContext,
  ): ASTGlobalVariableDefinition => {
    return {
      variant: "GlobalVariableDefinition",
      export: Boolean(ctx._export_),
      externLanguage: this.exlang(ctx),
      mutable: this.mutability(ctx),
      name: ctx.ID().getText(),
      sourceloc: this.loc(ctx),
      datatype: (ctx.datatype() && this.visit(ctx.datatype()!)) || undefined,
      expr: (ctx.expr() && this.visit(ctx.expr()!)) || undefined,
    };
  };

  visitStructMember = (ctx: StructMemberContext): ASTStructMemberDefinition => {
    return {
      variant: "StructMember",
      name: ctx.ID().getText(),
      type: this.visit(ctx.datatype()),
      sourceloc: this.loc(ctx),
    };
  };

  visitStructMethod = (ctx: StructMethodContext): ASTStructMethodDefinition => {
    const params = this.visitParams(ctx.params());
    return {
      variant: "StructMethod",
      params: params.params,
      ellipsis: params.ellipsis,
      returnType: (ctx.datatype() && this.visit(ctx.datatype()!)) || undefined,
      funcbody: (ctx.funcbody() && this.visit(ctx.funcbody()!)) || undefined,
      sourceloc: this.loc(ctx),
    };
  };

  visitStructDefinition = (
    ctx: StructDefinitionContext,
  ): ASTStructDefinition => {
    const name = ctx.ID()[0].getText();
    const generics = ctx
      .ID()
      .slice(1)
      .map((g) => g.getText());
    const content = ctx._content.map((c) => this.visit(c));
    const members: ASTStructMemberDefinition[] = [];
    const methods: ASTStructMethodDefinition[] = [];

    for (const c of content) {
      if (c.variant === "StructMember") {
        members.push(c);
      } else if (c.variant === "StructMethod") {
        methods.push(c);
      } else {
        throw new InternalError("Struct content was neither member nor method");
      }
    }

    return {
      variant: "StructDefinition",
      export: Boolean(ctx._export_),
      externLanguage: this.exlang(ctx),
      name: name,
      genericPlaceholders: generics,
      members: members,
      methods: methods,
      sourceloc: this.loc(ctx),
    };
  };
}
