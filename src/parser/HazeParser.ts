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
	public static readonly T__55 = 56;
	public static readonly T__56 = 57;
	public static readonly STRING_LITERAL = 58;
	public static readonly UNIT_LITERAL = 59;
	public static readonly NUMBER_LITERAL = 60;
	public static readonly ID = 61;
	public static readonly WS = 62;
	public static readonly COMMENT = 63;
	public static override readonly EOF = Token.EOF;
	public static readonly RULE_prog = 0;
	public static readonly RULE_namespacecontent = 1;
	public static readonly RULE_namespace = 2;
	public static readonly RULE_namedfunc = 3;
	public static readonly RULE_func = 4;
	public static readonly RULE_funcbody = 5;
	public static readonly RULE_body = 6;
	public static readonly RULE_param = 7;
	public static readonly RULE_params = 8;
	public static readonly RULE_cdefinitiondecl = 9;
	public static readonly RULE_funcdecl = 10;
	public static readonly RULE_externlang = 11;
	public static readonly RULE_ifexpr = 12;
	public static readonly RULE_elseifexpr = 13;
	public static readonly RULE_thenblock = 14;
	public static readonly RULE_elseifblock = 15;
	public static readonly RULE_elseblock = 16;
	public static readonly RULE_variablemutability = 17;
	public static readonly RULE_variablestatement = 18;
	public static readonly RULE_statement = 19;
	public static readonly RULE_structmembervalue = 20;
	public static readonly RULE_expr = 21;
	public static readonly RULE_args = 22;
	public static readonly RULE_ellipsis = 23;
	public static readonly RULE_functype = 24;
	public static readonly RULE_constant = 25;
	public static readonly RULE_structcontent = 26;
	public static readonly RULE_structdecl = 27;
	public static readonly RULE_datatype = 28;
	public static readonly RULE_datatypeimpl = 29;
	public static readonly RULE_genericsvalue = 30;
	public static readonly literalNames: (string | null)[] = [ null, "'export'", 
                                                            "'namespace'", 
                                                            "'.'", "'{'", 
                                                            "'}'", "'('", 
                                                            "')'", "':'", 
                                                            "'=>'", "','", 
                                                            "'inject'", 
                                                            "';'", "'extern'", 
                                                            "'\"C\"'", "'\"C++\"'", 
                                                            "'let'", "'const'", 
                                                            "'='", "'__c__'", 
                                                            "'return'", 
                                                            "'if'", "'else'", 
                                                            "'while'", "'++'", 
                                                            "'--'", "'+'", 
                                                            "'-'", "'not'", 
                                                            "'!'", "'as'", 
                                                            "'*'", "'/'", 
                                                            "'%'", "'<'", 
                                                            "'>'", "'<='", 
                                                            "'>='", "'=='", 
                                                            "'!='", "'is'", 
                                                            "'and'", "'or'", 
                                                            "'+='", "'-='", 
                                                            "'*='", "'/='", 
                                                            "'%='", "'<<='", 
                                                            "'>>='", "'&='", 
                                                            "'^='", "'|='", 
                                                            "'...'", "'true'", 
                                                            "'false'", "'unsafe_union'", 
                                                            "'struct'" ];
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
                                                             null, null, 
                                                             "STRING_LITERAL", 
                                                             "UNIT_LITERAL", 
                                                             "NUMBER_LITERAL", 
                                                             "ID", "WS", 
                                                             "COMMENT" ];
	// tslint:disable:no-trailing-whitespace
	public static readonly ruleNames: string[] = [
		"prog", "namespacecontent", "namespace", "namedfunc", "func", "funcbody", 
		"body", "param", "params", "cdefinitiondecl", "funcdecl", "externlang", 
		"ifexpr", "elseifexpr", "thenblock", "elseifblock", "elseblock", "variablemutability", 
		"variablestatement", "statement", "structmembervalue", "expr", "args", 
		"ellipsis", "functype", "constant", "structcontent", "structdecl", "datatype", 
		"datatypeimpl", "genericsvalue",
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
			while ((((_la) & ~0x1F) === 0 && ((1 << _la) & 206854) !== 0) || _la===57 || _la===61) {
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
					this.structdecl();
					}
					break;
				case 5:
					{
					this.state = 66;
					this.namespace();
					}
					break;
				case 6:
					{
					this.state = 67;
					this.variablestatement();
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
	public namespacecontent(): NamespacecontentContext {
		let localctx: NamespacecontentContext = new NamespacecontentContext(this, this._ctx, this.state);
		this.enterRule(localctx, 2, HazeParser.RULE_namespacecontent);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 80;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while ((((_la) & ~0x1F) === 0 && ((1 << _la) & 204806) !== 0) || _la===57 || _la===61) {
				{
				this.state = 78;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 2, this._ctx) ) {
				case 1:
					{
					this.state = 73;
					this.namedfunc();
					}
					break;
				case 2:
					{
					this.state = 74;
					this.funcdecl();
					}
					break;
				case 3:
					{
					this.state = 75;
					this.structdecl();
					}
					break;
				case 4:
					{
					this.state = 76;
					this.namespace();
					}
					break;
				case 5:
					{
					this.state = 77;
					this.variablestatement();
					}
					break;
				}
				}
				this.state = 82;
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
	public namespace(): NamespaceContext {
		let localctx: NamespaceContext = new NamespaceContext(this, this._ctx, this.state);
		this.enterRule(localctx, 4, HazeParser.RULE_namespace);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 84;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===1) {
				{
				this.state = 83;
				localctx._export_ = this.match(HazeParser.T__0);
				}
			}

			this.state = 86;
			this.match(HazeParser.T__1);
			this.state = 87;
			this.match(HazeParser.ID);
			this.state = 92;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===3) {
				{
				{
				this.state = 88;
				this.match(HazeParser.T__2);
				this.state = 89;
				this.match(HazeParser.ID);
				}
				}
				this.state = 94;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 95;
			this.match(HazeParser.T__3);
			this.state = 96;
			this.namespacecontent();
			this.state = 97;
			this.match(HazeParser.T__4);
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
		this.enterRule(localctx, 6, HazeParser.RULE_namedfunc);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 100;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===1) {
				{
				this.state = 99;
				localctx._export_ = this.match(HazeParser.T__0);
				}
			}

			this.state = 102;
			this.match(HazeParser.ID);
			this.state = 103;
			this.match(HazeParser.T__5);
			this.state = 104;
			this.params();
			this.state = 105;
			this.match(HazeParser.T__6);
			this.state = 108;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===8) {
				{
				this.state = 106;
				this.match(HazeParser.T__7);
				this.state = 107;
				this.datatype();
				}
			}

			this.state = 110;
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
		this.enterRule(localctx, 8, HazeParser.RULE_func);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 112;
			this.match(HazeParser.T__5);
			this.state = 113;
			this.params();
			this.state = 114;
			this.match(HazeParser.T__6);
			this.state = 117;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===8) {
				{
				this.state = 115;
				this.match(HazeParser.T__7);
				this.state = 116;
				this.datatype();
				}
			}

			this.state = 119;
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
		this.enterRule(localctx, 10, HazeParser.RULE_funcbody);
		let _la: number;
		try {
			this.state = 130;
			this._errHandler.sync(this);
			switch ( this._interp.adaptivePredict(this._input, 10, this._ctx) ) {
			case 1:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 122;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===9) {
					{
					this.state = 121;
					this.match(HazeParser.T__8);
					}
				}

				this.state = 124;
				this.match(HazeParser.T__3);
				this.state = 125;
				this.body();
				this.state = 126;
				this.match(HazeParser.T__4);
				}
				break;
			case 2:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 128;
				this.match(HazeParser.T__8);
				this.state = 129;
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
		this.enterRule(localctx, 12, HazeParser.RULE_body);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 135;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while ((((_la) & ~0x1F) === 0 && ((1 << _la) & 1069228098) !== 0) || ((((_la - 54)) & ~0x1F) === 0 && ((1 << (_la - 54)) & 243) !== 0)) {
				{
				{
				this.state = 132;
				this.statement();
				}
				}
				this.state = 137;
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
		this.enterRule(localctx, 14, HazeParser.RULE_param);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 138;
			this.match(HazeParser.ID);
			this.state = 139;
			this.match(HazeParser.T__7);
			this.state = 140;
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
		this.enterRule(localctx, 16, HazeParser.RULE_params);
		let _la: number;
		try {
			let _alt: number;
			this.state = 157;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 7:
			case 61:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 154;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===61) {
					{
					this.state = 142;
					this.param();
					this.state = 147;
					this._errHandler.sync(this);
					_alt = this._interp.adaptivePredict(this._input, 12, this._ctx);
					while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
						if (_alt === 1) {
							{
							{
							this.state = 143;
							this.match(HazeParser.T__9);
							this.state = 144;
							this.param();
							}
							}
						}
						this.state = 149;
						this._errHandler.sync(this);
						_alt = this._interp.adaptivePredict(this._input, 12, this._ctx);
					}
					this.state = 152;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					if (_la===10) {
						{
						this.state = 150;
						this.match(HazeParser.T__9);
						this.state = 151;
						this.ellipsis();
						}
					}

					}
				}

				}
				break;
			case 53:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 156;
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
		this.enterRule(localctx, 18, HazeParser.RULE_cdefinitiondecl);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 159;
			this.match(HazeParser.T__10);
			this.state = 160;
			this.match(HazeParser.STRING_LITERAL);
			this.state = 161;
			this.match(HazeParser.T__11);
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
		this.enterRule(localctx, 20, HazeParser.RULE_funcdecl);
		let _la: number;
		try {
			let _alt: number;
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 164;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===1) {
				{
				this.state = 163;
				localctx._export_ = this.match(HazeParser.T__0);
				}
			}

			this.state = 170;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===13) {
				{
				this.state = 166;
				localctx._extern = this.match(HazeParser.T__12);
				this.state = 168;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===14 || _la===15) {
					{
					this.state = 167;
					this.externlang();
					}
				}

				}
			}

			this.state = 176;
			this._errHandler.sync(this);
			_alt = this._interp.adaptivePredict(this._input, 19, this._ctx);
			while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
				if (_alt === 1) {
					{
					{
					this.state = 172;
					this.match(HazeParser.ID);
					this.state = 173;
					this.match(HazeParser.T__2);
					}
					}
				}
				this.state = 178;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 19, this._ctx);
			}
			this.state = 179;
			this.match(HazeParser.ID);
			this.state = 180;
			this.match(HazeParser.T__5);
			this.state = 181;
			this.params();
			this.state = 182;
			this.match(HazeParser.T__6);
			this.state = 185;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===8) {
				{
				this.state = 183;
				this.match(HazeParser.T__7);
				this.state = 184;
				this.datatype();
				}
			}

			this.state = 187;
			this.match(HazeParser.T__11);
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
		this.enterRule(localctx, 22, HazeParser.RULE_externlang);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 189;
			_la = this._input.LA(1);
			if(!(_la===14 || _la===15)) {
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
		this.enterRule(localctx, 24, HazeParser.RULE_ifexpr);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 191;
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
		this.enterRule(localctx, 26, HazeParser.RULE_elseifexpr);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 193;
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
		this.enterRule(localctx, 28, HazeParser.RULE_thenblock);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 195;
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
		this.enterRule(localctx, 30, HazeParser.RULE_elseifblock);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 197;
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
		this.enterRule(localctx, 32, HazeParser.RULE_elseblock);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 199;
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
		this.enterRule(localctx, 34, HazeParser.RULE_variablemutability);
		let _la: number;
		try {
			localctx = new VariableMutabilityContext(this, localctx);
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 201;
			_la = this._input.LA(1);
			if(!(_la===16 || _la===17)) {
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
	public variablestatement(): VariablestatementContext {
		let localctx: VariablestatementContext = new VariablestatementContext(this, this._ctx, this.state);
		this.enterRule(localctx, 36, HazeParser.RULE_variablestatement);
		let _la: number;
		try {
			this.state = 238;
			this._errHandler.sync(this);
			switch ( this._interp.adaptivePredict(this._input, 28, this._ctx) ) {
			case 1:
				localctx = new VariableDefinitionContext(this, localctx);
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 204;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===1) {
					{
					this.state = 203;
					(localctx as VariableDefinitionContext)._export_ = this.match(HazeParser.T__0);
					}
				}

				this.state = 210;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===13) {
					{
					this.state = 206;
					(localctx as VariableDefinitionContext)._extern = this.match(HazeParser.T__12);
					this.state = 208;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					if (_la===14 || _la===15) {
						{
						this.state = 207;
						this.externlang();
						}
					}

					}
				}

				this.state = 212;
				this.variablemutability();
				this.state = 213;
				this.match(HazeParser.ID);
				this.state = 216;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===8) {
					{
					this.state = 214;
					this.match(HazeParser.T__7);
					this.state = 215;
					this.datatype();
					}
				}

				this.state = 218;
				this.match(HazeParser.T__17);
				this.state = 219;
				this.expr(0);
				this.state = 220;
				this.match(HazeParser.T__11);
				}
				break;
			case 2:
				localctx = new VariableDeclarationContext(this, localctx);
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 223;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===1) {
					{
					this.state = 222;
					(localctx as VariableDeclarationContext)._export_ = this.match(HazeParser.T__0);
					}
				}

				this.state = 229;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===13) {
					{
					this.state = 225;
					(localctx as VariableDeclarationContext)._extern = this.match(HazeParser.T__12);
					this.state = 227;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					if (_la===14 || _la===15) {
						{
						this.state = 226;
						this.externlang();
						}
					}

					}
				}

				this.state = 231;
				this.variablemutability();
				this.state = 232;
				this.match(HazeParser.ID);
				{
				this.state = 233;
				this.match(HazeParser.T__7);
				this.state = 234;
				this.datatype();
				}
				this.state = 236;
				this.match(HazeParser.T__11);
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
	public statement(): StatementContext {
		let localctx: StatementContext = new StatementContext(this, this._ctx, this.state);
		this.enterRule(localctx, 38, HazeParser.RULE_statement);
		let _la: number;
		try {
			let _alt: number;
			this.state = 284;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 19:
				localctx = new InlineCStatementContext(this, localctx);
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 240;
				this.match(HazeParser.T__18);
				this.state = 241;
				this.match(HazeParser.T__5);
				this.state = 242;
				this.match(HazeParser.STRING_LITERAL);
				this.state = 243;
				this.match(HazeParser.T__6);
				this.state = 244;
				this.match(HazeParser.T__11);
				}
				break;
			case 6:
			case 24:
			case 25:
			case 26:
			case 27:
			case 28:
			case 29:
			case 54:
			case 55:
			case 58:
			case 59:
			case 60:
			case 61:
				localctx = new ExprStatementContext(this, localctx);
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 245;
				this.expr(0);
				this.state = 246;
				this.match(HazeParser.T__11);
				}
				break;
			case 20:
				localctx = new ReturnStatementContext(this, localctx);
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 248;
				this.match(HazeParser.T__19);
				this.state = 250;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if ((((_la) & ~0x1F) === 0 && ((1 << _la) & 1056964672) !== 0) || ((((_la - 54)) & ~0x1F) === 0 && ((1 << (_la - 54)) & 243) !== 0)) {
					{
					this.state = 249;
					this.expr(0);
					}
				}

				this.state = 252;
				this.match(HazeParser.T__11);
				}
				break;
			case 1:
			case 13:
			case 16:
			case 17:
				localctx = new VariableStatementContext(this, localctx);
				this.enterOuterAlt(localctx, 4);
				{
				this.state = 253;
				this.variablestatement();
				}
				break;
			case 21:
				localctx = new IfStatementContext(this, localctx);
				this.enterOuterAlt(localctx, 5);
				{
				this.state = 254;
				this.match(HazeParser.T__20);
				this.state = 255;
				this.ifexpr();
				this.state = 256;
				this.match(HazeParser.T__3);
				this.state = 257;
				this.thenblock();
				this.state = 258;
				this.match(HazeParser.T__4);
				this.state = 268;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 30, this._ctx);
				while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
					if (_alt === 1) {
						{
						{
						this.state = 259;
						this.match(HazeParser.T__21);
						this.state = 260;
						this.match(HazeParser.T__20);
						this.state = 261;
						this.elseifexpr();
						this.state = 262;
						this.match(HazeParser.T__3);
						this.state = 263;
						this.elseifblock();
						this.state = 264;
						this.match(HazeParser.T__4);
						}
						}
					}
					this.state = 270;
					this._errHandler.sync(this);
					_alt = this._interp.adaptivePredict(this._input, 30, this._ctx);
				}
				this.state = 276;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===22) {
					{
					this.state = 271;
					this.match(HazeParser.T__21);
					this.state = 272;
					this.match(HazeParser.T__3);
					this.state = 273;
					this.elseblock();
					this.state = 274;
					this.match(HazeParser.T__4);
					}
				}

				}
				break;
			case 23:
				localctx = new WhileStatementContext(this, localctx);
				this.enterOuterAlt(localctx, 6);
				{
				this.state = 278;
				this.match(HazeParser.T__22);
				this.state = 279;
				this.expr(0);
				this.state = 280;
				this.match(HazeParser.T__3);
				this.state = 281;
				this.body();
				this.state = 282;
				this.match(HazeParser.T__4);
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
		this.enterRule(localctx, 40, HazeParser.RULE_structmembervalue);
		try {
			localctx = new StructMemberValueContext(this, localctx);
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 286;
			this.match(HazeParser.T__2);
			this.state = 287;
			this.match(HazeParser.ID);
			this.state = 288;
			this.match(HazeParser.T__7);
			this.state = 289;
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
		let _startState: number = 42;
		this.enterRecursionRule(localctx, 42, HazeParser.RULE_expr, _p);
		let _la: number;
		try {
			let _alt: number;
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 341;
			this._errHandler.sync(this);
			switch ( this._interp.adaptivePredict(this._input, 40, this._ctx) ) {
			case 1:
				{
				localctx = new ParenthesisExprContext(this, localctx);
				this._ctx = localctx;
				_prevctx = localctx;

				this.state = 292;
				this.match(HazeParser.T__5);
				this.state = 293;
				this.expr(0);
				this.state = 294;
				this.match(HazeParser.T__6);
				}
				break;
			case 2:
				{
				localctx = new FuncRefExprContext(this, localctx);
				this._ctx = localctx;
				_prevctx = localctx;
				this.state = 296;
				this.func();
				}
				break;
			case 3:
				{
				localctx = new ConstantExprContext(this, localctx);
				this._ctx = localctx;
				_prevctx = localctx;
				this.state = 297;
				this.constant();
				}
				break;
			case 4:
				{
				localctx = new StructInstantiationExprContext(this, localctx);
				this._ctx = localctx;
				_prevctx = localctx;
				this.state = 298;
				this.datatype();
				this.state = 299;
				this.match(HazeParser.T__3);
				this.state = 301;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===3) {
					{
					this.state = 300;
					this.structmembervalue();
					}
				}

				this.state = 307;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 34, this._ctx);
				while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
					if (_alt === 1) {
						{
						{
						this.state = 303;
						this.match(HazeParser.T__9);
						this.state = 304;
						this.structmembervalue();
						}
						}
					}
					this.state = 309;
					this._errHandler.sync(this);
					_alt = this._interp.adaptivePredict(this._input, 34, this._ctx);
				}
				this.state = 311;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===10) {
					{
					this.state = 310;
					this.match(HazeParser.T__9);
					}
				}

				this.state = 313;
				this.match(HazeParser.T__4);
				}
				break;
			case 5:
				{
				localctx = new PreIncrExprContext(this, localctx);
				this._ctx = localctx;
				_prevctx = localctx;
				this.state = 315;
				(localctx as PreIncrExprContext)._op = this._input.LT(1);
				_la = this._input.LA(1);
				if(!(_la===24 || _la===25)) {
				    (localctx as PreIncrExprContext)._op = this._errHandler.recoverInline(this);
				}
				else {
					this._errHandler.reportMatch(this);
				    this.consume();
				}
				this.state = 316;
				this.expr(11);
				}
				break;
			case 6:
				{
				localctx = new UnaryExprContext(this, localctx);
				this._ctx = localctx;
				_prevctx = localctx;
				this.state = 317;
				(localctx as UnaryExprContext)._op = this._input.LT(1);
				_la = this._input.LA(1);
				if(!(_la===26 || _la===27)) {
				    (localctx as UnaryExprContext)._op = this._errHandler.recoverInline(this);
				}
				else {
					this._errHandler.reportMatch(this);
				    this.consume();
				}
				this.state = 318;
				this.expr(10);
				}
				break;
			case 7:
				{
				localctx = new UnaryExprContext(this, localctx);
				this._ctx = localctx;
				_prevctx = localctx;
				this.state = 319;
				_la = this._input.LA(1);
				if(!(_la===28 || _la===29)) {
				this._errHandler.recoverInline(this);
				}
				else {
					this._errHandler.reportMatch(this);
				    this.consume();
				}
				this.state = 320;
				this.expr(9);
				}
				break;
			case 8:
				{
				localctx = new SymbolValueExprContext(this, localctx);
				this._ctx = localctx;
				_prevctx = localctx;
				this.state = 321;
				this.match(HazeParser.ID);
				this.state = 339;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 39, this._ctx) ) {
				case 1:
					{
					this.state = 322;
					this.match(HazeParser.T__33);
					this.state = 325;
					this._errHandler.sync(this);
					switch (this._input.LA(1)) {
					case 6:
					case 61:
						{
						this.state = 323;
						this.datatype();
						}
						break;
					case 54:
					case 55:
					case 58:
					case 59:
					case 60:
						{
						this.state = 324;
						this.constant();
						}
						break;
					default:
						throw new NoViableAltException(this);
					}
					this.state = 334;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===10) {
						{
						{
						this.state = 327;
						this.match(HazeParser.T__9);
						this.state = 330;
						this._errHandler.sync(this);
						switch (this._input.LA(1)) {
						case 6:
						case 61:
							{
							this.state = 328;
							this.datatype();
							}
							break;
						case 54:
						case 55:
						case 58:
						case 59:
						case 60:
							{
							this.state = 329;
							this.constant();
							}
							break;
						default:
							throw new NoViableAltException(this);
						}
						}
						}
						this.state = 336;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 337;
					this.match(HazeParser.T__34);
					}
					break;
				}
				}
				break;
			}
			this._ctx.stop = this._input.LT(-1);
			this.state = 382;
			this._errHandler.sync(this);
			_alt = this._interp.adaptivePredict(this._input, 43, this._ctx);
			while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
				if (_alt === 1) {
					if (this._parseListeners != null) {
						this.triggerExitRuleEvent();
					}
					_prevctx = localctx;
					{
					this.state = 380;
					this._errHandler.sync(this);
					switch ( this._interp.adaptivePredict(this._input, 42, this._ctx) ) {
					case 1:
						{
						localctx = new BinaryExprContext(this, new ExprContext(this, _parentctx, _parentState));
						this.pushNewRecursionContext(localctx, _startState, HazeParser.RULE_expr);
						this.state = 343;
						if (!(this.precpred(this._ctx, 7))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 7)");
						}
						this.state = 344;
						_la = this._input.LA(1);
						if(!(((((_la - 31)) & ~0x1F) === 0 && ((1 << (_la - 31)) & 7) !== 0))) {
						this._errHandler.recoverInline(this);
						}
						else {
							this._errHandler.reportMatch(this);
						    this.consume();
						}
						this.state = 345;
						this.expr(8);
						}
						break;
					case 2:
						{
						localctx = new BinaryExprContext(this, new ExprContext(this, _parentctx, _parentState));
						this.pushNewRecursionContext(localctx, _startState, HazeParser.RULE_expr);
						this.state = 346;
						if (!(this.precpred(this._ctx, 6))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 6)");
						}
						this.state = 347;
						_la = this._input.LA(1);
						if(!(_la===26 || _la===27)) {
						this._errHandler.recoverInline(this);
						}
						else {
							this._errHandler.reportMatch(this);
						    this.consume();
						}
						this.state = 348;
						this.expr(7);
						}
						break;
					case 3:
						{
						localctx = new BinaryExprContext(this, new ExprContext(this, _parentctx, _parentState));
						this.pushNewRecursionContext(localctx, _startState, HazeParser.RULE_expr);
						this.state = 349;
						if (!(this.precpred(this._ctx, 5))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 5)");
						}
						this.state = 350;
						_la = this._input.LA(1);
						if(!(((((_la - 34)) & ~0x1F) === 0 && ((1 << (_la - 34)) & 15) !== 0))) {
						this._errHandler.recoverInline(this);
						}
						else {
							this._errHandler.reportMatch(this);
						    this.consume();
						}
						this.state = 351;
						this.expr(6);
						}
						break;
					case 4:
						{
						localctx = new BinaryExprContext(this, new ExprContext(this, _parentctx, _parentState));
						this.pushNewRecursionContext(localctx, _startState, HazeParser.RULE_expr);
						this.state = 352;
						if (!(this.precpred(this._ctx, 4))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 4)");
						}
						this.state = 358;
						this._errHandler.sync(this);
						switch ( this._interp.adaptivePredict(this._input, 41, this._ctx) ) {
						case 1:
							{
							this.state = 353;
							this.match(HazeParser.T__37);
							}
							break;
						case 2:
							{
							this.state = 354;
							this.match(HazeParser.T__38);
							}
							break;
						case 3:
							{
							this.state = 355;
							this.match(HazeParser.T__39);
							}
							break;
						case 4:
							{
							{
							this.state = 356;
							this.match(HazeParser.T__39);
							this.state = 357;
							this.match(HazeParser.T__27);
							}
							}
							break;
						}
						this.state = 360;
						this.expr(5);
						}
						break;
					case 5:
						{
						localctx = new BinaryExprContext(this, new ExprContext(this, _parentctx, _parentState));
						this.pushNewRecursionContext(localctx, _startState, HazeParser.RULE_expr);
						this.state = 361;
						if (!(this.precpred(this._ctx, 3))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 3)");
						}
						this.state = 362;
						_la = this._input.LA(1);
						if(!(_la===41 || _la===42)) {
						this._errHandler.recoverInline(this);
						}
						else {
							this._errHandler.reportMatch(this);
						    this.consume();
						}
						this.state = 363;
						this.expr(4);
						}
						break;
					case 6:
						{
						localctx = new ExprAssignmentExprContext(this, new ExprContext(this, _parentctx, _parentState));
						this.pushNewRecursionContext(localctx, _startState, HazeParser.RULE_expr);
						this.state = 364;
						if (!(this.precpred(this._ctx, 2))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 2)");
						}
						this.state = 365;
						(localctx as ExprAssignmentExprContext)._op = this._input.LT(1);
						_la = this._input.LA(1);
						if(!(_la===18 || ((((_la - 43)) & ~0x1F) === 0 && ((1 << (_la - 43)) & 1023) !== 0))) {
						    (localctx as ExprAssignmentExprContext)._op = this._errHandler.recoverInline(this);
						}
						else {
							this._errHandler.reportMatch(this);
						    this.consume();
						}
						this.state = 366;
						this.expr(3);
						}
						break;
					case 7:
						{
						localctx = new PostIncrExprContext(this, new ExprContext(this, _parentctx, _parentState));
						this.pushNewRecursionContext(localctx, _startState, HazeParser.RULE_expr);
						this.state = 367;
						if (!(this.precpred(this._ctx, 15))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 15)");
						}
						this.state = 368;
						(localctx as PostIncrExprContext)._op = this._input.LT(1);
						_la = this._input.LA(1);
						if(!(_la===24 || _la===25)) {
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
						this.state = 369;
						if (!(this.precpred(this._ctx, 14))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 14)");
						}
						this.state = 370;
						this.match(HazeParser.T__5);
						this.state = 371;
						this.args();
						this.state = 372;
						this.match(HazeParser.T__6);
						}
						break;
					case 9:
						{
						localctx = new ExprMemberAccessContext(this, new ExprContext(this, _parentctx, _parentState));
						this.pushNewRecursionContext(localctx, _startState, HazeParser.RULE_expr);
						this.state = 374;
						if (!(this.precpred(this._ctx, 13))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 13)");
						}
						this.state = 375;
						this.match(HazeParser.T__2);
						this.state = 376;
						this.match(HazeParser.ID);
						}
						break;
					case 10:
						{
						localctx = new ExplicitCastExprContext(this, new ExprContext(this, _parentctx, _parentState));
						this.pushNewRecursionContext(localctx, _startState, HazeParser.RULE_expr);
						this.state = 377;
						if (!(this.precpred(this._ctx, 8))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 8)");
						}
						this.state = 378;
						this.match(HazeParser.T__29);
						this.state = 379;
						this.datatype();
						}
						break;
					}
					}
				}
				this.state = 384;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 43, this._ctx);
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
		this.enterRule(localctx, 44, HazeParser.RULE_args);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 393;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if ((((_la) & ~0x1F) === 0 && ((1 << _la) & 1056964672) !== 0) || ((((_la - 54)) & ~0x1F) === 0 && ((1 << (_la - 54)) & 243) !== 0)) {
				{
				this.state = 385;
				this.expr(0);
				this.state = 390;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===10) {
					{
					{
					this.state = 386;
					this.match(HazeParser.T__9);
					this.state = 387;
					this.expr(0);
					}
					}
					this.state = 392;
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
		this.enterRule(localctx, 46, HazeParser.RULE_ellipsis);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 395;
			this.match(HazeParser.T__52);
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
		this.enterRule(localctx, 48, HazeParser.RULE_functype);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 397;
			this.match(HazeParser.T__5);
			this.state = 398;
			this.params();
			this.state = 399;
			this.match(HazeParser.T__6);
			this.state = 400;
			this.match(HazeParser.T__8);
			this.state = 401;
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
		this.enterRule(localctx, 50, HazeParser.RULE_constant);
		let _la: number;
		try {
			this.state = 407;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 54:
			case 55:
				localctx = new BooleanConstantContext(this, localctx);
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 403;
				_la = this._input.LA(1);
				if(!(_la===54 || _la===55)) {
				this._errHandler.recoverInline(this);
				}
				else {
					this._errHandler.reportMatch(this);
				    this.consume();
				}
				}
				break;
			case 59:
				localctx = new LiteralConstantContext(this, localctx);
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 404;
				this.match(HazeParser.UNIT_LITERAL);
				}
				break;
			case 60:
				localctx = new LiteralConstantContext(this, localctx);
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 405;
				this.match(HazeParser.NUMBER_LITERAL);
				}
				break;
			case 58:
				localctx = new StringConstantContext(this, localctx);
				this.enterOuterAlt(localctx, 4);
				{
				this.state = 406;
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
	public structcontent(): StructcontentContext {
		let localctx: StructcontentContext = new StructcontentContext(this, this._ctx, this.state);
		this.enterRule(localctx, 52, HazeParser.RULE_structcontent);
		let _la: number;
		try {
			this.state = 435;
			this._errHandler.sync(this);
			switch ( this._interp.adaptivePredict(this._input, 50, this._ctx) ) {
			case 1:
				localctx = new StructMemberContext(this, localctx);
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 409;
				this.match(HazeParser.ID);
				this.state = 410;
				this.match(HazeParser.T__7);
				this.state = 411;
				this.datatype();
				this.state = 412;
				this.match(HazeParser.T__11);
				}
				break;
			case 2:
				localctx = new StructMethodContext(this, localctx);
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 414;
				this.match(HazeParser.ID);
				this.state = 415;
				this.match(HazeParser.T__5);
				this.state = 416;
				this.params();
				this.state = 417;
				this.match(HazeParser.T__6);
				this.state = 420;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===8) {
					{
					this.state = 418;
					this.match(HazeParser.T__7);
					this.state = 419;
					this.datatype();
					}
				}

				this.state = 424;
				this._errHandler.sync(this);
				switch (this._input.LA(1)) {
				case 4:
				case 9:
					{
					this.state = 422;
					this.funcbody();
					}
					break;
				case 12:
					{
					this.state = 423;
					this.match(HazeParser.T__11);
					}
					break;
				default:
					throw new NoViableAltException(this);
				}
				}
				break;
			case 3:
				localctx = new StructUnionFieldsContext(this, localctx);
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 426;
				this.match(HazeParser.T__55);
				this.state = 427;
				this.match(HazeParser.T__3);
				this.state = 431;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===56 || _la===61) {
					{
					{
					this.state = 428;
					this.structcontent();
					}
					}
					this.state = 433;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 434;
				this.match(HazeParser.T__4);
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
		this.enterRule(localctx, 54, HazeParser.RULE_structdecl);
		let _la: number;
		try {
			localctx = new StructDeclContext(this, localctx);
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 438;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===1) {
				{
				this.state = 437;
				(localctx as StructDeclContext)._export_ = this.match(HazeParser.T__0);
				}
			}

			this.state = 442;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===13) {
				{
				this.state = 440;
				this.match(HazeParser.T__12);
				this.state = 441;
				this.externlang();
				}
			}

			this.state = 444;
			this.match(HazeParser.T__56);
			this.state = 445;
			this.match(HazeParser.ID);
			this.state = 456;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===34) {
				{
				this.state = 446;
				this.match(HazeParser.T__33);
				this.state = 447;
				this.match(HazeParser.ID);
				this.state = 452;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===10) {
					{
					{
					this.state = 448;
					this.match(HazeParser.T__9);
					this.state = 449;
					this.match(HazeParser.ID);
					}
					}
					this.state = 454;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 455;
				this.match(HazeParser.T__34);
				}
			}

			this.state = 458;
			this.match(HazeParser.T__3);
			this.state = 462;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===56 || _la===61) {
				{
				{
				this.state = 459;
				this.structcontent();
				}
				}
				this.state = 464;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 465;
			this.match(HazeParser.T__4);
			this.state = 467;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===12) {
				{
				this.state = 466;
				this.match(HazeParser.T__11);
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
		this.enterRule(localctx, 56, HazeParser.RULE_datatype);
		try {
			let _alt: number;
			this.state = 478;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 61:
				localctx = new CommonDatatypeContext(this, localctx);
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 469;
				this.datatypeimpl();
				this.state = 474;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 57, this._ctx);
				while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
					if (_alt === 1) {
						{
						{
						this.state = 470;
						this.match(HazeParser.T__2);
						this.state = 471;
						this.datatypeimpl();
						}
						}
					}
					this.state = 476;
					this._errHandler.sync(this);
					_alt = this._interp.adaptivePredict(this._input, 57, this._ctx);
				}
				}
				break;
			case 6:
				localctx = new FunctionDatatypeContext(this, localctx);
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 477;
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
	// @RuleVersion(0)
	public datatypeimpl(): DatatypeimplContext {
		let localctx: DatatypeimplContext = new DatatypeimplContext(this, this._ctx, this.state);
		this.enterRule(localctx, 58, HazeParser.RULE_datatypeimpl);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 480;
			this.match(HazeParser.ID);
			this.state = 492;
			this._errHandler.sync(this);
			switch ( this._interp.adaptivePredict(this._input, 60, this._ctx) ) {
			case 1:
				{
				this.state = 481;
				this.match(HazeParser.T__33);
				this.state = 482;
				localctx._genericsvalue = this.genericsvalue();
				localctx._generics.push(localctx._genericsvalue);
				this.state = 487;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===10) {
					{
					{
					this.state = 483;
					this.match(HazeParser.T__9);
					this.state = 484;
					localctx._genericsvalue = this.genericsvalue();
					localctx._generics.push(localctx._genericsvalue);
					}
					}
					this.state = 489;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 490;
				this.match(HazeParser.T__34);
				}
				break;
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
	public genericsvalue(): GenericsvalueContext {
		let localctx: GenericsvalueContext = new GenericsvalueContext(this, this._ctx, this.state);
		this.enterRule(localctx, 60, HazeParser.RULE_genericsvalue);
		try {
			this.state = 496;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 6:
			case 61:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 494;
				this.datatype();
				}
				break;
			case 54:
			case 55:
			case 58:
			case 59:
			case 60:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 495;
				this.constant();
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
		case 21:
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

	public static readonly _serializedATN: number[] = [4,1,63,499,2,0,7,0,2,
	1,7,1,2,2,7,2,2,3,7,3,2,4,7,4,2,5,7,5,2,6,7,6,2,7,7,7,2,8,7,8,2,9,7,9,2,
	10,7,10,2,11,7,11,2,12,7,12,2,13,7,13,2,14,7,14,2,15,7,15,2,16,7,16,2,17,
	7,17,2,18,7,18,2,19,7,19,2,20,7,20,2,21,7,21,2,22,7,22,2,23,7,23,2,24,7,
	24,2,25,7,25,2,26,7,26,2,27,7,27,2,28,7,28,2,29,7,29,2,30,7,30,1,0,1,0,
	1,0,1,0,1,0,1,0,5,0,69,8,0,10,0,12,0,72,9,0,1,1,1,1,1,1,1,1,1,1,5,1,79,
	8,1,10,1,12,1,82,9,1,1,2,3,2,85,8,2,1,2,1,2,1,2,1,2,5,2,91,8,2,10,2,12,
	2,94,9,2,1,2,1,2,1,2,1,2,1,3,3,3,101,8,3,1,3,1,3,1,3,1,3,1,3,1,3,3,3,109,
	8,3,1,3,1,3,1,4,1,4,1,4,1,4,1,4,3,4,118,8,4,1,4,1,4,1,5,3,5,123,8,5,1,5,
	1,5,1,5,1,5,1,5,1,5,3,5,131,8,5,1,6,5,6,134,8,6,10,6,12,6,137,9,6,1,7,1,
	7,1,7,1,7,1,8,1,8,1,8,5,8,146,8,8,10,8,12,8,149,9,8,1,8,1,8,3,8,153,8,8,
	3,8,155,8,8,1,8,3,8,158,8,8,1,9,1,9,1,9,1,9,1,10,3,10,165,8,10,1,10,1,10,
	3,10,169,8,10,3,10,171,8,10,1,10,1,10,5,10,175,8,10,10,10,12,10,178,9,10,
	1,10,1,10,1,10,1,10,1,10,1,10,3,10,186,8,10,1,10,1,10,1,11,1,11,1,12,1,
	12,1,13,1,13,1,14,1,14,1,15,1,15,1,16,1,16,1,17,1,17,1,18,3,18,205,8,18,
	1,18,1,18,3,18,209,8,18,3,18,211,8,18,1,18,1,18,1,18,1,18,3,18,217,8,18,
	1,18,1,18,1,18,1,18,1,18,3,18,224,8,18,1,18,1,18,3,18,228,8,18,3,18,230,
	8,18,1,18,1,18,1,18,1,18,1,18,1,18,1,18,3,18,239,8,18,1,19,1,19,1,19,1,
	19,1,19,1,19,1,19,1,19,1,19,1,19,3,19,251,8,19,1,19,1,19,1,19,1,19,1,19,
	1,19,1,19,1,19,1,19,1,19,1,19,1,19,1,19,1,19,5,19,267,8,19,10,19,12,19,
	270,9,19,1,19,1,19,1,19,1,19,1,19,3,19,277,8,19,1,19,1,19,1,19,1,19,1,19,
	1,19,3,19,285,8,19,1,20,1,20,1,20,1,20,1,20,1,21,1,21,1,21,1,21,1,21,1,
	21,1,21,1,21,1,21,1,21,3,21,302,8,21,1,21,1,21,5,21,306,8,21,10,21,12,21,
	309,9,21,1,21,3,21,312,8,21,1,21,1,21,1,21,1,21,1,21,1,21,1,21,1,21,1,21,
	1,21,1,21,1,21,3,21,326,8,21,1,21,1,21,1,21,3,21,331,8,21,5,21,333,8,21,
	10,21,12,21,336,9,21,1,21,1,21,3,21,340,8,21,3,21,342,8,21,1,21,1,21,1,
	21,1,21,1,21,1,21,1,21,1,21,1,21,1,21,1,21,1,21,1,21,1,21,1,21,3,21,359,
	8,21,1,21,1,21,1,21,1,21,1,21,1,21,1,21,1,21,1,21,1,21,1,21,1,21,1,21,1,
	21,1,21,1,21,1,21,1,21,1,21,1,21,5,21,381,8,21,10,21,12,21,384,9,21,1,22,
	1,22,1,22,5,22,389,8,22,10,22,12,22,392,9,22,3,22,394,8,22,1,23,1,23,1,
	24,1,24,1,24,1,24,1,24,1,24,1,25,1,25,1,25,1,25,3,25,408,8,25,1,26,1,26,
	1,26,1,26,1,26,1,26,1,26,1,26,1,26,1,26,1,26,3,26,421,8,26,1,26,1,26,3,
	26,425,8,26,1,26,1,26,1,26,5,26,430,8,26,10,26,12,26,433,9,26,1,26,3,26,
	436,8,26,1,27,3,27,439,8,27,1,27,1,27,3,27,443,8,27,1,27,1,27,1,27,1,27,
	1,27,1,27,5,27,451,8,27,10,27,12,27,454,9,27,1,27,3,27,457,8,27,1,27,1,
	27,5,27,461,8,27,10,27,12,27,464,9,27,1,27,1,27,3,27,468,8,27,1,28,1,28,
	1,28,5,28,473,8,28,10,28,12,28,476,9,28,1,28,3,28,479,8,28,1,29,1,29,1,
	29,1,29,1,29,5,29,486,8,29,10,29,12,29,489,9,29,1,29,1,29,3,29,493,8,29,
	1,30,1,30,3,30,497,8,30,1,30,0,1,42,31,0,2,4,6,8,10,12,14,16,18,20,22,24,
	26,28,30,32,34,36,38,40,42,44,46,48,50,52,54,56,58,60,0,10,1,0,14,15,1,
	0,16,17,1,0,24,25,1,0,26,27,1,0,28,29,1,0,31,33,1,0,34,37,1,0,41,42,2,0,
	18,18,43,52,1,0,54,55,559,0,70,1,0,0,0,2,80,1,0,0,0,4,84,1,0,0,0,6,100,
	1,0,0,0,8,112,1,0,0,0,10,130,1,0,0,0,12,135,1,0,0,0,14,138,1,0,0,0,16,157,
	1,0,0,0,18,159,1,0,0,0,20,164,1,0,0,0,22,189,1,0,0,0,24,191,1,0,0,0,26,
	193,1,0,0,0,28,195,1,0,0,0,30,197,1,0,0,0,32,199,1,0,0,0,34,201,1,0,0,0,
	36,238,1,0,0,0,38,284,1,0,0,0,40,286,1,0,0,0,42,341,1,0,0,0,44,393,1,0,
	0,0,46,395,1,0,0,0,48,397,1,0,0,0,50,407,1,0,0,0,52,435,1,0,0,0,54,438,
	1,0,0,0,56,478,1,0,0,0,58,480,1,0,0,0,60,496,1,0,0,0,62,69,3,18,9,0,63,
	69,3,6,3,0,64,69,3,20,10,0,65,69,3,54,27,0,66,69,3,4,2,0,67,69,3,36,18,
	0,68,62,1,0,0,0,68,63,1,0,0,0,68,64,1,0,0,0,68,65,1,0,0,0,68,66,1,0,0,0,
	68,67,1,0,0,0,69,72,1,0,0,0,70,68,1,0,0,0,70,71,1,0,0,0,71,1,1,0,0,0,72,
	70,1,0,0,0,73,79,3,6,3,0,74,79,3,20,10,0,75,79,3,54,27,0,76,79,3,4,2,0,
	77,79,3,36,18,0,78,73,1,0,0,0,78,74,1,0,0,0,78,75,1,0,0,0,78,76,1,0,0,0,
	78,77,1,0,0,0,79,82,1,0,0,0,80,78,1,0,0,0,80,81,1,0,0,0,81,3,1,0,0,0,82,
	80,1,0,0,0,83,85,5,1,0,0,84,83,1,0,0,0,84,85,1,0,0,0,85,86,1,0,0,0,86,87,
	5,2,0,0,87,92,5,61,0,0,88,89,5,3,0,0,89,91,5,61,0,0,90,88,1,0,0,0,91,94,
	1,0,0,0,92,90,1,0,0,0,92,93,1,0,0,0,93,95,1,0,0,0,94,92,1,0,0,0,95,96,5,
	4,0,0,96,97,3,2,1,0,97,98,5,5,0,0,98,5,1,0,0,0,99,101,5,1,0,0,100,99,1,
	0,0,0,100,101,1,0,0,0,101,102,1,0,0,0,102,103,5,61,0,0,103,104,5,6,0,0,
	104,105,3,16,8,0,105,108,5,7,0,0,106,107,5,8,0,0,107,109,3,56,28,0,108,
	106,1,0,0,0,108,109,1,0,0,0,109,110,1,0,0,0,110,111,3,10,5,0,111,7,1,0,
	0,0,112,113,5,6,0,0,113,114,3,16,8,0,114,117,5,7,0,0,115,116,5,8,0,0,116,
	118,3,56,28,0,117,115,1,0,0,0,117,118,1,0,0,0,118,119,1,0,0,0,119,120,3,
	10,5,0,120,9,1,0,0,0,121,123,5,9,0,0,122,121,1,0,0,0,122,123,1,0,0,0,123,
	124,1,0,0,0,124,125,5,4,0,0,125,126,3,12,6,0,126,127,5,5,0,0,127,131,1,
	0,0,0,128,129,5,9,0,0,129,131,3,42,21,0,130,122,1,0,0,0,130,128,1,0,0,0,
	131,11,1,0,0,0,132,134,3,38,19,0,133,132,1,0,0,0,134,137,1,0,0,0,135,133,
	1,0,0,0,135,136,1,0,0,0,136,13,1,0,0,0,137,135,1,0,0,0,138,139,5,61,0,0,
	139,140,5,8,0,0,140,141,3,56,28,0,141,15,1,0,0,0,142,147,3,14,7,0,143,144,
	5,10,0,0,144,146,3,14,7,0,145,143,1,0,0,0,146,149,1,0,0,0,147,145,1,0,0,
	0,147,148,1,0,0,0,148,152,1,0,0,0,149,147,1,0,0,0,150,151,5,10,0,0,151,
	153,3,46,23,0,152,150,1,0,0,0,152,153,1,0,0,0,153,155,1,0,0,0,154,142,1,
	0,0,0,154,155,1,0,0,0,155,158,1,0,0,0,156,158,3,46,23,0,157,154,1,0,0,0,
	157,156,1,0,0,0,158,17,1,0,0,0,159,160,5,11,0,0,160,161,5,58,0,0,161,162,
	5,12,0,0,162,19,1,0,0,0,163,165,5,1,0,0,164,163,1,0,0,0,164,165,1,0,0,0,
	165,170,1,0,0,0,166,168,5,13,0,0,167,169,3,22,11,0,168,167,1,0,0,0,168,
	169,1,0,0,0,169,171,1,0,0,0,170,166,1,0,0,0,170,171,1,0,0,0,171,176,1,0,
	0,0,172,173,5,61,0,0,173,175,5,3,0,0,174,172,1,0,0,0,175,178,1,0,0,0,176,
	174,1,0,0,0,176,177,1,0,0,0,177,179,1,0,0,0,178,176,1,0,0,0,179,180,5,61,
	0,0,180,181,5,6,0,0,181,182,3,16,8,0,182,185,5,7,0,0,183,184,5,8,0,0,184,
	186,3,56,28,0,185,183,1,0,0,0,185,186,1,0,0,0,186,187,1,0,0,0,187,188,5,
	12,0,0,188,21,1,0,0,0,189,190,7,0,0,0,190,23,1,0,0,0,191,192,3,42,21,0,
	192,25,1,0,0,0,193,194,3,42,21,0,194,27,1,0,0,0,195,196,3,12,6,0,196,29,
	1,0,0,0,197,198,3,12,6,0,198,31,1,0,0,0,199,200,3,12,6,0,200,33,1,0,0,0,
	201,202,7,1,0,0,202,35,1,0,0,0,203,205,5,1,0,0,204,203,1,0,0,0,204,205,
	1,0,0,0,205,210,1,0,0,0,206,208,5,13,0,0,207,209,3,22,11,0,208,207,1,0,
	0,0,208,209,1,0,0,0,209,211,1,0,0,0,210,206,1,0,0,0,210,211,1,0,0,0,211,
	212,1,0,0,0,212,213,3,34,17,0,213,216,5,61,0,0,214,215,5,8,0,0,215,217,
	3,56,28,0,216,214,1,0,0,0,216,217,1,0,0,0,217,218,1,0,0,0,218,219,5,18,
	0,0,219,220,3,42,21,0,220,221,5,12,0,0,221,239,1,0,0,0,222,224,5,1,0,0,
	223,222,1,0,0,0,223,224,1,0,0,0,224,229,1,0,0,0,225,227,5,13,0,0,226,228,
	3,22,11,0,227,226,1,0,0,0,227,228,1,0,0,0,228,230,1,0,0,0,229,225,1,0,0,
	0,229,230,1,0,0,0,230,231,1,0,0,0,231,232,3,34,17,0,232,233,5,61,0,0,233,
	234,5,8,0,0,234,235,3,56,28,0,235,236,1,0,0,0,236,237,5,12,0,0,237,239,
	1,0,0,0,238,204,1,0,0,0,238,223,1,0,0,0,239,37,1,0,0,0,240,241,5,19,0,0,
	241,242,5,6,0,0,242,243,5,58,0,0,243,244,5,7,0,0,244,285,5,12,0,0,245,246,
	3,42,21,0,246,247,5,12,0,0,247,285,1,0,0,0,248,250,5,20,0,0,249,251,3,42,
	21,0,250,249,1,0,0,0,250,251,1,0,0,0,251,252,1,0,0,0,252,285,5,12,0,0,253,
	285,3,36,18,0,254,255,5,21,0,0,255,256,3,24,12,0,256,257,5,4,0,0,257,258,
	3,28,14,0,258,268,5,5,0,0,259,260,5,22,0,0,260,261,5,21,0,0,261,262,3,26,
	13,0,262,263,5,4,0,0,263,264,3,30,15,0,264,265,5,5,0,0,265,267,1,0,0,0,
	266,259,1,0,0,0,267,270,1,0,0,0,268,266,1,0,0,0,268,269,1,0,0,0,269,276,
	1,0,0,0,270,268,1,0,0,0,271,272,5,22,0,0,272,273,5,4,0,0,273,274,3,32,16,
	0,274,275,5,5,0,0,275,277,1,0,0,0,276,271,1,0,0,0,276,277,1,0,0,0,277,285,
	1,0,0,0,278,279,5,23,0,0,279,280,3,42,21,0,280,281,5,4,0,0,281,282,3,12,
	6,0,282,283,5,5,0,0,283,285,1,0,0,0,284,240,1,0,0,0,284,245,1,0,0,0,284,
	248,1,0,0,0,284,253,1,0,0,0,284,254,1,0,0,0,284,278,1,0,0,0,285,39,1,0,
	0,0,286,287,5,3,0,0,287,288,5,61,0,0,288,289,5,8,0,0,289,290,3,42,21,0,
	290,41,1,0,0,0,291,292,6,21,-1,0,292,293,5,6,0,0,293,294,3,42,21,0,294,
	295,5,7,0,0,295,342,1,0,0,0,296,342,3,8,4,0,297,342,3,50,25,0,298,299,3,
	56,28,0,299,301,5,4,0,0,300,302,3,40,20,0,301,300,1,0,0,0,301,302,1,0,0,
	0,302,307,1,0,0,0,303,304,5,10,0,0,304,306,3,40,20,0,305,303,1,0,0,0,306,
	309,1,0,0,0,307,305,1,0,0,0,307,308,1,0,0,0,308,311,1,0,0,0,309,307,1,0,
	0,0,310,312,5,10,0,0,311,310,1,0,0,0,311,312,1,0,0,0,312,313,1,0,0,0,313,
	314,5,5,0,0,314,342,1,0,0,0,315,316,7,2,0,0,316,342,3,42,21,11,317,318,
	7,3,0,0,318,342,3,42,21,10,319,320,7,4,0,0,320,342,3,42,21,9,321,339,5,
	61,0,0,322,325,5,34,0,0,323,326,3,56,28,0,324,326,3,50,25,0,325,323,1,0,
	0,0,325,324,1,0,0,0,326,334,1,0,0,0,327,330,5,10,0,0,328,331,3,56,28,0,
	329,331,3,50,25,0,330,328,1,0,0,0,330,329,1,0,0,0,331,333,1,0,0,0,332,327,
	1,0,0,0,333,336,1,0,0,0,334,332,1,0,0,0,334,335,1,0,0,0,335,337,1,0,0,0,
	336,334,1,0,0,0,337,338,5,35,0,0,338,340,1,0,0,0,339,322,1,0,0,0,339,340,
	1,0,0,0,340,342,1,0,0,0,341,291,1,0,0,0,341,296,1,0,0,0,341,297,1,0,0,0,
	341,298,1,0,0,0,341,315,1,0,0,0,341,317,1,0,0,0,341,319,1,0,0,0,341,321,
	1,0,0,0,342,382,1,0,0,0,343,344,10,7,0,0,344,345,7,5,0,0,345,381,3,42,21,
	8,346,347,10,6,0,0,347,348,7,3,0,0,348,381,3,42,21,7,349,350,10,5,0,0,350,
	351,7,6,0,0,351,381,3,42,21,6,352,358,10,4,0,0,353,359,5,38,0,0,354,359,
	5,39,0,0,355,359,5,40,0,0,356,357,5,40,0,0,357,359,5,28,0,0,358,353,1,0,
	0,0,358,354,1,0,0,0,358,355,1,0,0,0,358,356,1,0,0,0,359,360,1,0,0,0,360,
	381,3,42,21,5,361,362,10,3,0,0,362,363,7,7,0,0,363,381,3,42,21,4,364,365,
	10,2,0,0,365,366,7,8,0,0,366,381,3,42,21,3,367,368,10,15,0,0,368,381,7,
	2,0,0,369,370,10,14,0,0,370,371,5,6,0,0,371,372,3,44,22,0,372,373,5,7,0,
	0,373,381,1,0,0,0,374,375,10,13,0,0,375,376,5,3,0,0,376,381,5,61,0,0,377,
	378,10,8,0,0,378,379,5,30,0,0,379,381,3,56,28,0,380,343,1,0,0,0,380,346,
	1,0,0,0,380,349,1,0,0,0,380,352,1,0,0,0,380,361,1,0,0,0,380,364,1,0,0,0,
	380,367,1,0,0,0,380,369,1,0,0,0,380,374,1,0,0,0,380,377,1,0,0,0,381,384,
	1,0,0,0,382,380,1,0,0,0,382,383,1,0,0,0,383,43,1,0,0,0,384,382,1,0,0,0,
	385,390,3,42,21,0,386,387,5,10,0,0,387,389,3,42,21,0,388,386,1,0,0,0,389,
	392,1,0,0,0,390,388,1,0,0,0,390,391,1,0,0,0,391,394,1,0,0,0,392,390,1,0,
	0,0,393,385,1,0,0,0,393,394,1,0,0,0,394,45,1,0,0,0,395,396,5,53,0,0,396,
	47,1,0,0,0,397,398,5,6,0,0,398,399,3,16,8,0,399,400,5,7,0,0,400,401,5,9,
	0,0,401,402,3,56,28,0,402,49,1,0,0,0,403,408,7,9,0,0,404,408,5,59,0,0,405,
	408,5,60,0,0,406,408,5,58,0,0,407,403,1,0,0,0,407,404,1,0,0,0,407,405,1,
	0,0,0,407,406,1,0,0,0,408,51,1,0,0,0,409,410,5,61,0,0,410,411,5,8,0,0,411,
	412,3,56,28,0,412,413,5,12,0,0,413,436,1,0,0,0,414,415,5,61,0,0,415,416,
	5,6,0,0,416,417,3,16,8,0,417,420,5,7,0,0,418,419,5,8,0,0,419,421,3,56,28,
	0,420,418,1,0,0,0,420,421,1,0,0,0,421,424,1,0,0,0,422,425,3,10,5,0,423,
	425,5,12,0,0,424,422,1,0,0,0,424,423,1,0,0,0,425,436,1,0,0,0,426,427,5,
	56,0,0,427,431,5,4,0,0,428,430,3,52,26,0,429,428,1,0,0,0,430,433,1,0,0,
	0,431,429,1,0,0,0,431,432,1,0,0,0,432,434,1,0,0,0,433,431,1,0,0,0,434,436,
	5,5,0,0,435,409,1,0,0,0,435,414,1,0,0,0,435,426,1,0,0,0,436,53,1,0,0,0,
	437,439,5,1,0,0,438,437,1,0,0,0,438,439,1,0,0,0,439,442,1,0,0,0,440,441,
	5,13,0,0,441,443,3,22,11,0,442,440,1,0,0,0,442,443,1,0,0,0,443,444,1,0,
	0,0,444,445,5,57,0,0,445,456,5,61,0,0,446,447,5,34,0,0,447,452,5,61,0,0,
	448,449,5,10,0,0,449,451,5,61,0,0,450,448,1,0,0,0,451,454,1,0,0,0,452,450,
	1,0,0,0,452,453,1,0,0,0,453,455,1,0,0,0,454,452,1,0,0,0,455,457,5,35,0,
	0,456,446,1,0,0,0,456,457,1,0,0,0,457,458,1,0,0,0,458,462,5,4,0,0,459,461,
	3,52,26,0,460,459,1,0,0,0,461,464,1,0,0,0,462,460,1,0,0,0,462,463,1,0,0,
	0,463,465,1,0,0,0,464,462,1,0,0,0,465,467,5,5,0,0,466,468,5,12,0,0,467,
	466,1,0,0,0,467,468,1,0,0,0,468,55,1,0,0,0,469,474,3,58,29,0,470,471,5,
	3,0,0,471,473,3,58,29,0,472,470,1,0,0,0,473,476,1,0,0,0,474,472,1,0,0,0,
	474,475,1,0,0,0,475,479,1,0,0,0,476,474,1,0,0,0,477,479,3,48,24,0,478,469,
	1,0,0,0,478,477,1,0,0,0,479,57,1,0,0,0,480,492,5,61,0,0,481,482,5,34,0,
	0,482,487,3,60,30,0,483,484,5,10,0,0,484,486,3,60,30,0,485,483,1,0,0,0,
	486,489,1,0,0,0,487,485,1,0,0,0,487,488,1,0,0,0,488,490,1,0,0,0,489,487,
	1,0,0,0,490,491,5,35,0,0,491,493,1,0,0,0,492,481,1,0,0,0,492,493,1,0,0,
	0,493,59,1,0,0,0,494,497,3,56,28,0,495,497,3,50,25,0,496,494,1,0,0,0,496,
	495,1,0,0,0,497,61,1,0,0,0,62,68,70,78,80,84,92,100,108,117,122,130,135,
	147,152,154,157,164,168,170,176,185,204,208,210,216,223,227,229,238,250,
	268,276,284,301,307,311,325,330,334,339,341,358,380,382,390,393,407,420,
	424,431,435,438,442,452,456,462,467,474,478,487,492,496];

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
	public structdecl_list(): StructdeclContext[] {
		return this.getTypedRuleContexts(StructdeclContext) as StructdeclContext[];
	}
	public structdecl(i: number): StructdeclContext {
		return this.getTypedRuleContext(StructdeclContext, i) as StructdeclContext;
	}
	public namespace_list(): NamespaceContext[] {
		return this.getTypedRuleContexts(NamespaceContext) as NamespaceContext[];
	}
	public namespace(i: number): NamespaceContext {
		return this.getTypedRuleContext(NamespaceContext, i) as NamespaceContext;
	}
	public variablestatement_list(): VariablestatementContext[] {
		return this.getTypedRuleContexts(VariablestatementContext) as VariablestatementContext[];
	}
	public variablestatement(i: number): VariablestatementContext {
		return this.getTypedRuleContext(VariablestatementContext, i) as VariablestatementContext;
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


export class NamespacecontentContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
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
	public structdecl_list(): StructdeclContext[] {
		return this.getTypedRuleContexts(StructdeclContext) as StructdeclContext[];
	}
	public structdecl(i: number): StructdeclContext {
		return this.getTypedRuleContext(StructdeclContext, i) as StructdeclContext;
	}
	public namespace_list(): NamespaceContext[] {
		return this.getTypedRuleContexts(NamespaceContext) as NamespaceContext[];
	}
	public namespace(i: number): NamespaceContext {
		return this.getTypedRuleContext(NamespaceContext, i) as NamespaceContext;
	}
	public variablestatement_list(): VariablestatementContext[] {
		return this.getTypedRuleContexts(VariablestatementContext) as VariablestatementContext[];
	}
	public variablestatement(i: number): VariablestatementContext {
		return this.getTypedRuleContext(VariablestatementContext, i) as VariablestatementContext;
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_namespacecontent;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterNamespacecontent) {
	 		listener.enterNamespacecontent(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitNamespacecontent) {
	 		listener.exitNamespacecontent(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitNamespacecontent) {
			return visitor.visitNamespacecontent(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class NamespaceContext extends ParserRuleContext {
	public _export_!: Token;
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
	public namespacecontent(): NamespacecontentContext {
		return this.getTypedRuleContext(NamespacecontentContext, 0) as NamespacecontentContext;
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_namespace;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterNamespace) {
	 		listener.enterNamespace(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitNamespace) {
	 		listener.exitNamespace(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitNamespace) {
			return visitor.visitNamespace(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class NamedfuncContext extends ParserRuleContext {
	public _export_!: Token;
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
	public _export_!: Token;
	public _extern!: Token;
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
	public datatype(): DatatypeContext {
		return this.getTypedRuleContext(DatatypeContext, 0) as DatatypeContext;
	}
	public externlang(): ExternlangContext {
		return this.getTypedRuleContext(ExternlangContext, 0) as ExternlangContext;
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


export class VariablestatementContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_variablestatement;
	}
	public override copyFrom(ctx: VariablestatementContext): void {
		super.copyFrom(ctx);
	}
}
export class VariableDefinitionContext extends VariablestatementContext {
	public _export_!: Token;
	public _extern!: Token;
	constructor(parser: HazeParser, ctx: VariablestatementContext) {
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
	public externlang(): ExternlangContext {
		return this.getTypedRuleContext(ExternlangContext, 0) as ExternlangContext;
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
export class VariableDeclarationContext extends VariablestatementContext {
	public _export_!: Token;
	public _extern!: Token;
	constructor(parser: HazeParser, ctx: VariablestatementContext) {
		super(parser, ctx.parentCtx, ctx.invokingState);
		super.copyFrom(ctx);
	}
	public variablemutability(): VariablemutabilityContext {
		return this.getTypedRuleContext(VariablemutabilityContext, 0) as VariablemutabilityContext;
	}
	public ID(): TerminalNode {
		return this.getToken(HazeParser.ID, 0);
	}
	public datatype(): DatatypeContext {
		return this.getTypedRuleContext(DatatypeContext, 0) as DatatypeContext;
	}
	public externlang(): ExternlangContext {
		return this.getTypedRuleContext(ExternlangContext, 0) as ExternlangContext;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterVariableDeclaration) {
	 		listener.enterVariableDeclaration(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitVariableDeclaration) {
	 		listener.exitVariableDeclaration(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitVariableDeclaration) {
			return visitor.visitVariableDeclaration(this);
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
export class VariableStatementContext extends StatementContext {
	constructor(parser: HazeParser, ctx: StatementContext) {
		super(parser, ctx.parentCtx, ctx.invokingState);
		super.copyFrom(ctx);
	}
	public variablestatement(): VariablestatementContext {
		return this.getTypedRuleContext(VariablestatementContext, 0) as VariablestatementContext;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterVariableStatement) {
	 		listener.enterVariableStatement(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitVariableStatement) {
	 		listener.exitVariableStatement(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitVariableStatement) {
			return visitor.visitVariableStatement(this);
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
	public constant_list(): ConstantContext[] {
		return this.getTypedRuleContexts(ConstantContext) as ConstantContext[];
	}
	public constant(i: number): ConstantContext {
		return this.getTypedRuleContext(ConstantContext, i) as ConstantContext;
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
export class StructUnionFieldsContext extends StructcontentContext {
	constructor(parser: HazeParser, ctx: StructcontentContext) {
		super(parser, ctx.parentCtx, ctx.invokingState);
		super.copyFrom(ctx);
	}
	public structcontent_list(): StructcontentContext[] {
		return this.getTypedRuleContexts(StructcontentContext) as StructcontentContext[];
	}
	public structcontent(i: number): StructcontentContext {
		return this.getTypedRuleContext(StructcontentContext, i) as StructcontentContext;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterStructUnionFields) {
	 		listener.enterStructUnionFields(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitStructUnionFields) {
	 		listener.exitStructUnionFields(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitStructUnionFields) {
			return visitor.visitStructUnionFields(this);
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
	public _export_!: Token;
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
	public datatypeimpl_list(): DatatypeimplContext[] {
		return this.getTypedRuleContexts(DatatypeimplContext) as DatatypeimplContext[];
	}
	public datatypeimpl(i: number): DatatypeimplContext {
		return this.getTypedRuleContext(DatatypeimplContext, i) as DatatypeimplContext;
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


export class DatatypeimplContext extends ParserRuleContext {
	public _genericsvalue!: GenericsvalueContext;
	public _generics: GenericsvalueContext[] = [];
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public ID(): TerminalNode {
		return this.getToken(HazeParser.ID, 0);
	}
	public genericsvalue_list(): GenericsvalueContext[] {
		return this.getTypedRuleContexts(GenericsvalueContext) as GenericsvalueContext[];
	}
	public genericsvalue(i: number): GenericsvalueContext {
		return this.getTypedRuleContext(GenericsvalueContext, i) as GenericsvalueContext;
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_datatypeimpl;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterDatatypeimpl) {
	 		listener.enterDatatypeimpl(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitDatatypeimpl) {
	 		listener.exitDatatypeimpl(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitDatatypeimpl) {
			return visitor.visitDatatypeimpl(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class GenericsvalueContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public datatype(): DatatypeContext {
		return this.getTypedRuleContext(DatatypeContext, 0) as DatatypeContext;
	}
	public constant(): ConstantContext {
		return this.getTypedRuleContext(ConstantContext, 0) as ConstantContext;
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_genericsvalue;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterGenericsvalue) {
	 		listener.enterGenericsvalue(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitGenericsvalue) {
	 		listener.exitGenericsvalue(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitGenericsvalue) {
			return visitor.visitGenericsvalue(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
