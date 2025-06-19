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
