// Generated from Haze.g4 by ANTLR 4.13.2

import {ParseTreeVisitor} from 'antlr4';


import { ProgContext } from "./HazeParser.js";
import { NamedfuncContext } from "./HazeParser.js";
import { FuncContext } from "./HazeParser.js";
import { FuncbodyContext } from "./HazeParser.js";
import { BodyContext } from "./HazeParser.js";
import { ParamContext } from "./HazeParser.js";
import { ParamsContext } from "./HazeParser.js";
import { FuncdeclContext } from "./HazeParser.js";
import { ExternlangContext } from "./HazeParser.js";
import { IfexprContext } from "./HazeParser.js";
import { ElseifexprContext } from "./HazeParser.js";
import { ThenblockContext } from "./HazeParser.js";
import { ElseifblockContext } from "./HazeParser.js";
import { ElseblockContext } from "./HazeParser.js";
import { VariableMutabilityContext } from "./HazeParser.js";
import { InlineCStatementContext } from "./HazeParser.js";
import { ExprStatementContext } from "./HazeParser.js";
import { ReturnStatementContext } from "./HazeParser.js";
import { ExprAssignmentStatementContext } from "./HazeParser.js";
import { VariableDefinitionContext } from "./HazeParser.js";
import { IfStatementContext } from "./HazeParser.js";
import { WhileStatementContext } from "./HazeParser.js";
import { StructMemberValueContext } from "./HazeParser.js";
import { SymbolValueExprContext } from "./HazeParser.js";
import { ExprCallExprContext } from "./HazeParser.js";
import { ParenthesisExprContext } from "./HazeParser.js";
import { ExprMemberAccessContext } from "./HazeParser.js";
import { BinaryExprContext } from "./HazeParser.js";
import { FuncRefExprContext } from "./HazeParser.js";
import { ConstantExprContext } from "./HazeParser.js";
import { StructInstantiationExprContext } from "./HazeParser.js";
import { UnaryExprContext } from "./HazeParser.js";
import { ExplicitCastExprContext } from "./HazeParser.js";
import { ArgsContext } from "./HazeParser.js";
import { EllipsisContext } from "./HazeParser.js";
import { FunctypeContext } from "./HazeParser.js";
import { IntegerConstantContext } from "./HazeParser.js";
import { StringConstantContext } from "./HazeParser.js";
import { BooleanConstantContext } from "./HazeParser.js";
import { CompilationhintContext } from "./HazeParser.js";
import { CompilationhintfilenameContext } from "./HazeParser.js";
import { CompilationhintflagsContext } from "./HazeParser.js";
import { CompilationlangContext } from "./HazeParser.js";
import { LinkerhintContext } from "./HazeParser.js";
import { StructMemberContext } from "./HazeParser.js";
import { StructMethodContext } from "./HazeParser.js";
import { StructDeclContext } from "./HazeParser.js";
import { CommonDatatypeContext } from "./HazeParser.js";
import { FunctionDatatypeContext } from "./HazeParser.js";


/**
 * This interface defines a complete generic visitor for a parse tree produced
 * by `HazeParser`.
 *
 * @param <Result> The return type of the visit operation. Use `void` for
 * operations with no return type.
 */
export default class HazeVisitor<Result> extends ParseTreeVisitor<Result> {
	/**
	 * Visit a parse tree produced by `HazeParser.prog`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitProg?: (ctx: ProgContext) => Result;
	/**
	 * Visit a parse tree produced by `HazeParser.namedfunc`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitNamedfunc?: (ctx: NamedfuncContext) => Result;
	/**
	 * Visit a parse tree produced by `HazeParser.func`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitFunc?: (ctx: FuncContext) => Result;
	/**
	 * Visit a parse tree produced by `HazeParser.funcbody`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitFuncbody?: (ctx: FuncbodyContext) => Result;
	/**
	 * Visit a parse tree produced by `HazeParser.body`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitBody?: (ctx: BodyContext) => Result;
	/**
	 * Visit a parse tree produced by `HazeParser.param`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitParam?: (ctx: ParamContext) => Result;
	/**
	 * Visit a parse tree produced by `HazeParser.params`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitParams?: (ctx: ParamsContext) => Result;
	/**
	 * Visit a parse tree produced by `HazeParser.funcdecl`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitFuncdecl?: (ctx: FuncdeclContext) => Result;
	/**
	 * Visit a parse tree produced by `HazeParser.externlang`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitExternlang?: (ctx: ExternlangContext) => Result;
	/**
	 * Visit a parse tree produced by `HazeParser.ifexpr`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitIfexpr?: (ctx: IfexprContext) => Result;
	/**
	 * Visit a parse tree produced by `HazeParser.elseifexpr`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitElseifexpr?: (ctx: ElseifexprContext) => Result;
	/**
	 * Visit a parse tree produced by `HazeParser.thenblock`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitThenblock?: (ctx: ThenblockContext) => Result;
	/**
	 * Visit a parse tree produced by `HazeParser.elseifblock`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitElseifblock?: (ctx: ElseifblockContext) => Result;
	/**
	 * Visit a parse tree produced by `HazeParser.elseblock`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitElseblock?: (ctx: ElseblockContext) => Result;
	/**
	 * Visit a parse tree produced by the `VariableMutability`
	 * labeled alternative in `HazeParser.variablemutability`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitVariableMutability?: (ctx: VariableMutabilityContext) => Result;
	/**
	 * Visit a parse tree produced by the `InlineCStatement`
	 * labeled alternative in `HazeParser.statement`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitInlineCStatement?: (ctx: InlineCStatementContext) => Result;
	/**
	 * Visit a parse tree produced by the `ExprStatement`
	 * labeled alternative in `HazeParser.statement`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitExprStatement?: (ctx: ExprStatementContext) => Result;
	/**
	 * Visit a parse tree produced by the `ReturnStatement`
	 * labeled alternative in `HazeParser.statement`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitReturnStatement?: (ctx: ReturnStatementContext) => Result;
	/**
	 * Visit a parse tree produced by the `ExprAssignmentStatement`
	 * labeled alternative in `HazeParser.statement`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitExprAssignmentStatement?: (ctx: ExprAssignmentStatementContext) => Result;
	/**
	 * Visit a parse tree produced by the `VariableDefinition`
	 * labeled alternative in `HazeParser.statement`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitVariableDefinition?: (ctx: VariableDefinitionContext) => Result;
	/**
	 * Visit a parse tree produced by the `IfStatement`
	 * labeled alternative in `HazeParser.statement`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitIfStatement?: (ctx: IfStatementContext) => Result;
	/**
	 * Visit a parse tree produced by the `WhileStatement`
	 * labeled alternative in `HazeParser.statement`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitWhileStatement?: (ctx: WhileStatementContext) => Result;
	/**
	 * Visit a parse tree produced by the `StructMemberValue`
	 * labeled alternative in `HazeParser.structmembervalue`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitStructMemberValue?: (ctx: StructMemberValueContext) => Result;
	/**
	 * Visit a parse tree produced by the `SymbolValueExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitSymbolValueExpr?: (ctx: SymbolValueExprContext) => Result;
	/**
	 * Visit a parse tree produced by the `ExprCallExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitExprCallExpr?: (ctx: ExprCallExprContext) => Result;
	/**
	 * Visit a parse tree produced by the `ParenthesisExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitParenthesisExpr?: (ctx: ParenthesisExprContext) => Result;
	/**
	 * Visit a parse tree produced by the `ExprMemberAccess`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitExprMemberAccess?: (ctx: ExprMemberAccessContext) => Result;
	/**
	 * Visit a parse tree produced by the `BinaryExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitBinaryExpr?: (ctx: BinaryExprContext) => Result;
	/**
	 * Visit a parse tree produced by the `FuncRefExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitFuncRefExpr?: (ctx: FuncRefExprContext) => Result;
	/**
	 * Visit a parse tree produced by the `ConstantExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitConstantExpr?: (ctx: ConstantExprContext) => Result;
	/**
	 * Visit a parse tree produced by the `StructInstantiationExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitStructInstantiationExpr?: (ctx: StructInstantiationExprContext) => Result;
	/**
	 * Visit a parse tree produced by the `UnaryExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitUnaryExpr?: (ctx: UnaryExprContext) => Result;
	/**
	 * Visit a parse tree produced by the `ExplicitCastExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitExplicitCastExpr?: (ctx: ExplicitCastExprContext) => Result;
	/**
	 * Visit a parse tree produced by `HazeParser.args`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitArgs?: (ctx: ArgsContext) => Result;
	/**
	 * Visit a parse tree produced by `HazeParser.ellipsis`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitEllipsis?: (ctx: EllipsisContext) => Result;
	/**
	 * Visit a parse tree produced by `HazeParser.functype`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitFunctype?: (ctx: FunctypeContext) => Result;
	/**
	 * Visit a parse tree produced by the `IntegerConstant`
	 * labeled alternative in `HazeParser.constant`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitIntegerConstant?: (ctx: IntegerConstantContext) => Result;
	/**
	 * Visit a parse tree produced by the `StringConstant`
	 * labeled alternative in `HazeParser.constant`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitStringConstant?: (ctx: StringConstantContext) => Result;
	/**
	 * Visit a parse tree produced by the `BooleanConstant`
	 * labeled alternative in `HazeParser.constant`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitBooleanConstant?: (ctx: BooleanConstantContext) => Result;
	/**
	 * Visit a parse tree produced by `HazeParser.compilationhint`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitCompilationhint?: (ctx: CompilationhintContext) => Result;
	/**
	 * Visit a parse tree produced by `HazeParser.compilationhintfilename`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitCompilationhintfilename?: (ctx: CompilationhintfilenameContext) => Result;
	/**
	 * Visit a parse tree produced by `HazeParser.compilationhintflags`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitCompilationhintflags?: (ctx: CompilationhintflagsContext) => Result;
	/**
	 * Visit a parse tree produced by `HazeParser.compilationlang`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitCompilationlang?: (ctx: CompilationlangContext) => Result;
	/**
	 * Visit a parse tree produced by `HazeParser.linkerhint`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitLinkerhint?: (ctx: LinkerhintContext) => Result;
	/**
	 * Visit a parse tree produced by the `StructMember`
	 * labeled alternative in `HazeParser.structcontent`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitStructMember?: (ctx: StructMemberContext) => Result;
	/**
	 * Visit a parse tree produced by the `StructMethod`
	 * labeled alternative in `HazeParser.structcontent`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitStructMethod?: (ctx: StructMethodContext) => Result;
	/**
	 * Visit a parse tree produced by the `StructDecl`
	 * labeled alternative in `HazeParser.structdecl`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitStructDecl?: (ctx: StructDeclContext) => Result;
	/**
	 * Visit a parse tree produced by the `CommonDatatype`
	 * labeled alternative in `HazeParser.datatype`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitCommonDatatype?: (ctx: CommonDatatypeContext) => Result;
	/**
	 * Visit a parse tree produced by the `FunctionDatatype`
	 * labeled alternative in `HazeParser.datatype`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitFunctionDatatype?: (ctx: FunctionDatatypeContext) => Result;
}

