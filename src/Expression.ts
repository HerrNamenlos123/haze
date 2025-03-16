import type { ParserRuleContext } from "antlr4";
import type { Datatype } from "./Datatype";
import type {
  ConstantSymbol,
  FunctionSymbol,
  Symbol,
  VariableSymbol,
} from "./Symbol";
import type { Location } from "./Errors";

type BaseExpression = {
  type: Datatype;
  ctx: ParserRuleContext;
  location: Location;
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
  methodSymbol?: FunctionSymbol;
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

export type SizeofExpr = BaseExpression & {
  variant: "Sizeof";
  datatype: Datatype;
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

export type UnaryExpression = BaseExpression & {
  variant: "Unary";
  expr: Expression;
  operation: "!" | "+" | "-";
};

export type PostIncrExpr = BaseExpression & {
  variant: "PostIncr";
  expr: Expression;
  operation: "++" | "--";
};

export type PreIncrExpr = BaseExpression & {
  variant: "PreIncr";
  expr: Expression;
  operation: "++" | "--";
};

export type AssignOperation =
  | "="
  | "+="
  | "-="
  | "*="
  | "/="
  | "%="
  | "<<="
  | ">>="
  | "&="
  | "^="
  | "|=";

export type ExprAssignmentExpr = BaseExpression & {
  variant: "ExprAssign";
  leftExpr: Expression;
  rightExpr: Expression;
  operation: AssignOperation;
};

export type Expression =
  | ConstantExpression
  | ObjectExpression
  | BinaryExpression
  | UnaryExpression
  | SymbolValueExpression
  | SizeofExpr
  | MemberAccessExpression
  | PostIncrExpr
  | PreIncrExpr
  | RawPointerDereferenceExpression
  | MethodAccessExpression
  | ExplicitCastExpression
  | ExprCallExpression
  | ExprAssignmentExpr;
