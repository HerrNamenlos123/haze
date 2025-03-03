// Generated from Haze.g4 by ANTLR 4.13.2
// noinspection ES6UnusedImports,JSUnusedGlobalSymbols,JSUnusedLocalSymbols

import {
	ATN,
	ATNDeserializer, DecisionState, DFA, FailedPredicateException,
	RecognitionException, NoViableAltException, BailErrorStrategy,
	Parser, ParserATNSimulator,
	RuleContext, ParserRuleContext, PredictionMode, PredictionContextCache,
	TerminalNode, RuleNode,
	Token, TokenStream,
	Interval, IntervalSet
} from 'antlr4';
import HazeListener from "./HazeListener.js";
import HazeVisitor from "./HazeVisitor.js";

// for running tests with parameters, TODO: discuss strategy for typed parameters in CI
// eslint-disable-next-line no-unused-vars
type int = number;

export default class HazeParser extends Parser {
	public static readonly T__0 = 1;
	public static readonly T__1 = 2;
	public static readonly T__2 = 3;
	public static readonly T__3 = 4;
	public static readonly T__4 = 5;
	public static readonly T__5 = 6;
	public static readonly T__6 = 7;
	public static readonly T__7 = 8;
	public static readonly T__8 = 9;
	public static readonly T__9 = 10;
	public static readonly T__10 = 11;
	public static readonly T__11 = 12;
	public static readonly T__12 = 13;
	public static readonly T__13 = 14;
	public static readonly T__14 = 15;
	public static readonly T__15 = 16;
	public static readonly T__16 = 17;
	public static readonly T__17 = 18;
	public static readonly T__18 = 19;
	public static readonly T__19 = 20;
	public static readonly T__20 = 21;
	public static readonly T__21 = 22;
	public static readonly T__22 = 23;
	public static readonly T__23 = 24;
	public static readonly T__24 = 25;
	public static readonly T__25 = 26;
	public static readonly T__26 = 27;
	public static readonly T__27 = 28;
	public static readonly T__28 = 29;
	public static readonly T__29 = 30;
	public static readonly T__30 = 31;
	public static readonly T__31 = 32;
	public static readonly T__32 = 33;
	public static readonly T__33 = 34;
	public static readonly T__34 = 35;
	public static readonly T__35 = 36;
	public static readonly T__36 = 37;
	public static readonly T__37 = 38;
	public static readonly T__38 = 39;
	public static readonly T__39 = 40;
	public static readonly T__40 = 41;
	public static readonly T__41 = 42;
	public static readonly T__42 = 43;
	public static readonly T__43 = 44;
	public static readonly T__44 = 45;
	public static readonly T__45 = 46;
	public static readonly T__46 = 47;
	public static readonly T__47 = 48;
	public static readonly T__48 = 49;
	public static readonly T__49 = 50;
	public static readonly T__50 = 51;
	public static readonly T__51 = 52;
	public static readonly T__52 = 53;
	public static readonly T__53 = 54;
	public static readonly T__54 = 55;
	public static readonly STRING_LITERAL = 56;
	public static readonly UNIT_LITERAL = 57;
	public static readonly NUMBER_LITERAL = 58;
	public static readonly ID = 59;
	public static readonly WS = 60;
	public static readonly COMMENT = 61;
	public static override readonly EOF = Token.EOF;
	public static readonly RULE_prog = 0;
	public static readonly RULE_namedfunc = 1;
	public static readonly RULE_func = 2;
	public static readonly RULE_funcbody = 3;
	public static readonly RULE_body = 4;
	public static readonly RULE_param = 5;
	public static readonly RULE_params = 6;
	public static readonly RULE_cdefinitiondecl = 7;
	public static readonly RULE_funcdecl = 8;
	public static readonly RULE_externlang = 9;
	public static readonly RULE_ifexpr = 10;
	public static readonly RULE_elseifexpr = 11;
	public static readonly RULE_thenblock = 12;
	public static readonly RULE_elseifblock = 13;
	public static readonly RULE_elseblock = 14;
	public static readonly RULE_variablemutability = 15;
	public static readonly RULE_statement = 16;
	public static readonly RULE_structmembervalue = 17;
	public static readonly RULE_expr = 18;
	public static readonly RULE_args = 19;
	public static readonly RULE_ellipsis = 20;
	public static readonly RULE_functype = 21;
	public static readonly RULE_constant = 22;
	public static readonly RULE_compilationhint = 23;
	public static readonly RULE_compilationhintfilename = 24;
	public static readonly RULE_compilationhintflags = 25;
	public static readonly RULE_compilationlang = 26;
	public static readonly RULE_linkerhint = 27;
	public static readonly RULE_structcontent = 28;
	public static readonly RULE_structdecl = 29;
	public static readonly RULE_datatype = 30;
	public static readonly literalNames: (string | null)[] = [ null, "'('", 
                                                            "')'", "':'", 
                                                            "'=>'", "'{'", 
                                                            "'}'", "','", 
                                                            "'declare'", 
                                                            "';'", "'.'", 
                                                            "'\"C\"'", "'\"C++\"'", 
                                                            "'let'", "'const'", 
                                                            "'__c__'", "'return'", 
                                                            "'='", "'if'", 
                                                            "'else'", "'while'", 
                                                            "'++'", "'--'", 
                                                            "'+'", "'-'", 
                                                            "'not'", "'!'", 
                                                            "'as'", "'*'", 
                                                            "'/'", "'%'", 
                                                            "'<'", "'>'", 
                                                            "'<='", "'>='", 
                                                            "'=='", "'!='", 
                                                            "'is'", "'and'", 
                                                            "'or'", "'+='", 
                                                            "'-='", "'*='", 
                                                            "'/='", "'%='", 
                                                            "'<<='", "'>>='", 
                                                            "'&='", "'^='", 
                                                            "'|='", "'...'", 
                                                            "'true'", "'false'", 
                                                            "'#compile'", 
                                                            "'#link'", "'struct'" ];
	public static readonly symbolicNames: (string | null)[] = [ null, null, 
                                                             null, null, 
                                                             null, null, 
                                                             null, null, 
                                                             null, null, 
                                                             null, null, 
                                                             null, null, 
                                                             null, null, 
                                                             null, null, 
                                                             null, null, 
                                                             null, null, 
                                                             null, null, 
                                                             null, null, 
                                                             null, null, 
                                                             null, null, 
                                                             null, null, 
                                                             null, null, 
                                                             null, null, 
                                                             null, null, 
                                                             null, null, 
                                                             null, null, 
                                                             null, null, 
                                                             null, null, 
                                                             null, null, 
                                                             null, null, 
                                                             null, null, 
                                                             null, null, 
                                                             null, null, 
                                                             "STRING_LITERAL", 
                                                             "UNIT_LITERAL", 
                                                             "NUMBER_LITERAL", 
                                                             "ID", "WS", 
                                                             "COMMENT" ];
	// tslint:disable:no-trailing-whitespace
	public static readonly ruleNames: string[] = [
		"prog", "namedfunc", "func", "funcbody", "body", "param", "params", "cdefinitiondecl", 
		"funcdecl", "externlang", "ifexpr", "elseifexpr", "thenblock", "elseifblock", 
		"elseblock", "variablemutability", "statement", "structmembervalue", "expr", 
		"args", "ellipsis", "functype", "constant", "compilationhint", "compilationhintfilename", 
		"compilationhintflags", "compilationlang", "linkerhint", "structcontent", 
		"structdecl", "datatype",
	];
	public get grammarFileName(): string { return "Haze.g4"; }
	public get literalNames(): (string | null)[] { return HazeParser.literalNames; }
	public get symbolicNames(): (string | null)[] { return HazeParser.symbolicNames; }
	public get ruleNames(): string[] { return HazeParser.ruleNames; }
	public get serializedATN(): number[] { return HazeParser._serializedATN; }

	protected createFailedPredicateException(predicate?: string, message?: string): FailedPredicateException {
		return new FailedPredicateException(this, predicate, message);
	}

	constructor(input: TokenStream) {
		super(input);
		this._interp = new ParserATNSimulator(this, HazeParser._ATN, HazeParser.DecisionsToDFA, new PredictionContextCache());
	}
	// @RuleVersion(0)
	public prog(): ProgContext {
		let localctx: ProgContext = new ProgContext(this, this._ctx, this.state);
		this.enterRule(localctx, 0, HazeParser.RULE_prog);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 70;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===8 || ((((_la - 53)) & ~0x1F) === 0 && ((1 << (_la - 53)) & 71) !== 0)) {
				{
				this.state = 68;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 0, this._ctx) ) {
				case 1:
					{
					this.state = 62;
					this.cdefinitiondecl();
					}
					break;
				case 2:
					{
					this.state = 63;
					this.namedfunc();
					}
					break;
				case 3:
					{
					this.state = 64;
					this.funcdecl();
					}
					break;
				case 4:
					{
					this.state = 65;
					this.compilationhint();
					}
					break;
				case 5:
					{
					this.state = 66;
					this.linkerhint();
					}
					break;
				case 6:
					{
					this.state = 67;
					this.structdecl();
					}
					break;
				}
				}
				this.state = 72;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public namedfunc(): NamedfuncContext {
		let localctx: NamedfuncContext = new NamedfuncContext(this, this._ctx, this.state);
		this.enterRule(localctx, 2, HazeParser.RULE_namedfunc);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 73;
			this.match(HazeParser.ID);
			this.state = 74;
			this.match(HazeParser.T__0);
			this.state = 75;
			this.params();
			this.state = 76;
			this.match(HazeParser.T__1);
			this.state = 79;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===3) {
				{
				this.state = 77;
				this.match(HazeParser.T__2);
				this.state = 78;
				this.datatype();
				}
			}

			this.state = 81;
			this.funcbody();
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public func(): FuncContext {
		let localctx: FuncContext = new FuncContext(this, this._ctx, this.state);
		this.enterRule(localctx, 4, HazeParser.RULE_func);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 83;
			this.match(HazeParser.T__0);
			this.state = 84;
			this.params();
			this.state = 85;
			this.match(HazeParser.T__1);
			this.state = 88;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===3) {
				{
				this.state = 86;
				this.match(HazeParser.T__2);
				this.state = 87;
				this.datatype();
				}
			}

			this.state = 90;
			this.funcbody();
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public funcbody(): FuncbodyContext {
		let localctx: FuncbodyContext = new FuncbodyContext(this, this._ctx, this.state);
		this.enterRule(localctx, 6, HazeParser.RULE_funcbody);
		let _la: number;
		try {
			this.state = 101;
			this._errHandler.sync(this);
			switch ( this._interp.adaptivePredict(this._input, 5, this._ctx) ) {
			case 1:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 93;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===4) {
					{
					this.state = 92;
					this.match(HazeParser.T__3);
					}
				}

				this.state = 95;
				this.match(HazeParser.T__4);
				this.state = 96;
				this.body();
				this.state = 97;
				this.match(HazeParser.T__5);
				}
				break;
			case 2:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 99;
				this.match(HazeParser.T__3);
				this.state = 100;
				this.expr(0);
				}
				break;
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public body(): BodyContext {
		let localctx: BodyContext = new BodyContext(this, this._ctx, this.state);
		this.enterRule(localctx, 8, HazeParser.RULE_body);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 106;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while ((((_la) & ~0x1F) === 0 && ((1 << _la) & 133554178) !== 0) || ((((_la - 51)) & ~0x1F) === 0 && ((1 << (_la - 51)) & 483) !== 0)) {
				{
				{
				this.state = 103;
				this.statement();
				}
				}
				this.state = 108;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public param(): ParamContext {
		let localctx: ParamContext = new ParamContext(this, this._ctx, this.state);
		this.enterRule(localctx, 10, HazeParser.RULE_param);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 109;
			this.match(HazeParser.ID);
			this.state = 110;
			this.match(HazeParser.T__2);
			this.state = 111;
			this.datatype();
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public params(): ParamsContext {
		let localctx: ParamsContext = new ParamsContext(this, this._ctx, this.state);
		this.enterRule(localctx, 12, HazeParser.RULE_params);
		let _la: number;
		try {
			let _alt: number;
			this.state = 128;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 2:
			case 59:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 125;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===59) {
					{
					this.state = 113;
					this.param();
					this.state = 118;
					this._errHandler.sync(this);
					_alt = this._interp.adaptivePredict(this._input, 7, this._ctx);
					while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
						if (_alt === 1) {
							{
							{
							this.state = 114;
							this.match(HazeParser.T__6);
							this.state = 115;
							this.param();
							}
							}
						}
						this.state = 120;
						this._errHandler.sync(this);
						_alt = this._interp.adaptivePredict(this._input, 7, this._ctx);
					}
					this.state = 123;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					if (_la===7) {
						{
						this.state = 121;
						this.match(HazeParser.T__6);
						this.state = 122;
						this.ellipsis();
						}
					}

					}
				}

				}
				break;
			case 50:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 127;
				this.ellipsis();
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public cdefinitiondecl(): CdefinitiondeclContext {
		let localctx: CdefinitiondeclContext = new CdefinitiondeclContext(this, this._ctx, this.state);
		this.enterRule(localctx, 14, HazeParser.RULE_cdefinitiondecl);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 130;
			this.match(HazeParser.T__7);
			{
			this.state = 131;
			this.externlang();
			}
			this.state = 132;
			this.match(HazeParser.STRING_LITERAL);
			this.state = 133;
			this.match(HazeParser.T__8);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public funcdecl(): FuncdeclContext {
		let localctx: FuncdeclContext = new FuncdeclContext(this, this._ctx, this.state);
		this.enterRule(localctx, 16, HazeParser.RULE_funcdecl);
		let _la: number;
		try {
			let _alt: number;
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 135;
			this.match(HazeParser.T__7);
			this.state = 137;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===11 || _la===12) {
				{
				this.state = 136;
				this.externlang();
				}
			}

			this.state = 143;
			this._errHandler.sync(this);
			_alt = this._interp.adaptivePredict(this._input, 12, this._ctx);
			while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
				if (_alt === 1) {
					{
					{
					this.state = 139;
					this.match(HazeParser.ID);
					this.state = 140;
					this.match(HazeParser.T__9);
					}
					}
				}
				this.state = 145;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 12, this._ctx);
			}
			this.state = 146;
			this.match(HazeParser.ID);
			this.state = 147;
			this.match(HazeParser.T__0);
			this.state = 148;
			this.params();
			this.state = 149;
			this.match(HazeParser.T__1);
			this.state = 152;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===3) {
				{
				this.state = 150;
				this.match(HazeParser.T__2);
				this.state = 151;
				this.datatype();
				}
			}

			this.state = 154;
			this.match(HazeParser.T__8);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public externlang(): ExternlangContext {
		let localctx: ExternlangContext = new ExternlangContext(this, this._ctx, this.state);
		this.enterRule(localctx, 18, HazeParser.RULE_externlang);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 156;
			_la = this._input.LA(1);
			if(!(_la===11 || _la===12)) {
			this._errHandler.recoverInline(this);
			}
			else {
				this._errHandler.reportMatch(this);
			    this.consume();
			}
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public ifexpr(): IfexprContext {
		let localctx: IfexprContext = new IfexprContext(this, this._ctx, this.state);
		this.enterRule(localctx, 20, HazeParser.RULE_ifexpr);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 158;
			this.expr(0);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public elseifexpr(): ElseifexprContext {
		let localctx: ElseifexprContext = new ElseifexprContext(this, this._ctx, this.state);
		this.enterRule(localctx, 22, HazeParser.RULE_elseifexpr);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 160;
			this.expr(0);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public thenblock(): ThenblockContext {
		let localctx: ThenblockContext = new ThenblockContext(this, this._ctx, this.state);
		this.enterRule(localctx, 24, HazeParser.RULE_thenblock);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 162;
			this.body();
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public elseifblock(): ElseifblockContext {
		let localctx: ElseifblockContext = new ElseifblockContext(this, this._ctx, this.state);
		this.enterRule(localctx, 26, HazeParser.RULE_elseifblock);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 164;
			this.body();
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public elseblock(): ElseblockContext {
		let localctx: ElseblockContext = new ElseblockContext(this, this._ctx, this.state);
		this.enterRule(localctx, 28, HazeParser.RULE_elseblock);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 166;
			this.body();
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public variablemutability(): VariablemutabilityContext {
		let localctx: VariablemutabilityContext = new VariablemutabilityContext(this, this._ctx, this.state);
		this.enterRule(localctx, 30, HazeParser.RULE_variablemutability);
		let _la: number;
		try {
			localctx = new VariableMutabilityContext(this, localctx);
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 168;
			_la = this._input.LA(1);
			if(!(_la===13 || _la===14)) {
			this._errHandler.recoverInline(this);
			}
			else {
				this._errHandler.reportMatch(this);
			    this.consume();
			}
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public statement(): StatementContext {
		let localctx: StatementContext = new StatementContext(this, this._ctx, this.state);
		this.enterRule(localctx, 32, HazeParser.RULE_statement);
		let _la: number;
		try {
			let _alt: number;
			this.state = 223;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 15:
				localctx = new InlineCStatementContext(this, localctx);
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 170;
				this.match(HazeParser.T__14);
				this.state = 171;
				this.match(HazeParser.T__0);
				this.state = 172;
				this.match(HazeParser.STRING_LITERAL);
				this.state = 173;
				this.match(HazeParser.T__1);
				this.state = 174;
				this.match(HazeParser.T__8);
				}
				break;
			case 1:
			case 21:
			case 22:
			case 23:
			case 24:
			case 25:
			case 26:
			case 51:
			case 52:
			case 56:
			case 57:
			case 58:
			case 59:
				localctx = new ExprStatementContext(this, localctx);
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 175;
				this.expr(0);
				this.state = 176;
				this.match(HazeParser.T__8);
				}
				break;
			case 16:
				localctx = new ReturnStatementContext(this, localctx);
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 178;
				this.match(HazeParser.T__15);
				this.state = 180;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if ((((_la) & ~0x1F) === 0 && ((1 << _la) & 132120578) !== 0) || ((((_la - 51)) & ~0x1F) === 0 && ((1 << (_la - 51)) & 483) !== 0)) {
					{
					this.state = 179;
					this.expr(0);
					}
				}

				this.state = 182;
				this.match(HazeParser.T__8);
				}
				break;
			case 13:
			case 14:
				localctx = new VariableDefinitionContext(this, localctx);
				this.enterOuterAlt(localctx, 4);
				{
				this.state = 183;
				this.variablemutability();
				this.state = 184;
				this.match(HazeParser.ID);
				this.state = 187;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===3) {
					{
					this.state = 185;
					this.match(HazeParser.T__2);
					this.state = 186;
					this.datatype();
					}
				}

				this.state = 189;
				this.match(HazeParser.T__16);
				this.state = 190;
				this.expr(0);
				this.state = 191;
				this.match(HazeParser.T__8);
				}
				break;
			case 18:
				localctx = new IfStatementContext(this, localctx);
				this.enterOuterAlt(localctx, 5);
				{
				this.state = 193;
				this.match(HazeParser.T__17);
				this.state = 194;
				this.ifexpr();
				this.state = 195;
				this.match(HazeParser.T__4);
				this.state = 196;
				this.thenblock();
				this.state = 197;
				this.match(HazeParser.T__5);
				this.state = 207;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 16, this._ctx);
				while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
					if (_alt === 1) {
						{
						{
						this.state = 198;
						this.match(HazeParser.T__18);
						this.state = 199;
						this.match(HazeParser.T__17);
						this.state = 200;
						this.elseifexpr();
						this.state = 201;
						this.match(HazeParser.T__4);
						this.state = 202;
						this.elseifblock();
						this.state = 203;
						this.match(HazeParser.T__5);
						}
						}
					}
					this.state = 209;
					this._errHandler.sync(this);
					_alt = this._interp.adaptivePredict(this._input, 16, this._ctx);
				}
				this.state = 215;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===19) {
					{
					this.state = 210;
					this.match(HazeParser.T__18);
					this.state = 211;
					this.match(HazeParser.T__4);
					this.state = 212;
					this.elseblock();
					this.state = 213;
					this.match(HazeParser.T__5);
					}
				}

				}
				break;
			case 20:
				localctx = new WhileStatementContext(this, localctx);
				this.enterOuterAlt(localctx, 6);
				{
				this.state = 217;
				this.match(HazeParser.T__19);
				this.state = 218;
				this.expr(0);
				this.state = 219;
				this.match(HazeParser.T__4);
				this.state = 220;
				this.body();
				this.state = 221;
				this.match(HazeParser.T__5);
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public structmembervalue(): StructmembervalueContext {
		let localctx: StructmembervalueContext = new StructmembervalueContext(this, this._ctx, this.state);
		this.enterRule(localctx, 34, HazeParser.RULE_structmembervalue);
		try {
			localctx = new StructMemberValueContext(this, localctx);
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 225;
			this.match(HazeParser.T__9);
			this.state = 226;
			this.match(HazeParser.ID);
			this.state = 227;
			this.match(HazeParser.T__2);
			this.state = 228;
			this.expr(0);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}

	public expr(): ExprContext;
	public expr(_p: number): ExprContext;
	// @RuleVersion(0)
	public expr(_p?: number): ExprContext {
		if (_p === undefined) {
			_p = 0;
		}

		let _parentctx: ParserRuleContext = this._ctx;
		let _parentState: number = this.state;
		let localctx: ExprContext = new ExprContext(this, this._ctx, _parentState);
		let _prevctx: ExprContext = localctx;
		let _startState: number = 36;
		this.enterRecursionRule(localctx, 36, HazeParser.RULE_expr, _p);
		let _la: number;
		try {
			let _alt: number;
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 274;
			this._errHandler.sync(this);
			switch ( this._interp.adaptivePredict(this._input, 24, this._ctx) ) {
			case 1:
				{
				localctx = new ParenthesisExprContext(this, localctx);
				this._ctx = localctx;
				_prevctx = localctx;

				this.state = 231;
				this.match(HazeParser.T__0);
				this.state = 232;
				this.expr(0);
				this.state = 233;
				this.match(HazeParser.T__1);
				}
				break;
			case 2:
				{
				localctx = new FuncRefExprContext(this, localctx);
				this._ctx = localctx;
				_prevctx = localctx;
				this.state = 235;
				this.func();
				}
				break;
			case 3:
				{
				localctx = new ConstantExprContext(this, localctx);
				this._ctx = localctx;
				_prevctx = localctx;
				this.state = 236;
				this.constant();
				}
				break;
			case 4:
				{
				localctx = new StructInstantiationExprContext(this, localctx);
				this._ctx = localctx;
				_prevctx = localctx;
				this.state = 237;
				this.datatype();
				this.state = 238;
				this.match(HazeParser.T__4);
				this.state = 240;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===10) {
					{
					this.state = 239;
					this.structmembervalue();
					}
				}

				this.state = 246;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 20, this._ctx);
				while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
					if (_alt === 1) {
						{
						{
						this.state = 242;
						this.match(HazeParser.T__6);
						this.state = 243;
						this.structmembervalue();
						}
						}
					}
					this.state = 248;
					this._errHandler.sync(this);
					_alt = this._interp.adaptivePredict(this._input, 20, this._ctx);
				}
				this.state = 250;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===7) {
					{
					this.state = 249;
					this.match(HazeParser.T__6);
					}
				}

				this.state = 252;
				this.match(HazeParser.T__5);
				}
				break;
			case 5:
				{
				localctx = new PreIncrExprContext(this, localctx);
				this._ctx = localctx;
				_prevctx = localctx;
				this.state = 254;
				(localctx as PreIncrExprContext)._op = this._input.LT(1);
				_la = this._input.LA(1);
				if(!(_la===21 || _la===22)) {
				    (localctx as PreIncrExprContext)._op = this._errHandler.recoverInline(this);
				}
				else {
					this._errHandler.reportMatch(this);
				    this.consume();
				}
				this.state = 255;
				this.expr(11);
				}
				break;
			case 6:
				{
				localctx = new UnaryExprContext(this, localctx);
				this._ctx = localctx;
				_prevctx = localctx;
				this.state = 256;
				(localctx as UnaryExprContext)._op = this._input.LT(1);
				_la = this._input.LA(1);
				if(!(_la===23 || _la===24)) {
				    (localctx as UnaryExprContext)._op = this._errHandler.recoverInline(this);
				}
				else {
					this._errHandler.reportMatch(this);
				    this.consume();
				}
				this.state = 257;
				this.expr(10);
				}
				break;
			case 7:
				{
				localctx = new UnaryExprContext(this, localctx);
				this._ctx = localctx;
				_prevctx = localctx;
				this.state = 258;
				_la = this._input.LA(1);
				if(!(_la===25 || _la===26)) {
				this._errHandler.recoverInline(this);
				}
				else {
					this._errHandler.reportMatch(this);
				    this.consume();
				}
				this.state = 259;
				this.expr(9);
				}
				break;
			case 8:
				{
				localctx = new SymbolValueExprContext(this, localctx);
				this._ctx = localctx;
				_prevctx = localctx;
				this.state = 260;
				this.match(HazeParser.ID);
				this.state = 272;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 23, this._ctx) ) {
				case 1:
					{
					this.state = 261;
					this.match(HazeParser.T__30);
					this.state = 262;
					this.datatype();
					this.state = 267;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===7) {
						{
						{
						this.state = 263;
						this.match(HazeParser.T__6);
						this.state = 264;
						this.datatype();
						}
						}
						this.state = 269;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 270;
					this.match(HazeParser.T__31);
					}
					break;
				}
				}
				break;
			}
			this._ctx.stop = this._input.LT(-1);
			this.state = 315;
			this._errHandler.sync(this);
			_alt = this._interp.adaptivePredict(this._input, 27, this._ctx);
			while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
				if (_alt === 1) {
					if (this._parseListeners != null) {
						this.triggerExitRuleEvent();
					}
					_prevctx = localctx;
					{
					this.state = 313;
					this._errHandler.sync(this);
					switch ( this._interp.adaptivePredict(this._input, 26, this._ctx) ) {
					case 1:
						{
						localctx = new BinaryExprContext(this, new ExprContext(this, _parentctx, _parentState));
						this.pushNewRecursionContext(localctx, _startState, HazeParser.RULE_expr);
						this.state = 276;
						if (!(this.precpred(this._ctx, 7))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 7)");
						}
						this.state = 277;
						_la = this._input.LA(1);
						if(!((((_la) & ~0x1F) === 0 && ((1 << _la) & 1879048192) !== 0))) {
						this._errHandler.recoverInline(this);
						}
						else {
							this._errHandler.reportMatch(this);
						    this.consume();
						}
						this.state = 278;
						this.expr(8);
						}
						break;
					case 2:
						{
						localctx = new BinaryExprContext(this, new ExprContext(this, _parentctx, _parentState));
						this.pushNewRecursionContext(localctx, _startState, HazeParser.RULE_expr);
						this.state = 279;
						if (!(this.precpred(this._ctx, 6))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 6)");
						}
						this.state = 280;
						_la = this._input.LA(1);
						if(!(_la===23 || _la===24)) {
						this._errHandler.recoverInline(this);
						}
						else {
							this._errHandler.reportMatch(this);
						    this.consume();
						}
						this.state = 281;
						this.expr(7);
						}
						break;
					case 3:
						{
						localctx = new BinaryExprContext(this, new ExprContext(this, _parentctx, _parentState));
						this.pushNewRecursionContext(localctx, _startState, HazeParser.RULE_expr);
						this.state = 282;
						if (!(this.precpred(this._ctx, 5))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 5)");
						}
						this.state = 283;
						_la = this._input.LA(1);
						if(!(((((_la - 31)) & ~0x1F) === 0 && ((1 << (_la - 31)) & 15) !== 0))) {
						this._errHandler.recoverInline(this);
						}
						else {
							this._errHandler.reportMatch(this);
						    this.consume();
						}
						this.state = 284;
						this.expr(6);
						}
						break;
					case 4:
						{
						localctx = new BinaryExprContext(this, new ExprContext(this, _parentctx, _parentState));
						this.pushNewRecursionContext(localctx, _startState, HazeParser.RULE_expr);
						this.state = 285;
						if (!(this.precpred(this._ctx, 4))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 4)");
						}
						this.state = 291;
						this._errHandler.sync(this);
						switch ( this._interp.adaptivePredict(this._input, 25, this._ctx) ) {
						case 1:
							{
							this.state = 286;
							this.match(HazeParser.T__34);
							}
							break;
						case 2:
							{
							this.state = 287;
							this.match(HazeParser.T__35);
							}
							break;
						case 3:
							{
							this.state = 288;
							this.match(HazeParser.T__36);
							}
							break;
						case 4:
							{
							{
							this.state = 289;
							this.match(HazeParser.T__36);
							this.state = 290;
							this.match(HazeParser.T__24);
							}
							}
							break;
						}
						this.state = 293;
						this.expr(5);
						}
						break;
					case 5:
						{
						localctx = new BinaryExprContext(this, new ExprContext(this, _parentctx, _parentState));
						this.pushNewRecursionContext(localctx, _startState, HazeParser.RULE_expr);
						this.state = 294;
						if (!(this.precpred(this._ctx, 3))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 3)");
						}
						this.state = 295;
						_la = this._input.LA(1);
						if(!(_la===38 || _la===39)) {
						this._errHandler.recoverInline(this);
						}
						else {
							this._errHandler.reportMatch(this);
						    this.consume();
						}
						this.state = 296;
						this.expr(4);
						}
						break;
					case 6:
						{
						localctx = new ExprAssignmentExprContext(this, new ExprContext(this, _parentctx, _parentState));
						this.pushNewRecursionContext(localctx, _startState, HazeParser.RULE_expr);
						this.state = 297;
						if (!(this.precpred(this._ctx, 2))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 2)");
						}
						this.state = 298;
						(localctx as ExprAssignmentExprContext)._op = this._input.LT(1);
						_la = this._input.LA(1);
						if(!(_la===17 || ((((_la - 40)) & ~0x1F) === 0 && ((1 << (_la - 40)) & 1023) !== 0))) {
						    (localctx as ExprAssignmentExprContext)._op = this._errHandler.recoverInline(this);
						}
						else {
							this._errHandler.reportMatch(this);
						    this.consume();
						}
						this.state = 299;
						this.expr(3);
						}
						break;
					case 7:
						{
						localctx = new PostIncrExprContext(this, new ExprContext(this, _parentctx, _parentState));
						this.pushNewRecursionContext(localctx, _startState, HazeParser.RULE_expr);
						this.state = 300;
						if (!(this.precpred(this._ctx, 15))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 15)");
						}
						this.state = 301;
						(localctx as PostIncrExprContext)._op = this._input.LT(1);
						_la = this._input.LA(1);
						if(!(_la===21 || _la===22)) {
						    (localctx as PostIncrExprContext)._op = this._errHandler.recoverInline(this);
						}
						else {
							this._errHandler.reportMatch(this);
						    this.consume();
						}
						}
						break;
					case 8:
						{
						localctx = new ExprCallExprContext(this, new ExprContext(this, _parentctx, _parentState));
						this.pushNewRecursionContext(localctx, _startState, HazeParser.RULE_expr);
						this.state = 302;
						if (!(this.precpred(this._ctx, 14))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 14)");
						}
						this.state = 303;
						this.match(HazeParser.T__0);
						this.state = 304;
						this.args();
						this.state = 305;
						this.match(HazeParser.T__1);
						}
						break;
					case 9:
						{
						localctx = new ExprMemberAccessContext(this, new ExprContext(this, _parentctx, _parentState));
						this.pushNewRecursionContext(localctx, _startState, HazeParser.RULE_expr);
						this.state = 307;
						if (!(this.precpred(this._ctx, 13))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 13)");
						}
						this.state = 308;
						this.match(HazeParser.T__9);
						this.state = 309;
						this.match(HazeParser.ID);
						}
						break;
					case 10:
						{
						localctx = new ExplicitCastExprContext(this, new ExprContext(this, _parentctx, _parentState));
						this.pushNewRecursionContext(localctx, _startState, HazeParser.RULE_expr);
						this.state = 310;
						if (!(this.precpred(this._ctx, 8))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 8)");
						}
						this.state = 311;
						this.match(HazeParser.T__26);
						this.state = 312;
						this.datatype();
						}
						break;
					}
					}
				}
				this.state = 317;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 27, this._ctx);
			}
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.unrollRecursionContexts(_parentctx);
		}
		return localctx;
	}
	// @RuleVersion(0)
	public args(): ArgsContext {
		let localctx: ArgsContext = new ArgsContext(this, this._ctx, this.state);
		this.enterRule(localctx, 38, HazeParser.RULE_args);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 326;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if ((((_la) & ~0x1F) === 0 && ((1 << _la) & 132120578) !== 0) || ((((_la - 51)) & ~0x1F) === 0 && ((1 << (_la - 51)) & 483) !== 0)) {
				{
				this.state = 318;
				this.expr(0);
				this.state = 323;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===7) {
					{
					{
					this.state = 319;
					this.match(HazeParser.T__6);
					this.state = 320;
					this.expr(0);
					}
					}
					this.state = 325;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				}
			}

			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public ellipsis(): EllipsisContext {
		let localctx: EllipsisContext = new EllipsisContext(this, this._ctx, this.state);
		this.enterRule(localctx, 40, HazeParser.RULE_ellipsis);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 328;
			this.match(HazeParser.T__49);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public functype(): FunctypeContext {
		let localctx: FunctypeContext = new FunctypeContext(this, this._ctx, this.state);
		this.enterRule(localctx, 42, HazeParser.RULE_functype);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 330;
			this.match(HazeParser.T__0);
			this.state = 331;
			this.params();
			this.state = 332;
			this.match(HazeParser.T__1);
			this.state = 333;
			this.match(HazeParser.T__3);
			this.state = 334;
			this.datatype();
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public constant(): ConstantContext {
		let localctx: ConstantContext = new ConstantContext(this, this._ctx, this.state);
		this.enterRule(localctx, 44, HazeParser.RULE_constant);
		let _la: number;
		try {
			this.state = 340;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 51:
			case 52:
				localctx = new BooleanConstantContext(this, localctx);
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 336;
				_la = this._input.LA(1);
				if(!(_la===51 || _la===52)) {
				this._errHandler.recoverInline(this);
				}
				else {
					this._errHandler.reportMatch(this);
				    this.consume();
				}
				}
				break;
			case 57:
				localctx = new LiteralConstantContext(this, localctx);
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 337;
				this.match(HazeParser.UNIT_LITERAL);
				}
				break;
			case 58:
				localctx = new LiteralConstantContext(this, localctx);
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 338;
				this.match(HazeParser.NUMBER_LITERAL);
				}
				break;
			case 56:
				localctx = new StringConstantContext(this, localctx);
				this.enterOuterAlt(localctx, 4);
				{
				this.state = 339;
				this.match(HazeParser.STRING_LITERAL);
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public compilationhint(): CompilationhintContext {
		let localctx: CompilationhintContext = new CompilationhintContext(this, this._ctx, this.state);
		this.enterRule(localctx, 46, HazeParser.RULE_compilationhint);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 342;
			this.match(HazeParser.T__52);
			this.state = 343;
			this.compilationlang();
			this.state = 344;
			this.compilationhintfilename();
			this.state = 346;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===56) {
				{
				this.state = 345;
				this.compilationhintflags();
				}
			}

			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public compilationhintfilename(): CompilationhintfilenameContext {
		let localctx: CompilationhintfilenameContext = new CompilationhintfilenameContext(this, this._ctx, this.state);
		this.enterRule(localctx, 48, HazeParser.RULE_compilationhintfilename);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 348;
			this.match(HazeParser.STRING_LITERAL);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public compilationhintflags(): CompilationhintflagsContext {
		let localctx: CompilationhintflagsContext = new CompilationhintflagsContext(this, this._ctx, this.state);
		this.enterRule(localctx, 50, HazeParser.RULE_compilationhintflags);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 350;
			this.match(HazeParser.STRING_LITERAL);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public compilationlang(): CompilationlangContext {
		let localctx: CompilationlangContext = new CompilationlangContext(this, this._ctx, this.state);
		this.enterRule(localctx, 52, HazeParser.RULE_compilationlang);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 352;
			_la = this._input.LA(1);
			if(!(_la===11 || _la===12)) {
			this._errHandler.recoverInline(this);
			}
			else {
				this._errHandler.reportMatch(this);
			    this.consume();
			}
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public linkerhint(): LinkerhintContext {
		let localctx: LinkerhintContext = new LinkerhintContext(this, this._ctx, this.state);
		this.enterRule(localctx, 54, HazeParser.RULE_linkerhint);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 354;
			this.match(HazeParser.T__53);
			this.state = 355;
			this.match(HazeParser.STRING_LITERAL);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public structcontent(): StructcontentContext {
		let localctx: StructcontentContext = new StructcontentContext(this, this._ctx, this.state);
		this.enterRule(localctx, 56, HazeParser.RULE_structcontent);
		let _la: number;
		try {
			this.state = 372;
			this._errHandler.sync(this);
			switch ( this._interp.adaptivePredict(this._input, 33, this._ctx) ) {
			case 1:
				localctx = new StructMemberContext(this, localctx);
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 357;
				this.match(HazeParser.ID);
				this.state = 358;
				this.match(HazeParser.T__2);
				this.state = 359;
				this.datatype();
				this.state = 360;
				this.match(HazeParser.T__8);
				}
				break;
			case 2:
				localctx = new StructMethodContext(this, localctx);
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 362;
				this.match(HazeParser.ID);
				this.state = 363;
				this.match(HazeParser.T__0);
				this.state = 364;
				this.params();
				this.state = 365;
				this.match(HazeParser.T__1);
				this.state = 368;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===3) {
					{
					this.state = 366;
					this.match(HazeParser.T__2);
					this.state = 367;
					this.datatype();
					}
				}

				this.state = 370;
				this.funcbody();
				}
				break;
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public structdecl(): StructdeclContext {
		let localctx: StructdeclContext = new StructdeclContext(this, this._ctx, this.state);
		this.enterRule(localctx, 58, HazeParser.RULE_structdecl);
		let _la: number;
		try {
			localctx = new StructDeclContext(this, localctx);
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 376;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===8) {
				{
				this.state = 374;
				this.match(HazeParser.T__7);
				this.state = 375;
				this.externlang();
				}
			}

			this.state = 378;
			this.match(HazeParser.T__54);
			this.state = 379;
			this.match(HazeParser.ID);
			this.state = 390;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===31) {
				{
				this.state = 380;
				this.match(HazeParser.T__30);
				this.state = 381;
				this.match(HazeParser.ID);
				this.state = 386;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===7) {
					{
					{
					this.state = 382;
					this.match(HazeParser.T__6);
					this.state = 383;
					this.match(HazeParser.ID);
					}
					}
					this.state = 388;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 389;
				this.match(HazeParser.T__31);
				}
			}

			this.state = 392;
			this.match(HazeParser.T__4);
			this.state = 396;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===59) {
				{
				{
				this.state = 393;
				this.structcontent();
				}
				}
				this.state = 398;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 399;
			this.match(HazeParser.T__5);
			this.state = 401;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===9) {
				{
				this.state = 400;
				this.match(HazeParser.T__8);
				}
			}

			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public datatype(): DatatypeContext {
		let localctx: DatatypeContext = new DatatypeContext(this, this._ctx, this.state);
		this.enterRule(localctx, 60, HazeParser.RULE_datatype);
		let _la: number;
		try {
			this.state = 418;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 59:
				localctx = new CommonDatatypeContext(this, localctx);
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 403;
				this.match(HazeParser.ID);
				this.state = 415;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 40, this._ctx) ) {
				case 1:
					{
					this.state = 404;
					this.match(HazeParser.T__30);
					this.state = 405;
					this.datatype();
					this.state = 410;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===7) {
						{
						{
						this.state = 406;
						this.match(HazeParser.T__6);
						this.state = 407;
						this.datatype();
						}
						}
						this.state = 412;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 413;
					this.match(HazeParser.T__31);
					}
					break;
				}
				}
				break;
			case 1:
				localctx = new FunctionDatatypeContext(this, localctx);
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 417;
				this.functype();
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}

	public sempred(localctx: RuleContext, ruleIndex: number, predIndex: number): boolean {
		switch (ruleIndex) {
		case 18:
			return this.expr_sempred(localctx as ExprContext, predIndex);
		}
		return true;
	}
	private expr_sempred(localctx: ExprContext, predIndex: number): boolean {
		switch (predIndex) {
		case 0:
			return this.precpred(this._ctx, 7);
		case 1:
			return this.precpred(this._ctx, 6);
		case 2:
			return this.precpred(this._ctx, 5);
		case 3:
			return this.precpred(this._ctx, 4);
		case 4:
			return this.precpred(this._ctx, 3);
		case 5:
			return this.precpred(this._ctx, 2);
		case 6:
			return this.precpred(this._ctx, 15);
		case 7:
			return this.precpred(this._ctx, 14);
		case 8:
			return this.precpred(this._ctx, 13);
		case 9:
			return this.precpred(this._ctx, 8);
		}
		return true;
	}

	public static readonly _serializedATN: number[] = [4,1,61,421,2,0,7,0,2,
	1,7,1,2,2,7,2,2,3,7,3,2,4,7,4,2,5,7,5,2,6,7,6,2,7,7,7,2,8,7,8,2,9,7,9,2,
	10,7,10,2,11,7,11,2,12,7,12,2,13,7,13,2,14,7,14,2,15,7,15,2,16,7,16,2,17,
	7,17,2,18,7,18,2,19,7,19,2,20,7,20,2,21,7,21,2,22,7,22,2,23,7,23,2,24,7,
	24,2,25,7,25,2,26,7,26,2,27,7,27,2,28,7,28,2,29,7,29,2,30,7,30,1,0,1,0,
	1,0,1,0,1,0,1,0,5,0,69,8,0,10,0,12,0,72,9,0,1,1,1,1,1,1,1,1,1,1,1,1,3,1,
	80,8,1,1,1,1,1,1,2,1,2,1,2,1,2,1,2,3,2,89,8,2,1,2,1,2,1,3,3,3,94,8,3,1,
	3,1,3,1,3,1,3,1,3,1,3,3,3,102,8,3,1,4,5,4,105,8,4,10,4,12,4,108,9,4,1,5,
	1,5,1,5,1,5,1,6,1,6,1,6,5,6,117,8,6,10,6,12,6,120,9,6,1,6,1,6,3,6,124,8,
	6,3,6,126,8,6,1,6,3,6,129,8,6,1,7,1,7,1,7,1,7,1,7,1,8,1,8,3,8,138,8,8,1,
	8,1,8,5,8,142,8,8,10,8,12,8,145,9,8,1,8,1,8,1,8,1,8,1,8,1,8,3,8,153,8,8,
	1,8,1,8,1,9,1,9,1,10,1,10,1,11,1,11,1,12,1,12,1,13,1,13,1,14,1,14,1,15,
	1,15,1,16,1,16,1,16,1,16,1,16,1,16,1,16,1,16,1,16,1,16,3,16,181,8,16,1,
	16,1,16,1,16,1,16,1,16,3,16,188,8,16,1,16,1,16,1,16,1,16,1,16,1,16,1,16,
	1,16,1,16,1,16,1,16,1,16,1,16,1,16,1,16,1,16,5,16,206,8,16,10,16,12,16,
	209,9,16,1,16,1,16,1,16,1,16,1,16,3,16,216,8,16,1,16,1,16,1,16,1,16,1,16,
	1,16,3,16,224,8,16,1,17,1,17,1,17,1,17,1,17,1,18,1,18,1,18,1,18,1,18,1,
	18,1,18,1,18,1,18,1,18,3,18,241,8,18,1,18,1,18,5,18,245,8,18,10,18,12,18,
	248,9,18,1,18,3,18,251,8,18,1,18,1,18,1,18,1,18,1,18,1,18,1,18,1,18,1,18,
	1,18,1,18,1,18,1,18,5,18,266,8,18,10,18,12,18,269,9,18,1,18,1,18,3,18,273,
	8,18,3,18,275,8,18,1,18,1,18,1,18,1,18,1,18,1,18,1,18,1,18,1,18,1,18,1,
	18,1,18,1,18,1,18,1,18,3,18,292,8,18,1,18,1,18,1,18,1,18,1,18,1,18,1,18,
	1,18,1,18,1,18,1,18,1,18,1,18,1,18,1,18,1,18,1,18,1,18,1,18,1,18,5,18,314,
	8,18,10,18,12,18,317,9,18,1,19,1,19,1,19,5,19,322,8,19,10,19,12,19,325,
	9,19,3,19,327,8,19,1,20,1,20,1,21,1,21,1,21,1,21,1,21,1,21,1,22,1,22,1,
	22,1,22,3,22,341,8,22,1,23,1,23,1,23,1,23,3,23,347,8,23,1,24,1,24,1,25,
	1,25,1,26,1,26,1,27,1,27,1,27,1,28,1,28,1,28,1,28,1,28,1,28,1,28,1,28,1,
	28,1,28,1,28,3,28,369,8,28,1,28,1,28,3,28,373,8,28,1,29,1,29,3,29,377,8,
	29,1,29,1,29,1,29,1,29,1,29,1,29,5,29,385,8,29,10,29,12,29,388,9,29,1,29,
	3,29,391,8,29,1,29,1,29,5,29,395,8,29,10,29,12,29,398,9,29,1,29,1,29,3,
	29,402,8,29,1,30,1,30,1,30,1,30,1,30,5,30,409,8,30,10,30,12,30,412,9,30,
	1,30,1,30,3,30,416,8,30,1,30,3,30,419,8,30,1,30,0,1,36,31,0,2,4,6,8,10,
	12,14,16,18,20,22,24,26,28,30,32,34,36,38,40,42,44,46,48,50,52,54,56,58,
	60,0,10,1,0,11,12,1,0,13,14,1,0,21,22,1,0,23,24,1,0,25,26,1,0,28,30,1,0,
	31,34,1,0,38,39,2,0,17,17,40,49,1,0,51,52,457,0,70,1,0,0,0,2,73,1,0,0,0,
	4,83,1,0,0,0,6,101,1,0,0,0,8,106,1,0,0,0,10,109,1,0,0,0,12,128,1,0,0,0,
	14,130,1,0,0,0,16,135,1,0,0,0,18,156,1,0,0,0,20,158,1,0,0,0,22,160,1,0,
	0,0,24,162,1,0,0,0,26,164,1,0,0,0,28,166,1,0,0,0,30,168,1,0,0,0,32,223,
	1,0,0,0,34,225,1,0,0,0,36,274,1,0,0,0,38,326,1,0,0,0,40,328,1,0,0,0,42,
	330,1,0,0,0,44,340,1,0,0,0,46,342,1,0,0,0,48,348,1,0,0,0,50,350,1,0,0,0,
	52,352,1,0,0,0,54,354,1,0,0,0,56,372,1,0,0,0,58,376,1,0,0,0,60,418,1,0,
	0,0,62,69,3,14,7,0,63,69,3,2,1,0,64,69,3,16,8,0,65,69,3,46,23,0,66,69,3,
	54,27,0,67,69,3,58,29,0,68,62,1,0,0,0,68,63,1,0,0,0,68,64,1,0,0,0,68,65,
	1,0,0,0,68,66,1,0,0,0,68,67,1,0,0,0,69,72,1,0,0,0,70,68,1,0,0,0,70,71,1,
	0,0,0,71,1,1,0,0,0,72,70,1,0,0,0,73,74,5,59,0,0,74,75,5,1,0,0,75,76,3,12,
	6,0,76,79,5,2,0,0,77,78,5,3,0,0,78,80,3,60,30,0,79,77,1,0,0,0,79,80,1,0,
	0,0,80,81,1,0,0,0,81,82,3,6,3,0,82,3,1,0,0,0,83,84,5,1,0,0,84,85,3,12,6,
	0,85,88,5,2,0,0,86,87,5,3,0,0,87,89,3,60,30,0,88,86,1,0,0,0,88,89,1,0,0,
	0,89,90,1,0,0,0,90,91,3,6,3,0,91,5,1,0,0,0,92,94,5,4,0,0,93,92,1,0,0,0,
	93,94,1,0,0,0,94,95,1,0,0,0,95,96,5,5,0,0,96,97,3,8,4,0,97,98,5,6,0,0,98,
	102,1,0,0,0,99,100,5,4,0,0,100,102,3,36,18,0,101,93,1,0,0,0,101,99,1,0,
	0,0,102,7,1,0,0,0,103,105,3,32,16,0,104,103,1,0,0,0,105,108,1,0,0,0,106,
	104,1,0,0,0,106,107,1,0,0,0,107,9,1,0,0,0,108,106,1,0,0,0,109,110,5,59,
	0,0,110,111,5,3,0,0,111,112,3,60,30,0,112,11,1,0,0,0,113,118,3,10,5,0,114,
	115,5,7,0,0,115,117,3,10,5,0,116,114,1,0,0,0,117,120,1,0,0,0,118,116,1,
	0,0,0,118,119,1,0,0,0,119,123,1,0,0,0,120,118,1,0,0,0,121,122,5,7,0,0,122,
	124,3,40,20,0,123,121,1,0,0,0,123,124,1,0,0,0,124,126,1,0,0,0,125,113,1,
	0,0,0,125,126,1,0,0,0,126,129,1,0,0,0,127,129,3,40,20,0,128,125,1,0,0,0,
	128,127,1,0,0,0,129,13,1,0,0,0,130,131,5,8,0,0,131,132,3,18,9,0,132,133,
	5,56,0,0,133,134,5,9,0,0,134,15,1,0,0,0,135,137,5,8,0,0,136,138,3,18,9,
	0,137,136,1,0,0,0,137,138,1,0,0,0,138,143,1,0,0,0,139,140,5,59,0,0,140,
	142,5,10,0,0,141,139,1,0,0,0,142,145,1,0,0,0,143,141,1,0,0,0,143,144,1,
	0,0,0,144,146,1,0,0,0,145,143,1,0,0,0,146,147,5,59,0,0,147,148,5,1,0,0,
	148,149,3,12,6,0,149,152,5,2,0,0,150,151,5,3,0,0,151,153,3,60,30,0,152,
	150,1,0,0,0,152,153,1,0,0,0,153,154,1,0,0,0,154,155,5,9,0,0,155,17,1,0,
	0,0,156,157,7,0,0,0,157,19,1,0,0,0,158,159,3,36,18,0,159,21,1,0,0,0,160,
	161,3,36,18,0,161,23,1,0,0,0,162,163,3,8,4,0,163,25,1,0,0,0,164,165,3,8,
	4,0,165,27,1,0,0,0,166,167,3,8,4,0,167,29,1,0,0,0,168,169,7,1,0,0,169,31,
	1,0,0,0,170,171,5,15,0,0,171,172,5,1,0,0,172,173,5,56,0,0,173,174,5,2,0,
	0,174,224,5,9,0,0,175,176,3,36,18,0,176,177,5,9,0,0,177,224,1,0,0,0,178,
	180,5,16,0,0,179,181,3,36,18,0,180,179,1,0,0,0,180,181,1,0,0,0,181,182,
	1,0,0,0,182,224,5,9,0,0,183,184,3,30,15,0,184,187,5,59,0,0,185,186,5,3,
	0,0,186,188,3,60,30,0,187,185,1,0,0,0,187,188,1,0,0,0,188,189,1,0,0,0,189,
	190,5,17,0,0,190,191,3,36,18,0,191,192,5,9,0,0,192,224,1,0,0,0,193,194,
	5,18,0,0,194,195,3,20,10,0,195,196,5,5,0,0,196,197,3,24,12,0,197,207,5,
	6,0,0,198,199,5,19,0,0,199,200,5,18,0,0,200,201,3,22,11,0,201,202,5,5,0,
	0,202,203,3,26,13,0,203,204,5,6,0,0,204,206,1,0,0,0,205,198,1,0,0,0,206,
	209,1,0,0,0,207,205,1,0,0,0,207,208,1,0,0,0,208,215,1,0,0,0,209,207,1,0,
	0,0,210,211,5,19,0,0,211,212,5,5,0,0,212,213,3,28,14,0,213,214,5,6,0,0,
	214,216,1,0,0,0,215,210,1,0,0,0,215,216,1,0,0,0,216,224,1,0,0,0,217,218,
	5,20,0,0,218,219,3,36,18,0,219,220,5,5,0,0,220,221,3,8,4,0,221,222,5,6,
	0,0,222,224,1,0,0,0,223,170,1,0,0,0,223,175,1,0,0,0,223,178,1,0,0,0,223,
	183,1,0,0,0,223,193,1,0,0,0,223,217,1,0,0,0,224,33,1,0,0,0,225,226,5,10,
	0,0,226,227,5,59,0,0,227,228,5,3,0,0,228,229,3,36,18,0,229,35,1,0,0,0,230,
	231,6,18,-1,0,231,232,5,1,0,0,232,233,3,36,18,0,233,234,5,2,0,0,234,275,
	1,0,0,0,235,275,3,4,2,0,236,275,3,44,22,0,237,238,3,60,30,0,238,240,5,5,
	0,0,239,241,3,34,17,0,240,239,1,0,0,0,240,241,1,0,0,0,241,246,1,0,0,0,242,
	243,5,7,0,0,243,245,3,34,17,0,244,242,1,0,0,0,245,248,1,0,0,0,246,244,1,
	0,0,0,246,247,1,0,0,0,247,250,1,0,0,0,248,246,1,0,0,0,249,251,5,7,0,0,250,
	249,1,0,0,0,250,251,1,0,0,0,251,252,1,0,0,0,252,253,5,6,0,0,253,275,1,0,
	0,0,254,255,7,2,0,0,255,275,3,36,18,11,256,257,7,3,0,0,257,275,3,36,18,
	10,258,259,7,4,0,0,259,275,3,36,18,9,260,272,5,59,0,0,261,262,5,31,0,0,
	262,267,3,60,30,0,263,264,5,7,0,0,264,266,3,60,30,0,265,263,1,0,0,0,266,
	269,1,0,0,0,267,265,1,0,0,0,267,268,1,0,0,0,268,270,1,0,0,0,269,267,1,0,
	0,0,270,271,5,32,0,0,271,273,1,0,0,0,272,261,1,0,0,0,272,273,1,0,0,0,273,
	275,1,0,0,0,274,230,1,0,0,0,274,235,1,0,0,0,274,236,1,0,0,0,274,237,1,0,
	0,0,274,254,1,0,0,0,274,256,1,0,0,0,274,258,1,0,0,0,274,260,1,0,0,0,275,
	315,1,0,0,0,276,277,10,7,0,0,277,278,7,5,0,0,278,314,3,36,18,8,279,280,
	10,6,0,0,280,281,7,3,0,0,281,314,3,36,18,7,282,283,10,5,0,0,283,284,7,6,
	0,0,284,314,3,36,18,6,285,291,10,4,0,0,286,292,5,35,0,0,287,292,5,36,0,
	0,288,292,5,37,0,0,289,290,5,37,0,0,290,292,5,25,0,0,291,286,1,0,0,0,291,
	287,1,0,0,0,291,288,1,0,0,0,291,289,1,0,0,0,292,293,1,0,0,0,293,314,3,36,
	18,5,294,295,10,3,0,0,295,296,7,7,0,0,296,314,3,36,18,4,297,298,10,2,0,
	0,298,299,7,8,0,0,299,314,3,36,18,3,300,301,10,15,0,0,301,314,7,2,0,0,302,
	303,10,14,0,0,303,304,5,1,0,0,304,305,3,38,19,0,305,306,5,2,0,0,306,314,
	1,0,0,0,307,308,10,13,0,0,308,309,5,10,0,0,309,314,5,59,0,0,310,311,10,
	8,0,0,311,312,5,27,0,0,312,314,3,60,30,0,313,276,1,0,0,0,313,279,1,0,0,
	0,313,282,1,0,0,0,313,285,1,0,0,0,313,294,1,0,0,0,313,297,1,0,0,0,313,300,
	1,0,0,0,313,302,1,0,0,0,313,307,1,0,0,0,313,310,1,0,0,0,314,317,1,0,0,0,
	315,313,1,0,0,0,315,316,1,0,0,0,316,37,1,0,0,0,317,315,1,0,0,0,318,323,
	3,36,18,0,319,320,5,7,0,0,320,322,3,36,18,0,321,319,1,0,0,0,322,325,1,0,
	0,0,323,321,1,0,0,0,323,324,1,0,0,0,324,327,1,0,0,0,325,323,1,0,0,0,326,
	318,1,0,0,0,326,327,1,0,0,0,327,39,1,0,0,0,328,329,5,50,0,0,329,41,1,0,
	0,0,330,331,5,1,0,0,331,332,3,12,6,0,332,333,5,2,0,0,333,334,5,4,0,0,334,
	335,3,60,30,0,335,43,1,0,0,0,336,341,7,9,0,0,337,341,5,57,0,0,338,341,5,
	58,0,0,339,341,5,56,0,0,340,336,1,0,0,0,340,337,1,0,0,0,340,338,1,0,0,0,
	340,339,1,0,0,0,341,45,1,0,0,0,342,343,5,53,0,0,343,344,3,52,26,0,344,346,
	3,48,24,0,345,347,3,50,25,0,346,345,1,0,0,0,346,347,1,0,0,0,347,47,1,0,
	0,0,348,349,5,56,0,0,349,49,1,0,0,0,350,351,5,56,0,0,351,51,1,0,0,0,352,
	353,7,0,0,0,353,53,1,0,0,0,354,355,5,54,0,0,355,356,5,56,0,0,356,55,1,0,
	0,0,357,358,5,59,0,0,358,359,5,3,0,0,359,360,3,60,30,0,360,361,5,9,0,0,
	361,373,1,0,0,0,362,363,5,59,0,0,363,364,5,1,0,0,364,365,3,12,6,0,365,368,
	5,2,0,0,366,367,5,3,0,0,367,369,3,60,30,0,368,366,1,0,0,0,368,369,1,0,0,
	0,369,370,1,0,0,0,370,371,3,6,3,0,371,373,1,0,0,0,372,357,1,0,0,0,372,362,
	1,0,0,0,373,57,1,0,0,0,374,375,5,8,0,0,375,377,3,18,9,0,376,374,1,0,0,0,
	376,377,1,0,0,0,377,378,1,0,0,0,378,379,5,55,0,0,379,390,5,59,0,0,380,381,
	5,31,0,0,381,386,5,59,0,0,382,383,5,7,0,0,383,385,5,59,0,0,384,382,1,0,
	0,0,385,388,1,0,0,0,386,384,1,0,0,0,386,387,1,0,0,0,387,389,1,0,0,0,388,
	386,1,0,0,0,389,391,5,32,0,0,390,380,1,0,0,0,390,391,1,0,0,0,391,392,1,
	0,0,0,392,396,5,5,0,0,393,395,3,56,28,0,394,393,1,0,0,0,395,398,1,0,0,0,
	396,394,1,0,0,0,396,397,1,0,0,0,397,399,1,0,0,0,398,396,1,0,0,0,399,401,
	5,6,0,0,400,402,5,9,0,0,401,400,1,0,0,0,401,402,1,0,0,0,402,59,1,0,0,0,
	403,415,5,59,0,0,404,405,5,31,0,0,405,410,3,60,30,0,406,407,5,7,0,0,407,
	409,3,60,30,0,408,406,1,0,0,0,409,412,1,0,0,0,410,408,1,0,0,0,410,411,1,
	0,0,0,411,413,1,0,0,0,412,410,1,0,0,0,413,414,5,32,0,0,414,416,1,0,0,0,
	415,404,1,0,0,0,415,416,1,0,0,0,416,419,1,0,0,0,417,419,3,42,21,0,418,403,
	1,0,0,0,418,417,1,0,0,0,419,61,1,0,0,0,42,68,70,79,88,93,101,106,118,123,
	125,128,137,143,152,180,187,207,215,223,240,246,250,267,272,274,291,313,
	315,323,326,340,346,368,372,376,386,390,396,401,410,415,418];

	private static __ATN: ATN;
	public static get _ATN(): ATN {
		if (!HazeParser.__ATN) {
			HazeParser.__ATN = new ATNDeserializer().deserialize(HazeParser._serializedATN);
		}

		return HazeParser.__ATN;
	}


	static DecisionsToDFA = HazeParser._ATN.decisionToState.map( (ds: DecisionState, index: number) => new DFA(ds, index) );

}

export class ProgContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public cdefinitiondecl_list(): CdefinitiondeclContext[] {
		return this.getTypedRuleContexts(CdefinitiondeclContext) as CdefinitiondeclContext[];
	}
	public cdefinitiondecl(i: number): CdefinitiondeclContext {
		return this.getTypedRuleContext(CdefinitiondeclContext, i) as CdefinitiondeclContext;
	}
	public namedfunc_list(): NamedfuncContext[] {
		return this.getTypedRuleContexts(NamedfuncContext) as NamedfuncContext[];
	}
	public namedfunc(i: number): NamedfuncContext {
		return this.getTypedRuleContext(NamedfuncContext, i) as NamedfuncContext;
	}
	public funcdecl_list(): FuncdeclContext[] {
		return this.getTypedRuleContexts(FuncdeclContext) as FuncdeclContext[];
	}
	public funcdecl(i: number): FuncdeclContext {
		return this.getTypedRuleContext(FuncdeclContext, i) as FuncdeclContext;
	}
	public compilationhint_list(): CompilationhintContext[] {
		return this.getTypedRuleContexts(CompilationhintContext) as CompilationhintContext[];
	}
	public compilationhint(i: number): CompilationhintContext {
		return this.getTypedRuleContext(CompilationhintContext, i) as CompilationhintContext;
	}
	public linkerhint_list(): LinkerhintContext[] {
		return this.getTypedRuleContexts(LinkerhintContext) as LinkerhintContext[];
	}
	public linkerhint(i: number): LinkerhintContext {
		return this.getTypedRuleContext(LinkerhintContext, i) as LinkerhintContext;
	}
	public structdecl_list(): StructdeclContext[] {
		return this.getTypedRuleContexts(StructdeclContext) as StructdeclContext[];
	}
	public structdecl(i: number): StructdeclContext {
		return this.getTypedRuleContext(StructdeclContext, i) as StructdeclContext;
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_prog;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterProg) {
	 		listener.enterProg(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitProg) {
	 		listener.exitProg(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitProg) {
			return visitor.visitProg(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class NamedfuncContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public ID(): TerminalNode {
		return this.getToken(HazeParser.ID, 0);
	}
	public params(): ParamsContext {
		return this.getTypedRuleContext(ParamsContext, 0) as ParamsContext;
	}
	public funcbody(): FuncbodyContext {
		return this.getTypedRuleContext(FuncbodyContext, 0) as FuncbodyContext;
	}
	public datatype(): DatatypeContext {
		return this.getTypedRuleContext(DatatypeContext, 0) as DatatypeContext;
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_namedfunc;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterNamedfunc) {
	 		listener.enterNamedfunc(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitNamedfunc) {
	 		listener.exitNamedfunc(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitNamedfunc) {
			return visitor.visitNamedfunc(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class FuncContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public params(): ParamsContext {
		return this.getTypedRuleContext(ParamsContext, 0) as ParamsContext;
	}
	public funcbody(): FuncbodyContext {
		return this.getTypedRuleContext(FuncbodyContext, 0) as FuncbodyContext;
	}
	public datatype(): DatatypeContext {
		return this.getTypedRuleContext(DatatypeContext, 0) as DatatypeContext;
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_func;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterFunc) {
	 		listener.enterFunc(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitFunc) {
	 		listener.exitFunc(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitFunc) {
			return visitor.visitFunc(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class FuncbodyContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public body(): BodyContext {
		return this.getTypedRuleContext(BodyContext, 0) as BodyContext;
	}
	public expr(): ExprContext {
		return this.getTypedRuleContext(ExprContext, 0) as ExprContext;
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_funcbody;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterFuncbody) {
	 		listener.enterFuncbody(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitFuncbody) {
	 		listener.exitFuncbody(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitFuncbody) {
			return visitor.visitFuncbody(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class BodyContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public statement_list(): StatementContext[] {
		return this.getTypedRuleContexts(StatementContext) as StatementContext[];
	}
	public statement(i: number): StatementContext {
		return this.getTypedRuleContext(StatementContext, i) as StatementContext;
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_body;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterBody) {
	 		listener.enterBody(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitBody) {
	 		listener.exitBody(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitBody) {
			return visitor.visitBody(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class ParamContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public ID(): TerminalNode {
		return this.getToken(HazeParser.ID, 0);
	}
	public datatype(): DatatypeContext {
		return this.getTypedRuleContext(DatatypeContext, 0) as DatatypeContext;
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_param;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterParam) {
	 		listener.enterParam(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitParam) {
	 		listener.exitParam(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitParam) {
			return visitor.visitParam(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class ParamsContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public param_list(): ParamContext[] {
		return this.getTypedRuleContexts(ParamContext) as ParamContext[];
	}
	public param(i: number): ParamContext {
		return this.getTypedRuleContext(ParamContext, i) as ParamContext;
	}
	public ellipsis(): EllipsisContext {
		return this.getTypedRuleContext(EllipsisContext, 0) as EllipsisContext;
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_params;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterParams) {
	 		listener.enterParams(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitParams) {
	 		listener.exitParams(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitParams) {
			return visitor.visitParams(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class CdefinitiondeclContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public STRING_LITERAL(): TerminalNode {
		return this.getToken(HazeParser.STRING_LITERAL, 0);
	}
	public externlang(): ExternlangContext {
		return this.getTypedRuleContext(ExternlangContext, 0) as ExternlangContext;
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_cdefinitiondecl;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterCdefinitiondecl) {
	 		listener.enterCdefinitiondecl(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitCdefinitiondecl) {
	 		listener.exitCdefinitiondecl(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitCdefinitiondecl) {
			return visitor.visitCdefinitiondecl(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class FuncdeclContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public ID_list(): TerminalNode[] {
	    	return this.getTokens(HazeParser.ID);
	}
	public ID(i: number): TerminalNode {
		return this.getToken(HazeParser.ID, i);
	}
	public params(): ParamsContext {
		return this.getTypedRuleContext(ParamsContext, 0) as ParamsContext;
	}
	public externlang(): ExternlangContext {
		return this.getTypedRuleContext(ExternlangContext, 0) as ExternlangContext;
	}
	public datatype(): DatatypeContext {
		return this.getTypedRuleContext(DatatypeContext, 0) as DatatypeContext;
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_funcdecl;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterFuncdecl) {
	 		listener.enterFuncdecl(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitFuncdecl) {
	 		listener.exitFuncdecl(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitFuncdecl) {
			return visitor.visitFuncdecl(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class ExternlangContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_externlang;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterExternlang) {
	 		listener.enterExternlang(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitExternlang) {
	 		listener.exitExternlang(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitExternlang) {
			return visitor.visitExternlang(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class IfexprContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public expr(): ExprContext {
		return this.getTypedRuleContext(ExprContext, 0) as ExprContext;
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_ifexpr;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterIfexpr) {
	 		listener.enterIfexpr(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitIfexpr) {
	 		listener.exitIfexpr(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitIfexpr) {
			return visitor.visitIfexpr(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class ElseifexprContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public expr(): ExprContext {
		return this.getTypedRuleContext(ExprContext, 0) as ExprContext;
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_elseifexpr;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterElseifexpr) {
	 		listener.enterElseifexpr(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitElseifexpr) {
	 		listener.exitElseifexpr(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitElseifexpr) {
			return visitor.visitElseifexpr(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class ThenblockContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public body(): BodyContext {
		return this.getTypedRuleContext(BodyContext, 0) as BodyContext;
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_thenblock;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterThenblock) {
	 		listener.enterThenblock(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitThenblock) {
	 		listener.exitThenblock(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitThenblock) {
			return visitor.visitThenblock(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class ElseifblockContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public body(): BodyContext {
		return this.getTypedRuleContext(BodyContext, 0) as BodyContext;
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_elseifblock;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterElseifblock) {
	 		listener.enterElseifblock(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitElseifblock) {
	 		listener.exitElseifblock(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitElseifblock) {
			return visitor.visitElseifblock(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class ElseblockContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public body(): BodyContext {
		return this.getTypedRuleContext(BodyContext, 0) as BodyContext;
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_elseblock;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterElseblock) {
	 		listener.enterElseblock(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitElseblock) {
	 		listener.exitElseblock(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitElseblock) {
			return visitor.visitElseblock(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class VariablemutabilityContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_variablemutability;
	}
	public override copyFrom(ctx: VariablemutabilityContext): void {
		super.copyFrom(ctx);
	}
}
export class VariableMutabilityContext extends VariablemutabilityContext {
	constructor(parser: HazeParser, ctx: VariablemutabilityContext) {
		super(parser, ctx.parentCtx, ctx.invokingState);
		super.copyFrom(ctx);
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterVariableMutability) {
	 		listener.enterVariableMutability(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitVariableMutability) {
	 		listener.exitVariableMutability(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitVariableMutability) {
			return visitor.visitVariableMutability(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class StatementContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_statement;
	}
	public override copyFrom(ctx: StatementContext): void {
		super.copyFrom(ctx);
	}
}
export class IfStatementContext extends StatementContext {
	constructor(parser: HazeParser, ctx: StatementContext) {
		super(parser, ctx.parentCtx, ctx.invokingState);
		super.copyFrom(ctx);
	}
	public ifexpr(): IfexprContext {
		return this.getTypedRuleContext(IfexprContext, 0) as IfexprContext;
	}
	public thenblock(): ThenblockContext {
		return this.getTypedRuleContext(ThenblockContext, 0) as ThenblockContext;
	}
	public elseifexpr_list(): ElseifexprContext[] {
		return this.getTypedRuleContexts(ElseifexprContext) as ElseifexprContext[];
	}
	public elseifexpr(i: number): ElseifexprContext {
		return this.getTypedRuleContext(ElseifexprContext, i) as ElseifexprContext;
	}
	public elseifblock_list(): ElseifblockContext[] {
		return this.getTypedRuleContexts(ElseifblockContext) as ElseifblockContext[];
	}
	public elseifblock(i: number): ElseifblockContext {
		return this.getTypedRuleContext(ElseifblockContext, i) as ElseifblockContext;
	}
	public elseblock(): ElseblockContext {
		return this.getTypedRuleContext(ElseblockContext, 0) as ElseblockContext;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterIfStatement) {
	 		listener.enterIfStatement(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitIfStatement) {
	 		listener.exitIfStatement(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitIfStatement) {
			return visitor.visitIfStatement(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class VariableDefinitionContext extends StatementContext {
	constructor(parser: HazeParser, ctx: StatementContext) {
		super(parser, ctx.parentCtx, ctx.invokingState);
		super.copyFrom(ctx);
	}
	public variablemutability(): VariablemutabilityContext {
		return this.getTypedRuleContext(VariablemutabilityContext, 0) as VariablemutabilityContext;
	}
	public ID(): TerminalNode {
		return this.getToken(HazeParser.ID, 0);
	}
	public expr(): ExprContext {
		return this.getTypedRuleContext(ExprContext, 0) as ExprContext;
	}
	public datatype(): DatatypeContext {
		return this.getTypedRuleContext(DatatypeContext, 0) as DatatypeContext;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterVariableDefinition) {
	 		listener.enterVariableDefinition(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitVariableDefinition) {
	 		listener.exitVariableDefinition(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitVariableDefinition) {
			return visitor.visitVariableDefinition(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class InlineCStatementContext extends StatementContext {
	constructor(parser: HazeParser, ctx: StatementContext) {
		super(parser, ctx.parentCtx, ctx.invokingState);
		super.copyFrom(ctx);
	}
	public STRING_LITERAL(): TerminalNode {
		return this.getToken(HazeParser.STRING_LITERAL, 0);
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterInlineCStatement) {
	 		listener.enterInlineCStatement(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitInlineCStatement) {
	 		listener.exitInlineCStatement(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitInlineCStatement) {
			return visitor.visitInlineCStatement(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class ExprStatementContext extends StatementContext {
	constructor(parser: HazeParser, ctx: StatementContext) {
		super(parser, ctx.parentCtx, ctx.invokingState);
		super.copyFrom(ctx);
	}
	public expr(): ExprContext {
		return this.getTypedRuleContext(ExprContext, 0) as ExprContext;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterExprStatement) {
	 		listener.enterExprStatement(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitExprStatement) {
	 		listener.exitExprStatement(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitExprStatement) {
			return visitor.visitExprStatement(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class ReturnStatementContext extends StatementContext {
	constructor(parser: HazeParser, ctx: StatementContext) {
		super(parser, ctx.parentCtx, ctx.invokingState);
		super.copyFrom(ctx);
	}
	public expr(): ExprContext {
		return this.getTypedRuleContext(ExprContext, 0) as ExprContext;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterReturnStatement) {
	 		listener.enterReturnStatement(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitReturnStatement) {
	 		listener.exitReturnStatement(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitReturnStatement) {
			return visitor.visitReturnStatement(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class WhileStatementContext extends StatementContext {
	constructor(parser: HazeParser, ctx: StatementContext) {
		super(parser, ctx.parentCtx, ctx.invokingState);
		super.copyFrom(ctx);
	}
	public expr(): ExprContext {
		return this.getTypedRuleContext(ExprContext, 0) as ExprContext;
	}
	public body(): BodyContext {
		return this.getTypedRuleContext(BodyContext, 0) as BodyContext;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterWhileStatement) {
	 		listener.enterWhileStatement(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitWhileStatement) {
	 		listener.exitWhileStatement(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitWhileStatement) {
			return visitor.visitWhileStatement(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class StructmembervalueContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_structmembervalue;
	}
	public override copyFrom(ctx: StructmembervalueContext): void {
		super.copyFrom(ctx);
	}
}
export class StructMemberValueContext extends StructmembervalueContext {
	constructor(parser: HazeParser, ctx: StructmembervalueContext) {
		super(parser, ctx.parentCtx, ctx.invokingState);
		super.copyFrom(ctx);
	}
	public ID(): TerminalNode {
		return this.getToken(HazeParser.ID, 0);
	}
	public expr(): ExprContext {
		return this.getTypedRuleContext(ExprContext, 0) as ExprContext;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterStructMemberValue) {
	 		listener.enterStructMemberValue(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitStructMemberValue) {
	 		listener.exitStructMemberValue(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitStructMemberValue) {
			return visitor.visitStructMemberValue(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class ExprContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_expr;
	}
	public override copyFrom(ctx: ExprContext): void {
		super.copyFrom(ctx);
	}
}
export class SymbolValueExprContext extends ExprContext {
	constructor(parser: HazeParser, ctx: ExprContext) {
		super(parser, ctx.parentCtx, ctx.invokingState);
		super.copyFrom(ctx);
	}
	public ID(): TerminalNode {
		return this.getToken(HazeParser.ID, 0);
	}
	public datatype_list(): DatatypeContext[] {
		return this.getTypedRuleContexts(DatatypeContext) as DatatypeContext[];
	}
	public datatype(i: number): DatatypeContext {
		return this.getTypedRuleContext(DatatypeContext, i) as DatatypeContext;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterSymbolValueExpr) {
	 		listener.enterSymbolValueExpr(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitSymbolValueExpr) {
	 		listener.exitSymbolValueExpr(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitSymbolValueExpr) {
			return visitor.visitSymbolValueExpr(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class ParenthesisExprContext extends ExprContext {
	constructor(parser: HazeParser, ctx: ExprContext) {
		super(parser, ctx.parentCtx, ctx.invokingState);
		super.copyFrom(ctx);
	}
	public expr(): ExprContext {
		return this.getTypedRuleContext(ExprContext, 0) as ExprContext;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterParenthesisExpr) {
	 		listener.enterParenthesisExpr(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitParenthesisExpr) {
	 		listener.exitParenthesisExpr(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitParenthesisExpr) {
			return visitor.visitParenthesisExpr(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class ExprMemberAccessContext extends ExprContext {
	constructor(parser: HazeParser, ctx: ExprContext) {
		super(parser, ctx.parentCtx, ctx.invokingState);
		super.copyFrom(ctx);
	}
	public expr(): ExprContext {
		return this.getTypedRuleContext(ExprContext, 0) as ExprContext;
	}
	public ID(): TerminalNode {
		return this.getToken(HazeParser.ID, 0);
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterExprMemberAccess) {
	 		listener.enterExprMemberAccess(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitExprMemberAccess) {
	 		listener.exitExprMemberAccess(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitExprMemberAccess) {
			return visitor.visitExprMemberAccess(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class BinaryExprContext extends ExprContext {
	constructor(parser: HazeParser, ctx: ExprContext) {
		super(parser, ctx.parentCtx, ctx.invokingState);
		super.copyFrom(ctx);
	}
	public expr_list(): ExprContext[] {
		return this.getTypedRuleContexts(ExprContext) as ExprContext[];
	}
	public expr(i: number): ExprContext {
		return this.getTypedRuleContext(ExprContext, i) as ExprContext;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterBinaryExpr) {
	 		listener.enterBinaryExpr(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitBinaryExpr) {
	 		listener.exitBinaryExpr(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitBinaryExpr) {
			return visitor.visitBinaryExpr(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class FuncRefExprContext extends ExprContext {
	constructor(parser: HazeParser, ctx: ExprContext) {
		super(parser, ctx.parentCtx, ctx.invokingState);
		super.copyFrom(ctx);
	}
	public func(): FuncContext {
		return this.getTypedRuleContext(FuncContext, 0) as FuncContext;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterFuncRefExpr) {
	 		listener.enterFuncRefExpr(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitFuncRefExpr) {
	 		listener.exitFuncRefExpr(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitFuncRefExpr) {
			return visitor.visitFuncRefExpr(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class ConstantExprContext extends ExprContext {
	constructor(parser: HazeParser, ctx: ExprContext) {
		super(parser, ctx.parentCtx, ctx.invokingState);
		super.copyFrom(ctx);
	}
	public constant(): ConstantContext {
		return this.getTypedRuleContext(ConstantContext, 0) as ConstantContext;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterConstantExpr) {
	 		listener.enterConstantExpr(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitConstantExpr) {
	 		listener.exitConstantExpr(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitConstantExpr) {
			return visitor.visitConstantExpr(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class PreIncrExprContext extends ExprContext {
	public _op!: Token;
	constructor(parser: HazeParser, ctx: ExprContext) {
		super(parser, ctx.parentCtx, ctx.invokingState);
		super.copyFrom(ctx);
	}
	public expr(): ExprContext {
		return this.getTypedRuleContext(ExprContext, 0) as ExprContext;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterPreIncrExpr) {
	 		listener.enterPreIncrExpr(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitPreIncrExpr) {
	 		listener.exitPreIncrExpr(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitPreIncrExpr) {
			return visitor.visitPreIncrExpr(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class StructInstantiationExprContext extends ExprContext {
	constructor(parser: HazeParser, ctx: ExprContext) {
		super(parser, ctx.parentCtx, ctx.invokingState);
		super.copyFrom(ctx);
	}
	public datatype(): DatatypeContext {
		return this.getTypedRuleContext(DatatypeContext, 0) as DatatypeContext;
	}
	public structmembervalue_list(): StructmembervalueContext[] {
		return this.getTypedRuleContexts(StructmembervalueContext) as StructmembervalueContext[];
	}
	public structmembervalue(i: number): StructmembervalueContext {
		return this.getTypedRuleContext(StructmembervalueContext, i) as StructmembervalueContext;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterStructInstantiationExpr) {
	 		listener.enterStructInstantiationExpr(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitStructInstantiationExpr) {
	 		listener.exitStructInstantiationExpr(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitStructInstantiationExpr) {
			return visitor.visitStructInstantiationExpr(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class UnaryExprContext extends ExprContext {
	public _op!: Token;
	constructor(parser: HazeParser, ctx: ExprContext) {
		super(parser, ctx.parentCtx, ctx.invokingState);
		super.copyFrom(ctx);
	}
	public expr(): ExprContext {
		return this.getTypedRuleContext(ExprContext, 0) as ExprContext;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterUnaryExpr) {
	 		listener.enterUnaryExpr(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitUnaryExpr) {
	 		listener.exitUnaryExpr(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitUnaryExpr) {
			return visitor.visitUnaryExpr(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class PostIncrExprContext extends ExprContext {
	public _op!: Token;
	constructor(parser: HazeParser, ctx: ExprContext) {
		super(parser, ctx.parentCtx, ctx.invokingState);
		super.copyFrom(ctx);
	}
	public expr(): ExprContext {
		return this.getTypedRuleContext(ExprContext, 0) as ExprContext;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterPostIncrExpr) {
	 		listener.enterPostIncrExpr(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitPostIncrExpr) {
	 		listener.exitPostIncrExpr(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitPostIncrExpr) {
			return visitor.visitPostIncrExpr(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class ExprCallExprContext extends ExprContext {
	constructor(parser: HazeParser, ctx: ExprContext) {
		super(parser, ctx.parentCtx, ctx.invokingState);
		super.copyFrom(ctx);
	}
	public expr(): ExprContext {
		return this.getTypedRuleContext(ExprContext, 0) as ExprContext;
	}
	public args(): ArgsContext {
		return this.getTypedRuleContext(ArgsContext, 0) as ArgsContext;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterExprCallExpr) {
	 		listener.enterExprCallExpr(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitExprCallExpr) {
	 		listener.exitExprCallExpr(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitExprCallExpr) {
			return visitor.visitExprCallExpr(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class ExprAssignmentExprContext extends ExprContext {
	public _op!: Token;
	constructor(parser: HazeParser, ctx: ExprContext) {
		super(parser, ctx.parentCtx, ctx.invokingState);
		super.copyFrom(ctx);
	}
	public expr_list(): ExprContext[] {
		return this.getTypedRuleContexts(ExprContext) as ExprContext[];
	}
	public expr(i: number): ExprContext {
		return this.getTypedRuleContext(ExprContext, i) as ExprContext;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterExprAssignmentExpr) {
	 		listener.enterExprAssignmentExpr(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitExprAssignmentExpr) {
	 		listener.exitExprAssignmentExpr(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitExprAssignmentExpr) {
			return visitor.visitExprAssignmentExpr(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class ExplicitCastExprContext extends ExprContext {
	constructor(parser: HazeParser, ctx: ExprContext) {
		super(parser, ctx.parentCtx, ctx.invokingState);
		super.copyFrom(ctx);
	}
	public expr(): ExprContext {
		return this.getTypedRuleContext(ExprContext, 0) as ExprContext;
	}
	public datatype(): DatatypeContext {
		return this.getTypedRuleContext(DatatypeContext, 0) as DatatypeContext;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterExplicitCastExpr) {
	 		listener.enterExplicitCastExpr(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitExplicitCastExpr) {
	 		listener.exitExplicitCastExpr(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitExplicitCastExpr) {
			return visitor.visitExplicitCastExpr(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class ArgsContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public expr_list(): ExprContext[] {
		return this.getTypedRuleContexts(ExprContext) as ExprContext[];
	}
	public expr(i: number): ExprContext {
		return this.getTypedRuleContext(ExprContext, i) as ExprContext;
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_args;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterArgs) {
	 		listener.enterArgs(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitArgs) {
	 		listener.exitArgs(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitArgs) {
			return visitor.visitArgs(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class EllipsisContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_ellipsis;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterEllipsis) {
	 		listener.enterEllipsis(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitEllipsis) {
	 		listener.exitEllipsis(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitEllipsis) {
			return visitor.visitEllipsis(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class FunctypeContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public params(): ParamsContext {
		return this.getTypedRuleContext(ParamsContext, 0) as ParamsContext;
	}
	public datatype(): DatatypeContext {
		return this.getTypedRuleContext(DatatypeContext, 0) as DatatypeContext;
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_functype;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterFunctype) {
	 		listener.enterFunctype(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitFunctype) {
	 		listener.exitFunctype(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitFunctype) {
			return visitor.visitFunctype(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class ConstantContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_constant;
	}
	public override copyFrom(ctx: ConstantContext): void {
		super.copyFrom(ctx);
	}
}
export class BooleanConstantContext extends ConstantContext {
	constructor(parser: HazeParser, ctx: ConstantContext) {
		super(parser, ctx.parentCtx, ctx.invokingState);
		super.copyFrom(ctx);
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterBooleanConstant) {
	 		listener.enterBooleanConstant(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitBooleanConstant) {
	 		listener.exitBooleanConstant(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitBooleanConstant) {
			return visitor.visitBooleanConstant(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class StringConstantContext extends ConstantContext {
	constructor(parser: HazeParser, ctx: ConstantContext) {
		super(parser, ctx.parentCtx, ctx.invokingState);
		super.copyFrom(ctx);
	}
	public STRING_LITERAL(): TerminalNode {
		return this.getToken(HazeParser.STRING_LITERAL, 0);
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterStringConstant) {
	 		listener.enterStringConstant(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitStringConstant) {
	 		listener.exitStringConstant(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitStringConstant) {
			return visitor.visitStringConstant(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class LiteralConstantContext extends ConstantContext {
	constructor(parser: HazeParser, ctx: ConstantContext) {
		super(parser, ctx.parentCtx, ctx.invokingState);
		super.copyFrom(ctx);
	}
	public UNIT_LITERAL(): TerminalNode {
		return this.getToken(HazeParser.UNIT_LITERAL, 0);
	}
	public NUMBER_LITERAL(): TerminalNode {
		return this.getToken(HazeParser.NUMBER_LITERAL, 0);
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterLiteralConstant) {
	 		listener.enterLiteralConstant(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitLiteralConstant) {
	 		listener.exitLiteralConstant(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitLiteralConstant) {
			return visitor.visitLiteralConstant(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class CompilationhintContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public compilationlang(): CompilationlangContext {
		return this.getTypedRuleContext(CompilationlangContext, 0) as CompilationlangContext;
	}
	public compilationhintfilename(): CompilationhintfilenameContext {
		return this.getTypedRuleContext(CompilationhintfilenameContext, 0) as CompilationhintfilenameContext;
	}
	public compilationhintflags(): CompilationhintflagsContext {
		return this.getTypedRuleContext(CompilationhintflagsContext, 0) as CompilationhintflagsContext;
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_compilationhint;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterCompilationhint) {
	 		listener.enterCompilationhint(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitCompilationhint) {
	 		listener.exitCompilationhint(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitCompilationhint) {
			return visitor.visitCompilationhint(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class CompilationhintfilenameContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public STRING_LITERAL(): TerminalNode {
		return this.getToken(HazeParser.STRING_LITERAL, 0);
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_compilationhintfilename;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterCompilationhintfilename) {
	 		listener.enterCompilationhintfilename(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitCompilationhintfilename) {
	 		listener.exitCompilationhintfilename(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitCompilationhintfilename) {
			return visitor.visitCompilationhintfilename(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class CompilationhintflagsContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public STRING_LITERAL(): TerminalNode {
		return this.getToken(HazeParser.STRING_LITERAL, 0);
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_compilationhintflags;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterCompilationhintflags) {
	 		listener.enterCompilationhintflags(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitCompilationhintflags) {
	 		listener.exitCompilationhintflags(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitCompilationhintflags) {
			return visitor.visitCompilationhintflags(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class CompilationlangContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_compilationlang;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterCompilationlang) {
	 		listener.enterCompilationlang(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitCompilationlang) {
	 		listener.exitCompilationlang(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitCompilationlang) {
			return visitor.visitCompilationlang(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class LinkerhintContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public STRING_LITERAL(): TerminalNode {
		return this.getToken(HazeParser.STRING_LITERAL, 0);
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_linkerhint;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterLinkerhint) {
	 		listener.enterLinkerhint(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitLinkerhint) {
	 		listener.exitLinkerhint(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitLinkerhint) {
			return visitor.visitLinkerhint(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class StructcontentContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_structcontent;
	}
	public override copyFrom(ctx: StructcontentContext): void {
		super.copyFrom(ctx);
	}
}
export class StructMethodContext extends StructcontentContext {
	constructor(parser: HazeParser, ctx: StructcontentContext) {
		super(parser, ctx.parentCtx, ctx.invokingState);
		super.copyFrom(ctx);
	}
	public ID(): TerminalNode {
		return this.getToken(HazeParser.ID, 0);
	}
	public params(): ParamsContext {
		return this.getTypedRuleContext(ParamsContext, 0) as ParamsContext;
	}
	public funcbody(): FuncbodyContext {
		return this.getTypedRuleContext(FuncbodyContext, 0) as FuncbodyContext;
	}
	public datatype(): DatatypeContext {
		return this.getTypedRuleContext(DatatypeContext, 0) as DatatypeContext;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterStructMethod) {
	 		listener.enterStructMethod(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitStructMethod) {
	 		listener.exitStructMethod(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitStructMethod) {
			return visitor.visitStructMethod(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class StructMemberContext extends StructcontentContext {
	constructor(parser: HazeParser, ctx: StructcontentContext) {
		super(parser, ctx.parentCtx, ctx.invokingState);
		super.copyFrom(ctx);
	}
	public ID(): TerminalNode {
		return this.getToken(HazeParser.ID, 0);
	}
	public datatype(): DatatypeContext {
		return this.getTypedRuleContext(DatatypeContext, 0) as DatatypeContext;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterStructMember) {
	 		listener.enterStructMember(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitStructMember) {
	 		listener.exitStructMember(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitStructMember) {
			return visitor.visitStructMember(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class StructdeclContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_structdecl;
	}
	public override copyFrom(ctx: StructdeclContext): void {
		super.copyFrom(ctx);
	}
}
export class StructDeclContext extends StructdeclContext {
	constructor(parser: HazeParser, ctx: StructdeclContext) {
		super(parser, ctx.parentCtx, ctx.invokingState);
		super.copyFrom(ctx);
	}
	public ID_list(): TerminalNode[] {
	    	return this.getTokens(HazeParser.ID);
	}
	public ID(i: number): TerminalNode {
		return this.getToken(HazeParser.ID, i);
	}
	public externlang(): ExternlangContext {
		return this.getTypedRuleContext(ExternlangContext, 0) as ExternlangContext;
	}
	public structcontent_list(): StructcontentContext[] {
		return this.getTypedRuleContexts(StructcontentContext) as StructcontentContext[];
	}
	public structcontent(i: number): StructcontentContext {
		return this.getTypedRuleContext(StructcontentContext, i) as StructcontentContext;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterStructDecl) {
	 		listener.enterStructDecl(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitStructDecl) {
	 		listener.exitStructDecl(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitStructDecl) {
			return visitor.visitStructDecl(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class DatatypeContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_datatype;
	}
	public override copyFrom(ctx: DatatypeContext): void {
		super.copyFrom(ctx);
	}
}
export class CommonDatatypeContext extends DatatypeContext {
	constructor(parser: HazeParser, ctx: DatatypeContext) {
		super(parser, ctx.parentCtx, ctx.invokingState);
		super.copyFrom(ctx);
	}
	public ID(): TerminalNode {
		return this.getToken(HazeParser.ID, 0);
	}
	public datatype_list(): DatatypeContext[] {
		return this.getTypedRuleContexts(DatatypeContext) as DatatypeContext[];
	}
	public datatype(i: number): DatatypeContext {
		return this.getTypedRuleContext(DatatypeContext, i) as DatatypeContext;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterCommonDatatype) {
	 		listener.enterCommonDatatype(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitCommonDatatype) {
	 		listener.exitCommonDatatype(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitCommonDatatype) {
			return visitor.visitCommonDatatype(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class FunctionDatatypeContext extends DatatypeContext {
	constructor(parser: HazeParser, ctx: DatatypeContext) {
		super(parser, ctx.parentCtx, ctx.invokingState);
		super.copyFrom(ctx);
	}
	public functype(): FunctypeContext {
		return this.getTypedRuleContext(FunctypeContext, 0) as FunctypeContext;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterFunctionDatatype) {
	 		listener.enterFunctionDatatype(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitFunctionDatatype) {
	 		listener.exitFunctionDatatype(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitFunctionDatatype) {
			return visitor.visitFunctionDatatype(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
