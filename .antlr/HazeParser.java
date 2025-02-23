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
		T__38=39, STRING_LITERAL=40, ID=41, INT=42, WS=43, COMMENT=44;
	public static final int
		RULE_prog = 0, RULE_namedfunc = 1, RULE_func = 2, RULE_funcbody = 3, RULE_body = 4, 
		RULE_param = 5, RULE_params = 6, RULE_externfuncdef = 7, RULE_externblock = 8, 
		RULE_externlang = 9, RULE_ifexpr = 10, RULE_elseifexpr = 11, RULE_thenblock = 12, 
		RULE_elseifblock = 13, RULE_elseblock = 14, RULE_variablemutability = 15, 
		RULE_statement = 16, RULE_structmembervalue = 17, RULE_expr = 18, RULE_args = 19, 
		RULE_functype = 20, RULE_constant = 21, RULE_compilationhint = 22, RULE_compilationhintfilename = 23, 
		RULE_compilationhintflags = 24, RULE_compilationlang = 25, RULE_linkerhint = 26, 
		RULE_structcontent = 27, RULE_structdecl = 28, RULE_datatype = 29;
	private static String[] makeRuleNames() {
		return new String[] {
			"prog", "namedfunc", "func", "funcbody", "body", "param", "params", "externfuncdef", 
			"externblock", "externlang", "ifexpr", "elseifexpr", "thenblock", "elseifblock", 
			"elseblock", "variablemutability", "statement", "structmembervalue", 
			"expr", "args", "functype", "constant", "compilationhint", "compilationhintfilename", 
			"compilationhintflags", "compilationlang", "linkerhint", "structcontent", 
			"structdecl", "datatype"
		};
	}
	public static final String[] ruleNames = makeRuleNames();

	private static String[] makeLiteralNames() {
		return new String[] {
			null, "'('", "')'", "':'", "'=>'", "'{'", "'}'", "','", "'.'", "';'", 
			"'extern'", "'\"C\"'", "'\"C++\"'", "'let'", "'const'", "'__c__'", "'return'", 
			"'='", "'if'", "'else'", "'*'", "'/'", "'%'", "'+'", "'-'", "'<'", "'>'", 
			"'<='", "'>='", "'=='", "'!='", "'is'", "'not'", "'and'", "'or'", "'true'", 
			"'false'", "'#compile'", "'#link'", "'struct'"
		};
	}
	private static final String[] _LITERAL_NAMES = makeLiteralNames();
	private static String[] makeSymbolicNames() {
		return new String[] {
			null, null, null, null, null, null, null, null, null, null, null, null, 
			null, null, null, null, null, null, null, null, null, null, null, null, 
			null, null, null, null, null, null, null, null, null, null, null, null, 
			null, null, null, null, "STRING_LITERAL", "ID", "INT", "WS", "COMMENT"
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
		public List<NamedfuncContext> namedfunc() {
			return getRuleContexts(NamedfuncContext.class);
		}
		public NamedfuncContext namedfunc(int i) {
			return getRuleContext(NamedfuncContext.class,i);
		}
		public List<ExternblockContext> externblock() {
			return getRuleContexts(ExternblockContext.class);
		}
		public ExternblockContext externblock(int i) {
			return getRuleContext(ExternblockContext.class,i);
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
			setState(67);
			_errHandler.sync(this);
			_la = _input.LA(1);
			while ((((_la) & ~0x3f) == 0 && ((1L << _la) & 3161095930880L) != 0)) {
				{
				setState(65);
				_errHandler.sync(this);
				switch (_input.LA(1)) {
				case ID:
					{
					setState(60);
					namedfunc();
					}
					break;
				case T__9:
					{
					setState(61);
					externblock();
					}
					break;
				case T__36:
					{
					setState(62);
					compilationhint();
					}
					break;
				case T__37:
					{
					setState(63);
					linkerhint();
					}
					break;
				case T__38:
					{
					setState(64);
					structdecl();
					}
					break;
				default:
					throw new NoViableAltException(this);
				}
				}
				setState(69);
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
			setState(70);
			match(ID);
			setState(71);
			match(T__0);
			setState(72);
			params();
			setState(73);
			match(T__1);
			setState(76);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (_la==T__2) {
				{
				setState(74);
				match(T__2);
				setState(75);
				datatype();
				}
			}

			setState(78);
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
			setState(80);
			match(T__0);
			setState(81);
			params();
			setState(82);
			match(T__1);
			setState(85);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (_la==T__2) {
				{
				setState(83);
				match(T__2);
				setState(84);
				datatype();
				}
			}

			setState(87);
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
			setState(98);
			_errHandler.sync(this);
			switch ( getInterpreter().adaptivePredict(_input,5,_ctx) ) {
			case 1:
				enterOuterAlt(_localctx, 1);
				{
				setState(90);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (_la==T__3) {
					{
					setState(89);
					match(T__3);
					}
				}

				setState(92);
				match(T__4);
				setState(93);
				body();
				setState(94);
				match(T__5);
				}
				break;
			case 2:
				enterOuterAlt(_localctx, 2);
				{
				setState(96);
				match(T__3);
				setState(97);
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
			setState(103);
			_errHandler.sync(this);
			_la = _input.LA(1);
			while ((((_la) & ~0x3f) == 0 && ((1L << _la) & 7799660994562L) != 0)) {
				{
				{
				setState(100);
				statement();
				}
				}
				setState(105);
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
			setState(106);
			match(ID);
			setState(107);
			match(T__2);
			setState(108);
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
			enterOuterAlt(_localctx, 1);
			{
			setState(118);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (_la==ID) {
				{
				setState(110);
				param();
				setState(115);
				_errHandler.sync(this);
				_la = _input.LA(1);
				while (_la==T__6) {
					{
					{
					setState(111);
					match(T__6);
					setState(112);
					param();
					}
					}
					setState(117);
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
	public static class ExternfuncdefContext extends ParserRuleContext {
		public List<TerminalNode> ID() { return getTokens(HazeParser.ID); }
		public TerminalNode ID(int i) {
			return getToken(HazeParser.ID, i);
		}
		public ParamsContext params() {
			return getRuleContext(ParamsContext.class,0);
		}
		public DatatypeContext datatype() {
			return getRuleContext(DatatypeContext.class,0);
		}
		public ExternfuncdefContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_externfuncdef; }
	}

	public final ExternfuncdefContext externfuncdef() throws RecognitionException {
		ExternfuncdefContext _localctx = new ExternfuncdefContext(_ctx, getState());
		enterRule(_localctx, 14, RULE_externfuncdef);
		int _la;
		try {
			int _alt;
			enterOuterAlt(_localctx, 1);
			{
			setState(124);
			_errHandler.sync(this);
			_alt = getInterpreter().adaptivePredict(_input,9,_ctx);
			while ( _alt!=2 && _alt!=org.antlr.v4.runtime.atn.ATN.INVALID_ALT_NUMBER ) {
				if ( _alt==1 ) {
					{
					{
					setState(120);
					match(ID);
					setState(121);
					match(T__7);
					}
					} 
				}
				setState(126);
				_errHandler.sync(this);
				_alt = getInterpreter().adaptivePredict(_input,9,_ctx);
			}
			setState(127);
			match(ID);
			setState(128);
			match(T__0);
			setState(129);
			params();
			setState(130);
			match(T__1);
			setState(133);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (_la==T__2) {
				{
				setState(131);
				match(T__2);
				setState(132);
				datatype();
				}
			}

			setState(135);
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
	public static class ExternblockContext extends ParserRuleContext {
		public ExternlangContext externlang() {
			return getRuleContext(ExternlangContext.class,0);
		}
		public List<ExternfuncdefContext> externfuncdef() {
			return getRuleContexts(ExternfuncdefContext.class);
		}
		public ExternfuncdefContext externfuncdef(int i) {
			return getRuleContext(ExternfuncdefContext.class,i);
		}
		public ExternblockContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_externblock; }
	}

	public final ExternblockContext externblock() throws RecognitionException {
		ExternblockContext _localctx = new ExternblockContext(_ctx, getState());
		enterRule(_localctx, 16, RULE_externblock);
		int _la;
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(137);
			match(T__9);
			setState(138);
			externlang();
			setState(139);
			match(T__4);
			setState(143);
			_errHandler.sync(this);
			_la = _input.LA(1);
			while (_la==ID) {
				{
				{
				setState(140);
				externfuncdef();
				}
				}
				setState(145);
				_errHandler.sync(this);
				_la = _input.LA(1);
			}
			setState(146);
			match(T__5);
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
			setState(148);
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
			setState(150);
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
			setState(152);
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
			setState(154);
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
			setState(156);
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
			setState(158);
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
			setState(160);
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
	public static class ExprAssignmentStatementContext extends StatementContext {
		public List<ExprContext> expr() {
			return getRuleContexts(ExprContext.class);
		}
		public ExprContext expr(int i) {
			return getRuleContext(ExprContext.class,i);
		}
		public ExprAssignmentStatementContext(StatementContext ctx) { copyFrom(ctx); }
	}

	public final StatementContext statement() throws RecognitionException {
		StatementContext _localctx = new StatementContext(_ctx, getState());
		enterRule(_localctx, 32, RULE_statement);
		int _la;
		try {
			int _alt;
			setState(214);
			_errHandler.sync(this);
			switch ( getInterpreter().adaptivePredict(_input,16,_ctx) ) {
			case 1:
				_localctx = new InlineCStatementContext(_localctx);
				enterOuterAlt(_localctx, 1);
				{
				setState(162);
				match(T__14);
				setState(163);
				match(T__0);
				setState(164);
				match(STRING_LITERAL);
				setState(165);
				match(T__1);
				setState(166);
				match(T__8);
				}
				break;
			case 2:
				_localctx = new ExprStatementContext(_localctx);
				enterOuterAlt(_localctx, 2);
				{
				setState(167);
				expr(0);
				setState(168);
				match(T__8);
				}
				break;
			case 3:
				_localctx = new ReturnStatementContext(_localctx);
				enterOuterAlt(_localctx, 3);
				{
				setState(170);
				match(T__15);
				setState(172);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if ((((_la) & ~0x3f) == 0 && ((1L << _la) & 7799660609538L) != 0)) {
					{
					setState(171);
					expr(0);
					}
				}

				setState(174);
				match(T__8);
				}
				break;
			case 4:
				_localctx = new ExprAssignmentStatementContext(_localctx);
				enterOuterAlt(_localctx, 4);
				{
				setState(175);
				expr(0);
				setState(176);
				match(T__16);
				setState(177);
				expr(0);
				setState(178);
				match(T__8);
				}
				break;
			case 5:
				_localctx = new VariableDefinitionContext(_localctx);
				enterOuterAlt(_localctx, 5);
				{
				setState(180);
				variablemutability();
				setState(181);
				match(ID);
				setState(184);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (_la==T__2) {
					{
					setState(182);
					match(T__2);
					setState(183);
					datatype();
					}
				}

				setState(186);
				match(T__16);
				setState(187);
				expr(0);
				setState(188);
				match(T__8);
				}
				break;
			case 6:
				_localctx = new IfStatementContext(_localctx);
				enterOuterAlt(_localctx, 6);
				{
				setState(190);
				match(T__17);
				setState(191);
				ifexpr();
				setState(192);
				match(T__4);
				setState(193);
				thenblock();
				setState(194);
				match(T__5);
				setState(204);
				_errHandler.sync(this);
				_alt = getInterpreter().adaptivePredict(_input,14,_ctx);
				while ( _alt!=2 && _alt!=org.antlr.v4.runtime.atn.ATN.INVALID_ALT_NUMBER ) {
					if ( _alt==1 ) {
						{
						{
						setState(195);
						match(T__18);
						setState(196);
						match(T__17);
						setState(197);
						elseifexpr();
						setState(198);
						match(T__4);
						setState(199);
						elseifblock();
						setState(200);
						match(T__5);
						}
						} 
					}
					setState(206);
					_errHandler.sync(this);
					_alt = getInterpreter().adaptivePredict(_input,14,_ctx);
				}
				setState(212);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (_la==T__18) {
					{
					setState(207);
					match(T__18);
					setState(208);
					match(T__4);
					setState(209);
					elseblock();
					setState(210);
					match(T__5);
					}
				}

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
			setState(216);
			match(T__7);
			setState(217);
			match(ID);
			setState(218);
			match(T__2);
			setState(219);
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
			setState(259);
			_errHandler.sync(this);
			switch ( getInterpreter().adaptivePredict(_input,22,_ctx) ) {
			case 1:
				{
				_localctx = new ParenthesisExprContext(_localctx);
				_ctx = _localctx;
				_prevctx = _localctx;

				setState(222);
				match(T__0);
				setState(223);
				expr(0);
				setState(224);
				match(T__1);
				}
				break;
			case 2:
				{
				_localctx = new StructInstantiationExprContext(_localctx);
				_ctx = _localctx;
				_prevctx = _localctx;
				setState(226);
				datatype();
				setState(227);
				match(T__4);
				setState(229);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (_la==T__7) {
					{
					setState(228);
					structmembervalue();
					}
				}

				setState(235);
				_errHandler.sync(this);
				_alt = getInterpreter().adaptivePredict(_input,18,_ctx);
				while ( _alt!=2 && _alt!=org.antlr.v4.runtime.atn.ATN.INVALID_ALT_NUMBER ) {
					if ( _alt==1 ) {
						{
						{
						setState(231);
						match(T__6);
						setState(232);
						structmembervalue();
						}
						} 
					}
					setState(237);
					_errHandler.sync(this);
					_alt = getInterpreter().adaptivePredict(_input,18,_ctx);
				}
				setState(239);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (_la==T__6) {
					{
					setState(238);
					match(T__6);
					}
				}

				setState(241);
				match(T__5);
				}
				break;
			case 3:
				{
				_localctx = new FuncRefExprContext(_localctx);
				_ctx = _localctx;
				_prevctx = _localctx;
				setState(243);
				func();
				}
				break;
			case 4:
				{
				_localctx = new SymbolValueExprContext(_localctx);
				_ctx = _localctx;
				_prevctx = _localctx;
				setState(244);
				match(ID);
				setState(256);
				_errHandler.sync(this);
				switch ( getInterpreter().adaptivePredict(_input,21,_ctx) ) {
				case 1:
					{
					setState(245);
					match(T__24);
					setState(246);
					datatype();
					setState(251);
					_errHandler.sync(this);
					_la = _input.LA(1);
					while (_la==T__6) {
						{
						{
						setState(247);
						match(T__6);
						setState(248);
						datatype();
						}
						}
						setState(253);
						_errHandler.sync(this);
						_la = _input.LA(1);
					}
					setState(254);
					match(T__25);
					}
					break;
				}
				}
				break;
			case 5:
				{
				_localctx = new ConstantExprContext(_localctx);
				_ctx = _localctx;
				_prevctx = _localctx;
				setState(258);
				constant();
				}
				break;
			}
			_ctx.stop = _input.LT(-1);
			setState(292);
			_errHandler.sync(this);
			_alt = getInterpreter().adaptivePredict(_input,25,_ctx);
			while ( _alt!=2 && _alt!=org.antlr.v4.runtime.atn.ATN.INVALID_ALT_NUMBER ) {
				if ( _alt==1 ) {
					if ( _parseListeners!=null ) triggerExitRuleEvent();
					_prevctx = _localctx;
					{
					setState(290);
					_errHandler.sync(this);
					switch ( getInterpreter().adaptivePredict(_input,24,_ctx) ) {
					case 1:
						{
						_localctx = new BinaryExprContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(261);
						if (!(precpred(_ctx, 8))) throw new FailedPredicateException(this, "precpred(_ctx, 8)");
						setState(262);
						_la = _input.LA(1);
						if ( !((((_la) & ~0x3f) == 0 && ((1L << _la) & 7340032L) != 0)) ) {
						_errHandler.recoverInline(this);
						}
						else {
							if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
							_errHandler.reportMatch(this);
							consume();
						}
						setState(263);
						expr(9);
						}
						break;
					case 2:
						{
						_localctx = new BinaryExprContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(264);
						if (!(precpred(_ctx, 7))) throw new FailedPredicateException(this, "precpred(_ctx, 7)");
						setState(265);
						_la = _input.LA(1);
						if ( !(_la==T__22 || _la==T__23) ) {
						_errHandler.recoverInline(this);
						}
						else {
							if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
							_errHandler.reportMatch(this);
							consume();
						}
						setState(266);
						expr(8);
						}
						break;
					case 3:
						{
						_localctx = new BinaryExprContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(267);
						if (!(precpred(_ctx, 6))) throw new FailedPredicateException(this, "precpred(_ctx, 6)");
						setState(268);
						_la = _input.LA(1);
						if ( !((((_la) & ~0x3f) == 0 && ((1L << _la) & 503316480L) != 0)) ) {
						_errHandler.recoverInline(this);
						}
						else {
							if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
							_errHandler.reportMatch(this);
							consume();
						}
						setState(269);
						expr(7);
						}
						break;
					case 4:
						{
						_localctx = new BinaryExprContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(270);
						if (!(precpred(_ctx, 5))) throw new FailedPredicateException(this, "precpred(_ctx, 5)");
						setState(276);
						_errHandler.sync(this);
						switch ( getInterpreter().adaptivePredict(_input,23,_ctx) ) {
						case 1:
							{
							setState(271);
							match(T__28);
							}
							break;
						case 2:
							{
							setState(272);
							match(T__29);
							}
							break;
						case 3:
							{
							setState(273);
							match(T__30);
							}
							break;
						case 4:
							{
							{
							setState(274);
							match(T__30);
							setState(275);
							match(T__31);
							}
							}
							break;
						}
						setState(278);
						expr(6);
						}
						break;
					case 5:
						{
						_localctx = new BinaryExprContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(279);
						if (!(precpred(_ctx, 4))) throw new FailedPredicateException(this, "precpred(_ctx, 4)");
						setState(280);
						_la = _input.LA(1);
						if ( !(_la==T__32 || _la==T__33) ) {
						_errHandler.recoverInline(this);
						}
						else {
							if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
							_errHandler.reportMatch(this);
							consume();
						}
						setState(281);
						expr(5);
						}
						break;
					case 6:
						{
						_localctx = new ExprCallExprContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(282);
						if (!(precpred(_ctx, 10))) throw new FailedPredicateException(this, "precpred(_ctx, 10)");
						setState(283);
						match(T__0);
						setState(284);
						args();
						setState(285);
						match(T__1);
						}
						break;
					case 7:
						{
						_localctx = new ExprMemberAccessContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(287);
						if (!(precpred(_ctx, 9))) throw new FailedPredicateException(this, "precpred(_ctx, 9)");
						setState(288);
						match(T__7);
						setState(289);
						match(ID);
						}
						break;
					}
					} 
				}
				setState(294);
				_errHandler.sync(this);
				_alt = getInterpreter().adaptivePredict(_input,25,_ctx);
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
			setState(303);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if ((((_la) & ~0x3f) == 0 && ((1L << _la) & 7799660609538L) != 0)) {
				{
				setState(295);
				expr(0);
				setState(300);
				_errHandler.sync(this);
				_la = _input.LA(1);
				while (_la==T__6) {
					{
					{
					setState(296);
					match(T__6);
					setState(297);
					expr(0);
					}
					}
					setState(302);
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
		enterRule(_localctx, 40, RULE_functype);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(305);
			match(T__0);
			setState(306);
			params();
			setState(307);
			match(T__1);
			setState(308);
			match(T__3);
			setState(309);
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
	public static class IntegerConstantContext extends ConstantContext {
		public TerminalNode INT() { return getToken(HazeParser.INT, 0); }
		public IntegerConstantContext(ConstantContext ctx) { copyFrom(ctx); }
	}

	public final ConstantContext constant() throws RecognitionException {
		ConstantContext _localctx = new ConstantContext(_ctx, getState());
		enterRule(_localctx, 42, RULE_constant);
		int _la;
		try {
			setState(314);
			_errHandler.sync(this);
			switch (_input.LA(1)) {
			case INT:
				_localctx = new IntegerConstantContext(_localctx);
				enterOuterAlt(_localctx, 1);
				{
				setState(311);
				match(INT);
				}
				break;
			case STRING_LITERAL:
				_localctx = new StringConstantContext(_localctx);
				enterOuterAlt(_localctx, 2);
				{
				setState(312);
				match(STRING_LITERAL);
				}
				break;
			case T__34:
			case T__35:
				_localctx = new BooleanConstantContext(_localctx);
				enterOuterAlt(_localctx, 3);
				{
				setState(313);
				_la = _input.LA(1);
				if ( !(_la==T__34 || _la==T__35) ) {
				_errHandler.recoverInline(this);
				}
				else {
					if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
					_errHandler.reportMatch(this);
					consume();
				}
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
		enterRule(_localctx, 44, RULE_compilationhint);
		int _la;
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(316);
			match(T__36);
			setState(317);
			compilationlang();
			setState(318);
			compilationhintfilename();
			setState(320);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (_la==STRING_LITERAL) {
				{
				setState(319);
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
		enterRule(_localctx, 46, RULE_compilationhintfilename);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(322);
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
		enterRule(_localctx, 48, RULE_compilationhintflags);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(324);
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
		enterRule(_localctx, 50, RULE_compilationlang);
		int _la;
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(326);
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
		enterRule(_localctx, 52, RULE_linkerhint);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(328);
			match(T__37);
			setState(329);
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
		enterRule(_localctx, 54, RULE_structcontent);
		int _la;
		try {
			setState(346);
			_errHandler.sync(this);
			switch ( getInterpreter().adaptivePredict(_input,31,_ctx) ) {
			case 1:
				_localctx = new StructMemberContext(_localctx);
				enterOuterAlt(_localctx, 1);
				{
				setState(331);
				match(ID);
				setState(332);
				match(T__2);
				setState(333);
				datatype();
				setState(334);
				match(T__8);
				}
				break;
			case 2:
				_localctx = new StructMethodContext(_localctx);
				enterOuterAlt(_localctx, 2);
				{
				setState(336);
				match(ID);
				setState(337);
				match(T__0);
				setState(338);
				params();
				setState(339);
				match(T__1);
				setState(342);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (_la==T__2) {
					{
					setState(340);
					match(T__2);
					setState(341);
					datatype();
					}
				}

				setState(344);
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
		enterRule(_localctx, 56, RULE_structdecl);
		int _la;
		try {
			_localctx = new StructDeclContext(_localctx);
			enterOuterAlt(_localctx, 1);
			{
			setState(348);
			match(T__38);
			setState(349);
			match(ID);
			setState(360);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (_la==T__24) {
				{
				setState(350);
				match(T__24);
				setState(351);
				match(ID);
				setState(356);
				_errHandler.sync(this);
				_la = _input.LA(1);
				while (_la==T__6) {
					{
					{
					setState(352);
					match(T__6);
					setState(353);
					match(ID);
					}
					}
					setState(358);
					_errHandler.sync(this);
					_la = _input.LA(1);
				}
				setState(359);
				match(T__25);
				}
			}

			setState(362);
			match(T__4);
			setState(366);
			_errHandler.sync(this);
			_la = _input.LA(1);
			while (_la==ID) {
				{
				{
				setState(363);
				structcontent();
				}
				}
				setState(368);
				_errHandler.sync(this);
				_la = _input.LA(1);
			}
			setState(369);
			match(T__5);
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
		enterRule(_localctx, 58, RULE_datatype);
		int _la;
		try {
			setState(386);
			_errHandler.sync(this);
			switch (_input.LA(1)) {
			case ID:
				_localctx = new CommonDatatypeContext(_localctx);
				enterOuterAlt(_localctx, 1);
				{
				setState(371);
				match(ID);
				setState(383);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (_la==T__24) {
					{
					setState(372);
					match(T__24);
					setState(373);
					datatype();
					setState(378);
					_errHandler.sync(this);
					_la = _input.LA(1);
					while (_la==T__6) {
						{
						{
						setState(374);
						match(T__6);
						setState(375);
						datatype();
						}
						}
						setState(380);
						_errHandler.sync(this);
						_la = _input.LA(1);
					}
					setState(381);
					match(T__25);
					}
				}

				}
				break;
			case T__0:
				_localctx = new FunctionDatatypeContext(_localctx);
				enterOuterAlt(_localctx, 2);
				{
				setState(385);
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
			return precpred(_ctx, 8);
		case 1:
			return precpred(_ctx, 7);
		case 2:
			return precpred(_ctx, 6);
		case 3:
			return precpred(_ctx, 5);
		case 4:
			return precpred(_ctx, 4);
		case 5:
			return precpred(_ctx, 10);
		case 6:
			return precpred(_ctx, 9);
		}
		return true;
	}

	public static final String _serializedATN =
		"\u0004\u0001,\u0185\u0002\u0000\u0007\u0000\u0002\u0001\u0007\u0001\u0002"+
		"\u0002\u0007\u0002\u0002\u0003\u0007\u0003\u0002\u0004\u0007\u0004\u0002"+
		"\u0005\u0007\u0005\u0002\u0006\u0007\u0006\u0002\u0007\u0007\u0007\u0002"+
		"\b\u0007\b\u0002\t\u0007\t\u0002\n\u0007\n\u0002\u000b\u0007\u000b\u0002"+
		"\f\u0007\f\u0002\r\u0007\r\u0002\u000e\u0007\u000e\u0002\u000f\u0007\u000f"+
		"\u0002\u0010\u0007\u0010\u0002\u0011\u0007\u0011\u0002\u0012\u0007\u0012"+
		"\u0002\u0013\u0007\u0013\u0002\u0014\u0007\u0014\u0002\u0015\u0007\u0015"+
		"\u0002\u0016\u0007\u0016\u0002\u0017\u0007\u0017\u0002\u0018\u0007\u0018"+
		"\u0002\u0019\u0007\u0019\u0002\u001a\u0007\u001a\u0002\u001b\u0007\u001b"+
		"\u0002\u001c\u0007\u001c\u0002\u001d\u0007\u001d\u0001\u0000\u0001\u0000"+
		"\u0001\u0000\u0001\u0000\u0001\u0000\u0005\u0000B\b\u0000\n\u0000\f\u0000"+
		"E\t\u0000\u0001\u0001\u0001\u0001\u0001\u0001\u0001\u0001\u0001\u0001"+
		"\u0001\u0001\u0003\u0001M\b\u0001\u0001\u0001\u0001\u0001\u0001\u0002"+
		"\u0001\u0002\u0001\u0002\u0001\u0002\u0001\u0002\u0003\u0002V\b\u0002"+
		"\u0001\u0002\u0001\u0002\u0001\u0003\u0003\u0003[\b\u0003\u0001\u0003"+
		"\u0001\u0003\u0001\u0003\u0001\u0003\u0001\u0003\u0001\u0003\u0003\u0003"+
		"c\b\u0003\u0001\u0004\u0005\u0004f\b\u0004\n\u0004\f\u0004i\t\u0004\u0001"+
		"\u0005\u0001\u0005\u0001\u0005\u0001\u0005\u0001\u0006\u0001\u0006\u0001"+
		"\u0006\u0005\u0006r\b\u0006\n\u0006\f\u0006u\t\u0006\u0003\u0006w\b\u0006"+
		"\u0001\u0007\u0001\u0007\u0005\u0007{\b\u0007\n\u0007\f\u0007~\t\u0007"+
		"\u0001\u0007\u0001\u0007\u0001\u0007\u0001\u0007\u0001\u0007\u0001\u0007"+
		"\u0003\u0007\u0086\b\u0007\u0001\u0007\u0001\u0007\u0001\b\u0001\b\u0001"+
		"\b\u0001\b\u0005\b\u008e\b\b\n\b\f\b\u0091\t\b\u0001\b\u0001\b\u0001\t"+
		"\u0001\t\u0001\n\u0001\n\u0001\u000b\u0001\u000b\u0001\f\u0001\f\u0001"+
		"\r\u0001\r\u0001\u000e\u0001\u000e\u0001\u000f\u0001\u000f\u0001\u0010"+
		"\u0001\u0010\u0001\u0010\u0001\u0010\u0001\u0010\u0001\u0010\u0001\u0010"+
		"\u0001\u0010\u0001\u0010\u0001\u0010\u0003\u0010\u00ad\b\u0010\u0001\u0010"+
		"\u0001\u0010\u0001\u0010\u0001\u0010\u0001\u0010\u0001\u0010\u0001\u0010"+
		"\u0001\u0010\u0001\u0010\u0001\u0010\u0003\u0010\u00b9\b\u0010\u0001\u0010"+
		"\u0001\u0010\u0001\u0010\u0001\u0010\u0001\u0010\u0001\u0010\u0001\u0010"+
		"\u0001\u0010\u0001\u0010\u0001\u0010\u0001\u0010\u0001\u0010\u0001\u0010"+
		"\u0001\u0010\u0001\u0010\u0001\u0010\u0005\u0010\u00cb\b\u0010\n\u0010"+
		"\f\u0010\u00ce\t\u0010\u0001\u0010\u0001\u0010\u0001\u0010\u0001\u0010"+
		"\u0001\u0010\u0003\u0010\u00d5\b\u0010\u0003\u0010\u00d7\b\u0010\u0001"+
		"\u0011\u0001\u0011\u0001\u0011\u0001\u0011\u0001\u0011\u0001\u0012\u0001"+
		"\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001"+
		"\u0012\u0003\u0012\u00e6\b\u0012\u0001\u0012\u0001\u0012\u0005\u0012\u00ea"+
		"\b\u0012\n\u0012\f\u0012\u00ed\t\u0012\u0001\u0012\u0003\u0012\u00f0\b"+
		"\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001"+
		"\u0012\u0001\u0012\u0001\u0012\u0005\u0012\u00fa\b\u0012\n\u0012\f\u0012"+
		"\u00fd\t\u0012\u0001\u0012\u0001\u0012\u0003\u0012\u0101\b\u0012\u0001"+
		"\u0012\u0003\u0012\u0104\b\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001"+
		"\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001"+
		"\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0003"+
		"\u0012\u0115\b\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001"+
		"\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001"+
		"\u0012\u0001\u0012\u0005\u0012\u0123\b\u0012\n\u0012\f\u0012\u0126\t\u0012"+
		"\u0001\u0013\u0001\u0013\u0001\u0013\u0005\u0013\u012b\b\u0013\n\u0013"+
		"\f\u0013\u012e\t\u0013\u0003\u0013\u0130\b\u0013\u0001\u0014\u0001\u0014"+
		"\u0001\u0014\u0001\u0014\u0001\u0014\u0001\u0014\u0001\u0015\u0001\u0015"+
		"\u0001\u0015\u0003\u0015\u013b\b\u0015\u0001\u0016\u0001\u0016\u0001\u0016"+
		"\u0001\u0016\u0003\u0016\u0141\b\u0016\u0001\u0017\u0001\u0017\u0001\u0018"+
		"\u0001\u0018\u0001\u0019\u0001\u0019\u0001\u001a\u0001\u001a\u0001\u001a"+
		"\u0001\u001b\u0001\u001b\u0001\u001b\u0001\u001b\u0001\u001b\u0001\u001b"+
		"\u0001\u001b\u0001\u001b\u0001\u001b\u0001\u001b\u0001\u001b\u0003\u001b"+
		"\u0157\b\u001b\u0001\u001b\u0001\u001b\u0003\u001b\u015b\b\u001b\u0001"+
		"\u001c\u0001\u001c\u0001\u001c\u0001\u001c\u0001\u001c\u0001\u001c\u0005"+
		"\u001c\u0163\b\u001c\n\u001c\f\u001c\u0166\t\u001c\u0001\u001c\u0003\u001c"+
		"\u0169\b\u001c\u0001\u001c\u0001\u001c\u0005\u001c\u016d\b\u001c\n\u001c"+
		"\f\u001c\u0170\t\u001c\u0001\u001c\u0001\u001c\u0001\u001d\u0001\u001d"+
		"\u0001\u001d\u0001\u001d\u0001\u001d\u0005\u001d\u0179\b\u001d\n\u001d"+
		"\f\u001d\u017c\t\u001d\u0001\u001d\u0001\u001d\u0003\u001d\u0180\b\u001d"+
		"\u0001\u001d\u0003\u001d\u0183\b\u001d\u0001\u001d\u0000\u0001$\u001e"+
		"\u0000\u0002\u0004\u0006\b\n\f\u000e\u0010\u0012\u0014\u0016\u0018\u001a"+
		"\u001c\u001e \"$&(*,.02468:\u0000\u0007\u0001\u0000\u000b\f\u0001\u0000"+
		"\r\u000e\u0001\u0000\u0014\u0016\u0001\u0000\u0017\u0018\u0001\u0000\u0019"+
		"\u001c\u0001\u0000!\"\u0001\u0000#$\u019e\u0000C\u0001\u0000\u0000\u0000"+
		"\u0002F\u0001\u0000\u0000\u0000\u0004P\u0001\u0000\u0000\u0000\u0006b"+
		"\u0001\u0000\u0000\u0000\bg\u0001\u0000\u0000\u0000\nj\u0001\u0000\u0000"+
		"\u0000\fv\u0001\u0000\u0000\u0000\u000e|\u0001\u0000\u0000\u0000\u0010"+
		"\u0089\u0001\u0000\u0000\u0000\u0012\u0094\u0001\u0000\u0000\u0000\u0014"+
		"\u0096\u0001\u0000\u0000\u0000\u0016\u0098\u0001\u0000\u0000\u0000\u0018"+
		"\u009a\u0001\u0000\u0000\u0000\u001a\u009c\u0001\u0000\u0000\u0000\u001c"+
		"\u009e\u0001\u0000\u0000\u0000\u001e\u00a0\u0001\u0000\u0000\u0000 \u00d6"+
		"\u0001\u0000\u0000\u0000\"\u00d8\u0001\u0000\u0000\u0000$\u0103\u0001"+
		"\u0000\u0000\u0000&\u012f\u0001\u0000\u0000\u0000(\u0131\u0001\u0000\u0000"+
		"\u0000*\u013a\u0001\u0000\u0000\u0000,\u013c\u0001\u0000\u0000\u0000."+
		"\u0142\u0001\u0000\u0000\u00000\u0144\u0001\u0000\u0000\u00002\u0146\u0001"+
		"\u0000\u0000\u00004\u0148\u0001\u0000\u0000\u00006\u015a\u0001\u0000\u0000"+
		"\u00008\u015c\u0001\u0000\u0000\u0000:\u0182\u0001\u0000\u0000\u0000<"+
		"B\u0003\u0002\u0001\u0000=B\u0003\u0010\b\u0000>B\u0003,\u0016\u0000?"+
		"B\u00034\u001a\u0000@B\u00038\u001c\u0000A<\u0001\u0000\u0000\u0000A="+
		"\u0001\u0000\u0000\u0000A>\u0001\u0000\u0000\u0000A?\u0001\u0000\u0000"+
		"\u0000A@\u0001\u0000\u0000\u0000BE\u0001\u0000\u0000\u0000CA\u0001\u0000"+
		"\u0000\u0000CD\u0001\u0000\u0000\u0000D\u0001\u0001\u0000\u0000\u0000"+
		"EC\u0001\u0000\u0000\u0000FG\u0005)\u0000\u0000GH\u0005\u0001\u0000\u0000"+
		"HI\u0003\f\u0006\u0000IL\u0005\u0002\u0000\u0000JK\u0005\u0003\u0000\u0000"+
		"KM\u0003:\u001d\u0000LJ\u0001\u0000\u0000\u0000LM\u0001\u0000\u0000\u0000"+
		"MN\u0001\u0000\u0000\u0000NO\u0003\u0006\u0003\u0000O\u0003\u0001\u0000"+
		"\u0000\u0000PQ\u0005\u0001\u0000\u0000QR\u0003\f\u0006\u0000RU\u0005\u0002"+
		"\u0000\u0000ST\u0005\u0003\u0000\u0000TV\u0003:\u001d\u0000US\u0001\u0000"+
		"\u0000\u0000UV\u0001\u0000\u0000\u0000VW\u0001\u0000\u0000\u0000WX\u0003"+
		"\u0006\u0003\u0000X\u0005\u0001\u0000\u0000\u0000Y[\u0005\u0004\u0000"+
		"\u0000ZY\u0001\u0000\u0000\u0000Z[\u0001\u0000\u0000\u0000[\\\u0001\u0000"+
		"\u0000\u0000\\]\u0005\u0005\u0000\u0000]^\u0003\b\u0004\u0000^_\u0005"+
		"\u0006\u0000\u0000_c\u0001\u0000\u0000\u0000`a\u0005\u0004\u0000\u0000"+
		"ac\u0003$\u0012\u0000bZ\u0001\u0000\u0000\u0000b`\u0001\u0000\u0000\u0000"+
		"c\u0007\u0001\u0000\u0000\u0000df\u0003 \u0010\u0000ed\u0001\u0000\u0000"+
		"\u0000fi\u0001\u0000\u0000\u0000ge\u0001\u0000\u0000\u0000gh\u0001\u0000"+
		"\u0000\u0000h\t\u0001\u0000\u0000\u0000ig\u0001\u0000\u0000\u0000jk\u0005"+
		")\u0000\u0000kl\u0005\u0003\u0000\u0000lm\u0003:\u001d\u0000m\u000b\u0001"+
		"\u0000\u0000\u0000ns\u0003\n\u0005\u0000op\u0005\u0007\u0000\u0000pr\u0003"+
		"\n\u0005\u0000qo\u0001\u0000\u0000\u0000ru\u0001\u0000\u0000\u0000sq\u0001"+
		"\u0000\u0000\u0000st\u0001\u0000\u0000\u0000tw\u0001\u0000\u0000\u0000"+
		"us\u0001\u0000\u0000\u0000vn\u0001\u0000\u0000\u0000vw\u0001\u0000\u0000"+
		"\u0000w\r\u0001\u0000\u0000\u0000xy\u0005)\u0000\u0000y{\u0005\b\u0000"+
		"\u0000zx\u0001\u0000\u0000\u0000{~\u0001\u0000\u0000\u0000|z\u0001\u0000"+
		"\u0000\u0000|}\u0001\u0000\u0000\u0000}\u007f\u0001\u0000\u0000\u0000"+
		"~|\u0001\u0000\u0000\u0000\u007f\u0080\u0005)\u0000\u0000\u0080\u0081"+
		"\u0005\u0001\u0000\u0000\u0081\u0082\u0003\f\u0006\u0000\u0082\u0085\u0005"+
		"\u0002\u0000\u0000\u0083\u0084\u0005\u0003\u0000\u0000\u0084\u0086\u0003"+
		":\u001d\u0000\u0085\u0083\u0001\u0000\u0000\u0000\u0085\u0086\u0001\u0000"+
		"\u0000\u0000\u0086\u0087\u0001\u0000\u0000\u0000\u0087\u0088\u0005\t\u0000"+
		"\u0000\u0088\u000f\u0001\u0000\u0000\u0000\u0089\u008a\u0005\n\u0000\u0000"+
		"\u008a\u008b\u0003\u0012\t\u0000\u008b\u008f\u0005\u0005\u0000\u0000\u008c"+
		"\u008e\u0003\u000e\u0007\u0000\u008d\u008c\u0001\u0000\u0000\u0000\u008e"+
		"\u0091\u0001\u0000\u0000\u0000\u008f\u008d\u0001\u0000\u0000\u0000\u008f"+
		"\u0090\u0001\u0000\u0000\u0000\u0090\u0092\u0001\u0000\u0000\u0000\u0091"+
		"\u008f\u0001\u0000\u0000\u0000\u0092\u0093\u0005\u0006\u0000\u0000\u0093"+
		"\u0011\u0001\u0000\u0000\u0000\u0094\u0095\u0007\u0000\u0000\u0000\u0095"+
		"\u0013\u0001\u0000\u0000\u0000\u0096\u0097\u0003$\u0012\u0000\u0097\u0015"+
		"\u0001\u0000\u0000\u0000\u0098\u0099\u0003$\u0012\u0000\u0099\u0017\u0001"+
		"\u0000\u0000\u0000\u009a\u009b\u0003\b\u0004\u0000\u009b\u0019\u0001\u0000"+
		"\u0000\u0000\u009c\u009d\u0003\b\u0004\u0000\u009d\u001b\u0001\u0000\u0000"+
		"\u0000\u009e\u009f\u0003\b\u0004\u0000\u009f\u001d\u0001\u0000\u0000\u0000"+
		"\u00a0\u00a1\u0007\u0001\u0000\u0000\u00a1\u001f\u0001\u0000\u0000\u0000"+
		"\u00a2\u00a3\u0005\u000f\u0000\u0000\u00a3\u00a4\u0005\u0001\u0000\u0000"+
		"\u00a4\u00a5\u0005(\u0000\u0000\u00a5\u00a6\u0005\u0002\u0000\u0000\u00a6"+
		"\u00d7\u0005\t\u0000\u0000\u00a7\u00a8\u0003$\u0012\u0000\u00a8\u00a9"+
		"\u0005\t\u0000\u0000\u00a9\u00d7\u0001\u0000\u0000\u0000\u00aa\u00ac\u0005"+
		"\u0010\u0000\u0000\u00ab\u00ad\u0003$\u0012\u0000\u00ac\u00ab\u0001\u0000"+
		"\u0000\u0000\u00ac\u00ad\u0001\u0000\u0000\u0000\u00ad\u00ae\u0001\u0000"+
		"\u0000\u0000\u00ae\u00d7\u0005\t\u0000\u0000\u00af\u00b0\u0003$\u0012"+
		"\u0000\u00b0\u00b1\u0005\u0011\u0000\u0000\u00b1\u00b2\u0003$\u0012\u0000"+
		"\u00b2\u00b3\u0005\t\u0000\u0000\u00b3\u00d7\u0001\u0000\u0000\u0000\u00b4"+
		"\u00b5\u0003\u001e\u000f\u0000\u00b5\u00b8\u0005)\u0000\u0000\u00b6\u00b7"+
		"\u0005\u0003\u0000\u0000\u00b7\u00b9\u0003:\u001d\u0000\u00b8\u00b6\u0001"+
		"\u0000\u0000\u0000\u00b8\u00b9\u0001\u0000\u0000\u0000\u00b9\u00ba\u0001"+
		"\u0000\u0000\u0000\u00ba\u00bb\u0005\u0011\u0000\u0000\u00bb\u00bc\u0003"+
		"$\u0012\u0000\u00bc\u00bd\u0005\t\u0000\u0000\u00bd\u00d7\u0001\u0000"+
		"\u0000\u0000\u00be\u00bf\u0005\u0012\u0000\u0000\u00bf\u00c0\u0003\u0014"+
		"\n\u0000\u00c0\u00c1\u0005\u0005\u0000\u0000\u00c1\u00c2\u0003\u0018\f"+
		"\u0000\u00c2\u00cc\u0005\u0006\u0000\u0000\u00c3\u00c4\u0005\u0013\u0000"+
		"\u0000\u00c4\u00c5\u0005\u0012\u0000\u0000\u00c5\u00c6\u0003\u0016\u000b"+
		"\u0000\u00c6\u00c7\u0005\u0005\u0000\u0000\u00c7\u00c8\u0003\u001a\r\u0000"+
		"\u00c8\u00c9\u0005\u0006\u0000\u0000\u00c9\u00cb\u0001\u0000\u0000\u0000"+
		"\u00ca\u00c3\u0001\u0000\u0000\u0000\u00cb\u00ce\u0001\u0000\u0000\u0000"+
		"\u00cc\u00ca\u0001\u0000\u0000\u0000\u00cc\u00cd\u0001\u0000\u0000\u0000"+
		"\u00cd\u00d4\u0001\u0000\u0000\u0000\u00ce\u00cc\u0001\u0000\u0000\u0000"+
		"\u00cf\u00d0\u0005\u0013\u0000\u0000\u00d0\u00d1\u0005\u0005\u0000\u0000"+
		"\u00d1\u00d2\u0003\u001c\u000e\u0000\u00d2\u00d3\u0005\u0006\u0000\u0000"+
		"\u00d3\u00d5\u0001\u0000\u0000\u0000\u00d4\u00cf\u0001\u0000\u0000\u0000"+
		"\u00d4\u00d5\u0001\u0000\u0000\u0000\u00d5\u00d7\u0001\u0000\u0000\u0000"+
		"\u00d6\u00a2\u0001\u0000\u0000\u0000\u00d6\u00a7\u0001\u0000\u0000\u0000"+
		"\u00d6\u00aa\u0001\u0000\u0000\u0000\u00d6\u00af\u0001\u0000\u0000\u0000"+
		"\u00d6\u00b4\u0001\u0000\u0000\u0000\u00d6\u00be\u0001\u0000\u0000\u0000"+
		"\u00d7!\u0001\u0000\u0000\u0000\u00d8\u00d9\u0005\b\u0000\u0000\u00d9"+
		"\u00da\u0005)\u0000\u0000\u00da\u00db\u0005\u0003\u0000\u0000\u00db\u00dc"+
		"\u0003$\u0012\u0000\u00dc#\u0001\u0000\u0000\u0000\u00dd\u00de\u0006\u0012"+
		"\uffff\uffff\u0000\u00de\u00df\u0005\u0001\u0000\u0000\u00df\u00e0\u0003"+
		"$\u0012\u0000\u00e0\u00e1\u0005\u0002\u0000\u0000\u00e1\u0104\u0001\u0000"+
		"\u0000\u0000\u00e2\u00e3\u0003:\u001d\u0000\u00e3\u00e5\u0005\u0005\u0000"+
		"\u0000\u00e4\u00e6\u0003\"\u0011\u0000\u00e5\u00e4\u0001\u0000\u0000\u0000"+
		"\u00e5\u00e6\u0001\u0000\u0000\u0000\u00e6\u00eb\u0001\u0000\u0000\u0000"+
		"\u00e7\u00e8\u0005\u0007\u0000\u0000\u00e8\u00ea\u0003\"\u0011\u0000\u00e9"+
		"\u00e7\u0001\u0000\u0000\u0000\u00ea\u00ed\u0001\u0000\u0000\u0000\u00eb"+
		"\u00e9\u0001\u0000\u0000\u0000\u00eb\u00ec\u0001\u0000\u0000\u0000\u00ec"+
		"\u00ef\u0001\u0000\u0000\u0000\u00ed\u00eb\u0001\u0000\u0000\u0000\u00ee"+
		"\u00f0\u0005\u0007\u0000\u0000\u00ef\u00ee\u0001\u0000\u0000\u0000\u00ef"+
		"\u00f0\u0001\u0000\u0000\u0000\u00f0\u00f1\u0001\u0000\u0000\u0000\u00f1"+
		"\u00f2\u0005\u0006\u0000\u0000\u00f2\u0104\u0001\u0000\u0000\u0000\u00f3"+
		"\u0104\u0003\u0004\u0002\u0000\u00f4\u0100\u0005)\u0000\u0000\u00f5\u00f6"+
		"\u0005\u0019\u0000\u0000\u00f6\u00fb\u0003:\u001d\u0000\u00f7\u00f8\u0005"+
		"\u0007\u0000\u0000\u00f8\u00fa\u0003:\u001d\u0000\u00f9\u00f7\u0001\u0000"+
		"\u0000\u0000\u00fa\u00fd\u0001\u0000\u0000\u0000\u00fb\u00f9\u0001\u0000"+
		"\u0000\u0000\u00fb\u00fc\u0001\u0000\u0000\u0000\u00fc\u00fe\u0001\u0000"+
		"\u0000\u0000\u00fd\u00fb\u0001\u0000\u0000\u0000\u00fe\u00ff\u0005\u001a"+
		"\u0000\u0000\u00ff\u0101\u0001\u0000\u0000\u0000\u0100\u00f5\u0001\u0000"+
		"\u0000\u0000\u0100\u0101\u0001\u0000\u0000\u0000\u0101\u0104\u0001\u0000"+
		"\u0000\u0000\u0102\u0104\u0003*\u0015\u0000\u0103\u00dd\u0001\u0000\u0000"+
		"\u0000\u0103\u00e2\u0001\u0000\u0000\u0000\u0103\u00f3\u0001\u0000\u0000"+
		"\u0000\u0103\u00f4\u0001\u0000\u0000\u0000\u0103\u0102\u0001\u0000\u0000"+
		"\u0000\u0104\u0124\u0001\u0000\u0000\u0000\u0105\u0106\n\b\u0000\u0000"+
		"\u0106\u0107\u0007\u0002\u0000\u0000\u0107\u0123\u0003$\u0012\t\u0108"+
		"\u0109\n\u0007\u0000\u0000\u0109\u010a\u0007\u0003\u0000\u0000\u010a\u0123"+
		"\u0003$\u0012\b\u010b\u010c\n\u0006\u0000\u0000\u010c\u010d\u0007\u0004"+
		"\u0000\u0000\u010d\u0123\u0003$\u0012\u0007\u010e\u0114\n\u0005\u0000"+
		"\u0000\u010f\u0115\u0005\u001d\u0000\u0000\u0110\u0115\u0005\u001e\u0000"+
		"\u0000\u0111\u0115\u0005\u001f\u0000\u0000\u0112\u0113\u0005\u001f\u0000"+
		"\u0000\u0113\u0115\u0005 \u0000\u0000\u0114\u010f\u0001\u0000\u0000\u0000"+
		"\u0114\u0110\u0001\u0000\u0000\u0000\u0114\u0111\u0001\u0000\u0000\u0000"+
		"\u0114\u0112\u0001\u0000\u0000\u0000\u0115\u0116\u0001\u0000\u0000\u0000"+
		"\u0116\u0123\u0003$\u0012\u0006\u0117\u0118\n\u0004\u0000\u0000\u0118"+
		"\u0119\u0007\u0005\u0000\u0000\u0119\u0123\u0003$\u0012\u0005\u011a\u011b"+
		"\n\n\u0000\u0000\u011b\u011c\u0005\u0001\u0000\u0000\u011c\u011d\u0003"+
		"&\u0013\u0000\u011d\u011e\u0005\u0002\u0000\u0000\u011e\u0123\u0001\u0000"+
		"\u0000\u0000\u011f\u0120\n\t\u0000\u0000\u0120\u0121\u0005\b\u0000\u0000"+
		"\u0121\u0123\u0005)\u0000\u0000\u0122\u0105\u0001\u0000\u0000\u0000\u0122"+
		"\u0108\u0001\u0000\u0000\u0000\u0122\u010b\u0001\u0000\u0000\u0000\u0122"+
		"\u010e\u0001\u0000\u0000\u0000\u0122\u0117\u0001\u0000\u0000\u0000\u0122"+
		"\u011a\u0001\u0000\u0000\u0000\u0122\u011f\u0001\u0000\u0000\u0000\u0123"+
		"\u0126\u0001\u0000\u0000\u0000\u0124\u0122\u0001\u0000\u0000\u0000\u0124"+
		"\u0125\u0001\u0000\u0000\u0000\u0125%\u0001\u0000\u0000\u0000\u0126\u0124"+
		"\u0001\u0000\u0000\u0000\u0127\u012c\u0003$\u0012\u0000\u0128\u0129\u0005"+
		"\u0007\u0000\u0000\u0129\u012b\u0003$\u0012\u0000\u012a\u0128\u0001\u0000"+
		"\u0000\u0000\u012b\u012e\u0001\u0000\u0000\u0000\u012c\u012a\u0001\u0000"+
		"\u0000\u0000\u012c\u012d\u0001\u0000\u0000\u0000\u012d\u0130\u0001\u0000"+
		"\u0000\u0000\u012e\u012c\u0001\u0000\u0000\u0000\u012f\u0127\u0001\u0000"+
		"\u0000\u0000\u012f\u0130\u0001\u0000\u0000\u0000\u0130\'\u0001\u0000\u0000"+
		"\u0000\u0131\u0132\u0005\u0001\u0000\u0000\u0132\u0133\u0003\f\u0006\u0000"+
		"\u0133\u0134\u0005\u0002\u0000\u0000\u0134\u0135\u0005\u0004\u0000\u0000"+
		"\u0135\u0136\u0003:\u001d\u0000\u0136)\u0001\u0000\u0000\u0000\u0137\u013b"+
		"\u0005*\u0000\u0000\u0138\u013b\u0005(\u0000\u0000\u0139\u013b\u0007\u0006"+
		"\u0000\u0000\u013a\u0137\u0001\u0000\u0000\u0000\u013a\u0138\u0001\u0000"+
		"\u0000\u0000\u013a\u0139\u0001\u0000\u0000\u0000\u013b+\u0001\u0000\u0000"+
		"\u0000\u013c\u013d\u0005%\u0000\u0000\u013d\u013e\u00032\u0019\u0000\u013e"+
		"\u0140\u0003.\u0017\u0000\u013f\u0141\u00030\u0018\u0000\u0140\u013f\u0001"+
		"\u0000\u0000\u0000\u0140\u0141\u0001\u0000\u0000\u0000\u0141-\u0001\u0000"+
		"\u0000\u0000\u0142\u0143\u0005(\u0000\u0000\u0143/\u0001\u0000\u0000\u0000"+
		"\u0144\u0145\u0005(\u0000\u0000\u01451\u0001\u0000\u0000\u0000\u0146\u0147"+
		"\u0007\u0000\u0000\u0000\u01473\u0001\u0000\u0000\u0000\u0148\u0149\u0005"+
		"&\u0000\u0000\u0149\u014a\u0005(\u0000\u0000\u014a5\u0001\u0000\u0000"+
		"\u0000\u014b\u014c\u0005)\u0000\u0000\u014c\u014d\u0005\u0003\u0000\u0000"+
		"\u014d\u014e\u0003:\u001d\u0000\u014e\u014f\u0005\t\u0000\u0000\u014f"+
		"\u015b\u0001\u0000\u0000\u0000\u0150\u0151\u0005)\u0000\u0000\u0151\u0152"+
		"\u0005\u0001\u0000\u0000\u0152\u0153\u0003\f\u0006\u0000\u0153\u0156\u0005"+
		"\u0002\u0000\u0000\u0154\u0155\u0005\u0003\u0000\u0000\u0155\u0157\u0003"+
		":\u001d\u0000\u0156\u0154\u0001\u0000\u0000\u0000\u0156\u0157\u0001\u0000"+
		"\u0000\u0000\u0157\u0158\u0001\u0000\u0000\u0000\u0158\u0159\u0003\u0006"+
		"\u0003\u0000\u0159\u015b\u0001\u0000\u0000\u0000\u015a\u014b\u0001\u0000"+
		"\u0000\u0000\u015a\u0150\u0001\u0000\u0000\u0000\u015b7\u0001\u0000\u0000"+
		"\u0000\u015c\u015d\u0005\'\u0000\u0000\u015d\u0168\u0005)\u0000\u0000"+
		"\u015e\u015f\u0005\u0019\u0000\u0000\u015f\u0164\u0005)\u0000\u0000\u0160"+
		"\u0161\u0005\u0007\u0000\u0000\u0161\u0163\u0005)\u0000\u0000\u0162\u0160"+
		"\u0001\u0000\u0000\u0000\u0163\u0166\u0001\u0000\u0000\u0000\u0164\u0162"+
		"\u0001\u0000\u0000\u0000\u0164\u0165\u0001\u0000\u0000\u0000\u0165\u0167"+
		"\u0001\u0000\u0000\u0000\u0166\u0164\u0001\u0000\u0000\u0000\u0167\u0169"+
		"\u0005\u001a\u0000\u0000\u0168\u015e\u0001\u0000\u0000\u0000\u0168\u0169"+
		"\u0001\u0000\u0000\u0000\u0169\u016a\u0001\u0000\u0000\u0000\u016a\u016e"+
		"\u0005\u0005\u0000\u0000\u016b\u016d\u00036\u001b\u0000\u016c\u016b\u0001"+
		"\u0000\u0000\u0000\u016d\u0170\u0001\u0000\u0000\u0000\u016e\u016c\u0001"+
		"\u0000\u0000\u0000\u016e\u016f\u0001\u0000\u0000\u0000\u016f\u0171\u0001"+
		"\u0000\u0000\u0000\u0170\u016e\u0001\u0000\u0000\u0000\u0171\u0172\u0005"+
		"\u0006\u0000\u0000\u01729\u0001\u0000\u0000\u0000\u0173\u017f\u0005)\u0000"+
		"\u0000\u0174\u0175\u0005\u0019\u0000\u0000\u0175\u017a\u0003:\u001d\u0000"+
		"\u0176\u0177\u0005\u0007\u0000\u0000\u0177\u0179\u0003:\u001d\u0000\u0178"+
		"\u0176\u0001\u0000\u0000\u0000\u0179\u017c\u0001\u0000\u0000\u0000\u017a"+
		"\u0178\u0001\u0000\u0000\u0000\u017a\u017b\u0001\u0000\u0000\u0000\u017b"+
		"\u017d\u0001\u0000\u0000\u0000\u017c\u017a\u0001\u0000\u0000\u0000\u017d"+
		"\u017e\u0005\u001a\u0000\u0000\u017e\u0180\u0001\u0000\u0000\u0000\u017f"+
		"\u0174\u0001\u0000\u0000\u0000\u017f\u0180\u0001\u0000\u0000\u0000\u0180"+
		"\u0183\u0001\u0000\u0000\u0000\u0181\u0183\u0003(\u0014\u0000\u0182\u0173"+
		"\u0001\u0000\u0000\u0000\u0182\u0181\u0001\u0000\u0000\u0000\u0183;\u0001"+
		"\u0000\u0000\u0000&ACLUZbgsv|\u0085\u008f\u00ac\u00b8\u00cc\u00d4\u00d6"+
		"\u00e5\u00eb\u00ef\u00fb\u0100\u0103\u0114\u0122\u0124\u012c\u012f\u013a"+
		"\u0140\u0156\u015a\u0164\u0168\u016e\u017a\u017f\u0182";
	public static final ATN _ATN =
		new ATNDeserializer().deserialize(_serializedATN.toCharArray());
	static {
		_decisionToDFA = new DFA[_ATN.getNumberOfDecisions()];
		for (int i = 0; i < _ATN.getNumberOfDecisions(); i++) {
			_decisionToDFA[i] = new DFA(_ATN.getDecisionState(i), i);
		}
	}
}