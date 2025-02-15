from antlr4 import ParserRuleContext
from Symbol import Symbol
from Datatype import Datatype
from Expression import Expression
from typing import Optional


class Statement:
    def __init__(self, ctx: ParserRuleContext):
        self.ctx = ctx


class VariableDefinitionStatement(Statement):
    def __init__(self, symbol: Symbol, expr: Expression, ctx: ParserRuleContext):
        super().__init__(ctx)
        self.symbol = symbol
        self.expr = expr


class ReturnStatement(Statement):
    def __init__(self, expr: Optional[Expression], ctx: ParserRuleContext):
        super().__init__(ctx)
        self.expr = expr
