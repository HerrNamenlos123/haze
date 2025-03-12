import type { ParserRuleContext } from "antlr4";
import type { Symbol, VariableSymbol } from "./Symbol";
import type { Expression } from "./Expression";
import type { Scope } from "./Scope";
import type {
  VariableDeclarationContext,
  VariableDefinitionContext,
} from "./parser/HazeParser";
import type { Location } from "./Errors";

export type VariableDefinitionStatement = {
  variant: "VariableDefinition";
  symbol: VariableSymbol;
  ctx: VariableDefinitionContext;
  expr: Expression;
  location: Location;
};

export type VariableDeclarationStatement = {
  variant: "VariableDeclaration";
  symbol: VariableSymbol;
  ctx: VariableDeclarationContext;
  location: Location;
};

export type ReturnStatement = {
  variant: "Return";
  ctx: ParserRuleContext;
  expr?: Expression;
  location: Location;
};

export type ExprStatement = {
  variant: "Expr";
  ctx: ParserRuleContext;
  expr: Expression;
  location: Location;
};

export type InlineCStatement = {
  variant: "InlineC";
  ctx: ParserRuleContext;
  code: string;
  location: Location;
};

export type ConditionalStatement = {
  variant: "Conditional";
  ctx: ParserRuleContext;
  if: [Expression, Scope];
  elseIf: [Expression, Scope][];
  else?: Scope;
  location: Location;
};

export type WhileStatement = {
  variant: "While";
  ctx: ParserRuleContext;
  expr: Expression;
  scope: Scope;
  location: Location;
};

export type Statement =
  | VariableDefinitionStatement
  | VariableDeclarationStatement
  | ReturnStatement
  | ExprStatement
  | WhileStatement
  | ConditionalStatement
  | InlineCStatement;
