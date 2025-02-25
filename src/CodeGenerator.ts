import { Program } from "./Program";
import {
  InternalError,
  ImpossibleSituation,
  printCompilerMessage,
  ErrorType,
} from "./Errors";
import type { StructDeclContext } from "./parser/HazeParser";
import {
  FunctionType,
  mangleDatatype,
  mangleSymbol,
  serializeSymbol,
  type DatatypeSymbol,
  type FunctionSymbol,
  type VariableSymbol,
} from "./Symbol";
import {
  generateDefinitionCCode,
  generateUsageCode,
  implicitConversion,
  serializeDatatype,
  type Datatype,
  type FunctionDatatype,
} from "./Datatype";
import type { Statement } from "./Statement";
import type { Expression } from "./Expression";
import { OutputWriter } from "./OutputWriter";
import { datatypeSymbolUsed, resolveGenerics } from "./utils";
import type { Scope } from "./Scope";

const CONTEXT_STRUCT = "_HN4Haze7ContextE";

class CodeGenerator {
  private program: Program;
  private includeWriter = new OutputWriter();
  private out = {
    includes: {} as Record<string, OutputWriter>,
    type_declarations: {} as Record<string, OutputWriter>,
    function_declarations: {} as Record<string, OutputWriter>,
    function_definitions: {} as Record<string, OutputWriter>,
  };

  constructor(program: Program) {
    this.program = program;
    this.out.type_declarations[CONTEXT_STRUCT] = new OutputWriter().write(
      `typedef struct __${CONTEXT_STRUCT}__ {} ${CONTEXT_STRUCT};`,
    );
    this.out.function_definitions["main"] = new OutputWriter()
      .writeLine("int32_t main() {")
      .pushIndent()
      .writeLine(`${CONTEXT_STRUCT} context = { };`)
      .writeLine("return _H4main(&context);")
      .popIndent()
      .writeLine("}");
  }

  init(field: string, out: Record<string, OutputWriter>) {
    if (!(field in out)) {
      out[field] = new OutputWriter();
    }
  }

  includeHeader(filename: string) {
    this.init(filename, this.out.includes);
    this.out.includes[filename].write(`#include <${filename}>`);
  }

  writeFile(filename: string) {
    const fs = require("fs");
    const writer = new OutputWriter();
    writer.write("// Include section\n");
    for (const include of Object.values(this.out.includes)) {
      writer.write(include);
    }

    writer.write("\n\n// Type declaration section\n");
    for (const decl of Object.values(this.out.type_declarations)) {
      writer.write(decl);
      writer.writeLine();
    }

    writer.write("\n\n// Function declaration section\n");
    for (const decl of Object.values(this.out.function_declarations)) {
      writer.write(decl);
      writer.writeLine();
    }

    writer.write("\n\n// Function definition section\n");
    for (const def of Object.values(this.out.function_definitions)) {
      writer.write(def);
      writer.writeLine();
    }

    const path = require("path");
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, writer.get());
  }

  generate() {
    this.includeHeader("stdio.h");
    this.includeHeader("stdint.h");
    this.includeHeader("stdlib.h");

    for (const symbol of Object.values(this.program.concreteFunctions)) {
      if (symbol.functionType === FunctionType.Internal) {
        this.generateFuncUse(symbol);
      }
    }

    for (const dt of Object.values(this.program.concreteDatatypes)) {
      this.generateDatatypeUse(dt);
    }
  }

  generateFuncUse(symbol: FunctionSymbol) {
    const declaration = (
      ftype: FunctionDatatype,
      returntype: Datatype,
    ): string => {
      let decl =
        generateUsageCode(returntype, this.program) +
        " " +
        mangleSymbol(symbol) +
        "(";
      const params = [];
      if (symbol.thisPointer) {
        params.push(
          `${generateUsageCode(symbol.thisPointer, this.program)} this`,
        );
      }
      params.push(`${CONTEXT_STRUCT}* context`);
      for (const [paramName, paramType] of ftype.functionParameters) {
        params.push(
          generateUsageCode(paramType, this.program) + " " + paramName,
        );
        // datatypeSymbolUsed(paramType);
      }
      decl += params.join(", ");
      decl += ")";
      return decl;
    };

    this.init(mangleSymbol(symbol), this.out.function_definitions);
    this.init(mangleSymbol(symbol), this.out.function_declarations);
    const decl = declaration(symbol.type, symbol.type.functionReturnType);
    this.out.function_declarations[mangleSymbol(symbol)].write(decl + ";");
    this.out.function_definitions[mangleSymbol(symbol)]
      .writeLine(decl + " {")
      .pushIndent();

    this.out.function_definitions[mangleSymbol(symbol)].write(
      this.emitScope(symbol.scope),
    );

    this.out.function_definitions[mangleSymbol(symbol)]
      .popIndent()
      .writeLine("}");
  }

  outputDestructorCalls(
    scope: Scope,
    writer: OutputWriter,
    returnedSymbol?: VariableSymbol,
  ) {
    for (const symbol of Object.values(scope.getSymbols()).reverse()) {
      if (symbol.variant === "Variable" && symbol.type.variant === "Struct") {
        const destructor = symbol.type.methods.find(
          (m) => m.specialMethod === "destructor",
        );
        if (destructor) {
          if (returnedSymbol && returnedSymbol === symbol) {
            continue;
          }
          writer.writeLine(
            `${mangleSymbol(destructor)}(&${symbol.name}, context);`,
          );
        }
      }
    }
  }

  emitScope(scope: Scope): OutputWriter {
    const writer = new OutputWriter();

    let returned = false;
    for (const statement of scope.statements) {
      if (returned) {
        printCompilerMessage(
          this.program.getLoc(statement.ctx),
          ErrorType.Warning,
          "warning",
          `Dead code detected and stripped`,
        );
        break;
      }

      if (statement.variant === "Return") {
        returned = true;
        if (statement.expr) {
          writer.writeLine(
            `${generateUsageCode(statement.expr.type, this.program)} __returnval__ = ` +
              this.emitExpr(statement.expr).get() +
              ";",
          );
        }
        const returnedSymbol =
          statement.expr?.variant === "SymbolValue"
            ? statement.expr.symbol.variant === "Variable"
              ? statement.expr.symbol
              : undefined
            : undefined;
        this.outputDestructorCalls(scope, writer, returnedSymbol);
        if (!statement.expr) {
          writer.writeLine("return;");
        } else {
          writer.writeLine("return __returnval__;");
        }
      } else {
        writer.write(this.emitStatement(statement));
      }
    }
    return writer;
  }

  emitStatement(statement: Statement): OutputWriter {
    const writer = new OutputWriter();
    switch (statement.variant) {
      case "Return":
        throw new InternalError(
          "Cannot call emitStatement for return statement, use emitExpression instead",
        );

      case "VariableDefinition":
        if (
          !statement.expr ||
          !statement.symbol.type ||
          statement.symbol.variant !== "Variable"
        ) {
          throw new ImpossibleSituation();
        }
        const ret = generateUsageCode(statement.symbol.type, this.program);
        writer.writeLine(
          `${ret} ${statement.symbol.name} = ${this.emitExpr(statement.expr).get()};`,
        );
        return writer;

      case "Expr":
        writer.writeLine(this.emitExpr(statement.expr).get() + ";");
        return writer;

      case "InlineC":
        writer.writeLine(statement.code + ";");
        return writer;

      // default:
      //   throw new InternalError(`Unknown statement type ${statement.variant}`);
    }
  }

  emitExpr(expr: Expression): OutputWriter {
    const writer = new OutputWriter();
    switch (expr.variant) {
      case "ExprCall":
        const args = [];
        if (expr.expr.variant === "SymbolValue") {
          if (expr.expr.symbol.variant === "Function") {
            if (expr.expr.symbol.functionType === FunctionType.Internal) {
              args.push("context");
            }
          }
        } else if (expr.expr.variant === "MemberAccess") {
          args.push("context");
        }
        if (expr.thisPointerExpr) {
          args.push("&" + this.emitExpr(expr.thisPointerExpr).get());
        }
        for (let i = 0; i < expr.args.length; i++) {
          const val = this.emitExpr(expr.args[i]).get();
          if (expr.expr.type.variant !== "Function") {
            throw new ImpossibleSituation();
          }
          let scope = this.program.currentScope;
          if (
            expr.expr.variant === "MemberAccess" &&
            expr.expr.thisPointerExpr &&
            expr.expr.methodSymbol &&
            expr.expr.methodSymbol.variant === "Function"
          ) {
            scope = expr.expr.methodSymbol.scope;
          }
          const converted = implicitConversion(
            expr.args[i].type,
            expr.expr.type.functionParameters[i][1],
            val,
            scope,
            this.program.getLoc(expr.args[i].ctx),
            this.program,
          );
          args.push(converted);
        }
        if (
          expr.expr.variant === "MemberAccess" &&
          expr.expr.thisPointerExpr &&
          expr.expr.methodSymbol &&
          expr.expr.methodSymbol.variant === "Function"
        ) {
          writer.write(
            mangleSymbol(expr.expr.methodSymbol) +
              "(&" +
              this.emitExpr(expr.expr.thisPointerExpr).get() +
              ", " +
              args.join(", ") +
              ")",
          );
        } else {
          writer.write(
            this.emitExpr(expr.expr).get() + "(" + args.join(", ") + ")",
          );
        }
        return writer;

      case "Object":
        writer
          .writeLine(`((${generateUsageCode(expr.type, this.program)}) { `)
          .pushIndent();
        for (const [symbol, memberExpr] of expr.members) {
          writer.writeLine(
            `.${symbol.name} = ${this.emitExpr(memberExpr).get()}, `,
          );
        }
        writer.popIndent().write(" })");
        return writer;

      case "RawPtrDeref":
        writer.write(`(*${this.emitExpr(expr.expr).get()})`);
        return writer;

      case "MemberAccess":
        writer.write(this.emitExpr(expr.expr).get() + "." + expr.memberName);
        return writer;

      case "SymbolValue":
        if (expr.symbol.variant === "Function") {
          writer.write(mangleSymbol(expr.symbol));
          return writer;
        } else if (expr.symbol.variant !== "Constant") {
          writer.write(expr.symbol.name);
          return writer;
        } else {
          throw new ImpossibleSituation();
        }

      case "Constant":
        switch (typeof expr.constantSymbol.value) {
          case "number":
          case "boolean":
            writer.write(expr.constantSymbol.value.toString());
            return writer;
          case "string":
            writer.write(expr.constantSymbol.value);
            return writer;
          default:
            throw new InternalError(
              `Unknown constant type ${typeof expr.constantSymbol.value}`,
            );
        }
      default:
        throw new InternalError(`Unknown expression type ${expr.variant}`);
    }
  }

  //   implVariableDefinition(ctx: any, isMutable: boolean) {
  //     const symbol = this.getNodeSymbol(ctx);
  //     if (symbol instanceof VariableSymbol) {
  //       const value = implicitConversion(
  //         this.getNodeDatatype(ctx.expr()),
  //         symbol.type,
  //         ctx.expr().code,
  //         this.getLocation(ctx),
  //       );
  //       ctx.code = `${symbol.type.generateUsageCode()} ${symbol.name} = ${value};\n`;
  //     } else {
  //       throw new InternalError("Symbol is not a variable");
  //     }
  //   }

  generateDatatypeUse(datatype: DatatypeSymbol) {
    this.init(mangleSymbol(datatype), this.out.type_declarations);
    this.out.type_declarations[mangleSymbol(datatype)].write(
      generateDefinitionCCode(datatype, this.program),
    );
  }

  //   getCurrentFunction() {
  //     return this.currentFunctionStack[this.currentFunctionStack.length - 1];
  //   }

  //   getExpectedReturntype() {
  //     const r = this.getCurrentFunction().type.functionReturnType;
  //     if (!r) {
  //       throw new InternalError("Function is missing return type");
  //     }
  //     return r;
  //   }

  //   pushCurrentFunction(symbol: FunctionSymbol) {
  //     this.currentFunctionStack.push(symbol);
  //   }

  //   popCurrentFunction() {
  //     this.currentFunctionStack.pop();
  //   }

  //   visitReturnStatement(ctx: any) {
  //     const scope = this.getNodeScope(ctx);
  //     scope.setTerminated(true);
  //     this.visitChildren(ctx);
  //     const type = this.getNodeDatatype(ctx);
  //     if (type.isNone()) {
  //       ctx.code = "return;\n"; // type: ignore
  //     } else {
  //       const value = implicitConversion(
  //         type,
  //         this.getExpectedReturntype(),
  //         ctx.expr().code,
  //         this.getLocation(ctx),
  //       );
  //       ctx.code = `return ${value};\n`; // type: ignore
  //     }
  //   }

  //   visitConstantExpr(ctx: any) {
  //     this.visitChildren(ctx);
  //     ctx.code = ctx.constant().code; // type: ignore
  //   }

  //   visitIntegerConstant(ctx: any) {
  //     this.visitChildren(ctx);
  //     const value = parseInt(ctx.getText());
  //     ctx.code = value.toString(); // type: ignore
  //   }

  //   visitStringConstant(ctx: any) {
  //     this.visitChildren(ctx);
  //     ctx.code = `"${ctx.getText().slice(1, -1)}"`; // type: ignore
  //   }

  //   visitFunc(ctx: any) {
  //     return this.provideFuncDef(ctx);
  //   }

  //   visitNamedfunc(ctx: any) {
  //     return this.provideFuncDef(ctx);
  //   }

  //   visitMutableVariableDefinition(ctx: any) {
  //     return this.implVariableDefinition(ctx, true);
  //   }

  //   visitImmutableVariableDefinition(ctx: any) {
  //     return this.implVariableDefinition(ctx, false);
  //   }

  //   visitSymbolValueExpr(ctx: any) {
  //     this.visitChildren(ctx);
  //     const symbol = this.getNodeSymbol(ctx);

  //     if (symbol instanceof FunctionSymbol) {
  //       ctx.code = symbol.getMangledName(); // type: ignore
  //     } else {
  //       ctx.code = symbol.name; // type: ignore
  //     }
  //     this.setNodeSymbol(ctx, symbol);
  //   }

  //   visitExprStatement(ctx: any) {
  //     this.visitChildren(ctx);
  //     ctx.code = `${ctx.expr().code};\n`; // type: ignore
  //   }

  //   visitExprCallExpr(ctx: ExprCallExprContext) {
  //     this.visitChildren(ctx);
  //     const symbol = this.getNodeSymbol(ctx.expr());
  //     const exprtype = symbol.type;

  //     // thisPointer = this.getNodeThisPointer(ctx.expr());
  //     // args.push_back(thisPointer);
  //     // thisPointerType = this.getNodeDatatype(expr);

  //     if (!(symbol instanceof FunctionSymbol) || !exprtype.isFunction()) {
  //       throw new CompilerError(
  //         `Expression of type '${exprtype.getDisplayName()}' is not callable`,
  //         this.getLocation(ctx),
  //       );
  //     }

  //     ctx.code = `${ctx.expr().code}(`; // type: ignore

  //     const params: string[] = [];
  //     if (symbol.functionLinkage !== FunctionLinkage.External_C) {
  //       params.push("context");
  //     }
  //     if (symbol.thisPointerType) {
  //       params.push(`&${ctx.expr().structSymbol.name}`);
  //     }
  //     for (let i = 0; i < exprtype.functionParameters.length; i++) {
  //       const paramexpr = ctx.args().expr()[i];
  //       const expectedtype = exprtype.functionParameters[i][1];
  //       params.push(
  //         implicitConversion(
  //           this.getNodeDatatype(paramexpr),
  //           expectedtype,
  //           paramexpr.code,
  //           this.getLocation(paramexpr),
  //         ),
  //       );
  //     }

  //     ctx.code += `${params.join(", ")});`; // type: ignore

  //     if (symbol.type.generics.length > 0) {
  //       if (!symbol.ctx) {
  //         throw new InternalError("Function missing context");
  //       }

  //       if (ctx.expr().structSymbol) {
  //         // symbol.type.genericsDict = ctx.expr().structSymbol.type.genericsDict
  //         this.setNodeSymbol(symbol.ctx, symbol);
  //         this.generateFuncUse(symbol.ctx);
  //       } else {
  //         throw new InternalError("Function missing context generics dict");
  //       }
  //     }
  //   }

  //   visitStructFuncDecl(ctx: StructFuncDeclContext) {
  //     return this.provideFuncDef(ctx);
  //   }

  //   visitStructDecl(ctx: StructDeclContext) {
  //     this.visitChildren(ctx);
  //     const datatype = this.getNodeDatatype(ctx);
  //     this.structCtx[datatype.name] = ctx;
  //     if (!datatype.generics) {
  //       this.output["type_declarations"][datatype.getMangledName()] =
  //         datatype.generateDefinitionCCode();
  //     }
  //   }

  // visitObjectExpr(ctx: ObjectExprContext) {
  //     this.visitChildren(ctx);
  //     const type = this.getNodeDatatype(ctx);
  //     if (!(type instanceof StructDatatype)) {
  //         throw new InternalError("StructDatatype is not of type struct");
  //     }

  //     ctx.code = `(${type.generateUsageCode()}){ `;
  //     for (const attr of this.getNodeObjectAttributes(ctx)) {
  //         const objattr: ObjAttribute = attr;
  //         ctx.code += `.

  // visitNamedObjectExpr(ctx) {
  //   throw new InternalError("Not implemented");
  //   // self.visitChildren(ctx)
  //   // structtype = self.getNodeDatatype(ctx)
  //   // if not structtype.isStruct():
  //   //     raise InternalError("StructDatatype is not of type struct")

  //   // ctx.code = f"({structtype.generateUsageCode()}){{ "  # type: ignore
  //   // fields = getStructFields(structtype)
  //   // for i in range(len(fields)):
  //   //     expr = ctx.objectattribute()[i].expr()
  //   //     ctx.code += f".{fields[i].name} = {implicitConversion(self.getNodeDatatype(expr), fields[i].type, expr.code, self.getLocation(ctx))}, "  # type: ignore
  //   // ctx.code += " }"  # type: ignore
  // }

  // visitExprMemberAccess(self, ctx) {
  //   throw new InternalError("Not implemented");

  //   // self.visitChildren(ctx)

  //   // symbol = self.getNodeSymbol(ctx.expr())
  //   // if symbol.type.isStruct():
  //   //     if self.hasNodeMemberAccessFieldIndex(ctx):
  //   //         fieldIndex = self.getNodeMemberAccessFieldIndex(ctx)
  //   //         ctx.code = (  # type: ignore
  //   //             f"{symbol.name}.{getStructFields(symbol.type)[fieldIndex].name}"
  //   //         )
  //   //         # symbol.type.genericsDict = symbol.type.genericsDict
  //   //         ctx.structSymbol = symbol  # type: ignore

  //   //     elif self.hasNodeMemberAccessFunctionSymbol(ctx):
  //   //         memberFuncSymbol = self.getNodeMemberAccessFunctionSymbol(ctx)
  //   //         # memberFuncSymbol.parentNamespace = Namespace(
  //   //         #     symbol.type.getDisplayName()
  //   //         # )
  //   //         # memberFuncSymbol.type.genericsDict = symbol.type.genericsDict
  //   //         ctx.code = f"{memberFuncSymbol.getMangledName()}"  # type: ignore
  //   //         ctx.structSymbol = symbol  # type: ignore
  //   //     else:
  //   //         raise InternalError("Neither field nor function")
  //   // elif symbol.type.isPointer():
  //   //     if self.hasNodeMemberAccessFieldIndex(ctx) and symbol.type.pointee:
  //   //         fieldIndex = self.getNodeMemberAccessFieldIndex(ctx)
  //   //         ctx.code = f"{symbol.name}->{getStructFields(symbol.type.pointee)[fieldIndex].name}"  # type: ignore
  //   //         # ctx.structSymbol = symbol
  //   //     else:
  //   //         raise InternalError("Cannot call function on pointer")
  //   // else:
  //   //     raise InternalError(
  //   //         f"Member access type {symbol.type.getDisplayName()} is not structural"
  //   //     )
  // }
}

export function generateCode(program: Program, outfile: string) {
  const gen = new CodeGenerator(program);
  gen.generate();
  gen.writeFile(outfile);
}
