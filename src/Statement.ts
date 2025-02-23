import type { ParserRuleContext } from "antlr4";
import type { Symbol } from "./Symbol";
import type { Datatype } from "./Datatype";
import type { Expression } from "./Expression";

export type VariableDefinitionStatement = {
  variant: "VariableDefinition";
  symbol: Symbol;
  ctx: ParserRuleContext;
  expr: Expression;
};

export type ReturnStatement = {
  variant: "Return";
  ctx: ParserRuleContext;
  expr?: Expression;
};

export type ExprStatement = {
  variant: "Expr";
  ctx: ParserRuleContext;
  expr: Expression;
};

export type Statement =
  | VariableDefinitionStatement
  | ReturnStatement
  | ExprStatement;
