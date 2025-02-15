from Datatype import Datatype
from antlr4 import ParserRuleContext
from Symbol import ConstantSymbol
from typing import List, Tuple, Optional
from Symbol import VariableSymbol, DatatypeSymbol, Symbol
from Error import CompilerError, InternalError, ImpossibleSituation


class Expression:
    def __init__(self, type: Datatype, ctx: ParserRuleContext):
        self.type = type
        self.ctx = ctx


class ConstantExpression(Expression):
    def __init__(
        self, constantSymbol: ConstantSymbol, type: Datatype, ctx: ParserRuleContext
    ):
        super().__init__(type, ctx)
        self.constantSymbol = constantSymbol


class ObjectExpression(Expression):
    def __init__(self, type: Datatype, ctx: ParserRuleContext):
        super().__init__(type, ctx)
        self.members: List[Tuple[VariableSymbol, Expression]] = []


class SymbolValueExpression(Expression):
    def __init__(self, symbol: Symbol, ctx: ParserRuleContext):
        super().__init__(symbol.type, ctx)
        self.symbol = symbol


class MemberAccessExpression(Expression):
    def __init__(
        self, expr: Expression, memberName: str, symbol: Symbol, ctx: ParserRuleContext
    ):
        super().__init__(symbol.type, ctx)
        self.expr = expr
        self.memberName = memberName
        self.symbol = symbol


class ExprCallExpression(Expression):
    def __init__(self, expr: Expression, ctx: ParserRuleContext):
        if not expr.type.isFunction():
            raise InternalError(
                f"Expression of type '{expr.type.getDisplayName()}' is not callable",
            )
        if expr.type.functionReturnType is None:
            raise ImpossibleSituation()
        super().__init__(expr.type.functionReturnType, ctx)
        self.expr = expr
