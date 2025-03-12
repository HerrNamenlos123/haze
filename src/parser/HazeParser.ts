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
	public static readonly T__57 = 58;
	public static readonly T__58 = 59;
	public static readonly T__59 = 60;
	public static readonly STRING_LITERAL = 61;
	public static readonly UNIT_LITERAL = 62;
	public static readonly NUMBER_LITERAL = 63;
	public static readonly ID = 64;
	public static readonly WS = 65;
	public static readonly COMMENT = 66;
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
	public static readonly RULE_prebuildcmd = 10;
	public static readonly RULE_postbuildcmd = 11;
	public static readonly RULE_funcdecl = 12;
	public static readonly RULE_externlang = 13;
	public static readonly RULE_ifexpr = 14;
	public static readonly RULE_elseifexpr = 15;
	public static readonly RULE_thenblock = 16;
	public static readonly RULE_elseifblock = 17;
	public static readonly RULE_elseblock = 18;
	public static readonly RULE_variablemutability = 19;
	public static readonly RULE_variablestatement = 20;
	public static readonly RULE_statement = 21;
	public static readonly RULE_structmembervalue = 22;
	public static readonly RULE_expr = 23;
	public static readonly RULE_args = 24;
	public static readonly RULE_ellipsis = 25;
	public static readonly RULE_functype = 26;
	public static readonly RULE_constant = 27;
	public static readonly RULE_compilationhint = 28;
	public static readonly RULE_compilationhintfilename = 29;
	public static readonly RULE_compilationhintflags = 30;
	public static readonly RULE_compilationlang = 31;
	public static readonly RULE_linkerhint = 32;
	public static readonly RULE_structcontent = 33;
	public static readonly RULE_structdecl = 34;
	public static readonly RULE_datatype = 35;
	public static readonly literalNames: (string | null)[] = [ null, "'namespace'", 
                                                            "'{'", "'}'", 
                                                            "'('", "')'", 
                                                            "':'", "'=>'", 
                                                            "','", "'inject'", 
                                                            "';'", "'prebuildcmd'", 
                                                            "'postbuildcmd'", 
                                                            "'declare'", 
                                                            "'.'", "'\"C\"'", 
                                                            "'\"C++\"'", 
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
                                                            "'false'", "'#compile'", 
                                                            "'link'", "'unsafe_union'", 
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
                                                             null, null, 
                                                             null, "STRING_LITERAL", 
                                                             "UNIT_LITERAL", 
                                                             "NUMBER_LITERAL", 
                                                             "ID", "WS", 
                                                             "COMMENT" ];
	// tslint:disable:no-trailing-whitespace
	public static readonly ruleNames: string[] = [
		"prog", "namespacecontent", "namespace", "namedfunc", "func", "funcbody", 
		"body", "param", "params", "cdefinitiondecl", "prebuildcmd", "postbuildcmd", 
		"funcdecl", "externlang", "ifexpr", "elseifexpr", "thenblock", "elseifblock", 
		"elseblock", "variablemutability", "variablestatement", "statement", "structmembervalue", 
		"expr", "args", "ellipsis", "functype", "constant", "compilationhint", 
		"compilationhintfilename", "compilationhintflags", "compilationlang", 
		"linkerhint", "structcontent", "structdecl", "datatype",
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
			this.state = 84;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while ((((_la) & ~0x1F) === 0 && ((1 << _la) & 408066) !== 0) || ((((_la - 57)) & ~0x1F) === 0 && ((1 << (_la - 57)) & 139) !== 0)) {
				{
				this.state = 82;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 0, this._ctx) ) {
				case 1:
					{
					this.state = 72;
					this.cdefinitiondecl();
					}
					break;
				case 2:
					{
					this.state = 73;
					this.prebuildcmd();
					}
					break;
				case 3:
					{
					this.state = 74;
					this.postbuildcmd();
					}
					break;
				case 4:
					{
					this.state = 75;
					this.namedfunc();
					}
					break;
				case 5:
					{
					this.state = 76;
					this.funcdecl();
					}
					break;
				case 6:
					{
					this.state = 77;
					this.compilationhint();
					}
					break;
				case 7:
					{
					this.state = 78;
					this.linkerhint();
					}
					break;
				case 8:
					{
					this.state = 79;
					this.structdecl();
					}
					break;
				case 9:
					{
					this.state = 80;
					this.namespace();
					}
					break;
				case 10:
					{
					this.state = 81;
					this.variablestatement();
					}
					break;
				}
				}
				this.state = 86;
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
			this.state = 96;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while ((((_la) & ~0x1F) === 0 && ((1 << _la) & 401410) !== 0) || ((((_la - 57)) & ~0x1F) === 0 && ((1 << (_la - 57)) & 139) !== 0)) {
				{
				this.state = 94;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 2, this._ctx) ) {
				case 1:
					{
					this.state = 87;
					this.namedfunc();
					}
					break;
				case 2:
					{
					this.state = 88;
					this.funcdecl();
					}
					break;
				case 3:
					{
					this.state = 89;
					this.compilationhint();
					}
					break;
				case 4:
					{
					this.state = 90;
					this.linkerhint();
					}
					break;
				case 5:
					{
					this.state = 91;
					this.structdecl();
					}
					break;
				case 6:
					{
					this.state = 92;
					this.namespace();
					}
					break;
				case 7:
					{
					this.state = 93;
					this.variablestatement();
					}
					break;
				}
				}
				this.state = 98;
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
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 99;
			this.match(HazeParser.T__0);
			this.state = 100;
			this.match(HazeParser.ID);
			this.state = 101;
			this.match(HazeParser.T__1);
			this.state = 102;
			this.namespacecontent();
			this.state = 103;
			this.match(HazeParser.T__2);
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
			this.state = 105;
			this.match(HazeParser.ID);
			this.state = 106;
			this.match(HazeParser.T__3);
			this.state = 107;
			this.params();
			this.state = 108;
			this.match(HazeParser.T__4);
			this.state = 111;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===6) {
				{
				this.state = 109;
				this.match(HazeParser.T__5);
				this.state = 110;
				this.datatype();
				}
			}

			this.state = 113;
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
			this.state = 115;
			this.match(HazeParser.T__3);
			this.state = 116;
			this.params();
			this.state = 117;
			this.match(HazeParser.T__4);
			this.state = 120;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===6) {
				{
				this.state = 118;
				this.match(HazeParser.T__5);
				this.state = 119;
				this.datatype();
				}
			}

			this.state = 122;
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
			this.state = 133;
			this._errHandler.sync(this);
			switch ( this._interp.adaptivePredict(this._input, 7, this._ctx) ) {
			case 1:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 125;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===7) {
					{
					this.state = 124;
					this.match(HazeParser.T__6);
					}
				}

				this.state = 127;
				this.match(HazeParser.T__1);
				this.state = 128;
				this.body();
				this.state = 129;
				this.match(HazeParser.T__2);
				}
				break;
			case 2:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 131;
				this.match(HazeParser.T__6);
				this.state = 132;
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
			this.state = 138;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while ((((_la) & ~0x1F) === 0 && ((1 << _la) & 2138439696) !== 0) || ((((_la - 55)) & ~0x1F) === 0 && ((1 << (_la - 55)) & 963) !== 0)) {
				{
				{
				this.state = 135;
				this.statement();
				}
				}
				this.state = 140;
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
			this.state = 141;
			this.match(HazeParser.ID);
			this.state = 142;
			this.match(HazeParser.T__5);
			this.state = 143;
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
			this.state = 160;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 5:
			case 64:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 157;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===64) {
					{
					this.state = 145;
					this.param();
					this.state = 150;
					this._errHandler.sync(this);
					_alt = this._interp.adaptivePredict(this._input, 9, this._ctx);
					while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
						if (_alt === 1) {
							{
							{
							this.state = 146;
							this.match(HazeParser.T__7);
							this.state = 147;
							this.param();
							}
							}
						}
						this.state = 152;
						this._errHandler.sync(this);
						_alt = this._interp.adaptivePredict(this._input, 9, this._ctx);
					}
					this.state = 155;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					if (_la===8) {
						{
						this.state = 153;
						this.match(HazeParser.T__7);
						this.state = 154;
						this.ellipsis();
						}
					}

					}
				}

				}
				break;
			case 54:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 159;
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
			this.state = 162;
			this.match(HazeParser.T__8);
			this.state = 163;
			this.match(HazeParser.STRING_LITERAL);
			this.state = 164;
			this.match(HazeParser.T__9);
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
	public prebuildcmd(): PrebuildcmdContext {
		let localctx: PrebuildcmdContext = new PrebuildcmdContext(this, this._ctx, this.state);
		this.enterRule(localctx, 20, HazeParser.RULE_prebuildcmd);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 166;
			this.match(HazeParser.T__10);
			this.state = 167;
			this.match(HazeParser.STRING_LITERAL);
			this.state = 168;
			this.match(HazeParser.T__9);
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
	public postbuildcmd(): PostbuildcmdContext {
		let localctx: PostbuildcmdContext = new PostbuildcmdContext(this, this._ctx, this.state);
		this.enterRule(localctx, 22, HazeParser.RULE_postbuildcmd);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 170;
			this.match(HazeParser.T__11);
			this.state = 171;
			this.match(HazeParser.STRING_LITERAL);
			this.state = 172;
			this.match(HazeParser.T__9);
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
		this.enterRule(localctx, 24, HazeParser.RULE_funcdecl);
		let _la: number;
		try {
			let _alt: number;
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 174;
			this.match(HazeParser.T__12);
			this.state = 176;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===15 || _la===16) {
				{
				this.state = 175;
				this.externlang();
				}
			}

			this.state = 182;
			this._errHandler.sync(this);
			_alt = this._interp.adaptivePredict(this._input, 14, this._ctx);
			while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
				if (_alt === 1) {
					{
					{
					this.state = 178;
					this.match(HazeParser.ID);
					this.state = 179;
					this.match(HazeParser.T__13);
					}
					}
				}
				this.state = 184;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 14, this._ctx);
			}
			this.state = 185;
			this.match(HazeParser.ID);
			this.state = 186;
			this.match(HazeParser.T__3);
			this.state = 187;
			this.params();
			this.state = 188;
			this.match(HazeParser.T__4);
			this.state = 191;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===6) {
				{
				this.state = 189;
				this.match(HazeParser.T__5);
				this.state = 190;
				this.datatype();
				}
			}

			this.state = 193;
			this.match(HazeParser.T__9);
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
		this.enterRule(localctx, 26, HazeParser.RULE_externlang);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 195;
			_la = this._input.LA(1);
			if(!(_la===15 || _la===16)) {
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
		this.enterRule(localctx, 28, HazeParser.RULE_ifexpr);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 197;
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
		this.enterRule(localctx, 30, HazeParser.RULE_elseifexpr);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 199;
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
		this.enterRule(localctx, 32, HazeParser.RULE_thenblock);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 201;
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
		this.enterRule(localctx, 34, HazeParser.RULE_elseifblock);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 203;
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
		this.enterRule(localctx, 36, HazeParser.RULE_elseblock);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 205;
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
		this.enterRule(localctx, 38, HazeParser.RULE_variablemutability);
		let _la: number;
		try {
			localctx = new VariableMutabilityContext(this, localctx);
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 207;
			_la = this._input.LA(1);
			if(!(_la===17 || _la===18)) {
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
		this.enterRule(localctx, 40, HazeParser.RULE_variablestatement);
		let _la: number;
		try {
			this.state = 226;
			this._errHandler.sync(this);
			switch ( this._interp.adaptivePredict(this._input, 17, this._ctx) ) {
			case 1:
				localctx = new VariableDefinitionContext(this, localctx);
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 209;
				this.variablemutability();
				this.state = 210;
				this.match(HazeParser.ID);
				this.state = 213;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===6) {
					{
					this.state = 211;
					this.match(HazeParser.T__5);
					this.state = 212;
					this.datatype();
					}
				}

				this.state = 215;
				this.match(HazeParser.T__18);
				this.state = 216;
				this.expr(0);
				this.state = 217;
				this.match(HazeParser.T__9);
				}
				break;
			case 2:
				localctx = new VariableDeclarationContext(this, localctx);
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 219;
				this.variablemutability();
				this.state = 220;
				this.match(HazeParser.ID);
				{
				this.state = 221;
				this.match(HazeParser.T__5);
				this.state = 222;
				this.datatype();
				}
				this.state = 224;
				this.match(HazeParser.T__9);
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
		this.enterRule(localctx, 42, HazeParser.RULE_statement);
		let _la: number;
		try {
			let _alt: number;
			this.state = 272;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 20:
				localctx = new InlineCStatementContext(this, localctx);
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 228;
				this.match(HazeParser.T__19);
				this.state = 229;
				this.match(HazeParser.T__3);
				this.state = 230;
				this.match(HazeParser.STRING_LITERAL);
				this.state = 231;
				this.match(HazeParser.T__4);
				this.state = 232;
				this.match(HazeParser.T__9);
				}
				break;
			case 4:
			case 25:
			case 26:
			case 27:
			case 28:
			case 29:
			case 30:
			case 55:
			case 56:
			case 61:
			case 62:
			case 63:
			case 64:
				localctx = new ExprStatementContext(this, localctx);
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 233;
				this.expr(0);
				this.state = 234;
				this.match(HazeParser.T__9);
				}
				break;
			case 21:
				localctx = new ReturnStatementContext(this, localctx);
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 236;
				this.match(HazeParser.T__20);
				this.state = 238;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if ((((_la) & ~0x1F) === 0 && ((1 << _la) & 2113929232) !== 0) || ((((_la - 55)) & ~0x1F) === 0 && ((1 << (_la - 55)) & 963) !== 0)) {
					{
					this.state = 237;
					this.expr(0);
					}
				}

				this.state = 240;
				this.match(HazeParser.T__9);
				}
				break;
			case 17:
			case 18:
				localctx = new VariableStatementContext(this, localctx);
				this.enterOuterAlt(localctx, 4);
				{
				this.state = 241;
				this.variablestatement();
				}
				break;
			case 22:
				localctx = new IfStatementContext(this, localctx);
				this.enterOuterAlt(localctx, 5);
				{
				this.state = 242;
				this.match(HazeParser.T__21);
				this.state = 243;
				this.ifexpr();
				this.state = 244;
				this.match(HazeParser.T__1);
				this.state = 245;
				this.thenblock();
				this.state = 246;
				this.match(HazeParser.T__2);
				this.state = 256;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 19, this._ctx);
				while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
					if (_alt === 1) {
						{
						{
						this.state = 247;
						this.match(HazeParser.T__22);
						this.state = 248;
						this.match(HazeParser.T__21);
						this.state = 249;
						this.elseifexpr();
						this.state = 250;
						this.match(HazeParser.T__1);
						this.state = 251;
						this.elseifblock();
						this.state = 252;
						this.match(HazeParser.T__2);
						}
						}
					}
					this.state = 258;
					this._errHandler.sync(this);
					_alt = this._interp.adaptivePredict(this._input, 19, this._ctx);
				}
				this.state = 264;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===23) {
					{
					this.state = 259;
					this.match(HazeParser.T__22);
					this.state = 260;
					this.match(HazeParser.T__1);
					this.state = 261;
					this.elseblock();
					this.state = 262;
					this.match(HazeParser.T__2);
					}
				}

				}
				break;
			case 24:
				localctx = new WhileStatementContext(this, localctx);
				this.enterOuterAlt(localctx, 6);
				{
				this.state = 266;
				this.match(HazeParser.T__23);
				this.state = 267;
				this.expr(0);
				this.state = 268;
				this.match(HazeParser.T__1);
				this.state = 269;
				this.body();
				this.state = 270;
				this.match(HazeParser.T__2);
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
		this.enterRule(localctx, 44, HazeParser.RULE_structmembervalue);
		try {
			localctx = new StructMemberValueContext(this, localctx);
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 274;
			this.match(HazeParser.T__13);
			this.state = 275;
			this.match(HazeParser.ID);
			this.state = 276;
			this.match(HazeParser.T__5);
			this.state = 277;
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
		let _startState: number = 46;
		this.enterRecursionRule(localctx, 46, HazeParser.RULE_expr, _p);
		let _la: number;
		try {
			let _alt: number;
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 323;
			this._errHandler.sync(this);
			switch ( this._interp.adaptivePredict(this._input, 27, this._ctx) ) {
			case 1:
				{
				localctx = new ParenthesisExprContext(this, localctx);
				this._ctx = localctx;
				_prevctx = localctx;

				this.state = 280;
				this.match(HazeParser.T__3);
				this.state = 281;
				this.expr(0);
				this.state = 282;
				this.match(HazeParser.T__4);
				}
				break;
			case 2:
				{
				localctx = new FuncRefExprContext(this, localctx);
				this._ctx = localctx;
				_prevctx = localctx;
				this.state = 284;
				this.func();
				}
				break;
			case 3:
				{
				localctx = new ConstantExprContext(this, localctx);
				this._ctx = localctx;
				_prevctx = localctx;
				this.state = 285;
				this.constant();
				}
				break;
			case 4:
				{
				localctx = new StructInstantiationExprContext(this, localctx);
				this._ctx = localctx;
				_prevctx = localctx;
				this.state = 286;
				this.datatype();
				this.state = 287;
				this.match(HazeParser.T__1);
				this.state = 289;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===14) {
					{
					this.state = 288;
					this.structmembervalue();
					}
				}

				this.state = 295;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 23, this._ctx);
				while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
					if (_alt === 1) {
						{
						{
						this.state = 291;
						this.match(HazeParser.T__7);
						this.state = 292;
						this.structmembervalue();
						}
						}
					}
					this.state = 297;
					this._errHandler.sync(this);
					_alt = this._interp.adaptivePredict(this._input, 23, this._ctx);
				}
				this.state = 299;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===8) {
					{
					this.state = 298;
					this.match(HazeParser.T__7);
					}
				}

				this.state = 301;
				this.match(HazeParser.T__2);
				}
				break;
			case 5:
				{
				localctx = new PreIncrExprContext(this, localctx);
				this._ctx = localctx;
				_prevctx = localctx;
				this.state = 303;
				(localctx as PreIncrExprContext)._op = this._input.LT(1);
				_la = this._input.LA(1);
				if(!(_la===25 || _la===26)) {
				    (localctx as PreIncrExprContext)._op = this._errHandler.recoverInline(this);
				}
				else {
					this._errHandler.reportMatch(this);
				    this.consume();
				}
				this.state = 304;
				this.expr(11);
				}
				break;
			case 6:
				{
				localctx = new UnaryExprContext(this, localctx);
				this._ctx = localctx;
				_prevctx = localctx;
				this.state = 305;
				(localctx as UnaryExprContext)._op = this._input.LT(1);
				_la = this._input.LA(1);
				if(!(_la===27 || _la===28)) {
				    (localctx as UnaryExprContext)._op = this._errHandler.recoverInline(this);
				}
				else {
					this._errHandler.reportMatch(this);
				    this.consume();
				}
				this.state = 306;
				this.expr(10);
				}
				break;
			case 7:
				{
				localctx = new UnaryExprContext(this, localctx);
				this._ctx = localctx;
				_prevctx = localctx;
				this.state = 307;
				_la = this._input.LA(1);
				if(!(_la===29 || _la===30)) {
				this._errHandler.recoverInline(this);
				}
				else {
					this._errHandler.reportMatch(this);
				    this.consume();
				}
				this.state = 308;
				this.expr(9);
				}
				break;
			case 8:
				{
				localctx = new SymbolValueExprContext(this, localctx);
				this._ctx = localctx;
				_prevctx = localctx;
				this.state = 309;
				this.match(HazeParser.ID);
				this.state = 321;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 26, this._ctx) ) {
				case 1:
					{
					this.state = 310;
					this.match(HazeParser.T__34);
					this.state = 311;
					this.datatype();
					this.state = 316;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===8) {
						{
						{
						this.state = 312;
						this.match(HazeParser.T__7);
						this.state = 313;
						this.datatype();
						}
						}
						this.state = 318;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 319;
					this.match(HazeParser.T__35);
					}
					break;
				}
				}
				break;
			}
			this._ctx.stop = this._input.LT(-1);
			this.state = 364;
			this._errHandler.sync(this);
			_alt = this._interp.adaptivePredict(this._input, 30, this._ctx);
			while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
				if (_alt === 1) {
					if (this._parseListeners != null) {
						this.triggerExitRuleEvent();
					}
					_prevctx = localctx;
					{
					this.state = 362;
					this._errHandler.sync(this);
					switch ( this._interp.adaptivePredict(this._input, 29, this._ctx) ) {
					case 1:
						{
						localctx = new BinaryExprContext(this, new ExprContext(this, _parentctx, _parentState));
						this.pushNewRecursionContext(localctx, _startState, HazeParser.RULE_expr);
						this.state = 325;
						if (!(this.precpred(this._ctx, 7))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 7)");
						}
						this.state = 326;
						_la = this._input.LA(1);
						if(!(((((_la - 32)) & ~0x1F) === 0 && ((1 << (_la - 32)) & 7) !== 0))) {
						this._errHandler.recoverInline(this);
						}
						else {
							this._errHandler.reportMatch(this);
						    this.consume();
						}
						this.state = 327;
						this.expr(8);
						}
						break;
					case 2:
						{
						localctx = new BinaryExprContext(this, new ExprContext(this, _parentctx, _parentState));
						this.pushNewRecursionContext(localctx, _startState, HazeParser.RULE_expr);
						this.state = 328;
						if (!(this.precpred(this._ctx, 6))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 6)");
						}
						this.state = 329;
						_la = this._input.LA(1);
						if(!(_la===27 || _la===28)) {
						this._errHandler.recoverInline(this);
						}
						else {
							this._errHandler.reportMatch(this);
						    this.consume();
						}
						this.state = 330;
						this.expr(7);
						}
						break;
					case 3:
						{
						localctx = new BinaryExprContext(this, new ExprContext(this, _parentctx, _parentState));
						this.pushNewRecursionContext(localctx, _startState, HazeParser.RULE_expr);
						this.state = 331;
						if (!(this.precpred(this._ctx, 5))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 5)");
						}
						this.state = 332;
						_la = this._input.LA(1);
						if(!(((((_la - 35)) & ~0x1F) === 0 && ((1 << (_la - 35)) & 15) !== 0))) {
						this._errHandler.recoverInline(this);
						}
						else {
							this._errHandler.reportMatch(this);
						    this.consume();
						}
						this.state = 333;
						this.expr(6);
						}
						break;
					case 4:
						{
						localctx = new BinaryExprContext(this, new ExprContext(this, _parentctx, _parentState));
						this.pushNewRecursionContext(localctx, _startState, HazeParser.RULE_expr);
						this.state = 334;
						if (!(this.precpred(this._ctx, 4))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 4)");
						}
						this.state = 340;
						this._errHandler.sync(this);
						switch ( this._interp.adaptivePredict(this._input, 28, this._ctx) ) {
						case 1:
							{
							this.state = 335;
							this.match(HazeParser.T__38);
							}
							break;
						case 2:
							{
							this.state = 336;
							this.match(HazeParser.T__39);
							}
							break;
						case 3:
							{
							this.state = 337;
							this.match(HazeParser.T__40);
							}
							break;
						case 4:
							{
							{
							this.state = 338;
							this.match(HazeParser.T__40);
							this.state = 339;
							this.match(HazeParser.T__28);
							}
							}
							break;
						}
						this.state = 342;
						this.expr(5);
						}
						break;
					case 5:
						{
						localctx = new BinaryExprContext(this, new ExprContext(this, _parentctx, _parentState));
						this.pushNewRecursionContext(localctx, _startState, HazeParser.RULE_expr);
						this.state = 343;
						if (!(this.precpred(this._ctx, 3))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 3)");
						}
						this.state = 344;
						_la = this._input.LA(1);
						if(!(_la===42 || _la===43)) {
						this._errHandler.recoverInline(this);
						}
						else {
							this._errHandler.reportMatch(this);
						    this.consume();
						}
						this.state = 345;
						this.expr(4);
						}
						break;
					case 6:
						{
						localctx = new ExprAssignmentExprContext(this, new ExprContext(this, _parentctx, _parentState));
						this.pushNewRecursionContext(localctx, _startState, HazeParser.RULE_expr);
						this.state = 346;
						if (!(this.precpred(this._ctx, 2))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 2)");
						}
						this.state = 347;
						(localctx as ExprAssignmentExprContext)._op = this._input.LT(1);
						_la = this._input.LA(1);
						if(!(_la===19 || ((((_la - 44)) & ~0x1F) === 0 && ((1 << (_la - 44)) & 1023) !== 0))) {
						    (localctx as ExprAssignmentExprContext)._op = this._errHandler.recoverInline(this);
						}
						else {
							this._errHandler.reportMatch(this);
						    this.consume();
						}
						this.state = 348;
						this.expr(3);
						}
						break;
					case 7:
						{
						localctx = new PostIncrExprContext(this, new ExprContext(this, _parentctx, _parentState));
						this.pushNewRecursionContext(localctx, _startState, HazeParser.RULE_expr);
						this.state = 349;
						if (!(this.precpred(this._ctx, 15))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 15)");
						}
						this.state = 350;
						(localctx as PostIncrExprContext)._op = this._input.LT(1);
						_la = this._input.LA(1);
						if(!(_la===25 || _la===26)) {
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
						this.state = 351;
						if (!(this.precpred(this._ctx, 14))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 14)");
						}
						this.state = 352;
						this.match(HazeParser.T__3);
						this.state = 353;
						this.args();
						this.state = 354;
						this.match(HazeParser.T__4);
						}
						break;
					case 9:
						{
						localctx = new ExprMemberAccessContext(this, new ExprContext(this, _parentctx, _parentState));
						this.pushNewRecursionContext(localctx, _startState, HazeParser.RULE_expr);
						this.state = 356;
						if (!(this.precpred(this._ctx, 13))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 13)");
						}
						this.state = 357;
						this.match(HazeParser.T__13);
						this.state = 358;
						this.match(HazeParser.ID);
						}
						break;
					case 10:
						{
						localctx = new ExplicitCastExprContext(this, new ExprContext(this, _parentctx, _parentState));
						this.pushNewRecursionContext(localctx, _startState, HazeParser.RULE_expr);
						this.state = 359;
						if (!(this.precpred(this._ctx, 8))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 8)");
						}
						this.state = 360;
						this.match(HazeParser.T__30);
						this.state = 361;
						this.datatype();
						}
						break;
					}
					}
				}
				this.state = 366;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 30, this._ctx);
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
		this.enterRule(localctx, 48, HazeParser.RULE_args);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 375;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if ((((_la) & ~0x1F) === 0 && ((1 << _la) & 2113929232) !== 0) || ((((_la - 55)) & ~0x1F) === 0 && ((1 << (_la - 55)) & 963) !== 0)) {
				{
				this.state = 367;
				this.expr(0);
				this.state = 372;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===8) {
					{
					{
					this.state = 368;
					this.match(HazeParser.T__7);
					this.state = 369;
					this.expr(0);
					}
					}
					this.state = 374;
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
		this.enterRule(localctx, 50, HazeParser.RULE_ellipsis);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 377;
			this.match(HazeParser.T__53);
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
		this.enterRule(localctx, 52, HazeParser.RULE_functype);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 379;
			this.match(HazeParser.T__3);
			this.state = 380;
			this.params();
			this.state = 381;
			this.match(HazeParser.T__4);
			this.state = 382;
			this.match(HazeParser.T__6);
			this.state = 383;
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
		this.enterRule(localctx, 54, HazeParser.RULE_constant);
		let _la: number;
		try {
			this.state = 389;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 55:
			case 56:
				localctx = new BooleanConstantContext(this, localctx);
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 385;
				_la = this._input.LA(1);
				if(!(_la===55 || _la===56)) {
				this._errHandler.recoverInline(this);
				}
				else {
					this._errHandler.reportMatch(this);
				    this.consume();
				}
				}
				break;
			case 62:
				localctx = new LiteralConstantContext(this, localctx);
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 386;
				this.match(HazeParser.UNIT_LITERAL);
				}
				break;
			case 63:
				localctx = new LiteralConstantContext(this, localctx);
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 387;
				this.match(HazeParser.NUMBER_LITERAL);
				}
				break;
			case 61:
				localctx = new StringConstantContext(this, localctx);
				this.enterOuterAlt(localctx, 4);
				{
				this.state = 388;
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
		this.enterRule(localctx, 56, HazeParser.RULE_compilationhint);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 391;
			this.match(HazeParser.T__56);
			this.state = 392;
			this.compilationlang();
			this.state = 393;
			this.compilationhintfilename();
			this.state = 395;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===61) {
				{
				this.state = 394;
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
		this.enterRule(localctx, 58, HazeParser.RULE_compilationhintfilename);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 397;
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
		this.enterRule(localctx, 60, HazeParser.RULE_compilationhintflags);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 399;
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
		this.enterRule(localctx, 62, HazeParser.RULE_compilationlang);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 401;
			_la = this._input.LA(1);
			if(!(_la===15 || _la===16)) {
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
		this.enterRule(localctx, 64, HazeParser.RULE_linkerhint);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 403;
			this.match(HazeParser.T__57);
			this.state = 404;
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
		this.enterRule(localctx, 66, HazeParser.RULE_structcontent);
		let _la: number;
		try {
			this.state = 430;
			this._errHandler.sync(this);
			switch ( this._interp.adaptivePredict(this._input, 37, this._ctx) ) {
			case 1:
				localctx = new StructMemberContext(this, localctx);
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 406;
				this.match(HazeParser.ID);
				this.state = 407;
				this.match(HazeParser.T__5);
				this.state = 408;
				this.datatype();
				this.state = 409;
				this.match(HazeParser.T__9);
				}
				break;
			case 2:
				localctx = new StructMethodContext(this, localctx);
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 411;
				this.match(HazeParser.ID);
				this.state = 412;
				this.match(HazeParser.T__3);
				this.state = 413;
				this.params();
				this.state = 414;
				this.match(HazeParser.T__4);
				this.state = 417;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===6) {
					{
					this.state = 415;
					this.match(HazeParser.T__5);
					this.state = 416;
					this.datatype();
					}
				}

				this.state = 419;
				this.funcbody();
				}
				break;
			case 3:
				localctx = new StructUnionFieldsContext(this, localctx);
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 421;
				this.match(HazeParser.T__58);
				this.state = 422;
				this.match(HazeParser.T__1);
				this.state = 426;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===59 || _la===64) {
					{
					{
					this.state = 423;
					this.structcontent();
					}
					}
					this.state = 428;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 429;
				this.match(HazeParser.T__2);
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
		this.enterRule(localctx, 68, HazeParser.RULE_structdecl);
		let _la: number;
		try {
			localctx = new StructDeclContext(this, localctx);
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 434;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===13) {
				{
				this.state = 432;
				this.match(HazeParser.T__12);
				this.state = 433;
				this.externlang();
				}
			}

			this.state = 436;
			this.match(HazeParser.T__59);
			this.state = 437;
			this.match(HazeParser.ID);
			this.state = 448;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===35) {
				{
				this.state = 438;
				this.match(HazeParser.T__34);
				this.state = 439;
				this.match(HazeParser.ID);
				this.state = 444;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===8) {
					{
					{
					this.state = 440;
					this.match(HazeParser.T__7);
					this.state = 441;
					this.match(HazeParser.ID);
					}
					}
					this.state = 446;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 447;
				this.match(HazeParser.T__35);
				}
			}

			this.state = 450;
			this.match(HazeParser.T__1);
			this.state = 454;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===59 || _la===64) {
				{
				{
				this.state = 451;
				this.structcontent();
				}
				}
				this.state = 456;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 457;
			this.match(HazeParser.T__2);
			this.state = 459;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===10) {
				{
				this.state = 458;
				this.match(HazeParser.T__9);
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
		this.enterRule(localctx, 70, HazeParser.RULE_datatype);
		let _la: number;
		try {
			this.state = 480;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 64:
				localctx = new CommonDatatypeContext(this, localctx);
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 461;
				this.match(HazeParser.ID);
				this.state = 473;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 44, this._ctx) ) {
				case 1:
					{
					this.state = 462;
					this.match(HazeParser.T__34);
					this.state = 463;
					(localctx as CommonDatatypeContext)._datatype = this.datatype();
					(localctx as CommonDatatypeContext)._generics.push((localctx as CommonDatatypeContext)._datatype);
					this.state = 468;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===8) {
						{
						{
						this.state = 464;
						this.match(HazeParser.T__7);
						this.state = 465;
						(localctx as CommonDatatypeContext)._datatype = this.datatype();
						(localctx as CommonDatatypeContext)._generics.push((localctx as CommonDatatypeContext)._datatype);
						}
						}
						this.state = 470;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 471;
					this.match(HazeParser.T__35);
					}
					break;
				}
				this.state = 477;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 45, this._ctx) ) {
				case 1:
					{
					this.state = 475;
					this.match(HazeParser.T__13);
					this.state = 476;
					(localctx as CommonDatatypeContext)._nested = this.datatype();
					}
					break;
				}
				}
				break;
			case 4:
				localctx = new FunctionDatatypeContext(this, localctx);
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 479;
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
		case 23:
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

	public static readonly _serializedATN: number[] = [4,1,66,483,2,0,7,0,2,
	1,7,1,2,2,7,2,2,3,7,3,2,4,7,4,2,5,7,5,2,6,7,6,2,7,7,7,2,8,7,8,2,9,7,9,2,
	10,7,10,2,11,7,11,2,12,7,12,2,13,7,13,2,14,7,14,2,15,7,15,2,16,7,16,2,17,
	7,17,2,18,7,18,2,19,7,19,2,20,7,20,2,21,7,21,2,22,7,22,2,23,7,23,2,24,7,
	24,2,25,7,25,2,26,7,26,2,27,7,27,2,28,7,28,2,29,7,29,2,30,7,30,2,31,7,31,
	2,32,7,32,2,33,7,33,2,34,7,34,2,35,7,35,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,
	1,0,1,0,5,0,83,8,0,10,0,12,0,86,9,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,5,1,95,
	8,1,10,1,12,1,98,9,1,1,2,1,2,1,2,1,2,1,2,1,2,1,3,1,3,1,3,1,3,1,3,1,3,3,
	3,112,8,3,1,3,1,3,1,4,1,4,1,4,1,4,1,4,3,4,121,8,4,1,4,1,4,1,5,3,5,126,8,
	5,1,5,1,5,1,5,1,5,1,5,1,5,3,5,134,8,5,1,6,5,6,137,8,6,10,6,12,6,140,9,6,
	1,7,1,7,1,7,1,7,1,8,1,8,1,8,5,8,149,8,8,10,8,12,8,152,9,8,1,8,1,8,3,8,156,
	8,8,3,8,158,8,8,1,8,3,8,161,8,8,1,9,1,9,1,9,1,9,1,10,1,10,1,10,1,10,1,11,
	1,11,1,11,1,11,1,12,1,12,3,12,177,8,12,1,12,1,12,5,12,181,8,12,10,12,12,
	12,184,9,12,1,12,1,12,1,12,1,12,1,12,1,12,3,12,192,8,12,1,12,1,12,1,13,
	1,13,1,14,1,14,1,15,1,15,1,16,1,16,1,17,1,17,1,18,1,18,1,19,1,19,1,20,1,
	20,1,20,1,20,3,20,214,8,20,1,20,1,20,1,20,1,20,1,20,1,20,1,20,1,20,1,20,
	1,20,1,20,3,20,227,8,20,1,21,1,21,1,21,1,21,1,21,1,21,1,21,1,21,1,21,1,
	21,3,21,239,8,21,1,21,1,21,1,21,1,21,1,21,1,21,1,21,1,21,1,21,1,21,1,21,
	1,21,1,21,1,21,5,21,255,8,21,10,21,12,21,258,9,21,1,21,1,21,1,21,1,21,1,
	21,3,21,265,8,21,1,21,1,21,1,21,1,21,1,21,1,21,3,21,273,8,21,1,22,1,22,
	1,22,1,22,1,22,1,23,1,23,1,23,1,23,1,23,1,23,1,23,1,23,1,23,1,23,3,23,290,
	8,23,1,23,1,23,5,23,294,8,23,10,23,12,23,297,9,23,1,23,3,23,300,8,23,1,
	23,1,23,1,23,1,23,1,23,1,23,1,23,1,23,1,23,1,23,1,23,1,23,1,23,5,23,315,
	8,23,10,23,12,23,318,9,23,1,23,1,23,3,23,322,8,23,3,23,324,8,23,1,23,1,
	23,1,23,1,23,1,23,1,23,1,23,1,23,1,23,1,23,1,23,1,23,1,23,1,23,1,23,3,23,
	341,8,23,1,23,1,23,1,23,1,23,1,23,1,23,1,23,1,23,1,23,1,23,1,23,1,23,1,
	23,1,23,1,23,1,23,1,23,1,23,1,23,1,23,5,23,363,8,23,10,23,12,23,366,9,23,
	1,24,1,24,1,24,5,24,371,8,24,10,24,12,24,374,9,24,3,24,376,8,24,1,25,1,
	25,1,26,1,26,1,26,1,26,1,26,1,26,1,27,1,27,1,27,1,27,3,27,390,8,27,1,28,
	1,28,1,28,1,28,3,28,396,8,28,1,29,1,29,1,30,1,30,1,31,1,31,1,32,1,32,1,
	32,1,33,1,33,1,33,1,33,1,33,1,33,1,33,1,33,1,33,1,33,1,33,3,33,418,8,33,
	1,33,1,33,1,33,1,33,1,33,5,33,425,8,33,10,33,12,33,428,9,33,1,33,3,33,431,
	8,33,1,34,1,34,3,34,435,8,34,1,34,1,34,1,34,1,34,1,34,1,34,5,34,443,8,34,
	10,34,12,34,446,9,34,1,34,3,34,449,8,34,1,34,1,34,5,34,453,8,34,10,34,12,
	34,456,9,34,1,34,1,34,3,34,460,8,34,1,35,1,35,1,35,1,35,1,35,5,35,467,8,
	35,10,35,12,35,470,9,35,1,35,1,35,3,35,474,8,35,1,35,1,35,3,35,478,8,35,
	1,35,3,35,481,8,35,1,35,0,1,46,36,0,2,4,6,8,10,12,14,16,18,20,22,24,26,
	28,30,32,34,36,38,40,42,44,46,48,50,52,54,56,58,60,62,64,66,68,70,0,10,
	1,0,15,16,1,0,17,18,1,0,25,26,1,0,27,28,1,0,29,30,1,0,32,34,1,0,35,38,1,
	0,42,43,2,0,19,19,44,53,1,0,55,56,529,0,84,1,0,0,0,2,96,1,0,0,0,4,99,1,
	0,0,0,6,105,1,0,0,0,8,115,1,0,0,0,10,133,1,0,0,0,12,138,1,0,0,0,14,141,
	1,0,0,0,16,160,1,0,0,0,18,162,1,0,0,0,20,166,1,0,0,0,22,170,1,0,0,0,24,
	174,1,0,0,0,26,195,1,0,0,0,28,197,1,0,0,0,30,199,1,0,0,0,32,201,1,0,0,0,
	34,203,1,0,0,0,36,205,1,0,0,0,38,207,1,0,0,0,40,226,1,0,0,0,42,272,1,0,
	0,0,44,274,1,0,0,0,46,323,1,0,0,0,48,375,1,0,0,0,50,377,1,0,0,0,52,379,
	1,0,0,0,54,389,1,0,0,0,56,391,1,0,0,0,58,397,1,0,0,0,60,399,1,0,0,0,62,
	401,1,0,0,0,64,403,1,0,0,0,66,430,1,0,0,0,68,434,1,0,0,0,70,480,1,0,0,0,
	72,83,3,18,9,0,73,83,3,20,10,0,74,83,3,22,11,0,75,83,3,6,3,0,76,83,3,24,
	12,0,77,83,3,56,28,0,78,83,3,64,32,0,79,83,3,68,34,0,80,83,3,4,2,0,81,83,
	3,40,20,0,82,72,1,0,0,0,82,73,1,0,0,0,82,74,1,0,0,0,82,75,1,0,0,0,82,76,
	1,0,0,0,82,77,1,0,0,0,82,78,1,0,0,0,82,79,1,0,0,0,82,80,1,0,0,0,82,81,1,
	0,0,0,83,86,1,0,0,0,84,82,1,0,0,0,84,85,1,0,0,0,85,1,1,0,0,0,86,84,1,0,
	0,0,87,95,3,6,3,0,88,95,3,24,12,0,89,95,3,56,28,0,90,95,3,64,32,0,91,95,
	3,68,34,0,92,95,3,4,2,0,93,95,3,40,20,0,94,87,1,0,0,0,94,88,1,0,0,0,94,
	89,1,0,0,0,94,90,1,0,0,0,94,91,1,0,0,0,94,92,1,0,0,0,94,93,1,0,0,0,95,98,
	1,0,0,0,96,94,1,0,0,0,96,97,1,0,0,0,97,3,1,0,0,0,98,96,1,0,0,0,99,100,5,
	1,0,0,100,101,5,64,0,0,101,102,5,2,0,0,102,103,3,2,1,0,103,104,5,3,0,0,
	104,5,1,0,0,0,105,106,5,64,0,0,106,107,5,4,0,0,107,108,3,16,8,0,108,111,
	5,5,0,0,109,110,5,6,0,0,110,112,3,70,35,0,111,109,1,0,0,0,111,112,1,0,0,
	0,112,113,1,0,0,0,113,114,3,10,5,0,114,7,1,0,0,0,115,116,5,4,0,0,116,117,
	3,16,8,0,117,120,5,5,0,0,118,119,5,6,0,0,119,121,3,70,35,0,120,118,1,0,
	0,0,120,121,1,0,0,0,121,122,1,0,0,0,122,123,3,10,5,0,123,9,1,0,0,0,124,
	126,5,7,0,0,125,124,1,0,0,0,125,126,1,0,0,0,126,127,1,0,0,0,127,128,5,2,
	0,0,128,129,3,12,6,0,129,130,5,3,0,0,130,134,1,0,0,0,131,132,5,7,0,0,132,
	134,3,46,23,0,133,125,1,0,0,0,133,131,1,0,0,0,134,11,1,0,0,0,135,137,3,
	42,21,0,136,135,1,0,0,0,137,140,1,0,0,0,138,136,1,0,0,0,138,139,1,0,0,0,
	139,13,1,0,0,0,140,138,1,0,0,0,141,142,5,64,0,0,142,143,5,6,0,0,143,144,
	3,70,35,0,144,15,1,0,0,0,145,150,3,14,7,0,146,147,5,8,0,0,147,149,3,14,
	7,0,148,146,1,0,0,0,149,152,1,0,0,0,150,148,1,0,0,0,150,151,1,0,0,0,151,
	155,1,0,0,0,152,150,1,0,0,0,153,154,5,8,0,0,154,156,3,50,25,0,155,153,1,
	0,0,0,155,156,1,0,0,0,156,158,1,0,0,0,157,145,1,0,0,0,157,158,1,0,0,0,158,
	161,1,0,0,0,159,161,3,50,25,0,160,157,1,0,0,0,160,159,1,0,0,0,161,17,1,
	0,0,0,162,163,5,9,0,0,163,164,5,61,0,0,164,165,5,10,0,0,165,19,1,0,0,0,
	166,167,5,11,0,0,167,168,5,61,0,0,168,169,5,10,0,0,169,21,1,0,0,0,170,171,
	5,12,0,0,171,172,5,61,0,0,172,173,5,10,0,0,173,23,1,0,0,0,174,176,5,13,
	0,0,175,177,3,26,13,0,176,175,1,0,0,0,176,177,1,0,0,0,177,182,1,0,0,0,178,
	179,5,64,0,0,179,181,5,14,0,0,180,178,1,0,0,0,181,184,1,0,0,0,182,180,1,
	0,0,0,182,183,1,0,0,0,183,185,1,0,0,0,184,182,1,0,0,0,185,186,5,64,0,0,
	186,187,5,4,0,0,187,188,3,16,8,0,188,191,5,5,0,0,189,190,5,6,0,0,190,192,
	3,70,35,0,191,189,1,0,0,0,191,192,1,0,0,0,192,193,1,0,0,0,193,194,5,10,
	0,0,194,25,1,0,0,0,195,196,7,0,0,0,196,27,1,0,0,0,197,198,3,46,23,0,198,
	29,1,0,0,0,199,200,3,46,23,0,200,31,1,0,0,0,201,202,3,12,6,0,202,33,1,0,
	0,0,203,204,3,12,6,0,204,35,1,0,0,0,205,206,3,12,6,0,206,37,1,0,0,0,207,
	208,7,1,0,0,208,39,1,0,0,0,209,210,3,38,19,0,210,213,5,64,0,0,211,212,5,
	6,0,0,212,214,3,70,35,0,213,211,1,0,0,0,213,214,1,0,0,0,214,215,1,0,0,0,
	215,216,5,19,0,0,216,217,3,46,23,0,217,218,5,10,0,0,218,227,1,0,0,0,219,
	220,3,38,19,0,220,221,5,64,0,0,221,222,5,6,0,0,222,223,3,70,35,0,223,224,
	1,0,0,0,224,225,5,10,0,0,225,227,1,0,0,0,226,209,1,0,0,0,226,219,1,0,0,
	0,227,41,1,0,0,0,228,229,5,20,0,0,229,230,5,4,0,0,230,231,5,61,0,0,231,
	232,5,5,0,0,232,273,5,10,0,0,233,234,3,46,23,0,234,235,5,10,0,0,235,273,
	1,0,0,0,236,238,5,21,0,0,237,239,3,46,23,0,238,237,1,0,0,0,238,239,1,0,
	0,0,239,240,1,0,0,0,240,273,5,10,0,0,241,273,3,40,20,0,242,243,5,22,0,0,
	243,244,3,28,14,0,244,245,5,2,0,0,245,246,3,32,16,0,246,256,5,3,0,0,247,
	248,5,23,0,0,248,249,5,22,0,0,249,250,3,30,15,0,250,251,5,2,0,0,251,252,
	3,34,17,0,252,253,5,3,0,0,253,255,1,0,0,0,254,247,1,0,0,0,255,258,1,0,0,
	0,256,254,1,0,0,0,256,257,1,0,0,0,257,264,1,0,0,0,258,256,1,0,0,0,259,260,
	5,23,0,0,260,261,5,2,0,0,261,262,3,36,18,0,262,263,5,3,0,0,263,265,1,0,
	0,0,264,259,1,0,0,0,264,265,1,0,0,0,265,273,1,0,0,0,266,267,5,24,0,0,267,
	268,3,46,23,0,268,269,5,2,0,0,269,270,3,12,6,0,270,271,5,3,0,0,271,273,
	1,0,0,0,272,228,1,0,0,0,272,233,1,0,0,0,272,236,1,0,0,0,272,241,1,0,0,0,
	272,242,1,0,0,0,272,266,1,0,0,0,273,43,1,0,0,0,274,275,5,14,0,0,275,276,
	5,64,0,0,276,277,5,6,0,0,277,278,3,46,23,0,278,45,1,0,0,0,279,280,6,23,
	-1,0,280,281,5,4,0,0,281,282,3,46,23,0,282,283,5,5,0,0,283,324,1,0,0,0,
	284,324,3,8,4,0,285,324,3,54,27,0,286,287,3,70,35,0,287,289,5,2,0,0,288,
	290,3,44,22,0,289,288,1,0,0,0,289,290,1,0,0,0,290,295,1,0,0,0,291,292,5,
	8,0,0,292,294,3,44,22,0,293,291,1,0,0,0,294,297,1,0,0,0,295,293,1,0,0,0,
	295,296,1,0,0,0,296,299,1,0,0,0,297,295,1,0,0,0,298,300,5,8,0,0,299,298,
	1,0,0,0,299,300,1,0,0,0,300,301,1,0,0,0,301,302,5,3,0,0,302,324,1,0,0,0,
	303,304,7,2,0,0,304,324,3,46,23,11,305,306,7,3,0,0,306,324,3,46,23,10,307,
	308,7,4,0,0,308,324,3,46,23,9,309,321,5,64,0,0,310,311,5,35,0,0,311,316,
	3,70,35,0,312,313,5,8,0,0,313,315,3,70,35,0,314,312,1,0,0,0,315,318,1,0,
	0,0,316,314,1,0,0,0,316,317,1,0,0,0,317,319,1,0,0,0,318,316,1,0,0,0,319,
	320,5,36,0,0,320,322,1,0,0,0,321,310,1,0,0,0,321,322,1,0,0,0,322,324,1,
	0,0,0,323,279,1,0,0,0,323,284,1,0,0,0,323,285,1,0,0,0,323,286,1,0,0,0,323,
	303,1,0,0,0,323,305,1,0,0,0,323,307,1,0,0,0,323,309,1,0,0,0,324,364,1,0,
	0,0,325,326,10,7,0,0,326,327,7,5,0,0,327,363,3,46,23,8,328,329,10,6,0,0,
	329,330,7,3,0,0,330,363,3,46,23,7,331,332,10,5,0,0,332,333,7,6,0,0,333,
	363,3,46,23,6,334,340,10,4,0,0,335,341,5,39,0,0,336,341,5,40,0,0,337,341,
	5,41,0,0,338,339,5,41,0,0,339,341,5,29,0,0,340,335,1,0,0,0,340,336,1,0,
	0,0,340,337,1,0,0,0,340,338,1,0,0,0,341,342,1,0,0,0,342,363,3,46,23,5,343,
	344,10,3,0,0,344,345,7,7,0,0,345,363,3,46,23,4,346,347,10,2,0,0,347,348,
	7,8,0,0,348,363,3,46,23,3,349,350,10,15,0,0,350,363,7,2,0,0,351,352,10,
	14,0,0,352,353,5,4,0,0,353,354,3,48,24,0,354,355,5,5,0,0,355,363,1,0,0,
	0,356,357,10,13,0,0,357,358,5,14,0,0,358,363,5,64,0,0,359,360,10,8,0,0,
	360,361,5,31,0,0,361,363,3,70,35,0,362,325,1,0,0,0,362,328,1,0,0,0,362,
	331,1,0,0,0,362,334,1,0,0,0,362,343,1,0,0,0,362,346,1,0,0,0,362,349,1,0,
	0,0,362,351,1,0,0,0,362,356,1,0,0,0,362,359,1,0,0,0,363,366,1,0,0,0,364,
	362,1,0,0,0,364,365,1,0,0,0,365,47,1,0,0,0,366,364,1,0,0,0,367,372,3,46,
	23,0,368,369,5,8,0,0,369,371,3,46,23,0,370,368,1,0,0,0,371,374,1,0,0,0,
	372,370,1,0,0,0,372,373,1,0,0,0,373,376,1,0,0,0,374,372,1,0,0,0,375,367,
	1,0,0,0,375,376,1,0,0,0,376,49,1,0,0,0,377,378,5,54,0,0,378,51,1,0,0,0,
	379,380,5,4,0,0,380,381,3,16,8,0,381,382,5,5,0,0,382,383,5,7,0,0,383,384,
	3,70,35,0,384,53,1,0,0,0,385,390,7,9,0,0,386,390,5,62,0,0,387,390,5,63,
	0,0,388,390,5,61,0,0,389,385,1,0,0,0,389,386,1,0,0,0,389,387,1,0,0,0,389,
	388,1,0,0,0,390,55,1,0,0,0,391,392,5,57,0,0,392,393,3,62,31,0,393,395,3,
	58,29,0,394,396,3,60,30,0,395,394,1,0,0,0,395,396,1,0,0,0,396,57,1,0,0,
	0,397,398,5,61,0,0,398,59,1,0,0,0,399,400,5,61,0,0,400,61,1,0,0,0,401,402,
	7,0,0,0,402,63,1,0,0,0,403,404,5,58,0,0,404,405,5,61,0,0,405,65,1,0,0,0,
	406,407,5,64,0,0,407,408,5,6,0,0,408,409,3,70,35,0,409,410,5,10,0,0,410,
	431,1,0,0,0,411,412,5,64,0,0,412,413,5,4,0,0,413,414,3,16,8,0,414,417,5,
	5,0,0,415,416,5,6,0,0,416,418,3,70,35,0,417,415,1,0,0,0,417,418,1,0,0,0,
	418,419,1,0,0,0,419,420,3,10,5,0,420,431,1,0,0,0,421,422,5,59,0,0,422,426,
	5,2,0,0,423,425,3,66,33,0,424,423,1,0,0,0,425,428,1,0,0,0,426,424,1,0,0,
	0,426,427,1,0,0,0,427,429,1,0,0,0,428,426,1,0,0,0,429,431,5,3,0,0,430,406,
	1,0,0,0,430,411,1,0,0,0,430,421,1,0,0,0,431,67,1,0,0,0,432,433,5,13,0,0,
	433,435,3,26,13,0,434,432,1,0,0,0,434,435,1,0,0,0,435,436,1,0,0,0,436,437,
	5,60,0,0,437,448,5,64,0,0,438,439,5,35,0,0,439,444,5,64,0,0,440,441,5,8,
	0,0,441,443,5,64,0,0,442,440,1,0,0,0,443,446,1,0,0,0,444,442,1,0,0,0,444,
	445,1,0,0,0,445,447,1,0,0,0,446,444,1,0,0,0,447,449,5,36,0,0,448,438,1,
	0,0,0,448,449,1,0,0,0,449,450,1,0,0,0,450,454,5,2,0,0,451,453,3,66,33,0,
	452,451,1,0,0,0,453,456,1,0,0,0,454,452,1,0,0,0,454,455,1,0,0,0,455,457,
	1,0,0,0,456,454,1,0,0,0,457,459,5,3,0,0,458,460,5,10,0,0,459,458,1,0,0,
	0,459,460,1,0,0,0,460,69,1,0,0,0,461,473,5,64,0,0,462,463,5,35,0,0,463,
	468,3,70,35,0,464,465,5,8,0,0,465,467,3,70,35,0,466,464,1,0,0,0,467,470,
	1,0,0,0,468,466,1,0,0,0,468,469,1,0,0,0,469,471,1,0,0,0,470,468,1,0,0,0,
	471,472,5,36,0,0,472,474,1,0,0,0,473,462,1,0,0,0,473,474,1,0,0,0,474,477,
	1,0,0,0,475,476,5,14,0,0,476,478,3,70,35,0,477,475,1,0,0,0,477,478,1,0,
	0,0,478,481,1,0,0,0,479,481,3,52,26,0,480,461,1,0,0,0,480,479,1,0,0,0,481,
	71,1,0,0,0,47,82,84,94,96,111,120,125,133,138,150,155,157,160,176,182,191,
	213,226,238,256,264,272,289,295,299,316,321,323,340,362,364,372,375,389,
	395,417,426,430,434,444,448,454,459,468,473,477,480];

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
	public prebuildcmd_list(): PrebuildcmdContext[] {
		return this.getTypedRuleContexts(PrebuildcmdContext) as PrebuildcmdContext[];
	}
	public prebuildcmd(i: number): PrebuildcmdContext {
		return this.getTypedRuleContext(PrebuildcmdContext, i) as PrebuildcmdContext;
	}
	public postbuildcmd_list(): PostbuildcmdContext[] {
		return this.getTypedRuleContexts(PostbuildcmdContext) as PostbuildcmdContext[];
	}
	public postbuildcmd(i: number): PostbuildcmdContext {
		return this.getTypedRuleContext(PostbuildcmdContext, i) as PostbuildcmdContext;
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
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public ID(): TerminalNode {
		return this.getToken(HazeParser.ID, 0);
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


export class PrebuildcmdContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public STRING_LITERAL(): TerminalNode {
		return this.getToken(HazeParser.STRING_LITERAL, 0);
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_prebuildcmd;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterPrebuildcmd) {
	 		listener.enterPrebuildcmd(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitPrebuildcmd) {
	 		listener.exitPrebuildcmd(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitPrebuildcmd) {
			return visitor.visitPrebuildcmd(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class PostbuildcmdContext extends ParserRuleContext {
	constructor(parser?: HazeParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public STRING_LITERAL(): TerminalNode {
		return this.getToken(HazeParser.STRING_LITERAL, 0);
	}
    public get ruleIndex(): number {
    	return HazeParser.RULE_postbuildcmd;
	}
	public enterRule(listener: HazeListener): void {
	    if(listener.enterPostbuildcmd) {
	 		listener.enterPostbuildcmd(this);
		}
	}
	public exitRule(listener: HazeListener): void {
	    if(listener.exitPostbuildcmd) {
	 		listener.exitPostbuildcmd(this);
		}
	}
	// @Override
	public accept<Result>(visitor: HazeVisitor<Result>): Result {
		if (visitor.visitPostbuildcmd) {
			return visitor.visitPostbuildcmd(this);
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
	public _datatype!: DatatypeContext;
	public _generics: DatatypeContext[] = [];
	public _nested!: DatatypeContext;
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
