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
		T__52=53, T__53=54, T__54=55, T__55=56, T__56=57, T__57=58, T__58=59, 
		T__59=60, STRING_LITERAL=61, UNIT_LITERAL=62, NUMBER_LITERAL=63, ID=64, 
		WS=65, COMMENT=66;
	public static final int
		RULE_prog = 0, RULE_namespacecontent = 1, RULE_namespace = 2, RULE_namedfunc = 3, 
		RULE_func = 4, RULE_funcbody = 5, RULE_body = 6, RULE_param = 7, RULE_params = 8, 
		RULE_cdefinitiondecl = 9, RULE_prebuildcmd = 10, RULE_postbuildcmd = 11, 
		RULE_funcdecl = 12, RULE_externlang = 13, RULE_ifexpr = 14, RULE_elseifexpr = 15, 
		RULE_thenblock = 16, RULE_elseifblock = 17, RULE_elseblock = 18, RULE_variablemutability = 19, 
		RULE_variablestatement = 20, RULE_statement = 21, RULE_structmembervalue = 22, 
		RULE_expr = 23, RULE_args = 24, RULE_ellipsis = 25, RULE_functype = 26, 
		RULE_constant = 27, RULE_compilationhint = 28, RULE_compilationhintfilename = 29, 
		RULE_compilationhintflags = 30, RULE_compilationlang = 31, RULE_linkerhint = 32, 
		RULE_structcontent = 33, RULE_structdecl = 34, RULE_datatype = 35;
	private static String[] makeRuleNames() {
		return new String[] {
			"prog", "namespacecontent", "namespace", "namedfunc", "func", "funcbody", 
			"body", "param", "params", "cdefinitiondecl", "prebuildcmd", "postbuildcmd", 
			"funcdecl", "externlang", "ifexpr", "elseifexpr", "thenblock", "elseifblock", 
			"elseblock", "variablemutability", "variablestatement", "statement", 
			"structmembervalue", "expr", "args", "ellipsis", "functype", "constant", 
			"compilationhint", "compilationhintfilename", "compilationhintflags", 
			"compilationlang", "linkerhint", "structcontent", "structdecl", "datatype"
		};
	}
	public static final String[] ruleNames = makeRuleNames();

	private static String[] makeLiteralNames() {
		return new String[] {
			null, "'namespace'", "'{'", "'}'", "'('", "')'", "':'", "'=>'", "','", 
			"'inject'", "';'", "'prebuildcmd'", "'postbuildcmd'", "'declare'", "'.'", 
			"'\"C\"'", "'\"C++\"'", "'let'", "'const'", "'='", "'__c__'", "'return'", 
			"'if'", "'else'", "'while'", "'++'", "'--'", "'+'", "'-'", "'not'", "'!'", 
			"'as'", "'*'", "'/'", "'%'", "'<'", "'>'", "'<='", "'>='", "'=='", "'!='", 
			"'is'", "'and'", "'or'", "'+='", "'-='", "'*='", "'/='", "'%='", "'<<='", 
			"'>>='", "'&='", "'^='", "'|='", "'...'", "'true'", "'false'", "'#compile'", 
			"'link'", "'unsafe_union'", "'struct'"
		};
	}
	private static final String[] _LITERAL_NAMES = makeLiteralNames();
	private static String[] makeSymbolicNames() {
		return new String[] {
			null, null, null, null, null, null, null, null, null, null, null, null, 
			null, null, null, null, null, null, null, null, null, null, null, null, 
			null, null, null, null, null, null, null, null, null, null, null, null, 
			null, null, null, null, null, null, null, null, null, null, null, null, 
			null, null, null, null, null, null, null, null, null, null, null, null, 
			null, "STRING_LITERAL", "UNIT_LITERAL", "NUMBER_LITERAL", "ID", "WS", 
			"COMMENT"
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
		public List<PrebuildcmdContext> prebuildcmd() {
			return getRuleContexts(PrebuildcmdContext.class);
		}
		public PrebuildcmdContext prebuildcmd(int i) {
			return getRuleContext(PrebuildcmdContext.class,i);
		}
		public List<PostbuildcmdContext> postbuildcmd() {
			return getRuleContexts(PostbuildcmdContext.class);
		}
		public PostbuildcmdContext postbuildcmd(int i) {
			return getRuleContext(PostbuildcmdContext.class,i);
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
			setState(84);
			_errHandler.sync(this);
			_la = _input.LA(1);
			while (((((_la - 1)) & ~0x3f) == 0 && ((1L << (_la - 1)) & -8430738502437364479L) != 0)) {
				{
				setState(82);
				_errHandler.sync(this);
				switch ( getInterpreter().adaptivePredict(_input,0,_ctx) ) {
				case 1:
					{
					setState(72);
					cdefinitiondecl();
					}
					break;
				case 2:
					{
					setState(73);
					prebuildcmd();
					}
					break;
				case 3:
					{
					setState(74);
					postbuildcmd();
					}
					break;
				case 4:
					{
					setState(75);
					namedfunc();
					}
					break;
				case 5:
					{
					setState(76);
					funcdecl();
					}
					break;
				case 6:
					{
					setState(77);
					compilationhint();
					}
					break;
				case 7:
					{
					setState(78);
					linkerhint();
					}
					break;
				case 8:
					{
					setState(79);
					structdecl();
					}
					break;
				case 9:
					{
					setState(80);
					namespace();
					}
					break;
				case 10:
					{
					setState(81);
					variablestatement();
					}
					break;
				}
				}
				setState(86);
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
			setState(96);
			_errHandler.sync(this);
			_la = _input.LA(1);
			while (((((_la - 1)) & ~0x3f) == 0 && ((1L << (_la - 1)) & -8430738502437367807L) != 0)) {
				{
				setState(94);
				_errHandler.sync(this);
				switch ( getInterpreter().adaptivePredict(_input,2,_ctx) ) {
				case 1:
					{
					setState(87);
					namedfunc();
					}
					break;
				case 2:
					{
					setState(88);
					funcdecl();
					}
					break;
				case 3:
					{
					setState(89);
					compilationhint();
					}
					break;
				case 4:
					{
					setState(90);
					linkerhint();
					}
					break;
				case 5:
					{
					setState(91);
					structdecl();
					}
					break;
				case 6:
					{
					setState(92);
					namespace();
					}
					break;
				case 7:
					{
					setState(93);
					variablestatement();
					}
					break;
				}
				}
				setState(98);
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
		public TerminalNode ID() { return getToken(HazeParser.ID, 0); }
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
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(99);
			match(T__0);
			setState(100);
			match(ID);
			setState(101);
			match(T__1);
			setState(102);
			namespacecontent();
			setState(103);
			match(T__2);
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
		enterRule(_localctx, 6, RULE_namedfunc);
		int _la;
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(105);
			match(ID);
			setState(106);
			match(T__3);
			setState(107);
			params();
			setState(108);
			match(T__4);
			setState(111);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (_la==T__5) {
				{
				setState(109);
				match(T__5);
				setState(110);
				datatype();
				}
			}

			setState(113);
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
			setState(115);
			match(T__3);
			setState(116);
			params();
			setState(117);
			match(T__4);
			setState(120);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (_la==T__5) {
				{
				setState(118);
				match(T__5);
				setState(119);
				datatype();
				}
			}

			setState(122);
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
			setState(133);
			_errHandler.sync(this);
			switch ( getInterpreter().adaptivePredict(_input,7,_ctx) ) {
			case 1:
				enterOuterAlt(_localctx, 1);
				{
				setState(125);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (_la==T__6) {
					{
					setState(124);
					match(T__6);
					}
				}

				setState(127);
				match(T__1);
				setState(128);
				body();
				setState(129);
				match(T__2);
				}
				break;
			case 2:
				enterOuterAlt(_localctx, 2);
				{
				setState(131);
				match(T__6);
				setState(132);
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
			setState(138);
			_errHandler.sync(this);
			_la = _input.LA(1);
			while (((((_la - 4)) & ~0x3f) == 0 && ((1L << (_la - 4)) & 2168483220712546305L) != 0)) {
				{
				{
				setState(135);
				statement();
				}
				}
				setState(140);
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
			setState(141);
			match(ID);
			setState(142);
			match(T__5);
			setState(143);
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
			setState(160);
			_errHandler.sync(this);
			switch (_input.LA(1)) {
			case T__4:
			case ID:
				enterOuterAlt(_localctx, 1);
				{
				setState(157);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (_la==ID) {
					{
					setState(145);
					param();
					setState(150);
					_errHandler.sync(this);
					_alt = getInterpreter().adaptivePredict(_input,9,_ctx);
					while ( _alt!=2 && _alt!=org.antlr.v4.runtime.atn.ATN.INVALID_ALT_NUMBER ) {
						if ( _alt==1 ) {
							{
							{
							setState(146);
							match(T__7);
							setState(147);
							param();
							}
							} 
						}
						setState(152);
						_errHandler.sync(this);
						_alt = getInterpreter().adaptivePredict(_input,9,_ctx);
					}
					setState(155);
					_errHandler.sync(this);
					_la = _input.LA(1);
					if (_la==T__7) {
						{
						setState(153);
						match(T__7);
						setState(154);
						ellipsis();
						}
					}

					}
				}

				}
				break;
			case T__53:
				enterOuterAlt(_localctx, 2);
				{
				setState(159);
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
			setState(162);
			match(T__8);
			setState(163);
			match(STRING_LITERAL);
			setState(164);
			match(T__9);
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
	public static class PrebuildcmdContext extends ParserRuleContext {
		public TerminalNode STRING_LITERAL() { return getToken(HazeParser.STRING_LITERAL, 0); }
		public PrebuildcmdContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_prebuildcmd; }
	}

	public final PrebuildcmdContext prebuildcmd() throws RecognitionException {
		PrebuildcmdContext _localctx = new PrebuildcmdContext(_ctx, getState());
		enterRule(_localctx, 20, RULE_prebuildcmd);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(166);
			match(T__10);
			setState(167);
			match(STRING_LITERAL);
			setState(168);
			match(T__9);
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
	public static class PostbuildcmdContext extends ParserRuleContext {
		public TerminalNode STRING_LITERAL() { return getToken(HazeParser.STRING_LITERAL, 0); }
		public PostbuildcmdContext(ParserRuleContext parent, int invokingState) {
			super(parent, invokingState);
		}
		@Override public int getRuleIndex() { return RULE_postbuildcmd; }
	}

	public final PostbuildcmdContext postbuildcmd() throws RecognitionException {
		PostbuildcmdContext _localctx = new PostbuildcmdContext(_ctx, getState());
		enterRule(_localctx, 22, RULE_postbuildcmd);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(170);
			match(T__11);
			setState(171);
			match(STRING_LITERAL);
			setState(172);
			match(T__9);
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
		enterRule(_localctx, 24, RULE_funcdecl);
		int _la;
		try {
			int _alt;
			enterOuterAlt(_localctx, 1);
			{
			setState(174);
			match(T__12);
			setState(176);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (_la==T__14 || _la==T__15) {
				{
				setState(175);
				externlang();
				}
			}

			setState(182);
			_errHandler.sync(this);
			_alt = getInterpreter().adaptivePredict(_input,14,_ctx);
			while ( _alt!=2 && _alt!=org.antlr.v4.runtime.atn.ATN.INVALID_ALT_NUMBER ) {
				if ( _alt==1 ) {
					{
					{
					setState(178);
					match(ID);
					setState(179);
					match(T__13);
					}
					} 
				}
				setState(184);
				_errHandler.sync(this);
				_alt = getInterpreter().adaptivePredict(_input,14,_ctx);
			}
			setState(185);
			match(ID);
			setState(186);
			match(T__3);
			setState(187);
			params();
			setState(188);
			match(T__4);
			setState(191);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (_la==T__5) {
				{
				setState(189);
				match(T__5);
				setState(190);
				datatype();
				}
			}

			setState(193);
			match(T__9);
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
		enterRule(_localctx, 26, RULE_externlang);
		int _la;
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(195);
			_la = _input.LA(1);
			if ( !(_la==T__14 || _la==T__15) ) {
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
		enterRule(_localctx, 28, RULE_ifexpr);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(197);
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
		enterRule(_localctx, 30, RULE_elseifexpr);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(199);
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
		enterRule(_localctx, 32, RULE_thenblock);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(201);
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
		enterRule(_localctx, 34, RULE_elseifblock);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(203);
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
		enterRule(_localctx, 36, RULE_elseblock);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(205);
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
		enterRule(_localctx, 38, RULE_variablemutability);
		int _la;
		try {
			_localctx = new VariableMutabilityContext(_localctx);
			enterOuterAlt(_localctx, 1);
			{
			setState(207);
			_la = _input.LA(1);
			if ( !(_la==T__16 || _la==T__17) ) {
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
		public VariableDefinitionContext(VariablestatementContext ctx) { copyFrom(ctx); }
	}
	@SuppressWarnings("CheckReturnValue")
	public static class VariableDeclarationContext extends VariablestatementContext {
		public VariablemutabilityContext variablemutability() {
			return getRuleContext(VariablemutabilityContext.class,0);
		}
		public TerminalNode ID() { return getToken(HazeParser.ID, 0); }
		public DatatypeContext datatype() {
			return getRuleContext(DatatypeContext.class,0);
		}
		public VariableDeclarationContext(VariablestatementContext ctx) { copyFrom(ctx); }
	}

	public final VariablestatementContext variablestatement() throws RecognitionException {
		VariablestatementContext _localctx = new VariablestatementContext(_ctx, getState());
		enterRule(_localctx, 40, RULE_variablestatement);
		int _la;
		try {
			setState(226);
			_errHandler.sync(this);
			switch ( getInterpreter().adaptivePredict(_input,17,_ctx) ) {
			case 1:
				_localctx = new VariableDefinitionContext(_localctx);
				enterOuterAlt(_localctx, 1);
				{
				setState(209);
				variablemutability();
				setState(210);
				match(ID);
				setState(213);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (_la==T__5) {
					{
					setState(211);
					match(T__5);
					setState(212);
					datatype();
					}
				}

				setState(215);
				match(T__18);
				setState(216);
				expr(0);
				setState(217);
				match(T__9);
				}
				break;
			case 2:
				_localctx = new VariableDeclarationContext(_localctx);
				enterOuterAlt(_localctx, 2);
				{
				setState(219);
				variablemutability();
				setState(220);
				match(ID);
				{
				setState(221);
				match(T__5);
				setState(222);
				datatype();
				}
				setState(224);
				match(T__9);
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
		enterRule(_localctx, 42, RULE_statement);
		int _la;
		try {
			int _alt;
			setState(272);
			_errHandler.sync(this);
			switch (_input.LA(1)) {
			case T__19:
				_localctx = new InlineCStatementContext(_localctx);
				enterOuterAlt(_localctx, 1);
				{
				setState(228);
				match(T__19);
				setState(229);
				match(T__3);
				setState(230);
				match(STRING_LITERAL);
				setState(231);
				match(T__4);
				setState(232);
				match(T__9);
				}
				break;
			case T__3:
			case T__24:
			case T__25:
			case T__26:
			case T__27:
			case T__28:
			case T__29:
			case T__54:
			case T__55:
			case STRING_LITERAL:
			case UNIT_LITERAL:
			case NUMBER_LITERAL:
			case ID:
				_localctx = new ExprStatementContext(_localctx);
				enterOuterAlt(_localctx, 2);
				{
				setState(233);
				expr(0);
				setState(234);
				match(T__9);
				}
				break;
			case T__20:
				_localctx = new ReturnStatementContext(_localctx);
				enterOuterAlt(_localctx, 3);
				{
				setState(236);
				match(T__20);
				setState(238);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (((((_la - 4)) & ~0x3f) == 0 && ((1L << (_la - 4)) & 2168483220711014401L) != 0)) {
					{
					setState(237);
					expr(0);
					}
				}

				setState(240);
				match(T__9);
				}
				break;
			case T__16:
			case T__17:
				_localctx = new VariableStatementContext(_localctx);
				enterOuterAlt(_localctx, 4);
				{
				setState(241);
				variablestatement();
				}
				break;
			case T__21:
				_localctx = new IfStatementContext(_localctx);
				enterOuterAlt(_localctx, 5);
				{
				setState(242);
				match(T__21);
				setState(243);
				ifexpr();
				setState(244);
				match(T__1);
				setState(245);
				thenblock();
				setState(246);
				match(T__2);
				setState(256);
				_errHandler.sync(this);
				_alt = getInterpreter().adaptivePredict(_input,19,_ctx);
				while ( _alt!=2 && _alt!=org.antlr.v4.runtime.atn.ATN.INVALID_ALT_NUMBER ) {
					if ( _alt==1 ) {
						{
						{
						setState(247);
						match(T__22);
						setState(248);
						match(T__21);
						setState(249);
						elseifexpr();
						setState(250);
						match(T__1);
						setState(251);
						elseifblock();
						setState(252);
						match(T__2);
						}
						} 
					}
					setState(258);
					_errHandler.sync(this);
					_alt = getInterpreter().adaptivePredict(_input,19,_ctx);
				}
				setState(264);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (_la==T__22) {
					{
					setState(259);
					match(T__22);
					setState(260);
					match(T__1);
					setState(261);
					elseblock();
					setState(262);
					match(T__2);
					}
				}

				}
				break;
			case T__23:
				_localctx = new WhileStatementContext(_localctx);
				enterOuterAlt(_localctx, 6);
				{
				setState(266);
				match(T__23);
				setState(267);
				expr(0);
				setState(268);
				match(T__1);
				setState(269);
				body();
				setState(270);
				match(T__2);
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
		enterRule(_localctx, 44, RULE_structmembervalue);
		try {
			_localctx = new StructMemberValueContext(_localctx);
			enterOuterAlt(_localctx, 1);
			{
			setState(274);
			match(T__13);
			setState(275);
			match(ID);
			setState(276);
			match(T__5);
			setState(277);
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
		int _startState = 46;
		enterRecursionRule(_localctx, 46, RULE_expr, _p);
		int _la;
		try {
			int _alt;
			enterOuterAlt(_localctx, 1);
			{
			setState(323);
			_errHandler.sync(this);
			switch ( getInterpreter().adaptivePredict(_input,27,_ctx) ) {
			case 1:
				{
				_localctx = new ParenthesisExprContext(_localctx);
				_ctx = _localctx;
				_prevctx = _localctx;

				setState(280);
				match(T__3);
				setState(281);
				expr(0);
				setState(282);
				match(T__4);
				}
				break;
			case 2:
				{
				_localctx = new FuncRefExprContext(_localctx);
				_ctx = _localctx;
				_prevctx = _localctx;
				setState(284);
				func();
				}
				break;
			case 3:
				{
				_localctx = new ConstantExprContext(_localctx);
				_ctx = _localctx;
				_prevctx = _localctx;
				setState(285);
				constant();
				}
				break;
			case 4:
				{
				_localctx = new StructInstantiationExprContext(_localctx);
				_ctx = _localctx;
				_prevctx = _localctx;
				setState(286);
				datatype();
				setState(287);
				match(T__1);
				setState(289);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (_la==T__13) {
					{
					setState(288);
					structmembervalue();
					}
				}

				setState(295);
				_errHandler.sync(this);
				_alt = getInterpreter().adaptivePredict(_input,23,_ctx);
				while ( _alt!=2 && _alt!=org.antlr.v4.runtime.atn.ATN.INVALID_ALT_NUMBER ) {
					if ( _alt==1 ) {
						{
						{
						setState(291);
						match(T__7);
						setState(292);
						structmembervalue();
						}
						} 
					}
					setState(297);
					_errHandler.sync(this);
					_alt = getInterpreter().adaptivePredict(_input,23,_ctx);
				}
				setState(299);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (_la==T__7) {
					{
					setState(298);
					match(T__7);
					}
				}

				setState(301);
				match(T__2);
				}
				break;
			case 5:
				{
				_localctx = new PreIncrExprContext(_localctx);
				_ctx = _localctx;
				_prevctx = _localctx;
				setState(303);
				((PreIncrExprContext)_localctx).op = _input.LT(1);
				_la = _input.LA(1);
				if ( !(_la==T__24 || _la==T__25) ) {
					((PreIncrExprContext)_localctx).op = (Token)_errHandler.recoverInline(this);
				}
				else {
					if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
					_errHandler.reportMatch(this);
					consume();
				}
				setState(304);
				expr(11);
				}
				break;
			case 6:
				{
				_localctx = new UnaryExprContext(_localctx);
				_ctx = _localctx;
				_prevctx = _localctx;
				setState(305);
				((UnaryExprContext)_localctx).op = _input.LT(1);
				_la = _input.LA(1);
				if ( !(_la==T__26 || _la==T__27) ) {
					((UnaryExprContext)_localctx).op = (Token)_errHandler.recoverInline(this);
				}
				else {
					if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
					_errHandler.reportMatch(this);
					consume();
				}
				setState(306);
				expr(10);
				}
				break;
			case 7:
				{
				_localctx = new UnaryExprContext(_localctx);
				_ctx = _localctx;
				_prevctx = _localctx;
				setState(307);
				_la = _input.LA(1);
				if ( !(_la==T__28 || _la==T__29) ) {
				_errHandler.recoverInline(this);
				}
				else {
					if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
					_errHandler.reportMatch(this);
					consume();
				}
				setState(308);
				expr(9);
				}
				break;
			case 8:
				{
				_localctx = new SymbolValueExprContext(_localctx);
				_ctx = _localctx;
				_prevctx = _localctx;
				setState(309);
				match(ID);
				setState(321);
				_errHandler.sync(this);
				switch ( getInterpreter().adaptivePredict(_input,26,_ctx) ) {
				case 1:
					{
					setState(310);
					match(T__34);
					setState(311);
					datatype();
					setState(316);
					_errHandler.sync(this);
					_la = _input.LA(1);
					while (_la==T__7) {
						{
						{
						setState(312);
						match(T__7);
						setState(313);
						datatype();
						}
						}
						setState(318);
						_errHandler.sync(this);
						_la = _input.LA(1);
					}
					setState(319);
					match(T__35);
					}
					break;
				}
				}
				break;
			}
			_ctx.stop = _input.LT(-1);
			setState(364);
			_errHandler.sync(this);
			_alt = getInterpreter().adaptivePredict(_input,30,_ctx);
			while ( _alt!=2 && _alt!=org.antlr.v4.runtime.atn.ATN.INVALID_ALT_NUMBER ) {
				if ( _alt==1 ) {
					if ( _parseListeners!=null ) triggerExitRuleEvent();
					_prevctx = _localctx;
					{
					setState(362);
					_errHandler.sync(this);
					switch ( getInterpreter().adaptivePredict(_input,29,_ctx) ) {
					case 1:
						{
						_localctx = new BinaryExprContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(325);
						if (!(precpred(_ctx, 7))) throw new FailedPredicateException(this, "precpred(_ctx, 7)");
						setState(326);
						_la = _input.LA(1);
						if ( !((((_la) & ~0x3f) == 0 && ((1L << _la) & 30064771072L) != 0)) ) {
						_errHandler.recoverInline(this);
						}
						else {
							if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
							_errHandler.reportMatch(this);
							consume();
						}
						setState(327);
						expr(8);
						}
						break;
					case 2:
						{
						_localctx = new BinaryExprContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(328);
						if (!(precpred(_ctx, 6))) throw new FailedPredicateException(this, "precpred(_ctx, 6)");
						setState(329);
						_la = _input.LA(1);
						if ( !(_la==T__26 || _la==T__27) ) {
						_errHandler.recoverInline(this);
						}
						else {
							if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
							_errHandler.reportMatch(this);
							consume();
						}
						setState(330);
						expr(7);
						}
						break;
					case 3:
						{
						_localctx = new BinaryExprContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(331);
						if (!(precpred(_ctx, 5))) throw new FailedPredicateException(this, "precpred(_ctx, 5)");
						setState(332);
						_la = _input.LA(1);
						if ( !((((_la) & ~0x3f) == 0 && ((1L << _la) & 515396075520L) != 0)) ) {
						_errHandler.recoverInline(this);
						}
						else {
							if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
							_errHandler.reportMatch(this);
							consume();
						}
						setState(333);
						expr(6);
						}
						break;
					case 4:
						{
						_localctx = new BinaryExprContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(334);
						if (!(precpred(_ctx, 4))) throw new FailedPredicateException(this, "precpred(_ctx, 4)");
						setState(340);
						_errHandler.sync(this);
						switch ( getInterpreter().adaptivePredict(_input,28,_ctx) ) {
						case 1:
							{
							setState(335);
							match(T__38);
							}
							break;
						case 2:
							{
							setState(336);
							match(T__39);
							}
							break;
						case 3:
							{
							setState(337);
							match(T__40);
							}
							break;
						case 4:
							{
							{
							setState(338);
							match(T__40);
							setState(339);
							match(T__28);
							}
							}
							break;
						}
						setState(342);
						expr(5);
						}
						break;
					case 5:
						{
						_localctx = new BinaryExprContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(343);
						if (!(precpred(_ctx, 3))) throw new FailedPredicateException(this, "precpred(_ctx, 3)");
						setState(344);
						_la = _input.LA(1);
						if ( !(_la==T__41 || _la==T__42) ) {
						_errHandler.recoverInline(this);
						}
						else {
							if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
							_errHandler.reportMatch(this);
							consume();
						}
						setState(345);
						expr(4);
						}
						break;
					case 6:
						{
						_localctx = new ExprAssignmentExprContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(346);
						if (!(precpred(_ctx, 2))) throw new FailedPredicateException(this, "precpred(_ctx, 2)");
						setState(347);
						((ExprAssignmentExprContext)_localctx).op = _input.LT(1);
						_la = _input.LA(1);
						if ( !((((_la) & ~0x3f) == 0 && ((1L << _la) & 17996806323961856L) != 0)) ) {
							((ExprAssignmentExprContext)_localctx).op = (Token)_errHandler.recoverInline(this);
						}
						else {
							if ( _input.LA(1)==Token.EOF ) matchedEOF = true;
							_errHandler.reportMatch(this);
							consume();
						}
						setState(348);
						expr(3);
						}
						break;
					case 7:
						{
						_localctx = new PostIncrExprContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(349);
						if (!(precpred(_ctx, 15))) throw new FailedPredicateException(this, "precpred(_ctx, 15)");
						setState(350);
						((PostIncrExprContext)_localctx).op = _input.LT(1);
						_la = _input.LA(1);
						if ( !(_la==T__24 || _la==T__25) ) {
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
						setState(351);
						if (!(precpred(_ctx, 14))) throw new FailedPredicateException(this, "precpred(_ctx, 14)");
						setState(352);
						match(T__3);
						setState(353);
						args();
						setState(354);
						match(T__4);
						}
						break;
					case 9:
						{
						_localctx = new ExprMemberAccessContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(356);
						if (!(precpred(_ctx, 13))) throw new FailedPredicateException(this, "precpred(_ctx, 13)");
						setState(357);
						match(T__13);
						setState(358);
						match(ID);
						}
						break;
					case 10:
						{
						_localctx = new ExplicitCastExprContext(new ExprContext(_parentctx, _parentState));
						pushNewRecursionContext(_localctx, _startState, RULE_expr);
						setState(359);
						if (!(precpred(_ctx, 8))) throw new FailedPredicateException(this, "precpred(_ctx, 8)");
						setState(360);
						match(T__30);
						setState(361);
						datatype();
						}
						break;
					}
					} 
				}
				setState(366);
				_errHandler.sync(this);
				_alt = getInterpreter().adaptivePredict(_input,30,_ctx);
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
		enterRule(_localctx, 48, RULE_args);
		int _la;
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(375);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (((((_la - 4)) & ~0x3f) == 0 && ((1L << (_la - 4)) & 2168483220711014401L) != 0)) {
				{
				setState(367);
				expr(0);
				setState(372);
				_errHandler.sync(this);
				_la = _input.LA(1);
				while (_la==T__7) {
					{
					{
					setState(368);
					match(T__7);
					setState(369);
					expr(0);
					}
					}
					setState(374);
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
		enterRule(_localctx, 50, RULE_ellipsis);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(377);
			match(T__53);
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
		enterRule(_localctx, 52, RULE_functype);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(379);
			match(T__3);
			setState(380);
			params();
			setState(381);
			match(T__4);
			setState(382);
			match(T__6);
			setState(383);
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
		enterRule(_localctx, 54, RULE_constant);
		int _la;
		try {
			setState(389);
			_errHandler.sync(this);
			switch (_input.LA(1)) {
			case T__54:
			case T__55:
				_localctx = new BooleanConstantContext(_localctx);
				enterOuterAlt(_localctx, 1);
				{
				setState(385);
				_la = _input.LA(1);
				if ( !(_la==T__54 || _la==T__55) ) {
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
				setState(386);
				match(UNIT_LITERAL);
				}
				break;
			case NUMBER_LITERAL:
				_localctx = new LiteralConstantContext(_localctx);
				enterOuterAlt(_localctx, 3);
				{
				setState(387);
				match(NUMBER_LITERAL);
				}
				break;
			case STRING_LITERAL:
				_localctx = new StringConstantContext(_localctx);
				enterOuterAlt(_localctx, 4);
				{
				setState(388);
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
		enterRule(_localctx, 56, RULE_compilationhint);
		int _la;
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(391);
			match(T__56);
			setState(392);
			compilationlang();
			setState(393);
			compilationhintfilename();
			setState(395);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (_la==STRING_LITERAL) {
				{
				setState(394);
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
		enterRule(_localctx, 58, RULE_compilationhintfilename);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(397);
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
		enterRule(_localctx, 60, RULE_compilationhintflags);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(399);
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
		enterRule(_localctx, 62, RULE_compilationlang);
		int _la;
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(401);
			_la = _input.LA(1);
			if ( !(_la==T__14 || _la==T__15) ) {
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
		enterRule(_localctx, 64, RULE_linkerhint);
		try {
			enterOuterAlt(_localctx, 1);
			{
			setState(403);
			match(T__57);
			setState(404);
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
		enterRule(_localctx, 66, RULE_structcontent);
		int _la;
		try {
			setState(430);
			_errHandler.sync(this);
			switch ( getInterpreter().adaptivePredict(_input,37,_ctx) ) {
			case 1:
				_localctx = new StructMemberContext(_localctx);
				enterOuterAlt(_localctx, 1);
				{
				setState(406);
				match(ID);
				setState(407);
				match(T__5);
				setState(408);
				datatype();
				setState(409);
				match(T__9);
				}
				break;
			case 2:
				_localctx = new StructMethodContext(_localctx);
				enterOuterAlt(_localctx, 2);
				{
				setState(411);
				match(ID);
				setState(412);
				match(T__3);
				setState(413);
				params();
				setState(414);
				match(T__4);
				setState(417);
				_errHandler.sync(this);
				_la = _input.LA(1);
				if (_la==T__5) {
					{
					setState(415);
					match(T__5);
					setState(416);
					datatype();
					}
				}

				setState(419);
				funcbody();
				}
				break;
			case 3:
				_localctx = new StructUnionFieldsContext(_localctx);
				enterOuterAlt(_localctx, 3);
				{
				setState(421);
				match(T__58);
				setState(422);
				match(T__1);
				setState(426);
				_errHandler.sync(this);
				_la = _input.LA(1);
				while (_la==T__58 || _la==ID) {
					{
					{
					setState(423);
					structcontent();
					}
					}
					setState(428);
					_errHandler.sync(this);
					_la = _input.LA(1);
				}
				setState(429);
				match(T__2);
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
		enterRule(_localctx, 68, RULE_structdecl);
		int _la;
		try {
			_localctx = new StructDeclContext(_localctx);
			enterOuterAlt(_localctx, 1);
			{
			setState(434);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (_la==T__12) {
				{
				setState(432);
				match(T__12);
				setState(433);
				externlang();
				}
			}

			setState(436);
			match(T__59);
			setState(437);
			match(ID);
			setState(448);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (_la==T__34) {
				{
				setState(438);
				match(T__34);
				setState(439);
				match(ID);
				setState(444);
				_errHandler.sync(this);
				_la = _input.LA(1);
				while (_la==T__7) {
					{
					{
					setState(440);
					match(T__7);
					setState(441);
					match(ID);
					}
					}
					setState(446);
					_errHandler.sync(this);
					_la = _input.LA(1);
				}
				setState(447);
				match(T__35);
				}
			}

			setState(450);
			match(T__1);
			setState(454);
			_errHandler.sync(this);
			_la = _input.LA(1);
			while (_la==T__58 || _la==ID) {
				{
				{
				setState(451);
				structcontent();
				}
				}
				setState(456);
				_errHandler.sync(this);
				_la = _input.LA(1);
			}
			setState(457);
			match(T__2);
			setState(459);
			_errHandler.sync(this);
			_la = _input.LA(1);
			if (_la==T__9) {
				{
				setState(458);
				match(T__9);
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
		public DatatypeContext datatype;
		public List<DatatypeContext> generics = new ArrayList<DatatypeContext>();
		public DatatypeContext nested;
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
		enterRule(_localctx, 70, RULE_datatype);
		int _la;
		try {
			setState(480);
			_errHandler.sync(this);
			switch (_input.LA(1)) {
			case ID:
				_localctx = new CommonDatatypeContext(_localctx);
				enterOuterAlt(_localctx, 1);
				{
				setState(461);
				match(ID);
				setState(473);
				_errHandler.sync(this);
				switch ( getInterpreter().adaptivePredict(_input,44,_ctx) ) {
				case 1:
					{
					setState(462);
					match(T__34);
					setState(463);
					((CommonDatatypeContext)_localctx).datatype = datatype();
					((CommonDatatypeContext)_localctx).generics.add(((CommonDatatypeContext)_localctx).datatype);
					setState(468);
					_errHandler.sync(this);
					_la = _input.LA(1);
					while (_la==T__7) {
						{
						{
						setState(464);
						match(T__7);
						setState(465);
						((CommonDatatypeContext)_localctx).datatype = datatype();
						((CommonDatatypeContext)_localctx).generics.add(((CommonDatatypeContext)_localctx).datatype);
						}
						}
						setState(470);
						_errHandler.sync(this);
						_la = _input.LA(1);
					}
					setState(471);
					match(T__35);
					}
					break;
				}
				setState(477);
				_errHandler.sync(this);
				switch ( getInterpreter().adaptivePredict(_input,45,_ctx) ) {
				case 1:
					{
					setState(475);
					match(T__13);
					setState(476);
					((CommonDatatypeContext)_localctx).nested = datatype();
					}
					break;
				}
				}
				break;
			case T__3:
				_localctx = new FunctionDatatypeContext(_localctx);
				enterOuterAlt(_localctx, 2);
				{
				setState(479);
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
		case 23:
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
		"\u0004\u0001B\u01e3\u0002\u0000\u0007\u0000\u0002\u0001\u0007\u0001\u0002"+
		"\u0002\u0007\u0002\u0002\u0003\u0007\u0003\u0002\u0004\u0007\u0004\u0002"+
		"\u0005\u0007\u0005\u0002\u0006\u0007\u0006\u0002\u0007\u0007\u0007\u0002"+
		"\b\u0007\b\u0002\t\u0007\t\u0002\n\u0007\n\u0002\u000b\u0007\u000b\u0002"+
		"\f\u0007\f\u0002\r\u0007\r\u0002\u000e\u0007\u000e\u0002\u000f\u0007\u000f"+
		"\u0002\u0010\u0007\u0010\u0002\u0011\u0007\u0011\u0002\u0012\u0007\u0012"+
		"\u0002\u0013\u0007\u0013\u0002\u0014\u0007\u0014\u0002\u0015\u0007\u0015"+
		"\u0002\u0016\u0007\u0016\u0002\u0017\u0007\u0017\u0002\u0018\u0007\u0018"+
		"\u0002\u0019\u0007\u0019\u0002\u001a\u0007\u001a\u0002\u001b\u0007\u001b"+
		"\u0002\u001c\u0007\u001c\u0002\u001d\u0007\u001d\u0002\u001e\u0007\u001e"+
		"\u0002\u001f\u0007\u001f\u0002 \u0007 \u0002!\u0007!\u0002\"\u0007\"\u0002"+
		"#\u0007#\u0001\u0000\u0001\u0000\u0001\u0000\u0001\u0000\u0001\u0000\u0001"+
		"\u0000\u0001\u0000\u0001\u0000\u0001\u0000\u0001\u0000\u0005\u0000S\b"+
		"\u0000\n\u0000\f\u0000V\t\u0000\u0001\u0001\u0001\u0001\u0001\u0001\u0001"+
		"\u0001\u0001\u0001\u0001\u0001\u0001\u0001\u0005\u0001_\b\u0001\n\u0001"+
		"\f\u0001b\t\u0001\u0001\u0002\u0001\u0002\u0001\u0002\u0001\u0002\u0001"+
		"\u0002\u0001\u0002\u0001\u0003\u0001\u0003\u0001\u0003\u0001\u0003\u0001"+
		"\u0003\u0001\u0003\u0003\u0003p\b\u0003\u0001\u0003\u0001\u0003\u0001"+
		"\u0004\u0001\u0004\u0001\u0004\u0001\u0004\u0001\u0004\u0003\u0004y\b"+
		"\u0004\u0001\u0004\u0001\u0004\u0001\u0005\u0003\u0005~\b\u0005\u0001"+
		"\u0005\u0001\u0005\u0001\u0005\u0001\u0005\u0001\u0005\u0001\u0005\u0003"+
		"\u0005\u0086\b\u0005\u0001\u0006\u0005\u0006\u0089\b\u0006\n\u0006\f\u0006"+
		"\u008c\t\u0006\u0001\u0007\u0001\u0007\u0001\u0007\u0001\u0007\u0001\b"+
		"\u0001\b\u0001\b\u0005\b\u0095\b\b\n\b\f\b\u0098\t\b\u0001\b\u0001\b\u0003"+
		"\b\u009c\b\b\u0003\b\u009e\b\b\u0001\b\u0003\b\u00a1\b\b\u0001\t\u0001"+
		"\t\u0001\t\u0001\t\u0001\n\u0001\n\u0001\n\u0001\n\u0001\u000b\u0001\u000b"+
		"\u0001\u000b\u0001\u000b\u0001\f\u0001\f\u0003\f\u00b1\b\f\u0001\f\u0001"+
		"\f\u0005\f\u00b5\b\f\n\f\f\f\u00b8\t\f\u0001\f\u0001\f\u0001\f\u0001\f"+
		"\u0001\f\u0001\f\u0003\f\u00c0\b\f\u0001\f\u0001\f\u0001\r\u0001\r\u0001"+
		"\u000e\u0001\u000e\u0001\u000f\u0001\u000f\u0001\u0010\u0001\u0010\u0001"+
		"\u0011\u0001\u0011\u0001\u0012\u0001\u0012\u0001\u0013\u0001\u0013\u0001"+
		"\u0014\u0001\u0014\u0001\u0014\u0001\u0014\u0003\u0014\u00d6\b\u0014\u0001"+
		"\u0014\u0001\u0014\u0001\u0014\u0001\u0014\u0001\u0014\u0001\u0014\u0001"+
		"\u0014\u0001\u0014\u0001\u0014\u0001\u0014\u0001\u0014\u0003\u0014\u00e3"+
		"\b\u0014\u0001\u0015\u0001\u0015\u0001\u0015\u0001\u0015\u0001\u0015\u0001"+
		"\u0015\u0001\u0015\u0001\u0015\u0001\u0015\u0001\u0015\u0003\u0015\u00ef"+
		"\b\u0015\u0001\u0015\u0001\u0015\u0001\u0015\u0001\u0015\u0001\u0015\u0001"+
		"\u0015\u0001\u0015\u0001\u0015\u0001\u0015\u0001\u0015\u0001\u0015\u0001"+
		"\u0015\u0001\u0015\u0001\u0015\u0005\u0015\u00ff\b\u0015\n\u0015\f\u0015"+
		"\u0102\t\u0015\u0001\u0015\u0001\u0015\u0001\u0015\u0001\u0015\u0001\u0015"+
		"\u0003\u0015\u0109\b\u0015\u0001\u0015\u0001\u0015\u0001\u0015\u0001\u0015"+
		"\u0001\u0015\u0001\u0015\u0003\u0015\u0111\b\u0015\u0001\u0016\u0001\u0016"+
		"\u0001\u0016\u0001\u0016\u0001\u0016\u0001\u0017\u0001\u0017\u0001\u0017"+
		"\u0001\u0017\u0001\u0017\u0001\u0017\u0001\u0017\u0001\u0017\u0001\u0017"+
		"\u0001\u0017\u0003\u0017\u0122\b\u0017\u0001\u0017\u0001\u0017\u0005\u0017"+
		"\u0126\b\u0017\n\u0017\f\u0017\u0129\t\u0017\u0001\u0017\u0003\u0017\u012c"+
		"\b\u0017\u0001\u0017\u0001\u0017\u0001\u0017\u0001\u0017\u0001\u0017\u0001"+
		"\u0017\u0001\u0017\u0001\u0017\u0001\u0017\u0001\u0017\u0001\u0017\u0001"+
		"\u0017\u0001\u0017\u0005\u0017\u013b\b\u0017\n\u0017\f\u0017\u013e\t\u0017"+
		"\u0001\u0017\u0001\u0017\u0003\u0017\u0142\b\u0017\u0003\u0017\u0144\b"+
		"\u0017\u0001\u0017\u0001\u0017\u0001\u0017\u0001\u0017\u0001\u0017\u0001"+
		"\u0017\u0001\u0017\u0001\u0017\u0001\u0017\u0001\u0017\u0001\u0017\u0001"+
		"\u0017\u0001\u0017\u0001\u0017\u0001\u0017\u0003\u0017\u0155\b\u0017\u0001"+
		"\u0017\u0001\u0017\u0001\u0017\u0001\u0017\u0001\u0017\u0001\u0017\u0001"+
		"\u0017\u0001\u0017\u0001\u0017\u0001\u0017\u0001\u0017\u0001\u0017\u0001"+
		"\u0017\u0001\u0017\u0001\u0017\u0001\u0017\u0001\u0017\u0001\u0017\u0001"+
		"\u0017\u0001\u0017\u0005\u0017\u016b\b\u0017\n\u0017\f\u0017\u016e\t\u0017"+
		"\u0001\u0018\u0001\u0018\u0001\u0018\u0005\u0018\u0173\b\u0018\n\u0018"+
		"\f\u0018\u0176\t\u0018\u0003\u0018\u0178\b\u0018\u0001\u0019\u0001\u0019"+
		"\u0001\u001a\u0001\u001a\u0001\u001a\u0001\u001a\u0001\u001a\u0001\u001a"+
		"\u0001\u001b\u0001\u001b\u0001\u001b\u0001\u001b\u0003\u001b\u0186\b\u001b"+
		"\u0001\u001c\u0001\u001c\u0001\u001c\u0001\u001c\u0003\u001c\u018c\b\u001c"+
		"\u0001\u001d\u0001\u001d\u0001\u001e\u0001\u001e\u0001\u001f\u0001\u001f"+
		"\u0001 \u0001 \u0001 \u0001!\u0001!\u0001!\u0001!\u0001!\u0001!\u0001"+
		"!\u0001!\u0001!\u0001!\u0001!\u0003!\u01a2\b!\u0001!\u0001!\u0001!\u0001"+
		"!\u0001!\u0005!\u01a9\b!\n!\f!\u01ac\t!\u0001!\u0003!\u01af\b!\u0001\""+
		"\u0001\"\u0003\"\u01b3\b\"\u0001\"\u0001\"\u0001\"\u0001\"\u0001\"\u0001"+
		"\"\u0005\"\u01bb\b\"\n\"\f\"\u01be\t\"\u0001\"\u0003\"\u01c1\b\"\u0001"+
		"\"\u0001\"\u0005\"\u01c5\b\"\n\"\f\"\u01c8\t\"\u0001\"\u0001\"\u0003\""+
		"\u01cc\b\"\u0001#\u0001#\u0001#\u0001#\u0001#\u0005#\u01d3\b#\n#\f#\u01d6"+
		"\t#\u0001#\u0001#\u0003#\u01da\b#\u0001#\u0001#\u0003#\u01de\b#\u0001"+
		"#\u0003#\u01e1\b#\u0001#\u0000\u0001.$\u0000\u0002\u0004\u0006\b\n\f\u000e"+
		"\u0010\u0012\u0014\u0016\u0018\u001a\u001c\u001e \"$&(*,.02468:<>@BDF"+
		"\u0000\n\u0001\u0000\u000f\u0010\u0001\u0000\u0011\u0012\u0001\u0000\u0019"+
		"\u001a\u0001\u0000\u001b\u001c\u0001\u0000\u001d\u001e\u0001\u0000 \""+
		"\u0001\u0000#&\u0001\u0000*+\u0002\u0000\u0013\u0013,5\u0001\u000078\u0211"+
		"\u0000T\u0001\u0000\u0000\u0000\u0002`\u0001\u0000\u0000\u0000\u0004c"+
		"\u0001\u0000\u0000\u0000\u0006i\u0001\u0000\u0000\u0000\bs\u0001\u0000"+
		"\u0000\u0000\n\u0085\u0001\u0000\u0000\u0000\f\u008a\u0001\u0000\u0000"+
		"\u0000\u000e\u008d\u0001\u0000\u0000\u0000\u0010\u00a0\u0001\u0000\u0000"+
		"\u0000\u0012\u00a2\u0001\u0000\u0000\u0000\u0014\u00a6\u0001\u0000\u0000"+
		"\u0000\u0016\u00aa\u0001\u0000\u0000\u0000\u0018\u00ae\u0001\u0000\u0000"+
		"\u0000\u001a\u00c3\u0001\u0000\u0000\u0000\u001c\u00c5\u0001\u0000\u0000"+
		"\u0000\u001e\u00c7\u0001\u0000\u0000\u0000 \u00c9\u0001\u0000\u0000\u0000"+
		"\"\u00cb\u0001\u0000\u0000\u0000$\u00cd\u0001\u0000\u0000\u0000&\u00cf"+
		"\u0001\u0000\u0000\u0000(\u00e2\u0001\u0000\u0000\u0000*\u0110\u0001\u0000"+
		"\u0000\u0000,\u0112\u0001\u0000\u0000\u0000.\u0143\u0001\u0000\u0000\u0000"+
		"0\u0177\u0001\u0000\u0000\u00002\u0179\u0001\u0000\u0000\u00004\u017b"+
		"\u0001\u0000\u0000\u00006\u0185\u0001\u0000\u0000\u00008\u0187\u0001\u0000"+
		"\u0000\u0000:\u018d\u0001\u0000\u0000\u0000<\u018f\u0001\u0000\u0000\u0000"+
		">\u0191\u0001\u0000\u0000\u0000@\u0193\u0001\u0000\u0000\u0000B\u01ae"+
		"\u0001\u0000\u0000\u0000D\u01b2\u0001\u0000\u0000\u0000F\u01e0\u0001\u0000"+
		"\u0000\u0000HS\u0003\u0012\t\u0000IS\u0003\u0014\n\u0000JS\u0003\u0016"+
		"\u000b\u0000KS\u0003\u0006\u0003\u0000LS\u0003\u0018\f\u0000MS\u00038"+
		"\u001c\u0000NS\u0003@ \u0000OS\u0003D\"\u0000PS\u0003\u0004\u0002\u0000"+
		"QS\u0003(\u0014\u0000RH\u0001\u0000\u0000\u0000RI\u0001\u0000\u0000\u0000"+
		"RJ\u0001\u0000\u0000\u0000RK\u0001\u0000\u0000\u0000RL\u0001\u0000\u0000"+
		"\u0000RM\u0001\u0000\u0000\u0000RN\u0001\u0000\u0000\u0000RO\u0001\u0000"+
		"\u0000\u0000RP\u0001\u0000\u0000\u0000RQ\u0001\u0000\u0000\u0000SV\u0001"+
		"\u0000\u0000\u0000TR\u0001\u0000\u0000\u0000TU\u0001\u0000\u0000\u0000"+
		"U\u0001\u0001\u0000\u0000\u0000VT\u0001\u0000\u0000\u0000W_\u0003\u0006"+
		"\u0003\u0000X_\u0003\u0018\f\u0000Y_\u00038\u001c\u0000Z_\u0003@ \u0000"+
		"[_\u0003D\"\u0000\\_\u0003\u0004\u0002\u0000]_\u0003(\u0014\u0000^W\u0001"+
		"\u0000\u0000\u0000^X\u0001\u0000\u0000\u0000^Y\u0001\u0000\u0000\u0000"+
		"^Z\u0001\u0000\u0000\u0000^[\u0001\u0000\u0000\u0000^\\\u0001\u0000\u0000"+
		"\u0000^]\u0001\u0000\u0000\u0000_b\u0001\u0000\u0000\u0000`^\u0001\u0000"+
		"\u0000\u0000`a\u0001\u0000\u0000\u0000a\u0003\u0001\u0000\u0000\u0000"+
		"b`\u0001\u0000\u0000\u0000cd\u0005\u0001\u0000\u0000de\u0005@\u0000\u0000"+
		"ef\u0005\u0002\u0000\u0000fg\u0003\u0002\u0001\u0000gh\u0005\u0003\u0000"+
		"\u0000h\u0005\u0001\u0000\u0000\u0000ij\u0005@\u0000\u0000jk\u0005\u0004"+
		"\u0000\u0000kl\u0003\u0010\b\u0000lo\u0005\u0005\u0000\u0000mn\u0005\u0006"+
		"\u0000\u0000np\u0003F#\u0000om\u0001\u0000\u0000\u0000op\u0001\u0000\u0000"+
		"\u0000pq\u0001\u0000\u0000\u0000qr\u0003\n\u0005\u0000r\u0007\u0001\u0000"+
		"\u0000\u0000st\u0005\u0004\u0000\u0000tu\u0003\u0010\b\u0000ux\u0005\u0005"+
		"\u0000\u0000vw\u0005\u0006\u0000\u0000wy\u0003F#\u0000xv\u0001\u0000\u0000"+
		"\u0000xy\u0001\u0000\u0000\u0000yz\u0001\u0000\u0000\u0000z{\u0003\n\u0005"+
		"\u0000{\t\u0001\u0000\u0000\u0000|~\u0005\u0007\u0000\u0000}|\u0001\u0000"+
		"\u0000\u0000}~\u0001\u0000\u0000\u0000~\u007f\u0001\u0000\u0000\u0000"+
		"\u007f\u0080\u0005\u0002\u0000\u0000\u0080\u0081\u0003\f\u0006\u0000\u0081"+
		"\u0082\u0005\u0003\u0000\u0000\u0082\u0086\u0001\u0000\u0000\u0000\u0083"+
		"\u0084\u0005\u0007\u0000\u0000\u0084\u0086\u0003.\u0017\u0000\u0085}\u0001"+
		"\u0000\u0000\u0000\u0085\u0083\u0001\u0000\u0000\u0000\u0086\u000b\u0001"+
		"\u0000\u0000\u0000\u0087\u0089\u0003*\u0015\u0000\u0088\u0087\u0001\u0000"+
		"\u0000\u0000\u0089\u008c\u0001\u0000\u0000\u0000\u008a\u0088\u0001\u0000"+
		"\u0000\u0000\u008a\u008b\u0001\u0000\u0000\u0000\u008b\r\u0001\u0000\u0000"+
		"\u0000\u008c\u008a\u0001\u0000\u0000\u0000\u008d\u008e\u0005@\u0000\u0000"+
		"\u008e\u008f\u0005\u0006\u0000\u0000\u008f\u0090\u0003F#\u0000\u0090\u000f"+
		"\u0001\u0000\u0000\u0000\u0091\u0096\u0003\u000e\u0007\u0000\u0092\u0093"+
		"\u0005\b\u0000\u0000\u0093\u0095\u0003\u000e\u0007\u0000\u0094\u0092\u0001"+
		"\u0000\u0000\u0000\u0095\u0098\u0001\u0000\u0000\u0000\u0096\u0094\u0001"+
		"\u0000\u0000\u0000\u0096\u0097\u0001\u0000\u0000\u0000\u0097\u009b\u0001"+
		"\u0000\u0000\u0000\u0098\u0096\u0001\u0000\u0000\u0000\u0099\u009a\u0005"+
		"\b\u0000\u0000\u009a\u009c\u00032\u0019\u0000\u009b\u0099\u0001\u0000"+
		"\u0000\u0000\u009b\u009c\u0001\u0000\u0000\u0000\u009c\u009e\u0001\u0000"+
		"\u0000\u0000\u009d\u0091\u0001\u0000\u0000\u0000\u009d\u009e\u0001\u0000"+
		"\u0000\u0000\u009e\u00a1\u0001\u0000\u0000\u0000\u009f\u00a1\u00032\u0019"+
		"\u0000\u00a0\u009d\u0001\u0000\u0000\u0000\u00a0\u009f\u0001\u0000\u0000"+
		"\u0000\u00a1\u0011\u0001\u0000\u0000\u0000\u00a2\u00a3\u0005\t\u0000\u0000"+
		"\u00a3\u00a4\u0005=\u0000\u0000\u00a4\u00a5\u0005\n\u0000\u0000\u00a5"+
		"\u0013\u0001\u0000\u0000\u0000\u00a6\u00a7\u0005\u000b\u0000\u0000\u00a7"+
		"\u00a8\u0005=\u0000\u0000\u00a8\u00a9\u0005\n\u0000\u0000\u00a9\u0015"+
		"\u0001\u0000\u0000\u0000\u00aa\u00ab\u0005\f\u0000\u0000\u00ab\u00ac\u0005"+
		"=\u0000\u0000\u00ac\u00ad\u0005\n\u0000\u0000\u00ad\u0017\u0001\u0000"+
		"\u0000\u0000\u00ae\u00b0\u0005\r\u0000\u0000\u00af\u00b1\u0003\u001a\r"+
		"\u0000\u00b0\u00af\u0001\u0000\u0000\u0000\u00b0\u00b1\u0001\u0000\u0000"+
		"\u0000\u00b1\u00b6\u0001\u0000\u0000\u0000\u00b2\u00b3\u0005@\u0000\u0000"+
		"\u00b3\u00b5\u0005\u000e\u0000\u0000\u00b4\u00b2\u0001\u0000\u0000\u0000"+
		"\u00b5\u00b8\u0001\u0000\u0000\u0000\u00b6\u00b4\u0001\u0000\u0000\u0000"+
		"\u00b6\u00b7\u0001\u0000\u0000\u0000\u00b7\u00b9\u0001\u0000\u0000\u0000"+
		"\u00b8\u00b6\u0001\u0000\u0000\u0000\u00b9\u00ba\u0005@\u0000\u0000\u00ba"+
		"\u00bb\u0005\u0004\u0000\u0000\u00bb\u00bc\u0003\u0010\b\u0000\u00bc\u00bf"+
		"\u0005\u0005\u0000\u0000\u00bd\u00be\u0005\u0006\u0000\u0000\u00be\u00c0"+
		"\u0003F#\u0000\u00bf\u00bd\u0001\u0000\u0000\u0000\u00bf\u00c0\u0001\u0000"+
		"\u0000\u0000\u00c0\u00c1\u0001\u0000\u0000\u0000\u00c1\u00c2\u0005\n\u0000"+
		"\u0000\u00c2\u0019\u0001\u0000\u0000\u0000\u00c3\u00c4\u0007\u0000\u0000"+
		"\u0000\u00c4\u001b\u0001\u0000\u0000\u0000\u00c5\u00c6\u0003.\u0017\u0000"+
		"\u00c6\u001d\u0001\u0000\u0000\u0000\u00c7\u00c8\u0003.\u0017\u0000\u00c8"+
		"\u001f\u0001\u0000\u0000\u0000\u00c9\u00ca\u0003\f\u0006\u0000\u00ca!"+
		"\u0001\u0000\u0000\u0000\u00cb\u00cc\u0003\f\u0006\u0000\u00cc#\u0001"+
		"\u0000\u0000\u0000\u00cd\u00ce\u0003\f\u0006\u0000\u00ce%\u0001\u0000"+
		"\u0000\u0000\u00cf\u00d0\u0007\u0001\u0000\u0000\u00d0\'\u0001\u0000\u0000"+
		"\u0000\u00d1\u00d2\u0003&\u0013\u0000\u00d2\u00d5\u0005@\u0000\u0000\u00d3"+
		"\u00d4\u0005\u0006\u0000\u0000\u00d4\u00d6\u0003F#\u0000\u00d5\u00d3\u0001"+
		"\u0000\u0000\u0000\u00d5\u00d6\u0001\u0000\u0000\u0000\u00d6\u00d7\u0001"+
		"\u0000\u0000\u0000\u00d7\u00d8\u0005\u0013\u0000\u0000\u00d8\u00d9\u0003"+
		".\u0017\u0000\u00d9\u00da\u0005\n\u0000\u0000\u00da\u00e3\u0001\u0000"+
		"\u0000\u0000\u00db\u00dc\u0003&\u0013\u0000\u00dc\u00dd\u0005@\u0000\u0000"+
		"\u00dd\u00de\u0005\u0006\u0000\u0000\u00de\u00df\u0003F#\u0000\u00df\u00e0"+
		"\u0001\u0000\u0000\u0000\u00e0\u00e1\u0005\n\u0000\u0000\u00e1\u00e3\u0001"+
		"\u0000\u0000\u0000\u00e2\u00d1\u0001\u0000\u0000\u0000\u00e2\u00db\u0001"+
		"\u0000\u0000\u0000\u00e3)\u0001\u0000\u0000\u0000\u00e4\u00e5\u0005\u0014"+
		"\u0000\u0000\u00e5\u00e6\u0005\u0004\u0000\u0000\u00e6\u00e7\u0005=\u0000"+
		"\u0000\u00e7\u00e8\u0005\u0005\u0000\u0000\u00e8\u0111\u0005\n\u0000\u0000"+
		"\u00e9\u00ea\u0003.\u0017\u0000\u00ea\u00eb\u0005\n\u0000\u0000\u00eb"+
		"\u0111\u0001\u0000\u0000\u0000\u00ec\u00ee\u0005\u0015\u0000\u0000\u00ed"+
		"\u00ef\u0003.\u0017\u0000\u00ee\u00ed\u0001\u0000\u0000\u0000\u00ee\u00ef"+
		"\u0001\u0000\u0000\u0000\u00ef\u00f0\u0001\u0000\u0000\u0000\u00f0\u0111"+
		"\u0005\n\u0000\u0000\u00f1\u0111\u0003(\u0014\u0000\u00f2\u00f3\u0005"+
		"\u0016\u0000\u0000\u00f3\u00f4\u0003\u001c\u000e\u0000\u00f4\u00f5\u0005"+
		"\u0002\u0000\u0000\u00f5\u00f6\u0003 \u0010\u0000\u00f6\u0100\u0005\u0003"+
		"\u0000\u0000\u00f7\u00f8\u0005\u0017\u0000\u0000\u00f8\u00f9\u0005\u0016"+
		"\u0000\u0000\u00f9\u00fa\u0003\u001e\u000f\u0000\u00fa\u00fb\u0005\u0002"+
		"\u0000\u0000\u00fb\u00fc\u0003\"\u0011\u0000\u00fc\u00fd\u0005\u0003\u0000"+
		"\u0000\u00fd\u00ff\u0001\u0000\u0000\u0000\u00fe\u00f7\u0001\u0000\u0000"+
		"\u0000\u00ff\u0102\u0001\u0000\u0000\u0000\u0100\u00fe\u0001\u0000\u0000"+
		"\u0000\u0100\u0101\u0001\u0000\u0000\u0000\u0101\u0108\u0001\u0000\u0000"+
		"\u0000\u0102\u0100\u0001\u0000\u0000\u0000\u0103\u0104\u0005\u0017\u0000"+
		"\u0000\u0104\u0105\u0005\u0002\u0000\u0000\u0105\u0106\u0003$\u0012\u0000"+
		"\u0106\u0107\u0005\u0003\u0000\u0000\u0107\u0109\u0001\u0000\u0000\u0000"+
		"\u0108\u0103\u0001\u0000\u0000\u0000\u0108\u0109\u0001\u0000\u0000\u0000"+
		"\u0109\u0111\u0001\u0000\u0000\u0000\u010a\u010b\u0005\u0018\u0000\u0000"+
		"\u010b\u010c\u0003.\u0017\u0000\u010c\u010d\u0005\u0002\u0000\u0000\u010d"+
		"\u010e\u0003\f\u0006\u0000\u010e\u010f\u0005\u0003\u0000\u0000\u010f\u0111"+
		"\u0001\u0000\u0000\u0000\u0110\u00e4\u0001\u0000\u0000\u0000\u0110\u00e9"+
		"\u0001\u0000\u0000\u0000\u0110\u00ec\u0001\u0000\u0000\u0000\u0110\u00f1"+
		"\u0001\u0000\u0000\u0000\u0110\u00f2\u0001\u0000\u0000\u0000\u0110\u010a"+
		"\u0001\u0000\u0000\u0000\u0111+\u0001\u0000\u0000\u0000\u0112\u0113\u0005"+
		"\u000e\u0000\u0000\u0113\u0114\u0005@\u0000\u0000\u0114\u0115\u0005\u0006"+
		"\u0000\u0000\u0115\u0116\u0003.\u0017\u0000\u0116-\u0001\u0000\u0000\u0000"+
		"\u0117\u0118\u0006\u0017\uffff\uffff\u0000\u0118\u0119\u0005\u0004\u0000"+
		"\u0000\u0119\u011a\u0003.\u0017\u0000\u011a\u011b\u0005\u0005\u0000\u0000"+
		"\u011b\u0144\u0001\u0000\u0000\u0000\u011c\u0144\u0003\b\u0004\u0000\u011d"+
		"\u0144\u00036\u001b\u0000\u011e\u011f\u0003F#\u0000\u011f\u0121\u0005"+
		"\u0002\u0000\u0000\u0120\u0122\u0003,\u0016\u0000\u0121\u0120\u0001\u0000"+
		"\u0000\u0000\u0121\u0122\u0001\u0000\u0000\u0000\u0122\u0127\u0001\u0000"+
		"\u0000\u0000\u0123\u0124\u0005\b\u0000\u0000\u0124\u0126\u0003,\u0016"+
		"\u0000\u0125\u0123\u0001\u0000\u0000\u0000\u0126\u0129\u0001\u0000\u0000"+
		"\u0000\u0127\u0125\u0001\u0000\u0000\u0000\u0127\u0128\u0001\u0000\u0000"+
		"\u0000\u0128\u012b\u0001\u0000\u0000\u0000\u0129\u0127\u0001\u0000\u0000"+
		"\u0000\u012a\u012c\u0005\b\u0000\u0000\u012b\u012a\u0001\u0000\u0000\u0000"+
		"\u012b\u012c\u0001\u0000\u0000\u0000\u012c\u012d\u0001\u0000\u0000\u0000"+
		"\u012d\u012e\u0005\u0003\u0000\u0000\u012e\u0144\u0001\u0000\u0000\u0000"+
		"\u012f\u0130\u0007\u0002\u0000\u0000\u0130\u0144\u0003.\u0017\u000b\u0131"+
		"\u0132\u0007\u0003\u0000\u0000\u0132\u0144\u0003.\u0017\n\u0133\u0134"+
		"\u0007\u0004\u0000\u0000\u0134\u0144\u0003.\u0017\t\u0135\u0141\u0005"+
		"@\u0000\u0000\u0136\u0137\u0005#\u0000\u0000\u0137\u013c\u0003F#\u0000"+
		"\u0138\u0139\u0005\b\u0000\u0000\u0139\u013b\u0003F#\u0000\u013a\u0138"+
		"\u0001\u0000\u0000\u0000\u013b\u013e\u0001\u0000\u0000\u0000\u013c\u013a"+
		"\u0001\u0000\u0000\u0000\u013c\u013d\u0001\u0000\u0000\u0000\u013d\u013f"+
		"\u0001\u0000\u0000\u0000\u013e\u013c\u0001\u0000\u0000\u0000\u013f\u0140"+
		"\u0005$\u0000\u0000\u0140\u0142\u0001\u0000\u0000\u0000\u0141\u0136\u0001"+
		"\u0000\u0000\u0000\u0141\u0142\u0001\u0000\u0000\u0000\u0142\u0144\u0001"+
		"\u0000\u0000\u0000\u0143\u0117\u0001\u0000\u0000\u0000\u0143\u011c\u0001"+
		"\u0000\u0000\u0000\u0143\u011d\u0001\u0000\u0000\u0000\u0143\u011e\u0001"+
		"\u0000\u0000\u0000\u0143\u012f\u0001\u0000\u0000\u0000\u0143\u0131\u0001"+
		"\u0000\u0000\u0000\u0143\u0133\u0001\u0000\u0000\u0000\u0143\u0135\u0001"+
		"\u0000\u0000\u0000\u0144\u016c\u0001\u0000\u0000\u0000\u0145\u0146\n\u0007"+
		"\u0000\u0000\u0146\u0147\u0007\u0005\u0000\u0000\u0147\u016b\u0003.\u0017"+
		"\b\u0148\u0149\n\u0006\u0000\u0000\u0149\u014a\u0007\u0003\u0000\u0000"+
		"\u014a\u016b\u0003.\u0017\u0007\u014b\u014c\n\u0005\u0000\u0000\u014c"+
		"\u014d\u0007\u0006\u0000\u0000\u014d\u016b\u0003.\u0017\u0006\u014e\u0154"+
		"\n\u0004\u0000\u0000\u014f\u0155\u0005\'\u0000\u0000\u0150\u0155\u0005"+
		"(\u0000\u0000\u0151\u0155\u0005)\u0000\u0000\u0152\u0153\u0005)\u0000"+
		"\u0000\u0153\u0155\u0005\u001d\u0000\u0000\u0154\u014f\u0001\u0000\u0000"+
		"\u0000\u0154\u0150\u0001\u0000\u0000\u0000\u0154\u0151\u0001\u0000\u0000"+
		"\u0000\u0154\u0152\u0001\u0000\u0000\u0000\u0155\u0156\u0001\u0000\u0000"+
		"\u0000\u0156\u016b\u0003.\u0017\u0005\u0157\u0158\n\u0003\u0000\u0000"+
		"\u0158\u0159\u0007\u0007\u0000\u0000\u0159\u016b\u0003.\u0017\u0004\u015a"+
		"\u015b\n\u0002\u0000\u0000\u015b\u015c\u0007\b\u0000\u0000\u015c\u016b"+
		"\u0003.\u0017\u0003\u015d\u015e\n\u000f\u0000\u0000\u015e\u016b\u0007"+
		"\u0002\u0000\u0000\u015f\u0160\n\u000e\u0000\u0000\u0160\u0161\u0005\u0004"+
		"\u0000\u0000\u0161\u0162\u00030\u0018\u0000\u0162\u0163\u0005\u0005\u0000"+
		"\u0000\u0163\u016b\u0001\u0000\u0000\u0000\u0164\u0165\n\r\u0000\u0000"+
		"\u0165\u0166\u0005\u000e\u0000\u0000\u0166\u016b\u0005@\u0000\u0000\u0167"+
		"\u0168\n\b\u0000\u0000\u0168\u0169\u0005\u001f\u0000\u0000\u0169\u016b"+
		"\u0003F#\u0000\u016a\u0145\u0001\u0000\u0000\u0000\u016a\u0148\u0001\u0000"+
		"\u0000\u0000\u016a\u014b\u0001\u0000\u0000\u0000\u016a\u014e\u0001\u0000"+
		"\u0000\u0000\u016a\u0157\u0001\u0000\u0000\u0000\u016a\u015a\u0001\u0000"+
		"\u0000\u0000\u016a\u015d\u0001\u0000\u0000\u0000\u016a\u015f\u0001\u0000"+
		"\u0000\u0000\u016a\u0164\u0001\u0000\u0000\u0000\u016a\u0167\u0001\u0000"+
		"\u0000\u0000\u016b\u016e\u0001\u0000\u0000\u0000\u016c\u016a\u0001\u0000"+
		"\u0000\u0000\u016c\u016d\u0001\u0000\u0000\u0000\u016d/\u0001\u0000\u0000"+
		"\u0000\u016e\u016c\u0001\u0000\u0000\u0000\u016f\u0174\u0003.\u0017\u0000"+
		"\u0170\u0171\u0005\b\u0000\u0000\u0171\u0173\u0003.\u0017\u0000\u0172"+
		"\u0170\u0001\u0000\u0000\u0000\u0173\u0176\u0001\u0000\u0000\u0000\u0174"+
		"\u0172\u0001\u0000\u0000\u0000\u0174\u0175\u0001\u0000\u0000\u0000\u0175"+
		"\u0178\u0001\u0000\u0000\u0000\u0176\u0174\u0001\u0000\u0000\u0000\u0177"+
		"\u016f\u0001\u0000\u0000\u0000\u0177\u0178\u0001\u0000\u0000\u0000\u0178"+
		"1\u0001\u0000\u0000\u0000\u0179\u017a\u00056\u0000\u0000\u017a3\u0001"+
		"\u0000\u0000\u0000\u017b\u017c\u0005\u0004\u0000\u0000\u017c\u017d\u0003"+
		"\u0010\b\u0000\u017d\u017e\u0005\u0005\u0000\u0000\u017e\u017f\u0005\u0007"+
		"\u0000\u0000\u017f\u0180\u0003F#\u0000\u01805\u0001\u0000\u0000\u0000"+
		"\u0181\u0186\u0007\t\u0000\u0000\u0182\u0186\u0005>\u0000\u0000\u0183"+
		"\u0186\u0005?\u0000\u0000\u0184\u0186\u0005=\u0000\u0000\u0185\u0181\u0001"+
		"\u0000\u0000\u0000\u0185\u0182\u0001\u0000\u0000\u0000\u0185\u0183\u0001"+
		"\u0000\u0000\u0000\u0185\u0184\u0001\u0000\u0000\u0000\u01867\u0001\u0000"+
		"\u0000\u0000\u0187\u0188\u00059\u0000\u0000\u0188\u0189\u0003>\u001f\u0000"+
		"\u0189\u018b\u0003:\u001d\u0000\u018a\u018c\u0003<\u001e\u0000\u018b\u018a"+
		"\u0001\u0000\u0000\u0000\u018b\u018c\u0001\u0000\u0000\u0000\u018c9\u0001"+
		"\u0000\u0000\u0000\u018d\u018e\u0005=\u0000\u0000\u018e;\u0001\u0000\u0000"+
		"\u0000\u018f\u0190\u0005=\u0000\u0000\u0190=\u0001\u0000\u0000\u0000\u0191"+
		"\u0192\u0007\u0000\u0000\u0000\u0192?\u0001\u0000\u0000\u0000\u0193\u0194"+
		"\u0005:\u0000\u0000\u0194\u0195\u0005=\u0000\u0000\u0195A\u0001\u0000"+
		"\u0000\u0000\u0196\u0197\u0005@\u0000\u0000\u0197\u0198\u0005\u0006\u0000"+
		"\u0000\u0198\u0199\u0003F#\u0000\u0199\u019a\u0005\n\u0000\u0000\u019a"+
		"\u01af\u0001\u0000\u0000\u0000\u019b\u019c\u0005@\u0000\u0000\u019c\u019d"+
		"\u0005\u0004\u0000\u0000\u019d\u019e\u0003\u0010\b\u0000\u019e\u01a1\u0005"+
		"\u0005\u0000\u0000\u019f\u01a0\u0005\u0006\u0000\u0000\u01a0\u01a2\u0003"+
		"F#\u0000\u01a1\u019f\u0001\u0000\u0000\u0000\u01a1\u01a2\u0001\u0000\u0000"+
		"\u0000\u01a2\u01a3\u0001\u0000\u0000\u0000\u01a3\u01a4\u0003\n\u0005\u0000"+
		"\u01a4\u01af\u0001\u0000\u0000\u0000\u01a5\u01a6\u0005;\u0000\u0000\u01a6"+
		"\u01aa\u0005\u0002\u0000\u0000\u01a7\u01a9\u0003B!\u0000\u01a8\u01a7\u0001"+
		"\u0000\u0000\u0000\u01a9\u01ac\u0001\u0000\u0000\u0000\u01aa\u01a8\u0001"+
		"\u0000\u0000\u0000\u01aa\u01ab\u0001\u0000\u0000\u0000\u01ab\u01ad\u0001"+
		"\u0000\u0000\u0000\u01ac\u01aa\u0001\u0000\u0000\u0000\u01ad\u01af\u0005"+
		"\u0003\u0000\u0000\u01ae\u0196\u0001\u0000\u0000\u0000\u01ae\u019b\u0001"+
		"\u0000\u0000\u0000\u01ae\u01a5\u0001\u0000\u0000\u0000\u01afC\u0001\u0000"+
		"\u0000\u0000\u01b0\u01b1\u0005\r\u0000\u0000\u01b1\u01b3\u0003\u001a\r"+
		"\u0000\u01b2\u01b0\u0001\u0000\u0000\u0000\u01b2\u01b3\u0001\u0000\u0000"+
		"\u0000\u01b3\u01b4\u0001\u0000\u0000\u0000\u01b4\u01b5\u0005<\u0000\u0000"+
		"\u01b5\u01c0\u0005@\u0000\u0000\u01b6\u01b7\u0005#\u0000\u0000\u01b7\u01bc"+
		"\u0005@\u0000\u0000\u01b8\u01b9\u0005\b\u0000\u0000\u01b9\u01bb\u0005"+
		"@\u0000\u0000\u01ba\u01b8\u0001\u0000\u0000\u0000\u01bb\u01be\u0001\u0000"+
		"\u0000\u0000\u01bc\u01ba\u0001\u0000\u0000\u0000\u01bc\u01bd\u0001\u0000"+
		"\u0000\u0000\u01bd\u01bf\u0001\u0000\u0000\u0000\u01be\u01bc\u0001\u0000"+
		"\u0000\u0000\u01bf\u01c1\u0005$\u0000\u0000\u01c0\u01b6\u0001\u0000\u0000"+
		"\u0000\u01c0\u01c1\u0001\u0000\u0000\u0000\u01c1\u01c2\u0001\u0000\u0000"+
		"\u0000\u01c2\u01c6\u0005\u0002\u0000\u0000\u01c3\u01c5\u0003B!\u0000\u01c4"+
		"\u01c3\u0001\u0000\u0000\u0000\u01c5\u01c8\u0001\u0000\u0000\u0000\u01c6"+
		"\u01c4\u0001\u0000\u0000\u0000\u01c6\u01c7\u0001\u0000\u0000\u0000\u01c7"+
		"\u01c9\u0001\u0000\u0000\u0000\u01c8\u01c6\u0001\u0000\u0000\u0000\u01c9"+
		"\u01cb\u0005\u0003\u0000\u0000\u01ca\u01cc\u0005\n\u0000\u0000\u01cb\u01ca"+
		"\u0001\u0000\u0000\u0000\u01cb\u01cc\u0001\u0000\u0000\u0000\u01ccE\u0001"+
		"\u0000\u0000\u0000\u01cd\u01d9\u0005@\u0000\u0000\u01ce\u01cf\u0005#\u0000"+
		"\u0000\u01cf\u01d4\u0003F#\u0000\u01d0\u01d1\u0005\b\u0000\u0000\u01d1"+
		"\u01d3\u0003F#\u0000\u01d2\u01d0\u0001\u0000\u0000\u0000\u01d3\u01d6\u0001"+
		"\u0000\u0000\u0000\u01d4\u01d2\u0001\u0000\u0000\u0000\u01d4\u01d5\u0001"+
		"\u0000\u0000\u0000\u01d5\u01d7\u0001\u0000\u0000\u0000\u01d6\u01d4\u0001"+
		"\u0000\u0000\u0000\u01d7\u01d8\u0005$\u0000\u0000\u01d8\u01da\u0001\u0000"+
		"\u0000\u0000\u01d9\u01ce\u0001\u0000\u0000\u0000\u01d9\u01da\u0001\u0000"+
		"\u0000\u0000\u01da\u01dd\u0001\u0000\u0000\u0000\u01db\u01dc\u0005\u000e"+
		"\u0000\u0000\u01dc\u01de\u0003F#\u0000\u01dd\u01db\u0001\u0000\u0000\u0000"+
		"\u01dd\u01de\u0001\u0000\u0000\u0000\u01de\u01e1\u0001\u0000\u0000\u0000"+
		"\u01df\u01e1\u00034\u001a\u0000\u01e0\u01cd\u0001\u0000\u0000\u0000\u01e0"+
		"\u01df\u0001\u0000\u0000\u0000\u01e1G\u0001\u0000\u0000\u0000/RT^`ox}"+
		"\u0085\u008a\u0096\u009b\u009d\u00a0\u00b0\u00b6\u00bf\u00d5\u00e2\u00ee"+
		"\u0100\u0108\u0110\u0121\u0127\u012b\u013c\u0141\u0143\u0154\u016a\u016c"+
		"\u0174\u0177\u0185\u018b\u01a1\u01aa\u01ae\u01b2\u01bc\u01c0\u01c6\u01cb"+
		"\u01d4\u01d9\u01dd\u01e0";
	public static final ATN _ATN =
		new ATNDeserializer().deserialize(_serializedATN.toCharArray());
	static {
		_decisionToDFA = new DFA[_ATN.getNumberOfDecisions()];
		for (int i = 0; i < _ATN.getNumberOfDecisions(); i++) {
			_decisionToDFA[i] = new DFA(_ATN.getDecisionState(i), i);
		}
	}
}