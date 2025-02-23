import type { ParserRuleContext } from "antlr4";
import type { Datatype } from "./Datatype";
import type { ConstantSymbol, FunctionSymbol, VariableSymbol } from "./Symbol";

export type Expression = {
  type: Datatype;
  ctx: ParserRuleContext;
};

export type ConstantExpression = Expression & {
  constantSymbol: ConstantSymbol;
};

export type ObjectExpression = Expression & {
  members: Array<[VariableSymbol, Expression]>;
};

export type SymbolValueExpression = Expression & {
  symbol: Symbol;
};

export type MemberAccessExpression = Expression & {
  expr: Expression;
  memberName: string;
};

export type MethodAccessExpression = Expression & {
  expr: Expression;
  method: FunctionSymbol;
};

export type ExprCallExpression = Expression & {
  expr: Expression;
  thisPointerExpr?: Expression;
  args: Expression[];
};
