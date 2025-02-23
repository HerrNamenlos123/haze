// Generated from /home/fzachs/Projects/haze/Haze.g4 by ANTLR 4.13.1
import org.antlr.v4.runtime.tree.ParseTreeListener;

/**
 * This interface defines a complete listener for a parse tree produced by
 * {@link HazeParser}.
 */
public interface HazeListener extends ParseTreeListener {
	/**
	 * Enter a parse tree produced by {@link HazeParser#prog}.
	 * @param ctx the parse tree
	 */
	void enterProg(HazeParser.ProgContext ctx);
	/**
	 * Exit a parse tree produced by {@link HazeParser#prog}.
	 * @param ctx the parse tree
	 */
	void exitProg(HazeParser.ProgContext ctx);
	/**
	 * Enter a parse tree produced by {@link HazeParser#namedfunc}.
	 * @param ctx the parse tree
	 */
	void enterNamedfunc(HazeParser.NamedfuncContext ctx);
	/**
	 * Exit a parse tree produced by {@link HazeParser#namedfunc}.
	 * @param ctx the parse tree
	 */
	void exitNamedfunc(HazeParser.NamedfuncContext ctx);
	/**
	 * Enter a parse tree produced by {@link HazeParser#func}.
	 * @param ctx the parse tree
	 */
	void enterFunc(HazeParser.FuncContext ctx);
	/**
	 * Exit a parse tree produced by {@link HazeParser#func}.
	 * @param ctx the parse tree
	 */
	void exitFunc(HazeParser.FuncContext ctx);
	/**
	 * Enter a parse tree produced by {@link HazeParser#funcbody}.
	 * @param ctx the parse tree
	 */
	void enterFuncbody(HazeParser.FuncbodyContext ctx);
	/**
	 * Exit a parse tree produced by {@link HazeParser#funcbody}.
	 * @param ctx the parse tree
	 */
	void exitFuncbody(HazeParser.FuncbodyContext ctx);
	/**
	 * Enter a parse tree produced by {@link HazeParser#body}.
	 * @param ctx the parse tree
	 */
	void enterBody(HazeParser.BodyContext ctx);
	/**
	 * Exit a parse tree produced by {@link HazeParser#body}.
	 * @param ctx the parse tree
	 */
	void exitBody(HazeParser.BodyContext ctx);
	/**
	 * Enter a parse tree produced by {@link HazeParser#param}.
	 * @param ctx the parse tree
	 */
	void enterParam(HazeParser.ParamContext ctx);
	/**
	 * Exit a parse tree produced by {@link HazeParser#param}.
	 * @param ctx the parse tree
	 */
	void exitParam(HazeParser.ParamContext ctx);
	/**
	 * Enter a parse tree produced by {@link HazeParser#params}.
	 * @param ctx the parse tree
	 */
	void enterParams(HazeParser.ParamsContext ctx);
	/**
	 * Exit a parse tree produced by {@link HazeParser#params}.
	 * @param ctx the parse tree
	 */
	void exitParams(HazeParser.ParamsContext ctx);
	/**
	 * Enter a parse tree produced by {@link HazeParser#externfuncdef}.
	 * @param ctx the parse tree
	 */
	void enterExternfuncdef(HazeParser.ExternfuncdefContext ctx);
	/**
	 * Exit a parse tree produced by {@link HazeParser#externfuncdef}.
	 * @param ctx the parse tree
	 */
	void exitExternfuncdef(HazeParser.ExternfuncdefContext ctx);
	/**
	 * Enter a parse tree produced by {@link HazeParser#externblock}.
	 * @param ctx the parse tree
	 */
	void enterExternblock(HazeParser.ExternblockContext ctx);
	/**
	 * Exit a parse tree produced by {@link HazeParser#externblock}.
	 * @param ctx the parse tree
	 */
	void exitExternblock(HazeParser.ExternblockContext ctx);
	/**
	 * Enter a parse tree produced by {@link HazeParser#externlang}.
	 * @param ctx the parse tree
	 */
	void enterExternlang(HazeParser.ExternlangContext ctx);
	/**
	 * Exit a parse tree produced by {@link HazeParser#externlang}.
	 * @param ctx the parse tree
	 */
	void exitExternlang(HazeParser.ExternlangContext ctx);
	/**
	 * Enter a parse tree produced by {@link HazeParser#ifexpr}.
	 * @param ctx the parse tree
	 */
	void enterIfexpr(HazeParser.IfexprContext ctx);
	/**
	 * Exit a parse tree produced by {@link HazeParser#ifexpr}.
	 * @param ctx the parse tree
	 */
	void exitIfexpr(HazeParser.IfexprContext ctx);
	/**
	 * Enter a parse tree produced by {@link HazeParser#elseifexpr}.
	 * @param ctx the parse tree
	 */
	void enterElseifexpr(HazeParser.ElseifexprContext ctx);
	/**
	 * Exit a parse tree produced by {@link HazeParser#elseifexpr}.
	 * @param ctx the parse tree
	 */
	void exitElseifexpr(HazeParser.ElseifexprContext ctx);
	/**
	 * Enter a parse tree produced by {@link HazeParser#thenblock}.
	 * @param ctx the parse tree
	 */
	void enterThenblock(HazeParser.ThenblockContext ctx);
	/**
	 * Exit a parse tree produced by {@link HazeParser#thenblock}.
	 * @param ctx the parse tree
	 */
	void exitThenblock(HazeParser.ThenblockContext ctx);
	/**
	 * Enter a parse tree produced by {@link HazeParser#elseifblock}.
	 * @param ctx the parse tree
	 */
	void enterElseifblock(HazeParser.ElseifblockContext ctx);
	/**
	 * Exit a parse tree produced by {@link HazeParser#elseifblock}.
	 * @param ctx the parse tree
	 */
	void exitElseifblock(HazeParser.ElseifblockContext ctx);
	/**
	 * Enter a parse tree produced by {@link HazeParser#elseblock}.
	 * @param ctx the parse tree
	 */
	void enterElseblock(HazeParser.ElseblockContext ctx);
	/**
	 * Exit a parse tree produced by {@link HazeParser#elseblock}.
	 * @param ctx the parse tree
	 */
	void exitElseblock(HazeParser.ElseblockContext ctx);
	/**
	 * Enter a parse tree produced by the {@code VariableMutability}
	 * labeled alternative in {@link HazeParser#variablemutability}.
	 * @param ctx the parse tree
	 */
	void enterVariableMutability(HazeParser.VariableMutabilityContext ctx);
	/**
	 * Exit a parse tree produced by the {@code VariableMutability}
	 * labeled alternative in {@link HazeParser#variablemutability}.
	 * @param ctx the parse tree
	 */
	void exitVariableMutability(HazeParser.VariableMutabilityContext ctx);
	/**
	 * Enter a parse tree produced by the {@code InlineCStatement}
	 * labeled alternative in {@link HazeParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterInlineCStatement(HazeParser.InlineCStatementContext ctx);
	/**
	 * Exit a parse tree produced by the {@code InlineCStatement}
	 * labeled alternative in {@link HazeParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitInlineCStatement(HazeParser.InlineCStatementContext ctx);
	/**
	 * Enter a parse tree produced by the {@code ExprStatement}
	 * labeled alternative in {@link HazeParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterExprStatement(HazeParser.ExprStatementContext ctx);
	/**
	 * Exit a parse tree produced by the {@code ExprStatement}
	 * labeled alternative in {@link HazeParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitExprStatement(HazeParser.ExprStatementContext ctx);
	/**
	 * Enter a parse tree produced by the {@code ReturnStatement}
	 * labeled alternative in {@link HazeParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterReturnStatement(HazeParser.ReturnStatementContext ctx);
	/**
	 * Exit a parse tree produced by the {@code ReturnStatement}
	 * labeled alternative in {@link HazeParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitReturnStatement(HazeParser.ReturnStatementContext ctx);
	/**
	 * Enter a parse tree produced by the {@code ExprAssignmentStatement}
	 * labeled alternative in {@link HazeParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterExprAssignmentStatement(HazeParser.ExprAssignmentStatementContext ctx);
	/**
	 * Exit a parse tree produced by the {@code ExprAssignmentStatement}
	 * labeled alternative in {@link HazeParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitExprAssignmentStatement(HazeParser.ExprAssignmentStatementContext ctx);
	/**
	 * Enter a parse tree produced by the {@code VariableDefinition}
	 * labeled alternative in {@link HazeParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterVariableDefinition(HazeParser.VariableDefinitionContext ctx);
	/**
	 * Exit a parse tree produced by the {@code VariableDefinition}
	 * labeled alternative in {@link HazeParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitVariableDefinition(HazeParser.VariableDefinitionContext ctx);
	/**
	 * Enter a parse tree produced by the {@code IfStatement}
	 * labeled alternative in {@link HazeParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterIfStatement(HazeParser.IfStatementContext ctx);
	/**
	 * Exit a parse tree produced by the {@code IfStatement}
	 * labeled alternative in {@link HazeParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitIfStatement(HazeParser.IfStatementContext ctx);
	/**
	 * Enter a parse tree produced by the {@code ObjectAttr}
	 * labeled alternative in {@link HazeParser#objectattribute}.
	 * @param ctx the parse tree
	 */
	void enterObjectAttr(HazeParser.ObjectAttrContext ctx);
	/**
	 * Exit a parse tree produced by the {@code ObjectAttr}
	 * labeled alternative in {@link HazeParser#objectattribute}.
	 * @param ctx the parse tree
	 */
	void exitObjectAttr(HazeParser.ObjectAttrContext ctx);
	/**
	 * Enter a parse tree produced by the {@code AnonymousStructInstantiationExpr}
	 * labeled alternative in {@link HazeParser#expr}.
	 * @param ctx the parse tree
	 */
	void enterAnonymousStructInstantiationExpr(HazeParser.AnonymousStructInstantiationExprContext ctx);
	/**
	 * Exit a parse tree produced by the {@code AnonymousStructInstantiationExpr}
	 * labeled alternative in {@link HazeParser#expr}.
	 * @param ctx the parse tree
	 */
	void exitAnonymousStructInstantiationExpr(HazeParser.AnonymousStructInstantiationExprContext ctx);
	/**
	 * Enter a parse tree produced by the {@code SymbolValueExpr}
	 * labeled alternative in {@link HazeParser#expr}.
	 * @param ctx the parse tree
	 */
	void enterSymbolValueExpr(HazeParser.SymbolValueExprContext ctx);
	/**
	 * Exit a parse tree produced by the {@code SymbolValueExpr}
	 * labeled alternative in {@link HazeParser#expr}.
	 * @param ctx the parse tree
	 */
	void exitSymbolValueExpr(HazeParser.SymbolValueExprContext ctx);
	/**
	 * Enter a parse tree produced by the {@code ExprCallExpr}
	 * labeled alternative in {@link HazeParser#expr}.
	 * @param ctx the parse tree
	 */
	void enterExprCallExpr(HazeParser.ExprCallExprContext ctx);
	/**
	 * Exit a parse tree produced by the {@code ExprCallExpr}
	 * labeled alternative in {@link HazeParser#expr}.
	 * @param ctx the parse tree
	 */
	void exitExprCallExpr(HazeParser.ExprCallExprContext ctx);
	/**
	 * Enter a parse tree produced by the {@code ParenthesisExpr}
	 * labeled alternative in {@link HazeParser#expr}.
	 * @param ctx the parse tree
	 */
	void enterParenthesisExpr(HazeParser.ParenthesisExprContext ctx);
	/**
	 * Exit a parse tree produced by the {@code ParenthesisExpr}
	 * labeled alternative in {@link HazeParser#expr}.
	 * @param ctx the parse tree
	 */
	void exitParenthesisExpr(HazeParser.ParenthesisExprContext ctx);
	/**
	 * Enter a parse tree produced by the {@code ExprMemberAccess}
	 * labeled alternative in {@link HazeParser#expr}.
	 * @param ctx the parse tree
	 */
	void enterExprMemberAccess(HazeParser.ExprMemberAccessContext ctx);
	/**
	 * Exit a parse tree produced by the {@code ExprMemberAccess}
	 * labeled alternative in {@link HazeParser#expr}.
	 * @param ctx the parse tree
	 */
	void exitExprMemberAccess(HazeParser.ExprMemberAccessContext ctx);
	/**
	 * Enter a parse tree produced by the {@code BinaryExpr}
	 * labeled alternative in {@link HazeParser#expr}.
	 * @param ctx the parse tree
	 */
	void enterBinaryExpr(HazeParser.BinaryExprContext ctx);
	/**
	 * Exit a parse tree produced by the {@code BinaryExpr}
	 * labeled alternative in {@link HazeParser#expr}.
	 * @param ctx the parse tree
	 */
	void exitBinaryExpr(HazeParser.BinaryExprContext ctx);
	/**
	 * Enter a parse tree produced by the {@code FuncRefExpr}
	 * labeled alternative in {@link HazeParser#expr}.
	 * @param ctx the parse tree
	 */
	void enterFuncRefExpr(HazeParser.FuncRefExprContext ctx);
	/**
	 * Exit a parse tree produced by the {@code FuncRefExpr}
	 * labeled alternative in {@link HazeParser#expr}.
	 * @param ctx the parse tree
	 */
	void exitFuncRefExpr(HazeParser.FuncRefExprContext ctx);
	/**
	 * Enter a parse tree produced by the {@code ConstantExpr}
	 * labeled alternative in {@link HazeParser#expr}.
	 * @param ctx the parse tree
	 */
	void enterConstantExpr(HazeParser.ConstantExprContext ctx);
	/**
	 * Exit a parse tree produced by the {@code ConstantExpr}
	 * labeled alternative in {@link HazeParser#expr}.
	 * @param ctx the parse tree
	 */
	void exitConstantExpr(HazeParser.ConstantExprContext ctx);
	/**
	 * Enter a parse tree produced by the {@code StructInstantiationExpr}
	 * labeled alternative in {@link HazeParser#expr}.
	 * @param ctx the parse tree
	 */
	void enterStructInstantiationExpr(HazeParser.StructInstantiationExprContext ctx);
	/**
	 * Exit a parse tree produced by the {@code StructInstantiationExpr}
	 * labeled alternative in {@link HazeParser#expr}.
	 * @param ctx the parse tree
	 */
	void exitStructInstantiationExpr(HazeParser.StructInstantiationExprContext ctx);
	/**
	 * Enter a parse tree produced by {@link HazeParser#args}.
	 * @param ctx the parse tree
	 */
	void enterArgs(HazeParser.ArgsContext ctx);
	/**
	 * Exit a parse tree produced by {@link HazeParser#args}.
	 * @param ctx the parse tree
	 */
	void exitArgs(HazeParser.ArgsContext ctx);
	/**
	 * Enter a parse tree produced by {@link HazeParser#functype}.
	 * @param ctx the parse tree
	 */
	void enterFunctype(HazeParser.FunctypeContext ctx);
	/**
	 * Exit a parse tree produced by {@link HazeParser#functype}.
	 * @param ctx the parse tree
	 */
	void exitFunctype(HazeParser.FunctypeContext ctx);
	/**
	 * Enter a parse tree produced by the {@code IntegerConstant}
	 * labeled alternative in {@link HazeParser#constant}.
	 * @param ctx the parse tree
	 */
	void enterIntegerConstant(HazeParser.IntegerConstantContext ctx);
	/**
	 * Exit a parse tree produced by the {@code IntegerConstant}
	 * labeled alternative in {@link HazeParser#constant}.
	 * @param ctx the parse tree
	 */
	void exitIntegerConstant(HazeParser.IntegerConstantContext ctx);
	/**
	 * Enter a parse tree produced by the {@code StringConstant}
	 * labeled alternative in {@link HazeParser#constant}.
	 * @param ctx the parse tree
	 */
	void enterStringConstant(HazeParser.StringConstantContext ctx);
	/**
	 * Exit a parse tree produced by the {@code StringConstant}
	 * labeled alternative in {@link HazeParser#constant}.
	 * @param ctx the parse tree
	 */
	void exitStringConstant(HazeParser.StringConstantContext ctx);
	/**
	 * Enter a parse tree produced by the {@code BooleanConstant}
	 * labeled alternative in {@link HazeParser#constant}.
	 * @param ctx the parse tree
	 */
	void enterBooleanConstant(HazeParser.BooleanConstantContext ctx);
	/**
	 * Exit a parse tree produced by the {@code BooleanConstant}
	 * labeled alternative in {@link HazeParser#constant}.
	 * @param ctx the parse tree
	 */
	void exitBooleanConstant(HazeParser.BooleanConstantContext ctx);
	/**
	 * Enter a parse tree produced by {@link HazeParser#compilationhint}.
	 * @param ctx the parse tree
	 */
	void enterCompilationhint(HazeParser.CompilationhintContext ctx);
	/**
	 * Exit a parse tree produced by {@link HazeParser#compilationhint}.
	 * @param ctx the parse tree
	 */
	void exitCompilationhint(HazeParser.CompilationhintContext ctx);
	/**
	 * Enter a parse tree produced by {@link HazeParser#compilationhintfilename}.
	 * @param ctx the parse tree
	 */
	void enterCompilationhintfilename(HazeParser.CompilationhintfilenameContext ctx);
	/**
	 * Exit a parse tree produced by {@link HazeParser#compilationhintfilename}.
	 * @param ctx the parse tree
	 */
	void exitCompilationhintfilename(HazeParser.CompilationhintfilenameContext ctx);
	/**
	 * Enter a parse tree produced by {@link HazeParser#compilationhintflags}.
	 * @param ctx the parse tree
	 */
	void enterCompilationhintflags(HazeParser.CompilationhintflagsContext ctx);
	/**
	 * Exit a parse tree produced by {@link HazeParser#compilationhintflags}.
	 * @param ctx the parse tree
	 */
	void exitCompilationhintflags(HazeParser.CompilationhintflagsContext ctx);
	/**
	 * Enter a parse tree produced by {@link HazeParser#compilationlang}.
	 * @param ctx the parse tree
	 */
	void enterCompilationlang(HazeParser.CompilationlangContext ctx);
	/**
	 * Exit a parse tree produced by {@link HazeParser#compilationlang}.
	 * @param ctx the parse tree
	 */
	void exitCompilationlang(HazeParser.CompilationlangContext ctx);
	/**
	 * Enter a parse tree produced by {@link HazeParser#linkerhint}.
	 * @param ctx the parse tree
	 */
	void enterLinkerhint(HazeParser.LinkerhintContext ctx);
	/**
	 * Exit a parse tree produced by {@link HazeParser#linkerhint}.
	 * @param ctx the parse tree
	 */
	void exitLinkerhint(HazeParser.LinkerhintContext ctx);
	/**
	 * Enter a parse tree produced by the {@code StructMember}
	 * labeled alternative in {@link HazeParser#structcontent}.
	 * @param ctx the parse tree
	 */
	void enterStructMember(HazeParser.StructMemberContext ctx);
	/**
	 * Exit a parse tree produced by the {@code StructMember}
	 * labeled alternative in {@link HazeParser#structcontent}.
	 * @param ctx the parse tree
	 */
	void exitStructMember(HazeParser.StructMemberContext ctx);
	/**
	 * Enter a parse tree produced by the {@code StructMethod}
	 * labeled alternative in {@link HazeParser#structcontent}.
	 * @param ctx the parse tree
	 */
	void enterStructMethod(HazeParser.StructMethodContext ctx);
	/**
	 * Exit a parse tree produced by the {@code StructMethod}
	 * labeled alternative in {@link HazeParser#structcontent}.
	 * @param ctx the parse tree
	 */
	void exitStructMethod(HazeParser.StructMethodContext ctx);
	/**
	 * Enter a parse tree produced by the {@code StructDecl}
	 * labeled alternative in {@link HazeParser#structdecl}.
	 * @param ctx the parse tree
	 */
	void enterStructDecl(HazeParser.StructDeclContext ctx);
	/**
	 * Exit a parse tree produced by the {@code StructDecl}
	 * labeled alternative in {@link HazeParser#structdecl}.
	 * @param ctx the parse tree
	 */
	void exitStructDecl(HazeParser.StructDeclContext ctx);
	/**
	 * Enter a parse tree produced by the {@code CommonDatatype}
	 * labeled alternative in {@link HazeParser#datatype}.
	 * @param ctx the parse tree
	 */
	void enterCommonDatatype(HazeParser.CommonDatatypeContext ctx);
	/**
	 * Exit a parse tree produced by the {@code CommonDatatype}
	 * labeled alternative in {@link HazeParser#datatype}.
	 * @param ctx the parse tree
	 */
	void exitCommonDatatype(HazeParser.CommonDatatypeContext ctx);
	/**
	 * Enter a parse tree produced by the {@code FunctionDatatype}
	 * labeled alternative in {@link HazeParser#datatype}.
	 * @param ctx the parse tree
	 */
	void enterFunctionDatatype(HazeParser.FunctionDatatypeContext ctx);
	/**
	 * Exit a parse tree produced by the {@code FunctionDatatype}
	 * labeled alternative in {@link HazeParser#datatype}.
	 * @param ctx the parse tree
	 */
	void exitFunctionDatatype(HazeParser.FunctionDatatypeContext ctx);
}