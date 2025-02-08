# Generated from Haze.g4 by ANTLR 4.13.2
from antlr4 import *
if "." in __name__:
    from .HazeParser import HazeParser
else:
    from HazeParser import HazeParser

# This class defines a complete listener for a parse tree produced by HazeParser.
class HazeListener(ParseTreeListener):

    # Enter a parse tree produced by HazeParser#prog.
    def enterProg(self, ctx:HazeParser.ProgContext):
        pass

    # Exit a parse tree produced by HazeParser#prog.
    def exitProg(self, ctx:HazeParser.ProgContext):
        pass


    # Enter a parse tree produced by HazeParser#namedfunc.
    def enterNamedfunc(self, ctx:HazeParser.NamedfuncContext):
        pass

    # Exit a parse tree produced by HazeParser#namedfunc.
    def exitNamedfunc(self, ctx:HazeParser.NamedfuncContext):
        pass


    # Enter a parse tree produced by HazeParser#func.
    def enterFunc(self, ctx:HazeParser.FuncContext):
        pass

    # Exit a parse tree produced by HazeParser#func.
    def exitFunc(self, ctx:HazeParser.FuncContext):
        pass


    # Enter a parse tree produced by HazeParser#funcbody.
    def enterFuncbody(self, ctx:HazeParser.FuncbodyContext):
        pass

    # Exit a parse tree produced by HazeParser#funcbody.
    def exitFuncbody(self, ctx:HazeParser.FuncbodyContext):
        pass


    # Enter a parse tree produced by HazeParser#body.
    def enterBody(self, ctx:HazeParser.BodyContext):
        pass

    # Exit a parse tree produced by HazeParser#body.
    def exitBody(self, ctx:HazeParser.BodyContext):
        pass


    # Enter a parse tree produced by HazeParser#param.
    def enterParam(self, ctx:HazeParser.ParamContext):
        pass

    # Exit a parse tree produced by HazeParser#param.
    def exitParam(self, ctx:HazeParser.ParamContext):
        pass


    # Enter a parse tree produced by HazeParser#params.
    def enterParams(self, ctx:HazeParser.ParamsContext):
        pass

    # Exit a parse tree produced by HazeParser#params.
    def exitParams(self, ctx:HazeParser.ParamsContext):
        pass


    # Enter a parse tree produced by HazeParser#externfuncdef.
    def enterExternfuncdef(self, ctx:HazeParser.ExternfuncdefContext):
        pass

    # Exit a parse tree produced by HazeParser#externfuncdef.
    def exitExternfuncdef(self, ctx:HazeParser.ExternfuncdefContext):
        pass


    # Enter a parse tree produced by HazeParser#externblock.
    def enterExternblock(self, ctx:HazeParser.ExternblockContext):
        pass

    # Exit a parse tree produced by HazeParser#externblock.
    def exitExternblock(self, ctx:HazeParser.ExternblockContext):
        pass


    # Enter a parse tree produced by HazeParser#externlang.
    def enterExternlang(self, ctx:HazeParser.ExternlangContext):
        pass

    # Exit a parse tree produced by HazeParser#externlang.
    def exitExternlang(self, ctx:HazeParser.ExternlangContext):
        pass


    # Enter a parse tree produced by HazeParser#ifexpr.
    def enterIfexpr(self, ctx:HazeParser.IfexprContext):
        pass

    # Exit a parse tree produced by HazeParser#ifexpr.
    def exitIfexpr(self, ctx:HazeParser.IfexprContext):
        pass


    # Enter a parse tree produced by HazeParser#elseifexpr.
    def enterElseifexpr(self, ctx:HazeParser.ElseifexprContext):
        pass

    # Exit a parse tree produced by HazeParser#elseifexpr.
    def exitElseifexpr(self, ctx:HazeParser.ElseifexprContext):
        pass


    # Enter a parse tree produced by HazeParser#thenblock.
    def enterThenblock(self, ctx:HazeParser.ThenblockContext):
        pass

    # Exit a parse tree produced by HazeParser#thenblock.
    def exitThenblock(self, ctx:HazeParser.ThenblockContext):
        pass


    # Enter a parse tree produced by HazeParser#elseifblock.
    def enterElseifblock(self, ctx:HazeParser.ElseifblockContext):
        pass

    # Exit a parse tree produced by HazeParser#elseifblock.
    def exitElseifblock(self, ctx:HazeParser.ElseifblockContext):
        pass


    # Enter a parse tree produced by HazeParser#elseblock.
    def enterElseblock(self, ctx:HazeParser.ElseblockContext):
        pass

    # Exit a parse tree produced by HazeParser#elseblock.
    def exitElseblock(self, ctx:HazeParser.ElseblockContext):
        pass


    # Enter a parse tree produced by HazeParser#InlineCStatement.
    def enterInlineCStatement(self, ctx:HazeParser.InlineCStatementContext):
        pass

    # Exit a parse tree produced by HazeParser#InlineCStatement.
    def exitInlineCStatement(self, ctx:HazeParser.InlineCStatementContext):
        pass


    # Enter a parse tree produced by HazeParser#ExprStatement.
    def enterExprStatement(self, ctx:HazeParser.ExprStatementContext):
        pass

    # Exit a parse tree produced by HazeParser#ExprStatement.
    def exitExprStatement(self, ctx:HazeParser.ExprStatementContext):
        pass


    # Enter a parse tree produced by HazeParser#ReturnStatement.
    def enterReturnStatement(self, ctx:HazeParser.ReturnStatementContext):
        pass

    # Exit a parse tree produced by HazeParser#ReturnStatement.
    def exitReturnStatement(self, ctx:HazeParser.ReturnStatementContext):
        pass


    # Enter a parse tree produced by HazeParser#ExprAssignmentStatement.
    def enterExprAssignmentStatement(self, ctx:HazeParser.ExprAssignmentStatementContext):
        pass

    # Exit a parse tree produced by HazeParser#ExprAssignmentStatement.
    def exitExprAssignmentStatement(self, ctx:HazeParser.ExprAssignmentStatementContext):
        pass


    # Enter a parse tree produced by HazeParser#MutableVariableDefinition.
    def enterMutableVariableDefinition(self, ctx:HazeParser.MutableVariableDefinitionContext):
        pass

    # Exit a parse tree produced by HazeParser#MutableVariableDefinition.
    def exitMutableVariableDefinition(self, ctx:HazeParser.MutableVariableDefinitionContext):
        pass


    # Enter a parse tree produced by HazeParser#ImmutableVariableDefinition.
    def enterImmutableVariableDefinition(self, ctx:HazeParser.ImmutableVariableDefinitionContext):
        pass

    # Exit a parse tree produced by HazeParser#ImmutableVariableDefinition.
    def exitImmutableVariableDefinition(self, ctx:HazeParser.ImmutableVariableDefinitionContext):
        pass


    # Enter a parse tree produced by HazeParser#IfStatement.
    def enterIfStatement(self, ctx:HazeParser.IfStatementContext):
        pass

    # Exit a parse tree produced by HazeParser#IfStatement.
    def exitIfStatement(self, ctx:HazeParser.IfStatementContext):
        pass


    # Enter a parse tree produced by HazeParser#ObjectAttr.
    def enterObjectAttr(self, ctx:HazeParser.ObjectAttrContext):
        pass

    # Exit a parse tree produced by HazeParser#ObjectAttr.
    def exitObjectAttr(self, ctx:HazeParser.ObjectAttrContext):
        pass


    # Enter a parse tree produced by HazeParser#SymbolValueExpr.
    def enterSymbolValueExpr(self, ctx:HazeParser.SymbolValueExprContext):
        pass

    # Exit a parse tree produced by HazeParser#SymbolValueExpr.
    def exitSymbolValueExpr(self, ctx:HazeParser.SymbolValueExprContext):
        pass


    # Enter a parse tree produced by HazeParser#ExprCallExpr.
    def enterExprCallExpr(self, ctx:HazeParser.ExprCallExprContext):
        pass

    # Exit a parse tree produced by HazeParser#ExprCallExpr.
    def exitExprCallExpr(self, ctx:HazeParser.ExprCallExprContext):
        pass


    # Enter a parse tree produced by HazeParser#ObjectExpr.
    def enterObjectExpr(self, ctx:HazeParser.ObjectExprContext):
        pass

    # Exit a parse tree produced by HazeParser#ObjectExpr.
    def exitObjectExpr(self, ctx:HazeParser.ObjectExprContext):
        pass


    # Enter a parse tree produced by HazeParser#ExprMemberAccess.
    def enterExprMemberAccess(self, ctx:HazeParser.ExprMemberAccessContext):
        pass

    # Exit a parse tree produced by HazeParser#ExprMemberAccess.
    def exitExprMemberAccess(self, ctx:HazeParser.ExprMemberAccessContext):
        pass


    # Enter a parse tree produced by HazeParser#NamedObjectExpr.
    def enterNamedObjectExpr(self, ctx:HazeParser.NamedObjectExprContext):
        pass

    # Exit a parse tree produced by HazeParser#NamedObjectExpr.
    def exitNamedObjectExpr(self, ctx:HazeParser.NamedObjectExprContext):
        pass


    # Enter a parse tree produced by HazeParser#BinaryExpr.
    def enterBinaryExpr(self, ctx:HazeParser.BinaryExprContext):
        pass

    # Exit a parse tree produced by HazeParser#BinaryExpr.
    def exitBinaryExpr(self, ctx:HazeParser.BinaryExprContext):
        pass


    # Enter a parse tree produced by HazeParser#FuncRefExpr.
    def enterFuncRefExpr(self, ctx:HazeParser.FuncRefExprContext):
        pass

    # Exit a parse tree produced by HazeParser#FuncRefExpr.
    def exitFuncRefExpr(self, ctx:HazeParser.FuncRefExprContext):
        pass


    # Enter a parse tree produced by HazeParser#ConstantExpr.
    def enterConstantExpr(self, ctx:HazeParser.ConstantExprContext):
        pass

    # Exit a parse tree produced by HazeParser#ConstantExpr.
    def exitConstantExpr(self, ctx:HazeParser.ConstantExprContext):
        pass


    # Enter a parse tree produced by HazeParser#BracketExpr.
    def enterBracketExpr(self, ctx:HazeParser.BracketExprContext):
        pass

    # Exit a parse tree produced by HazeParser#BracketExpr.
    def exitBracketExpr(self, ctx:HazeParser.BracketExprContext):
        pass


    # Enter a parse tree produced by HazeParser#args.
    def enterArgs(self, ctx:HazeParser.ArgsContext):
        pass

    # Exit a parse tree produced by HazeParser#args.
    def exitArgs(self, ctx:HazeParser.ArgsContext):
        pass


    # Enter a parse tree produced by HazeParser#functype.
    def enterFunctype(self, ctx:HazeParser.FunctypeContext):
        pass

    # Exit a parse tree produced by HazeParser#functype.
    def exitFunctype(self, ctx:HazeParser.FunctypeContext):
        pass


    # Enter a parse tree produced by HazeParser#returntype.
    def enterReturntype(self, ctx:HazeParser.ReturntypeContext):
        pass

    # Exit a parse tree produced by HazeParser#returntype.
    def exitReturntype(self, ctx:HazeParser.ReturntypeContext):
        pass


    # Enter a parse tree produced by HazeParser#IntegerConstant.
    def enterIntegerConstant(self, ctx:HazeParser.IntegerConstantContext):
        pass

    # Exit a parse tree produced by HazeParser#IntegerConstant.
    def exitIntegerConstant(self, ctx:HazeParser.IntegerConstantContext):
        pass


    # Enter a parse tree produced by HazeParser#StringConstant.
    def enterStringConstant(self, ctx:HazeParser.StringConstantContext):
        pass

    # Exit a parse tree produced by HazeParser#StringConstant.
    def exitStringConstant(self, ctx:HazeParser.StringConstantContext):
        pass


    # Enter a parse tree produced by HazeParser#BooleanConstant.
    def enterBooleanConstant(self, ctx:HazeParser.BooleanConstantContext):
        pass

    # Exit a parse tree produced by HazeParser#BooleanConstant.
    def exitBooleanConstant(self, ctx:HazeParser.BooleanConstantContext):
        pass


    # Enter a parse tree produced by HazeParser#compilationhint.
    def enterCompilationhint(self, ctx:HazeParser.CompilationhintContext):
        pass

    # Exit a parse tree produced by HazeParser#compilationhint.
    def exitCompilationhint(self, ctx:HazeParser.CompilationhintContext):
        pass


    # Enter a parse tree produced by HazeParser#compilationhintfilename.
    def enterCompilationhintfilename(self, ctx:HazeParser.CompilationhintfilenameContext):
        pass

    # Exit a parse tree produced by HazeParser#compilationhintfilename.
    def exitCompilationhintfilename(self, ctx:HazeParser.CompilationhintfilenameContext):
        pass


    # Enter a parse tree produced by HazeParser#compilationhintflags.
    def enterCompilationhintflags(self, ctx:HazeParser.CompilationhintflagsContext):
        pass

    # Exit a parse tree produced by HazeParser#compilationhintflags.
    def exitCompilationhintflags(self, ctx:HazeParser.CompilationhintflagsContext):
        pass


    # Enter a parse tree produced by HazeParser#compilationlang.
    def enterCompilationlang(self, ctx:HazeParser.CompilationlangContext):
        pass

    # Exit a parse tree produced by HazeParser#compilationlang.
    def exitCompilationlang(self, ctx:HazeParser.CompilationlangContext):
        pass


    # Enter a parse tree produced by HazeParser#linkerhint.
    def enterLinkerhint(self, ctx:HazeParser.LinkerhintContext):
        pass

    # Exit a parse tree produced by HazeParser#linkerhint.
    def exitLinkerhint(self, ctx:HazeParser.LinkerhintContext):
        pass


    # Enter a parse tree produced by HazeParser#StructFieldDecl.
    def enterStructFieldDecl(self, ctx:HazeParser.StructFieldDeclContext):
        pass

    # Exit a parse tree produced by HazeParser#StructFieldDecl.
    def exitStructFieldDecl(self, ctx:HazeParser.StructFieldDeclContext):
        pass


    # Enter a parse tree produced by HazeParser#StructFuncDecl.
    def enterStructFuncDecl(self, ctx:HazeParser.StructFuncDeclContext):
        pass

    # Exit a parse tree produced by HazeParser#StructFuncDecl.
    def exitStructFuncDecl(self, ctx:HazeParser.StructFuncDeclContext):
        pass


    # Enter a parse tree produced by HazeParser#StructDecl.
    def enterStructDecl(self, ctx:HazeParser.StructDeclContext):
        pass

    # Exit a parse tree produced by HazeParser#StructDecl.
    def exitStructDecl(self, ctx:HazeParser.StructDeclContext):
        pass


    # Enter a parse tree produced by HazeParser#PrimitiveDatatype.
    def enterPrimitiveDatatype(self, ctx:HazeParser.PrimitiveDatatypeContext):
        pass

    # Exit a parse tree produced by HazeParser#PrimitiveDatatype.
    def exitPrimitiveDatatype(self, ctx:HazeParser.PrimitiveDatatypeContext):
        pass


    # Enter a parse tree produced by HazeParser#FunctionDatatype.
    def enterFunctionDatatype(self, ctx:HazeParser.FunctionDatatypeContext):
        pass

    # Exit a parse tree produced by HazeParser#FunctionDatatype.
    def exitFunctionDatatype(self, ctx:HazeParser.FunctionDatatypeContext):
        pass



del HazeParser