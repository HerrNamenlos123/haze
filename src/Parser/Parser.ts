import {
  BaseErrorListener,
  CharStream,
  CommonTokenStream,
  Interval,
  type ParserRuleContext,
  type TerminalNode,
} from "antlr4ng";
import {
  type ASTAggregateLiteralElement,
  type ASTAggregateLiteralExpr,
  type ASTArraySubscriptExpr,
  type ASTAttemptExpr,
  type ASTBinaryExpr,
  type ASTBinaryUnionTypeExpr,
  type ASTBlockScopeExpr,
  type ASTConstTypeExpr,
  type ASTDynamicArrayTypeExpr,
  type ASTEnumDefinition,
  type ASTEnumValueDefinition,
  type ASTErrorPropagationExpr,
  type ASTExplicitCastExpr,
  type ASTExpr,
  type ASTExprAsFuncbody,
  type ASTExprAssignmentExpr,
  type ASTExprCallExpr,
  type ASTExprComptimeMemberAccess,
  type ASTExprIsTypeExpr,
  type ASTExprMemberAccess,
  type ASTExprStatement,
  type ASTForEachStatement,
  type ASTForStatement,
  type ASTFStringExpr,
  type ASTFuncBody,
  type ASTFunctionDefinition,
  type ASTFunctionOverloading,
  type ASTFunctionRequiresBlock,
  type ASTFunctionTypeExpr,
  type ASTGlobalVariableDefinition,
  type ASTIfStatement,
  type ASTInlineCStatement,
  type ASTInlineTypeExpr,
  type ASTLambda,
  type ASTLambdaExpr,
  type ASTLiteralExpr,
  type ASTModuleImport,
  type ASTMutTypeExpr,
  type ASTNamespaceDefinition,
  type ASTNodiscardTypeExpr,
  type ASTParam,
  type ASTParenthesisExpr,
  type ASTPostIncrExpr,
  type ASTPreIncrExpr,
  type ASTRaiseStatement,
  type ASTReturnStatement,
  type ASTScope,
  type ASTStatement,
  type ASTStaticArrayTypeExpr,
  type ASTStructDefinition,
  type ASTStructMemberDefinition,
  type ASTSubscriptIndexExpr,
  type ASTSymbolImport,
  type ASTSymbolValueExpr,
  type ASTTaggedUnionTypeExpr,
  type ASTTernaryExpr,
  type ASTTypeAlias,
  type ASTTypeOfExpr,
  type ASTTypeValueExpr,
  type ASTUnaryExpr,
  type ASTVariableDefinitionStatement,
  type ASTWhileStatement,
  EAssignmentOperation,
  EBinaryOperation,
  EDatatypeMutability,
  EExternLanguage,
  EIncrOperation,
  ELiteralUnit,
  EOverloadedOperator,
  EUnaryOperation,
  EVariableMutability,
} from "../shared/AST";
import type { ModuleConfig } from "../shared/Config";
import {
  EMethodType,
  EPrimitive,
  EVariableContext,
  type LiteralValue,
} from "../shared/common";
import {
  assert,
  CompilerError,
  InternalError,
  printErrorMessage,
  type SourceLoc,
  SyntaxError,
} from "../shared/Errors";
import { HazeLexer } from "./grammar/autogen/HazeLexer";
import {
  type AdditiveContext,
  type AggregateLiteralElementContext,
  type ArrayExprContext,
  type AssignmentContext,
  type BooleanConstantContext,
  type BraceExprContext,
  type CInjectDirectiveContext,
  type CInlineStatementContext,
  type ComparisonContext,
  type ComptimeIfStatementContext,
  type DoScopeContext,
  type EnumContentContext,
  type EnumDefinitionContext,
  type EqualityContext,
  type ExprAsFuncbodyContext,
  type ExprStatementContext,
  type FloatLiteralContext,
  type FloatUnitLiteralContext,
  type ForEachStatementContext,
  type ForStatementContext,
  type FromImportStatementContext,
  type FunctionDefinitionContext,
  type GlobalDeclarationContext,
  type GlobalDeclarationWithSourceContext,
  type GlobalVariableDefinitionContext,
  HazeParser,
  type HexIntegerLiteralContext,
  type IfLetStatementConditionContext,
  type IfStatementConditionContext,
  type IfStatementContext,
  type ImportStatementContext,
  type IntegerLiteralContext,
  type IntegerUnitLiteralContext,
  type LambdaContext,
  type LogicalContext,
  type MultiplicativeContext,
  type NameExprContext,
  type NameSegmentContext,
  type NamespaceDefinitionContext,
  type NestedStructDefinitionContext,
  type ParamContext,
  type ParamsContext,
  type PostfixExprContext,
  type PrefixExprContext,
  type PrimaryExprContext,
  type ProgContext,
  type RaiseStatementContext,
  type RawScopeContext,
  type RegexLiteralContext,
  type RequiresBlockContext,
  type ReturnStatementContext,
  type SingleFStringContext,
  type SourceLocationPrefixRuleContext,
  type StringConstantContext,
  type StructContentWithSourcelocContext,
  type StructDefinitionContext,
  type StructMemberContext,
  type StructMethodContext,
  type SubscriptExprContext,
  type TernaryContext,
  type TopLevelDeclarationsContext,
  type TripleFStringContext,
  type TripleStringConstantContext,
  type TypeAliasDirectiveContext,
  type TypeAliasStatementContext,
  type TypeExprContext,
  type TypeExprModifiedContext,
  type TypeExprPrimaryContext,
  type TypeExprSimpleContext,
  type TypeExprUnionContext,
  VariableConstContext,
  type VariableCreationStatementContext,
  type VariableCreationStatementRuleContext,
  VariableLetContext,
  type WhileLetStatementContext,
  type WhileStatementContext,
} from "./grammar/autogen/HazeParser";
import { HazeParserListener } from "./grammar/autogen/HazeParserListener";

type IfStatementCondition =
  | {
      type: "expr";
      expr: ASTExpr;
    }
  | {
      type: "let";
      name: string;
      datatype: ASTExpr | null;
      letExpr: ASTExpr;
      guardExpr: ASTExpr | null;
    };

export namespace Parser {
  class HazeErrorListener extends BaseErrorListener {
    filename: string;

    constructor(filename: string) {
      super();
      this.filename = filename;
    }

    syntaxError(
      _recognizer: any,
      _offendingSymbol: any,
      line: number,
      column: number,
      msg: string,
      _e: any
    ) {
      printErrorMessage(
        msg,
        { filename: this.filename, start: { line: line, column: column } },
        "SyntaxError"
      );
    }
  }

  function parse(
    text: string,
    listener: ASTBuilder,
    errorListenerFilename: string
  ) {
    const errorListener = new HazeErrorListener(errorListenerFilename);
    const inputStream = CharStream.fromString(text);
    const lexer = new HazeLexer(inputStream);
    lexer.removeErrorListeners();
    lexer.addErrorListener(errorListener);

    const tokenStream = new CommonTokenStream(lexer);
    const parser = new HazeParser(tokenStream);
    parser.removeErrorListeners();
    parser.addErrorListener(errorListener);

    parser.buildParseTrees = true; // Listener mode instead of Visitor mode: TODO: FIX
    parser.setProfile(true);

    parser.addParseListener(listener);

    parser.prog();
    if (parser.numberOfSyntaxErrors !== 0) {
      throw new SyntaxError();
    }
  }

  export function parseTextToAST(
    config: ModuleConfig,
    text: string,
    filename: string
  ) {
    const listener = new ASTBuilder(config, filename);
    parse(text, listener, filename);

    const result = listener.result();
    return result;
  }
}

class ASTBuilder extends HazeParserListener {
  stack: any[] = [];
  private marks: number[] = [];
  sourcelocOverride: SourceLoc[] = [];
  private sourcelocOverridePending: boolean[] = [];

  debug = true;
  ruleTrace: string[] = [];

  constructor(
    public config: ModuleConfig,
    public filename: string
  ) {
    super();
  }

  enterEveryRule = (_ctx: ParserRuleContext) => {
    this.marks.push(this.stack.length);
  };

  exitEveryRule = (_ctx: ParserRuleContext) => {
    this.marks.pop();
  };

  private getMark(ctx: ParserRuleContext): number {
    // const mark = this.marks.pop();
    // console.log("Popping mark", ctx.constructor.name, this.getSource(ctx));
    const mark = this.marks[this.marks.length - 1];

    if (mark === undefined) {
      throw new InternalError(`Missing mark for ${ctx.constructor.name}`);
    }

    if (mark > this.stack.length) {
      throw new InternalError(
        `Invalid mark in ${ctx.constructor.name}: mark=${mark}, stack=${this.stack.length}`
      );
    }

    return mark;
  }

  result() {
    if (this.stack.length !== 1) {
      throw new Error("bad stack");
    }
    return this.stack[0];
  }

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
      | EnumDefinitionContext
  ): EExternLanguage {
    if (!ctx._extern) {
      return EExternLanguage.None;
    }
    if (ctx._externLang?.getText() === "C") {
      return EExternLanguage.Extern_C;
    }
    return EExternLanguage.Extern;
  }

  mutability(
    ctx:
      | GlobalVariableDefinitionContext
      | VariableCreationStatementRuleContext
      | StructMemberContext
  ): EVariableMutability {
    if (!ctx.variableMutabilitySpecifier) {
      return EVariableMutability.Default;
    }
    if (ctx.variableMutabilitySpecifier() instanceof VariableConstContext) {
      return EVariableMutability.Const;
    }
    if (ctx.variableMutabilitySpecifier() instanceof VariableLetContext) {
      return EVariableMutability.Let;
    }
    throw new InternalError(
      "Mutability field of variable is neither let nor const"
    );
  }

  private assignOpFromText(text: string): EAssignmentOperation {
    if (text === "=") {
      return EAssignmentOperation.Rebind;
    }
    if (text === ":=") {
      return EAssignmentOperation.Assign;
    }
    if (text === "+=") {
      return EAssignmentOperation.Add;
    }
    if (text === "-=") {
      return EAssignmentOperation.Subtract;
    }
    if (text === "*=") {
      return EAssignmentOperation.Multiply;
    }
    if (text === "/=") {
      return EAssignmentOperation.Divide;
    }
    if (text === "%=") {
      return EAssignmentOperation.Modulo;
    }

    throw new InternalError("Operator is unknown: " + text);
  }

  private unaryOpFromText(text: string): EUnaryOperation {
    if (text === "-") {
      return EUnaryOperation.Minus;
    }
    if (text === "+") {
      return EUnaryOperation.Plus;
    }
    if (text === "not" || text === "!") {
      return EUnaryOperation.Negate;
    }

    throw new InternalError("Unary operator is unknown: " + text);
  }

  private incrOpFromText(text: string): EIncrOperation {
    if (text === "++") {
      return EIncrOperation.Incr;
    }
    if (text === "--") {
      return EIncrOperation.Decr;
    }

    throw new InternalError("Increment operator is unknown: " + text);
  }

  private binaryOpFromText(text: string): EBinaryOperation {
    if (text === "*") {
      return EBinaryOperation.Multiply;
    }
    if (text === "/") {
      return EBinaryOperation.Divide;
    }
    if (text === "%") {
      return EBinaryOperation.Modulo;
    }
    if (text === "+") {
      return EBinaryOperation.Add;
    }
    if (text === "-") {
      return EBinaryOperation.Subtract;
    }
    if (text === "<") {
      return EBinaryOperation.LessThan;
    }
    if (text === ">") {
      return EBinaryOperation.GreaterThan;
    }
    if (text === "<=") {
      return EBinaryOperation.LessEqual;
    }
    if (text === ">=") {
      return EBinaryOperation.GreaterEqual;
    }
    if (text === "==") {
      return EBinaryOperation.Equal;
    }
    if (text === "!=") {
      return EBinaryOperation.NotEqual;
    }
    if (text === "&&") {
      return EBinaryOperation.BoolAnd;
    }
    if (text === "||") {
      return EBinaryOperation.BoolOr;
    }
    if (text === "|") {
      return EBinaryOperation.BitwiseOr;
    }

    throw new InternalError("Binary operator is not known: " + text);
  }

  private collectOperatorTokens(
    ...tokenLists: (TerminalNode | null)[][]
  ): TerminalNode[] {
    const tokens = tokenLists
      .flat()
      .filter((t): t is TerminalNode => Boolean(t));
    tokens.sort((a, b) => a.symbol.tokenIndex - b.symbol.tokenIndex);
    return tokens;
  }

  getSource(ctx: ParserRuleContext) {
    if (!(ctx.start && ctx.stop)) {
      return "<no-source>";
    }
    const interval = new Interval(ctx.start.start, ctx.stop.stop);
    return ctx.start.inputStream!.getTextFromInterval(interval);
  }

  private emptyRequires(): ASTFunctionRequiresBlock {
    return {
      final: false,
      noreturn: false,
      noreturnIf: null,
      pure: false,
    };
  }

  exitProg = (ctx: ProgContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    if (produced.length !== 1) {
      throw new InternalError(`Prog stack mismatch: got ${produced.length}`);
    }

    this.stack.push(produced[0]);
  };

  exitTopLevelDeclarations = (ctx: TopLevelDeclarationsContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    const out: any[] = [];

    for (const v of produced) {
      if (Array.isArray(v)) {
        out.push(...v);
      } else if (v != null) {
        out.push(v);
      }
    }

    this.stack.push(out);
  };

  exitCInjectDirective = (ctx: CInjectDirectiveContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    if (produced.length !== 1) {
      throw new InternalError(
        `CInjectDirective expected 1 child, got ${produced.length}`
      );
    }

    this.stack.push({
      variant: "CInjectDirective",
      expr: produced[0],
      export: Boolean(ctx._export_),
      sourceloc: this.loc(ctx),
    });
  };

  exitIntegerLiteral = (ctx: IntegerLiteralContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    if (produced.length !== 0) {
      throw new InternalError("IntegerLiteral stack mismatch");
    }

    this.stack.push({
      type: EPrimitive.int,
      value: BigInt(ctx.INTEGER_LITERAL().getText()),
      unit: null,
    } satisfies LiteralValue);
  };

  exitHexIntegerLiteral = (ctx: HexIntegerLiteralContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    if (produced.length !== 0) {
      throw new InternalError("HexIntegerLiteral stack mismatch");
    }

    this.stack.push({
      type: EPrimitive.int,
      value: BigInt(ctx.HEX_INTEGER_LITERAL().getText()),
      unit: null,
    } satisfies LiteralValue);
  };

  exitFloatLiteral = (ctx: FloatLiteralContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    if (produced.length !== 0) {
      throw new InternalError("FloatLiteral stack mismatch");
    }

    this.stack.push({
      type: EPrimitive.real,
      value: Number(ctx.FLOAT_LITERAL().getText()),
      unit: null,
    } satisfies LiteralValue);
  };

  exitIntegerUnitLiteral = (ctx: IntegerUnitLiteralContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    if (produced.length !== 0) {
      throw new InternalError("IntegerUnitLiteral stack mismatch");
    }

    this.stack.push(this.makeIntegerUnitLiteral(ctx));
  };

  exitFloatUnitLiteral = (ctx: FloatUnitLiteralContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    if (produced.length !== 0) {
      throw new InternalError("FloatUnitLiteral stack mismatch");
    }

    this.stack.push(this.makeFloatUnitLiteral(ctx));
  };

  exitStringConstant = (ctx: StringConstantContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    if (produced.length !== 0) {
      throw new InternalError("StringConstant stack mismatch");
    }

    let text = ctx.STRING_LITERAL().getText();

    let prefix: "b" | null = null;
    if (text.startsWith('b"')) {
      text = text.slice(1);
      prefix = "b";
    } else if (!text.startsWith('"')) {
      throw new InternalError("Malformed string literal");
    }

    const value = this.trimAndUnescapeStringLiteral(text, 1, this.loc(ctx));

    this.stack.push({
      type: EPrimitive.str,
      prefix: prefix,
      value: value,
    } satisfies LiteralValue);
  };

  exitTripleStringConstant = (ctx: TripleStringConstantContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    if (produced.length !== 0) {
      throw new InternalError("TripleStringConstant stack mismatch");
    }

    const text = ctx.TRIPLE_STRING_LITERAL().getText();
    const value = this.trimAndUnescapeStringLiteral(text, 3, this.loc(ctx));

    this.stack.push({
      type: EPrimitive.str,
      prefix: null,
      value: value,
    } satisfies LiteralValue);
  };

  exitBooleanConstant = (ctx: BooleanConstantContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    if (produced.length !== 0) {
      throw new InternalError("BooleanConstant stack mismatch");
    }

    this.stack.push({
      type: EPrimitive.bool,
      value: ctx.getText() === "true",
    } satisfies LiteralValue);
  };

  makeIntegerUnitLiteral(ctx: IntegerUnitLiteralContext): LiteralValue {
    function parseUnitBigInt(input: string): [bigint, string] {
      const match = input.match(/^(-?\d+)([a-zA-Z%]+)$/);
      if (!match) {
        throw new Error(`Invalid format: "${input}"`);
      }

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
        throw new CompilerError(
          `The unit '${unit}' is not known to the compiler`,
          this.loc(ctx)
        );
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
      if (!match) {
        throw new Error(`Invalid format: "${input}"`);
      }
      return [Number.parseFloat(match[1]), match[2]];
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
        throw new CompilerError(
          `The unit '${unit}' is not known to the compiler`,
          this.loc(ctx)
        );
    }

    return {
      value: value,
      type: EPrimitive.real,
      unit: literalUnit,
    };
  }

  exitTypeExprPrimary = (ctx: TypeExprPrimaryContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    if (ctx.TYPEOF()) {
      if (produced.length !== 1) {
        throw new InternalError("TypeExprPrimary typeof stack mismatch");
      }

      this.stack.push({
        variant: "TypeOfExpr",
        expr: produced[0] as ASTExpr,
        sourceloc: this.loc(ctx),
      } satisfies ASTTypeOfExpr);
      return;
    }

    if (ctx.nameExpr() || (ctx.LB() && ctx.RB())) {
      if (produced.length !== 1) {
        throw new InternalError("TypeExprPrimary stack mismatch");
      }

      this.stack.push(produced[0]);
      return;
    }

    if (ctx.literal()) {
      if (produced.length !== 1) {
        throw new InternalError("TypeExprPrimary literal stack mismatch");
      }

      this.stack.push({
        variant: "LiteralExpr",
        literal: produced[0] as LiteralValue,
        sourceloc: this.loc(ctx),
      } satisfies ASTLiteralExpr);
      return;
    }

    if (ctx.TYPE()) {
      if (produced.length !== 1) {
        throw new InternalError("TypeExprPrimary type stack mismatch");
      }

      this.stack.push({
        variant: "TypeValueExpr",
        datatype: produced[0] as ASTExpr,
        sourceloc: this.loc(ctx),
      } satisfies ASTTypeValueExpr);
      return;
    }

    throw new InternalError("TypeExprPrimary produced unexpected children");
  };

  exitTypeExprSimple = (ctx: TypeExprSimpleContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    if (produced.length < 1) {
      throw new InternalError("TypeExprSimple stack underflow");
    }

    let i = 0;
    let expr = produced[i++] as ASTExpr;

    for (const postfix of ctx.typeExprPostfix()) {
      if (postfix.DOT() && postfix.LBRACKET() && postfix.RBRACKET()) {
        if (i >= produced.length) {
          throw new InternalError(
            "TypeExprSimple comptime member access missing expression"
          );
        }

        expr = {
          variant: "ExprComptimeMemberAccess",
          expr: expr,
          memberExpr: produced[i++] as ASTExpr,
          sourceloc: this.loc(postfix),
        } satisfies ASTExprComptimeMemberAccess;
        continue;
      }

      if (postfix.DOT() || postfix.QUESTIONDOT()) {
        if (i >= produced.length) {
          throw new InternalError(
            "TypeExprSimple member access missing segment"
          );
        }

        const segment = produced[i++] as {
          name: string;
          generics: ASTExpr[];
          sourceloc: SourceLoc;
        };

        expr = {
          variant: "ExprMemberAccess",
          expr: expr,
          member: segment.name,
          generics: segment.generics,
          sourceloc: this.loc(postfix),
        } satisfies ASTExprMemberAccess;
        continue;
      }

      throw new InternalError("TypeExprSimple encountered unknown postfix");
    }

    if (i !== produced.length) {
      throw new InternalError("TypeExprSimple stack mismatch");
    }

    this.stack.push(expr);
  };

  exitTypeExprModified = (ctx: TypeExprModifiedContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    if (ctx.typeExprSimple()) {
      if (produced.length !== 1) {
        throw new InternalError("TypeExprModified simple stack mismatch");
      }

      this.stack.push(produced[0]);
      return;
    }

    if (ctx.INLINE()) {
      if (produced.length !== 1) {
        throw new InternalError("TypeExprModified inline stack mismatch");
      }

      this.stack.push({
        variant: "InlineTypeExpr",
        type: produced[0] as ASTExpr,
        sourceloc: this.loc(ctx),
      } satisfies ASTInlineTypeExpr);
      return;
    }

    if (ctx.MUT()) {
      if (produced.length !== 1) {
        throw new InternalError("TypeExprModified mut stack mismatch");
      }

      this.stack.push({
        variant: "MutTypeExpr",
        type: produced[0] as ASTExpr,
        sourceloc: this.loc(ctx),
      } satisfies ASTMutTypeExpr);
      return;
    }

    if (ctx.CONST()) {
      if (produced.length !== 1) {
        throw new InternalError("TypeExprModified const stack mismatch");
      }

      this.stack.push({
        variant: "ConstTypeExpr",
        type: produced[0] as ASTExpr,
        sourceloc: this.loc(ctx),
      } satisfies ASTConstTypeExpr);
      return;
    }

    if (
      ctx.LBRACKET() &&
      ctx.RBRACKET() &&
      ctx.typeExprModified() &&
      !ctx.LB()
    ) {
      if (produced.length !== 1) {
        throw new InternalError("TypeExprModified array stack mismatch");
      }

      const inner = produced[0] as ASTExpr;
      if (ctx._n) {
        this.stack.push({
          variant: "StaticArrayTypeExpr",
          type: inner,
          arraySize: this.integerFromDecimalOrHex(ctx),
          sourceloc: this.loc(ctx),
        } satisfies ASTStaticArrayTypeExpr);
      } else {
        this.stack.push({
          variant: "DynamicArrayTypeExpr",
          type: inner,
          sourceloc: this.loc(ctx),
        } satisfies ASTDynamicArrayTypeExpr);
      }

      return;
    }

    if (ctx.params() && (ctx.DOUBLEARROW() || ctx.SINGLEARROW())) {
      let i = 0;

      const params = produced[i++] as {
        params: ASTParam[];
        ellipsis: boolean;
      };

      const returnType = produced[i++] as ASTExpr;
      const requires = ctx.requiresBlock()
        ? (produced[i++] as ASTFunctionRequiresBlock)
        : this.emptyRequires();

      if (i !== produced.length) {
        throw new InternalError("TypeExprModified function stack mismatch");
      }

      this.stack.push({
        variant: "FunctionTypeExpr",
        kind: ctx.DOUBLEARROW() ? "callable" : "function",
        params: params.params,
        ellipsis: params.ellipsis,
        returnType: returnType,
        requires: requires,
        mutability: EDatatypeMutability.Default,
        sourceloc: this.loc(ctx),
      } satisfies ASTFunctionTypeExpr);
      return;
    }

    throw new InternalError("TypeExprModified produced unexpected children");
  };

  exitTypeExprUnion = (ctx: TypeExprUnionContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start) as ASTExpr[];

    if (produced.length === 0) {
      throw new InternalError("TypeExprUnion missing members");
    }

    if (produced.length === 1) {
      this.stack.push(produced[0]);
      return;
    }

    this.stack.push({
      variant: "BinaryUnionTypeExpr",
      types: produced,
      sourceloc: this.loc(ctx),
    } satisfies ASTBinaryUnionTypeExpr);
  };

  exitTypeExpr = (ctx: TypeExprContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    if (!ctx.UNION()) {
      if (produced.length !== 1) {
        throw new InternalError("TypeExpr stack mismatch");
      }

      this.stack.push(produced[0]);
      return;
    }

    const members = produced as ASTExpr[];
    const tags = ctx.id();

    if (members.length !== tags.length) {
      throw new InternalError("TypeExpr tagged union stack mismatch");
    }

    let unionExpr: ASTExpr = {
      variant: "TaggedUnionTypeExpr",
      members: members.map((m, i) => ({
        tag: tags[i].getText(),
        type: m,
      })),
      sourceloc: this.loc(ctx),
    } satisfies ASTTaggedUnionTypeExpr;

    if (ctx.NODISCARD()) {
      unionExpr = {
        variant: "NodiscardTypeExpr",
        type: unionExpr,
        sourceloc: this.loc(ctx),
      } satisfies ASTNodiscardTypeExpr;
    }

    this.stack.push(unionExpr);
  };

  exitParam = (p: ParamContext) => {
    const start = this.getMark(p);
    const produced = this.stack.splice(start);

    let i = 0;

    assert((p.typeExpr() || p.ellipsis()) && !(p.typeExpr() && p.ellipsis()));

    // datatype is required unless it's a parameter pack (ellipsis)
    const datatype = p.typeExpr() ? produced[i++] : "param-pack";

    let defaultValue: ASTExpr | null = null;
    if (p.expr()) {
      defaultValue = produced[i++] as ASTExpr;
    }

    if (i !== produced.length) {
      throw new InternalError("param stack mismatch");
    }

    if (datatype === "param-pack") {
      this.stack.push({
        kind: "param-pack",
        name: p.id().getText(),
        sourceloc: this.loc(p),
      } satisfies ASTParam);
    } else {
      this.stack.push({
        kind: "normal",
        datatype: datatype,
        name: p.id().getText(),
        optional: Boolean(p.QUESTIONMARK()),
        defaultValue: defaultValue,
        sourceloc: this.loc(p),
      } satisfies ASTParam);
    }
  };

  exitParams = (ctx: ParamsContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    // produced = array of ASTParam (one per param child)

    this.stack.push({
      params: produced as ASTParam[],
      ellipsis: Boolean(ctx.ellipsis()),
    });
  };

  exitExprAsFuncbody = (ctx: ExprAsFuncbodyContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    if (produced.length !== 1) {
      throw new InternalError("ExprAsFuncbody stack mismatch");
    }

    const expr = produced[0] as ASTExpr;

    this.stack.push({
      variant: "ExprAsFuncBody",
      expr: expr,
    } satisfies ASTExprAsFuncbody);
  };

  exitRequiresBlock = (ctx: RequiresBlockContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    let i = 0;

    const block: ASTFunctionRequiresBlock = {
      final: false,
      pure: false,
      noreturn: false,
      noreturnIf: null,
    };

    for (const part of ctx.requiresPart()) {
      if (part.FINAL()) {
        block.final = true;
      } else if (part.PURE()) {
        block.pure = true;
      } else if (part.NORETURN()) {
        block.noreturn = true;
      } else if (part.NORETURNIF()) {
        if (i >= produced.length) {
          throw new InternalError("RequiresBlock stack underflow");
        }

        block.noreturnIf = {
          expr: produced[i++] as ASTExpr,
        };
      }
    }

    if (i !== produced.length) {
      throw new InternalError("RequiresBlock stack mismatch");
    }

    this.stack.push(block);
  };

  exitFunctionDefinition = (ctx: FunctionDefinitionContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    let i = 0;

    // params (required)
    const params = produced[i++] as {
      params: ASTParam[];
      ellipsis: boolean;
    };

    // return type (optional)
    const returnType = ctx.typeExpr() ? (produced[i++] as ASTExpr) : undefined;

    // requires block (optional)
    const requires = ctx.requiresBlock()
      ? (produced[i++] as ASTFunctionRequiresBlock)
      : this.emptyRequires();

    // funcbody (optional)
    const funcbody = ctx.funcbody()
      ? (produced[i++] as ASTFuncBody)
      : undefined;

    if (i !== produced.length) {
      throw new InternalError(
        `FunctionDefinition stack mismatch: expected ${i}, got ${produced.length}`
      );
    }

    const names = ctx.id().map((c) => c.getText());
    const generics = ctx
      .id()
      .slice(1)
      .map((g) => g.getText());

    this.stack.push({
      variant: "FunctionDefinition",
      export: Boolean(ctx._export_),
      comptime: Boolean(ctx._comptime),
      noemit: Boolean(ctx._noemit),
      pub: Boolean(ctx._pub),
      externLanguage: this.exlang(ctx),
      params: params.params,
      generics: generics.map((p) => ({
        name: p,
        sourceloc: this.loc(ctx),
      })),
      requires: requires,
      static: false,
      methodType: EMethodType.None,
      name: names[0],
      methodRequiredMutability: null,
      operatorOverloading: undefined,
      ellipsis: params.ellipsis,
      funcbody: funcbody,
      returnType: returnType,
      sourceloc: this.loc(ctx),
      originalSourcecode: this.getSource(ctx),
    } satisfies ASTFunctionDefinition);
  };

  exitLambda = (ctx: LambdaContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    let i = 0;

    const params = produced[i++] as {
      params: ASTParam[];
      ellipsis: boolean;
    };

    if (!ctx.funcbody()) {
      throw new InternalError("Lambda missing funcbody");
    }

    let returnType: ASTExpr | undefined;
    if (ctx.typeExpr()) {
      returnType = produced[i++] as ASTExpr;
    }

    // requires block (optional)
    const requires = ctx.requiresBlock()
      ? (produced[i++] as ASTFunctionRequiresBlock)
      : this.emptyRequires();

    const funcbody = produced[i++] as ASTFuncBody;

    if (i !== produced.length) {
      throw new InternalError("Lambda stack mismatch");
    }

    this.stack.push({
      variant: "Lambda",
      params: params.params,
      ellipsis: params.ellipsis,
      scope: funcbody,
      returnType: returnType,
      requires: requires,
      sourceloc: this.loc(ctx),
    } satisfies ASTLambda);
  };

  exitGlobalVariableDefinition = (ctx: GlobalVariableDefinitionContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    let i = 0;

    let datatype: ASTExpr | undefined;
    if (ctx.typeExpr()) {
      datatype = produced[i++] as ASTExpr;
    }

    let expr: ASTExpr | undefined;
    if (ctx.expr()) {
      expr = produced[i++] as ASTExpr;
    }

    if (i !== produced.length) {
      throw new InternalError("GlobalVariableDefinition stack mismatch");
    }

    this.stack.push({
      variant: "GlobalVariableDefinition",
      pub: Boolean(ctx._pub),
      export: Boolean(ctx._export_),
      extern: this.exlang(ctx),
      comptime: Boolean(ctx._comptime),
      mutability: this.mutability(ctx),
      name: ctx.id().getText(),
      sourceloc: this.loc(ctx),
      datatype: datatype,
      expr: expr,
    } satisfies ASTGlobalVariableDefinition);
  };

  exitStructMember = (ctx: StructMemberContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    let i = 0;

    const type = produced[i++] as ASTExpr;

    let defaultValue: ASTExpr | null = null;
    if (ctx.expr()) {
      defaultValue = produced[i++] as ASTExpr;
    }

    if (i !== produced.length) {
      throw new InternalError("StructMember stack mismatch");
    }

    this.stack.push([
      {
        variant: "StructMember",
        name: ctx.id().getText(),
        type: type,
        mutability: ctx.variableMutabilitySpecifier()
          ? this.mutability(ctx)
          : EVariableMutability.Default,
        optional: Boolean(ctx.QUESTIONMARK()),
        defaultValue: defaultValue,
        sourceloc: this.loc(ctx),
      } satisfies ASTStructMemberDefinition,
    ]);
  };

  exitStructMethod = (ctx: StructMethodContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    let i = 0;

    // params (required)
    const params = produced[i++] as {
      params: ASTParam[];
      ellipsis: boolean;
    };

    // return type (optional)
    const returnType = ctx.typeExpr() ? (produced[i++] as ASTExpr) : undefined;

    // requires block (optional)
    const requires = ctx.requiresBlock()
      ? (produced[i++] as ASTFunctionRequiresBlock)
      : this.emptyRequires();

    // funcbody (optional)
    const funcbody = ctx.funcbody()
      ? (produced[i++] as ASTFuncBody)
      : undefined;

    if (i !== produced.length) {
      throw new InternalError("StructMethod stack mismatch");
    }

    const genericNames = ctx._generic.map((c) => {
      const t = c.getText();
      if (!t) {
        throw new InternalError("missing generic name");
      }
      return t;
    });

    if (!ctx._name?.text) {
      throw new InternalError("missing method name");
    }

    let name = ctx._name.text;
    let methodType = EMethodType.Method;
    let operatorOverloading: ASTFunctionOverloading | undefined;

    if (name === "constructor") {
      methodType = EMethodType.Constructor;
    } else if (name === "operator+") {
      operatorOverloading = { operator: EOverloadedOperator.Add };
      name = "__operator_add";
    } else if (name === "operator-") {
      operatorOverloading = { operator: EOverloadedOperator.Sub };
      name = "__operator_sub";
    } else if (name === "operator*") {
      operatorOverloading = { operator: EOverloadedOperator.Mul };
      name = "__operator_mul";
    } else if (name === "operator/") {
      operatorOverloading = { operator: EOverloadedOperator.Div };
      name = "__operator_div";
    } else if (name === "operator%") {
      operatorOverloading = { operator: EOverloadedOperator.Mod };
      name = "__operator_mod";
    } else if (name === "operator=") {
      operatorOverloading = { operator: EOverloadedOperator.Rebind };
      name = "__operator_assign";
    } else if (name === "operator:=") {
      operatorOverloading = { operator: EOverloadedOperator.Assign };
      name = "__operator_assign";
    } else if (name === "operator as") {
      operatorOverloading = { operator: EOverloadedOperator.Cast };
      name = "__operator_cast";
    } else if (name === "operator[]") {
      operatorOverloading = { operator: EOverloadedOperator.Subscript };
      name = "__operator_subscript";
    } else if (name === "operator==") {
      operatorOverloading = { operator: EOverloadedOperator.Equal };
      name = "__operator_eq";
    } else if (name === "operator!=") {
      operatorOverloading = { operator: EOverloadedOperator.NotEqual };
      name = "__operator_neq";
    } else if (name === "operator<") {
      operatorOverloading = { operator: EOverloadedOperator.LessThan };
      name = "__operator_lt";
    } else if (name === "operator>") {
      operatorOverloading = { operator: EOverloadedOperator.GreaterThan };
      name = "__operator_gt";
    } else if (name === "operator<=") {
      operatorOverloading = { operator: EOverloadedOperator.LessThanOrEqual };
      name = "__operator_lte";
    } else if (name === "operator>=") {
      operatorOverloading = {
        operator: EOverloadedOperator.GreaterThanOrEqual,
      };
      name = "__operator_gte";
    }

    let methodRequiredMutability:
      | EDatatypeMutability.Mut
      | EDatatypeMutability.Const
      | null = null;

    if (ctx.MUT()) {
      methodRequiredMutability = EDatatypeMutability.Mut;
    } else if (ctx.CONST()) {
      methodRequiredMutability = EDatatypeMutability.Const;
    }

    const fn: ASTFunctionDefinition = {
      variant: "FunctionDefinition",
      comptime: Boolean(ctx._comptime),
      params: params.params,
      export: false,
      externLanguage: EExternLanguage.None,
      noemit: false,
      pub: false,
      methodType: methodType,
      methodRequiredMutability: methodRequiredMutability,
      name: name,
      static: Boolean(ctx._static_),
      generics: genericNames.map((n) => ({
        name: n,
        sourceloc: this.loc(ctx),
      })),
      requires: requires,
      ellipsis: params.ellipsis,
      operatorOverloading: operatorOverloading,
      returnType: returnType,
      funcbody: funcbody,
      sourceloc: this.loc(ctx),
      originalSourcecode: this.getSource(ctx),
    };

    this.stack.push([fn]);
  };

  exitEnumContent = (ctx: EnumContentContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    let value: ASTExpr | null = null;

    if (ctx.expr()) {
      if (produced.length !== 1) {
        throw new InternalError("EnumContent stack mismatch");
      }
      value = produced[0] as ASTExpr;
    } else if (produced.length !== 0) {
      throw new InternalError("EnumContent stack mismatch");
    }

    this.stack.push({
      variant: "EnumValue",
      name: ctx.id().getText(),
      value: value,
      sourceloc: this.loc(ctx),
    } satisfies ASTEnumValueDefinition);
  };

  exitEnumDefinition = (ctx: EnumDefinitionContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    // Every produced child must be an enum value
    for (const v of produced) {
      if (!v || v.variant !== "EnumValue") {
        throw new InternalError("EnumDefinition stack mismatch");
      }
    }

    const values = produced as ASTEnumValueDefinition[];

    this.stack.push({
      variant: "EnumDefinition",
      export: Boolean(ctx._export_),
      pub: Boolean(ctx._pub),
      bitflag: Boolean(ctx.BITFLAG()),
      unscoped: Boolean(ctx.UNSCOPED()),
      extern: this.exlang(ctx),
      name: ctx.id().getText(),
      noemit: Boolean(ctx._noemit),
      values: values,
      sourceloc: this.loc(ctx),
      originalSourcecode: this.getSource(ctx),
    } satisfies ASTEnumDefinition);
  };

  exitNestedStructDefinition = (ctx: NestedStructDefinitionContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    if (produced.length !== 1) {
      throw new InternalError("NestedStructDefinition stack mismatch");
    }

    const def = produced[0] as ASTStructDefinition;

    this.stack.push([def]);
  };

  exitStructDefinition = (ctx: StructDefinitionContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    const members: ASTStructMemberDefinition[] = [];
    const methods: ASTFunctionDefinition[] = [];
    const declarations: ASTStructDefinition[] = [];

    const processContent = (c: any) => {
      if (Array.isArray(c)) {
        for (const cc of c) {
          processContent(cc);
        }
        return;
      }

      switch (c.variant) {
        case "StructMember":
          members.push(c);
          break;

        case "FunctionDefinition":
          methods.push(c);
          break;

        case "StructDefinition":
          declarations.push(c);
          break;

        default:
          throw new InternalError(
            "StructDefinition produced unexpected child: " + String(c?.variant)
          );
      }
    };

    for (const c of produced) {
      processContent(c);
    }

    const name = ctx.id()[0].getText();
    const generics = ctx
      .id()
      .slice(1)
      .map((g) => g.getText());

    this.stack.push({
      variant: "StructDefinition",
      export: Boolean(ctx._export_),
      pub: Boolean(ctx._pub),
      extern: this.exlang(ctx),
      opaque: Boolean(ctx.OPAQUE()),
      plain: Boolean(ctx.PLAIN()),
      inlineByDefault: Boolean(ctx.INLINE()),
      name: name,
      noemit: Boolean(ctx._noemit),
      generics: generics.map((p) => ({
        name: p,
        sourceloc: this.loc(ctx),
      })),
      nestedStructs: declarations,
      members: members,
      methods: methods,
      sourceloc: this.loc(ctx),
      originalSourcecode: this.getSource(ctx),
    } satisfies ASTStructDefinition);
  };

  exitRawScope = (ctx: RawScopeContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    // produced = results of ctx.statement()

    this.stack.push({
      variant: "Scope",
      sourceloc: this.loc(ctx),
      unsafe: false,
      statements: produced as ASTStatement[],
    } satisfies ASTScope);
  };

  exitDoScope = (ctx: DoScopeContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    const scope: ASTScope = {
      variant: "Scope",
      unsafe: Boolean(ctx.UNSAFE()),
      statements: produced,
      sourceloc: this.loc(ctx),
    };

    this.stack.push({
      variant: "BlockScopeExpr",
      scope: scope,
      sourceloc: this.loc(ctx),
    } satisfies ASTBlockScopeExpr);
  };

  exitSubscriptExpr = (ctx: SubscriptExprContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    if (!ctx.COLON()) {
      if (produced.length !== 1) {
        throw new InternalError("SubscriptExpr index stack mismatch");
      }

      this.stack.push({
        type: "index",
        value: produced[0] as ASTExpr,
      } satisfies ASTSubscriptIndexExpr);
      return;
    }

    const hasStart = Boolean(ctx._start);
    const hasEnd = Boolean(ctx._end);

    const expected = (hasStart ? 1 : 0) + (hasEnd ? 1 : 0);
    if (produced.length !== expected) {
      throw new InternalError("SubscriptExpr slice stack mismatch");
    }

    let i = 0;
    const startExpr = hasStart ? (produced[i++] as ASTExpr) : null;
    const endExpr = hasEnd ? (produced[i++] as ASTExpr) : null;

    this.stack.push({
      type: "slice",
      start: startExpr,
      end: endExpr,
    } satisfies ASTSubscriptIndexExpr);
  };

  exitBraceExpr = (ctx: BraceExprContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    let i = 0;
    const datatype = ctx.nameExpr() ? (produced[i++] as ASTExpr) : null;

    const elementCount = ctx.aggregateBody().aggregateLiteralElement().length;
    const elements = produced.slice(
      i,
      i + elementCount
    ) as ASTAggregateLiteralElement[];
    i += elementCount;

    const allocator = ctx.withAllocator() ? (produced[i++] as ASTExpr) : null;

    if (i !== produced.length) {
      throw new InternalError("BraceExpr stack mismatch");
    }

    this.stack.push({
      variant: "AggregateLiteralExpr",
      datatype: datatype,
      elements: elements,
      allocator: allocator,
      sourceloc: this.loc(ctx),
    } satisfies ASTAggregateLiteralExpr);
  };

  exitArrayExpr = (ctx: ArrayExprContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    let i = 0;
    const elementCount = ctx.aggregateBody().aggregateLiteralElement().length;
    const elements = produced.slice(
      i,
      i + elementCount
    ) as ASTAggregateLiteralElement[];
    i += elementCount;

    const allocator = ctx.withAllocator() ? (produced[i++] as ASTExpr) : null;

    if (i !== produced.length) {
      throw new InternalError("ArrayExpr stack mismatch");
    }

    this.stack.push({
      variant: "AggregateLiteralExpr",
      datatype: null,
      elements: elements,
      allocator: allocator,
      sourceloc: this.loc(ctx),
    } satisfies ASTAggregateLiteralExpr);
  };

  exitNameSegment = (ctx: NameSegmentContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    const genericCount = ctx.genericArgs()?.genericLiteral().length ?? 0;
    if (produced.length !== genericCount) {
      throw new InternalError("NameSegment generic count mismatch");
    }

    this.stack.push({
      name: ctx.id().getText(),
      generics: produced as ASTExpr[],
      sourceloc: this.loc(ctx),
    });
  };

  exitNameExpr = (ctx: NameExprContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    if (produced.length !== ctx.nameSegment().length) {
      throw new InternalError("NameExpr segment count mismatch");
    }

    const segments = produced as {
      name: string;
      generics: ASTExpr[];
      sourceloc: SourceLoc;
    }[];

    if (segments.length === 0) {
      throw new InternalError("NameExpr missing segments");
    }

    let expr: ASTExpr = {
      variant: "SymbolValueExpr",
      name: segments[0].name,
      generics: segments[0].generics,
      sourceloc: segments[0].sourceloc,
    } satisfies ASTSymbolValueExpr;

    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i];
      expr = {
        variant: "ExprMemberAccess",
        expr: expr,
        member: seg.name,
        generics: seg.generics,
        sourceloc: seg.sourceloc,
      } satisfies ASTExprMemberAccess;
    }

    this.stack.push(expr);
  };

  exitPrimaryExpr = (ctx: PrimaryExprContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    if (ctx.LB() && ctx.RB() && ctx.expr()) {
      if (produced.length !== 1) {
        throw new InternalError("PrimaryExpr parenthesis stack mismatch");
      }

      this.stack.push({
        variant: "ParenthesisExpr",
        expr: produced[0] as ASTExpr,
        sourceloc: this.loc(ctx),
      } satisfies ASTParenthesisExpr);
      return;
    }

    if (ctx.doScope()) {
      if (produced.length !== 1) {
        throw new InternalError("PrimaryExpr doScope stack mismatch");
      }

      this.stack.push(produced[0]);
      return;
    }

    if (ctx.TYPE() && ctx.typeExpr()) {
      if (produced.length !== 1) {
        throw new InternalError("PrimaryExpr type literal stack mismatch");
      }

      this.stack.push({
        variant: "TypeValueExpr",
        datatype: produced[0] as ASTExpr,
        sourceloc: this.loc(ctx),
      } satisfies ASTTypeValueExpr);
      return;
    }

    if (ctx.TYPEOF()) {
      if (produced.length !== 1) {
        throw new InternalError("PrimaryExpr typeof stack mismatch");
      }

      this.stack.push({
        variant: "TypeOfExpr",
        expr: produced[0] as ASTExpr,
        sourceloc: this.loc(ctx),
      } satisfies ASTTypeOfExpr);
      return;
    }

    if (ctx.lambda()) {
      if (produced.length !== 1) {
        throw new InternalError("PrimaryExpr lambda stack mismatch");
      }

      this.stack.push({
        variant: "LambdaExpr",
        lambda: produced[0] as ASTLambda,
        sourceloc: this.loc(ctx),
      } satisfies ASTLambdaExpr);
      return;
    }

    if (ctx.literal()) {
      if (produced.length !== 1) {
        throw new InternalError("PrimaryExpr literal stack mismatch");
      }

      this.stack.push({
        variant: "LiteralExpr",
        literal: produced[0] as LiteralValue,
        sourceloc: this.loc(ctx),
      } satisfies ASTLiteralExpr);
      return;
    }

    if (ctx.interpolatedString()) {
      if (produced.length !== 1) {
        throw new InternalError("PrimaryExpr fstring stack mismatch");
      }

      this.stack.push(produced[0]);
      return;
    }

    if (ctx.braceExpr()) {
      if (produced.length !== 1) {
        throw new InternalError("PrimaryExpr brace stack mismatch");
      }

      this.stack.push(produced[0]);
      return;
    }

    if (ctx.arrayExpr()) {
      if (produced.length !== 1) {
        throw new InternalError("PrimaryExpr arrayExpr stack mismatch");
      }

      this.stack.push(produced[0]);
      return;
    }

    if (ctx.nameExpr()) {
      if (produced.length !== 1) {
        throw new InternalError("PrimaryExpr nameExpr stack mismatch");
      }

      this.stack.push(produced[0]);
      return;
    }

    throw new InternalError("PrimaryExpr produced unexpected children");
  };

  exitPrefixExpr = (ctx: PrefixExprContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    if (ctx.preUnaryOp()) {
      if (produced.length !== 1) {
        throw new InternalError("PrefixExpr unary stack mismatch");
      }

      const expr = produced[0] as ASTExpr;
      const opText = ctx.preUnaryOp()!.getText();

      if (opText === "++" || opText === "--") {
        this.stack.push({
          variant: "PreIncrExpr",
          expr: expr,
          operation: this.incrOpFromText(opText),
          sourceloc: this.loc(ctx),
        } satisfies ASTPreIncrExpr);
      } else {
        this.stack.push({
          variant: "UnaryExpr",
          expr: expr,
          operation: this.unaryOpFromText(opText),
          sourceloc: this.loc(ctx),
        } satisfies ASTUnaryExpr);
      }

      return;
    }

    if (produced.length !== 1) {
      throw new InternalError("PrefixExpr stack mismatch");
    }

    this.stack.push(produced[0]);
  };

  exitPostfixExpr = (ctx: PostfixExprContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    if (produced.length < 1) {
      throw new InternalError("PostfixExpr stack underflow");
    }

    let i = 0;
    let expr = produced[i++] as ASTExpr;

    for (const postfix of ctx.postfix()) {
      if (postfix.PLUSPLUS() || postfix.MINUSMINUS()) {
        const opText = postfix.getText();
        expr = {
          variant: "PostIncrExpr",
          expr: expr,
          operation: this.incrOpFromText(opText),
          sourceloc: this.loc(postfix),
        } satisfies ASTPostIncrExpr;
        continue;
      }

      if (postfix.LB() && postfix.RB()) {
        const argCount = postfix.argList()?.expr().length ?? 0;
        const args = produced.slice(i, i + argCount) as ASTExpr[];
        i += argCount;

        const allocator = postfix.withAllocator()
          ? (produced[i++] as ASTExpr)
          : null;

        expr = {
          variant: "ExprCallExpr",
          calledExpr: expr,
          arguments: args,
          allocator: allocator,
          sourceloc: this.loc(postfix),
        } satisfies ASTExprCallExpr;
        continue;
      }

      if (postfix.DOT() && postfix.LBRACKET() && postfix.RBRACKET()) {
        if (i >= produced.length) {
          throw new InternalError(
            "PostfixExpr comptime member access missing expression"
          );
        }

        const memberExpr = produced[i++] as ASTExpr;

        expr = {
          variant: "ExprComptimeMemberAccess",
          expr: expr,
          memberExpr: memberExpr,
          sourceloc: this.loc(postfix),
        } satisfies ASTExprComptimeMemberAccess;
        continue;
      }

      if (postfix.LBRACKET() && postfix.RBRACKET()) {
        const indexCount = postfix.indexList()?.subscriptExpr().length ?? 0;
        const indices = produced.slice(
          i,
          i + indexCount
        ) as ASTSubscriptIndexExpr[];
        i += indexCount;

        expr = {
          variant: "ArraySubscriptExpr",
          expr: expr,
          indices: indices,
          sourceloc: this.loc(postfix),
        } satisfies ASTArraySubscriptExpr;
        continue;
      }

      if (postfix.DOT() || postfix.QUESTIONDOT()) {
        if (i >= produced.length) {
          throw new InternalError("PostfixExpr member access missing segment");
        }

        const segment = produced[i++] as {
          name: string;
          generics: ASTExpr[];
          sourceloc: SourceLoc;
        };

        expr = {
          variant: "ExprMemberAccess",
          expr: expr,
          member: segment.name,
          generics: segment.generics,
          sourceloc: this.loc(postfix),
        } satisfies ASTExprMemberAccess;
        continue;
      }

      if (postfix.AS() || postfix.IS()) {
        if (i >= produced.length) {
          throw new InternalError("PostfixExpr AS/IS missing datatype");
        }

        const datatype = produced[i++] as ASTExpr;

        if (postfix.AS()) {
          expr = {
            variant: "ExplicitCastExpr",
            expr: expr,
            castedTo: datatype,
            sourceloc: this.loc(postfix),
          } satisfies ASTExplicitCastExpr;
        } else {
          expr = {
            variant: "ExprIsTypeExpr",
            expr: expr,
            comparisonType: datatype,
            sourceloc: this.loc(postfix),
          } satisfies ASTExprIsTypeExpr;
        }

        continue;
      }

      if (postfix.QUESTIONEXCL()) {
        expr = {
          variant: "ErrorPropagationExpr",
          expr: expr,
          sourceloc: this.loc(postfix),
        } satisfies ASTErrorPropagationExpr;
        continue;
      }

      throw new InternalError("PostfixExpr encountered unknown postfix");
    }

    if (i !== produced.length) {
      throw new InternalError("PostfixExpr stack mismatch");
    }

    this.stack.push(expr);
  };

  exitMultiplicative = (ctx: MultiplicativeContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start) as ASTExpr[];

    const operators = this.collectOperatorTokens(
      ctx.MUL(),
      ctx.DIV(),
      ctx.MOD()
    ).map((t) => t.getText());

    if (produced.length !== operators.length + 1) {
      throw new InternalError("Multiplicative stack mismatch");
    }

    let expr = produced[0];
    for (let idx = 0; idx < operators.length; idx++) {
      expr = {
        variant: "BinaryExpr",
        a: expr,
        b: produced[idx + 1],
        operation: this.binaryOpFromText(operators[idx]),
        sourceloc: this.loc(ctx),
      } satisfies ASTBinaryExpr;
    }

    this.stack.push(expr);
  };

  exitAdditive = (ctx: AdditiveContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start) as ASTExpr[];

    const operators = this.collectOperatorTokens(ctx.PLUS(), ctx.MINUS()).map(
      (t) => t.getText()
    );

    if (produced.length !== operators.length + 1) {
      throw new InternalError("Additive stack mismatch");
    }

    let expr = produced[0];
    for (let idx = 0; idx < operators.length; idx++) {
      expr = {
        variant: "BinaryExpr",
        a: expr,
        b: produced[idx + 1],
        operation: this.binaryOpFromText(operators[idx]),
        sourceloc: this.loc(ctx),
      } satisfies ASTBinaryExpr;
    }

    this.stack.push(expr);
  };

  exitComparison = (ctx: ComparisonContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start) as ASTExpr[];

    const operators = this.collectOperatorTokens(
      ctx.LANGLE(),
      ctx.RANGLE(),
      ctx.LEQ(),
      ctx.GEQ()
    ).map((t) => t.getText());

    if (produced.length !== operators.length + 1) {
      throw new InternalError("Comparison stack mismatch");
    }

    let expr = produced[0];
    for (let idx = 0; idx < operators.length; idx++) {
      expr = {
        variant: "BinaryExpr",
        a: expr,
        b: produced[idx + 1],
        operation: this.binaryOpFromText(operators[idx]),
        sourceloc: this.loc(ctx),
      } satisfies ASTBinaryExpr;
    }

    this.stack.push(expr);
  };

  exitEquality = (ctx: EqualityContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start) as ASTExpr[];

    const operators = this.collectOperatorTokens(
      ctx.DOUBLEEQUALS(),
      ctx.NOTEQUALS()
    ).map((t) => t.getText());

    if (produced.length !== operators.length + 1) {
      throw new InternalError("Equality stack mismatch");
    }

    let expr = produced[0];
    for (let idx = 0; idx < operators.length; idx++) {
      expr = {
        variant: "BinaryExpr",
        a: expr,
        b: produced[idx + 1],
        operation: this.binaryOpFromText(operators[idx]),
        sourceloc: this.loc(ctx),
      } satisfies ASTBinaryExpr;
    }

    this.stack.push(expr);
  };

  exitLogical = (ctx: LogicalContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start) as ASTExpr[];

    const operators = this.collectOperatorTokens(
      ctx.DOUBLEAND(),
      ctx.DOUBLEOR(),
      ctx.SINGLEOR()
    ).map((t) => t.getText());

    if (produced.length !== operators.length + 1) {
      throw new InternalError("Logical stack mismatch");
    }

    let expr = produced[0];
    for (let idx = 0; idx < operators.length; idx++) {
      expr = {
        variant: "BinaryExpr",
        a: expr,
        b: produced[idx + 1],
        operation: this.binaryOpFromText(operators[idx]),
        sourceloc: this.loc(ctx),
      } satisfies ASTBinaryExpr;
    }

    this.stack.push(expr);
  };

  exitTernary = (ctx: TernaryContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    if (ctx.ATTEMPT()) {
      if (produced.length !== 2) {
        throw new InternalError("Ternary attempt stack mismatch");
      }

      this.stack.push({
        variant: "AttemptExpr",
        attemptScope: produced[0] as ASTScope,
        elseScope: produced[1] as ASTScope,
        elseVar: ctx.id() ? ctx.id()!.getText() : null,
        sourceloc: this.loc(ctx),
      } satisfies ASTAttemptExpr);
      return;
    }

    if (!ctx.QUESTIONMARK()) {
      if (produced.length !== 1) {
        throw new InternalError("Ternary stack mismatch");
      }

      this.stack.push(produced[0]);
      return;
    }

    if (produced.length !== 3) {
      throw new InternalError("Ternary stack mismatch");
    }

    this.stack.push({
      variant: "TernaryExpr",
      condition: produced[0] as ASTExpr,
      thenExpr: produced[1] as ASTExpr,
      else: produced[2] as ASTExpr,
      sourceloc: this.loc(ctx),
    } satisfies ASTTernaryExpr);
  };

  exitAssignment = (ctx: AssignmentContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    if (!ctx.assignOp()) {
      if (produced.length !== 1) {
        throw new InternalError("Assignment stack mismatch");
      }

      this.stack.push(produced[0]);
      return;
    }

    if (produced.length !== 2) {
      throw new InternalError("Assignment operator stack mismatch");
    }

    const target = produced[0] as ASTExpr;
    const value = produced[1] as ASTExpr;
    const opText = ctx.assignOp()!.getText();

    this.stack.push({
      variant: "ExprAssignmentExpr",
      target: target,
      value: value,
      operation: this.assignOpFromText(opText),
      sourceloc: this.loc(ctx),
    } satisfies ASTExprAssignmentExpr);
  };

  exitCInlineStatement = (ctx: CInlineStatementContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    if (produced.length !== 1) {
      throw new InternalError("CInlineStatement stack mismatch");
    }

    const expr = produced[0] as ASTExpr;

    this.stack.push({
      variant: "InlineCStatement",
      expr: expr,
      sourceloc: this.loc(ctx),
    } satisfies ASTInlineCStatement);
  };

  exitExprStatement = (ctx: ExprStatementContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    if (produced.length !== 1) {
      throw new InternalError("ExprStatement stack mismatch");
    }

    const expr = produced[0] as ASTExpr;

    this.stack.push({
      variant: "ExprStatement",
      expr: expr,
      sourceloc: this.loc(ctx),
    } satisfies ASTExprStatement);
  };

  exitReturnStatement = (ctx: ReturnStatementContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    let expr: ASTExpr | undefined;

    if (ctx.expr()) {
      if (produced.length !== 1) {
        throw new InternalError("ReturnStatement stack mismatch");
      }
      expr = produced[0] as ASTExpr;
    } else if (produced.length !== 0) {
      throw new InternalError("ReturnStatement stack mismatch");
    }

    this.stack.push({
      variant: "ReturnStatement",
      expr: expr,
      sourceloc: this.loc(ctx),
    } satisfies ASTReturnStatement);
  };

  exitVariableCreationStatementRule = (
    ctx: VariableCreationStatementRuleContext
  ) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    let i = 0;

    let datatype: ASTExpr | undefined;
    if (ctx.typeExpr()) {
      datatype = produced[i++] as ASTExpr;
    }

    let expr: ASTExpr | undefined;
    if (ctx.expr()) {
      expr = produced[i++] as ASTExpr;
    }

    if (i !== produced.length) {
      throw new InternalError("VariableCreationStatementRule stack mismatch");
    }

    this.stack.push({
      variant: "VariableDefinitionStatement",
      mutability: this.mutability(ctx),
      comptime: Boolean(ctx._comptime),
      name: ctx.id().getText(),
      sourceloc: this.loc(ctx),
      datatype: datatype,
      expr: expr,
      variableContext: EVariableContext.FunctionLocal,
    } satisfies ASTVariableDefinitionStatement);
  };

  exitVariableCreationStatement = (ctx: VariableCreationStatementContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    if (produced.length !== 1) {
      throw new InternalError("VariableCreationStatement stack mismatch");
    }

    // passthrough
    this.stack.push(produced[0]);
  };

  exitForEachStatement = (ctx: ForEachStatementContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    if (produced.length !== 2) {
      throw new InternalError("ForEachStatement stack mismatch");
    }

    const value = produced[0] as ASTExpr;
    const body = produced[1] as ASTScope;

    this.stack.push({
      variant: "ForEachStatement",
      loopVariable: ctx.id()[0].getText(),
      indexVariable: ctx.id().length > 1 ? ctx.id()[1].getText() : null,
      value: value,
      body: body,
      sourceloc: this.loc(ctx),
      comptime: Boolean(ctx._comptime),
    } satisfies ASTForEachStatement);
  };

  exitForStatement = (ctx: ForStatementContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    let i = 0;

    let initStatement: ASTStatement | null = null;
    if (ctx.statement()) {
      initStatement = produced[i++] as ASTStatement;
    }

    let loopCondition: ASTExpr | null = null;
    if (ctx._condition) {
      loopCondition = produced[i++] as ASTExpr;
    }

    let loopIncrement: ASTExpr | null = null;
    if (ctx._incr) {
      loopIncrement = produced[i++] as ASTExpr;
    }

    const body = produced[i++] as ASTScope;

    if (i !== produced.length) {
      throw new InternalError("ForStatement stack mismatch");
    }

    this.stack.push({
      variant: "ForStatement",
      initStatement: initStatement,
      loopCondition: loopCondition,
      loopIncrement: loopIncrement,
      body: body,
      sourceloc: this.loc(ctx),
      comptime: Boolean(ctx._comptime),
    } satisfies ASTForStatement);
  };

  exitIfStatementCondition = (ctx: IfStatementConditionContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    if (produced.length !== 1) {
      throw new InternalError("IfStatementCondition stack mismatch");
    }

    const expr = produced[0] as ASTExpr;

    this.stack.push({
      type: "expr",
      expr: expr,
    } satisfies IfStatementCondition);
  };

  exitIfLetStatementCondition = (ctx: IfLetStatementConditionContext) => {
    assert(ctx._letExpr);

    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    let i = 0;

    let datatype: ASTExpr | null = null;
    if (ctx.typeExpr()) {
      datatype = produced[i++] as ASTExpr;
    }

    const letExpr = produced[i++] as ASTExpr;

    let guardExpr: ASTExpr | null = null;
    if (ctx._guardExpr) {
      guardExpr = produced[i++] as ASTExpr;
    }

    if (i !== produced.length) {
      throw new InternalError("IfLetStatementCondition stack mismatch");
    }

    this.stack.push({
      type: "let",
      name: ctx.id().getText(),
      datatype: datatype,
      letExpr: letExpr,
      guardExpr: guardExpr,
    } satisfies IfStatementCondition);
  };

  processIfStatement(
    ctx: IfStatementContext | ComptimeIfStatementContext,
    comptime: boolean
  ) {
    if (!ctx._then) {
      throw new InternalError("then scope is missing");
    }

    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    const transformCondition = (cond: IfStatementCondition) => {
      if (cond.type === "let") {
        return {
          condition: cond.guardExpr,
          letCondition: {
            name: cond.name,
            type: cond.datatype,
            expr: cond.letExpr,
          },
        };
      }
      return {
        condition: cond.expr,
        letCondition: null,
      };
    };

    let i = 0;

    // --- if condition (required)
    if (i >= produced.length) {
      throw new InternalError("IfStatement missing if condition");
    }
    const ifCond = produced[i++] as IfStatementCondition;

    // --- then scope (required)
    if (i >= produced.length) {
      throw new InternalError("IfStatement missing then scope");
    }
    const thenScope = produced[i++] as ASTScope;

    // --- else-if pairs
    if (ctx._elseIfCondition.length !== ctx._elseIfThen.length) {
      throw new InternalError("inconsistent length");
    }

    const elseIfs: {
      condition: ASTExpr | null;
      letCondition: {
        name: string;
        type: ASTExpr | null;
        expr: ASTExpr;
      } | null;
      thenScope: ASTScope;
    }[] = [];

    for (let k = 0; k < ctx._elseIfCondition.length; k++) {
      const cond = produced[i++] as IfStatementCondition;
      const then = produced[i++] as ASTScope;

      elseIfs.push({
        ...transformCondition(cond),
        thenScope: then,
      });
    }

    // --- else block (optional)
    let elseBlock: ASTScope | undefined;
    if (ctx._elseBlock) {
      elseBlock = produced[i++] as ASTScope;
    }

    if (i !== produced.length) {
      throw new InternalError("IfStatement stack mismatch");
    }

    const head = transformCondition(ifCond);

    this.stack.push({
      variant: "IfStatement",
      ...head,
      thenScope: thenScope,
      sourceloc: this.loc(ctx),
      elseIfs: elseIfs,
      comptime: comptime,
      else: elseBlock,
    } satisfies ASTIfStatement);
  }

  exitIfStatement = (ctx: IfStatementContext) => {
    this.processIfStatement(ctx, false);
  };

  exitComptimeIfStatement = (ctx: ComptimeIfStatementContext) => {
    this.processIfStatement(ctx, true);
  };

  exitWhileStatement = (ctx: WhileStatementContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    if (produced.length !== 2) {
      throw new InternalError("WhileStatement stack mismatch");
    }

    const condition = produced[0];
    const body = produced[1];

    this.stack.push({
      variant: "WhileStatement",
      letCondition: null,
      condition: condition,
      body: body,
      sourceloc: this.loc(ctx),
    } satisfies ASTWhileStatement);
  };

  exitWhileLetStatement = (ctx: WhileLetStatementContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    const exprs = ctx.expr();
    assert(exprs.length >= 1 && exprs.length <= 2);

    let i = 0;

    // datatype (optional)
    const type = ctx.typeExpr() ? produced[i++] : null;

    // let expression (required)
    if (i >= produced.length) {
      throw new InternalError("WhileLetStatement missing let expr");
    }
    const letExpr = produced[i++];

    // condition (optional)
    const condition = exprs.length === 2 ? produced[i++] : null;

    // body (required)
    if (i >= produced.length) {
      throw new InternalError("WhileLetStatement missing body");
    }
    const body = produced[i++];

    if (i !== produced.length) {
      throw new InternalError("WhileLetStatement stack mismatch");
    }

    this.stack.push({
      variant: "WhileStatement",
      letCondition: {
        name: ctx.id().getText(),
        type: type,
        expr: letExpr,
      },
      condition: condition,
      body: body,
      sourceloc: this.loc(ctx),
    } satisfies ASTWhileStatement);
  };

  exitTypeAliasDirective = (ctx: TypeAliasDirectiveContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    if (produced.length !== 1) {
      throw new InternalError("TypeAliasDirective stack mismatch");
    }

    const datatype = produced[0];

    assert(ctx._name !== null && ctx._name !== undefined);
    assert(ctx._name.getText());

    const generics = ctx
      .id()
      .slice(1)
      .map((g) => g.getText());

    this.stack.push({
      variant: "TypeAlias",
      datatype: datatype,
      export: Boolean(ctx._export_),
      extern: this.exlang(ctx),
      generics: generics.map((p) => ({
        name: p,
        sourceloc: this.loc(ctx),
      })),
      pub: Boolean(ctx._pub),
      name: ctx._name.getText(),
      sourceloc: this.loc(ctx),
    } satisfies ASTTypeAlias);
  };

  exitTypeAliasStatement = (ctx: TypeAliasStatementContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    if (produced.length !== 1) {
      throw new InternalError("TypeAliasStatement stack mismatch");
    }

    this.stack.push(produced[0]);
  };

  exitAggregateLiteralElement = (ctx: AggregateLiteralElementContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    if (produced.length !== 1) {
      throw new InternalError("AggregateLiteralElement stack mismatch");
    }

    const value = produced[0];

    this.stack.push({
      key: ctx.id() ? ctx.id()!.getText() : null,
      value: value,
      sourceloc: this.loc(ctx),
    } satisfies ASTAggregateLiteralElement);
  };

  exitImportStatement = (ctx: ImportStatementContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    if (produced.length !== 0) {
      throw new InternalError("ImportStatement produced unexpected children");
    }

    const alias = ctx._alias ? ctx._alias.getText() : null;

    let result: ASTModuleImport;

    if (ctx._path) {
      assert(ctx._path.text);
      result = {
        alias: alias,
        mode: "path",
        name: this.trimAndUnescapeStringLiteral(
          ctx._path.text,
          1,
          this.loc(ctx)
        ),
        sourceloc: this.loc(ctx),
        variant: "ModuleImport",
      };
    } else {
      assert(ctx._module_);
      result = {
        alias: alias,
        mode: "module",
        name: ctx._module_.getText(),
        sourceloc: this.loc(ctx),
        variant: "ModuleImport",
      };
    }

    this.stack.push(result);
  };

  exitFromImportStatement = (ctx: FromImportStatementContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    // This rule should not produce semantic children
    if (produced.length !== 0) {
      throw new InternalError(
        "FromImportStatement produced unexpected children"
      );
    }

    const symbols = ctx.importAs().map((imp) => {
      assert(imp._symbol_);
      return {
        alias: imp._alias?.getText() || null,
        symbol: imp._symbol_.getText(),
      };
    });

    let result: ASTSymbolImport;

    if (ctx._path) {
      assert(ctx._path.text);
      result = {
        symbols: symbols,
        mode: "path",
        name: this.trimAndUnescapeStringLiteral(
          ctx._path.text,
          1,
          this.loc(ctx)
        ),
        sourceloc: this.loc(ctx),
        variant: "SymbolImport",
      };
    } else {
      assert(ctx._module_);
      result = {
        symbols: symbols,
        mode: "module",
        name: ctx._module_.getText(),
        sourceloc: this.loc(ctx),
        variant: "SymbolImport",
      };
    }

    this.stack.push(result);
  };

  exitRaiseStatement = (ctx: RaiseStatementContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    let expr: ASTExpr | null = null;

    if (ctx.expr()) {
      if (produced.length !== 1) {
        throw new InternalError("RaiseStatement stack mismatch");
      }
      expr = produced[0];
    } else if (produced.length !== 0) {
      throw new InternalError("RaiseStatement unexpected children");
    }

    this.stack.push({
      variant: "RaiseStatement",
      expr: expr,
      sourceloc: this.loc(ctx),
    } satisfies ASTRaiseStatement);
  };

  exitGlobalDeclaration = (ctx: GlobalDeclarationContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    // produced already contains all child results
    // some children may push arrays → flatten once

    const flat = produced.flat();

    this.stack.push(flat);
  };

  exitNamespaceDefinition = (ctx: NamespaceDefinitionContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    const declarations: any[] = [];
    for (const x of produced) {
      if (Array.isArray(x)) {
        declarations.push(...x);
      } else if (x != null) {
        declarations.push(x);
      }
    }

    const names = ctx
      .id()
      .map((c) => c.getText())
      .reverse();

    let current: ASTNamespaceDefinition = {
      variant: "NamespaceDefinition",
      declarations: declarations,
      export: Boolean(ctx._export_),
      name: names[0],
      sourceloc: this.loc(ctx),
    };

    for (const name of names.slice(1)) {
      current = {
        variant: "NamespaceDefinition",
        declarations: [current],
        export: Boolean(ctx._export_),
        name: name,
        sourceloc: this.loc(ctx),
      };
    }

    this.stack.push(current);
  };

  integerFromDecimalOrHex(ctx: {
    INTEGER_LITERAL: () => TerminalNode | null;
    HEX_INTEGER_LITERAL: () => TerminalNode | null;
  }) {
    let value = 0n;
    if (ctx.INTEGER_LITERAL()) {
      const number = ctx.INTEGER_LITERAL()!.getText();
      value = BigInt(number);
      // Make sure the value is 100% correct
      assert(value.toString() === number);
    } else if (ctx.HEX_INTEGER_LITERAL()) {
      const number = ctx.HEX_INTEGER_LITERAL()!.getText();
      value = BigInt(number);
      // Make sure the value is 100% correct
      const normalized = number.toLowerCase();
      assert(value.toString(16) === normalized.slice(2));
    } else {
      assert(false);
    }
    return value;
  }

  exitRegexLiteral = (ctx: RegexLiteralContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    // this rule should not have semantic children
    if (produced.length !== 0) {
      throw new InternalError("RegexLiteral produced unexpected children");
    }

    const text = ctx.REGEX_LITERAL().getText();

    if (!text.startsWith('r"')) {
      throw new Error("not a regex literal");
    }

    const lastQuote = text.lastIndexOf('"');

    if (lastQuote < 2) {
      throw new Error("malformed regex literal");
    }

    const pattern = text.slice(2, lastQuote);
    const flags = text.slice(lastQuote + 1);

    const allowedFlags = new Set(["i", "m", "s", "u", "g"]);
    const flagSet = new Set<string>();

    for (const c of flags.toLowerCase()) {
      if (!allowedFlags.has(c)) {
        throw new CompilerError(`unknown regex flag '${c}'`, this.loc(ctx));
      }
      if (flagSet.has(c)) {
        throw new CompilerError(`duplicate regex flag '${c}'`, this.loc(ctx));
      }
      flagSet.add(c);
    }

    this.stack.push({
      type: EPrimitive.Regex,
      pattern: pattern,
      flags: flagSet,
      id: null,
    } satisfies LiteralValue);
  };

  trimAndUnescapeStringLiteral(
    raw: string,
    stripQuotes: number,
    sourceloc: SourceLoc
  ): string {
    // --- strip delimiters ---
    if (stripQuotes > 0) {
      raw = raw.slice(stripQuotes, -stripQuotes);
    }

    // --- trimming semantics ---

    // trim exactly one leading newline + indentation
    if (raw.startsWith("\n")) {
      let i = 1;
      while (raw[i] === " " || raw[i] === "\t") {
        i++;
      }
      raw = raw.slice(i);
    }

    // trim exactly one trailing newline + indentation
    if (raw.endsWith("\n") || raw.endsWith(" \n") || raw.endsWith("\t\n")) {
      let i = raw.length - 1;
      if (raw[i] !== "\n") {
        return raw;
      }

      i--;
      while (i >= 0 && (raw[i] === " " || raw[i] === "\t")) {
        i--;
      }
      raw = raw.slice(0, i + 1);
    }

    // --- unescape ---

    let out = "";
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];

      if (c !== "\\") {
        out += c;
        continue;
      }

      const n = raw[++i];
      if (n === undefined) {
        throw new CompilerError("Invalid escape: trailing \\", sourceloc);
      }

      switch (n) {
        case "b":
          out += "\b";
          break;
        case "t":
          out += "\t";
          break;
        case "n":
          out += "\n";
          break;
        case "f":
          out += "\f";
          break;
        case "r":
          out += "\r";
          break;
        case "\\":
          out += "\\";
          break;
        case '"':
          out += '"';
          break;

        case "x": {
          const hex = raw.slice(i + 1, i + 3);
          if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
            throw new CompilerError("Invalid \\x escape", sourceloc);
          }
          out += String.fromCharCode(Number.parseInt(hex, 16));
          i += 2;
          break;
        }

        case "u": {
          const hex = raw.slice(i + 1, i + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            throw new CompilerError("Invalid \\u escape", sourceloc);
          }
          out += String.fromCharCode(Number.parseInt(hex, 16));
          i += 4;
          break;
        }

        case "U": {
          const hex = raw.slice(i + 1, i + 9);
          if (!/^[0-9a-fA-F]{8}$/.test(hex)) {
            throw new CompilerError("Invalid \\U escape", sourceloc);
          }
          out += String.fromCodePoint(Number.parseInt(hex, 16));
          i += 8;
          break;
        }

        default: {
          // octal \0 - \377
          if (/[0-7]/.test(n)) {
            let oct = n;
            for (let k = 0; k < 2; k++) {
              const d = raw[i + 1];
              if (d && /[0-7]/.test(d)) {
                oct += d;
                i++;
              } else {
                break;
              }
            }
            out += String.fromCharCode(Number.parseInt(oct, 8));
          } else {
            throw new CompilerError(`Unknown escape: \\${n}`, sourceloc);
          }
        }
      }
    }

    return out;
  }

  unescapeFStringLiteralFragment(text: string, sourceloc: SourceLoc): string {
    if (text.length === 2) {
      switch (text[1]) {
        case "n":
          return "\n";
        case "t":
          return "\t";
        case "r":
          return "\r";
        case "b":
          return "\b";
        case "f":
          return "\f";
        case "\\":
          return "\\";
        case '"':
          return '"';
        default:
          assert(false);
          throw new Error();
      }
    }

    if (text === '\\"""') {
      return '"""';
    }

    if (text.startsWith("\\x")) {
      const hex = text.slice(2);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
        throw new CompilerError(`Invalid \\x escape: ${text}`, sourceloc);
      }
      return String.fromCharCode(Number.parseInt(hex, 16));
    }

    if (text.startsWith("\\u")) {
      const hex = text.slice(2);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
        throw new CompilerError(`Invalid \\u escape: ${text}`, sourceloc);
      }
      return String.fromCharCode(Number.parseInt(hex, 16));
    }

    if (text.startsWith("\\U")) {
      const hex = text.slice(2);
      if (!/^[0-9a-fA-F]{8}$/.test(hex)) {
        throw new CompilerError(`Invalid \\U escape: ${text}`, sourceloc);
      }
      return String.fromCodePoint(Number.parseInt(hex, 16));
    }

    if (/^\\[0-7]{1,3}$/.test(text)) {
      return String.fromCharCode(Number.parseInt(text.slice(1), 8));
    }

    return text; // No escape
  }

  private processFStringFragments(
    ctx: SingleFStringContext | TripleFStringContext,
    exprs: ASTExpr[],
    allocator: ASTExpr | null
  ): ASTFStringExpr {
    let exprIndex = 0;

    // --- build raw fragment stream (text + expr interleaved) ---

    const perCharacterFragments = ctx.interpolatedStringFragment().map((g) => {
      if (g.interpolatedStringExpression()) {
        if (exprIndex >= exprs.length) {
          throw new InternalError("FString expression underflow");
        }

        return {
          type: "expr",
          value: exprs[exprIndex++],
        } as const;
      }
      assert(g.FSTRING_GRAPHEME());

      let text = g.FSTRING_GRAPHEME()!.getText();
      if (text === "{{") {
        text = "{";
      }
      if (text === "}}") {
        text = "}";
      }
      if (text === '\\"""') {
        text = '"""';
      }

      return {
        type: "text",
        value: text,
      } as const;
    });

    if (exprIndex !== exprs.length) {
      throw new InternalError("FString expression count mismatch");
    }

    // --- merge adjacent text fragments ---

    const combinedFragments: (
      | { type: "expr"; value: ASTExpr }
      | { type: "text"; value: string }
    )[] = [];

    for (const fragment of perCharacterFragments) {
      if (fragment.type === "expr") {
        combinedFragments.push(fragment);
      } else {
        const last =
          combinedFragments.length > 0
            ? combinedFragments[combinedFragments.length - 1]
            : null;

        if (last && last.type === "text") {
          last.value += fragment.value;
        } else {
          combinedFragments.push({
            type: "text",
            value: fragment.value,
          });
        }
      }
    }

    // --- unescape text fragments ---

    const unescapedFragments = combinedFragments.map((f) => {
      if (f.type === "text") {
        return {
          type: "text",
          value: this.trimAndUnescapeStringLiteral(f.value, 0, this.loc(ctx)),
        } as const;
      }
      return f;
    });

    // --- final AST node ---

    return {
      variant: "FStringExpr",
      fragments: unescapedFragments,
      allocator: allocator,
      sourceloc: this.loc(ctx),
    };
  }

  private exitFStringCommon(ctx: SingleFStringContext | TripleFStringContext) {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    let allocator: ASTExpr | null = null;
    const exprs = produced;

    if (ctx._allocatorExpr) {
      allocator = exprs.pop()!;
    }

    const result = this.processFStringFragments(
      ctx,
      exprs as ASTExpr[],
      allocator
    );

    this.stack.push(result);
  }

  exitSingleFString = (ctx: SingleFStringContext) => {
    this.exitFStringCommon(ctx);
  };

  exitTripleFString = (ctx: TripleFStringContext) => {
    this.exitFStringCommon(ctx);
  };

  exitSourceLocationPrefixRule = (ctx: SourceLocationPrefixRuleContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);

    // sanity check: this rule should not produce child AST nodes
    if (produced.length !== 0) {
      throw new InternalError(
        "SourceLocationPrefixRule produced unexpected children"
      );
    }

    const result = this.computeSourceLoc(ctx);

    if (this.sourcelocOverridePending.length > 0) {
      const lastIndex = this.sourcelocOverridePending.length - 1;
      if (!this.sourcelocOverridePending[lastIndex]) {
        this.sourcelocOverridePending[lastIndex] = true;
        this.sourcelocOverride.push(result);
      }
    }
  };

  enterGlobalDeclarationWithSource = (
    _ctx: GlobalDeclarationWithSourceContext
  ) => {
    this.sourcelocOverridePending.push(false);
  };
  exitGlobalDeclarationWithSource = (
    ctx: GlobalDeclarationWithSourceContext
  ) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);
    const didOverride = this.sourcelocOverridePending.pop();
    if (didOverride) {
      this.sourcelocOverride.pop();
    }

    // flatten declarations (this rule semantically returns a list)
    const flat: any[] = [];
    for (const x of produced) {
      if (Array.isArray(x)) {
        flat.push(...x);
      } else if (x != null) {
        flat.push(x);
      }
    }

    this.stack.push(flat);
  };

  private computeSourceLoc = (
    ctx: SourceLocationPrefixRuleContext
  ): SourceLoc => {
    const stringLiteral = ctx.STRING_LITERAL();
    if (!stringLiteral) {
      throw new CompilerError(
        "Missing source location filename",
        this.loc(ctx)
      );
    }

    const fullPath = this.trimAndUnescapeStringLiteral(
      stringLiteral.getText(),
      1,
      this.loc(ctx)
    );

    // Parse the new format: "/path/to/file.hz:line:col-endcol"
    // Find the location suffix by looking for ":digits:" pattern
    const match = fullPath.match(/^(.+?):(\d+):(\d+)(?:-(\d+))?(?:\.(\d+))?$/);

    if (!match) {
      throw new CompilerError(
        `Invalid source location format: expected "/path/to/file.hz:line:col[-endcol]", got "${fullPath}"`,
        this.loc(ctx)
      );
    }

    const filename = match[1];
    const line = Number.parseInt(match[2], 10);
    const startCol = Number.parseInt(match[3], 10);
    const endCol = match[4] ? Number.parseInt(match[4], 10) : undefined;
    const endLine = match[5] ? Number.parseInt(match[5], 10) : undefined;

    const result: SourceLoc = {
      filename: filename,
      start: { line: line, column: startCol },
    };

    if (endCol !== undefined) {
      if (endLine === undefined) {
        result.end = { line: line, column: endCol };
      } else {
        result.end = { line: endLine, column: endCol };
      }
    }

    return result;
  };

  enterStructContentWithSourceloc = (
    _ctx: StructContentWithSourcelocContext
  ) => {
    this.sourcelocOverridePending.push(false);
  };
  exitStructContentWithSourceloc = (ctx: StructContentWithSourcelocContext) => {
    const start = this.getMark(ctx);
    const produced = this.stack.splice(start);
    const didOverride = this.sourcelocOverridePending.pop();
    if (didOverride) {
      this.sourcelocOverride.pop();
    }

    for (const v of produced) {
      if (Array.isArray(v)) {
        throw new InternalError(
          `${ctx.constructor.name} received nested array on stack`
        );
      }
      this.stack.push(v);
    }
  };
}
