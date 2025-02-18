// Generated from Haze.g4 by ANTLR 4.13.2

import {ParseTreeVisitor} from 'antlr4';


import { ProgContext } from "./HazeParser.js";
import { NamedfuncContext } from "./HazeParser.js";
import { FuncContext } from "./HazeParser.js";
import { FuncbodyContext } from "./HazeParser.js";
import { BodyContext } from "./HazeParser.js";
import { ParamContext } from "./HazeParser.js";
import { ParamsContext } from "./HazeParser.js";
import { ExternfuncdefContext } from "./HazeParser.js";
import { ExternblockContext } from "./HazeParser.js";
import { ExternlangContext } from "./HazeParser.js";
import { IfexprContext } from "./HazeParser.js";
import { ElseifexprContext } from "./HazeParser.js";
import { ThenblockContext } from "./HazeParser.js";
import { ElseifblockContext } from "./HazeParser.js";
import { ElseblockContext } from "./HazeParser.js";
import { InlineCStatementContext } from "./HazeParser.js";
import { ExprStatementContext } from "./HazeParser.js";
import { ReturnStatementContext } from "./HazeParser.js";
import { ExprAssignmentStatementContext } from "./HazeParser.js";
import { MutableVariableDefinitionContext } from "./HazeParser.js";
import { ImmutableVariableDefinitionContext } from "./HazeParser.js";
import { IfStatementContext } from "./HazeParser.js";
import { ObjectAttrContext } from "./HazeParser.js";
import { SymbolValueExprContext } from "./HazeParser.js";
import { ExprCallExprContext } from "./HazeParser.js";
import { ObjectExprContext } from "./HazeParser.js";
import { ExprMemberAccessContext } from "./HazeParser.js";
import { NamedObjectExprContext } from "./HazeParser.js";
import { BinaryExprContext } from "./HazeParser.js";
import { FuncRefExprContext } from "./HazeParser.js";
import { ConstantExprContext } from "./HazeParser.js";
import { BracketExprContext } from "./HazeParser.js";
import { ArgsContext } from "./HazeParser.js";
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
	 * Visit a parse tree produced by `HazeParser.externfuncdef`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitExternfuncdef?: (ctx: ExternfuncdefContext) => Result;
	/**
	 * Visit a parse tree produced by `HazeParser.externblock`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitExternblock?: (ctx: ExternblockContext) => Result;
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
	 * Visit a parse tree produced by the `MutableVariableDefinition`
	 * labeled alternative in `HazeParser.statement`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitMutableVariableDefinition?: (ctx: MutableVariableDefinitionContext) => Result;
	/**
	 * Visit a parse tree produced by the `ImmutableVariableDefinition`
	 * labeled alternative in `HazeParser.statement`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitImmutableVariableDefinition?: (ctx: ImmutableVariableDefinitionContext) => Result;
	/**
	 * Visit a parse tree produced by the `IfStatement`
	 * labeled alternative in `HazeParser.statement`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitIfStatement?: (ctx: IfStatementContext) => Result;
	/**
	 * Visit a parse tree produced by the `ObjectAttr`
	 * labeled alternative in `HazeParser.objectattribute`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitObjectAttr?: (ctx: ObjectAttrContext) => Result;
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
	 * Visit a parse tree produced by the `ObjectExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitObjectExpr?: (ctx: ObjectExprContext) => Result;
	/**
	 * Visit a parse tree produced by the `ExprMemberAccess`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitExprMemberAccess?: (ctx: ExprMemberAccessContext) => Result;
	/**
	 * Visit a parse tree produced by the `NamedObjectExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitNamedObjectExpr?: (ctx: NamedObjectExprContext) => Result;
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
	 * Visit a parse tree produced by the `BracketExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitBracketExpr?: (ctx: BracketExprContext) => Result;
	/**
	 * Visit a parse tree produced by `HazeParser.args`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitArgs?: (ctx: ArgsContext) => Result;
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

