import type { ParserRuleContext } from "antlr4";
import type { Datatype } from "./Datatype";
import type {
  ConstantSymbol,
  FunctionSymbol,
  Symbol,
  VariableSymbol,
} from "./Symbol";

type BaseExpression = {
  type: Datatype;
  ctx: ParserRuleContext;
};

export type ConstantExpression = BaseExpression & {
  variant: "Constant";
  constantSymbol: ConstantSymbol;
};

export type ObjectExpression = BaseExpression & {
  variant: "Object";
  members: Array<[VariableSymbol, Expression]>;
};

export type SymbolValueExpression = BaseExpression & {
  variant: "SymbolValue";
  symbol: Symbol;
};

export type RawPointerDereferenceExpression = BaseExpression & {
  variant: "RawPtrDeref";
  expr: Expression;
};

export type MemberAccessExpression = BaseExpression & {
  variant: "MemberAccess";
  expr: Expression;
  thisPointerExpr?: Expression;
  methodSymbol?: Symbol;
  memberName: string;
};

export type MethodAccessExpression = BaseExpression & {
  variant: "MethodAccess";
  expr: Expression;
  method: FunctionSymbol;
};

export type ExprCallExpression = BaseExpression & {
  variant: "ExprCall";
  thisPointerExpr?: Expression;
  expr: Expression;
  args: Expression[];
};

export type ExplicitCastExpression = BaseExpression & {
  variant: "ExplicitCast";
  expr: Expression;
};

export type BinaryExpression = BaseExpression & {
  variant: "Binary";
  leftExpr: Expression;
  rightExpr: Expression;
  operation:
    | "+"
    | "-"
    | "*"
    | "/"
    | "%"
    | "=="
    | "!="
    | ">"
    | "<"
    | ">="
    | "<="
    | "&&"
    | "||";
};

export type Expression =
  | ConstantExpression
  | ObjectExpression
  | BinaryExpression
  | SymbolValueExpression
  | MemberAccessExpression
  | RawPointerDereferenceExpression
  | MethodAccessExpression
  | ExplicitCastExpression
  | ExprCallExpression;
