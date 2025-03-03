// Generated from /home/fzachs/Projects/haze/Haze.g4 by ANTLR 4.13.1
import org.antlr.v4.runtime.atn.*;
import org.antlr.v4.runtime.dfa.DFA;
import org.antlr.v4.runtime.*;
import org.antlr.v4.runtime.misc.*;
import org.antlr.v4.runtime.tree.*;
import java.util.List;
import java.util.Iterator;
import java.util.ArrayList;

@SuppressWarnings({"all", "warnings", "unchecked", "unused", "cast", "CheckReturnValue"})
public class HazeParser extends Parser {
	static { RuntimeMetaData.checkVersion("4.13.1", RuntimeMetaData.VERSION); }

	protected static final DFA[] _decisionToDFA;
	protected static final PredictionContextCache _sharedContextCache =
		new PredictionContextCache();
	public static final int
		T__0=1, T__1=2, T__2=3, T__3=4, T__4=5, T__5=6, T__6=7, T__7=8, T__8=9, 
		T__9=10, T__10=11, T__11=12, T__12=13, T__13=14, T__14=15, T__15=16, T__16=17, 
		T__17=18, T__18=19, T__19=20, T__20=21, T__21=22, T__22=23, T__23=24, 
		T__24=25, T__25=26, T__26=27, T__27=28, T__28=29, T__29=30, T__30=31, 
		T__31=32, T__32=33, T__33=34, T__34=35, T__35=36, T__36=37, T__37=38, 
		T__38=39, T__39=40, T__40=41, T__41=42, T__42=43, T__43=44, T__44=45, 
		T__45=46, T__46=47, T__47=48, T__48=49, T__49=50, T__50=51, T__51=52, 
		T__52=53, T__53=54, T__54=55, STRING_LITERAL=56, UNIT_LITERAL=57, NUMBER_LITERAL=58, 
		ID=59, WS=60, COMMENT=61;
	public static final int
		RULE_prog = 0, RULE_namedfunc = 1, RULE_func = 2, RULE_funcbody = 3, RULE_body = 4, 
		RULE_param = 5, RULE_params = 6, RULE_cdefinitiondecl = 7, RULE_funcdecl = 8, 
		RULE_externlang = 9, RULE_ifexpr = 10, RULE_elseifexpr = 11, RULE_thenblock = 12, 
		RULE_elseifblock = 13, RULE_elseblock = 14, RULE_variablemutability = 15, 
		RULE_statement = 16, RULE_structmembervalue = 17, RULE_expr = 18, RULE_args = 19, 
		RULE_ellipsis = 20, RULE_functype = 21, RULE_constant = 22, RULE_compilationhint = 23, 
		RULE_compilationhintfilename = 24, RULE_compilationhintflags = 25, RULE_compilationlang = 26, 
		RULE_linkerhint = 27, RULE_structcontent = 28, RULE_structdecl = 29, RULE_datatype = 30;
	private static String[] makeRuleNames() {
		return new String[] {
			"prog", "namedfunc", "func", "funcbody", "body", "param", "params", "cdefinitiondecl", 
			"funcdecl", "externlang", "ifexpr", "elseifexpr", "thenblock", "elseifblock", 
			"elseblock", "variablemutability", "statement", "structmembervalue", 
			"expr", "args", "ellipsis", "functype", "constant", "compilationhint", 
			"compilationhintfilename", "compilationhintflags", "compilationlang", 
			"linkerhint", "structcontent", "structdecl", "datatype"
		};
	}
	public static final String[] ruleNames = makeRuleNames();

	private static String[] makeLiteralNames() {
		return new String[] {
			null, "'('", "')'", "':'", "'=>'", "'{'", "'}'", "','", "'declare'", 
			"';'", "'.'", "'\"C\"'", "'\"C++\"'", "'let'", "'const'", "'__c__'", 
			"'return'", "'='", "'if'", "'else'", "'while'", "'++'", "'--'", "'+'", 
			"'-'", "'not'", "'!'", "'as'", "'*'", "'/'", "'%'", "'<'", "'>'", "'<='", 
			"'>='", "'=='", "'!='", "'is'", "'and'", "'or'", "'+='", "'-='", "'*='", 
			"'/='", "'%='", "'<<='", "'>>='", "'&='", "'^='", "'|='", "'...'", "'true'", 
			"'false'", "'#compile'", "'#link'", "'struct'"
		};
	}
	private static final String[] _LITERAL_NAMES = makeLiteralNames();
	private static String[] makeSymbolicNames() {
		return new String[] {
			null, null, null, null, null, null, null, null, null, null, null, null, 
			null, null, null, null, null, null, null, null, null, null, null, null, 
			null, null, null, null, null, null, null, null, null, null, null, null, 
			null, null, null, null, null, null, null, null, null, null, null, null, 
			null, null, null, null, null, null, null, null, "STRING_LITERAL", "UNIT_LITERAL", 
			"NUMBER_LITERAL", "ID", "WS", "COMMENT"
		};
	}
	private static final String[] _SYMBOLIC_NAMES = makeSymbolicNames();
	public static final Vocabulary VOCABULARY = new VocabularyImpl(_LITERAL_NAMES, _SYMBOLIC_NAMES);

	/**
	 * @deprecated Use {@link #VOCABULARY} instead.
	 */
	@Deprecated
	public static final String[] tokenNames;
	static {
		tokenNames = new String[_SYMBOLIC_NAMES.length];
		for (int i = 0; i < tokenNames.length; i++) {
			tokenNames[i] = VOCABULARY.getLiteralName(i);
			if (tokenNames[i] == null) {
				tokenNames[i] = VOCABULARY.getSymbolicName(i);
			}

			if (tokenNames[i] == null) {
				tokenNames[i] = "<INVALID>";
			}
		}
	}

	@Override
	@Deprecated
	public String[] getTokenNames() {
		return tokenNames;
	}

	@Override

	public Vocabulary getVocabulary() {
		return VOCABULARY;
	}

	@Override
	public String getGrammarFileName() { return "Haze.g4"; }

	@Override
	public String[] getRuleNames() { return ruleNames; }

	@Override
	public String getSerializedATN() { return _serializedATN; }

	@Override
	public ATN getATN() { return _ATN; }

	public HazeParser(TokenStream input) {
		super(input);
		_interp = new ParserATNSimulator(this,_ATN,_decisionToDFA,_sharedContextCache);
	}

	@SuppressWarnings("CheckReturnValue")
	public static class ProgContext extends ParserRuleContext {
		public List<CdefinitiondeclContext> cdefinitiondecl() {
			return getRuleContexts(CdefinitiondeclContext.class);
		}
		public CdefinitiondeclContext cdefinitiondecl(int i) {
			return getRuleContext(CdefinitiondeclContext.class,i);
		}
		public List<NamedfuncContext> namedfunc() {
			return getRuleContexts(NamedfuncContext.class);
		}
		public NamedfuncContext namedfunc(int i) {
			return getRuleContext(NamedfuncContext.class,i);
		}
		public List<FuncdeclContext> funcdecl() {
			return getRuleContexts(FuncdeclContext.class);
		}
		public FuncdeclContext funcdecl(int i) {
			return getRuleContext(FuncdeclContext.class,i);
		}
		public List<CompilationhintContext> compilationhint() {
			return getRuleContexts(CompilationhintContext.class);
		}
		public CompilationhintContext compilationhint(int i) {
			return getRuleContext(CompilationhintContext.class,i);
		}
		public List<LinkerhintContext> linkerhint() {
			return getRuleContexts(LinkerhintContext.class);
		}
		public LinkerhintContext linkerhint(int i) {
			return getRuleContext(LinkerhintContext.class,i);
		}
		public List<StructdeclContext> structdecl() {
			return getRuleContexts(StructdeclContext.class);
		}
		public StructdeclContext structdecl(int i) {
			return getRuleContext(StructdeclContext.class,i);
		}
		public ProgContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_prog; }
	}

	public final ProgContext prog() throws RecognitionException {
		ProgContext _localctx = new ProgContext(_ctx, getState());
		enterRule(_localctx, 0, RULE_prog);
		int _la;
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(70);
			_errHandler.sync(this);
			_la = _input.LA(1);
			while ((((_la) & ~0x3f) == 0 && ((1L << _la) & 639511147086610688L) != 0)) {
				{
				setState(68);
				_errHandler.sync(this);
				switch ( getInterpreter().adaptivePredict(_input,0,_ctx) ) {
				case 1:
					{
					setState(62);
					cdefinitiondecl();
					}
					break;
				case 2:
					{
					setState(63);
					namedfunc();
					}
					break;
				case 3:
					{
					setState(64);
					funcdecl();
					}
					break;
				case 4:
					{
					setState(65);
					compilationhint();
					}
					break;
				case 5:
					{
					setState(66);
					linkerhint();
					}
					break;
				case 6:
					{
					setState(67);
					structdecl();
					}
					break;
				}
				}
				setState(72);
				_errHandler.sync(this);
				_la = _input.LA(1);
			}
			}
		}
		catch (RecognitionException re) {
			_localctx.exception = re;
			_errHandler.reportError(this, re);
			_errHandler.recover(this, re);
		}
		finally {
			exitRule();
		}
		return _localctx;
	}

	@SuppressWarnings("CheckReturnValue")
	public static class NamedfuncContext extends ParserRuleContext {
		public TerminalNode ID() { return getToken(HazeParser.ID, 0); }
		public ParamsContext params() {
			return getRuleContext(ParamsContext.class,0);
		}
		public FuncbodyContext funcbody() {
			return getRuleContext(FuncbodyContext.class,0);
		}
		public DatatypeContext datatype() {
			return getRuleContext(DatatypeContext.class,0);
		}
		public NamedfuncContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_namedfunc; }
	}

	public final NamedfuncContext namedfunc() throws RecognitionException {
		NamedfuncContext _localctx = new NamedfuncContext(_ctx, getState());
		enterRule(_localctx, 2, RULE_namedfunc);
		int _la;
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(73);
			match(ID);
			setState(74);
			match(T__0);
			setState(75);
			params();
			setState(76);
			match(T__1);
			setState(79);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (_la==T__2) {
				{
				setState(77);
				match(T__2);
				setState(78);
				datatype();
				}
			}

			setState(81);
			funcbody();
			}
		}
		catch (RecognitionException re) {
			_localctx.exception = re;
			_errHandler.reportError(this, re);
			_errHandler.recover(this, re);
		}
		finally {
			exitRule();
		}
		return _localctx;
	}

	@SuppressWarnings("CheckReturnValue")
	public static class FuncContext extends ParserRuleContext {
		public ParamsContext params() {
			return getRuleContext(ParamsContext.class,0);
		}
		public FuncbodyContext funcbody() {
			return getRuleContext(FuncbodyContext.class,0);
		}
		public DatatypeContext datatype() {
			return getRuleContext(DatatypeContext.class,0);
		}
		public FuncContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_func; }
	}

	public final FuncContext func() throws RecognitionException {
		FuncContext _localctx = new FuncContext(_ctx, getState());
		enterRule(_localctx, 4, RULE_func);
		int _la;
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(83);
			match(T__0);
			setState(84);
			params();
			setState(85);
			match(T__1);
			setState(88);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (_la==T__2) {
				{
				setState(86);
				match(T__2);
				setState(87);
				datatype();
				}
			}

			setState(90);
			funcbody();
			}
		}
		catch (RecognitionException re) {
			_localctx.exception = re;
			_errHandler.reportError(this, re);
			_errHandler.recover(this, re);
		}
		finally {
			exitRule();
		}
		return _localctx;
	}

	@SuppressWarnings("CheckReturnValue")
	public static class FuncbodyContext extends ParserRuleContext {
		public BodyContext body() {
			return getRuleContext(BodyContext.class,0);
		}
		public ExprContext expr() {
			return getRuleContext(ExprContext.class,0);
		}
		public FuncbodyContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_funcbody; }
	}

	public final FuncbodyContext funcbody() throws RecognitionException {
		FuncbodyContext _localctx = new FuncbodyContext(_ctx, getState());
		enterRule(_localctx, 6, RULE_funcbody);
		int _la;
		try {
			setState(101);
			_errHandler.sync(this);
			switch ( getInterpreter().adaptivePredict(_input,5,_ctx) ) {
			case 1:
				enterOuterAlt(_localctx, 1);
				{
				setState(93);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (_la==T__3) {
					{
					setState(92);
					match(T__3);
					}
				}

				setState(95);
				match(T__4);
				setState(96);
				body();
				setState(97);
				match(T__5);
				}
				break;
			case 2:
				enterOuterAlt(_localctx, 2);
				{
				setState(99);
				match(T__3);
				setState(100);
				expr(0);
				}
				break;
			}
		}
		catch (RecognitionException re) {
			_localctx.exception = re;
			_errHandler.reportError(this, re);
			_errHandler.recover(this, re);
		}
		finally {
			exitRule();
		}
		return _localctx;
	}

	@SuppressWarnings("CheckReturnValue")
	public static class BodyContext extends ParserRuleContext {
		public List<StatementContext> statement() {
			return getRuleContexts(StatementContext.class);
		}
		public StatementContext statement(int i) {
			return getRuleContext(StatementContext.class,i);
		}
		public BodyContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_body; }
	}

	public final BodyContext body() throws RecognitionException {
		BodyContext _localctx = new BodyContext(_ctx, getState());
		enterRule(_localctx, 8, RULE_body);
		int _la;
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(106);
			_errHandler.sync(this);
			_la = _input.LA(1);
			while ((((_la) & ~0x3f) == 0 && ((1L << _la) & 1087619310143528962L) != 0)) {
				{
				{
				setState(103);
				statement();
				}
				}
				setState(108);
				_errHandler.sync(this);
				_la = _input.LA(1);
			}
			}
		}
		catch (RecognitionException re) {
			_localctx.exception = re;
			_errHandler.reportError(this, re);
			_errHandler.recover(this, re);
		}
		finally {
			exitRule();
		}
		return _localctx;
	}

	@SuppressWarnings("CheckReturnValue")
	public static class ParamContext extends ParserRuleContext {
		public TerminalNode ID() { return getToken(HazeParser.ID, 0); }
		public DatatypeContext datatype() {
			return getRuleContext(DatatypeContext.class,0);
		}
		public ParamContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_param; }
	}

	public final ParamContext param() throws RecognitionException {
		ParamContext _localctx = new ParamContext(_ctx, getState());
		enterRule(_localctx, 10, RULE_param);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(109);
			match(ID);
			setState(110);
			match(T__2);
			setState(111);
			datatype();
			}
		}
		catch (RecognitionException re) {
			_localctx.exception = re;
			_errHandler.reportError(this, re);
			_errHandler.recover(this, re);
		}
		finally {
			exitRule();
		}
		return _localctx;
	}

	@SuppressWarnings("CheckReturnValue")
	public static class ParamsContext extends ParserRuleContext {
		public List<ParamContext> param() {
			return getRuleContexts(ParamContext.class);
		}
		public ParamContext param(int i) {
			return getRuleContext(ParamContext.class,i);
		}
		public EllipsisContext ellipsis() {
			return getRuleContext(EllipsisContext.class,0);
		}
		public ParamsContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_params; }
	}

	public final ParamsContext params() throws RecognitionException {
		ParamsContext _localctx = new ParamsContext(_ctx, getState());
		enterRule(_localctx, 12, RULE_params);
		int _la;
		try {
			int _alt;
			setState(128);
			_errHandler.sync(this);
			switch (_input.LA(1)) {
			case T__1:
			case ID:
				enterOuterAlt(_localctx, 1);
				{
				setState(125);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (_la==ID) {
					{
					setState(113);
					param();
					setState(118);
					_errHandler.sync(this);
					_alt = getInterpreter().adaptivePredict(_input,7,_ctx);
					while ( _alt!=2 && _alt!=org.antlr.v4.runtime.atn.ATN.INVALID_ALT_NUMBER ) {
						if ( _alt==1 ) {
							{
							{
							setState(114);
							match(T__6);
							setState(115);
							param();
							}
							} 
						}
						setState(120);
						_errHandler.sync(this);
						_alt = getInterpreter().adaptivePredict(_input,7,_ctx);
					}
					setState(123);
					_errHandler.sync(this);
					_la = _input.LA(1);
					if (_la==T__6) {
						{
						setState(121);
						match(T__6);
						setState(122);
						ellipsis();
						}
					}

					}
				}

				}
				break;
			case T__49:
				enterOuterAlt(_localctx, 2);
				{
				setState(127);
				ellipsis();
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
		}
		catch (RecognitionException re) {
			_localctx.exception = re;
			_errHandler.reportError(this, re);
			_errHandler.recover(this, re);
		}
		finally {
			exitRule();
		}
		return _localctx;
	}

	@SuppressWarnings("CheckReturnValue")
	public static class CdefinitiondeclContext extends ParserRuleContext {
		public TerminalNode STRING_LITERAL() { return getToken(HazeParser.STRING_LITERAL, 0); }
		public ExternlangContext externlang() {
			return getRuleContext(ExternlangContext.class,0);
		}
		public CdefinitiondeclContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_cdefinitiondecl; }
	}

	public final CdefinitiondeclContext cdefinitiondecl() throws RecognitionException {
		CdefinitiondeclContext _localctx = new CdefinitiondeclContext(_ctx, getState());
		enterRule(_localctx, 14, RULE_cdefinitiondecl);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(130);
			match(T__7);
			{
			setState(131);
			externlang();
			}
			setState(132);
			match(STRING_LITERAL);
			setState(133);
			match(T__8);
			}
		}
		catch (RecognitionException re) {
			_localctx.exception = re;
			_errHandler.reportError(this, re);
			_errHandler.recover(this, re);
		}
		finally {
			exitRule();
		}
		return _localctx;
	}

	@SuppressWarnings("CheckReturnValue")
	public static class FuncdeclContext extends ParserRuleContext {
		public List<TerminalNode> ID() { return getTokens(HazeParser.ID); }
		public TerminalNode ID(int i) {
			return getToken(HazeParser.ID, i);
		}
		public ParamsContext params() {
			return getRuleContext(ParamsContext.class,0);
		}
		public ExternlangContext externlang() {
			return getRuleContext(ExternlangContext.class,0);
		}
		public DatatypeContext datatype() {
			return getRuleContext(DatatypeContext.class,0);
		}
		public FuncdeclContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_funcdecl; }
	}

	public final FuncdeclContext funcdecl() throws RecognitionException {
		FuncdeclContext _localctx = new FuncdeclContext(_ctx, getState());
		enterRule(_localctx, 16, RULE_funcdecl);
		int _la;
		try {
			int _alt;
			enterOuterAlt(_localctx, 1);
			{
			setState(135);
			match(T__7);
			setState(137);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (_la==T__10 || _la==T__11) {
				{
				setState(136);
				externlang();
				}
			}

			setState(143);
			_errHandler.sync(this);
			_alt = getInterpreter().adaptivePredict(_input,12,_ctx);
			while ( _alt!=2 && _alt!=org.antlr.v4.runtime.atn.ATN.INVALID_ALT_NUMBER ) {
				if ( _alt==1 ) {
					{
					{
					setState(139);
					match(ID);
					setState(140);
					match(T__9);
					}
					} 
				}
				setState(145);
				_errHandler.sync(this);
				_alt = getInterpreter().adaptivePredict(_input,12,_ctx);
			}
			setState(146);
			match(ID);
			setState(147);
			match(T__0);
			setState(148);
			params();
			setState(149);
			match(T__1);
			setState(152);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (_la==T__2) {
				{
				setState(150);
				match(T__2);
				setState(151);
				datatype();
				}
			}

			setState(154);
			match(T__8);
			}
		}
		catch (RecognitionException re) {
			_localctx.exception = re;
			_errHandler.reportError(this, re);
			_errHandler.recover(this, re);
		}
		finally {
			exitRule();
		}
		return _localctx;
	}

	@SuppressWarnings("CheckReturnValue")
	public static class ExternlangContext extends ParserRuleContext {
		public ExternlangContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_externlang; }
	}

	public final ExternlangContext externlang() throws RecognitionException {
		ExternlangContext _localctx = new ExternlangContext(_ctx, getState());
		enterRule(_localctx, 18, RULE_externlang);
		int _la;
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(156);
			_la = _input.LA(1);
			if ( !(_la==T__10 || _la==T__11) ) {
			_errHandler.recoverInline(this);
			}
			else {
				if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
				_errHandler.reportMatch(this);
				consume();
			}
			}
		}
		catch (RecognitionException re) {
			_localctx.exception = re;
			_errHandler.reportError(this, re);
			_errHandler.recover(this, re);
		}
		finally {
			exitRule();
		}
		return _localctx;
	}

	@SuppressWarnings("CheckReturnValue")
	public static class IfexprContext extends ParserRuleContext {
		public ExprContext expr() {
			return getRuleContext(ExprContext.class,0);
		}
		public IfexprContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_ifexpr; }
	}

	public final IfexprContext ifexpr() throws RecognitionException {
		IfexprContext _localctx = new IfexprContext(_ctx, getState());
		enterRule(_localctx, 20, RULE_ifexpr);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(158);
			expr(0);
			}
		}
		catch (RecognitionException re) {
			_localctx.exception = re;
			_errHandler.reportError(this, re);
			_errHandler.recover(this, re);
		}
		finally {
			exitRule();
		}
		return _localctx;
	}

	@SuppressWarnings("CheckReturnValue")
	public static class ElseifexprContext extends ParserRuleContext {
		public ExprContext expr() {
			return getRuleContext(ExprContext.class,0);
		}
		public ElseifexprContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_elseifexpr; }
	}

	public final ElseifexprContext elseifexpr() throws RecognitionException {
		ElseifexprContext _localctx = new ElseifexprContext(_ctx, getState());
		enterRule(_localctx, 22, RULE_elseifexpr);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(160);
			expr(0);
			}
		}
		catch (RecognitionException re) {
			_localctx.exception = re;
			_errHandler.reportError(this, re);
			_errHandler.recover(this, re);
		}
		finally {
			exitRule();
		}
		return _localctx;
	}

	@SuppressWarnings("CheckReturnValue")
	public static class ThenblockContext extends ParserRuleContext {
		public BodyContext body() {
			return getRuleContext(BodyContext.class,0);
		}
		public ThenblockContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_thenblock; }
	}

	public final ThenblockContext thenblock() throws RecognitionException {
		ThenblockContext _localctx = new ThenblockContext(_ctx, getState());
		enterRule(_localctx, 24, RULE_thenblock);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(162);
			body();
			}
		}
		catch (RecognitionException re) {
			_localctx.exception = re;
			_errHandler.reportError(this, re);
			_errHandler.recover(this, re);
		}
		finally {
			exitRule();
		}
		return _localctx;
	}

	@SuppressWarnings("CheckReturnValue")
	public static class ElseifblockContext extends ParserRuleContext {
		public BodyContext body() {
			return getRuleContext(BodyContext.class,0);
		}
		public ElseifblockContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_elseifblock; }
	}

	public final ElseifblockContext elseifblock() throws RecognitionException {
		ElseifblockContext _localctx = new ElseifblockContext(_ctx, getState());
		enterRule(_localctx, 26, RULE_elseifblock);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(164);
			body();
			}
		}
		catch (RecognitionException re) {
			_localctx.exception = re;
			_errHandler.reportError(this, re);
			_errHandler.recover(this, re);
		}
		finally {
			exitRule();
		}
		return _localctx;
	}

	@SuppressWarnings("CheckReturnValue")
	public static class ElseblockContext extends ParserRuleContext {
		public BodyContext body() {
			return getRuleContext(BodyContext.class,0);
		}
		public ElseblockContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_elseblock; }
	}

	public final ElseblockContext elseblock() throws RecognitionException {
		ElseblockContext _localctx = new ElseblockContext(_ctx, getState());
		enterRule(_localctx, 28, RULE_elseblock);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(166);
			body();
			}
		}
		catch (RecognitionException re) {
			_localctx.exception = re;
			_errHandler.reportError(this, re);
			_errHandler.recover(this, re);
		}
		finally {
			exitRule();
		}
		return _localctx;
	}

	@SuppressWarnings("CheckReturnValue")
	public static class VariablemutabilityContext extends ParserRuleContext {
		public VariablemutabilityContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_variablemutability; }
	 
		public VariablemutabilityContext() { }
		public void copyFrom(VariablemutabilityContext ctx) {
			super.copyFrom(ctx);
		}
	}
	@SuppressWarnings("CheckReturnValue")
	public static class VariableMutabilityContext extends VariablemutabilityContext {
		public VariableMutabilityContext(VariablemutabilityContext ctx) { copyFrom(ctx); }
	}

	public final VariablemutabilityContext variablemutability() throws RecognitionException {
		VariablemutabilityContext _localctx = new VariablemutabilityContext(_ctx, getState());
		enterRule(_localctx, 30, RULE_variablemutability);
		int _la;
		try {
			_localctx = new VariableMutabilityContext(_localctx);
			enterOuterAlt(_localctx, 1);
			{
			setState(168);
			_la = _input.LA(1);
			if ( !(_la==T__12 || _la==T__13) ) {
			_errHandler.recoverInline(this);
			}
			else {
				if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
				_errHandler.reportMatch(this);
				consume();
			}
			}
		}
		catch (RecognitionException re) {
			_localctx.exception = re;
			_errHandler.reportError(this, re);
			_errHandler.recover(this, re);
		}
		finally {
			exitRule();
		}
		return _localctx;
	}

	@SuppressWarnings("CheckReturnValue")
	public static class StatementContext extends ParserRuleContext {
		public StatementContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_statement; }
	 
		public StatementContext() { }
		public void copyFrom(StatementContext ctx) {
			super.copyFrom(ctx);
		}
	}
	@SuppressWarnings("CheckReturnValue")
	public static class IfStatementContext extends StatementContext {
		public IfexprContext ifexpr() {
			return getRuleContext(IfexprContext.class,0);
		}
		public ThenblockContext thenblock() {
			return getRuleContext(ThenblockContext.class,0);
		}
		public List<ElseifexprContext> elseifexpr() {
			return getRuleContexts(ElseifexprContext.class);
		}
		public ElseifexprContext elseifexpr(int i) {
			return getRuleContext(ElseifexprContext.class,i);
		}
		public List<ElseifblockContext> elseifblock() {
			return getRuleContexts(ElseifblockContext.class);
		}
		public ElseifblockContext elseifblock(int i) {
			return getRuleContext(ElseifblockContext.class,i);
		}
		public ElseblockContext elseblock() {
			return getRuleContext(ElseblockContext.class,0);
		}
		public IfStatementContext(StatementContext ctx) { copyFrom(ctx); }
	}
	@SuppressWarnings("CheckReturnValue")
	public static class VariableDefinitionContext extends StatementContext {
		public VariablemutabilityContext variablemutability() {
			return getRuleContext(VariablemutabilityContext.class,0);
		}
		public TerminalNode ID() { return getToken(HazeParser.ID, 0); }
		public ExprContext expr() {
			return getRuleContext(ExprContext.class,0);
		}
		public DatatypeContext datatype() {
			return getRuleContext(DatatypeContext.class,0);
		}
		public VariableDefinitionContext(StatementContext ctx) { copyFrom(ctx); }
	}
	@SuppressWarnings("CheckReturnValue")
	public static class InlineCStatementContext extends StatementContext {
		public TerminalNode STRING_LITERAL() { return getToken(HazeParser.STRING_LITERAL, 0); }
		public InlineCStatementContext(StatementContext ctx) { copyFrom(ctx); }
	}
	@SuppressWarnings("CheckReturnValue")
	public static class ExprStatementContext extends StatementContext {
		public ExprContext expr() {
			return getRuleContext(ExprContext.class,0);
		}
		public ExprStatementContext(StatementContext ctx) { copyFrom(ctx); }
	}
	@SuppressWarnings("CheckReturnValue")
	public static class ReturnStatementContext extends StatementContext {
		public ExprContext expr() {
			return getRuleContext(ExprContext.class,0);
		}
		public ReturnStatementContext(StatementContext ctx) { copyFrom(ctx); }
	}
	@SuppressWarnings("CheckReturnValue")
	public static class WhileStatementContext extends StatementContext {
		public ExprContext expr() {
			return getRuleContext(ExprContext.class,0);
		}
		public BodyContext body() {
			return getRuleContext(BodyContext.class,0);
		}
		public WhileStatementContext(StatementContext ctx) { copyFrom(ctx); }
	}

	public final StatementContext statement() throws RecognitionException {
		StatementContext _localctx = new StatementContext(_ctx, getState());
		enterRule(_localctx, 32, RULE_statement);
		int _la;
		try {
			int _alt;
			setState(223);
			_errHandler.sync(this);
			switch (_input.LA(1)) {
			case T__14:
				_localctx = new InlineCStatementContext(_localctx);
				enterOuterAlt(_localctx, 1);
				{
				setState(170);
				match(T__14);
				setState(171);
				match(T__0);
				setState(172);
				match(STRING_LITERAL);
				setState(173);
				match(T__1);
				setState(174);
				match(T__8);
				}
				break;
			case T__0:
			case T__20:
			case T__21:
			case T__22:
			case T__23:
			case T__24:
			case T__25:
			case T__50:
			case T__51:
			case STRING_LITERAL:
			case UNIT_LITERAL:
			case NUMBER_LITERAL:
			case ID:
				_localctx = new ExprStatementContext(_localctx);
				enterOuterAlt(_localctx, 2);
				{
				setState(175);
				expr(0);
				setState(176);
				match(T__8);
				}
				break;
			case T__15:
				_localctx = new ReturnStatementContext(_localctx);
				enterOuterAlt(_localctx, 3);
				{
				setState(178);
				match(T__15);
				setState(180);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if ((((_la) & ~0x3f) == 0 && ((1L << _la) & 1087619310142095362L) != 0)) {
					{
					setState(179);
					expr(0);
					}
				}

				setState(182);
				match(T__8);
				}
				break;
			case T__12:
			case T__13:
				_localctx = new VariableDefinitionContext(_localctx);
				enterOuterAlt(_localctx, 4);
				{
				setState(183);
				variablemutability();
				setState(184);
				match(ID);
				setState(187);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (_la==T__2) {
					{
					setState(185);
					match(T__2);
					setState(186);
					datatype();
					}
				}

				setState(189);
				match(T__16);
				setState(190);
				expr(0);
				setState(191);
				match(T__8);
				}
				break;
			case T__17:
				_localctx = new IfStatementContext(_localctx);
				enterOuterAlt(_localctx, 5);
				{
				setState(193);
				match(T__17);
				setState(194);
				ifexpr();
				setState(195);
				match(T__4);
				setState(196);
				thenblock();
				setState(197);
				match(T__5);
				setState(207);
				_errHandler.sync(this);
				_alt = getInterpreter().adaptivePredict(_input,16,_ctx);
				while ( _alt!=2 && _alt!=org.antlr.v4.runtime.atn.ATN.INVALID_ALT_NUMBER ) {
					if ( _alt==1 ) {
						{
						{
						setState(198);
						match(T__18);
						setState(199);
						match(T__17);
						setState(200);
						elseifexpr();
						setState(201);
						match(T__4);
						setState(202);
						elseifblock();
						setState(203);
						match(T__5);
						}
						} 
					}
					setState(209);
					_errHandler.sync(this);
					_alt = getInterpreter().adaptivePredict(_input,16,_ctx);
				}
				setState(215);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (_la==T__18) {
					{
					setState(210);
					match(T__18);
					setState(211);
					match(T__4);
					setState(212);
					elseblock();
					setState(213);
					match(T__5);
					}
				}

				}
				break;
			case T__19:
				_localctx = new WhileStatementContext(_localctx);
				enterOuterAlt(_localctx, 6);
				{
				setState(217);
				match(T__19);
				setState(218);
				expr(0);
				setState(219);
				match(T__4);
				setState(220);
				body();
				setState(221);
				match(T__5);
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
		}
		catch (RecognitionException re) {
			_localctx.exception = re;
			_errHandler.reportError(this, re);
			_errHandler.recover(this, re);
		}
		finally {
			exitRule();
		}
		return _localctx;
	}

	@SuppressWarnings("CheckReturnValue")
	public static class StructmembervalueContext extends ParserRuleContext {
		public StructmembervalueContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_structmembervalue; }
	 
		public StructmembervalueContext() { }
		public void copyFrom(StructmembervalueContext ctx) {
			super.copyFrom(ctx);
		}
	}
	@SuppressWarnings("CheckReturnValue")
	public static class StructMemberValueContext extends StructmembervalueContext {
		public TerminalNode ID() { return getToken(HazeParser.ID, 0); }
		public ExprContext expr() {
			return getRuleContext(ExprContext.class,0);
		}
		public StructMemberValueContext(StructmembervalueContext ctx) { copyFrom(ctx); }
	}

	public final StructmembervalueContext structmembervalue() throws RecognitionException {
		StructmembervalueContext _localctx = new StructmembervalueContext(_ctx, getState());
		enterRule(_localctx, 34, RULE_structmembervalue);
		try {
			_localctx = new StructMemberValueContext(_localctx);
			enterOuterAlt(_localctx, 1);
			{
			setState(225);
			match(T__9);
			setState(226);
			match(ID);
			setState(227);
			match(T__2);
			setState(228);
			expr(0);
			}
		}
		catch (RecognitionException re) {
			_localctx.exception = re;
			_errHandler.reportError(this, re);
			_errHandler.recover(this, re);
		}
		finally {
			exitRule();
		}
		return _localctx;
	}

	@SuppressWarnings("CheckReturnValue")
	public static class ExprContext extends ParserRuleContext {
		public ExprContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_expr; }
	 
		public ExprContext() { }
		public void copyFrom(ExprContext ctx) {
			super.copyFrom(ctx);
		}
	}
	@SuppressWarnings("CheckReturnValue")
	public static class SymbolValueExprContext extends ExprContext {
		public TerminalNode ID() { return getToken(HazeParser.ID, 0); }
		public List<DatatypeContext> datatype() {
			return getRuleContexts(DatatypeContext.class);
		}
		public DatatypeContext datatype(int i) {
			return getRuleContext(DatatypeContext.class,i);
		}
		public SymbolValueExprContext(ExprContext ctx) { copyFrom(ctx); }
	}
	@SuppressWarnings("CheckReturnValue")
	public static class ParenthesisExprContext extends ExprContext {
		public ExprContext expr() {
			return getRuleContext(ExprContext.class,0);
		}
		public ParenthesisExprContext(ExprContext ctx) { copyFrom(ctx); }
	}
	@SuppressWarnings("CheckReturnValue")
	public static class ExprMemberAccessContext extends ExprContext {
		public ExprContext expr() {
			return getRuleContext(ExprContext.class,0);
		}
		public TerminalNode ID() { return getToken(HazeParser.ID, 0); }
		public ExprMemberAccessContext(ExprContext ctx) { copyFrom(ctx); }
	}
	@SuppressWarnings("CheckReturnValue")
	public static class BinaryExprContext extends ExprContext {
		public List<ExprContext> expr() {
			return getRuleContexts(ExprContext.class);
		}
		public ExprContext expr(int i) {
			return getRuleContext(ExprContext.class,i);
		}
		public BinaryExprContext(ExprContext ctx) { copyFrom(ctx); }
	}
	@SuppressWarnings("CheckReturnValue")
	public static class FuncRefExprContext extends ExprContext {
		public FuncContext func() {
			return getRuleContext(FuncContext.class,0);
		}
		public FuncRefExprContext(ExprContext ctx) { copyFrom(ctx); }
	}
	@SuppressWarnings("CheckReturnValue")
	public static class ConstantExprContext extends ExprContext {
		public ConstantContext constant() {
			return getRuleContext(ConstantContext.class,0);
		}
		public ConstantExprContext(ExprContext ctx) { copyFrom(ctx); }
	}
	@SuppressWarnings("CheckReturnValue")
	public static class PreIncrExprContext extends ExprContext {
		public Token op;
		public ExprContext expr() {
			return getRuleContext(ExprContext.class,0);
		}
		public PreIncrExprContext(ExprContext ctx) { copyFrom(ctx); }
	}
	@SuppressWarnings("CheckReturnValue")
	public static class StructInstantiationExprContext extends ExprContext {
		public DatatypeContext datatype() {
			return getRuleContext(DatatypeContext.class,0);
		}
		public List<StructmembervalueContext> structmembervalue() {
			return getRuleContexts(StructmembervalueContext.class);
		}
		public StructmembervalueContext structmembervalue(int i) {
			return getRuleContext(StructmembervalueContext.class,i);
		}
		public StructInstantiationExprContext(ExprContext ctx) { copyFrom(ctx); }
	}
	@SuppressWarnings("CheckReturnValue")
	public static class UnaryExprContext extends ExprContext {
		public Token op;
		public ExprContext expr() {
			return getRuleContext(ExprContext.class,0);
		}
		public UnaryExprContext(ExprContext ctx) { copyFrom(ctx); }
	}
	@SuppressWarnings("CheckReturnValue")
	public static class PostIncrExprContext extends ExprContext {
		public Token op;
		public ExprContext expr() {
			return getRuleContext(ExprContext.class,0);
		}
		public PostIncrExprContext(ExprContext ctx) { copyFrom(ctx); }
	}
	@SuppressWarnings("CheckReturnValue")
	public static class ExprCallExprContext extends ExprContext {
		public ExprContext expr() {
			return getRuleContext(ExprContext.class,0);
		}
		public ArgsContext args() {
			return getRuleContext(ArgsContext.class,0);
		}
		public ExprCallExprContext(ExprContext ctx) { copyFrom(ctx); }
	}
	@SuppressWarnings("CheckReturnValue")
	public static class ExprAssignmentExprContext extends ExprContext {
		public Token op;
		public List<ExprContext> expr() {
			return getRuleContexts(ExprContext.class);
		}
		public ExprContext expr(int i) {
			return getRuleContext(ExprContext.class,i);
		}
		public ExprAssignmentExprContext(ExprContext ctx) { copyFrom(ctx); }
	}
	@SuppressWarnings("CheckReturnValue")
	public static class ExplicitCastExprContext extends ExprContext {
		public ExprContext expr() {
			return getRuleContext(ExprContext.class,0);
		}
		public DatatypeContext datatype() {
			return getRuleContext(DatatypeContext.class,0);
		}
		public ExplicitCastExprContext(ExprContext ctx) { copyFrom(ctx); }
	}

	public final ExprContext expr() throws RecognitionException {
		return expr(0);
	}

	private ExprContext expr(int _p) throws RecognitionException {
		ParserRuleContext _parentctx = _ctx;
		int _parentState = getState();
		ExprContext _localctx = new ExprContext(_ctx, _parentState);
		ExprContext _prevctx = _localctx;
		int _startState = 36;
		enterRecursionRule(_localctx, 36, RULE_expr, _p);
		int _la;
		try {
			int _alt;
			enterOuterAlt(_localctx, 1);
			{
			setState(274);
			_errHandler.sync(this);
			switch ( getInterpreter().adaptivePredict(_input,24,_ctx) ) {
			case 1:
				{
				_localctx = new ParenthesisExprContext(_localctx);
				_ctx = _localctx;
				_prevctx = _localctx;

				setState(231);
				match(T__0);
				setState(232);
				expr(0);
				setState(233);
				match(T__1);
				}
				break;
			case 2:
				{
				_localctx = new FuncRefExprContext(_localctx);
				_ctx = _localctx;
				_prevctx = _localctx;
				setState(235);
				func();
				}
				break;
			case 3:
				{
				_localctx = new ConstantExprContext(_localctx);
				_ctx = _localctx;
				_prevctx = _localctx;
				setState(236);
				constant();
				}
				break;
			case 4:
				{
				_localctx = new StructInstantiationExprContext(_localctx);
				_ctx = _localctx;
				_prevctx = _localctx;
				setState(237);
				datatype();
				setState(238);
				match(T__4);
				setState(240);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (_la==T__9) {
					{
					setState(239);
					structmembervalue();
					}
				}

				setState(246);
				_errHandler.sync(this);
				_alt = getInterpreter().adaptivePredict(_input,20,_ctx);
				while ( _alt!=2 && _alt!=org.antlr.v4.runtime.atn.ATN.INVALID_ALT_NUMBER ) {
					if ( _alt==1 ) {
						{
						{
						setState(242);
						match(T__6);
						setState(243);
						structmembervalue();
						}
						} 
					}
					setState(248);
					_errHandler.sync(this);
					_alt = getInterpreter().adaptivePredict(_input,20,_ctx);
				}
				setState(250);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (_la==T__6) {
					{
					setState(249);
					match(T__6);
					}
				}

				setState(252);
				match(T__5);
				}
				break;
			case 5:
				{
				_localctx = new PreIncrExprContext(_localctx);
				_ctx = _localctx;
				_prevctx = _localctx;
				setState(254);
				((PreIncrExprContext)_localctx).op = _input.LT(1);
				_la = _input.LA(1);
				if ( !(_la==T__20 || _la==T__21) ) {
					((PreIncrExprContext)_localctx).op = (Token)_errHandler.recoverInline(this);
				}
				else {
					if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
					_errHandler.reportMatch(this);
					consume();
				}
				setState(255);
				expr(11);
				}
				break;
			case 6:
				{
				_localctx = new UnaryExprContext(_localctx);
				_ctx = _localctx;
				_prevctx = _localctx;
				setState(256);
				((UnaryExprContext)_localctx).op = _input.LT(1);
				_la = _input.LA(1);
				if ( !(_la==T__22 || _la==T__23) ) {
					((UnaryExprContext)_localctx).op = (Token)_errHandler.recoverInline(this);
				}
				else {
					if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
					_errHandler.reportMatch(this);
					consume();
				}
				setState(257);
				expr(10);
				}
				break;
			case 7:
				{
				_localctx = new UnaryExprContext(_localctx);
				_ctx = _localctx;
				_prevctx = _localctx;
				setState(258);
				_la = _input.LA(1);
				if ( !(_la==T__24 || _la==T__25) ) {
				_errHandler.recoverInline(this);
				}
				else {
					if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
					_errHandler.reportMatch(this);
					consume();
				}
				setState(259);
				expr(9);
				}
				break;
			case 8:
				{
				_localctx = new SymbolValueExprContext(_localctx);
				_ctx = _localctx;
				_prevctx = _localctx;
				setState(260);
				match(ID);
				setState(272);
				_errHandler.sync(this);
				switch ( getInterpreter().adaptivePredict(_input,23,_ctx) ) {
				case 1:
					{
					setState(261);
					match(T__30);
					setState(262);
					datatype();
					setState(267);
					_errHandler.sync(this);
					_la = _input.LA(1);
					while (_la==T__6) {
						{
						{
						setState(263);
						match(T__6);
						setState(264);
						datatype();
						}
						}
						setState(269);
						_errHandler.sync(this);
						_la = _input.LA(1);
					}
					setState(270);
					match(T__31);
					}
					break;
				}
				}
				break;
			}
			_ctx.stop = _input.LT(-1);
			setState(315);
			_errHandler.sync(this);
			_alt = getInterpreter().adaptivePredict(_input,27,_ctx);
			while ( _alt!=2 && _alt!=org.antlr.v4.runtime.atn.ATN.INVALID_ALT_NUMBER ) {
				if ( _alt==1 ) {
					if ( _parseListeners!=null ) triggerExitRuleEvent();
					_prevctx = _localctx;
					{
					setState(313);
					_errHandler.sync(this);
					switch ( getInterpreter().adaptivePredict(_input,26,_ctx) ) {
					case 1:
						{
						_localctx = new BinaryExprContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(276);
						if (!(precpred(_ctx, 7))) throw new FailedPredicateException(this, "precpred(_ctx, 7)");
						setState(277);
						_la = _input.LA(1);
						if ( !((((_la) & ~0x3f) == 0 && ((1L << _la) & 1879048192L) != 0)) ) {
						_errHandler.recoverInline(this);
						}
						else {
							if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
							_errHandler.reportMatch(this);
							consume();
						}
						setState(278);
						expr(8);
						}
						break;
					case 2:
						{
						_localctx = new BinaryExprContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(279);
						if (!(precpred(_ctx, 6))) throw new FailedPredicateException(this, "precpred(_ctx, 6)");
						setState(280);
						_la = _input.LA(1);
						if ( !(_la==T__22 || _la==T__23) ) {
						_errHandler.recoverInline(this);
						}
						else {
							if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
							_errHandler.reportMatch(this);
							consume();
						}
						setState(281);
						expr(7);
						}
						break;
					case 3:
						{
						_localctx = new BinaryExprContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(282);
						if (!(precpred(_ctx, 5))) throw new FailedPredicateException(this, "precpred(_ctx, 5)");
						setState(283);
						_la = _input.LA(1);
						if ( !((((_la) & ~0x3f) == 0 && ((1L << _la) & 32212254720L) != 0)) ) {
						_errHandler.recoverInline(this);
						}
						else {
							if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
							_errHandler.reportMatch(this);
							consume();
						}
						setState(284);
						expr(6);
						}
						break;
					case 4:
						{
						_localctx = new BinaryExprContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(285);
						if (!(precpred(_ctx, 4))) throw new FailedPredicateException(this, "precpred(_ctx, 4)");
						setState(291);
						_errHandler.sync(this);
						switch ( getInterpreter().adaptivePredict(_input,25,_ctx) ) {
						case 1:
							{
							setState(286);
							match(T__34);
							}
							break;
						case 2:
							{
							setState(287);
							match(T__35);
							}
							break;
						case 3:
							{
							setState(288);
							match(T__36);
							}
							break;
						case 4:
							{
							{
							setState(289);
							match(T__36);
							setState(290);
							match(T__24);
							}
							}
							break;
						}
						setState(293);
						expr(5);
						}
						break;
					case 5:
						{
						_localctx = new BinaryExprContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(294);
						if (!(precpred(_ctx, 3))) throw new FailedPredicateException(this, "precpred(_ctx, 3)");
						setState(295);
						_la = _input.LA(1);
						if ( !(_la==T__37 || _la==T__38) ) {
						_errHandler.recoverInline(this);
						}
						else {
							if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
							_errHandler.reportMatch(this);
							consume();
						}
						setState(296);
						expr(4);
						}
						break;
					case 6:
						{
						_localctx = new ExprAssignmentExprContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(297);
						if (!(precpred(_ctx, 2))) throw new FailedPredicateException(this, "precpred(_ctx, 2)");
						setState(298);
						((ExprAssignmentExprContext)_localctx).op = _input.LT(1);
						_la = _input.LA(1);
						if ( !((((_la) & ~0x3f) == 0 && ((1L << _la) & 1124800395345920L) != 0)) ) {
							((ExprAssignmentExprContext)_localctx).op = (Token)_errHandler.recoverInline(this);
						}
						else {
							if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
							_errHandler.reportMatch(this);
							consume();
						}
						setState(299);
						expr(3);
						}
						break;
					case 7:
						{
						_localctx = new PostIncrExprContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(300);
						if (!(precpred(_ctx, 15))) throw new FailedPredicateException(this, "precpred(_ctx, 15)");
						setState(301);
						((PostIncrExprContext)_localctx).op = _input.LT(1);
						_la = _input.LA(1);
						if ( !(_la==T__20 || _la==T__21) ) {
							((PostIncrExprContext)_localctx).op = (Token)_errHandler.recoverInline(this);
						}
						else {
							if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
							_errHandler.reportMatch(this);
							consume();
						}
						}
						break;
					case 8:
						{
						_localctx = new ExprCallExprContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(302);
						if (!(precpred(_ctx, 14))) throw new FailedPredicateException(this, "precpred(_ctx, 14)");
						setState(303);
						match(T__0);
						setState(304);
						args();
						setState(305);
						match(T__1);
						}
						break;
					case 9:
						{
						_localctx = new ExprMemberAccessContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(307);
						if (!(precpred(_ctx, 13))) throw new FailedPredicateException(this, "precpred(_ctx, 13)");
						setState(308);
						match(T__9);
						setState(309);
						match(ID);
						}
						break;
					case 10:
						{
						_localctx = new ExplicitCastExprContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(310);
						if (!(precpred(_ctx, 8))) throw new FailedPredicateException(this, "precpred(_ctx, 8)");
						setState(311);
						match(T__26);
						setState(312);
						datatype();
						}
						break;
					}
					} 
				}
				setState(317);
				_errHandler.sync(this);
				_alt = getInterpreter().adaptivePredict(_input,27,_ctx);
			}
			}
		}
		catch (RecognitionException re) {
			_localctx.exception = re;
			_errHandler.reportError(this, re);
			_errHandler.recover(this, re);
		}
		finally {
			unrollRecursionContexts(_parentctx);
		}
		return _localctx;
	}

	@SuppressWarnings("CheckReturnValue")
	public static class ArgsContext extends ParserRuleContext {
		public List<ExprContext> expr() {
			return getRuleContexts(ExprContext.class);
		}
		public ExprContext expr(int i) {
			return getRuleContext(ExprContext.class,i);
		}
		public ArgsContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_args; }
	}

	public final ArgsContext args() throws RecognitionException {
		ArgsContext _localctx = new ArgsContext(_ctx, getState());
		enterRule(_localctx, 38, RULE_args);
		int _la;
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(326);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if ((((_la) & ~0x3f) == 0 && ((1L << _la) & 1087619310142095362L) != 0)) {
				{
				setState(318);
				expr(0);
				setState(323);
				_errHandler.sync(this);
				_la = _input.LA(1);
				while (_la==T__6) {
					{
					{
					setState(319);
					match(T__6);
					setState(320);
					expr(0);
					}
					}
					setState(325);
					_errHandler.sync(this);
					_la = _input.LA(1);
				}
				}
			}

			}
		}
		catch (RecognitionException re) {
			_localctx.exception = re;
			_errHandler.reportError(this, re);
			_errHandler.recover(this, re);
		}
		finally {
			exitRule();
		}
		return _localctx;
	}

	@SuppressWarnings("CheckReturnValue")
	public static class EllipsisContext extends ParserRuleContext {
		public EllipsisContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_ellipsis; }
	}

	public final EllipsisContext ellipsis() throws RecognitionException {
		EllipsisContext _localctx = new EllipsisContext(_ctx, getState());
		enterRule(_localctx, 40, RULE_ellipsis);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(328);
			match(T__49);
			}
		}
		catch (RecognitionException re) {
			_localctx.exception = re;
			_errHandler.reportError(this, re);
			_errHandler.recover(this, re);
		}
		finally {
			exitRule();
		}
		return _localctx;
	}

	@SuppressWarnings("CheckReturnValue")
	public static class FunctypeContext extends ParserRuleContext {
		public ParamsContext params() {
			return getRuleContext(ParamsContext.class,0);
		}
		public DatatypeContext datatype() {
			return getRuleContext(DatatypeContext.class,0);
		}
		public FunctypeContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_functype; }
	}

	public final FunctypeContext functype() throws RecognitionException {
		FunctypeContext _localctx = new FunctypeContext(_ctx, getState());
		enterRule(_localctx, 42, RULE_functype);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(330);
			match(T__0);
			setState(331);
			params();
			setState(332);
			match(T__1);
			setState(333);
			match(T__3);
			setState(334);
			datatype();
			}
		}
		catch (RecognitionException re) {
			_localctx.exception = re;
			_errHandler.reportError(this, re);
			_errHandler.recover(this, re);
		}
		finally {
			exitRule();
		}
		return _localctx;
	}

	@SuppressWarnings("CheckReturnValue")
	public static class ConstantContext extends ParserRuleContext {
		public ConstantContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_constant; }
	 
		public ConstantContext() { }
		public void copyFrom(ConstantContext ctx) {
			super.copyFrom(ctx);
		}
	}
	@SuppressWarnings("CheckReturnValue")
	public static class BooleanConstantContext extends ConstantContext {
		public BooleanConstantContext(ConstantContext ctx) { copyFrom(ctx); }
	}
	@SuppressWarnings("CheckReturnValue")
	public static class StringConstantContext extends ConstantContext {
		public TerminalNode STRING_LITERAL() { return getToken(HazeParser.STRING_LITERAL, 0); }
		public StringConstantContext(ConstantContext ctx) { copyFrom(ctx); }
	}
	@SuppressWarnings("CheckReturnValue")
	public static class LiteralConstantContext extends ConstantContext {
		public TerminalNode UNIT_LITERAL() { return getToken(HazeParser.UNIT_LITERAL, 0); }
		public TerminalNode NUMBER_LITERAL() { return getToken(HazeParser.NUMBER_LITERAL, 0); }
		public LiteralConstantContext(ConstantContext ctx) { copyFrom(ctx); }
	}

	public final ConstantContext constant() throws RecognitionException {
		ConstantContext _localctx = new ConstantContext(_ctx, getState());
		enterRule(_localctx, 44, RULE_constant);
		int _la;
		try {
			setState(340);
			_errHandler.sync(this);
			switch (_input.LA(1)) {
			case T__50:
			case T__51:
				_localctx = new BooleanConstantContext(_localctx);
				enterOuterAlt(_localctx, 1);
				{
				setState(336);
				_la = _input.LA(1);
				if ( !(_la==T__50 || _la==T__51) ) {
				_errHandler.recoverInline(this);
				}
				else {
					if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
					_errHandler.reportMatch(this);
					consume();
				}
				}
				break;
			case UNIT_LITERAL:
				_localctx = new LiteralConstantContext(_localctx);
				enterOuterAlt(_localctx, 2);
				{
				setState(337);
				match(UNIT_LITERAL);
				}
				break;
			case NUMBER_LITERAL:
				_localctx = new LiteralConstantContext(_localctx);
				enterOuterAlt(_localctx, 3);
				{
				setState(338);
				match(NUMBER_LITERAL);
				}
				break;
			case STRING_LITERAL:
				_localctx = new StringConstantContext(_localctx);
				enterOuterAlt(_localctx, 4);
				{
				setState(339);
				match(STRING_LITERAL);
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
		}
		catch (RecognitionException re) {
			_localctx.exception = re;
			_errHandler.reportError(this, re);
			_errHandler.recover(this, re);
		}
		finally {
			exitRule();
		}
		return _localctx;
	}

	@SuppressWarnings("CheckReturnValue")
	public static class CompilationhintContext extends ParserRuleContext {
		public CompilationlangContext compilationlang() {
			return getRuleContext(CompilationlangContext.class,0);
		}
		public CompilationhintfilenameContext compilationhintfilename() {
			return getRuleContext(CompilationhintfilenameContext.class,0);
		}
		public CompilationhintflagsContext compilationhintflags() {
			return getRuleContext(CompilationhintflagsContext.class,0);
		}
		public CompilationhintContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_compilationhint; }
	}

	public final CompilationhintContext compilationhint() throws RecognitionException {
		CompilationhintContext _localctx = new CompilationhintContext(_ctx, getState());
		enterRule(_localctx, 46, RULE_compilationhint);
		int _la;
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(342);
			match(T__52);
			setState(343);
			compilationlang();
			setState(344);
			compilationhintfilename();
			setState(346);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (_la==STRING_LITERAL) {
				{
				setState(345);
				compilationhintflags();
				}
			}

			}
		}
		catch (RecognitionException re) {
			_localctx.exception = re;
			_errHandler.reportError(this, re);
			_errHandler.recover(this, re);
		}
		finally {
			exitRule();
		}
		return _localctx;
	}

	@SuppressWarnings("CheckReturnValue")
	public static class CompilationhintfilenameContext extends ParserRuleContext {
		public TerminalNode STRING_LITERAL() { return getToken(HazeParser.STRING_LITERAL, 0); }
		public CompilationhintfilenameContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_compilationhintfilename; }
	}

	public final CompilationhintfilenameContext compilationhintfilename() throws RecognitionException {
		CompilationhintfilenameContext _localctx = new CompilationhintfilenameContext(_ctx, getState());
		enterRule(_localctx, 48, RULE_compilationhintfilename);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(348);
			match(STRING_LITERAL);
			}
		}
		catch (RecognitionException re) {
			_localctx.exception = re;
			_errHandler.reportError(this, re);
			_errHandler.recover(this, re);
		}
		finally {
			exitRule();
		}
		return _localctx;
	}

	@SuppressWarnings("CheckReturnValue")
	public static class CompilationhintflagsContext extends ParserRuleContext {
		public TerminalNode STRING_LITERAL() { return getToken(HazeParser.STRING_LITERAL, 0); }
		public CompilationhintflagsContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_compilationhintflags; }
	}

	public final CompilationhintflagsContext compilationhintflags() throws RecognitionException {
		CompilationhintflagsContext _localctx = new CompilationhintflagsContext(_ctx, getState());
		enterRule(_localctx, 50, RULE_compilationhintflags);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(350);
			match(STRING_LITERAL);
			}
		}
		catch (RecognitionException re) {
			_localctx.exception = re;
			_errHandler.reportError(this, re);
			_errHandler.recover(this, re);
		}
		finally {
			exitRule();
		}
		return _localctx;
	}

	@SuppressWarnings("CheckReturnValue")
	public static class CompilationlangContext extends ParserRuleContext {
		public CompilationlangContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_compilationlang; }
	}

	public final CompilationlangContext compilationlang() throws RecognitionException {
		CompilationlangContext _localctx = new CompilationlangContext(_ctx, getState());
		enterRule(_localctx, 52, RULE_compilationlang);
		int _la;
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(352);
			_la = _input.LA(1);
			if ( !(_la==T__10 || _la==T__11) ) {
			_errHandler.recoverInline(this);
			}
			else {
				if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
				_errHandler.reportMatch(this);
				consume();
			}
			}
		}
		catch (RecognitionException re) {
			_localctx.exception = re;
			_errHandler.reportError(this, re);
			_errHandler.recover(this, re);
		}
		finally {
			exitRule();
		}
		return _localctx;
	}

	@SuppressWarnings("CheckReturnValue")
	public static class LinkerhintContext extends ParserRuleContext {
		public TerminalNode STRING_LITERAL() { return getToken(HazeParser.STRING_LITERAL, 0); }
		public LinkerhintContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_linkerhint; }
	}

	public final LinkerhintContext linkerhint() throws RecognitionException {
		LinkerhintContext _localctx = new LinkerhintContext(_ctx, getState());
		enterRule(_localctx, 54, RULE_linkerhint);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(354);
			match(T__53);
			setState(355);
			match(STRING_LITERAL);
			}
		}
		catch (RecognitionException re) {
			_localctx.exception = re;
			_errHandler.reportError(this, re);
			_errHandler.recover(this, re);
		}
		finally {
			exitRule();
		}
		return _localctx;
	}

	@SuppressWarnings("CheckReturnValue")
	public static class StructcontentContext extends ParserRuleContext {
		public StructcontentContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_structcontent; }
	 
		public StructcontentContext() { }
		public void copyFrom(StructcontentContext ctx) {
			super.copyFrom(ctx);
		}
	}
	@SuppressWarnings("CheckReturnValue")
	public static class StructMethodContext extends StructcontentContext {
		public TerminalNode ID() { return getToken(HazeParser.ID, 0); }
		public ParamsContext params() {
			return getRuleContext(ParamsContext.class,0);
		}
		public FuncbodyContext funcbody() {
			return getRuleContext(FuncbodyContext.class,0);
		}
		public DatatypeContext datatype() {
			return getRuleContext(DatatypeContext.class,0);
		}
		public StructMethodContext(StructcontentContext ctx) { copyFrom(ctx); }
	}
	@SuppressWarnings("CheckReturnValue")
	public static class StructMemberContext extends StructcontentContext {
		public TerminalNode ID() { return getToken(HazeParser.ID, 0); }
		public DatatypeContext datatype() {
			return getRuleContext(DatatypeContext.class,0);
		}
		public StructMemberContext(StructcontentContext ctx) { copyFrom(ctx); }
	}

	public final StructcontentContext structcontent() throws RecognitionException {
		StructcontentContext _localctx = new StructcontentContext(_ctx, getState());
		enterRule(_localctx, 56, RULE_structcontent);
		int _la;
		try {
			setState(372);
			_errHandler.sync(this);
			switch ( getInterpreter().adaptivePredict(_input,33,_ctx) ) {
			case 1:
				_localctx = new StructMemberContext(_localctx);
				enterOuterAlt(_localctx, 1);
				{
				setState(357);
				match(ID);
				setState(358);
				match(T__2);
				setState(359);
				datatype();
				setState(360);
				match(T__8);
				}
				break;
			case 2:
				_localctx = new StructMethodContext(_localctx);
				enterOuterAlt(_localctx, 2);
				{
				setState(362);
				match(ID);
				setState(363);
				match(T__0);
				setState(364);
				params();
				setState(365);
				match(T__1);
				setState(368);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (_la==T__2) {
					{
					setState(366);
					match(T__2);
					setState(367);
					datatype();
					}
				}

				setState(370);
				funcbody();
				}
				break;
			}
		}
		catch (RecognitionException re) {
			_localctx.exception = re;
			_errHandler.reportError(this, re);
			_errHandler.recover(this, re);
		}
		finally {
			exitRule();
		}
		return _localctx;
	}

	@SuppressWarnings("CheckReturnValue")
	public static class StructdeclContext extends ParserRuleContext {
		public StructdeclContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_structdecl; }
	 
		public StructdeclContext() { }
		public void copyFrom(StructdeclContext ctx) {
			super.copyFrom(ctx);
		}
	}
	@SuppressWarnings("CheckReturnValue")
	public static class StructDeclContext extends StructdeclContext {
		public List<TerminalNode> ID() { return getTokens(HazeParser.ID); }
		public TerminalNode ID(int i) {
			return getToken(HazeParser.ID, i);
		}
		public ExternlangContext externlang() {
			return getRuleContext(ExternlangContext.class,0);
		}
		public List<StructcontentContext> structcontent() {
			return getRuleContexts(StructcontentContext.class);
		}
		public StructcontentContext structcontent(int i) {
			return getRuleContext(StructcontentContext.class,i);
		}
		public StructDeclContext(StructdeclContext ctx) { copyFrom(ctx); }
	}

	public final StructdeclContext structdecl() throws RecognitionException {
		StructdeclContext _localctx = new StructdeclContext(_ctx, getState());
		enterRule(_localctx, 58, RULE_structdecl);
		int _la;
		try {
			_localctx = new StructDeclContext(_localctx);
			enterOuterAlt(_localctx, 1);
			{
			setState(376);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (_la==T__7) {
				{
				setState(374);
				match(T__7);
				setState(375);
				externlang();
				}
			}

			setState(378);
			match(T__54);
			setState(379);
			match(ID);
			setState(390);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (_la==T__30) {
				{
				setState(380);
				match(T__30);
				setState(381);
				match(ID);
				setState(386);
				_errHandler.sync(this);
				_la = _input.LA(1);
				while (_la==T__6) {
					{
					{
					setState(382);
					match(T__6);
					setState(383);
					match(ID);
					}
					}
					setState(388);
					_errHandler.sync(this);
					_la = _input.LA(1);
				}
				setState(389);
				match(T__31);
				}
			}

			setState(392);
			match(T__4);
			setState(396);
			_errHandler.sync(this);
			_la = _input.LA(1);
			while (_la==ID) {
				{
				{
				setState(393);
				structcontent();
				}
				}
				setState(398);
				_errHandler.sync(this);
				_la = _input.LA(1);
			}
			setState(399);
			match(T__5);
			setState(401);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (_la==T__8) {
				{
				setState(400);
				match(T__8);
				}
			}

			}
		}
		catch (RecognitionException re) {
			_localctx.exception = re;
			_errHandler.reportError(this, re);
			_errHandler.recover(this, re);
		}
		finally {
			exitRule();
		}
		return _localctx;
	}

	@SuppressWarnings("CheckReturnValue")
	public static class DatatypeContext extends ParserRuleContext {
		public DatatypeContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_datatype; }
	 
		public DatatypeContext() { }
		public void copyFrom(DatatypeContext ctx) {
			super.copyFrom(ctx);
		}
	}
	@SuppressWarnings("CheckReturnValue")
	public static class CommonDatatypeContext extends DatatypeContext {
		public TerminalNode ID() { return getToken(HazeParser.ID, 0); }
		public List<DatatypeContext> datatype() {
			return getRuleContexts(DatatypeContext.class);
		}
		public DatatypeContext datatype(int i) {
			return getRuleContext(DatatypeContext.class,i);
		}
		public CommonDatatypeContext(DatatypeContext ctx) { copyFrom(ctx); }
	}
	@SuppressWarnings("CheckReturnValue")
	public static class FunctionDatatypeContext extends DatatypeContext {
		public FunctypeContext functype() {
			return getRuleContext(FunctypeContext.class,0);
		}
		public FunctionDatatypeContext(DatatypeContext ctx) { copyFrom(ctx); }
	}

	public final DatatypeContext datatype() throws RecognitionException {
		DatatypeContext _localctx = new DatatypeContext(_ctx, getState());
		enterRule(_localctx, 60, RULE_datatype);
		int _la;
		try {
			setState(418);
			_errHandler.sync(this);
			switch (_input.LA(1)) {
			case ID:
				_localctx = new CommonDatatypeContext(_localctx);
				enterOuterAlt(_localctx, 1);
				{
				setState(403);
				match(ID);
				setState(415);
				_errHandler.sync(this);
				switch ( getInterpreter().adaptivePredict(_input,40,_ctx) ) {
				case 1:
					{
					setState(404);
					match(T__30);
					setState(405);
					datatype();
					setState(410);
					_errHandler.sync(this);
					_la = _input.LA(1);
					while (_la==T__6) {
						{
						{
						setState(406);
						match(T__6);
						setState(407);
						datatype();
						}
						}
						setState(412);
						_errHandler.sync(this);
						_la = _input.LA(1);
					}
					setState(413);
					match(T__31);
					}
					break;
				}
				}
				break;
			case T__0:
				_localctx = new FunctionDatatypeContext(_localctx);
				enterOuterAlt(_localctx, 2);
				{
				setState(417);
				functype();
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
		}
		catch (RecognitionException re) {
			_localctx.exception = re;
			_errHandler.reportError(this, re);
			_errHandler.recover(this, re);
		}
		finally {
			exitRule();
		}
		return _localctx;
	}

	public boolean sempred(RuleContext _localctx, int ruleIndex, int predIndex) {
		switch (ruleIndex) {
		case 18:
			return expr_sempred((ExprContext)_localctx, predIndex);
		}
		return true;
	}
	private boolean expr_sempred(ExprContext _localctx, int predIndex) {
		switch (predIndex) {
		case 0:
			return precpred(_ctx, 7);
		case 1:
			return precpred(_ctx, 6);
		case 2:
			return precpred(_ctx, 5);
		case 3:
			return precpred(_ctx, 4);
		case 4:
			return precpred(_ctx, 3);
		case 5:
			return precpred(_ctx, 2);
		case 6:
			return precpred(_ctx, 15);
		case 7:
			return precpred(_ctx, 14);
		case 8:
			return precpred(_ctx, 13);
		case 9:
			return precpred(_ctx, 8);
		}
		return true;
	}

	public static final String _serializedATN =
		"\u0004\u0001=\u01a5\u0002\u0000\u0007\u0000\u0002\u0001\u0007\u0001\u0002"+
		"\u0002\u0007\u0002\u0002\u0003\u0007\u0003\u0002\u0004\u0007\u0004\u0002"+
		"\u0005\u0007\u0005\u0002\u0006\u0007\u0006\u0002\u0007\u0007\u0007\u0002"+
		"\b\u0007\b\u0002\t\u0007\t\u0002\n\u0007\n\u0002\u000b\u0007\u000b\u0002"+
		"\f\u0007\f\u0002\r\u0007\r\u0002\u000e\u0007\u000e\u0002\u000f\u0007\u000f"+
		"\u0002\u0010\u0007\u0010\u0002\u0011\u0007\u0011\u0002\u0012\u0007\u0012"+
		"\u0002\u0013\u0007\u0013\u0002\u0014\u0007\u0014\u0002\u0015\u0007\u0015"+
		"\u0002\u0016\u0007\u0016\u0002\u0017\u0007\u0017\u0002\u0018\u0007\u0018"+
		"\u0002\u0019\u0007\u0019\u0002\u001a\u0007\u001a\u0002\u001b\u0007\u001b"+
		"\u0002\u001c\u0007\u001c\u0002\u001d\u0007\u001d\u0002\u001e\u0007\u001e"+
		"\u0001\u0000\u0001\u0000\u0001\u0000\u0001\u0000\u0001\u0000\u0001\u0000"+
		"\u0005\u0000E\b\u0000\n\u0000\f\u0000H\t\u0000\u0001\u0001\u0001\u0001"+
		"\u0001\u0001\u0001\u0001\u0001\u0001\u0001\u0001\u0003\u0001P\b\u0001"+
		"\u0001\u0001\u0001\u0001\u0001\u0002\u0001\u0002\u0001\u0002\u0001\u0002"+
		"\u0001\u0002\u0003\u0002Y\b\u0002\u0001\u0002\u0001\u0002\u0001\u0003"+
		"\u0003\u0003^\b\u0003\u0001\u0003\u0001\u0003\u0001\u0003\u0001\u0003"+
		"\u0001\u0003\u0001\u0003\u0003\u0003f\b\u0003\u0001\u0004\u0005\u0004"+
		"i\b\u0004\n\u0004\f\u0004l\t\u0004\u0001\u0005\u0001\u0005\u0001\u0005"+
		"\u0001\u0005\u0001\u0006\u0001\u0006\u0001\u0006\u0005\u0006u\b\u0006"+
		"\n\u0006\f\u0006x\t\u0006\u0001\u0006\u0001\u0006\u0003\u0006|\b\u0006"+
		"\u0003\u0006~\b\u0006\u0001\u0006\u0003\u0006\u0081\b\u0006\u0001\u0007"+
		"\u0001\u0007\u0001\u0007\u0001\u0007\u0001\u0007\u0001\b\u0001\b\u0003"+
		"\b\u008a\b\b\u0001\b\u0001\b\u0005\b\u008e\b\b\n\b\f\b\u0091\t\b\u0001"+
		"\b\u0001\b\u0001\b\u0001\b\u0001\b\u0001\b\u0003\b\u0099\b\b\u0001\b\u0001"+
		"\b\u0001\t\u0001\t\u0001\n\u0001\n\u0001\u000b\u0001\u000b\u0001\f\u0001"+
		"\f\u0001\r\u0001\r\u0001\u000e\u0001\u000e\u0001\u000f\u0001\u000f\u0001"+
		"\u0010\u0001\u0010\u0001\u0010\u0001\u0010\u0001\u0010\u0001\u0010\u0001"+
		"\u0010\u0001\u0010\u0001\u0010\u0001\u0010\u0003\u0010\u00b5\b\u0010\u0001"+
		"\u0010\u0001\u0010\u0001\u0010\u0001\u0010\u0001\u0010\u0003\u0010\u00bc"+
		"\b\u0010\u0001\u0010\u0001\u0010\u0001\u0010\u0001\u0010\u0001\u0010\u0001"+
		"\u0010\u0001\u0010\u0001\u0010\u0001\u0010\u0001\u0010\u0001\u0010\u0001"+
		"\u0010\u0001\u0010\u0001\u0010\u0001\u0010\u0001\u0010\u0005\u0010\u00ce"+
		"\b\u0010\n\u0010\f\u0010\u00d1\t\u0010\u0001\u0010\u0001\u0010\u0001\u0010"+
		"\u0001\u0010\u0001\u0010\u0003\u0010\u00d8\b\u0010\u0001\u0010\u0001\u0010"+
		"\u0001\u0010\u0001\u0010\u0001\u0010\u0001\u0010\u0003\u0010\u00e0\b\u0010"+
		"\u0001\u0011\u0001\u0011\u0001\u0011\u0001\u0011\u0001\u0011\u0001\u0012"+
		"\u0001\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001\u0012"+
		"\u0001\u0012\u0001\u0012\u0001\u0012\u0003\u0012\u00f1\b\u0012\u0001\u0012"+
		"\u0001\u0012\u0005\u0012\u00f5\b\u0012\n\u0012\f\u0012\u00f8\t\u0012\u0001"+
		"\u0012\u0003\u0012\u00fb\b\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001"+
		"\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001"+
		"\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0005\u0012\u010a\b\u0012\n"+
		"\u0012\f\u0012\u010d\t\u0012\u0001\u0012\u0001\u0012\u0003\u0012\u0111"+
		"\b\u0012\u0003\u0012\u0113\b\u0012\u0001\u0012\u0001\u0012\u0001\u0012"+
		"\u0001\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001\u0012"+
		"\u0001\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001\u0012"+
		"\u0003\u0012\u0124\b\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001\u0012"+
		"\u0001\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001\u0012"+
		"\u0001\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001\u0012"+
		"\u0001\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0005\u0012\u013a\b\u0012"+
		"\n\u0012\f\u0012\u013d\t\u0012\u0001\u0013\u0001\u0013\u0001\u0013\u0005"+
		"\u0013\u0142\b\u0013\n\u0013\f\u0013\u0145\t\u0013\u0003\u0013\u0147\b"+
		"\u0013\u0001\u0014\u0001\u0014\u0001\u0015\u0001\u0015\u0001\u0015\u0001"+
		"\u0015\u0001\u0015\u0001\u0015\u0001\u0016\u0001\u0016\u0001\u0016\u0001"+
		"\u0016\u0003\u0016\u0155\b\u0016\u0001\u0017\u0001\u0017\u0001\u0017\u0001"+
		"\u0017\u0003\u0017\u015b\b\u0017\u0001\u0018\u0001\u0018\u0001\u0019\u0001"+
		"\u0019\u0001\u001a\u0001\u001a\u0001\u001b\u0001\u001b\u0001\u001b\u0001"+
		"\u001c\u0001\u001c\u0001\u001c\u0001\u001c\u0001\u001c\u0001\u001c\u0001"+
		"\u001c\u0001\u001c\u0001\u001c\u0001\u001c\u0001\u001c\u0003\u001c\u0171"+
		"\b\u001c\u0001\u001c\u0001\u001c\u0003\u001c\u0175\b\u001c\u0001\u001d"+
		"\u0001\u001d\u0003\u001d\u0179\b\u001d\u0001\u001d\u0001\u001d\u0001\u001d"+
		"\u0001\u001d\u0001\u001d\u0001\u001d\u0005\u001d\u0181\b\u001d\n\u001d"+
		"\f\u001d\u0184\t\u001d\u0001\u001d\u0003\u001d\u0187\b\u001d\u0001\u001d"+
		"\u0001\u001d\u0005\u001d\u018b\b\u001d\n\u001d\f\u001d\u018e\t\u001d\u0001"+
		"\u001d\u0001\u001d\u0003\u001d\u0192\b\u001d\u0001\u001e\u0001\u001e\u0001"+
		"\u001e\u0001\u001e\u0001\u001e\u0005\u001e\u0199\b\u001e\n\u001e\f\u001e"+
		"\u019c\t\u001e\u0001\u001e\u0001\u001e\u0003\u001e\u01a0\b\u001e\u0001"+
		"\u001e\u0003\u001e\u01a3\b\u001e\u0001\u001e\u0000\u0001$\u001f\u0000"+
		"\u0002\u0004\u0006\b\n\f\u000e\u0010\u0012\u0014\u0016\u0018\u001a\u001c"+
		"\u001e \"$&(*,.02468:<\u0000\n\u0001\u0000\u000b\f\u0001\u0000\r\u000e"+
		"\u0001\u0000\u0015\u0016\u0001\u0000\u0017\u0018\u0001\u0000\u0019\u001a"+
		"\u0001\u0000\u001c\u001e\u0001\u0000\u001f\"\u0001\u0000&\'\u0002\u0000"+
		"\u0011\u0011(1\u0001\u000034\u01c9\u0000F\u0001\u0000\u0000\u0000\u0002"+
		"I\u0001\u0000\u0000\u0000\u0004S\u0001\u0000\u0000\u0000\u0006e\u0001"+
		"\u0000\u0000\u0000\bj\u0001\u0000\u0000\u0000\nm\u0001\u0000\u0000\u0000"+
		"\f\u0080\u0001\u0000\u0000\u0000\u000e\u0082\u0001\u0000\u0000\u0000\u0010"+
		"\u0087\u0001\u0000\u0000\u0000\u0012\u009c\u0001\u0000\u0000\u0000\u0014"+
		"\u009e\u0001\u0000\u0000\u0000\u0016\u00a0\u0001\u0000\u0000\u0000\u0018"+
		"\u00a2\u0001\u0000\u0000\u0000\u001a\u00a4\u0001\u0000\u0000\u0000\u001c"+
		"\u00a6\u0001\u0000\u0000\u0000\u001e\u00a8\u0001\u0000\u0000\u0000 \u00df"+
		"\u0001\u0000\u0000\u0000\"\u00e1\u0001\u0000\u0000\u0000$\u0112\u0001"+
		"\u0000\u0000\u0000&\u0146\u0001\u0000\u0000\u0000(\u0148\u0001\u0000\u0000"+
		"\u0000*\u014a\u0001\u0000\u0000\u0000,\u0154\u0001\u0000\u0000\u0000."+
		"\u0156\u0001\u0000\u0000\u00000\u015c\u0001\u0000\u0000\u00002\u015e\u0001"+
		"\u0000\u0000\u00004\u0160\u0001\u0000\u0000\u00006\u0162\u0001\u0000\u0000"+
		"\u00008\u0174\u0001\u0000\u0000\u0000:\u0178\u0001\u0000\u0000\u0000<"+
		"\u01a2\u0001\u0000\u0000\u0000>E\u0003\u000e\u0007\u0000?E\u0003\u0002"+
		"\u0001\u0000@E\u0003\u0010\b\u0000AE\u0003.\u0017\u0000BE\u00036\u001b"+
		"\u0000CE\u0003:\u001d\u0000D>\u0001\u0000\u0000\u0000D?\u0001\u0000\u0000"+
		"\u0000D@\u0001\u0000\u0000\u0000DA\u0001\u0000\u0000\u0000DB\u0001\u0000"+
		"\u0000\u0000DC\u0001\u0000\u0000\u0000EH\u0001\u0000\u0000\u0000FD\u0001"+
		"\u0000\u0000\u0000FG\u0001\u0000\u0000\u0000G\u0001\u0001\u0000\u0000"+
		"\u0000HF\u0001\u0000\u0000\u0000IJ\u0005;\u0000\u0000JK\u0005\u0001\u0000"+
		"\u0000KL\u0003\f\u0006\u0000LO\u0005\u0002\u0000\u0000MN\u0005\u0003\u0000"+
		"\u0000NP\u0003<\u001e\u0000OM\u0001\u0000\u0000\u0000OP\u0001\u0000\u0000"+
		"\u0000PQ\u0001\u0000\u0000\u0000QR\u0003\u0006\u0003\u0000R\u0003\u0001"+
		"\u0000\u0000\u0000ST\u0005\u0001\u0000\u0000TU\u0003\f\u0006\u0000UX\u0005"+
		"\u0002\u0000\u0000VW\u0005\u0003\u0000\u0000WY\u0003<\u001e\u0000XV\u0001"+
		"\u0000\u0000\u0000XY\u0001\u0000\u0000\u0000YZ\u0001\u0000\u0000\u0000"+
		"Z[\u0003\u0006\u0003\u0000[\u0005\u0001\u0000\u0000\u0000\\^\u0005\u0004"+
		"\u0000\u0000]\\\u0001\u0000\u0000\u0000]^\u0001\u0000\u0000\u0000^_\u0001"+
		"\u0000\u0000\u0000_`\u0005\u0005\u0000\u0000`a\u0003\b\u0004\u0000ab\u0005"+
		"\u0006\u0000\u0000bf\u0001\u0000\u0000\u0000cd\u0005\u0004\u0000\u0000"+
		"df\u0003$\u0012\u0000e]\u0001\u0000\u0000\u0000ec\u0001\u0000\u0000\u0000"+
		"f\u0007\u0001\u0000\u0000\u0000gi\u0003 \u0010\u0000hg\u0001\u0000\u0000"+
		"\u0000il\u0001\u0000\u0000\u0000jh\u0001\u0000\u0000\u0000jk\u0001\u0000"+
		"\u0000\u0000k\t\u0001\u0000\u0000\u0000lj\u0001\u0000\u0000\u0000mn\u0005"+
		";\u0000\u0000no\u0005\u0003\u0000\u0000op\u0003<\u001e\u0000p\u000b\u0001"+
		"\u0000\u0000\u0000qv\u0003\n\u0005\u0000rs\u0005\u0007\u0000\u0000su\u0003"+
		"\n\u0005\u0000tr\u0001\u0000\u0000\u0000ux\u0001\u0000\u0000\u0000vt\u0001"+
		"\u0000\u0000\u0000vw\u0001\u0000\u0000\u0000w{\u0001\u0000\u0000\u0000"+
		"xv\u0001\u0000\u0000\u0000yz\u0005\u0007\u0000\u0000z|\u0003(\u0014\u0000"+
		"{y\u0001\u0000\u0000\u0000{|\u0001\u0000\u0000\u0000|~\u0001\u0000\u0000"+
		"\u0000}q\u0001\u0000\u0000\u0000}~\u0001\u0000\u0000\u0000~\u0081\u0001"+
		"\u0000\u0000\u0000\u007f\u0081\u0003(\u0014\u0000\u0080}\u0001\u0000\u0000"+
		"\u0000\u0080\u007f\u0001\u0000\u0000\u0000\u0081\r\u0001\u0000\u0000\u0000"+
		"\u0082\u0083\u0005\b\u0000\u0000\u0083\u0084\u0003\u0012\t\u0000\u0084"+
		"\u0085\u00058\u0000\u0000\u0085\u0086\u0005\t\u0000\u0000\u0086\u000f"+
		"\u0001\u0000\u0000\u0000\u0087\u0089\u0005\b\u0000\u0000\u0088\u008a\u0003"+
		"\u0012\t\u0000\u0089\u0088\u0001\u0000\u0000\u0000\u0089\u008a\u0001\u0000"+
		"\u0000\u0000\u008a\u008f\u0001\u0000\u0000\u0000\u008b\u008c\u0005;\u0000"+
		"\u0000\u008c\u008e\u0005\n\u0000\u0000\u008d\u008b\u0001\u0000\u0000\u0000"+
		"\u008e\u0091\u0001\u0000\u0000\u0000\u008f\u008d\u0001\u0000\u0000\u0000"+
		"\u008f\u0090\u0001\u0000\u0000\u0000\u0090\u0092\u0001\u0000\u0000\u0000"+
		"\u0091\u008f\u0001\u0000\u0000\u0000\u0092\u0093\u0005;\u0000\u0000\u0093"+
		"\u0094\u0005\u0001\u0000\u0000\u0094\u0095\u0003\f\u0006\u0000\u0095\u0098"+
		"\u0005\u0002\u0000\u0000\u0096\u0097\u0005\u0003\u0000\u0000\u0097\u0099"+
		"\u0003<\u001e\u0000\u0098\u0096\u0001\u0000\u0000\u0000\u0098\u0099\u0001"+
		"\u0000\u0000\u0000\u0099\u009a\u0001\u0000\u0000\u0000\u009a\u009b\u0005"+
		"\t\u0000\u0000\u009b\u0011\u0001\u0000\u0000\u0000\u009c\u009d\u0007\u0000"+
		"\u0000\u0000\u009d\u0013\u0001\u0000\u0000\u0000\u009e\u009f\u0003$\u0012"+
		"\u0000\u009f\u0015\u0001\u0000\u0000\u0000\u00a0\u00a1\u0003$\u0012\u0000"+
		"\u00a1\u0017\u0001\u0000\u0000\u0000\u00a2\u00a3\u0003\b\u0004\u0000\u00a3"+
		"\u0019\u0001\u0000\u0000\u0000\u00a4\u00a5\u0003\b\u0004\u0000\u00a5\u001b"+
		"\u0001\u0000\u0000\u0000\u00a6\u00a7\u0003\b\u0004\u0000\u00a7\u001d\u0001"+
		"\u0000\u0000\u0000\u00a8\u00a9\u0007\u0001\u0000\u0000\u00a9\u001f\u0001"+
		"\u0000\u0000\u0000\u00aa\u00ab\u0005\u000f\u0000\u0000\u00ab\u00ac\u0005"+
		"\u0001\u0000\u0000\u00ac\u00ad\u00058\u0000\u0000\u00ad\u00ae\u0005\u0002"+
		"\u0000\u0000\u00ae\u00e0\u0005\t\u0000\u0000\u00af\u00b0\u0003$\u0012"+
		"\u0000\u00b0\u00b1\u0005\t\u0000\u0000\u00b1\u00e0\u0001\u0000\u0000\u0000"+
		"\u00b2\u00b4\u0005\u0010\u0000\u0000\u00b3\u00b5\u0003$\u0012\u0000\u00b4"+
		"\u00b3\u0001\u0000\u0000\u0000\u00b4\u00b5\u0001\u0000\u0000\u0000\u00b5"+
		"\u00b6\u0001\u0000\u0000\u0000\u00b6\u00e0\u0005\t\u0000\u0000\u00b7\u00b8"+
		"\u0003\u001e\u000f\u0000\u00b8\u00bb\u0005;\u0000\u0000\u00b9\u00ba\u0005"+
		"\u0003\u0000\u0000\u00ba\u00bc\u0003<\u001e\u0000\u00bb\u00b9\u0001\u0000"+
		"\u0000\u0000\u00bb\u00bc\u0001\u0000\u0000\u0000\u00bc\u00bd\u0001\u0000"+
		"\u0000\u0000\u00bd\u00be\u0005\u0011\u0000\u0000\u00be\u00bf\u0003$\u0012"+
		"\u0000\u00bf\u00c0\u0005\t\u0000\u0000\u00c0\u00e0\u0001\u0000\u0000\u0000"+
		"\u00c1\u00c2\u0005\u0012\u0000\u0000\u00c2\u00c3\u0003\u0014\n\u0000\u00c3"+
		"\u00c4\u0005\u0005\u0000\u0000\u00c4\u00c5\u0003\u0018\f\u0000\u00c5\u00cf"+
		"\u0005\u0006\u0000\u0000\u00c6\u00c7\u0005\u0013\u0000\u0000\u00c7\u00c8"+
		"\u0005\u0012\u0000\u0000\u00c8\u00c9\u0003\u0016\u000b\u0000\u00c9\u00ca"+
		"\u0005\u0005\u0000\u0000\u00ca\u00cb\u0003\u001a\r\u0000\u00cb\u00cc\u0005"+
		"\u0006\u0000\u0000\u00cc\u00ce\u0001\u0000\u0000\u0000\u00cd\u00c6\u0001"+
		"\u0000\u0000\u0000\u00ce\u00d1\u0001\u0000\u0000\u0000\u00cf\u00cd\u0001"+
		"\u0000\u0000\u0000\u00cf\u00d0\u0001\u0000\u0000\u0000\u00d0\u00d7\u0001"+
		"\u0000\u0000\u0000\u00d1\u00cf\u0001\u0000\u0000\u0000\u00d2\u00d3\u0005"+
		"\u0013\u0000\u0000\u00d3\u00d4\u0005\u0005\u0000\u0000\u00d4\u00d5\u0003"+
		"\u001c\u000e\u0000\u00d5\u00d6\u0005\u0006\u0000\u0000\u00d6\u00d8\u0001"+
		"\u0000\u0000\u0000\u00d7\u00d2\u0001\u0000\u0000\u0000\u00d7\u00d8\u0001"+
		"\u0000\u0000\u0000\u00d8\u00e0\u0001\u0000\u0000\u0000\u00d9\u00da\u0005"+
		"\u0014\u0000\u0000\u00da\u00db\u0003$\u0012\u0000\u00db\u00dc\u0005\u0005"+
		"\u0000\u0000\u00dc\u00dd\u0003\b\u0004\u0000\u00dd\u00de\u0005\u0006\u0000"+
		"\u0000\u00de\u00e0\u0001\u0000\u0000\u0000\u00df\u00aa\u0001\u0000\u0000"+
		"\u0000\u00df\u00af\u0001\u0000\u0000\u0000\u00df\u00b2\u0001\u0000\u0000"+
		"\u0000\u00df\u00b7\u0001\u0000\u0000\u0000\u00df\u00c1\u0001\u0000\u0000"+
		"\u0000\u00df\u00d9\u0001\u0000\u0000\u0000\u00e0!\u0001\u0000\u0000\u0000"+
		"\u00e1\u00e2\u0005\n\u0000\u0000\u00e2\u00e3\u0005;\u0000\u0000\u00e3"+
		"\u00e4\u0005\u0003\u0000\u0000\u00e4\u00e5\u0003$\u0012\u0000\u00e5#\u0001"+
		"\u0000\u0000\u0000\u00e6\u00e7\u0006\u0012\uffff\uffff\u0000\u00e7\u00e8"+
		"\u0005\u0001\u0000\u0000\u00e8\u00e9\u0003$\u0012\u0000\u00e9\u00ea\u0005"+
		"\u0002\u0000\u0000\u00ea\u0113\u0001\u0000\u0000\u0000\u00eb\u0113\u0003"+
		"\u0004\u0002\u0000\u00ec\u0113\u0003,\u0016\u0000\u00ed\u00ee\u0003<\u001e"+
		"\u0000\u00ee\u00f0\u0005\u0005\u0000\u0000\u00ef\u00f1\u0003\"\u0011\u0000"+
		"\u00f0\u00ef\u0001\u0000\u0000\u0000\u00f0\u00f1\u0001\u0000\u0000\u0000"+
		"\u00f1\u00f6\u0001\u0000\u0000\u0000\u00f2\u00f3\u0005\u0007\u0000\u0000"+
		"\u00f3\u00f5\u0003\"\u0011\u0000\u00f4\u00f2\u0001\u0000\u0000\u0000\u00f5"+
		"\u00f8\u0001\u0000\u0000\u0000\u00f6\u00f4\u0001\u0000\u0000\u0000\u00f6"+
		"\u00f7\u0001\u0000\u0000\u0000\u00f7\u00fa\u0001\u0000\u0000\u0000\u00f8"+
		"\u00f6\u0001\u0000\u0000\u0000\u00f9\u00fb\u0005\u0007\u0000\u0000\u00fa"+
		"\u00f9\u0001\u0000\u0000\u0000\u00fa\u00fb\u0001\u0000\u0000\u0000\u00fb"+
		"\u00fc\u0001\u0000\u0000\u0000\u00fc\u00fd\u0005\u0006\u0000\u0000\u00fd"+
		"\u0113\u0001\u0000\u0000\u0000\u00fe\u00ff\u0007\u0002\u0000\u0000\u00ff"+
		"\u0113\u0003$\u0012\u000b\u0100\u0101\u0007\u0003\u0000\u0000\u0101\u0113"+
		"\u0003$\u0012\n\u0102\u0103\u0007\u0004\u0000\u0000\u0103\u0113\u0003"+
		"$\u0012\t\u0104\u0110\u0005;\u0000\u0000\u0105\u0106\u0005\u001f\u0000"+
		"\u0000\u0106\u010b\u0003<\u001e\u0000\u0107\u0108\u0005\u0007\u0000\u0000"+
		"\u0108\u010a\u0003<\u001e\u0000\u0109\u0107\u0001\u0000\u0000\u0000\u010a"+
		"\u010d\u0001\u0000\u0000\u0000\u010b\u0109\u0001\u0000\u0000\u0000\u010b"+
		"\u010c\u0001\u0000\u0000\u0000\u010c\u010e\u0001\u0000\u0000\u0000\u010d"+
		"\u010b\u0001\u0000\u0000\u0000\u010e\u010f\u0005 \u0000\u0000\u010f\u0111"+
		"\u0001\u0000\u0000\u0000\u0110\u0105\u0001\u0000\u0000\u0000\u0110\u0111"+
		"\u0001\u0000\u0000\u0000\u0111\u0113\u0001\u0000\u0000\u0000\u0112\u00e6"+
		"\u0001\u0000\u0000\u0000\u0112\u00eb\u0001\u0000\u0000\u0000\u0112\u00ec"+
		"\u0001\u0000\u0000\u0000\u0112\u00ed\u0001\u0000\u0000\u0000\u0112\u00fe"+
		"\u0001\u0000\u0000\u0000\u0112\u0100\u0001\u0000\u0000\u0000\u0112\u0102"+
		"\u0001\u0000\u0000\u0000\u0112\u0104\u0001\u0000\u0000\u0000\u0113\u013b"+
		"\u0001\u0000\u0000\u0000\u0114\u0115\n\u0007\u0000\u0000\u0115\u0116\u0007"+
		"\u0005\u0000\u0000\u0116\u013a\u0003$\u0012\b\u0117\u0118\n\u0006\u0000"+
		"\u0000\u0118\u0119\u0007\u0003\u0000\u0000\u0119\u013a\u0003$\u0012\u0007"+
		"\u011a\u011b\n\u0005\u0000\u0000\u011b\u011c\u0007\u0006\u0000\u0000\u011c"+
		"\u013a\u0003$\u0012\u0006\u011d\u0123\n\u0004\u0000\u0000\u011e\u0124"+
		"\u0005#\u0000\u0000\u011f\u0124\u0005$\u0000\u0000\u0120\u0124\u0005%"+
		"\u0000\u0000\u0121\u0122\u0005%\u0000\u0000\u0122\u0124\u0005\u0019\u0000"+
		"\u0000\u0123\u011e\u0001\u0000\u0000\u0000\u0123\u011f\u0001\u0000\u0000"+
		"\u0000\u0123\u0120\u0001\u0000\u0000\u0000\u0123\u0121\u0001\u0000\u0000"+
		"\u0000\u0124\u0125\u0001\u0000\u0000\u0000\u0125\u013a\u0003$\u0012\u0005"+
		"\u0126\u0127\n\u0003\u0000\u0000\u0127\u0128\u0007\u0007\u0000\u0000\u0128"+
		"\u013a\u0003$\u0012\u0004\u0129\u012a\n\u0002\u0000\u0000\u012a\u012b"+
		"\u0007\b\u0000\u0000\u012b\u013a\u0003$\u0012\u0003\u012c\u012d\n\u000f"+
		"\u0000\u0000\u012d\u013a\u0007\u0002\u0000\u0000\u012e\u012f\n\u000e\u0000"+
		"\u0000\u012f\u0130\u0005\u0001\u0000\u0000\u0130\u0131\u0003&\u0013\u0000"+
		"\u0131\u0132\u0005\u0002\u0000\u0000\u0132\u013a\u0001\u0000\u0000\u0000"+
		"\u0133\u0134\n\r\u0000\u0000\u0134\u0135\u0005\n\u0000\u0000\u0135\u013a"+
		"\u0005;\u0000\u0000\u0136\u0137\n\b\u0000\u0000\u0137\u0138\u0005\u001b"+
		"\u0000\u0000\u0138\u013a\u0003<\u001e\u0000\u0139\u0114\u0001\u0000\u0000"+
		"\u0000\u0139\u0117\u0001\u0000\u0000\u0000\u0139\u011a\u0001\u0000\u0000"+
		"\u0000\u0139\u011d\u0001\u0000\u0000\u0000\u0139\u0126\u0001\u0000\u0000"+
		"\u0000\u0139\u0129\u0001\u0000\u0000\u0000\u0139\u012c\u0001\u0000\u0000"+
		"\u0000\u0139\u012e\u0001\u0000\u0000\u0000\u0139\u0133\u0001\u0000\u0000"+
		"\u0000\u0139\u0136\u0001\u0000\u0000\u0000\u013a\u013d\u0001\u0000\u0000"+
		"\u0000\u013b\u0139\u0001\u0000\u0000\u0000\u013b\u013c\u0001\u0000\u0000"+
		"\u0000\u013c%\u0001\u0000\u0000\u0000\u013d\u013b\u0001\u0000\u0000\u0000"+
		"\u013e\u0143\u0003$\u0012\u0000\u013f\u0140\u0005\u0007\u0000\u0000\u0140"+
		"\u0142\u0003$\u0012\u0000\u0141\u013f\u0001\u0000\u0000\u0000\u0142\u0145"+
		"\u0001\u0000\u0000\u0000\u0143\u0141\u0001\u0000\u0000\u0000\u0143\u0144"+
		"\u0001\u0000\u0000\u0000\u0144\u0147\u0001\u0000\u0000\u0000\u0145\u0143"+
		"\u0001\u0000\u0000\u0000\u0146\u013e\u0001\u0000\u0000\u0000\u0146\u0147"+
		"\u0001\u0000\u0000\u0000\u0147\'\u0001\u0000\u0000\u0000\u0148\u0149\u0005"+
		"2\u0000\u0000\u0149)\u0001\u0000\u0000\u0000\u014a\u014b\u0005\u0001\u0000"+
		"\u0000\u014b\u014c\u0003\f\u0006\u0000\u014c\u014d\u0005\u0002\u0000\u0000"+
		"\u014d\u014e\u0005\u0004\u0000\u0000\u014e\u014f\u0003<\u001e\u0000\u014f"+
		"+\u0001\u0000\u0000\u0000\u0150\u0155\u0007\t\u0000\u0000\u0151\u0155"+
		"\u00059\u0000\u0000\u0152\u0155\u0005:\u0000\u0000\u0153\u0155\u00058"+
		"\u0000\u0000\u0154\u0150\u0001\u0000\u0000\u0000\u0154\u0151\u0001\u0000"+
		"\u0000\u0000\u0154\u0152\u0001\u0000\u0000\u0000\u0154\u0153\u0001\u0000"+
		"\u0000\u0000\u0155-\u0001\u0000\u0000\u0000\u0156\u0157\u00055\u0000\u0000"+
		"\u0157\u0158\u00034\u001a\u0000\u0158\u015a\u00030\u0018\u0000\u0159\u015b"+
		"\u00032\u0019\u0000\u015a\u0159\u0001\u0000\u0000\u0000\u015a\u015b\u0001"+
		"\u0000\u0000\u0000\u015b/\u0001\u0000\u0000\u0000\u015c\u015d\u00058\u0000"+
		"\u0000\u015d1\u0001\u0000\u0000\u0000\u015e\u015f\u00058\u0000\u0000\u015f"+
		"3\u0001\u0000\u0000\u0000\u0160\u0161\u0007\u0000\u0000\u0000\u01615\u0001"+
		"\u0000\u0000\u0000\u0162\u0163\u00056\u0000\u0000\u0163\u0164\u00058\u0000"+
		"\u0000\u01647\u0001\u0000\u0000\u0000\u0165\u0166\u0005;\u0000\u0000\u0166"+
		"\u0167\u0005\u0003\u0000\u0000\u0167\u0168\u0003<\u001e\u0000\u0168\u0169"+
		"\u0005\t\u0000\u0000\u0169\u0175\u0001\u0000\u0000\u0000\u016a\u016b\u0005"+
		";\u0000\u0000\u016b\u016c\u0005\u0001\u0000\u0000\u016c\u016d\u0003\f"+
		"\u0006\u0000\u016d\u0170\u0005\u0002\u0000\u0000\u016e\u016f\u0005\u0003"+
		"\u0000\u0000\u016f\u0171\u0003<\u001e\u0000\u0170\u016e\u0001\u0000\u0000"+
		"\u0000\u0170\u0171\u0001\u0000\u0000\u0000\u0171\u0172\u0001\u0000\u0000"+
		"\u0000\u0172\u0173\u0003\u0006\u0003\u0000\u0173\u0175\u0001\u0000\u0000"+
		"\u0000\u0174\u0165\u0001\u0000\u0000\u0000\u0174\u016a\u0001\u0000\u0000"+
		"\u0000\u01759\u0001\u0000\u0000\u0000\u0176\u0177\u0005\b\u0000\u0000"+
		"\u0177\u0179\u0003\u0012\t\u0000\u0178\u0176\u0001\u0000\u0000\u0000\u0178"+
		"\u0179\u0001\u0000\u0000\u0000\u0179\u017a\u0001\u0000\u0000\u0000\u017a"+
		"\u017b\u00057\u0000\u0000\u017b\u0186\u0005;\u0000\u0000\u017c\u017d\u0005"+
		"\u001f\u0000\u0000\u017d\u0182\u0005;\u0000\u0000\u017e\u017f\u0005\u0007"+
		"\u0000\u0000\u017f\u0181\u0005;\u0000\u0000\u0180\u017e\u0001\u0000\u0000"+
		"\u0000\u0181\u0184\u0001\u0000\u0000\u0000\u0182\u0180\u0001\u0000\u0000"+
		"\u0000\u0182\u0183\u0001\u0000\u0000\u0000\u0183\u0185\u0001\u0000\u0000"+
		"\u0000\u0184\u0182\u0001\u0000\u0000\u0000\u0185\u0187\u0005 \u0000\u0000"+
		"\u0186\u017c\u0001\u0000\u0000\u0000\u0186\u0187\u0001\u0000\u0000\u0000"+
		"\u0187\u0188\u0001\u0000\u0000\u0000\u0188\u018c\u0005\u0005\u0000\u0000"+
		"\u0189\u018b\u00038\u001c\u0000\u018a\u0189\u0001\u0000\u0000\u0000\u018b"+
		"\u018e\u0001\u0000\u0000\u0000\u018c\u018a\u0001\u0000\u0000\u0000\u018c"+
		"\u018d\u0001\u0000\u0000\u0000\u018d\u018f\u0001\u0000\u0000\u0000\u018e"+
		"\u018c\u0001\u0000\u0000\u0000\u018f\u0191\u0005\u0006\u0000\u0000\u0190"+
		"\u0192\u0005\t\u0000\u0000\u0191\u0190\u0001\u0000\u0000\u0000\u0191\u0192"+
		"\u0001\u0000\u0000\u0000\u0192;\u0001\u0000\u0000\u0000\u0193\u019f\u0005"+
		";\u0000\u0000\u0194\u0195\u0005\u001f\u0000\u0000\u0195\u019a\u0003<\u001e"+
		"\u0000\u0196\u0197\u0005\u0007\u0000\u0000\u0197\u0199\u0003<\u001e\u0000"+
		"\u0198\u0196\u0001\u0000\u0000\u0000\u0199\u019c\u0001\u0000\u0000\u0000"+
		"\u019a\u0198\u0001\u0000\u0000\u0000\u019a\u019b\u0001\u0000\u0000\u0000"+
		"\u019b\u019d\u0001\u0000\u0000\u0000\u019c\u019a\u0001\u0000\u0000\u0000"+
		"\u019d\u019e\u0005 \u0000\u0000\u019e\u01a0\u0001\u0000\u0000\u0000\u019f"+
		"\u0194\u0001\u0000\u0000\u0000\u019f\u01a0\u0001\u0000\u0000\u0000\u01a0"+
		"\u01a3\u0001\u0000\u0000\u0000\u01a1\u01a3\u0003*\u0015\u0000\u01a2\u0193"+
		"\u0001\u0000\u0000\u0000\u01a2\u01a1\u0001\u0000\u0000\u0000\u01a3=\u0001"+
		"\u0000\u0000\u0000*DFOX]ejv{}\u0080\u0089\u008f\u0098\u00b4\u00bb\u00cf"+
		"\u00d7\u00df\u00f0\u00f6\u00fa\u010b\u0110\u0112\u0123\u0139\u013b\u0143"+
		"\u0146\u0154\u015a\u0170\u0174\u0178\u0182\u0186\u018c\u0191\u019a\u019f"+
		"\u01a2";
	public static final ATN _ATN =
		new ATNDeserializer().deserialize(_serializedATN.toCharArray());
	static {
		_decisionToDFA = new DFA[_ATN.getNumberOfDecisions()];
		for (int i = 0; i < _ATN.getNumberOfDecisions(); i++) {
			_decisionToDFA[i] = new DFA(_ATN.getDecisionState(i), i);
		}
	}
}