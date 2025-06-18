import type { ParserRuleContext } from "antlr4ng";
import type { Symbol, VariableSymbol } from "./Symbol";
import type { Expression } from "./Expression";
import type { ResolvedScope } from "./shared/CollectionScope";
import type {
  VariableDeclarationContext,
  VariableDefinitionContext,
} from "./parser/grammar/autogen/HazeParser";
import type { SourceLoc } from "./shared/Errors";

export type VariableDefinitionStatement = {
  variant: "VariableDefinition";
  symbol: VariableSymbol;
  ctx: VariableDefinitionContext;
  expr: Expression;
  location: SourceLoc;
};

export type VariableDeclarationStatement = {
  variant: "VariableDeclaration";
  symbol: VariableSymbol;
  ctx: VariableDeclarationContext;
  location: SourceLoc;
};

export type ReturnStatement = {
  variant: "Return";
  ctx: ParserRuleContext;
  expr?: Expression;
  location: SourceLoc;
};

export type ExprStatement = {
  variant: "Expr";
  ctx: ParserRuleContext;
  expr: Expression;
  location: SourceLoc;
};

export type InlineCStatement = {
  variant: "InlineC";
  ctx: ParserRuleContext;
  code: string;
  location: SourceLoc;
};

export type ConditionalStatement = {
  variant: "Conditional";
  ctx: ParserRuleContext;
  if: [Expression, ResolvedScope];
  elseIf: [Expression, ResolvedScope][];
  else?: ResolvedScope;
  location: SourceLoc;
};

export type WhileStatement = {
  variant: "While";
  ctx: ParserRuleContext;
  expr: Expression;
  scope: ResolvedScope;
  location: SourceLoc;
};

export type Statement =
  | VariableDefinitionStatement
  | VariableDeclarationStatement
  | ReturnStatement
  | ExprStatement
  | WhileStatement
  | ConditionalStatement
  | InlineCStatement;
