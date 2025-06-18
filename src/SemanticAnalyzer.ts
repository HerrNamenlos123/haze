// import { HazeVisitor } from "./grammar/autogen/HazeVisitor";

// import { CompilerError, GeneralError, ImpossibleSituation, InternalError } from "./Errors";
// import { ResolvedScope } from "./Scope";
// import { Module } from "./Module";
// import {
//   BinaryExprContext,
//   BodyContext,
//   ElseifexprContext,
//   ExplicitCastExprContext,
//   ExprAssignmentExprContext,
//   FuncdeclContext,
//   FuncRefExprContext,
//   GenericsvalueContext,
//   IfexprContext,
//   IfStatementContext,
//   InlineCStatementContext,
//   LiteralConstantContext,
//   NamedfuncContext,
//   ParamContext,
//   ParamsContext,
//   PostIncrExprContext,
//   PreIncrExprContext,
//   StructMethodContext,
//   SymbolValueExprContext,
//   UnaryExprContext,
//   VariableDeclarationContext,
//   VariableDefinitionContext,
//   VariableStatementContext,
//   WhileStatementContext,
//   type ArgsContext,
//   type BooleanConstantContext,
//   type CommonDatatypeContext,
//   type ConstantExprContext,
//   type ExprMemberAccessContext,
//   type ExprStatementContext,
//   type FuncbodyContext,
//   type FuncContext,
//   type ParenthesisExprContext,
//   type ReturnStatementContext,
//   type StringConstantContext,
//   type StructInstantiationExprContext,
//   type StructMemberValueContext,
// } from "./grammar/autogen/HazeParser";
// import {
//   analyzeVariableStatement,
//   collectFunction,
//   collectVariableStatement,
//   datatypeSymbolUsed,
//   defineGenericsInScope,
//   getNestedReturnTypes,
//   INTERNAL_METHOD_NAMES,
//   RESERVED_VARIABLE_NAMES,
//   resolveGenerics,
//   visitBooleanConstantImpl,
//   visitCommonDatatypeImpl,
//   visitLiteralConstantImpl,
//   visitParam,
//   visitParams,
//   visitStringConstantImpl,
//   type ParamPack,
// } from "./utils";
// import { ParserRuleContext } from "antlr4ng";
// import type {
//   AssignOperation,
//   BinaryExpression,
//   ConstantExpression,
//   ExplicitCastExpression,
//   ExprAssignmentExpr,
//   ExprCallExpression,
//   Expression,
//   MemberAccessExpression,
//   MethodAccessExpression,
//   ObjectExpression,
//   PostIncrExpr,
//   PreIncrExpr,
//   RawPointerDereferenceExpression,
//   SizeofExpr,
//   SymbolValueExpression,
//   UnaryExpression,
// } from "./Expression";
// import type {
//   ConditionalStatement,
//   ExprStatement,
//   InlineCStatement,
//   ReturnStatement,
//   Statement,
//   VariableDeclarationStatement,
//   VariableDefinitionStatement,
//   WhileStatement,
// } from "./Statement";
// import { SymbolFlags } from "typescript";
// import { ModuleType } from "./Config";

// class FunctionBodyAnalyzer extends HazeVisitor<any> {

//   visitBinaryExpr = (ctx: BinaryExprContext): BinaryExpression => {
//     const left: Expression = this.visit(ctx.expr()[0]);
//     const right: Expression = this.visit(ctx.expr()[1]);
//     let operation = ctx.getChild(1)?.getText();
//     if (operation === "is" && ctx.getChild(2)?.getText() === "not") {
//       operation = "!=";
//     }
//     if (operation === "is") {
//       operation = "==";
//     }
//     if (operation === "and") {
//       operation = "&&";
//     }
//     if (operation === "or") {
//       operation = "||";
//     }

//     switch (operation) {
//       case "*":
//       case "/":
//       case "%":
//       case "+":
//       case "-":
//         if (isInteger(left.type) && isInteger(right.type)) {
//           return {
//             variant: "Binary",
//             ctx: ctx,
//             leftExpr: left,
//             operation: operation,
//             rightExpr: right,
//             type: getIntegerBinaryResult(
//               left.type as PrimitiveDatatype,
//               right.type as PrimitiveDatatype,
//             ),
//             location: this.program.location(ctx),
//           };
//         }
//         if (isF32(left.type) && isF32(right.type)) {
//           return {
//             variant: "Binary",
//             ctx: ctx,
//             leftExpr: left,
//             operation: operation,
//             rightExpr: right,
//             location: this.program.location(ctx),
//             type: this.program.getBuiltinType("f32"),
//           };
//         } else if (isFloat(left.type) && isFloat(right.type)) {
//           return {
//             variant: "Binary",
//             ctx: ctx,
//             leftExpr: left,
//             operation: operation,
//             rightExpr: right,
//             location: this.program.location(ctx),
//             type: this.program.getBuiltinType("f64"),
//           };
//         } else if (
//           (isFloat(left.type) && isInteger(right.type)) ||
//           (isInteger(left.type) && isFloat(right.type))
//         ) {
//           return {
//             variant: "Binary",
//             ctx: ctx,
//             leftExpr: left,
//             operation: operation,
//             rightExpr: right,
//             type: this.program.getBuiltinType("f64"),
//             location: this.program.location(ctx),
//           };
//         }
//         break;

//       case "<":
//       case ">":
//       case "<=":
//       case ">=":
//         if (
//           (isInteger(left.type) || isFloat(left.type)) &&
//           (isInteger(right.type) || isFloat(right.type))
//         ) {
//           return {
//             variant: "Binary",
//             ctx: ctx,
//             leftExpr: left,
//             operation: operation,
//             rightExpr: right,
//             type: this.program.getBuiltinType("boolean"),
//             location: this.program.location(ctx),
//           };
//         }
//         break;

//       case "==":
//       case "!=":
//         if (
//           (isBoolean(left.type) && isBoolean(right.type)) ||
//           (isInteger(left.type) && isInteger(right.type)) ||
//           (isFloat(left.type) && isFloat(right.type))
//         ) {
//           return {
//             variant: "Binary",
//             ctx: ctx,
//             leftExpr: left,
//             operation: operation,
//             rightExpr: right,
//             type: this.program.getBuiltinType("boolean"),
//             location: this.program.location(ctx),
//           };
//         }
//         break;

//       case "&&":
//       case "||":
//         if (isBoolean(left.type) && isBoolean(right.type)) {
//           return {
//             variant: "Binary",
//             ctx: ctx,
//             leftExpr: left,
//             operation: operation,
//             rightExpr: right,
//             type: this.program.getBuiltinType("boolean"),
//             location: this.program.location(ctx),
//           };
//         }
//         break;
//     }

//     throw new CompilerError(
//       `No binary operator '${operation}' is known for types '${serializeDatatype(left.type)}' and '${serializeDatatype(right.type)}'`,
//       this.program.location(ctx),
//     );
//   };

//   visitUnaryExpr = (ctx: UnaryExprContext): UnaryExpression => {
//     const expr: Expression = this.visit(ctx.expr());
//     let operation = ctx.getChild(0)?.getText();
//     if (operation === "not") {
//       operation = "!";
//     }

//     switch (operation) {
//       case "!":
//         return {
//           variant: "Unary",
//           ctx: ctx,
//           expr: expr,
//           operation: operation,
//           location: this.program.location(ctx),
//           type: this.program.getBuiltinType("boolean"),
//         };

//       case "+":
//       case "-":
//         if (!isInteger(expr.type) && !isFloat(expr.type)) {
//           throw new CompilerError(
//             `Unary operator '${operation}' is not known for type '${serializeDatatype(expr.type)}'`,
//             this.program.location(ctx),
//           );
//         }
//         return {
//           variant: "Unary",
//           ctx: ctx,
//           expr: expr,
//           operation: operation,
//           type: expr.type,
//           location: this.program.location(ctx),
//         };

//       default:
//         throw new CompilerError(
//           `No unary operator '${operation}' is known for type '${serializeDatatype(expr.type)}'`,
//           this.program.location(ctx),
//         );
//     }
//   };
