// Generated from Haze.g4 by ANTLR 4.13.2

import {ParseTreeListener} from "antlr4";


import { ProgContext } from "./HazeParser.js";
import { NamespacecontentContext } from "./HazeParser.js";
import { NamespaceContext } from "./HazeParser.js";
import { NamedfuncContext } from "./HazeParser.js";
import { FuncContext } from "./HazeParser.js";
import { FuncbodyContext } from "./HazeParser.js";
import { BodyContext } from "./HazeParser.js";
import { ParamContext } from "./HazeParser.js";
import { ParamsContext } from "./HazeParser.js";
import { CdefinitiondeclContext } from "./HazeParser.js";
import { FuncdeclContext } from "./HazeParser.js";
import { ExternlangContext } from "./HazeParser.js";
import { IfexprContext } from "./HazeParser.js";
import { ElseifexprContext } from "./HazeParser.js";
import { ThenblockContext } from "./HazeParser.js";
import { ElseifblockContext } from "./HazeParser.js";
import { ElseblockContext } from "./HazeParser.js";
import { VariableMutabilityContext } from "./HazeParser.js";
import { VariableDefinitionContext } from "./HazeParser.js";
import { VariableDeclarationContext } from "./HazeParser.js";
import { InlineCStatementContext } from "./HazeParser.js";
import { ExprStatementContext } from "./HazeParser.js";
import { ReturnStatementContext } from "./HazeParser.js";
import { VariableStatementContext } from "./HazeParser.js";
import { IfStatementContext } from "./HazeParser.js";
import { WhileStatementContext } from "./HazeParser.js";
import { StructMemberValueContext } from "./HazeParser.js";
import { SymbolValueExprContext } from "./HazeParser.js";
import { ParenthesisExprContext } from "./HazeParser.js";
import { ExprMemberAccessContext } from "./HazeParser.js";
import { BinaryExprContext } from "./HazeParser.js";
import { FuncRefExprContext } from "./HazeParser.js";
import { ConstantExprContext } from "./HazeParser.js";
import { PreIncrExprContext } from "./HazeParser.js";
import { StructInstantiationExprContext } from "./HazeParser.js";
import { UnaryExprContext } from "./HazeParser.js";
import { PostIncrExprContext } from "./HazeParser.js";
import { ExprCallExprContext } from "./HazeParser.js";
import { ExprAssignmentExprContext } from "./HazeParser.js";
import { ExplicitCastExprContext } from "./HazeParser.js";
import { ArgsContext } from "./HazeParser.js";
import { EllipsisContext } from "./HazeParser.js";
import { FunctypeContext } from "./HazeParser.js";
import { BooleanConstantContext } from "./HazeParser.js";
import { LiteralConstantContext } from "./HazeParser.js";
import { StringConstantContext } from "./HazeParser.js";
import { StructMemberContext } from "./HazeParser.js";
import { StructMethodContext } from "./HazeParser.js";
import { StructUnionFieldsContext } from "./HazeParser.js";
import { StructDeclContext } from "./HazeParser.js";
import { CommonDatatypeContext } from "./HazeParser.js";
import { FunctionDatatypeContext } from "./HazeParser.js";
import { DatatypeimplContext } from "./HazeParser.js";
import { GenericsvalueContext } from "./HazeParser.js";


/**
 * This interface defines a complete listener for a parse tree produced by
 * `HazeParser`.
 */
export default class HazeListener extends ParseTreeListener {
	/**
	 * Enter a parse tree produced by `HazeParser.prog`.
	 * @param ctx the parse tree
	 */
	enterProg?: (ctx: ProgContext) => void;
	/**
	 * Exit a parse tree produced by `HazeParser.prog`.
	 * @param ctx the parse tree
	 */
	exitProg?: (ctx: ProgContext) => void;
	/**
	 * Enter a parse tree produced by `HazeParser.namespacecontent`.
	 * @param ctx the parse tree
	 */
	enterNamespacecontent?: (ctx: NamespacecontentContext) => void;
	/**
	 * Exit a parse tree produced by `HazeParser.namespacecontent`.
	 * @param ctx the parse tree
	 */
	exitNamespacecontent?: (ctx: NamespacecontentContext) => void;
	/**
	 * Enter a parse tree produced by `HazeParser.namespace`.
	 * @param ctx the parse tree
	 */
	enterNamespace?: (ctx: NamespaceContext) => void;
	/**
	 * Exit a parse tree produced by `HazeParser.namespace`.
	 * @param ctx the parse tree
	 */
	exitNamespace?: (ctx: NamespaceContext) => void;
	/**
	 * Enter a parse tree produced by `HazeParser.namedfunc`.
	 * @param ctx the parse tree
	 */
	enterNamedfunc?: (ctx: NamedfuncContext) => void;
	/**
	 * Exit a parse tree produced by `HazeParser.namedfunc`.
	 * @param ctx the parse tree
	 */
	exitNamedfunc?: (ctx: NamedfuncContext) => void;
	/**
	 * Enter a parse tree produced by `HazeParser.func`.
	 * @param ctx the parse tree
	 */
	enterFunc?: (ctx: FuncContext) => void;
	/**
	 * Exit a parse tree produced by `HazeParser.func`.
	 * @param ctx the parse tree
	 */
	exitFunc?: (ctx: FuncContext) => void;
	/**
	 * Enter a parse tree produced by `HazeParser.funcbody`.
	 * @param ctx the parse tree
	 */
	enterFuncbody?: (ctx: FuncbodyContext) => void;
	/**
	 * Exit a parse tree produced by `HazeParser.funcbody`.
	 * @param ctx the parse tree
	 */
	exitFuncbody?: (ctx: FuncbodyContext) => void;
	/**
	 * Enter a parse tree produced by `HazeParser.body`.
	 * @param ctx the parse tree
	 */
	enterBody?: (ctx: BodyContext) => void;
	/**
	 * Exit a parse tree produced by `HazeParser.body`.
	 * @param ctx the parse tree
	 */
	exitBody?: (ctx: BodyContext) => void;
	/**
	 * Enter a parse tree produced by `HazeParser.param`.
	 * @param ctx the parse tree
	 */
	enterParam?: (ctx: ParamContext) => void;
	/**
	 * Exit a parse tree produced by `HazeParser.param`.
	 * @param ctx the parse tree
	 */
	exitParam?: (ctx: ParamContext) => void;
	/**
	 * Enter a parse tree produced by `HazeParser.params`.
	 * @param ctx the parse tree
	 */
	enterParams?: (ctx: ParamsContext) => void;
	/**
	 * Exit a parse tree produced by `HazeParser.params`.
	 * @param ctx the parse tree
	 */
	exitParams?: (ctx: ParamsContext) => void;
	/**
	 * Enter a parse tree produced by `HazeParser.cdefinitiondecl`.
	 * @param ctx the parse tree
	 */
	enterCdefinitiondecl?: (ctx: CdefinitiondeclContext) => void;
	/**
	 * Exit a parse tree produced by `HazeParser.cdefinitiondecl`.
	 * @param ctx the parse tree
	 */
	exitCdefinitiondecl?: (ctx: CdefinitiondeclContext) => void;
	/**
	 * Enter a parse tree produced by `HazeParser.funcdecl`.
	 * @param ctx the parse tree
	 */
	enterFuncdecl?: (ctx: FuncdeclContext) => void;
	/**
	 * Exit a parse tree produced by `HazeParser.funcdecl`.
	 * @param ctx the parse tree
	 */
	exitFuncdecl?: (ctx: FuncdeclContext) => void;
	/**
	 * Enter a parse tree produced by `HazeParser.externlang`.
	 * @param ctx the parse tree
	 */
	enterExternlang?: (ctx: ExternlangContext) => void;
	/**
	 * Exit a parse tree produced by `HazeParser.externlang`.
	 * @param ctx the parse tree
	 */
	exitExternlang?: (ctx: ExternlangContext) => void;
	/**
	 * Enter a parse tree produced by `HazeParser.ifexpr`.
	 * @param ctx the parse tree
	 */
	enterIfexpr?: (ctx: IfexprContext) => void;
	/**
	 * Exit a parse tree produced by `HazeParser.ifexpr`.
	 * @param ctx the parse tree
	 */
	exitIfexpr?: (ctx: IfexprContext) => void;
	/**
	 * Enter a parse tree produced by `HazeParser.elseifexpr`.
	 * @param ctx the parse tree
	 */
	enterElseifexpr?: (ctx: ElseifexprContext) => void;
	/**
	 * Exit a parse tree produced by `HazeParser.elseifexpr`.
	 * @param ctx the parse tree
	 */
	exitElseifexpr?: (ctx: ElseifexprContext) => void;
	/**
	 * Enter a parse tree produced by `HazeParser.thenblock`.
	 * @param ctx the parse tree
	 */
	enterThenblock?: (ctx: ThenblockContext) => void;
	/**
	 * Exit a parse tree produced by `HazeParser.thenblock`.
	 * @param ctx the parse tree
	 */
	exitThenblock?: (ctx: ThenblockContext) => void;
	/**
	 * Enter a parse tree produced by `HazeParser.elseifblock`.
	 * @param ctx the parse tree
	 */
	enterElseifblock?: (ctx: ElseifblockContext) => void;
	/**
	 * Exit a parse tree produced by `HazeParser.elseifblock`.
	 * @param ctx the parse tree
	 */
	exitElseifblock?: (ctx: ElseifblockContext) => void;
	/**
	 * Enter a parse tree produced by `HazeParser.elseblock`.
	 * @param ctx the parse tree
	 */
	enterElseblock?: (ctx: ElseblockContext) => void;
	/**
	 * Exit a parse tree produced by `HazeParser.elseblock`.
	 * @param ctx the parse tree
	 */
	exitElseblock?: (ctx: ElseblockContext) => void;
	/**
	 * Enter a parse tree produced by the `VariableMutability`
	 * labeled alternative in `HazeParser.variablemutability`.
	 * @param ctx the parse tree
	 */
	enterVariableMutability?: (ctx: VariableMutabilityContext) => void;
	/**
	 * Exit a parse tree produced by the `VariableMutability`
	 * labeled alternative in `HazeParser.variablemutability`.
	 * @param ctx the parse tree
	 */
	exitVariableMutability?: (ctx: VariableMutabilityContext) => void;
	/**
	 * Enter a parse tree produced by the `VariableDefinition`
	 * labeled alternative in `HazeParser.variablestatement`.
	 * @param ctx the parse tree
	 */
	enterVariableDefinition?: (ctx: VariableDefinitionContext) => void;
	/**
	 * Exit a parse tree produced by the `VariableDefinition`
	 * labeled alternative in `HazeParser.variablestatement`.
	 * @param ctx the parse tree
	 */
	exitVariableDefinition?: (ctx: VariableDefinitionContext) => void;
	/**
	 * Enter a parse tree produced by the `VariableDeclaration`
	 * labeled alternative in `HazeParser.variablestatement`.
	 * @param ctx the parse tree
	 */
	enterVariableDeclaration?: (ctx: VariableDeclarationContext) => void;
	/**
	 * Exit a parse tree produced by the `VariableDeclaration`
	 * labeled alternative in `HazeParser.variablestatement`.
	 * @param ctx the parse tree
	 */
	exitVariableDeclaration?: (ctx: VariableDeclarationContext) => void;
	/**
	 * Enter a parse tree produced by the `InlineCStatement`
	 * labeled alternative in `HazeParser.statement`.
	 * @param ctx the parse tree
	 */
	enterInlineCStatement?: (ctx: InlineCStatementContext) => void;
	/**
	 * Exit a parse tree produced by the `InlineCStatement`
	 * labeled alternative in `HazeParser.statement`.
	 * @param ctx the parse tree
	 */
	exitInlineCStatement?: (ctx: InlineCStatementContext) => void;
	/**
	 * Enter a parse tree produced by the `ExprStatement`
	 * labeled alternative in `HazeParser.statement`.
	 * @param ctx the parse tree
	 */
	enterExprStatement?: (ctx: ExprStatementContext) => void;
	/**
	 * Exit a parse tree produced by the `ExprStatement`
	 * labeled alternative in `HazeParser.statement`.
	 * @param ctx the parse tree
	 */
	exitExprStatement?: (ctx: ExprStatementContext) => void;
	/**
	 * Enter a parse tree produced by the `ReturnStatement`
	 * labeled alternative in `HazeParser.statement`.
	 * @param ctx the parse tree
	 */
	enterReturnStatement?: (ctx: ReturnStatementContext) => void;
	/**
	 * Exit a parse tree produced by the `ReturnStatement`
	 * labeled alternative in `HazeParser.statement`.
	 * @param ctx the parse tree
	 */
	exitReturnStatement?: (ctx: ReturnStatementContext) => void;
	/**
	 * Enter a parse tree produced by the `VariableStatement`
	 * labeled alternative in `HazeParser.statement`.
	 * @param ctx the parse tree
	 */
	enterVariableStatement?: (ctx: VariableStatementContext) => void;
	/**
	 * Exit a parse tree produced by the `VariableStatement`
	 * labeled alternative in `HazeParser.statement`.
	 * @param ctx the parse tree
	 */
	exitVariableStatement?: (ctx: VariableStatementContext) => void;
	/**
	 * Enter a parse tree produced by the `IfStatement`
	 * labeled alternative in `HazeParser.statement`.
	 * @param ctx the parse tree
	 */
	enterIfStatement?: (ctx: IfStatementContext) => void;
	/**
	 * Exit a parse tree produced by the `IfStatement`
	 * labeled alternative in `HazeParser.statement`.
	 * @param ctx the parse tree
	 */
	exitIfStatement?: (ctx: IfStatementContext) => void;
	/**
	 * Enter a parse tree produced by the `WhileStatement`
	 * labeled alternative in `HazeParser.statement`.
	 * @param ctx the parse tree
	 */
	enterWhileStatement?: (ctx: WhileStatementContext) => void;
	/**
	 * Exit a parse tree produced by the `WhileStatement`
	 * labeled alternative in `HazeParser.statement`.
	 * @param ctx the parse tree
	 */
	exitWhileStatement?: (ctx: WhileStatementContext) => void;
	/**
	 * Enter a parse tree produced by the `StructMemberValue`
	 * labeled alternative in `HazeParser.structmembervalue`.
	 * @param ctx the parse tree
	 */
	enterStructMemberValue?: (ctx: StructMemberValueContext) => void;
	/**
	 * Exit a parse tree produced by the `StructMemberValue`
	 * labeled alternative in `HazeParser.structmembervalue`.
	 * @param ctx the parse tree
	 */
	exitStructMemberValue?: (ctx: StructMemberValueContext) => void;
	/**
	 * Enter a parse tree produced by the `SymbolValueExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 */
	enterSymbolValueExpr?: (ctx: SymbolValueExprContext) => void;
	/**
	 * Exit a parse tree produced by the `SymbolValueExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 */
	exitSymbolValueExpr?: (ctx: SymbolValueExprContext) => void;
	/**
	 * Enter a parse tree produced by the `ParenthesisExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 */
	enterParenthesisExpr?: (ctx: ParenthesisExprContext) => void;
	/**
	 * Exit a parse tree produced by the `ParenthesisExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 */
	exitParenthesisExpr?: (ctx: ParenthesisExprContext) => void;
	/**
	 * Enter a parse tree produced by the `ExprMemberAccess`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 */
	enterExprMemberAccess?: (ctx: ExprMemberAccessContext) => void;
	/**
	 * Exit a parse tree produced by the `ExprMemberAccess`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 */
	exitExprMemberAccess?: (ctx: ExprMemberAccessContext) => void;
	/**
	 * Enter a parse tree produced by the `BinaryExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 */
	enterBinaryExpr?: (ctx: BinaryExprContext) => void;
	/**
	 * Exit a parse tree produced by the `BinaryExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 */
	exitBinaryExpr?: (ctx: BinaryExprContext) => void;
	/**
	 * Enter a parse tree produced by the `FuncRefExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 */
	enterFuncRefExpr?: (ctx: FuncRefExprContext) => void;
	/**
	 * Exit a parse tree produced by the `FuncRefExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 */
	exitFuncRefExpr?: (ctx: FuncRefExprContext) => void;
	/**
	 * Enter a parse tree produced by the `ConstantExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 */
	enterConstantExpr?: (ctx: ConstantExprContext) => void;
	/**
	 * Exit a parse tree produced by the `ConstantExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 */
	exitConstantExpr?: (ctx: ConstantExprContext) => void;
	/**
	 * Enter a parse tree produced by the `PreIncrExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 */
	enterPreIncrExpr?: (ctx: PreIncrExprContext) => void;
	/**
	 * Exit a parse tree produced by the `PreIncrExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 */
	exitPreIncrExpr?: (ctx: PreIncrExprContext) => void;
	/**
	 * Enter a parse tree produced by the `StructInstantiationExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 */
	enterStructInstantiationExpr?: (ctx: StructInstantiationExprContext) => void;
	/**
	 * Exit a parse tree produced by the `StructInstantiationExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 */
	exitStructInstantiationExpr?: (ctx: StructInstantiationExprContext) => void;
	/**
	 * Enter a parse tree produced by the `UnaryExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 */
	enterUnaryExpr?: (ctx: UnaryExprContext) => void;
	/**
	 * Exit a parse tree produced by the `UnaryExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 */
	exitUnaryExpr?: (ctx: UnaryExprContext) => void;
	/**
	 * Enter a parse tree produced by the `PostIncrExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 */
	enterPostIncrExpr?: (ctx: PostIncrExprContext) => void;
	/**
	 * Exit a parse tree produced by the `PostIncrExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 */
	exitPostIncrExpr?: (ctx: PostIncrExprContext) => void;
	/**
	 * Enter a parse tree produced by the `ExprCallExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 */
	enterExprCallExpr?: (ctx: ExprCallExprContext) => void;
	/**
	 * Exit a parse tree produced by the `ExprCallExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 */
	exitExprCallExpr?: (ctx: ExprCallExprContext) => void;
	/**
	 * Enter a parse tree produced by the `ExprAssignmentExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 */
	enterExprAssignmentExpr?: (ctx: ExprAssignmentExprContext) => void;
	/**
	 * Exit a parse tree produced by the `ExprAssignmentExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 */
	exitExprAssignmentExpr?: (ctx: ExprAssignmentExprContext) => void;
	/**
	 * Enter a parse tree produced by the `ExplicitCastExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 */
	enterExplicitCastExpr?: (ctx: ExplicitCastExprContext) => void;
	/**
	 * Exit a parse tree produced by the `ExplicitCastExpr`
	 * labeled alternative in `HazeParser.expr`.
	 * @param ctx the parse tree
	 */
	exitExplicitCastExpr?: (ctx: ExplicitCastExprContext) => void;
	/**
	 * Enter a parse tree produced by `HazeParser.args`.
	 * @param ctx the parse tree
	 */
	enterArgs?: (ctx: ArgsContext) => void;
	/**
	 * Exit a parse tree produced by `HazeParser.args`.
	 * @param ctx the parse tree
	 */
	exitArgs?: (ctx: ArgsContext) => void;
	/**
	 * Enter a parse tree produced by `HazeParser.ellipsis`.
	 * @param ctx the parse tree
	 */
	enterEllipsis?: (ctx: EllipsisContext) => void;
	/**
	 * Exit a parse tree produced by `HazeParser.ellipsis`.
	 * @param ctx the parse tree
	 */
	exitEllipsis?: (ctx: EllipsisContext) => void;
	/**
	 * Enter a parse tree produced by `HazeParser.functype`.
	 * @param ctx the parse tree
	 */
	enterFunctype?: (ctx: FunctypeContext) => void;
	/**
	 * Exit a parse tree produced by `HazeParser.functype`.
	 * @param ctx the parse tree
	 */
	exitFunctype?: (ctx: FunctypeContext) => void;
	/**
	 * Enter a parse tree produced by the `BooleanConstant`
	 * labeled alternative in `HazeParser.constant`.
	 * @param ctx the parse tree
	 */
	enterBooleanConstant?: (ctx: BooleanConstantContext) => void;
	/**
	 * Exit a parse tree produced by the `BooleanConstant`
	 * labeled alternative in `HazeParser.constant`.
	 * @param ctx the parse tree
	 */
	exitBooleanConstant?: (ctx: BooleanConstantContext) => void;
	/**
	 * Enter a parse tree produced by the `LiteralConstant`
	 * labeled alternative in `HazeParser.constant`.
	 * @param ctx the parse tree
	 */
	enterLiteralConstant?: (ctx: LiteralConstantContext) => void;
	/**
	 * Exit a parse tree produced by the `LiteralConstant`
	 * labeled alternative in `HazeParser.constant`.
	 * @param ctx the parse tree
	 */
	exitLiteralConstant?: (ctx: LiteralConstantContext) => void;
	/**
	 * Enter a parse tree produced by the `StringConstant`
	 * labeled alternative in `HazeParser.constant`.
	 * @param ctx the parse tree
	 */
	enterStringConstant?: (ctx: StringConstantContext) => void;
	/**
	 * Exit a parse tree produced by the `StringConstant`
	 * labeled alternative in `HazeParser.constant`.
	 * @param ctx the parse tree
	 */
	exitStringConstant?: (ctx: StringConstantContext) => void;
	/**
	 * Enter a parse tree produced by the `StructMember`
	 * labeled alternative in `HazeParser.structcontent`.
	 * @param ctx the parse tree
	 */
	enterStructMember?: (ctx: StructMemberContext) => void;
	/**
	 * Exit a parse tree produced by the `StructMember`
	 * labeled alternative in `HazeParser.structcontent`.
	 * @param ctx the parse tree
	 */
	exitStructMember?: (ctx: StructMemberContext) => void;
	/**
	 * Enter a parse tree produced by the `StructMethod`
	 * labeled alternative in `HazeParser.structcontent`.
	 * @param ctx the parse tree
	 */
	enterStructMethod?: (ctx: StructMethodContext) => void;
	/**
	 * Exit a parse tree produced by the `StructMethod`
	 * labeled alternative in `HazeParser.structcontent`.
	 * @param ctx the parse tree
	 */
	exitStructMethod?: (ctx: StructMethodContext) => void;
	/**
	 * Enter a parse tree produced by the `StructUnionFields`
	 * labeled alternative in `HazeParser.structcontent`.
	 * @param ctx the parse tree
	 */
	enterStructUnionFields?: (ctx: StructUnionFieldsContext) => void;
	/**
	 * Exit a parse tree produced by the `StructUnionFields`
	 * labeled alternative in `HazeParser.structcontent`.
	 * @param ctx the parse tree
	 */
	exitStructUnionFields?: (ctx: StructUnionFieldsContext) => void;
	/**
	 * Enter a parse tree produced by the `StructDecl`
	 * labeled alternative in `HazeParser.structdecl`.
	 * @param ctx the parse tree
	 */
	enterStructDecl?: (ctx: StructDeclContext) => void;
	/**
	 * Exit a parse tree produced by the `StructDecl`
	 * labeled alternative in `HazeParser.structdecl`.
	 * @param ctx the parse tree
	 */
	exitStructDecl?: (ctx: StructDeclContext) => void;
	/**
	 * Enter a parse tree produced by the `CommonDatatype`
	 * labeled alternative in `HazeParser.datatype`.
	 * @param ctx the parse tree
	 */
	enterCommonDatatype?: (ctx: CommonDatatypeContext) => void;
	/**
	 * Exit a parse tree produced by the `CommonDatatype`
	 * labeled alternative in `HazeParser.datatype`.
	 * @param ctx the parse tree
	 */
	exitCommonDatatype?: (ctx: CommonDatatypeContext) => void;
	/**
	 * Enter a parse tree produced by the `FunctionDatatype`
	 * labeled alternative in `HazeParser.datatype`.
	 * @param ctx the parse tree
	 */
	enterFunctionDatatype?: (ctx: FunctionDatatypeContext) => void;
	/**
	 * Exit a parse tree produced by the `FunctionDatatype`
	 * labeled alternative in `HazeParser.datatype`.
	 * @param ctx the parse tree
	 */
	exitFunctionDatatype?: (ctx: FunctionDatatypeContext) => void;
	/**
	 * Enter a parse tree produced by `HazeParser.datatypeimpl`.
	 * @param ctx the parse tree
	 */
	enterDatatypeimpl?: (ctx: DatatypeimplContext) => void;
	/**
	 * Exit a parse tree produced by `HazeParser.datatypeimpl`.
	 * @param ctx the parse tree
	 */
	exitDatatypeimpl?: (ctx: DatatypeimplContext) => void;
	/**
	 * Enter a parse tree produced by `HazeParser.genericsvalue`.
	 * @param ctx the parse tree
	 */
	enterGenericsvalue?: (ctx: GenericsvalueContext) => void;
	/**
	 * Exit a parse tree produced by `HazeParser.genericsvalue`.
	 * @param ctx the parse tree
	 */
	exitGenericsvalue?: (ctx: GenericsvalueContext) => void;
}

