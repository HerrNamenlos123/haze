import {
  CompilerError,
  InternalError,
  printErrorMessage,
  SyntaxError,
  type SourceLoc,
} from "../shared/Errors";
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
  type ASTDatatype,
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
  type ASTPointerAddressOfExpr,
  type ASTPointerDatatype,
  type ASTPointerDereferenceExpr,
  type ASTReferenceDatatype,
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
  type ASTScopeStatement,
  EVariableMutability,
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
  PointerAddressOfContext,
  PointerDatatypeContext,
  PointerDereferenceContext,
  ReferenceDatatypeContext,
  ReturnStatementContext,
  ScopeContext,
  StringConstantContext,
  StructDefinitionContext,
  StructInstantiationExprContext,
  StructMemberContext,
  StructMethodContext,
  SymbolValueExprContext,
  UnaryExprContext,
  VariableCreationStatementContext,
  WhileStatementContext,
  VariableMutableContext,
  VariableImmutableContext,
  VariableBindingImmutableContext,
  ScopeStatementContext,
  IntegerLiteralContext,
  FloatLiteralContext,
  IntegerUnitLiteralContext,
  FloatUnitLiteralContext,
  LiteralExprContext,
} from "./grammar/autogen/HazeParser";
import {
  BaseErrorListener,
  CharStream,
  CommonTokenStream,
  ParserRuleContext,
  TerminalNode,
} from "antlr4ng";
import { HazeLexer } from "./grammar/autogen/HazeLexer";
import { HazeVisitor } from "./grammar/autogen/HazeVisitor";
import { EMethodType, EPrimitive, EVariableContext, type LiteralValue } from "../shared/common";
import { makeModulePrefix } from "../Module";
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
      printErrorMessage(msg, { filename: this.filename, line, column }, "SyntaxError");
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

class ASTTransformer extends HazeVisitor<any> {
  constructor(public config: ModuleConfig, public filename: string) {
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
    ctx: GlobalVariableDefinitionContext | FunctionDefinitionContext | StructDefinitionContext
  ): EExternLanguage {
    if (!Boolean(ctx._extern)) {
      return EExternLanguage.None;
    } else if (ctx._externLang?.getText() === '"C"') {
      return EExternLanguage.Extern_C;
    } else {
      return EExternLanguage.Extern;
    }
  }

  mutability(
    ctx: GlobalVariableDefinitionContext | VariableCreationStatementContext
  ): EVariableMutability {
    if (!ctx.variableMutabilitySpecifier) {
      throw new InternalError("Mutability field of variable is not available");
    } else if (ctx.variableMutabilitySpecifier() instanceof VariableMutableContext) {
      return EVariableMutability.Mutable;
    } else if (ctx.variableMutabilitySpecifier() instanceof VariableImmutableContext) {
      return EVariableMutability.Immutable;
    } else if (ctx.variableMutabilitySpecifier() instanceof VariableBindingImmutableContext) {
      return EVariableMutability.BindingImmutable;
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
    } else if (ctx._op.length === 1 && ctx._op[0].text === "and") {
      return EBinaryOperation.BoolAnd;
    } else if (ctx._op.length === 1 && ctx._op[0].text === "or") {
      return EBinaryOperation.BoolOr;
    } else {
      throw new InternalError(
        "Operator is not known: " + JSON.stringify(ctx._op.map((o) => o.text))
      );
    }
  }

  visitProg = (ctx: ProgContext): ASTRoot => {
    return ctx.children
      .map((c) => {
        if (c instanceof TerminalNode && c.getText() === "<EOF>") {
          return;
        }
        return this.visit(c);
      })
      .filter((c) => !!c);
  };

  visitCInjectDirective = (ctx: CInjectDirectiveContext): ASTCInjectDirective => {
    return {
      variant: "CInjectDirective",
      code: JSON.parse(ctx.STRING_LITERAL().getText()),
      sourceloc: this.loc(ctx),
    };
  };

  visitIntegerLiteral = (ctx: IntegerLiteralContext): LiteralValue => {
    return {
      type: EPrimitive.int,
      value: Number(ctx.INTEGER_LITERAL().getText()),
      unit: null,
    };
  };

  visitFloatLiteral = (ctx: FloatLiteralContext): LiteralValue => {
    return {
      type: EPrimitive.float,
      value: Number(ctx.FLOAT_LITERAL().getText()),
      unit: null,
    };
  };

  visitIntegerUnitLiteral = (ctx: IntegerUnitLiteralContext): LiteralValue => {
    return this.makeUnitLiteral(ctx);
  };

  visitFloatUnitLiteral = (ctx: FloatUnitLiteralContext): LiteralValue => {
    return this.makeUnitLiteral(ctx);
  };

  visitStringConstant = (ctx: StringConstantContext): LiteralValue => {
    return {
      type: EPrimitive.str,
      value: JSON.parse(ctx.STRING_LITERAL().getText()),
    };
  };

  visitBooleanConstant = (ctx: BooleanConstantContext): LiteralValue => {
    return {
      type: EPrimitive.boolean,
      value: ctx.getText() === "true" ? true : false,
    };
  };

  makeUnitLiteral(ctx: IntegerUnitLiteralContext | FloatUnitLiteralContext): LiteralValue {
    function parseUnit(input: string): [number, string] {
      const match = input.match(/^(-?\d*\.?\d+)([a-zA-Z%]+)$/);
      if (!match) throw new Error(`Invalid format: "${input}"`);
      return [parseFloat(match[1]), match[2]];
    }
    const [value, unit] =
      ctx instanceof IntegerUnitLiteralContext
        ? parseUnit(ctx.UNIT_INTEGER_LITERAL().getText())
        : parseUnit(ctx.UNIT_FLOAT_LITERAL().getText());

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
      type: ctx instanceof IntegerUnitLiteralContext ? EPrimitive.int : EPrimitive.float,
      unit: literalUnit,
    };
  }

  visitGenericLiteralDatatype = (ctx: GenericLiteralDatatypeContext): ASTDatatype => {
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
      generics: ctx.genericLiteral().map((g) => this.visit(g) as ASTDatatype | ASTLiteralExpr),
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
        nested: datatypes[datatypes.length - 1],
      });
    }
    return datatypes[datatypes.length - 1];
  };

  visitParams = (ctx: ParamsContext): { params: ASTParam[]; ellipsis: boolean } => {
    const params = ctx.param().map(
      (p) =>
        ({
          datatype: this.visit(p.datatype()),
          name: p.ID().getText(),
          sourceloc: this.loc(p),
        } satisfies ASTParam)
    );
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
      static: false,
      methodType: EMethodType.None,
      name: names[0],
      operatorOverloading: undefined,
      ellipsis: params.ellipsis,
      funcbody: (ctx.funcbody() && this.visit(ctx.funcbody()!)) || undefined,
      returnType: (ctx.datatype() && this.visit(ctx.datatype()!)) || undefined,
      sourceloc: this.loc(ctx),
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
      mutability: this.mutability(ctx),
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

  visitStructMethod = (ctx: StructMethodContext): ASTFunctionDefinition => {
    const names = ctx.ID().map((c) => c.getText());
    const params = this.visitParams(ctx.params());
    return {
      variant: "FunctionDefinition",
      params: params.params,
      export: false,
      externLanguage: EExternLanguage.None,
      noemit: false,
      pub: false,
      methodType: EMethodType.Method,
      name: names[0],
      static: Boolean(ctx._static_),
      generics: names.slice(1).map((n) => ({
        name: n,
        sourceloc: this.loc(ctx), // TODO: Find a better sourceloc from the actual token, not the function
      })),
      ellipsis: params.ellipsis,
      operatorOverloading: undefined,
      returnType: (ctx.datatype() && this.visit(ctx.datatype()!)) || undefined,
      funcbody: (ctx.funcbody() && this.visit(ctx.funcbody()!)) || undefined,
      sourceloc: this.loc(ctx),
    };
  };

  visitNestedStructDefinition = (ctx: NestedStructDefinitionContext): ASTStructDefinition => {
    return this.visit(ctx.structDefinition());
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

    for (const c of content) {
      if (c.variant === "StructMember") {
        members.push(c);
      } else if (c.variant === "FunctionDefinition") {
        methods.push(c);
      } else if (c.variant === "StructDefinition") {
        declarations.push(c);
      } else {
        throw new InternalError("Struct content was neither member nor method");
      }
    }

    return {
      variant: "StructDefinition",
      export: Boolean(ctx._export_),
      pub: Boolean(ctx._pub),
      externLanguage: this.exlang(ctx),
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
    };
  };

  visitScope = (ctx: ScopeContext): ASTScope => {
    return {
      variant: "Scope",
      sourceloc: this.loc(ctx),
      statements: ctx.statement().map((s) => this.visit(s)),
    };
  };

  visitScopeStatement = (ctx: ScopeStatementContext): ASTScopeStatement => {
    return {
      variant: "ScopeStatement",
      scope: this.visitScope(ctx.scope()),
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
      name: ctx.ID().getText(),
      sourceloc: this.loc(ctx),
      datatype: (ctx.datatype() && this.visit(ctx.datatype()!)) || undefined,
      expr: (ctx.expr() && this.visit(ctx.expr()!)) || undefined,
      variableContext: EVariableContext.FunctionLocal,
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
      else: elseBlock,
    };
  };

  visitWhileStatement = (ctx: WhileStatementContext): ASTWhileStatement => {
    return {
      variant: "WhileStatement",
      condition: this.visit(ctx.expr()),
      body: this.visit(ctx.scope()),
      sourceloc: this.loc(ctx),
    };
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
    const exprs = ctx.expr().map((e) => this.visit(e));
    return {
      variant: "ExprCallExpr",
      calledExpr: exprs[0],
      arguments: exprs.slice(1),
      sourceloc: this.loc(ctx),
    };
  };

  visitExprMemberAccess = (ctx: ExprMemberAccessContext): ASTExprMemberAccess => {
    const generics: (ASTDatatype | ASTLiteralExpr)[] = [];
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

  visitPointerDereference = (ctx: PointerDereferenceContext): ASTPointerDereferenceExpr => {
    return {
      variant: "PointerDereference",
      expr: this.visit(ctx.expr()),
      sourceloc: this.loc(ctx),
    };
  };

  visitPointerAddressOf = (ctx: PointerAddressOfContext): ASTPointerAddressOfExpr => {
    return {
      variant: "PointerAddressOf",
      expr: this.visit(ctx.expr()),
      sourceloc: this.loc(ctx),
    };
  };

  visitStructInstantiationExpr = (
    ctx: StructInstantiationExprContext
  ): ASTStructInstantiationExpr => {
    if (ctx.ID().length !== ctx.expr().length) {
      throw new InternalError("Inconsistent size");
    }
    const members: { name: string; value: ASTExpr }[] = [];
    for (let i = 0; i < ctx.ID().length; i++) {
      members.push({
        name: ctx.ID()[i].getText(),
        value: this.visit(ctx.expr()[i]),
      });
    }
    return {
      variant: "StructInstantiationExpr",
      datatype: this.visit(ctx.datatype()),
      members: members,
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
    const generics: (ASTDatatype | ASTLiteralExpr)[] = [];
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

  visitReferenceDatatype = (ctx: ReferenceDatatypeContext): ASTReferenceDatatype => {
    return {
      variant: "ReferenceDatatype",
      referee: this.visit(ctx.datatype()),
      sourceloc: this.loc(ctx),
    };
  };

  visitFunctionDatatype = (ctx: FunctionDatatypeContext): ASTFunctionDatatype => {
    const params = this.visitParams(ctx.params());
    return {
      variant: "FunctionDatatype",
      params: params.params,
      ellipsis: params.ellipsis,
      returnType: (ctx.datatype() && this.visit(ctx.datatype()!)) || undefined,
      sourceloc: this.loc(ctx),
    };
  };

  visitPointerDatatype = (ctx: PointerDatatypeContext): ASTPointerDatatype => {
    return {
      variant: "PointerDatatype",
      pointee: this.visit(ctx.datatype()),
      sourceloc: this.loc(ctx),
    };
  };

  visitNamespaceDefinition = (ctx: NamespaceDefinitionContext): ASTNamespaceDefinition => {
    const names = ctx.ID().map((c) => c.getText());
    const namesReversed = names.reverse();

    let currentNamespace: ASTNamespaceDefinition = {
      variant: "NamespaceDefinition",
      declarations: ctx.globalDeclaration().map((g) => this.visit(g)),
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
}
