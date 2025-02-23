import type { ParserRuleContext } from "antlr4";
import type { Symbol } from "./Symbol";
import type { Datatype } from "./Datatype";
import type { Expression } from "./Expression";

export type Statement = {
  ctx: ParserRuleContext;
};

export type VariableDefinitionStatement = Statement & {
  variant: "VariableDefinition";
  symbol: Symbol;
  expr: Expression;
};

export type ReturnStatement = Statement & {
  variant: "Return";
  expr?: Expression;
};

export type ExprStatement = Statement & {
  variant: "Expr";
  expr: Expression;
};
