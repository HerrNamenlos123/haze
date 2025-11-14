import {
  assert,
  CompilerError,
  InternalError,
  printErrorMessage,
  SyntaxError,
  type SourceLoc,
} from "../shared/Errors";
import { readFile } from "fs/promises";
import {
  EAssignmentOperation,
  EBinaryOperation,
  EExternLanguage,
  EIncrOperation,
  ELiteralUnit,
  EUnaryOperation,
  type ASTBinaryExpr,
  type ASTCInjectDirective,
  type ASTLiteralExpr,
  type ASTTypeUse,
  type ASTExplicitCastExpr,
  type ASTExpr,
  type ASTExprAsFuncbody,
  type ASTExprAssignmentExpr,
  type ASTExprCallExpr,
  type ASTExprMemberAccess,
  type ASTExprStatement,
  type ASTFunctionDatatype,
  type ASTFunctionDefinition,
  type ASTGlobalVariableDefinition,
  type ASTIfStatement,
  type ASTInlineCStatement,
  type ASTLambda,
  type ASTLambdaExpr,
  type ASTNamedDatatype,
  type ASTNamespaceDefinition,
  type ASTParam,
  type ASTParenthesisExpr,
  type ASTPostIncrExpr,
  type ASTPreIncrExpr,
  type ASTReturnStatement,
  type ASTRoot,
  type ASTScope,
  type ASTStructDefinition,
  type ASTStructInstantiationExpr,
  type ASTStructMemberDefinition,
  type ASTSymbolValueExpr,
  type ASTUnaryExpr,
  type ASTVariableDefinitionStatement,
  type ASTWhileStatement,
  type ASTBlockScopeExpr,
  type ASTModuleImport,
  type ASTSymbolImport,
  type ASTTypeAlias,
  type ASTStackArrayDatatype,
  type ASTArrayLiteralExpr,
  type ASTArraySubscriptExpr,
  type ASTForEachStatement,
  type ASTTypeLiteralExpr,
  type ASTFStringExpr,
  type ASTDynamicArrayDatatype,
  type ASTArraySliceExpr,
  EDatatypeMutability,
  EVariableMutability,
  type ASTUnionDatatype,
  type ASTFunctionRequiresBlock,
} from "../shared/AST";
import {
  BinaryExprContext,
  BooleanConstantContext,
  CInjectDirectiveContext,
  CInlineStatementContext,
  DatatypeFragmentContext,
  ExplicitCastExprContext,
  ExprAsFuncbodyContext,
  ExprAssignmentExprContext,
  ExprCallExprContext,
  ExprMemberAccessContext,
  ExprStatementContext,
  FunctionDatatypeContext,
  FunctionDefinitionContext,
  GenericLiteralConstantContext,
  GenericLiteralDatatypeContext,
  GlobalVariableDefinitionContext,
  HazeParser,
  IfStatementContext,
  LambdaContext,
  LambdaExprContext,
  NamedDatatypeContext,
  NamespaceDefinitionContext,
  NestedStructDefinitionContext,
  ParamsContext,
  ParenthesisExprContext,
  PostIncrExprContext,
  PreIncrExprContext,
  ProgContext,
  ReturnStatementContext,
  StringConstantContext,
  StructDefinitionContext,
  StructInstantiationExprContext,
  StructMemberContext,
  StructMethodContext,
  SymbolValueExprContext,
  UnaryExprContext,
  VariableCreationStatementContext,
  WhileStatementContext,
  IntegerLiteralContext,
  FloatLiteralContext,
  IntegerUnitLiteralContext,
  FloatUnitLiteralContext,
  LiteralExprContext,
  FromImportStatementContext,
  ImportStatementContext,
  ArrayLiteralContext,
  ArraySubscriptExprContext,
  ForEachStatementContext,
  TypeLiteralExprContext,
  FStringLiteralContext,
  ArraySliceExprContext,
  DatatypeInParenthesisContext,
  DatatypeWithMutabilityContext,
  TypeAliasDirectiveContext,
  TypeAliasStatementContext,
  VariableConstContext,
  VariableLetContext,
  BlockScopeExprContext,
  DoScopeContext,
  RawScopeContext,
  SourceLocationPrefixRuleContext,
  GlobalDeclarationWithSourceContext,
  GlobalDeclarationContext,
  TopLevelDeclarationsContext,
  DynamicArrayDatatypeContext,
  StackArrayDatatypeContext,
  UnionDatatypeContext,
  RequiresBlockContext,
  RequiresFinalContext,
  StructContentWithSourcelocContext,
  RequiresAutodestContext,
} from "./grammar/autogen/HazeParser";
import {
  BaseErrorListener,
  CharStream,
  CommonTokenStream,
  ParserRuleContext,
  TerminalNode,
} from "antlr4ng";
import { HazeLexer } from "./grammar/autogen/HazeLexer";
import { HazeParserVisitor } from "./grammar/autogen/HazeParserVisitor";
import { EMethodType, EPrimitive, EVariableContext, type LiteralValue } from "../shared/common";
import type { ModuleConfig } from "../shared/Config";

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
      e: any
    ) {
      printErrorMessage(msg, { filename: this.filename, start: { line, column } }, "SyntaxError");
    }
  }

  async function parseFile(filename: string) {
    const text = await readFile(filename, "utf-8");
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

  function transformAST(config: ModuleConfig, ctx: ProgContext, filename: string): ASTRoot {
    const transformer = new ASTTransformer(config, filename);
    return transformer.visit(ctx);
  }

  export function parseTextToAST(config: ModuleConfig, text: string, filename: string) {
    const ctx = parse(text, filename);
    if (!ctx) {
      throw new SyntaxError();
    }
    return transformAST(config, ctx, filename);
  }

  export async function parseFileToAST(config: ModuleConfig, filename: string) {
    const ctx = await parseFile(filename);
    if (!ctx) {
      throw new SyntaxError();
    }
    return transformAST(config, ctx, filename);
  }
}

class ASTTransformer extends HazeParserVisitor<any> {
  constructor(public config: ModuleConfig, public filename: string) {
    super();
  }

  sourcelocOverride: SourceLoc[] = [];

  loc(ctx: ParserRuleContext): SourceLoc {
    if (this.sourcelocOverride.length > 0) {
      return this.sourcelocOverride[this.sourcelocOverride.length - 1];
    }

    return {
      filename: this.filename,
      start: {
        line: ctx.start?.line ?? 0,
        column: ctx.start?.column ?? 0,
      },
      end: {
        line: ctx.stop?.line ?? 0,
        column: ctx.stop?.column ?? 0,
      },
    };
  }

  exlang(
    ctx:
      | GlobalVariableDefinitionContext
      | FunctionDefinitionContext
      | StructDefinitionContext
      | TypeAliasDirectiveContext
  ): EExternLanguage {
    if (!Boolean(ctx._extern)) {
      return EExternLanguage.None;
    } else if (ctx._externLang?.getText() === "C") {
      return EExternLanguage.Extern_C;
    } else {
      return EExternLanguage.Extern;
    }
  }

  mutability(
    ctx: GlobalVariableDefinitionContext | VariableCreationStatementContext | StructMemberContext
  ): EVariableMutability {
    if (!ctx.variableMutabilitySpecifier) {
      return EVariableMutability.Default;
    } else if (ctx.variableMutabilitySpecifier() instanceof VariableConstContext) {
      return EVariableMutability.Const;
    } else if (ctx.variableMutabilitySpecifier() instanceof VariableLetContext) {
      return EVariableMutability.Let;
    }
    throw new InternalError("Mutability field of variable is neither let nor const");
  }

  incrop(ctx: PostIncrExprContext): EIncrOperation {
    if (!ctx._op) {
      throw new InternalError("Operator missing");
    }
    if (ctx._op.text === "++") {
      return EIncrOperation.Incr;
    } else if (ctx._op.text === "--") {
      return EIncrOperation.Decr;
    } else {
      throw new InternalError("Operator is neither increment nor decrement");
    }
  }

  unaryop(ctx: UnaryExprContext) {
    if (!ctx._op) {
      throw new InternalError("Operator missing");
    }
    if (ctx._op.text === "-") {
      return EUnaryOperation.Minus;
    } else if (ctx._op.text === "+") {
      return EUnaryOperation.Plus;
    } else if (ctx._op.text === "not") {
      return EUnaryOperation.Negate;
    } else if (ctx._op.text === "!") {
      return EUnaryOperation.Negate;
    } else {
      throw new InternalError("Operator is neither increment nor decrement");
    }
  }

  assignop(ctx: ExprAssignmentExprContext) {
    if (!ctx._op) {
      throw new InternalError("Operator missing");
    }
    if (ctx._op.text === "=") {
      return EAssignmentOperation.Assign;
    } else if (ctx._op.text === ":=") {
      return EAssignmentOperation.AssignRefTarget;
    } else if (ctx._op.text === "+=") {
      return EAssignmentOperation.Add;
    } else if (ctx._op.text === "-=") {
      return EAssignmentOperation.Subtract;
    } else if (ctx._op.text === "*=") {
      return EAssignmentOperation.Multiply;
    } else if (ctx._op.text === "/=") {
      return EAssignmentOperation.Divide;
    } else if (ctx._op.text === "%=") {
      return EAssignmentOperation.Modulo;
    } else {
      throw new InternalError("Operator is unknown: " + ctx._op.text);
    }
  }

  binaryop(ctx: BinaryExprContext) {
    if (ctx._op.length === 1 && ctx._op[0].text === "*") {
      return EBinaryOperation.Multiply;
    } else if (ctx._op.length === 1 && ctx._op[0].text === "/") {
      return EBinaryOperation.Divide;
    } else if (ctx._op.length === 1 && ctx._op[0].text === "%") {
      return EBinaryOperation.Modulo;
    } else if (ctx._op.length === 1 && ctx._op[0].text === "+") {
      return EBinaryOperation.Add;
    } else if (ctx._op.length === 1 && ctx._op[0].text === "-") {
      return EBinaryOperation.Subtract;
    } else if (ctx._op.length === 1 && ctx._op[0].text === "<") {
      return EBinaryOperation.LessThan;
    } else if (ctx._op.length === 1 && ctx._op[0].text === ">") {
      return EBinaryOperation.GreaterThan;
    } else if (ctx._op.length === 1 && ctx._op[0].text === "<=") {
      return EBinaryOperation.LessEqual;
    } else if (ctx._op.length === 1 && ctx._op[0].text === ">=") {
      return EBinaryOperation.GreaterEqual;
    } else if (ctx._op.length === 1 && ctx._op[0].text === "==") {
      return EBinaryOperation.Equal;
    } else if (ctx._op.length === 1 && ctx._op[0].text === "!=") {
      return EBinaryOperation.Unequal;
    } else if (ctx._op.length === 1 && ctx._op[0].text === "is") {
      return EBinaryOperation.Equal;
    } else if (ctx._op.length === 2 && ctx._op[0].text === "is" && ctx._op[1].text === "not") {
      return EBinaryOperation.Unequal;
    } else if (ctx._op.length === 1 && ctx._op[0].text === "&&") {
      return EBinaryOperation.BoolAnd;
    } else if (ctx._op.length === 1 && ctx._op[0].text === "||") {
      return EBinaryOperation.BoolOr;
    } else {
      throw new InternalError(
        "Operator is not known: " + JSON.stringify(ctx._op.map((o) => o.text))
      );
    }
  }

  getSource(ctx: ParserRuleContext) {
    if (!ctx.start || !ctx.start.inputStream) return "";
    const startIdx = ctx.start.start;
    const stopIdx = ctx.stop?.stop ?? ctx.start.start;
    const originalText = ctx.start.inputStream.getTextFromRange(startIdx, stopIdx);
    return originalText;
  }

  requires(
    ctx: FunctionDefinitionContext | StructMethodContext | FunctionDatatypeContext
  ): ASTFunctionRequiresBlock {
    if (ctx.requiresBlock()) {
      return this.visit(ctx.requiresBlock()!);
    } else {
      return {
        final: false,
        autodest: false,
      };
    }
  }

  visitProg = (ctx: ProgContext): ASTRoot => {
    const result = ctx.children
      .map((c) => {
        if (c instanceof TerminalNode && c.getText() === "<EOF>") {
          return;
        }
        const result = this.visit(c);
        return result;
      })
      .filter((c) => !!c)
      .flat();
    return result;
  };

  visitTopLevelDeclarations = (ctx: TopLevelDeclarationsContext) => {
    const children = ctx.children.map((c) => this.visit(c)).flat();
    return children;
  };

  visitCInjectDirective = (ctx: CInjectDirectiveContext): ASTCInjectDirective => {
    return {
      variant: "CInjectDirective",
      code: JSON.parse(ctx.STRING_LITERAL().getText()),
      export: Boolean(ctx._export_),
      sourceloc: this.loc(ctx),
    };
  };

  visitIntegerLiteral = (ctx: IntegerLiteralContext): LiteralValue => {
    return {
      type: EPrimitive.int,
      value: BigInt(ctx.INTEGER_LITERAL().getText()),
      unit: null,
    };
  };

  visitFloatLiteral = (ctx: FloatLiteralContext): LiteralValue => {
    return {
      type: EPrimitive.real,
      value: Number(ctx.FLOAT_LITERAL().getText()),
      unit: null,
    };
  };

  visitIntegerUnitLiteral = (ctx: IntegerUnitLiteralContext): LiteralValue => {
    return this.makeIntegerUnitLiteral(ctx);
  };

  visitFloatUnitLiteral = (ctx: FloatUnitLiteralContext): LiteralValue => {
    return this.makeFloatUnitLiteral(ctx);
  };

  visitStringConstant = (ctx: StringConstantContext): LiteralValue => {
    return {
      type: EPrimitive.str,
      value: JSON.parse(ctx.STRING_LITERAL().getText()),
    };
  };

  visitBooleanConstant = (ctx: BooleanConstantContext): LiteralValue => {
    return {
      type: EPrimitive.bool,
      value: ctx.getText() === "true" ? true : false,
    };
  };

  makeIntegerUnitLiteral(ctx: IntegerUnitLiteralContext): LiteralValue {
    function parseUnitBigInt(input: string): [bigint, string] {
      const match = input.match(/^(-?\d+)([a-zA-Z%]+)$/);
      if (!match) throw new Error(`Invalid format: "${input}"`);

      const value = BigInt(match[1]);
      const unit = match[2];

      return [value, unit];
    }

    const [value, unit] = parseUnitBigInt(ctx.UNIT_INTEGER_LITERAL().getText());

    let literalUnit: ELiteralUnit | null = null;
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
        throw new CompilerError(`The unit '${unit}' is not known to the compiler`, this.loc(ctx));
    }

    return {
      value: value,
      type: EPrimitive.int,
      unit: literalUnit,
    };
  }

  makeFloatUnitLiteral(ctx: FloatUnitLiteralContext): LiteralValue {
    function parseUnit(input: string): [number, string] {
      const match = input.match(/^(-?\d*\.?\d+)([a-zA-Z%]+)$/);
      if (!match) throw new Error(`Invalid format: "${input}"`);
      return [parseFloat(match[1]), match[2]];
    }
    const [value, unit] = parseUnit(ctx.UNIT_FLOAT_LITERAL().getText());

    let literalUnit: ELiteralUnit | null = null;
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
        throw new CompilerError(`The unit '${unit}' is not known to the compiler`, this.loc(ctx));
    }

    return {
      value: value,
      type: EPrimitive.real,
      unit: literalUnit,
    };
  }

  visitGenericLiteralDatatype = (ctx: GenericLiteralDatatypeContext): ASTTypeUse => {
    return this.visit(ctx.datatype());
  };

  visitGenericLiteralConstant = (ctx: GenericLiteralConstantContext): ASTLiteralExpr => {
    return {
      variant: "LiteralExpr",
      literal: this.visit(ctx.literal()),
      sourceloc: this.loc(ctx),
    };
  };

  visitDatatypeFragment = (ctx: DatatypeFragmentContext) => {
    return {
      name: ctx.ID().getText(),
      generics: ctx.genericLiteral().map((g) => this.visit(g) as ASTTypeUse | ASTLiteralExpr),
      sourceloc: this.loc(ctx),
    };
  };

  visitUnionDatatype = (ctx: UnionDatatypeContext): ASTUnionDatatype => {
    const members = ctx.baseDatatype().map((d) => this.visit(d));

    if (members.length === 1) {
      return members[0];
    }

    return {
      variant: "UnionDatatype",
      members: members,
      sourceloc: this.loc(ctx),
    };
  };

  visitNamedDatatype = (ctx: NamedDatatypeContext): ASTNamedDatatype => {
    const fragments = ctx.datatypeFragment().map((c) => this.visitDatatypeFragment(c));
    const datatypes: ASTNamedDatatype[] = [];
    for (const fragment of fragments.reverse()) {
      datatypes.push({
        variant: "NamedDatatype",
        name: fragment.name,
        sourceloc: fragment.sourceloc,
        generics: fragment.generics,
        inline: false,
        mutability: EDatatypeMutability.Default,
        nested: datatypes[datatypes.length - 1],
      });
    }
    return datatypes[datatypes.length - 1];
  };

  visitParams = (ctx: ParamsContext): { params: ASTParam[]; ellipsis: boolean } => {
    const params = ctx.param().map((p) => {
      let datatype: ASTTypeUse;
      if (p.datatype()) {
        datatype = this.visit(p.datatype()!);
      } else {
        datatype = {
          variant: "ParameterPack",
          sourceloc: this.loc(ctx),
        };
      }
      return {
        datatype: datatype,
        name: p.ID().getText(),
        optional: Boolean(p.QUESTIONMARK()),
        sourceloc: this.loc(p),
      } satisfies ASTParam;
    });
    return {
      params: params,
      ellipsis: Boolean(ctx.ellipsis()),
    };
  };

  visitExprAsFuncbody = (ctx: ExprAsFuncbodyContext): ASTExprAsFuncbody => {
    return {
      variant: "ExprAsFuncBody",
      expr: this.visit(ctx.expr()),
    };
  };

  visitRequiresBlock = (ctx: RequiresBlockContext): ASTFunctionRequiresBlock => {
    const block: ASTFunctionRequiresBlock = {
      final: false,
      autodest: false,
    };
    for (const part of ctx.requiresPart()) {
      if (part instanceof RequiresFinalContext) {
        block.final = true;
      }
      if (part instanceof RequiresAutodestContext) {
        block.autodest = true;
      }
    }
    return block;
  };

  visitFunctionDefinition = (ctx: FunctionDefinitionContext): ASTFunctionDefinition => {
    const names = ctx.ID().map((c) => c.getText());
    const params = this.visitParams(ctx.params());
    const generics = ctx
      .ID()
      .slice(1)
      .map((g) => g.getText());

    return {
      variant: "FunctionDefinition",
      export: Boolean(ctx._export_),
      noemit: Boolean(ctx._noemit),
      pub: Boolean(ctx._pub),
      externLanguage: this.exlang(ctx),
      params: params.params,
      generics: generics.map((p) => ({
        name: p,
        sourceloc: this.loc(ctx), // TODO: Find a better sourceloc from the actual token, not the function
      })),
      requires: this.requires(ctx),
      static: false,
      methodType: EMethodType.None,
      name: names[0],
      operatorOverloading: undefined,
      ellipsis: params.ellipsis,
      funcbody: (ctx.funcbody() && this.visit(ctx.funcbody()!)) || undefined,
      returnType: (ctx.datatype() && this.visit(ctx.datatype()!)) || undefined,
      sourceloc: this.loc(ctx),
      originalSourcecode: this.getSource(ctx),
    };
  };

  visitLambda = (ctx: LambdaContext): ASTLambda => {
    const params = this.visitParams(ctx.params());
    return {
      variant: "Lambda",
      params: params.params,
      ellipsis: params.ellipsis,
      funcbody: (ctx.funcbody() && this.visit(ctx.funcbody()!)) || undefined,
      returnType: (ctx.datatype() && this.visit(ctx.datatype()!)) || undefined,
      sourceloc: this.loc(ctx),
    };
  };

  visitGlobalVariableDefinition = (
    ctx: GlobalVariableDefinitionContext
  ): ASTGlobalVariableDefinition => {
    return {
      variant: "GlobalVariableDefinition",
      pub: Boolean(ctx._pub),
      export: Boolean(ctx._export_),
      extern: this.exlang(ctx),
      comptime: Boolean(ctx._comptime),
      mutability: this.mutability(ctx),
      name: ctx.ID().getText(),
      sourceloc: this.loc(ctx),
      datatype: (ctx.datatype() && this.visit(ctx.datatype()!)) || undefined,
      expr: (ctx.expr() && this.visit(ctx.expr()!)) || undefined,
    };
  };

  visitStructMember = (ctx: StructMemberContext): ASTStructMemberDefinition[] => {
    return [
      {
        variant: "StructMember",
        name: ctx.ID().getText(),
        type: this.visit(ctx.datatype()),
        mutability: ctx.variableMutabilitySpecifier()
          ? this.mutability(ctx)
          : EVariableMutability.Default,
        defaultValue: ctx.expr() ? this.visit(ctx.expr()!) : null,
        sourceloc: this.loc(ctx),
      },
    ];
  };

  visitStructMethod = (ctx: StructMethodContext): ASTFunctionDefinition[] => {
    const names = ctx.ID().map((c) => c.getText());
    const params = this.visitParams(ctx.params());

    const name = names[0];
    let methodType = EMethodType.Method;
    if (name === "constructor") {
      methodType = EMethodType.Constructor;
    }

    return [
      {
        variant: "FunctionDefinition",
        params: params.params,
        export: false,
        externLanguage: EExternLanguage.None,
        noemit: false,
        pub: false,
        methodType: methodType,
        name: names[0],
        static: Boolean(ctx._static_),
        generics: names.slice(1).map((n) => ({
          name: n,
          sourceloc: this.loc(ctx), // TODO: Find a better sourceloc from the actual token, not the function
        })),
        requires: this.requires(ctx),
        ellipsis: params.ellipsis,
        operatorOverloading: undefined,
        returnType: (ctx.datatype() && this.visit(ctx.datatype()!)) || undefined,
        funcbody: (ctx.funcbody() && this.visit(ctx.funcbody()!)) || undefined,
        sourceloc: this.loc(ctx),
        originalSourcecode: this.getSource(ctx),
      },
    ];
  };

  visitNestedStructDefinition = (ctx: NestedStructDefinitionContext): ASTStructDefinition[] => {
    return [this.visit(ctx.structDefinition())];
  };

  visitStructDefinition = (ctx: StructDefinitionContext): ASTStructDefinition => {
    const name = ctx.ID()[0].getText();
    const generics = ctx
      .ID()
      .slice(1)
      .map((g) => g.getText());
    const content = ctx._content.map((c) => this.visit(c));
    const members: ASTStructMemberDefinition[] = [];
    const methods: ASTFunctionDefinition[] = [];
    const declarations: ASTStructDefinition[] = [];

    const processContent = (c: any) => {
      if (Array.isArray(c)) {
        c.forEach((cc) => processContent(cc));
      } else if (c.variant === "StructMember") {
        members.push(c);
      } else if (c.variant === "FunctionDefinition") {
        methods.push(c);
      } else if (c.variant === "StructDefinition") {
        declarations.push(c);
      } else {
        throw new InternalError("Struct content was neither member nor method");
      }
    };

    for (const c of content) {
      processContent(c);
    }

    return {
      variant: "StructDefinition",
      export: Boolean(ctx._export_),
      pub: Boolean(ctx._pub),
      extern: this.exlang(ctx),
      name: name,
      noemit: Boolean(ctx._noemit),
      generics: generics.map((p) => ({
        name: p,
        sourceloc: this.loc(ctx), // TODO: Find a better sourceloc from the actual token, not the function
      })),
      nestedStructs: declarations,
      members: members,
      methods: methods,
      sourceloc: this.loc(ctx),
      originalSourcecode: this.getSource(ctx),
    };
  };

  visitRawScope = (ctx: RawScopeContext): ASTScope => {
    return {
      variant: "Scope",
      sourceloc: this.loc(ctx),
      unsafe: false,
      emittedExpr: null,
      statements: ctx.statement().map((s) => this.visit(s)),
    };
  };

  visitDoScope = (ctx: DoScopeContext): ASTBlockScopeExpr => {
    return {
      variant: "BlockScopeExpr",
      scope: {
        variant: "Scope",
        unsafe: Boolean(ctx.UNSAFE()),
        emittedExpr: ctx.expr() ? this.visit(ctx.expr()!) : null,
        statements: ctx.statement().map((s) => this.visit(s)),
        sourceloc: this.loc(ctx),
      },
      sourceloc: this.loc(ctx),
    };
  };

  visitScopeStatement = (ctx: BlockScopeExprContext): ASTBlockScopeExpr => {
    return {
      variant: "BlockScopeExpr",
      scope: this.visit(ctx.doScope()),
      sourceloc: this.loc(ctx),
    };
  };

  visitCInlineStatement = (ctx: CInlineStatementContext): ASTInlineCStatement => {
    return {
      variant: "InlineCStatement",
      code: JSON.parse(ctx.STRING_LITERAL().getText()),
      sourceloc: this.loc(ctx),
    };
  };

  visitExprStatement = (ctx: ExprStatementContext): ASTExprStatement => {
    return {
      variant: "ExprStatement",
      expr: this.visit(ctx.expr()),
      sourceloc: this.loc(ctx),
    };
  };

  visitReturnStatement = (ctx: ReturnStatementContext): ASTReturnStatement => {
    return {
      variant: "ReturnStatement",
      expr: (ctx.expr() && this.visit(ctx.expr()!)) || undefined,
      sourceloc: this.loc(ctx),
    };
  };

  visitVariableCreationStatement = (
    ctx: VariableCreationStatementContext
  ): ASTVariableDefinitionStatement => {
    return {
      variant: "VariableDefinitionStatement",
      mutability: this.mutability(ctx),
      comptime: Boolean(ctx._comptime),
      name: ctx.ID().getText(),
      sourceloc: this.loc(ctx),
      datatype: (ctx.datatype() && this.visit(ctx.datatype()!)) || undefined,
      expr: (ctx.expr() && this.visit(ctx.expr()!)) || undefined,
      variableContext: EVariableContext.FunctionLocal,
    };
  };

  visitForEachStatement = (ctx: ForEachStatementContext): ASTForEachStatement => {
    return {
      variant: "ForEachStatement",
      loopVariable: ctx.ID()[0].getText(),
      indexVariable: ctx.ID().length > 1 ? ctx.ID()[1].getText() : null,
      value: this.visit(ctx.expr()),
      body: this.visit(ctx.rawScope()),
      sourceloc: this.loc(ctx),
      comptime: Boolean(ctx._comptime),
    };
  };

  visitIfStatement = (ctx: IfStatementContext): ASTIfStatement => {
    if (!ctx._ifExpr) {
      throw new InternalError("if expression is missing");
    }
    if (!ctx._then) {
      throw new InternalError("then scope is missing");
    }

    let elseIfs: {
      condition: ASTExpr;
      then: ASTScope;
    }[] = [];

    if (ctx._elseIfExpr.length !== ctx._elseIfThen.length) {
      throw new InternalError("inconsistent length");
    }

    for (let i = 0; i < ctx._elseIfExpr.length; i++) {
      elseIfs.push({
        condition: this.visit(ctx._elseIfExpr[i]),
        then: this.visit(ctx._elseIfThen[i]),
      });
    }

    let elseBlock: ASTScope | undefined = undefined;
    if (ctx._elseBlock) {
      elseBlock = this.visit(ctx._elseBlock);
    }

    return {
      variant: "IfStatement",
      condition: this.visit(ctx._ifExpr),
      then: this.visit(ctx._then),
      sourceloc: this.loc(ctx),
      elseIfs: elseIfs,
      comptime: Boolean(ctx._comptime),
      else: elseBlock,
    };
  };

  visitWhileStatement = (ctx: WhileStatementContext): ASTWhileStatement => {
    return {
      variant: "WhileStatement",
      condition: this.visit(ctx.expr()),
      body: this.visit(ctx.rawScope()),
      sourceloc: this.loc(ctx),
    };
  };

  visitTypeAliasDirective = (ctx: TypeAliasDirectiveContext): ASTTypeAlias => {
    return {
      variant: "TypeAlias",
      datatype: this.visit(ctx.datatype()),
      export: Boolean(ctx._export_),
      extern: this.exlang(ctx),
      pub: Boolean(ctx._pub),
      name: ctx.ID().getText(),
      sourceloc: this.loc(ctx),
    };
  };

  visitTypeAliasStatement = (ctx: TypeAliasStatementContext): ASTTypeAlias => {
    return this.visit(ctx.typeDef());
  };

  visitParenthesisExpr = (ctx: ParenthesisExprContext): ASTParenthesisExpr => {
    return {
      variant: "ParenthesisExpr",
      expr: this.visit(ctx.expr()),
      sourceloc: this.loc(ctx),
    };
  };

  visitLambdaExpr = (ctx: LambdaExprContext): ASTLambdaExpr => {
    return {
      variant: "LambdaExpr",
      lambda: this.visit(ctx.lambda()),
      sourceloc: this.loc(ctx),
    };
  };

  visitLiteralExpr = (ctx: LiteralExprContext): ASTLiteralExpr => {
    return {
      variant: "LiteralExpr",
      literal: this.visit(ctx.literal()),
      sourceloc: this.loc(ctx),
    };
  };

  visitPostIncrExpr = (ctx: PostIncrExprContext): ASTPostIncrExpr => {
    return {
      variant: "PostIncrExpr",
      expr: this.visit(ctx.expr()),
      operation: this.incrop(ctx),
      sourceloc: this.loc(ctx),
    };
  };

  visitExprCallExpr = (ctx: ExprCallExprContext): ASTExprCallExpr => {
    const exprs = ctx._argExpr.map((e) => this.visit(e));
    assert(ctx._callExpr);
    return {
      variant: "ExprCallExpr",
      calledExpr: this.visit(ctx._callExpr),
      arguments: exprs,
      inArena: ctx._arenaExpr ? this.visit(ctx._arenaExpr) : null,
      sourceloc: this.loc(ctx),
    };
  };

  visitDynamicArrayDatatype = (ctx: DynamicArrayDatatypeContext): ASTDynamicArrayDatatype => {
    return {
      variant: "DynamicArrayDatatype",
      datatype: this.visit(ctx.datatype()),
      mutability: EDatatypeMutability.Default,
      sourceloc: this.loc(ctx),
    };
  };

  visitExprMemberAccess = (ctx: ExprMemberAccessContext): ASTExprMemberAccess => {
    const generics: (ASTTypeUse | ASTLiteralExpr)[] = [];
    for (let i = 0; i < ctx.genericLiteral().length; i++) {
      generics.push(this.visit(ctx.genericLiteral()[i]));
    }
    return {
      variant: "ExprMemberAccess",
      expr: this.visit(ctx.expr()),
      member: ctx.ID().getText(),
      sourceloc: this.loc(ctx),
      generics: generics,
    };
  };

  visitStructInstantiationExpr = (
    ctx: StructInstantiationExprContext
  ): ASTStructInstantiationExpr => {
    if (ctx.ID().length !== ctx._valueExpr.length) {
      throw new InternalError("Inconsistent size");
    }
    const members: { name: string; value: ASTExpr }[] = [];
    for (let i = 0; i < ctx.ID().length; i++) {
      members.push({
        name: ctx.ID()[i].getText(),
        value: this.visit(ctx._valueExpr[i]),
      });
    }
    return {
      variant: "StructInstantiationExpr",
      datatype: ctx.datatype() ? this.visit(ctx.datatype()!) : null,
      members: members,
      inArena: ctx._arenaExpr ? this.visit(ctx._arenaExpr) : null,
      sourceloc: this.loc(ctx),
    };
  };

  visitPreIncrExpr = (ctx: PreIncrExprContext): ASTPreIncrExpr => {
    return {
      variant: "PreIncrExpr",
      expr: this.visit(ctx.expr()),
      operation: this.incrop(ctx),
      sourceloc: this.loc(ctx),
    };
  };

  visitUnaryExpr = (ctx: UnaryExprContext): ASTUnaryExpr => {
    return {
      variant: "UnaryExpr",
      expr: this.visit(ctx.expr()),
      operation: this.unaryop(ctx),
      sourceloc: this.loc(ctx),
    };
  };

  visitExplicitCastExpr = (ctx: ExplicitCastExprContext): ASTExplicitCastExpr => {
    return {
      variant: "ExplicitCastExpr",
      castedTo: this.visit(ctx.datatype()),
      expr: this.visit(ctx.expr()),
      sourceloc: this.loc(ctx),
    };
  };

  visitBinaryExpr = (ctx: BinaryExprContext): ASTBinaryExpr => {
    return {
      variant: "BinaryExpr",
      a: this.visit(ctx.expr()[0]),
      b: this.visit(ctx.expr()[1]),
      operation: this.binaryop(ctx),
      sourceloc: this.loc(ctx),
    };
  };

  visitExprAssignmentExpr = (ctx: ExprAssignmentExprContext): ASTExprAssignmentExpr => {
    return {
      variant: "ExprAssignmentExpr",
      target: this.visit(ctx.expr()[0]),
      value: this.visit(ctx.expr()[1]),
      operation: this.assignop(ctx),
      sourceloc: this.loc(ctx),
    };
  };

  visitSymbolValueExpr = (ctx: SymbolValueExprContext): ASTSymbolValueExpr => {
    const generics: (ASTTypeUse | ASTLiteralExpr)[] = [];
    for (let i = 0; i < ctx.genericLiteral().length; i++) {
      generics.push(this.visit(ctx.genericLiteral()[i]));
    }
    return {
      variant: "SymbolValueExpr",
      generics: generics,
      name: ctx.ID().getText(),
      sourceloc: this.loc(ctx),
    };
  };

  visitDatatypeWithMutability = (ctx: DatatypeWithMutabilityContext): ASTTypeUse => {
    const datatype: ASTTypeUse = this.visit(ctx.datatypeImpl());
    switch (datatype.variant) {
      case "NamedDatatype":
      case "StackArrayDatatype":
        if (ctx.INLINE()) {
          datatype.inline = true;
        }
        if (ctx.CONST()) {
          datatype.mutability = EDatatypeMutability.Const;
        }
        if (ctx.MUT()) {
          datatype.mutability = EDatatypeMutability.Mut;
        }
        break;

      case "DynamicArrayDatatype":
      case "FunctionDatatype":
        if (ctx.CONST()) {
          datatype.mutability = EDatatypeMutability.Const;
        }
        if (ctx.MUT()) {
          datatype.mutability = EDatatypeMutability.Mut;
        }
        break;

      case "Deferred":
      case "ParameterPack":
        if (ctx.CONST() || ctx.MUT()) {
          throw new CompilerError(
            `A mutability specifier cannot appear on a '${datatype.variant}' datatype`,
            this.loc(ctx)
          );
        }
        break;

      case "UnionDatatype":
        break;

      default:
        assert(false);
    }
    return datatype;
  };

  visitDatatypeInParenthesis = (ctx: DatatypeInParenthesisContext): ASTTypeUse => {
    return this.visit(ctx.datatype());
  };

  visitFunctionDatatype = (ctx: FunctionDatatypeContext): ASTFunctionDatatype => {
    const params = this.visitParams(ctx.params());
    return {
      variant: "FunctionDatatype",
      params: params.params,
      ellipsis: params.ellipsis,
      returnType: (ctx.datatype() && this.visit(ctx.datatype()!)) || undefined,
      requires: this.requires(ctx),
      mutability: EDatatypeMutability.Default,
      sourceloc: this.loc(ctx),
    };
  };

  visitImportStatement = (ctx: ImportStatementContext): ASTModuleImport => {
    if (ctx._path) {
      assert(ctx._path.text);
      return {
        alias: ctx._alias?.text || null,
        mode: "path",
        name: JSON.parse(ctx._path.text),
        sourceloc: this.loc(ctx),
        variant: "ModuleImport",
      };
    } else {
      assert(ctx._module_?.text);
      return {
        alias: ctx._alias?.text || null,
        mode: "module",
        name: ctx._module_.text,
        sourceloc: this.loc(ctx),
        variant: "ModuleImport",
      };
    }
  };

  visitFromImportStatement = (ctx: FromImportStatementContext): ASTSymbolImport => {
    const symbols = ctx.importAs().map((imp) => {
      assert(imp._symbol_?.text);
      return {
        alias: imp._alias?.text || null,
        symbol: imp._symbol_.text,
      };
    });
    if (ctx._path) {
      assert(ctx._path.text);
      return {
        symbols: symbols,
        mode: "path",
        name: JSON.parse(ctx._path.text),
        sourceloc: this.loc(ctx),
        variant: "SymbolImport",
      };
    } else {
      assert(ctx._module_?.text);
      return {
        symbols: symbols,
        mode: "module",
        name: ctx._module_.text,
        sourceloc: this.loc(ctx),
        variant: "SymbolImport",
      };
    }
  };

  visitGlobalDeclaration = (ctx: GlobalDeclarationContext) => {
    const results = [];
    for (const child of ctx.children ?? []) {
      const result = this.visit(child);
      if (result !== undefined && result !== null) results.push(result);
    }
    const flat = results.flat();
    return flat;
  };

  visitNamespaceDefinition = (ctx: NamespaceDefinitionContext): ASTNamespaceDefinition => {
    const names = ctx.ID().map((c) => c.getText());
    const namesReversed = names.reverse();

    let currentNamespace: ASTNamespaceDefinition = {
      variant: "NamespaceDefinition",
      declarations: ctx
        .globalDeclaration()
        .map((g) => this.visit(g))
        .flat(),
      export: Boolean(ctx._export_),
      name: namesReversed[0],
      sourceloc: this.loc(ctx),
    };

    for (const name of namesReversed.slice(1)) {
      currentNamespace = {
        variant: "NamespaceDefinition",
        declarations: [currentNamespace],
        export: Boolean(ctx._export_),
        name: name,
        sourceloc: this.loc(ctx),
      };
    }

    return currentNamespace;
  };

  visitStackArrayDatatype = (ctx: StackArrayDatatypeContext): ASTStackArrayDatatype => {
    return {
      variant: "StackArrayDatatype",
      datatype: this.visit(ctx.datatype()),
      length: Number(ctx.INTEGER_LITERAL()?.getText()),
      mutability: EDatatypeMutability.Default,
      inline: false,
      sourceloc: this.loc(ctx),
    };
  };

  visitArrayLiteral = (ctx: ArrayLiteralContext): ASTArrayLiteralExpr => {
    return {
      variant: "ArrayLiteralExpr",
      values: ctx.expr().map((e) => this.visit(e)),
      sourceloc: this.loc(ctx),
    };
  };

  visitArraySubscriptExpr = (ctx: ArraySubscriptExprContext): ASTArraySubscriptExpr => {
    assert(ctx._value);
    assert(ctx._index);
    return {
      variant: "ArraySubscriptExpr",
      expr: this.visit(ctx._value),
      indices: ctx._index.map((i) => this.visit(i)),
      sourceloc: this.loc(ctx),
    };
  };

  visitArraySliceExpr = (ctx: ArraySliceExprContext): ASTArraySliceExpr => {
    assert(ctx._value);
    assert(ctx._index);
    return {
      variant: "ArraySliceExpr",
      expr: this.visit(ctx._value),
      indices: ctx._index.map((i) => ({
        start: i.expr()[0] ? this.visit(i.expr()[0]) : null,
        end: i.expr()[1] ? this.visit(i.expr()[1]) : null,
      })),
      sourceloc: this.loc(ctx),
    };
  };

  visitTypeLiteralExpr = (ctx: TypeLiteralExprContext): ASTTypeLiteralExpr => {
    return {
      variant: "TypeLiteralExpr",
      datatype: this.visit(ctx.datatype()),
      sourceloc: this.loc(ctx),
    };
  };

  visitFStringLiteral = (ctx: FStringLiteralContext): ASTFStringExpr => {
    const fragments = ctx
      .interpolatedString()
      .interpolatedStringFragment()
      .map((g) => {
        if (g.interpolatedStringExpression()) {
          return {
            type: "expr",
            value: this.visit(g.interpolatedStringExpression()!.expr()),
          } as const;
        } else {
          assert(g.FSTRING_GRAPHEME());
          return {
            type: "text",
            value: g.FSTRING_GRAPHEME()!.getText(),
          } as const;
        }
      });

    const combinedFragments = [] as
      | ({ type: "expr"; value: ASTExpr } | { type: "text"; value: string })[];

    for (const fragment of fragments) {
      if (fragment.type === "expr") {
        combinedFragments.push(fragment);
      } else {
        const lastFragment =
          combinedFragments.length > 0 ? combinedFragments[combinedFragments.length - 1] : null;
        if (lastFragment && lastFragment.type === "text") {
          lastFragment.value += fragment.value;
        } else {
          combinedFragments.push(fragment);
        }
      }
    }

    return {
      variant: "FStringExpr",
      fragments: combinedFragments,
      sourceloc: this.loc(ctx),
    };
  };

  visitSourceLocationPrefixRule = (ctx: SourceLocationPrefixRuleContext): SourceLoc => {
    const filename = JSON.parse(ctx.STRING_LITERAL().getText());

    const ints = ctx.INTEGER_LITERAL().map((int) => parseInt(int.getText()));
    const float = ctx.FLOAT_LITERAL() ? ctx.FLOAT_LITERAL()!.getText() : null;
    if (ints.length === 2 && float === null) {
      return {
        filename: filename,
        start: {
          line: ints[0],
          column: ints[1],
        },
      };
    } else if (ints.length === 3) {
      return {
        filename: filename,
        start: {
          line: ints[0],
          column: ints[1],
        },
        end: {
          line: ints[0],
          column: ints[2],
        },
      };
    } else if (ints.length === 2 && float !== null) {
      const end = float.split(".");
      return {
        filename: filename,
        start: {
          line: ints[0],
          column: ints[1],
        },
        end: {
          line: parseInt(end[0]),
          column: parseInt(end[1]),
        },
      };
    } else {
      throw new CompilerError(`Unexpected number of integers`, this.loc(ctx));
    }
  };

  visitGlobalDeclarationWithSource = (ctx: GlobalDeclarationWithSourceContext): any => {
    const sourceloc = this.visitSourceLocationPrefixRule(ctx.sourceLocationPrefixRule());

    this.sourcelocOverride.push(sourceloc);
    const decls = ctx
      .globalDeclaration()
      .map((g) => this.visit(g))
      .flat();
    this.sourcelocOverride.pop();

    return decls;
  };

  visitStructContentWithSourceloc = (ctx: StructContentWithSourcelocContext) => {
    const sourceloc = this.visitSourceLocationPrefixRule(ctx.sourceLocationPrefixRule());

    this.sourcelocOverride.push(sourceloc);
    const content = ctx.structContent().map((c) => this.visit(c));
    this.sourcelocOverride.pop();

    return content;
  };
}
