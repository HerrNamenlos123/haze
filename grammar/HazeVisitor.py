# Generated from Haze.g4 by ANTLR 4.13.2
from antlr4 import *
if "." in __name__:
    from .HazeParser import HazeParser
else:
    from HazeParser import HazeParser

# This class defines a complete generic visitor for a parse tree produced by HazeParser.

class HazeVisitor(ParseTreeVisitor):

    # Visit a parse tree produced by HazeParser#prog.
    def visitProg(self, ctx:HazeParser.ProgContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#namedfunc.
    def visitNamedfunc(self, ctx:HazeParser.NamedfuncContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#func.
    def visitFunc(self, ctx:HazeParser.FuncContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#funcbody.
    def visitFuncbody(self, ctx:HazeParser.FuncbodyContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#body.
    def visitBody(self, ctx:HazeParser.BodyContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#param.
    def visitParam(self, ctx:HazeParser.ParamContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#params.
    def visitParams(self, ctx:HazeParser.ParamsContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#externfuncdef.
    def visitExternfuncdef(self, ctx:HazeParser.ExternfuncdefContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#externblock.
    def visitExternblock(self, ctx:HazeParser.ExternblockContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#externlang.
    def visitExternlang(self, ctx:HazeParser.ExternlangContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#ifexpr.
    def visitIfexpr(self, ctx:HazeParser.IfexprContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#elseifexpr.
    def visitElseifexpr(self, ctx:HazeParser.ElseifexprContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#thenblock.
    def visitThenblock(self, ctx:HazeParser.ThenblockContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#elseifblock.
    def visitElseifblock(self, ctx:HazeParser.ElseifblockContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#elseblock.
    def visitElseblock(self, ctx:HazeParser.ElseblockContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#ExprStatement.
    def visitExprStatement(self, ctx:HazeParser.ExprStatementContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#ReturnStatement.
    def visitReturnStatement(self, ctx:HazeParser.ReturnStatementContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#ExprAssignmentStatement.
    def visitExprAssignmentStatement(self, ctx:HazeParser.ExprAssignmentStatementContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#MutableVariableDefinition.
    def visitMutableVariableDefinition(self, ctx:HazeParser.MutableVariableDefinitionContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#ImmutableVariableDefinition.
    def visitImmutableVariableDefinition(self, ctx:HazeParser.ImmutableVariableDefinitionContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#IfStatement.
    def visitIfStatement(self, ctx:HazeParser.IfStatementContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#ObjectAttr.
    def visitObjectAttr(self, ctx:HazeParser.ObjectAttrContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#SymbolValueExpr.
    def visitSymbolValueExpr(self, ctx:HazeParser.SymbolValueExprContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#ExprCallExpr.
    def visitExprCallExpr(self, ctx:HazeParser.ExprCallExprContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#ObjectExpr.
    def visitObjectExpr(self, ctx:HazeParser.ObjectExprContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#ExprMemberAccess.
    def visitExprMemberAccess(self, ctx:HazeParser.ExprMemberAccessContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#NamedObjectExpr.
    def visitNamedObjectExpr(self, ctx:HazeParser.NamedObjectExprContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#BinaryExpr.
    def visitBinaryExpr(self, ctx:HazeParser.BinaryExprContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#FuncRefExpr.
    def visitFuncRefExpr(self, ctx:HazeParser.FuncRefExprContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#ConstantExpr.
    def visitConstantExpr(self, ctx:HazeParser.ConstantExprContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#BracketExpr.
    def visitBracketExpr(self, ctx:HazeParser.BracketExprContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#args.
    def visitArgs(self, ctx:HazeParser.ArgsContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#functype.
    def visitFunctype(self, ctx:HazeParser.FunctypeContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#returntype.
    def visitReturntype(self, ctx:HazeParser.ReturntypeContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#IntegerConstant.
    def visitIntegerConstant(self, ctx:HazeParser.IntegerConstantContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#StringConstant.
    def visitStringConstant(self, ctx:HazeParser.StringConstantContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#BooleanConstant.
    def visitBooleanConstant(self, ctx:HazeParser.BooleanConstantContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#compilationhint.
    def visitCompilationhint(self, ctx:HazeParser.CompilationhintContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#compilationhintfilename.
    def visitCompilationhintfilename(self, ctx:HazeParser.CompilationhintfilenameContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#compilationhintflags.
    def visitCompilationhintflags(self, ctx:HazeParser.CompilationhintflagsContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#compilationlang.
    def visitCompilationlang(self, ctx:HazeParser.CompilationlangContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#linkerhint.
    def visitLinkerhint(self, ctx:HazeParser.LinkerhintContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#StructFieldDecl.
    def visitStructFieldDecl(self, ctx:HazeParser.StructFieldDeclContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#StructFuncDecl.
    def visitStructFuncDecl(self, ctx:HazeParser.StructFuncDeclContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#StructDecl.
    def visitStructDecl(self, ctx:HazeParser.StructDeclContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#PrimitiveDatatype.
    def visitPrimitiveDatatype(self, ctx:HazeParser.PrimitiveDatatypeContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by HazeParser#FunctionDatatype.
    def visitFunctionDatatype(self, ctx:HazeParser.FunctionDatatypeContext):
        return self.visitChildren(ctx)



del HazeParser