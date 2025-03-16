// Generated from /home/fzachs/Projects/haze/src/parser/Haze.g4 by ANTLR 4.13.1
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
		T__52=53, T__53=54, T__54=55, T__55=56, T__56=57, STRING_LITERAL=58, UNIT_LITERAL=59, 
		NUMBER_LITERAL=60, ID=61, WS=62, COMMENT=63;
	public static final int
		RULE_prog = 0, RULE_namespacecontent = 1, RULE_namespace = 2, RULE_namedfunc = 3, 
		RULE_func = 4, RULE_funcbody = 5, RULE_body = 6, RULE_param = 7, RULE_params = 8, 
		RULE_cdefinitiondecl = 9, RULE_funcdecl = 10, RULE_externlang = 11, RULE_ifexpr = 12, 
		RULE_elseifexpr = 13, RULE_thenblock = 14, RULE_elseifblock = 15, RULE_elseblock = 16, 
		RULE_variablemutability = 17, RULE_variablestatement = 18, RULE_statement = 19, 
		RULE_structmembervalue = 20, RULE_expr = 21, RULE_args = 22, RULE_ellipsis = 23, 
		RULE_functype = 24, RULE_constant = 25, RULE_structcontent = 26, RULE_structdecl = 27, 
		RULE_datatype = 28, RULE_datatypeimpl = 29, RULE_genericsvalue = 30;
	private static String[] makeRuleNames() {
		return new String[] {
			"prog", "namespacecontent", "namespace", "namedfunc", "func", "funcbody", 
			"body", "param", "params", "cdefinitiondecl", "funcdecl", "externlang", 
			"ifexpr", "elseifexpr", "thenblock", "elseifblock", "elseblock", "variablemutability", 
			"variablestatement", "statement", "structmembervalue", "expr", "args", 
			"ellipsis", "functype", "constant", "structcontent", "structdecl", "datatype", 
			"datatypeimpl", "genericsvalue"
		};
	}
	public static final String[] ruleNames = makeRuleNames();

	private static String[] makeLiteralNames() {
		return new String[] {
			null, "'export'", "'namespace'", "'.'", "'{'", "'}'", "'('", "')'", "':'", 
			"'=>'", "','", "'inject'", "';'", "'extern'", "'\"C\"'", "'\"C++\"'", 
			"'let'", "'const'", "'='", "'__c__'", "'return'", "'if'", "'else'", "'while'", 
			"'++'", "'--'", "'+'", "'-'", "'not'", "'!'", "'as'", "'*'", "'/'", "'%'", 
			"'<'", "'>'", "'<='", "'>='", "'=='", "'!='", "'is'", "'and'", "'or'", 
			"'+='", "'-='", "'*='", "'/='", "'%='", "'<<='", "'>>='", "'&='", "'^='", 
			"'|='", "'...'", "'true'", "'false'", "'unsafe_union'", "'struct'"
		};
	}
	private static final String[] _LITERAL_NAMES = makeLiteralNames();
	private static String[] makeSymbolicNames() {
		return new String[] {
			null, null, null, null, null, null, null, null, null, null, null, null, 
			null, null, null, null, null, null, null, null, null, null, null, null, 
			null, null, null, null, null, null, null, null, null, null, null, null, 
			null, null, null, null, null, null, null, null, null, null, null, null, 
			null, null, null, null, null, null, null, null, null, null, "STRING_LITERAL", 
			"UNIT_LITERAL", "NUMBER_LITERAL", "ID", "WS", "COMMENT"
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
		public List<StructdeclContext> structdecl() {
			return getRuleContexts(StructdeclContext.class);
		}
		public StructdeclContext structdecl(int i) {
			return getRuleContext(StructdeclContext.class,i);
		}
		public List<NamespaceContext> namespace() {
			return getRuleContexts(NamespaceContext.class);
		}
		public NamespaceContext namespace(int i) {
			return getRuleContext(NamespaceContext.class,i);
		}
		public List<VariablestatementContext> variablestatement() {
			return getRuleContexts(VariablestatementContext.class);
		}
		public VariablestatementContext variablestatement(int i) {
			return getRuleContext(VariablestatementContext.class,i);
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
			while ((((_la) & ~0x3f) == 0 && ((1L << _la) & 2449958197289756678L) != 0)) {
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
					structdecl();
					}
					break;
				case 5:
					{
					setState(66);
					namespace();
					}
					break;
				case 6:
					{
					setState(67);
					variablestatement();
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
	public static class NamespacecontentContext extends ParserRuleContext {
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
		public List<StructdeclContext> structdecl() {
			return getRuleContexts(StructdeclContext.class);
		}
		public StructdeclContext structdecl(int i) {
			return getRuleContext(StructdeclContext.class,i);
		}
		public List<NamespaceContext> namespace() {
			return getRuleContexts(NamespaceContext.class);
		}
		public NamespaceContext namespace(int i) {
			return getRuleContext(NamespaceContext.class,i);
		}
		public List<VariablestatementContext> variablestatement() {
			return getRuleContexts(VariablestatementContext.class);
		}
		public VariablestatementContext variablestatement(int i) {
			return getRuleContext(VariablestatementContext.class,i);
		}
		public NamespacecontentContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_namespacecontent; }
	}

	public final NamespacecontentContext namespacecontent() throws RecognitionException {
		NamespacecontentContext _localctx = new NamespacecontentContext(_ctx, getState());
		enterRule(_localctx, 2, RULE_namespacecontent);
		int _la;
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(80);
			_errHandler.sync(this);
			_la = _input.LA(1);
			while ((((_la) & ~0x3f) == 0 && ((1L << _la) & 2449958197289754630L) != 0)) {
				{
				setState(78);
				_errHandler.sync(this);
				switch ( getInterpreter().adaptivePredict(_input,2,_ctx) ) {
				case 1:
					{
					setState(73);
					namedfunc();
					}
					break;
				case 2:
					{
					setState(74);
					funcdecl();
					}
					break;
				case 3:
					{
					setState(75);
					structdecl();
					}
					break;
				case 4:
					{
					setState(76);
					namespace();
					}
					break;
				case 5:
					{
					setState(77);
					variablestatement();
					}
					break;
				}
				}
				setState(82);
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
	public static class NamespaceContext extends ParserRuleContext {
		public Token export;
		public List<TerminalNode> ID() { return getTokens(HazeParser.ID); }
		public TerminalNode ID(int i) {
			return getToken(HazeParser.ID, i);
		}
		public NamespacecontentContext namespacecontent() {
			return getRuleContext(NamespacecontentContext.class,0);
		}
		public NamespaceContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_namespace; }
	}

	public final NamespaceContext namespace() throws RecognitionException {
		NamespaceContext _localctx = new NamespaceContext(_ctx, getState());
		enterRule(_localctx, 4, RULE_namespace);
		int _la;
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(84);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (_la==T__0) {
				{
				setState(83);
				((NamespaceContext)_localctx).export = match(T__0);
				}
			}

			setState(86);
			match(T__1);
			setState(87);
			match(ID);
			setState(92);
			_errHandler.sync(this);
			_la = _input.LA(1);
			while (_la==T__2) {
				{
				{
				setState(88);
				match(T__2);
				setState(89);
				match(ID);
				}
				}
				setState(94);
				_errHandler.sync(this);
				_la = _input.LA(1);
			}
			setState(95);
			match(T__3);
			setState(96);
			namespacecontent();
			setState(97);
			match(T__4);
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
		public Token export;
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
		enterRule(_localctx, 6, RULE_namedfunc);
		int _la;
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(100);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (_la==T__0) {
				{
				setState(99);
				((NamedfuncContext)_localctx).export = match(T__0);
				}
			}

			setState(102);
			match(ID);
			setState(103);
			match(T__5);
			setState(104);
			params();
			setState(105);
			match(T__6);
			setState(108);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (_la==T__7) {
				{
				setState(106);
				match(T__7);
				setState(107);
				datatype();
				}
			}

			setState(110);
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
		enterRule(_localctx, 8, RULE_func);
		int _la;
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(112);
			match(T__5);
			setState(113);
			params();
			setState(114);
			match(T__6);
			setState(117);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (_la==T__7) {
				{
				setState(115);
				match(T__7);
				setState(116);
				datatype();
				}
			}

			setState(119);
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
		enterRule(_localctx, 10, RULE_funcbody);
		int _la;
		try {
			setState(130);
			_errHandler.sync(this);
			switch ( getInterpreter().adaptivePredict(_input,10,_ctx) ) {
			case 1:
				enterOuterAlt(_localctx, 1);
				{
				setState(122);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (_la==T__8) {
					{
					setState(121);
					match(T__8);
					}
				}

				setState(124);
				match(T__3);
				setState(125);
				body();
				setState(126);
				match(T__4);
				}
				break;
			case 2:
				enterOuterAlt(_localctx, 2);
				{
				setState(128);
				match(T__8);
				setState(129);
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
		enterRule(_localctx, 12, RULE_body);
		int _la;
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(135);
			_errHandler.sync(this);
			_la = _input.LA(1);
			while ((((_la) & ~0x3f) == 0 && ((1L << _la) & 4377498838873350210L) != 0)) {
				{
				{
				setState(132);
				statement();
				}
				}
				setState(137);
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
		enterRule(_localctx, 14, RULE_param);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(138);
			match(ID);
			setState(139);
			match(T__7);
			setState(140);
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
		enterRule(_localctx, 16, RULE_params);
		int _la;
		try {
			int _alt;
			setState(157);
			_errHandler.sync(this);
			switch (_input.LA(1)) {
			case T__6:
			case ID:
				enterOuterAlt(_localctx, 1);
				{
				setState(154);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (_la==ID) {
					{
					setState(142);
					param();
					setState(147);
					_errHandler.sync(this);
					_alt = getInterpreter().adaptivePredict(_input,12,_ctx);
					while ( _alt!=2 && _alt!=org.antlr.v4.runtime.atn.ATN.INVALID_ALT_NUMBER ) {
						if ( _alt==1 ) {
							{
							{
							setState(143);
							match(T__9);
							setState(144);
							param();
							}
							} 
						}
						setState(149);
						_errHandler.sync(this);
						_alt = getInterpreter().adaptivePredict(_input,12,_ctx);
					}
					setState(152);
					_errHandler.sync(this);
					_la = _input.LA(1);
					if (_la==T__9) {
						{
						setState(150);
						match(T__9);
						setState(151);
						ellipsis();
						}
					}

					}
				}

				}
				break;
			case T__52:
				enterOuterAlt(_localctx, 2);
				{
				setState(156);
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
		public CdefinitiondeclContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_cdefinitiondecl; }
	}

	public final CdefinitiondeclContext cdefinitiondecl() throws RecognitionException {
		CdefinitiondeclContext _localctx = new CdefinitiondeclContext(_ctx, getState());
		enterRule(_localctx, 18, RULE_cdefinitiondecl);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(159);
			match(T__10);
			setState(160);
			match(STRING_LITERAL);
			setState(161);
			match(T__11);
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
		public Token export;
		public Token extern;
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
		public ExternlangContext externlang() {
			return getRuleContext(ExternlangContext.class,0);
		}
		public FuncdeclContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_funcdecl; }
	}

	public final FuncdeclContext funcdecl() throws RecognitionException {
		FuncdeclContext _localctx = new FuncdeclContext(_ctx, getState());
		enterRule(_localctx, 20, RULE_funcdecl);
		int _la;
		try {
			int _alt;
			enterOuterAlt(_localctx, 1);
			{
			setState(164);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (_la==T__0) {
				{
				setState(163);
				((FuncdeclContext)_localctx).export = match(T__0);
				}
			}

			setState(170);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (_la==T__12) {
				{
				setState(166);
				((FuncdeclContext)_localctx).extern = match(T__12);
				setState(168);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (_la==T__13 || _la==T__14) {
					{
					setState(167);
					externlang();
					}
				}

				}
			}

			setState(176);
			_errHandler.sync(this);
			_alt = getInterpreter().adaptivePredict(_input,19,_ctx);
			while ( _alt!=2 && _alt!=org.antlr.v4.runtime.atn.ATN.INVALID_ALT_NUMBER ) {
				if ( _alt==1 ) {
					{
					{
					setState(172);
					match(ID);
					setState(173);
					match(T__2);
					}
					} 
				}
				setState(178);
				_errHandler.sync(this);
				_alt = getInterpreter().adaptivePredict(_input,19,_ctx);
			}
			setState(179);
			match(ID);
			setState(180);
			match(T__5);
			setState(181);
			params();
			setState(182);
			match(T__6);
			setState(185);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (_la==T__7) {
				{
				setState(183);
				match(T__7);
				setState(184);
				datatype();
				}
			}

			setState(187);
			match(T__11);
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
		enterRule(_localctx, 22, RULE_externlang);
		int _la;
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(189);
			_la = _input.LA(1);
			if ( !(_la==T__13 || _la==T__14) ) {
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
		enterRule(_localctx, 24, RULE_ifexpr);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(191);
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
		enterRule(_localctx, 26, RULE_elseifexpr);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(193);
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
		enterRule(_localctx, 28, RULE_thenblock);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(195);
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
		enterRule(_localctx, 30, RULE_elseifblock);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(197);
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
		enterRule(_localctx, 32, RULE_elseblock);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(199);
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
		enterRule(_localctx, 34, RULE_variablemutability);
		int _la;
		try {
			_localctx = new VariableMutabilityContext(_localctx);
			enterOuterAlt(_localctx, 1);
			{
			setState(201);
			_la = _input.LA(1);
			if ( !(_la==T__15 || _la==T__16) ) {
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
	public static class VariablestatementContext extends ParserRuleContext {
		public VariablestatementContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_variablestatement; }
	 
		public VariablestatementContext() { }
		public void copyFrom(VariablestatementContext ctx) {
			super.copyFrom(ctx);
		}
	}
	@SuppressWarnings("CheckReturnValue")
	public static class VariableDefinitionContext extends VariablestatementContext {
		public Token export;
		public Token extern;
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
		public ExternlangContext externlang() {
			return getRuleContext(ExternlangContext.class,0);
		}
		public VariableDefinitionContext(VariablestatementContext ctx) { copyFrom(ctx); }
	}
	@SuppressWarnings("CheckReturnValue")
	public static class VariableDeclarationContext extends VariablestatementContext {
		public Token export;
		public Token extern;
		public VariablemutabilityContext variablemutability() {
			return getRuleContext(VariablemutabilityContext.class,0);
		}
		public TerminalNode ID() { return getToken(HazeParser.ID, 0); }
		public DatatypeContext datatype() {
			return getRuleContext(DatatypeContext.class,0);
		}
		public ExternlangContext externlang() {
			return getRuleContext(ExternlangContext.class,0);
		}
		public VariableDeclarationContext(VariablestatementContext ctx) { copyFrom(ctx); }
	}

	public final VariablestatementContext variablestatement() throws RecognitionException {
		VariablestatementContext _localctx = new VariablestatementContext(_ctx, getState());
		enterRule(_localctx, 36, RULE_variablestatement);
		int _la;
		try {
			setState(238);
			_errHandler.sync(this);
			switch ( getInterpreter().adaptivePredict(_input,28,_ctx) ) {
			case 1:
				_localctx = new VariableDefinitionContext(_localctx);
				enterOuterAlt(_localctx, 1);
				{
				setState(204);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (_la==T__0) {
					{
					setState(203);
					((VariableDefinitionContext)_localctx).export = match(T__0);
					}
				}

				setState(210);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (_la==T__12) {
					{
					setState(206);
					((VariableDefinitionContext)_localctx).extern = match(T__12);
					setState(208);
					_errHandler.sync(this);
					_la = _input.LA(1);
					if (_la==T__13 || _la==T__14) {
						{
						setState(207);
						externlang();
						}
					}

					}
				}

				setState(212);
				variablemutability();
				setState(213);
				match(ID);
				setState(216);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (_la==T__7) {
					{
					setState(214);
					match(T__7);
					setState(215);
					datatype();
					}
				}

				setState(218);
				match(T__17);
				setState(219);
				expr(0);
				setState(220);
				match(T__11);
				}
				break;
			case 2:
				_localctx = new VariableDeclarationContext(_localctx);
				enterOuterAlt(_localctx, 2);
				{
				setState(223);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (_la==T__0) {
					{
					setState(222);
					((VariableDeclarationContext)_localctx).export = match(T__0);
					}
				}

				setState(229);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (_la==T__12) {
					{
					setState(225);
					((VariableDeclarationContext)_localctx).extern = match(T__12);
					setState(227);
					_errHandler.sync(this);
					_la = _input.LA(1);
					if (_la==T__13 || _la==T__14) {
						{
						setState(226);
						externlang();
						}
					}

					}
				}

				setState(231);
				variablemutability();
				setState(232);
				match(ID);
				{
				setState(233);
				match(T__7);
				setState(234);
				datatype();
				}
				setState(236);
				match(T__11);
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
	public static class VariableStatementContext extends StatementContext {
		public VariablestatementContext variablestatement() {
			return getRuleContext(VariablestatementContext.class,0);
		}
		public VariableStatementContext(StatementContext ctx) { copyFrom(ctx); }
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
		enterRule(_localctx, 38, RULE_statement);
		int _la;
		try {
			int _alt;
			setState(284);
			_errHandler.sync(this);
			switch (_input.LA(1)) {
			case T__18:
				_localctx = new InlineCStatementContext(_localctx);
				enterOuterAlt(_localctx, 1);
				{
				setState(240);
				match(T__18);
				setState(241);
				match(T__5);
				setState(242);
				match(STRING_LITERAL);
				setState(243);
				match(T__6);
				setState(244);
				match(T__11);
				}
				break;
			case T__5:
			case T__23:
			case T__24:
			case T__25:
			case T__26:
			case T__27:
			case T__28:
			case T__53:
			case T__54:
			case STRING_LITERAL:
			case UNIT_LITERAL:
			case NUMBER_LITERAL:
			case ID:
				_localctx = new ExprStatementContext(_localctx);
				enterOuterAlt(_localctx, 2);
				{
				setState(245);
				expr(0);
				setState(246);
				match(T__11);
				}
				break;
			case T__19:
				_localctx = new ReturnStatementContext(_localctx);
				enterOuterAlt(_localctx, 3);
				{
				setState(248);
				match(T__19);
				setState(250);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if ((((_la) & ~0x3f) == 0 && ((1L << _la) & 4377498838861086784L) != 0)) {
					{
					setState(249);
					expr(0);
					}
				}

				setState(252);
				match(T__11);
				}
				break;
			case T__0:
			case T__12:
			case T__15:
			case T__16:
				_localctx = new VariableStatementContext(_localctx);
				enterOuterAlt(_localctx, 4);
				{
				setState(253);
				variablestatement();
				}
				break;
			case T__20:
				_localctx = new IfStatementContext(_localctx);
				enterOuterAlt(_localctx, 5);
				{
				setState(254);
				match(T__20);
				setState(255);
				ifexpr();
				setState(256);
				match(T__3);
				setState(257);
				thenblock();
				setState(258);
				match(T__4);
				setState(268);
				_errHandler.sync(this);
				_alt = getInterpreter().adaptivePredict(_input,30,_ctx);
				while ( _alt!=2 && _alt!=org.antlr.v4.runtime.atn.ATN.INVALID_ALT_NUMBER ) {
					if ( _alt==1 ) {
						{
						{
						setState(259);
						match(T__21);
						setState(260);
						match(T__20);
						setState(261);
						elseifexpr();
						setState(262);
						match(T__3);
						setState(263);
						elseifblock();
						setState(264);
						match(T__4);
						}
						} 
					}
					setState(270);
					_errHandler.sync(this);
					_alt = getInterpreter().adaptivePredict(_input,30,_ctx);
				}
				setState(276);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (_la==T__21) {
					{
					setState(271);
					match(T__21);
					setState(272);
					match(T__3);
					setState(273);
					elseblock();
					setState(274);
					match(T__4);
					}
				}

				}
				break;
			case T__22:
				_localctx = new WhileStatementContext(_localctx);
				enterOuterAlt(_localctx, 6);
				{
				setState(278);
				match(T__22);
				setState(279);
				expr(0);
				setState(280);
				match(T__3);
				setState(281);
				body();
				setState(282);
				match(T__4);
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
		enterRule(_localctx, 40, RULE_structmembervalue);
		try {
			_localctx = new StructMemberValueContext(_localctx);
			enterOuterAlt(_localctx, 1);
			{
			setState(286);
			match(T__2);
			setState(287);
			match(ID);
			setState(288);
			match(T__7);
			setState(289);
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
		public List<ConstantContext> constant() {
			return getRuleContexts(ConstantContext.class);
		}
		public ConstantContext constant(int i) {
			return getRuleContext(ConstantContext.class,i);
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
		int _startState = 42;
		enterRecursionRule(_localctx, 42, RULE_expr, _p);
		int _la;
		try {
			int _alt;
			enterOuterAlt(_localctx, 1);
			{
			setState(341);
			_errHandler.sync(this);
			switch ( getInterpreter().adaptivePredict(_input,40,_ctx) ) {
			case 1:
				{
				_localctx = new ParenthesisExprContext(_localctx);
				_ctx = _localctx;
				_prevctx = _localctx;

				setState(292);
				match(T__5);
				setState(293);
				expr(0);
				setState(294);
				match(T__6);
				}
				break;
			case 2:
				{
				_localctx = new FuncRefExprContext(_localctx);
				_ctx = _localctx;
				_prevctx = _localctx;
				setState(296);
				func();
				}
				break;
			case 3:
				{
				_localctx = new ConstantExprContext(_localctx);
				_ctx = _localctx;
				_prevctx = _localctx;
				setState(297);
				constant();
				}
				break;
			case 4:
				{
				_localctx = new StructInstantiationExprContext(_localctx);
				_ctx = _localctx;
				_prevctx = _localctx;
				setState(298);
				datatype();
				setState(299);
				match(T__3);
				setState(301);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (_la==T__2) {
					{
					setState(300);
					structmembervalue();
					}
				}

				setState(307);
				_errHandler.sync(this);
				_alt = getInterpreter().adaptivePredict(_input,34,_ctx);
				while ( _alt!=2 && _alt!=org.antlr.v4.runtime.atn.ATN.INVALID_ALT_NUMBER ) {
					if ( _alt==1 ) {
						{
						{
						setState(303);
						match(T__9);
						setState(304);
						structmembervalue();
						}
						} 
					}
					setState(309);
					_errHandler.sync(this);
					_alt = getInterpreter().adaptivePredict(_input,34,_ctx);
				}
				setState(311);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (_la==T__9) {
					{
					setState(310);
					match(T__9);
					}
				}

				setState(313);
				match(T__4);
				}
				break;
			case 5:
				{
				_localctx = new PreIncrExprContext(_localctx);
				_ctx = _localctx;
				_prevctx = _localctx;
				setState(315);
				((PreIncrExprContext)_localctx).op = _input.LT(1);
				_la = _input.LA(1);
				if ( !(_la==T__23 || _la==T__24) ) {
					((PreIncrExprContext)_localctx).op = (Token)_errHandler.recoverInline(this);
				}
				else {
					if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
					_errHandler.reportMatch(this);
					consume();
				}
				setState(316);
				expr(11);
				}
				break;
			case 6:
				{
				_localctx = new UnaryExprContext(_localctx);
				_ctx = _localctx;
				_prevctx = _localctx;
				setState(317);
				((UnaryExprContext)_localctx).op = _input.LT(1);
				_la = _input.LA(1);
				if ( !(_la==T__25 || _la==T__26) ) {
					((UnaryExprContext)_localctx).op = (Token)_errHandler.recoverInline(this);
				}
				else {
					if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
					_errHandler.reportMatch(this);
					consume();
				}
				setState(318);
				expr(10);
				}
				break;
			case 7:
				{
				_localctx = new UnaryExprContext(_localctx);
				_ctx = _localctx;
				_prevctx = _localctx;
				setState(319);
				_la = _input.LA(1);
				if ( !(_la==T__27 || _la==T__28) ) {
				_errHandler.recoverInline(this);
				}
				else {
					if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
					_errHandler.reportMatch(this);
					consume();
				}
				setState(320);
				expr(9);
				}
				break;
			case 8:
				{
				_localctx = new SymbolValueExprContext(_localctx);
				_ctx = _localctx;
				_prevctx = _localctx;
				setState(321);
				match(ID);
				setState(339);
				_errHandler.sync(this);
				switch ( getInterpreter().adaptivePredict(_input,39,_ctx) ) {
				case 1:
					{
					setState(322);
					match(T__33);
					setState(325);
					_errHandler.sync(this);
					switch (_input.LA(1)) {
					case T__5:
					case ID:
						{
						setState(323);
						datatype();
						}
						break;
					case T__53:
					case T__54:
					case STRING_LITERAL:
					case UNIT_LITERAL:
					case NUMBER_LITERAL:
						{
						setState(324);
						constant();
						}
						break;
					default:
						throw new NoViableAltException(this);
					}
					setState(334);
					_errHandler.sync(this);
					_la = _input.LA(1);
					while (_la==T__9) {
						{
						{
						setState(327);
						match(T__9);
						setState(330);
						_errHandler.sync(this);
						switch (_input.LA(1)) {
						case T__5:
						case ID:
							{
							setState(328);
							datatype();
							}
							break;
						case T__53:
						case T__54:
						case STRING_LITERAL:
						case UNIT_LITERAL:
						case NUMBER_LITERAL:
							{
							setState(329);
							constant();
							}
							break;
						default:
							throw new NoViableAltException(this);
						}
						}
						}
						setState(336);
						_errHandler.sync(this);
						_la = _input.LA(1);
					}
					setState(337);
					match(T__34);
					}
					break;
				}
				}
				break;
			}
			_ctx.stop = _input.LT(-1);
			setState(382);
			_errHandler.sync(this);
			_alt = getInterpreter().adaptivePredict(_input,43,_ctx);
			while ( _alt!=2 && _alt!=org.antlr.v4.runtime.atn.ATN.INVALID_ALT_NUMBER ) {
				if ( _alt==1 ) {
					if ( _parseListeners!=null ) triggerExitRuleEvent();
					_prevctx = _localctx;
					{
					setState(380);
					_errHandler.sync(this);
					switch ( getInterpreter().adaptivePredict(_input,42,_ctx) ) {
					case 1:
						{
						_localctx = new BinaryExprContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(343);
						if (!(precpred(_ctx, 7))) throw new FailedPredicateException(this, "precpred(_ctx, 7)");
						setState(344);
						_la = _input.LA(1);
						if ( !((((_la) & ~0x3f) == 0 && ((1L << _la) & 15032385536L) != 0)) ) {
						_errHandler.recoverInline(this);
						}
						else {
							if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
							_errHandler.reportMatch(this);
							consume();
						}
						setState(345);
						expr(8);
						}
						break;
					case 2:
						{
						_localctx = new BinaryExprContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(346);
						if (!(precpred(_ctx, 6))) throw new FailedPredicateException(this, "precpred(_ctx, 6)");
						setState(347);
						_la = _input.LA(1);
						if ( !(_la==T__25 || _la==T__26) ) {
						_errHandler.recoverInline(this);
						}
						else {
							if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
							_errHandler.reportMatch(this);
							consume();
						}
						setState(348);
						expr(7);
						}
						break;
					case 3:
						{
						_localctx = new BinaryExprContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(349);
						if (!(precpred(_ctx, 5))) throw new FailedPredicateException(this, "precpred(_ctx, 5)");
						setState(350);
						_la = _input.LA(1);
						if ( !((((_la) & ~0x3f) == 0 && ((1L << _la) & 257698037760L) != 0)) ) {
						_errHandler.recoverInline(this);
						}
						else {
							if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
							_errHandler.reportMatch(this);
							consume();
						}
						setState(351);
						expr(6);
						}
						break;
					case 4:
						{
						_localctx = new BinaryExprContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(352);
						if (!(precpred(_ctx, 4))) throw new FailedPredicateException(this, "precpred(_ctx, 4)");
						setState(358);
						_errHandler.sync(this);
						switch ( getInterpreter().adaptivePredict(_input,41,_ctx) ) {
						case 1:
							{
							setState(353);
							match(T__37);
							}
							break;
						case 2:
							{
							setState(354);
							match(T__38);
							}
							break;
						case 3:
							{
							setState(355);
							match(T__39);
							}
							break;
						case 4:
							{
							{
							setState(356);
							match(T__39);
							setState(357);
							match(T__27);
							}
							}
							break;
						}
						setState(360);
						expr(5);
						}
						break;
					case 5:
						{
						_localctx = new BinaryExprContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(361);
						if (!(precpred(_ctx, 3))) throw new FailedPredicateException(this, "precpred(_ctx, 3)");
						setState(362);
						_la = _input.LA(1);
						if ( !(_la==T__40 || _la==T__41) ) {
						_errHandler.recoverInline(this);
						}
						else {
							if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
							_errHandler.reportMatch(this);
							consume();
						}
						setState(363);
						expr(4);
						}
						break;
					case 6:
						{
						_localctx = new ExprAssignmentExprContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(364);
						if (!(precpred(_ctx, 2))) throw new FailedPredicateException(this, "precpred(_ctx, 2)");
						setState(365);
						((ExprAssignmentExprContext)_localctx).op = _input.LT(1);
						_la = _input.LA(1);
						if ( !((((_la) & ~0x3f) == 0 && ((1L << _la) & 8998403161980928L) != 0)) ) {
							((ExprAssignmentExprContext)_localctx).op = (Token)_errHandler.recoverInline(this);
						}
						else {
							if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
							_errHandler.reportMatch(this);
							consume();
						}
						setState(366);
						expr(3);
						}
						break;
					case 7:
						{
						_localctx = new PostIncrExprContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(367);
						if (!(precpred(_ctx, 15))) throw new FailedPredicateException(this, "precpred(_ctx, 15)");
						setState(368);
						((PostIncrExprContext)_localctx).op = _input.LT(1);
						_la = _input.LA(1);
						if ( !(_la==T__23 || _la==T__24) ) {
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
						setState(369);
						if (!(precpred(_ctx, 14))) throw new FailedPredicateException(this, "precpred(_ctx, 14)");
						setState(370);
						match(T__5);
						setState(371);
						args();
						setState(372);
						match(T__6);
						}
						break;
					case 9:
						{
						_localctx = new ExprMemberAccessContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(374);
						if (!(precpred(_ctx, 13))) throw new FailedPredicateException(this, "precpred(_ctx, 13)");
						setState(375);
						match(T__2);
						setState(376);
						match(ID);
						}
						break;
					case 10:
						{
						_localctx = new ExplicitCastExprContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(377);
						if (!(precpred(_ctx, 8))) throw new FailedPredicateException(this, "precpred(_ctx, 8)");
						setState(378);
						match(T__29);
						setState(379);
						datatype();
						}
						break;
					}
					} 
				}
				setState(384);
				_errHandler.sync(this);
				_alt = getInterpreter().adaptivePredict(_input,43,_ctx);
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
		enterRule(_localctx, 44, RULE_args);
		int _la;
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(393);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if ((((_la) & ~0x3f) == 0 && ((1L << _la) & 4377498838861086784L) != 0)) {
				{
				setState(385);
				expr(0);
				setState(390);
				_errHandler.sync(this);
				_la = _input.LA(1);
				while (_la==T__9) {
					{
					{
					setState(386);
					match(T__9);
					setState(387);
					expr(0);
					}
					}
					setState(392);
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
		enterRule(_localctx, 46, RULE_ellipsis);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(395);
			match(T__52);
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
		enterRule(_localctx, 48, RULE_functype);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(397);
			match(T__5);
			setState(398);
			params();
			setState(399);
			match(T__6);
			setState(400);
			match(T__8);
			setState(401);
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
		enterRule(_localctx, 50, RULE_constant);
		int _la;
		try {
			setState(407);
			_errHandler.sync(this);
			switch (_input.LA(1)) {
			case T__53:
			case T__54:
				_localctx = new BooleanConstantContext(_localctx);
				enterOuterAlt(_localctx, 1);
				{
				setState(403);
				_la = _input.LA(1);
				if ( !(_la==T__53 || _la==T__54) ) {
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
				setState(404);
				match(UNIT_LITERAL);
				}
				break;
			case NUMBER_LITERAL:
				_localctx = new LiteralConstantContext(_localctx);
				enterOuterAlt(_localctx, 3);
				{
				setState(405);
				match(NUMBER_LITERAL);
				}
				break;
			case STRING_LITERAL:
				_localctx = new StringConstantContext(_localctx);
				enterOuterAlt(_localctx, 4);
				{
				setState(406);
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
	public static class StructUnionFieldsContext extends StructcontentContext {
		public List<StructcontentContext> structcontent() {
			return getRuleContexts(StructcontentContext.class);
		}
		public StructcontentContext structcontent(int i) {
			return getRuleContext(StructcontentContext.class,i);
		}
		public StructUnionFieldsContext(StructcontentContext ctx) { copyFrom(ctx); }
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
		enterRule(_localctx, 52, RULE_structcontent);
		int _la;
		try {
			setState(435);
			_errHandler.sync(this);
			switch ( getInterpreter().adaptivePredict(_input,50,_ctx) ) {
			case 1:
				_localctx = new StructMemberContext(_localctx);
				enterOuterAlt(_localctx, 1);
				{
				setState(409);
				match(ID);
				setState(410);
				match(T__7);
				setState(411);
				datatype();
				setState(412);
				match(T__11);
				}
				break;
			case 2:
				_localctx = new StructMethodContext(_localctx);
				enterOuterAlt(_localctx, 2);
				{
				setState(414);
				match(ID);
				setState(415);
				match(T__5);
				setState(416);
				params();
				setState(417);
				match(T__6);
				setState(420);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (_la==T__7) {
					{
					setState(418);
					match(T__7);
					setState(419);
					datatype();
					}
				}

				setState(424);
				_errHandler.sync(this);
				switch (_input.LA(1)) {
				case T__3:
				case T__8:
					{
					setState(422);
					funcbody();
					}
					break;
				case T__11:
					{
					setState(423);
					match(T__11);
					}
					break;
				default:
					throw new NoViableAltException(this);
				}
				}
				break;
			case 3:
				_localctx = new StructUnionFieldsContext(_localctx);
				enterOuterAlt(_localctx, 3);
				{
				setState(426);
				match(T__55);
				setState(427);
				match(T__3);
				setState(431);
				_errHandler.sync(this);
				_la = _input.LA(1);
				while (_la==T__55 || _la==ID) {
					{
					{
					setState(428);
					structcontent();
					}
					}
					setState(433);
					_errHandler.sync(this);
					_la = _input.LA(1);
				}
				setState(434);
				match(T__4);
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
		public Token export;
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
		enterRule(_localctx, 54, RULE_structdecl);
		int _la;
		try {
			_localctx = new StructDeclContext(_localctx);
			enterOuterAlt(_localctx, 1);
			{
			setState(438);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (_la==T__0) {
				{
				setState(437);
				((StructDeclContext)_localctx).export = match(T__0);
				}
			}

			setState(442);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (_la==T__12) {
				{
				setState(440);
				match(T__12);
				setState(441);
				externlang();
				}
			}

			setState(444);
			match(T__56);
			setState(445);
			match(ID);
			setState(456);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (_la==T__33) {
				{
				setState(446);
				match(T__33);
				setState(447);
				match(ID);
				setState(452);
				_errHandler.sync(this);
				_la = _input.LA(1);
				while (_la==T__9) {
					{
					{
					setState(448);
					match(T__9);
					setState(449);
					match(ID);
					}
					}
					setState(454);
					_errHandler.sync(this);
					_la = _input.LA(1);
				}
				setState(455);
				match(T__34);
				}
			}

			setState(458);
			match(T__3);
			setState(462);
			_errHandler.sync(this);
			_la = _input.LA(1);
			while (_la==T__55 || _la==ID) {
				{
				{
				setState(459);
				structcontent();
				}
				}
				setState(464);
				_errHandler.sync(this);
				_la = _input.LA(1);
			}
			setState(465);
			match(T__4);
			setState(467);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (_la==T__11) {
				{
				setState(466);
				match(T__11);
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
		public List<DatatypeimplContext> datatypeimpl() {
			return getRuleContexts(DatatypeimplContext.class);
		}
		public DatatypeimplContext datatypeimpl(int i) {
			return getRuleContext(DatatypeimplContext.class,i);
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
		enterRule(_localctx, 56, RULE_datatype);
		try {
			int _alt;
			setState(478);
			_errHandler.sync(this);
			switch (_input.LA(1)) {
			case ID:
				_localctx = new CommonDatatypeContext(_localctx);
				enterOuterAlt(_localctx, 1);
				{
				setState(469);
				datatypeimpl();
				setState(474);
				_errHandler.sync(this);
				_alt = getInterpreter().adaptivePredict(_input,57,_ctx);
				while ( _alt!=2 && _alt!=org.antlr.v4.runtime.atn.ATN.INVALID_ALT_NUMBER ) {
					if ( _alt==1 ) {
						{
						{
						setState(470);
						match(T__2);
						setState(471);
						datatypeimpl();
						}
						} 
					}
					setState(476);
					_errHandler.sync(this);
					_alt = getInterpreter().adaptivePredict(_input,57,_ctx);
				}
				}
				break;
			case T__5:
				_localctx = new FunctionDatatypeContext(_localctx);
				enterOuterAlt(_localctx, 2);
				{
				setState(477);
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

	@SuppressWarnings("CheckReturnValue")
	public static class DatatypeimplContext extends ParserRuleContext {
		public GenericsvalueContext genericsvalue;
		public List<GenericsvalueContext> generics = new ArrayList<GenericsvalueContext>();
		public TerminalNode ID() { return getToken(HazeParser.ID, 0); }
		public List<GenericsvalueContext> genericsvalue() {
			return getRuleContexts(GenericsvalueContext.class);
		}
		public GenericsvalueContext genericsvalue(int i) {
			return getRuleContext(GenericsvalueContext.class,i);
		}
		public DatatypeimplContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_datatypeimpl; }
	}

	public final DatatypeimplContext datatypeimpl() throws RecognitionException {
		DatatypeimplContext _localctx = new DatatypeimplContext(_ctx, getState());
		enterRule(_localctx, 58, RULE_datatypeimpl);
		int _la;
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(480);
			match(ID);
			setState(492);
			_errHandler.sync(this);
			switch ( getInterpreter().adaptivePredict(_input,60,_ctx) ) {
			case 1:
				{
				setState(481);
				match(T__33);
				setState(482);
				((DatatypeimplContext)_localctx).genericsvalue = genericsvalue();
				((DatatypeimplContext)_localctx).generics.add(((DatatypeimplContext)_localctx).genericsvalue);
				setState(487);
				_errHandler.sync(this);
				_la = _input.LA(1);
				while (_la==T__9) {
					{
					{
					setState(483);
					match(T__9);
					setState(484);
					((DatatypeimplContext)_localctx).genericsvalue = genericsvalue();
					((DatatypeimplContext)_localctx).generics.add(((DatatypeimplContext)_localctx).genericsvalue);
					}
					}
					setState(489);
					_errHandler.sync(this);
					_la = _input.LA(1);
				}
				setState(490);
				match(T__34);
				}
				break;
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
	public static class GenericsvalueContext extends ParserRuleContext {
		public DatatypeContext datatype() {
			return getRuleContext(DatatypeContext.class,0);
		}
		public ConstantContext constant() {
			return getRuleContext(ConstantContext.class,0);
		}
		public GenericsvalueContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_genericsvalue; }
	}

	public final GenericsvalueContext genericsvalue() throws RecognitionException {
		GenericsvalueContext _localctx = new GenericsvalueContext(_ctx, getState());
		enterRule(_localctx, 60, RULE_genericsvalue);
		try {
			setState(496);
			_errHandler.sync(this);
			switch (_input.LA(1)) {
			case T__5:
			case ID:
				enterOuterAlt(_localctx, 1);
				{
				setState(494);
				datatype();
				}
				break;
			case T__53:
			case T__54:
			case STRING_LITERAL:
			case UNIT_LITERAL:
			case NUMBER_LITERAL:
				enterOuterAlt(_localctx, 2);
				{
				setState(495);
				constant();
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
		case 21:
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
		"\u0004\u0001?\u01f3\u0002\u0000\u0007\u0000\u0002\u0001\u0007\u0001\u0002"+
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
		"\u0001\u0001\u0001\u0001\u0001\u0001\u0005\u0001O\b\u0001\n\u0001\f\u0001"+
		"R\t\u0001\u0001\u0002\u0003\u0002U\b\u0002\u0001\u0002\u0001\u0002\u0001"+
		"\u0002\u0001\u0002\u0005\u0002[\b\u0002\n\u0002\f\u0002^\t\u0002\u0001"+
		"\u0002\u0001\u0002\u0001\u0002\u0001\u0002\u0001\u0003\u0003\u0003e\b"+
		"\u0003\u0001\u0003\u0001\u0003\u0001\u0003\u0001\u0003\u0001\u0003\u0001"+
		"\u0003\u0003\u0003m\b\u0003\u0001\u0003\u0001\u0003\u0001\u0004\u0001"+
		"\u0004\u0001\u0004\u0001\u0004\u0001\u0004\u0003\u0004v\b\u0004\u0001"+
		"\u0004\u0001\u0004\u0001\u0005\u0003\u0005{\b\u0005\u0001\u0005\u0001"+
		"\u0005\u0001\u0005\u0001\u0005\u0001\u0005\u0001\u0005\u0003\u0005\u0083"+
		"\b\u0005\u0001\u0006\u0005\u0006\u0086\b\u0006\n\u0006\f\u0006\u0089\t"+
		"\u0006\u0001\u0007\u0001\u0007\u0001\u0007\u0001\u0007\u0001\b\u0001\b"+
		"\u0001\b\u0005\b\u0092\b\b\n\b\f\b\u0095\t\b\u0001\b\u0001\b\u0003\b\u0099"+
		"\b\b\u0003\b\u009b\b\b\u0001\b\u0003\b\u009e\b\b\u0001\t\u0001\t\u0001"+
		"\t\u0001\t\u0001\n\u0003\n\u00a5\b\n\u0001\n\u0001\n\u0003\n\u00a9\b\n"+
		"\u0003\n\u00ab\b\n\u0001\n\u0001\n\u0005\n\u00af\b\n\n\n\f\n\u00b2\t\n"+
		"\u0001\n\u0001\n\u0001\n\u0001\n\u0001\n\u0001\n\u0003\n\u00ba\b\n\u0001"+
		"\n\u0001\n\u0001\u000b\u0001\u000b\u0001\f\u0001\f\u0001\r\u0001\r\u0001"+
		"\u000e\u0001\u000e\u0001\u000f\u0001\u000f\u0001\u0010\u0001\u0010\u0001"+
		"\u0011\u0001\u0011\u0001\u0012\u0003\u0012\u00cd\b\u0012\u0001\u0012\u0001"+
		"\u0012\u0003\u0012\u00d1\b\u0012\u0003\u0012\u00d3\b\u0012\u0001\u0012"+
		"\u0001\u0012\u0001\u0012\u0001\u0012\u0003\u0012\u00d9\b\u0012\u0001\u0012"+
		"\u0001\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0003\u0012\u00e0\b\u0012"+
		"\u0001\u0012\u0001\u0012\u0003\u0012\u00e4\b\u0012\u0003\u0012\u00e6\b"+
		"\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001\u0012\u0001"+
		"\u0012\u0001\u0012\u0003\u0012\u00ef\b\u0012\u0001\u0013\u0001\u0013\u0001"+
		"\u0013\u0001\u0013\u0001\u0013\u0001\u0013\u0001\u0013\u0001\u0013\u0001"+
		"\u0013\u0001\u0013\u0003\u0013\u00fb\b\u0013\u0001\u0013\u0001\u0013\u0001"+
		"\u0013\u0001\u0013\u0001\u0013\u0001\u0013\u0001\u0013\u0001\u0013\u0001"+
		"\u0013\u0001\u0013\u0001\u0013\u0001\u0013\u0001\u0013\u0001\u0013\u0005"+
		"\u0013\u010b\b\u0013\n\u0013\f\u0013\u010e\t\u0013\u0001\u0013\u0001\u0013"+
		"\u0001\u0013\u0001\u0013\u0001\u0013\u0003\u0013\u0115\b\u0013\u0001\u0013"+
		"\u0001\u0013\u0001\u0013\u0001\u0013\u0001\u0013\u0001\u0013\u0003\u0013"+
		"\u011d\b\u0013\u0001\u0014\u0001\u0014\u0001\u0014\u0001\u0014\u0001\u0014"+
		"\u0001\u0015\u0001\u0015\u0001\u0015\u0001\u0015\u0001\u0015\u0001\u0015"+
		"\u0001\u0015\u0001\u0015\u0001\u0015\u0001\u0015\u0003\u0015\u012e\b\u0015"+
		"\u0001\u0015\u0001\u0015\u0005\u0015\u0132\b\u0015\n\u0015\f\u0015\u0135"+
		"\t\u0015\u0001\u0015\u0003\u0015\u0138\b\u0015\u0001\u0015\u0001\u0015"+
		"\u0001\u0015\u0001\u0015\u0001\u0015\u0001\u0015\u0001\u0015\u0001\u0015"+
		"\u0001\u0015\u0001\u0015\u0001\u0015\u0001\u0015\u0003\u0015\u0146\b\u0015"+
		"\u0001\u0015\u0001\u0015\u0001\u0015\u0003\u0015\u014b\b\u0015\u0005\u0015"+
		"\u014d\b\u0015\n\u0015\f\u0015\u0150\t\u0015\u0001\u0015\u0001\u0015\u0003"+
		"\u0015\u0154\b\u0015\u0003\u0015\u0156\b\u0015\u0001\u0015\u0001\u0015"+
		"\u0001\u0015\u0001\u0015\u0001\u0015\u0001\u0015\u0001\u0015\u0001\u0015"+
		"\u0001\u0015\u0001\u0015\u0001\u0015\u0001\u0015\u0001\u0015\u0001\u0015"+
		"\u0001\u0015\u0003\u0015\u0167\b\u0015\u0001\u0015\u0001\u0015\u0001\u0015"+
		"\u0001\u0015\u0001\u0015\u0001\u0015\u0001\u0015\u0001\u0015\u0001\u0015"+
		"\u0001\u0015\u0001\u0015\u0001\u0015\u0001\u0015\u0001\u0015\u0001\u0015"+
		"\u0001\u0015\u0001\u0015\u0001\u0015\u0001\u0015\u0001\u0015\u0005\u0015"+
		"\u017d\b\u0015\n\u0015\f\u0015\u0180\t\u0015\u0001\u0016\u0001\u0016\u0001"+
		"\u0016\u0005\u0016\u0185\b\u0016\n\u0016\f\u0016\u0188\t\u0016\u0003\u0016"+
		"\u018a\b\u0016\u0001\u0017\u0001\u0017\u0001\u0018\u0001\u0018\u0001\u0018"+
		"\u0001\u0018\u0001\u0018\u0001\u0018\u0001\u0019\u0001\u0019\u0001\u0019"+
		"\u0001\u0019\u0003\u0019\u0198\b\u0019\u0001\u001a\u0001\u001a\u0001\u001a"+
		"\u0001\u001a\u0001\u001a\u0001\u001a\u0001\u001a\u0001\u001a\u0001\u001a"+
		"\u0001\u001a\u0001\u001a\u0003\u001a\u01a5\b\u001a\u0001\u001a\u0001\u001a"+
		"\u0003\u001a\u01a9\b\u001a\u0001\u001a\u0001\u001a\u0001\u001a\u0005\u001a"+
		"\u01ae\b\u001a\n\u001a\f\u001a\u01b1\t\u001a\u0001\u001a\u0003\u001a\u01b4"+
		"\b\u001a\u0001\u001b\u0003\u001b\u01b7\b\u001b\u0001\u001b\u0001\u001b"+
		"\u0003\u001b\u01bb\b\u001b\u0001\u001b\u0001\u001b\u0001\u001b\u0001\u001b"+
		"\u0001\u001b\u0001\u001b\u0005\u001b\u01c3\b\u001b\n\u001b\f\u001b\u01c6"+
		"\t\u001b\u0001\u001b\u0003\u001b\u01c9\b\u001b\u0001\u001b\u0001\u001b"+
		"\u0005\u001b\u01cd\b\u001b\n\u001b\f\u001b\u01d0\t\u001b\u0001\u001b\u0001"+
		"\u001b\u0003\u001b\u01d4\b\u001b\u0001\u001c\u0001\u001c\u0001\u001c\u0005"+
		"\u001c\u01d9\b\u001c\n\u001c\f\u001c\u01dc\t\u001c\u0001\u001c\u0003\u001c"+
		"\u01df\b\u001c\u0001\u001d\u0001\u001d\u0001\u001d\u0001\u001d\u0001\u001d"+
		"\u0005\u001d\u01e6\b\u001d\n\u001d\f\u001d\u01e9\t\u001d\u0001\u001d\u0001"+
		"\u001d\u0003\u001d\u01ed\b\u001d\u0001\u001e\u0001\u001e\u0003\u001e\u01f1"+
		"\b\u001e\u0001\u001e\u0000\u0001*\u001f\u0000\u0002\u0004\u0006\b\n\f"+
		"\u000e\u0010\u0012\u0014\u0016\u0018\u001a\u001c\u001e \"$&(*,.02468:"+
		"<\u0000\n\u0001\u0000\u000e\u000f\u0001\u0000\u0010\u0011\u0001\u0000"+
		"\u0018\u0019\u0001\u0000\u001a\u001b\u0001\u0000\u001c\u001d\u0001\u0000"+
		"\u001f!\u0001\u0000\"%\u0001\u0000)*\u0002\u0000\u0012\u0012+4\u0001\u0000"+
		"67\u022f\u0000F\u0001\u0000\u0000\u0000\u0002P\u0001\u0000\u0000\u0000"+
		"\u0004T\u0001\u0000\u0000\u0000\u0006d\u0001\u0000\u0000\u0000\bp\u0001"+
		"\u0000\u0000\u0000\n\u0082\u0001\u0000\u0000\u0000\f\u0087\u0001\u0000"+
		"\u0000\u0000\u000e\u008a\u0001\u0000\u0000\u0000\u0010\u009d\u0001\u0000"+
		"\u0000\u0000\u0012\u009f\u0001\u0000\u0000\u0000\u0014\u00a4\u0001\u0000"+
		"\u0000\u0000\u0016\u00bd\u0001\u0000\u0000\u0000\u0018\u00bf\u0001\u0000"+
		"\u0000\u0000\u001a\u00c1\u0001\u0000\u0000\u0000\u001c\u00c3\u0001\u0000"+
		"\u0000\u0000\u001e\u00c5\u0001\u0000\u0000\u0000 \u00c7\u0001\u0000\u0000"+
		"\u0000\"\u00c9\u0001\u0000\u0000\u0000$\u00ee\u0001\u0000\u0000\u0000"+
		"&\u011c\u0001\u0000\u0000\u0000(\u011e\u0001\u0000\u0000\u0000*\u0155"+
		"\u0001\u0000\u0000\u0000,\u0189\u0001\u0000\u0000\u0000.\u018b\u0001\u0000"+
		"\u0000\u00000\u018d\u0001\u0000\u0000\u00002\u0197\u0001\u0000\u0000\u0000"+
		"4\u01b3\u0001\u0000\u0000\u00006\u01b6\u0001\u0000\u0000\u00008\u01de"+
		"\u0001\u0000\u0000\u0000:\u01e0\u0001\u0000\u0000\u0000<\u01f0\u0001\u0000"+
		"\u0000\u0000>E\u0003\u0012\t\u0000?E\u0003\u0006\u0003\u0000@E\u0003\u0014"+
		"\n\u0000AE\u00036\u001b\u0000BE\u0003\u0004\u0002\u0000CE\u0003$\u0012"+
		"\u0000D>\u0001\u0000\u0000\u0000D?\u0001\u0000\u0000\u0000D@\u0001\u0000"+
		"\u0000\u0000DA\u0001\u0000\u0000\u0000DB\u0001\u0000\u0000\u0000DC\u0001"+
		"\u0000\u0000\u0000EH\u0001\u0000\u0000\u0000FD\u0001\u0000\u0000\u0000"+
		"FG\u0001\u0000\u0000\u0000G\u0001\u0001\u0000\u0000\u0000HF\u0001\u0000"+
		"\u0000\u0000IO\u0003\u0006\u0003\u0000JO\u0003\u0014\n\u0000KO\u00036"+
		"\u001b\u0000LO\u0003\u0004\u0002\u0000MO\u0003$\u0012\u0000NI\u0001\u0000"+
		"\u0000\u0000NJ\u0001\u0000\u0000\u0000NK\u0001\u0000\u0000\u0000NL\u0001"+
		"\u0000\u0000\u0000NM\u0001\u0000\u0000\u0000OR\u0001\u0000\u0000\u0000"+
		"PN\u0001\u0000\u0000\u0000PQ\u0001\u0000\u0000\u0000Q\u0003\u0001\u0000"+
		"\u0000\u0000RP\u0001\u0000\u0000\u0000SU\u0005\u0001\u0000\u0000TS\u0001"+
		"\u0000\u0000\u0000TU\u0001\u0000\u0000\u0000UV\u0001\u0000\u0000\u0000"+
		"VW\u0005\u0002\u0000\u0000W\\\u0005=\u0000\u0000XY\u0005\u0003\u0000\u0000"+
		"Y[\u0005=\u0000\u0000ZX\u0001\u0000\u0000\u0000[^\u0001\u0000\u0000\u0000"+
		"\\Z\u0001\u0000\u0000\u0000\\]\u0001\u0000\u0000\u0000]_\u0001\u0000\u0000"+
		"\u0000^\\\u0001\u0000\u0000\u0000_`\u0005\u0004\u0000\u0000`a\u0003\u0002"+
		"\u0001\u0000ab\u0005\u0005\u0000\u0000b\u0005\u0001\u0000\u0000\u0000"+
		"ce\u0005\u0001\u0000\u0000dc\u0001\u0000\u0000\u0000de\u0001\u0000\u0000"+
		"\u0000ef\u0001\u0000\u0000\u0000fg\u0005=\u0000\u0000gh\u0005\u0006\u0000"+
		"\u0000hi\u0003\u0010\b\u0000il\u0005\u0007\u0000\u0000jk\u0005\b\u0000"+
		"\u0000km\u00038\u001c\u0000lj\u0001\u0000\u0000\u0000lm\u0001\u0000\u0000"+
		"\u0000mn\u0001\u0000\u0000\u0000no\u0003\n\u0005\u0000o\u0007\u0001\u0000"+
		"\u0000\u0000pq\u0005\u0006\u0000\u0000qr\u0003\u0010\b\u0000ru\u0005\u0007"+
		"\u0000\u0000st\u0005\b\u0000\u0000tv\u00038\u001c\u0000us\u0001\u0000"+
		"\u0000\u0000uv\u0001\u0000\u0000\u0000vw\u0001\u0000\u0000\u0000wx\u0003"+
		"\n\u0005\u0000x\t\u0001\u0000\u0000\u0000y{\u0005\t\u0000\u0000zy\u0001"+
		"\u0000\u0000\u0000z{\u0001\u0000\u0000\u0000{|\u0001\u0000\u0000\u0000"+
		"|}\u0005\u0004\u0000\u0000}~\u0003\f\u0006\u0000~\u007f\u0005\u0005\u0000"+
		"\u0000\u007f\u0083\u0001\u0000\u0000\u0000\u0080\u0081\u0005\t\u0000\u0000"+
		"\u0081\u0083\u0003*\u0015\u0000\u0082z\u0001\u0000\u0000\u0000\u0082\u0080"+
		"\u0001\u0000\u0000\u0000\u0083\u000b\u0001\u0000\u0000\u0000\u0084\u0086"+
		"\u0003&\u0013\u0000\u0085\u0084\u0001\u0000\u0000\u0000\u0086\u0089\u0001"+
		"\u0000\u0000\u0000\u0087\u0085\u0001\u0000\u0000\u0000\u0087\u0088\u0001"+
		"\u0000\u0000\u0000\u0088\r\u0001\u0000\u0000\u0000\u0089\u0087\u0001\u0000"+
		"\u0000\u0000\u008a\u008b\u0005=\u0000\u0000\u008b\u008c\u0005\b\u0000"+
		"\u0000\u008c\u008d\u00038\u001c\u0000\u008d\u000f\u0001\u0000\u0000\u0000"+
		"\u008e\u0093\u0003\u000e\u0007\u0000\u008f\u0090\u0005\n\u0000\u0000\u0090"+
		"\u0092\u0003\u000e\u0007\u0000\u0091\u008f\u0001\u0000\u0000\u0000\u0092"+
		"\u0095\u0001\u0000\u0000\u0000\u0093\u0091\u0001\u0000\u0000\u0000\u0093"+
		"\u0094\u0001\u0000\u0000\u0000\u0094\u0098\u0001\u0000\u0000\u0000\u0095"+
		"\u0093\u0001\u0000\u0000\u0000\u0096\u0097\u0005\n\u0000\u0000\u0097\u0099"+
		"\u0003.\u0017\u0000\u0098\u0096\u0001\u0000\u0000\u0000\u0098\u0099\u0001"+
		"\u0000\u0000\u0000\u0099\u009b\u0001\u0000\u0000\u0000\u009a\u008e\u0001"+
		"\u0000\u0000\u0000\u009a\u009b\u0001\u0000\u0000\u0000\u009b\u009e\u0001"+
		"\u0000\u0000\u0000\u009c\u009e\u0003.\u0017\u0000\u009d\u009a\u0001\u0000"+
		"\u0000\u0000\u009d\u009c\u0001\u0000\u0000\u0000\u009e\u0011\u0001\u0000"+
		"\u0000\u0000\u009f\u00a0\u0005\u000b\u0000\u0000\u00a0\u00a1\u0005:\u0000"+
		"\u0000\u00a1\u00a2\u0005\f\u0000\u0000\u00a2\u0013\u0001\u0000\u0000\u0000"+
		"\u00a3\u00a5\u0005\u0001\u0000\u0000\u00a4\u00a3\u0001\u0000\u0000\u0000"+
		"\u00a4\u00a5\u0001\u0000\u0000\u0000\u00a5\u00aa\u0001\u0000\u0000\u0000"+
		"\u00a6\u00a8\u0005\r\u0000\u0000\u00a7\u00a9\u0003\u0016\u000b\u0000\u00a8"+
		"\u00a7\u0001\u0000\u0000\u0000\u00a8\u00a9\u0001\u0000\u0000\u0000\u00a9"+
		"\u00ab\u0001\u0000\u0000\u0000\u00aa\u00a6\u0001\u0000\u0000\u0000\u00aa"+
		"\u00ab\u0001\u0000\u0000\u0000\u00ab\u00b0\u0001\u0000\u0000\u0000\u00ac"+
		"\u00ad\u0005=\u0000\u0000\u00ad\u00af\u0005\u0003\u0000\u0000\u00ae\u00ac"+
		"\u0001\u0000\u0000\u0000\u00af\u00b2\u0001\u0000\u0000\u0000\u00b0\u00ae"+
		"\u0001\u0000\u0000\u0000\u00b0\u00b1\u0001\u0000\u0000\u0000\u00b1\u00b3"+
		"\u0001\u0000\u0000\u0000\u00b2\u00b0\u0001\u0000\u0000\u0000\u00b3\u00b4"+
		"\u0005=\u0000\u0000\u00b4\u00b5\u0005\u0006\u0000\u0000\u00b5\u00b6\u0003"+
		"\u0010\b\u0000\u00b6\u00b9\u0005\u0007\u0000\u0000\u00b7\u00b8\u0005\b"+
		"\u0000\u0000\u00b8\u00ba\u00038\u001c\u0000\u00b9\u00b7\u0001\u0000\u0000"+
		"\u0000\u00b9\u00ba\u0001\u0000\u0000\u0000\u00ba\u00bb\u0001\u0000\u0000"+
		"\u0000\u00bb\u00bc\u0005\f\u0000\u0000\u00bc\u0015\u0001\u0000\u0000\u0000"+
		"\u00bd\u00be\u0007\u0000\u0000\u0000\u00be\u0017\u0001\u0000\u0000\u0000"+
		"\u00bf\u00c0\u0003*\u0015\u0000\u00c0\u0019\u0001\u0000\u0000\u0000\u00c1"+
		"\u00c2\u0003*\u0015\u0000\u00c2\u001b\u0001\u0000\u0000\u0000\u00c3\u00c4"+
		"\u0003\f\u0006\u0000\u00c4\u001d\u0001\u0000\u0000\u0000\u00c5\u00c6\u0003"+
		"\f\u0006\u0000\u00c6\u001f\u0001\u0000\u0000\u0000\u00c7\u00c8\u0003\f"+
		"\u0006\u0000\u00c8!\u0001\u0000\u0000\u0000\u00c9\u00ca\u0007\u0001\u0000"+
		"\u0000\u00ca#\u0001\u0000\u0000\u0000\u00cb\u00cd\u0005\u0001\u0000\u0000"+
		"\u00cc\u00cb\u0001\u0000\u0000\u0000\u00cc\u00cd\u0001\u0000\u0000\u0000"+
		"\u00cd\u00d2\u0001\u0000\u0000\u0000\u00ce\u00d0\u0005\r\u0000\u0000\u00cf"+
		"\u00d1\u0003\u0016\u000b\u0000\u00d0\u00cf\u0001\u0000\u0000\u0000\u00d0"+
		"\u00d1\u0001\u0000\u0000\u0000\u00d1\u00d3\u0001\u0000\u0000\u0000\u00d2"+
		"\u00ce\u0001\u0000\u0000\u0000\u00d2\u00d3\u0001\u0000\u0000\u0000\u00d3"+
		"\u00d4\u0001\u0000\u0000\u0000\u00d4\u00d5\u0003\"\u0011\u0000\u00d5\u00d8"+
		"\u0005=\u0000\u0000\u00d6\u00d7\u0005\b\u0000\u0000\u00d7\u00d9\u0003"+
		"8\u001c\u0000\u00d8\u00d6\u0001\u0000\u0000\u0000\u00d8\u00d9\u0001\u0000"+
		"\u0000\u0000\u00d9\u00da\u0001\u0000\u0000\u0000\u00da\u00db\u0005\u0012"+
		"\u0000\u0000\u00db\u00dc\u0003*\u0015\u0000\u00dc\u00dd\u0005\f\u0000"+
		"\u0000\u00dd\u00ef\u0001\u0000\u0000\u0000\u00de\u00e0\u0005\u0001\u0000"+
		"\u0000\u00df\u00de\u0001\u0000\u0000\u0000\u00df\u00e0\u0001\u0000\u0000"+
		"\u0000\u00e0\u00e5\u0001\u0000\u0000\u0000\u00e1\u00e3\u0005\r\u0000\u0000"+
		"\u00e2\u00e4\u0003\u0016\u000b\u0000\u00e3\u00e2\u0001\u0000\u0000\u0000"+
		"\u00e3\u00e4\u0001\u0000\u0000\u0000\u00e4\u00e6\u0001\u0000\u0000\u0000"+
		"\u00e5\u00e1\u0001\u0000\u0000\u0000\u00e5\u00e6\u0001\u0000\u0000\u0000"+
		"\u00e6\u00e7\u0001\u0000\u0000\u0000\u00e7\u00e8\u0003\"\u0011\u0000\u00e8"+
		"\u00e9\u0005=\u0000\u0000\u00e9\u00ea\u0005\b\u0000\u0000\u00ea\u00eb"+
		"\u00038\u001c\u0000\u00eb\u00ec\u0001\u0000\u0000\u0000\u00ec\u00ed\u0005"+
		"\f\u0000\u0000\u00ed\u00ef\u0001\u0000\u0000\u0000\u00ee\u00cc\u0001\u0000"+
		"\u0000\u0000\u00ee\u00df\u0001\u0000\u0000\u0000\u00ef%\u0001\u0000\u0000"+
		"\u0000\u00f0\u00f1\u0005\u0013\u0000\u0000\u00f1\u00f2\u0005\u0006\u0000"+
		"\u0000\u00f2\u00f3\u0005:\u0000\u0000\u00f3\u00f4\u0005\u0007\u0000\u0000"+
		"\u00f4\u011d\u0005\f\u0000\u0000\u00f5\u00f6\u0003*\u0015\u0000\u00f6"+
		"\u00f7\u0005\f\u0000\u0000\u00f7\u011d\u0001\u0000\u0000\u0000\u00f8\u00fa"+
		"\u0005\u0014\u0000\u0000\u00f9\u00fb\u0003*\u0015\u0000\u00fa\u00f9\u0001"+
		"\u0000\u0000\u0000\u00fa\u00fb\u0001\u0000\u0000\u0000\u00fb\u00fc\u0001"+
		"\u0000\u0000\u0000\u00fc\u011d\u0005\f\u0000\u0000\u00fd\u011d\u0003$"+
		"\u0012\u0000\u00fe\u00ff\u0005\u0015\u0000\u0000\u00ff\u0100\u0003\u0018"+
		"\f\u0000\u0100\u0101\u0005\u0004\u0000\u0000\u0101\u0102\u0003\u001c\u000e"+
		"\u0000\u0102\u010c\u0005\u0005\u0000\u0000\u0103\u0104\u0005\u0016\u0000"+
		"\u0000\u0104\u0105\u0005\u0015\u0000\u0000\u0105\u0106\u0003\u001a\r\u0000"+
		"\u0106\u0107\u0005\u0004\u0000\u0000\u0107\u0108\u0003\u001e\u000f\u0000"+
		"\u0108\u0109\u0005\u0005\u0000\u0000\u0109\u010b\u0001\u0000\u0000\u0000"+
		"\u010a\u0103\u0001\u0000\u0000\u0000\u010b\u010e\u0001\u0000\u0000\u0000"+
		"\u010c\u010a\u0001\u0000\u0000\u0000\u010c\u010d\u0001\u0000\u0000\u0000"+
		"\u010d\u0114\u0001\u0000\u0000\u0000\u010e\u010c\u0001\u0000\u0000\u0000"+
		"\u010f\u0110\u0005\u0016\u0000\u0000\u0110\u0111\u0005\u0004\u0000\u0000"+
		"\u0111\u0112\u0003 \u0010\u0000\u0112\u0113\u0005\u0005\u0000\u0000\u0113"+
		"\u0115\u0001\u0000\u0000\u0000\u0114\u010f\u0001\u0000\u0000\u0000\u0114"+
		"\u0115\u0001\u0000\u0000\u0000\u0115\u011d\u0001\u0000\u0000\u0000\u0116"+
		"\u0117\u0005\u0017\u0000\u0000\u0117\u0118\u0003*\u0015\u0000\u0118\u0119"+
		"\u0005\u0004\u0000\u0000\u0119\u011a\u0003\f\u0006\u0000\u011a\u011b\u0005"+
		"\u0005\u0000\u0000\u011b\u011d\u0001\u0000\u0000\u0000\u011c\u00f0\u0001"+
		"\u0000\u0000\u0000\u011c\u00f5\u0001\u0000\u0000\u0000\u011c\u00f8\u0001"+
		"\u0000\u0000\u0000\u011c\u00fd\u0001\u0000\u0000\u0000\u011c\u00fe\u0001"+
		"\u0000\u0000\u0000\u011c\u0116\u0001\u0000\u0000\u0000\u011d\'\u0001\u0000"+
		"\u0000\u0000\u011e\u011f\u0005\u0003\u0000\u0000\u011f\u0120\u0005=\u0000"+
		"\u0000\u0120\u0121\u0005\b\u0000\u0000\u0121\u0122\u0003*\u0015\u0000"+
		"\u0122)\u0001\u0000\u0000\u0000\u0123\u0124\u0006\u0015\uffff\uffff\u0000"+
		"\u0124\u0125\u0005\u0006\u0000\u0000\u0125\u0126\u0003*\u0015\u0000\u0126"+
		"\u0127\u0005\u0007\u0000\u0000\u0127\u0156\u0001\u0000\u0000\u0000\u0128"+
		"\u0156\u0003\b\u0004\u0000\u0129\u0156\u00032\u0019\u0000\u012a\u012b"+
		"\u00038\u001c\u0000\u012b\u012d\u0005\u0004\u0000\u0000\u012c\u012e\u0003"+
		"(\u0014\u0000\u012d\u012c\u0001\u0000\u0000\u0000\u012d\u012e\u0001\u0000"+
		"\u0000\u0000\u012e\u0133\u0001\u0000\u0000\u0000\u012f\u0130\u0005\n\u0000"+
		"\u0000\u0130\u0132\u0003(\u0014\u0000\u0131\u012f\u0001\u0000\u0000\u0000"+
		"\u0132\u0135\u0001\u0000\u0000\u0000\u0133\u0131\u0001\u0000\u0000\u0000"+
		"\u0133\u0134\u0001\u0000\u0000\u0000\u0134\u0137\u0001\u0000\u0000\u0000"+
		"\u0135\u0133\u0001\u0000\u0000\u0000\u0136\u0138\u0005\n\u0000\u0000\u0137"+
		"\u0136\u0001\u0000\u0000\u0000\u0137\u0138\u0001\u0000\u0000\u0000\u0138"+
		"\u0139\u0001\u0000\u0000\u0000\u0139\u013a\u0005\u0005\u0000\u0000\u013a"+
		"\u0156\u0001\u0000\u0000\u0000\u013b\u013c\u0007\u0002\u0000\u0000\u013c"+
		"\u0156\u0003*\u0015\u000b\u013d\u013e\u0007\u0003\u0000\u0000\u013e\u0156"+
		"\u0003*\u0015\n\u013f\u0140\u0007\u0004\u0000\u0000\u0140\u0156\u0003"+
		"*\u0015\t\u0141\u0153\u0005=\u0000\u0000\u0142\u0145\u0005\"\u0000\u0000"+
		"\u0143\u0146\u00038\u001c\u0000\u0144\u0146\u00032\u0019\u0000\u0145\u0143"+
		"\u0001\u0000\u0000\u0000\u0145\u0144\u0001\u0000\u0000\u0000\u0146\u014e"+
		"\u0001\u0000\u0000\u0000\u0147\u014a\u0005\n\u0000\u0000\u0148\u014b\u0003"+
		"8\u001c\u0000\u0149\u014b\u00032\u0019\u0000\u014a\u0148\u0001\u0000\u0000"+
		"\u0000\u014a\u0149\u0001\u0000\u0000\u0000\u014b\u014d\u0001\u0000\u0000"+
		"\u0000\u014c\u0147\u0001\u0000\u0000\u0000\u014d\u0150\u0001\u0000\u0000"+
		"\u0000\u014e\u014c\u0001\u0000\u0000\u0000\u014e\u014f\u0001\u0000\u0000"+
		"\u0000\u014f\u0151\u0001\u0000\u0000\u0000\u0150\u014e\u0001\u0000\u0000"+
		"\u0000\u0151\u0152\u0005#\u0000\u0000\u0152\u0154\u0001\u0000\u0000\u0000"+
		"\u0153\u0142\u0001\u0000\u0000\u0000\u0153\u0154\u0001\u0000\u0000\u0000"+
		"\u0154\u0156\u0001\u0000\u0000\u0000\u0155\u0123\u0001\u0000\u0000\u0000"+
		"\u0155\u0128\u0001\u0000\u0000\u0000\u0155\u0129\u0001\u0000\u0000\u0000"+
		"\u0155\u012a\u0001\u0000\u0000\u0000\u0155\u013b\u0001\u0000\u0000\u0000"+
		"\u0155\u013d\u0001\u0000\u0000\u0000\u0155\u013f\u0001\u0000\u0000\u0000"+
		"\u0155\u0141\u0001\u0000\u0000\u0000\u0156\u017e\u0001\u0000\u0000\u0000"+
		"\u0157\u0158\n\u0007\u0000\u0000\u0158\u0159\u0007\u0005\u0000\u0000\u0159"+
		"\u017d\u0003*\u0015\b\u015a\u015b\n\u0006\u0000\u0000\u015b\u015c\u0007"+
		"\u0003\u0000\u0000\u015c\u017d\u0003*\u0015\u0007\u015d\u015e\n\u0005"+
		"\u0000\u0000\u015e\u015f\u0007\u0006\u0000\u0000\u015f\u017d\u0003*\u0015"+
		"\u0006\u0160\u0166\n\u0004\u0000\u0000\u0161\u0167\u0005&\u0000\u0000"+
		"\u0162\u0167\u0005\'\u0000\u0000\u0163\u0167\u0005(\u0000\u0000\u0164"+
		"\u0165\u0005(\u0000\u0000\u0165\u0167\u0005\u001c\u0000\u0000\u0166\u0161"+
		"\u0001\u0000\u0000\u0000\u0166\u0162\u0001\u0000\u0000\u0000\u0166\u0163"+
		"\u0001\u0000\u0000\u0000\u0166\u0164\u0001\u0000\u0000\u0000\u0167\u0168"+
		"\u0001\u0000\u0000\u0000\u0168\u017d\u0003*\u0015\u0005\u0169\u016a\n"+
		"\u0003\u0000\u0000\u016a\u016b\u0007\u0007\u0000\u0000\u016b\u017d\u0003"+
		"*\u0015\u0004\u016c\u016d\n\u0002\u0000\u0000\u016d\u016e\u0007\b\u0000"+
		"\u0000\u016e\u017d\u0003*\u0015\u0003\u016f\u0170\n\u000f\u0000\u0000"+
		"\u0170\u017d\u0007\u0002\u0000\u0000\u0171\u0172\n\u000e\u0000\u0000\u0172"+
		"\u0173\u0005\u0006\u0000\u0000\u0173\u0174\u0003,\u0016\u0000\u0174\u0175"+
		"\u0005\u0007\u0000\u0000\u0175\u017d\u0001\u0000\u0000\u0000\u0176\u0177"+
		"\n\r\u0000\u0000\u0177\u0178\u0005\u0003\u0000\u0000\u0178\u017d\u0005"+
		"=\u0000\u0000\u0179\u017a\n\b\u0000\u0000\u017a\u017b\u0005\u001e\u0000"+
		"\u0000\u017b\u017d\u00038\u001c\u0000\u017c\u0157\u0001\u0000\u0000\u0000"+
		"\u017c\u015a\u0001\u0000\u0000\u0000\u017c\u015d\u0001\u0000\u0000\u0000"+
		"\u017c\u0160\u0001\u0000\u0000\u0000\u017c\u0169\u0001\u0000\u0000\u0000"+
		"\u017c\u016c\u0001\u0000\u0000\u0000\u017c\u016f\u0001\u0000\u0000\u0000"+
		"\u017c\u0171\u0001\u0000\u0000\u0000\u017c\u0176\u0001\u0000\u0000\u0000"+
		"\u017c\u0179\u0001\u0000\u0000\u0000\u017d\u0180\u0001\u0000\u0000\u0000"+
		"\u017e\u017c\u0001\u0000\u0000\u0000\u017e\u017f\u0001\u0000\u0000\u0000"+
		"\u017f+\u0001\u0000\u0000\u0000\u0180\u017e\u0001\u0000\u0000\u0000\u0181"+
		"\u0186\u0003*\u0015\u0000\u0182\u0183\u0005\n\u0000\u0000\u0183\u0185"+
		"\u0003*\u0015\u0000\u0184\u0182\u0001\u0000\u0000\u0000\u0185\u0188\u0001"+
		"\u0000\u0000\u0000\u0186\u0184\u0001\u0000\u0000\u0000\u0186\u0187\u0001"+
		"\u0000\u0000\u0000\u0187\u018a\u0001\u0000\u0000\u0000\u0188\u0186\u0001"+
		"\u0000\u0000\u0000\u0189\u0181\u0001\u0000\u0000\u0000\u0189\u018a\u0001"+
		"\u0000\u0000\u0000\u018a-\u0001\u0000\u0000\u0000\u018b\u018c\u00055\u0000"+
		"\u0000\u018c/\u0001\u0000\u0000\u0000\u018d\u018e\u0005\u0006\u0000\u0000"+
		"\u018e\u018f\u0003\u0010\b\u0000\u018f\u0190\u0005\u0007\u0000\u0000\u0190"+
		"\u0191\u0005\t\u0000\u0000\u0191\u0192\u00038\u001c\u0000\u01921\u0001"+
		"\u0000\u0000\u0000\u0193\u0198\u0007\t\u0000\u0000\u0194\u0198\u0005;"+
		"\u0000\u0000\u0195\u0198\u0005<\u0000\u0000\u0196\u0198\u0005:\u0000\u0000"+
		"\u0197\u0193\u0001\u0000\u0000\u0000\u0197\u0194\u0001\u0000\u0000\u0000"+
		"\u0197\u0195\u0001\u0000\u0000\u0000\u0197\u0196\u0001\u0000\u0000\u0000"+
		"\u01983\u0001\u0000\u0000\u0000\u0199\u019a\u0005=\u0000\u0000\u019a\u019b"+
		"\u0005\b\u0000\u0000\u019b\u019c\u00038\u001c\u0000\u019c\u019d\u0005"+
		"\f\u0000\u0000\u019d\u01b4\u0001\u0000\u0000\u0000\u019e\u019f\u0005="+
		"\u0000\u0000\u019f\u01a0\u0005\u0006\u0000\u0000\u01a0\u01a1\u0003\u0010"+
		"\b\u0000\u01a1\u01a4\u0005\u0007\u0000\u0000\u01a2\u01a3\u0005\b\u0000"+
		"\u0000\u01a3\u01a5\u00038\u001c\u0000\u01a4\u01a2\u0001\u0000\u0000\u0000"+
		"\u01a4\u01a5\u0001\u0000\u0000\u0000\u01a5\u01a8\u0001\u0000\u0000\u0000"+
		"\u01a6\u01a9\u0003\n\u0005\u0000\u01a7\u01a9\u0005\f\u0000\u0000\u01a8"+
		"\u01a6\u0001\u0000\u0000\u0000\u01a8\u01a7\u0001\u0000\u0000\u0000\u01a9"+
		"\u01b4\u0001\u0000\u0000\u0000\u01aa\u01ab\u00058\u0000\u0000\u01ab\u01af"+
		"\u0005\u0004\u0000\u0000\u01ac\u01ae\u00034\u001a\u0000\u01ad\u01ac\u0001"+
		"\u0000\u0000\u0000\u01ae\u01b1\u0001\u0000\u0000\u0000\u01af\u01ad\u0001"+
		"\u0000\u0000\u0000\u01af\u01b0\u0001\u0000\u0000\u0000\u01b0\u01b2\u0001"+
		"\u0000\u0000\u0000\u01b1\u01af\u0001\u0000\u0000\u0000\u01b2\u01b4\u0005"+
		"\u0005\u0000\u0000\u01b3\u0199\u0001\u0000\u0000\u0000\u01b3\u019e\u0001"+
		"\u0000\u0000\u0000\u01b3\u01aa\u0001\u0000\u0000\u0000\u01b45\u0001\u0000"+
		"\u0000\u0000\u01b5\u01b7\u0005\u0001\u0000\u0000\u01b6\u01b5\u0001\u0000"+
		"\u0000\u0000\u01b6\u01b7\u0001\u0000\u0000\u0000\u01b7\u01ba\u0001\u0000"+
		"\u0000\u0000\u01b8\u01b9\u0005\r\u0000\u0000\u01b9\u01bb\u0003\u0016\u000b"+
		"\u0000\u01ba\u01b8\u0001\u0000\u0000\u0000\u01ba\u01bb\u0001\u0000\u0000"+
		"\u0000\u01bb\u01bc\u0001\u0000\u0000\u0000\u01bc\u01bd\u00059\u0000\u0000"+
		"\u01bd\u01c8\u0005=\u0000\u0000\u01be\u01bf\u0005\"\u0000\u0000\u01bf"+
		"\u01c4\u0005=\u0000\u0000\u01c0\u01c1\u0005\n\u0000\u0000\u01c1\u01c3"+
		"\u0005=\u0000\u0000\u01c2\u01c0\u0001\u0000\u0000\u0000\u01c3\u01c6\u0001"+
		"\u0000\u0000\u0000\u01c4\u01c2\u0001\u0000\u0000\u0000\u01c4\u01c5\u0001"+
		"\u0000\u0000\u0000\u01c5\u01c7\u0001\u0000\u0000\u0000\u01c6\u01c4\u0001"+
		"\u0000\u0000\u0000\u01c7\u01c9\u0005#\u0000\u0000\u01c8\u01be\u0001\u0000"+
		"\u0000\u0000\u01c8\u01c9\u0001\u0000\u0000\u0000\u01c9\u01ca\u0001\u0000"+
		"\u0000\u0000\u01ca\u01ce\u0005\u0004\u0000\u0000\u01cb\u01cd\u00034\u001a"+
		"\u0000\u01cc\u01cb\u0001\u0000\u0000\u0000\u01cd\u01d0\u0001\u0000\u0000"+
		"\u0000\u01ce\u01cc\u0001\u0000\u0000\u0000\u01ce\u01cf\u0001\u0000\u0000"+
		"\u0000\u01cf\u01d1\u0001\u0000\u0000\u0000\u01d0\u01ce\u0001\u0000\u0000"+
		"\u0000\u01d1\u01d3\u0005\u0005\u0000\u0000\u01d2\u01d4\u0005\f\u0000\u0000"+
		"\u01d3\u01d2\u0001\u0000\u0000\u0000\u01d3\u01d4\u0001\u0000\u0000\u0000"+
		"\u01d47\u0001\u0000\u0000\u0000\u01d5\u01da\u0003:\u001d\u0000\u01d6\u01d7"+
		"\u0005\u0003\u0000\u0000\u01d7\u01d9\u0003:\u001d\u0000\u01d8\u01d6\u0001"+
		"\u0000\u0000\u0000\u01d9\u01dc\u0001\u0000\u0000\u0000\u01da\u01d8\u0001"+
		"\u0000\u0000\u0000\u01da\u01db\u0001\u0000\u0000\u0000\u01db\u01df\u0001"+
		"\u0000\u0000\u0000\u01dc\u01da\u0001\u0000\u0000\u0000\u01dd\u01df\u0003"+
		"0\u0018\u0000\u01de\u01d5\u0001\u0000\u0000\u0000\u01de\u01dd\u0001\u0000"+
		"\u0000\u0000\u01df9\u0001\u0000\u0000\u0000\u01e0\u01ec\u0005=\u0000\u0000"+
		"\u01e1\u01e2\u0005\"\u0000\u0000\u01e2\u01e7\u0003<\u001e\u0000\u01e3"+
		"\u01e4\u0005\n\u0000\u0000\u01e4\u01e6\u0003<\u001e\u0000\u01e5\u01e3"+
		"\u0001\u0000\u0000\u0000\u01e6\u01e9\u0001\u0000\u0000\u0000\u01e7\u01e5"+
		"\u0001\u0000\u0000\u0000\u01e7\u01e8\u0001\u0000\u0000\u0000\u01e8\u01ea"+
		"\u0001\u0000\u0000\u0000\u01e9\u01e7\u0001\u0000\u0000\u0000\u01ea\u01eb"+
		"\u0005#\u0000\u0000\u01eb\u01ed\u0001\u0000\u0000\u0000\u01ec\u01e1\u0001"+
		"\u0000\u0000\u0000\u01ec\u01ed\u0001\u0000\u0000\u0000\u01ed;\u0001\u0000"+
		"\u0000\u0000\u01ee\u01f1\u00038\u001c\u0000\u01ef\u01f1\u00032\u0019\u0000"+
		"\u01f0\u01ee\u0001\u0000\u0000\u0000\u01f0\u01ef\u0001\u0000\u0000\u0000"+
		"\u01f1=\u0001\u0000\u0000\u0000>DFNPT\\dluz\u0082\u0087\u0093\u0098\u009a"+
		"\u009d\u00a4\u00a8\u00aa\u00b0\u00b9\u00cc\u00d0\u00d2\u00d8\u00df\u00e3"+
		"\u00e5\u00ee\u00fa\u010c\u0114\u011c\u012d\u0133\u0137\u0145\u014a\u014e"+
		"\u0153\u0155\u0166\u017c\u017e\u0186\u0189\u0197\u01a4\u01a8\u01af\u01b3"+
		"\u01b6\u01ba\u01c4\u01c8\u01ce\u01d3\u01da\u01de\u01e7\u01ec\u01f0";
	public static final ATN _ATN =
		new ATNDeserializer().deserialize(_serializedATN.toCharArray());
	static {
		_decisionToDFA = new DFA[_ATN.getNumberOfDecisions()];
		for (int i = 0; i < _ATN.getNumberOfDecisions(); i++) {
			_decisionToDFA[i] = new DFA(_ATN.getDecisionState(i), i);
		}
	}
}