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
  EOperator,
  EUnaryOperation,
  type ASTBinaryExpr,
  type ASTBooleanConstant,
  type ASTCInjectDirective,
  type ASTConstant,
  type ASTConstantExpr,
  type ASTDatatype,
  type ASTExplicitCastExpr,
  type ASTExpr,
  type ASTExprAsFuncbody,
  type ASTExprAssignmentExpr,
  type ASTExprCallExpr,
  type ASTExprMemberAccess,
  type ASTExprStatement,
  type ASTFunctionDatatype,
  type ASTFunctionDeclaration,
  type ASTFunctionDefinition,
  type ASTGlobalVariableDefinition,
  type ASTIfStatement,
  type ASTInlineCStatement,
  type ASTLambda,
  type ASTLambdaExpr,
  type ASTNamedDatatype,
  type ASTNamespaceDefinition,
  type ASTNumberConstant,
  type ASTParam,
  type ASTParenthesisExpr,
  type ASTPostIncrExpr,
  type ASTPreIncrExpr,
  type ASTRawPointerAddressOfExpr,
  type ASTRawPointerDatatype,
  type ASTRawPointerDereferenceExpr,
  type ASTReferenceDatatype,
  type ASTReturnStatement,
  type ASTRoot,
  type ASTScope,
  type ASTStringConstant,
  type ASTStructDefinition,
  type ASTStructInstantiationExpr,
  type ASTStructMemberDefinition,
  type ASTStructMethodDefinition,
  type ASTSymbolValueExpr,
  type ASTUnaryExpr,
  type ASTVariableDefinitionStatement,
  type ASTWhileStatement,
} from "../shared/AST";
import {
  BinaryExprContext,
  BooleanConstantContext,
  CInjectDirectiveContext,
  CInlineStatementContext,
  ConstantExprContext,
  DatatypeFragmentContext,
  ExplicitCastExprContext,
  ExprAsFuncbodyContext,
  ExprAssignmentExprContext,
  ExprCallExprContext,
  ExprMemberAccessContext,
  ExprStatementContext,
  FunctionDatatypeContext,
  FunctionDeclarationContext,
  FunctionDefinitionContext,
  GenericLiteralConstantContext,
  GenericLiteralDatatypeContext,
  GlobalVariableDefinitionContext,
  HazeParser,
  IfStatementContext,
  LambdaContext,
  LambdaExprContext,
  LiteralConstantContext,
  NamedDatatypeContext,
  NamespaceDefinitionContext,
  NestedStructDefinitionContext,
  NumberConstantContext,
  ParamsContext,
  ParenthesisExprContext,
  PostIncrExprContext,
  PreIncrExprContext,
  ProgContext,
  RawPointerAddressOfContext,
  RawPointerDatatypeContext,
  RawPointerDereferenceContext,
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
} from "./grammar/autogen/HazeParser";
import {
  BaseErrorListener,
  CharStream,
  CommonTokenStream,
  ParserRuleContext,
  TerminalNode,
} from "antlr4ng";
import type { Collect } from "../SymbolCollection/CollectSymbols";
import { HazeLexer } from "./grammar/autogen/HazeLexer";
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

  function transformAST(ctx: ProgContext, filename: string): ASTRoot {
    const transformer = new ASTTransformer(filename);
    return transformer.visit(ctx);
  }

  export function parseTextToAST(text: string, filename: string) {
    const ctx = parse(text, filename);
    if (!ctx) {
      throw new SyntaxError();
    }
    return transformAST(ctx, filename);
  }

  export async function parseFileToAST(filename: string) {
    const ctx = await parseFile(filename);
    if (!ctx) {
      throw new SyntaxError();
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
      | FunctionDefinitionContext
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

  mutability(ctx: GlobalVariableDefinitionContext | VariableCreationStatementContext): boolean {
    if (!ctx._mutability) {
      throw new InternalError("Mutability field of variable is not available");
    }
    if (ctx._mutability.text === "let") {
      return true;
    } else if (ctx._mutability.text === "const") {
      return false;
    } else {
      throw new InternalError("Mutability field of variable is neither let nor const");
    }
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
        "Operator is not known: " + JSON.stringify(ctx._op.map((o) => o.text)),
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
      value: JSON.parse(ctx.STRING_LITERAL().getText()),
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
        throw new CompilerError(`The unit '${unit}' is not known to the compiler`, this.loc(ctx));
    }

    return {
      variant: "NumberConstant",
      sourceloc: this.loc(ctx),
      value: value,
      unit: literalUnit,
    };
  };

  visitGenericLiteralDatatype = (ctx: GenericLiteralDatatypeContext): ASTDatatype => {
    return this.visit(ctx.datatype());
  };

  visitGenericLiteralConstant = (ctx: GenericLiteralConstantContext): ASTConstant => {
    return this.visit(ctx.constant());
  };

  visitDatatypeFragment = (ctx: DatatypeFragmentContext) => {
    return {
      name: ctx.ID().getText(),
      generics: ctx.genericLiteral().map((g) => this.visit(g) as ASTDatatype | ASTConstant),
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
        _collect: {},
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
        }) satisfies ASTParam,
    );
    return {
      params: params,
      ellipsis: Boolean(ctx.ellipsis()),
    };
  };

  visitFunctionDeclaration = (ctx: FunctionDeclarationContext): ASTFunctionDeclaration => {
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
      _collect: {},
      _semantic: {},
    };
  };

  visitExprAsFuncbody = (ctx: ExprAsFuncbodyContext): ASTExprAsFuncbody => {
    return {
      variant: "ExprAsFuncBody",
      expr: this.visit(ctx.expr()),
      _collect: {},
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
      externLanguage: this.exlang(ctx),
      params: params.params,
      generics: generics.map(
        (p) =>
          ({
            variant: "GenericParameter",
            name: p,
          }) satisfies Collect.GenericParameter,
      ),
      name: names[0],
      operatorOverloading: undefined,
      ellipsis: params.ellipsis,
      funcbody: (ctx.funcbody() && this.visit(ctx.funcbody()!)) || undefined,
      returnType: (ctx.datatype() && this.visit(ctx.datatype()!)) || undefined,
      sourceloc: this.loc(ctx),
      _collect: {},
      _semantic: {},
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
      _semantic: {},
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
    const names = ctx.ID().map((c) => c.getText());
    const params = this.visitParams(ctx.params());
    return {
      variant: "StructMethod",
      params: params.params,
      name: names[0],
      generics: names.slice(1).map((n) => ({
        variant: "GenericParameter",
        name: n,
      })),
      ellipsis: params.ellipsis,
      operatorOverloading: undefined,
      returnType: (ctx.datatype() && this.visit(ctx.datatype()!)) || undefined,
      funcbody: (ctx.funcbody() && this.visit(ctx.funcbody()!)) || undefined,
      sourceloc: this.loc(ctx),
      _collect: {},
      _semantic: {},
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
    const methods: ASTStructMethodDefinition[] = [];
    const declarations: ASTStructDefinition[] = [];

    for (const c of content) {
      if (c.variant === "StructMember") {
        members.push(c);
      } else if (c.variant === "StructMethod") {
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
      externLanguage: this.exlang(ctx),
      name: name,
      generics: generics.map(
        (p) =>
          ({
            variant: "GenericParameter",
            name: p,
          }) satisfies Collect.GenericParameter,
      ),
      declarations: declarations,
      members: members,
      methods: methods,
      sourceloc: this.loc(ctx),
      _collect: {},
      _semantic: {},
    };
  };

  visitScope = (ctx: ScopeContext): ASTScope => {
    return {
      variant: "Scope",
      sourceloc: this.loc(ctx),
      statements: ctx.statement().map((s) => this.visit(s)),
      _collect: {},
    };
  };

  visitCInlineStatement = (ctx: CInlineStatementContext): ASTInlineCStatement => {
    return {
      variant: "InlineCStatement",
      code: ctx.STRING_LITERAL().getText(),
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
    ctx: VariableCreationStatementContext,
  ): ASTVariableDefinitionStatement => {
    return {
      variant: "VariableDefinitionStatement",
      mutable: this.mutability(ctx),
      name: ctx.ID().getText(),
      sourceloc: this.loc(ctx),
      datatype: (ctx.datatype() && this.visit(ctx.datatype()!)) || undefined,
      expr: (ctx.expr() && this.visit(ctx.expr()!)) || undefined,
      _semantic: {},
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
      _semantic: {},
    };
  };

  visitLambdaExpr = (ctx: LambdaExprContext): ASTLambdaExpr => {
    return {
      variant: "LambdaExpr",
      lambda: this.visit(ctx.lambda()),
      sourceloc: this.loc(ctx),
      _semantic: {},
    };
  };

  visitConstantExpr = (ctx: ConstantExprContext): ASTConstantExpr => {
    return {
      variant: "ConstantExpr",
      constant: this.visit(ctx.constant()),
      sourceloc: this.loc(ctx),
      _semantic: {},
    };
  };

  visitPostIncrExpr = (ctx: PostIncrExprContext): ASTPostIncrExpr => {
    return {
      variant: "PostIncrExpr",
      expr: this.visit(ctx.expr()),
      operation: this.incrop(ctx),
      sourceloc: this.loc(ctx),
      _semantic: {},
    };
  };

  visitExprCallExpr = (ctx: ExprCallExprContext): ASTExprCallExpr => {
    const exprs = ctx.expr().map((e) => this.visit(e));
    return {
      variant: "ExprCallExpr",
      calledExpr: exprs[0],
      arguments: exprs.slice(1),
      sourceloc: this.loc(ctx),
      _semantic: {},
    };
  };

  visitExprMemberAccess = (ctx: ExprMemberAccessContext): ASTExprMemberAccess => {
    return {
      variant: "ExprMemberAccess",
      expr: this.visit(ctx.expr()),
      member: ctx.ID().getText(),
      sourceloc: this.loc(ctx),
      _semantic: {},
    };
  };

  visitRawPointerDereference = (
    ctx: RawPointerDereferenceContext,
  ): ASTRawPointerDereferenceExpr => {
    return {
      variant: "RawPointerDereference",
      expr: this.visit(ctx.expr()),
      sourceloc: this.loc(ctx),
      _semantic: {},
    };
  };

  visitRawPointerAddressOf = (ctx: RawPointerAddressOfContext): ASTRawPointerAddressOfExpr => {
    return {
      variant: "RawPointerAddressOf",
      expr: this.visit(ctx.expr()),
      sourceloc: this.loc(ctx),
      _semantic: {},
    };
  };

  visitStructInstantiationExpr = (
    ctx: StructInstantiationExprContext,
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
      _semantic: {},
    };
  };

  visitPreIncrExpr = (ctx: PreIncrExprContext): ASTPreIncrExpr => {
    return {
      variant: "PreIncrExpr",
      expr: this.visit(ctx.expr()),
      operation: this.incrop(ctx),
      sourceloc: this.loc(ctx),
      _semantic: {},
    };
  };

  visitUnaryExpr = (ctx: UnaryExprContext): ASTUnaryExpr => {
    return {
      variant: "UnaryExpr",
      expr: this.visit(ctx.expr()),
      operation: this.unaryop(ctx),
      sourceloc: this.loc(ctx),
      _semantic: {},
    };
  };

  visitExplicitCastExpr = (ctx: ExplicitCastExprContext): ASTExplicitCastExpr => {
    return {
      variant: "ExplicitCastExpr",
      castedTo: this.visit(ctx.datatype()),
      expr: this.visit(ctx.expr()),
      sourceloc: this.loc(ctx),
      _semantic: {},
    };
  };

  visitBinaryExpr = (ctx: BinaryExprContext): ASTBinaryExpr => {
    return {
      variant: "BinaryExpr",
      a: this.visit(ctx.expr()[0]),
      b: this.visit(ctx.expr()[1]),
      operation: this.binaryop(ctx),
      sourceloc: this.loc(ctx),
      _semantic: {},
    };
  };

  visitExprAssignmentExpr = (ctx: ExprAssignmentExprContext): ASTExprAssignmentExpr => {
    return {
      variant: "ExprAssignmentExpr",
      target: this.visit(ctx.expr()[0]),
      value: this.visit(ctx.expr()[1]),
      operation: this.assignop(ctx),
      sourceloc: this.loc(ctx),
      _semantic: {},
    };
  };

  visitSymbolValueExpr = (ctx: SymbolValueExprContext): ASTSymbolValueExpr => {
    const generics: (ASTDatatype | ASTConstant)[] = [];
    for (let i = 0; i < ctx.genericLiteral().length; i++) {
      generics.push(this.visit(ctx.genericLiteral()[i]));
    }
    return {
      variant: "SymbolValueExpr",
      generics: generics,
      name: ctx.ID().getText(),
      sourceloc: this.loc(ctx),
      _semantic: {},
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

  visitRawPointerDatatype = (ctx: RawPointerDatatypeContext): ASTRawPointerDatatype => {
    return {
      variant: "RawPointerDatatype",
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
      _collect: {},
    };

    for (const name of namesReversed.slice(1)) {
      currentNamespace = {
        variant: "NamespaceDefinition",
        declarations: [currentNamespace],
        export: Boolean(ctx._export_),
        name: name,
        sourceloc: this.loc(ctx),
        _collect: {},
      };
    }

    return currentNamespace;
  };
}
