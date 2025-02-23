import { Program } from "./Program";
import { InternalError, ImpossibleSituation } from "./Errors";
import type { StructDeclContext } from "./parser/HazeParser";
import {
  FunctionType,
  mangleDatatype,
  mangleSymbol,
  type FunctionSymbol,
} from "./Symbol";
import {
  generateDefinitionCCode,
  generateUsageCode,
  type Datatype,
  type FunctionDatatype,
} from "./Datatype";
import type { Statement } from "./Statement";
import type { Expression } from "./Expression";

const CONTEXT_STRUCT = "_HN4Haze7ContextE";

class CodeGenerator {
  private program: Program;
  private output: Record<string, Record<string, string>>;

  constructor(program: Program) {
    this.program = program;
    this.output = {
      includes: {},
      type_declarations: {},
      function_declarations: {},
      function_definitions: {},
    };
    this.output["type_declarations"][CONTEXT_STRUCT] =
      `typedef struct __${CONTEXT_STRUCT}__ {} ${CONTEXT_STRUCT};`;
    this.output["function_definitions"]["main"] =
      `int32_t main() {\n    ${CONTEXT_STRUCT} context = { };\n    return _H4main(&context);\n}`;
  }

  includeHeader(filename: string) {
    this.output["includes"][filename] = `#include <${filename}>`;
  }

  outputFunctionDecl(symbol: FunctionSymbol, value: string) {
    if (!(mangleSymbol(symbol) in this.output["function_declarations"])) {
      this.output["function_declarations"][mangleSymbol(symbol)] = "";
    }
    this.output["function_declarations"][mangleSymbol(symbol)] += value;
  }

  outputFunctionDef(symbol: FunctionSymbol, value: string) {
    if (!(mangleSymbol(symbol) in this.output["function_definitions"])) {
      this.output["function_definitions"][mangleSymbol(symbol)] = "";
    }
    this.output["function_definitions"][mangleSymbol(symbol)] += value;
  }

  writeFile(filename: string) {
    const fs = require("fs");
    const path = require("path");

    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, "// Include section\n");
    fs.appendFileSync(
      filename,
      Object.values(this.output["includes"]).join("\n"),
    );

    fs.appendFileSync(filename, "\n\n// Type declaration section\n");
    fs.appendFileSync(
      filename,
      Object.values(this.output["type_declarations"]).join("\n"),
    );

    fs.appendFileSync(filename, "\n\n// Function declaration section\n");
    fs.appendFileSync(
      filename,
      Object.values(this.output["function_declarations"]).join("\n"),
    );

    fs.appendFileSync(filename, "\n\n// Function definition section\n");
    fs.appendFileSync(
      filename,
      Object.values(this.output["function_definitions"]).join("\n\n"),
    );
  }

  generate() {
    this.includeHeader("stdio.h");
    this.includeHeader("stdint.h");

    for (const symbol of Object.values(this.program.concreteFunctions)) {
      this.generateFuncUse(symbol);
    }

    // for (const dt of Object.values(this.program.con)) {
    //   this.generateDatatypeUse(dt);
    // }
  }

  generateFuncUse(symbol: FunctionSymbol) {
    const declaration = (
      ftype: FunctionDatatype,
      returntype: Datatype,
    ): string => {
      let decl =
        generateUsageCode(returntype) + " " + mangleSymbol(symbol) + "(";
      const params = [];
      params.push(`${CONTEXT_STRUCT}* context`);
      if (symbol.thisPointer) {
        params.push(`${generateUsageCode(symbol.thisPointer)} this`);
      }
      params.push(
        ...ftype.functionParameters.map(
          ([paramName, paramType]) =>
            generateUsageCode(paramType) + " " + paramName,
        ),
      );
      decl += params.join(", ");
      decl += ")";
      return decl;
    };

    const decl = declaration(symbol.type, symbol.type.functionReturnType);
    this.outputFunctionDecl(symbol, decl + ";");
    this.outputFunctionDef(symbol, decl + " {\n");

    for (const statement of symbol.scope.statements) {
      this.outputFunctionDef(symbol, this.cgStatement(statement) + "\n");
    }

    this.outputFunctionDef(symbol, "}");
  }

  cgStatement(statement: Statement): string {
    // if (statement instanceof ReturnStatement) {
    //   if (!statement.expr) {
    //     return "return;";
    //   }
    //   return "return " + this.cgExpr(statement.expr) + ";";
    // } else if (statement instanceof VariableDefinitionStatement) {
    //   if (!statement.expr || !statement.symbol.type) {
    //     throw new ImpossibleSituation();
    //   }
    //   const ret = statement.symbol.type.generateUsageCode();
    //   return `${ret} ${statement.symbol.name} = ${this.cgExpr(statement.expr)};`;
    // } else if (statement instanceof ExprStatement) {
    //   return this.cgExpr(statement.expr) + ";";
    // }
    throw new InternalError(`Unknown statement type ${typeof statement}`);
  }

  cgExpr(expr: Expression): string {
    switch (expr.variant) {
      case "ExprCall":
        const args = [];
        if (expr.expr.variant === "SymbolValue") {
          if (expr.expr.symbol.variant === "Function") {
            if (expr.expr.symbol.functionType === FunctionType.Internal) {
              args.push("context");
            }
          }
        }
        if (expr.thisPointerExpr) {
          args.push("&" + this.cgExpr(expr.thisPointerExpr));
        }
        for (const arg of expr.args) {
          args.push(this.cgExpr(arg));
        }
        return this.cgExpr(expr.expr) + "(" + args.join(", ") + ")";
      case "Object":
        let s = `((${generateUsageCode(expr.type)}) { `;
        for (const [symbol, memberExpr] of expr.members) {
          s += `.${symbol.name} = ${this.cgExpr(memberExpr)}, `;
        }
        s += " })";
        return s;
      case "MemberAccess":
        return this.cgExpr(expr.expr) + "." + expr.memberName;
      case "SymbolValue":
        if (expr.symbol.variant === "Function") {
          return mangleSymbol(expr.symbol);
        } else if (expr.symbol.variant !== "Constant") {
          return expr.symbol.name;
        } else {
          throw new ImpossibleSituation();
        }
      case "Constant":
        switch (typeof expr.constantSymbol.value) {
          case "number":
          case "boolean":
            return expr.constantSymbol.value.toString();
          case "string":
            return expr.constantSymbol.value;
          default:
            throw new InternalError(
              `Unknown constant type ${typeof expr.constantSymbol.value}`,
            );
        }
      default:
        throw new InternalError(`Unknown expression type ${typeof expr}`);
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

  generateDatatypeUse(datatype: Datatype) {
    this.output["type_declarations"][mangleDatatype(datatype)] =
      generateDefinitionCCode(datatype);
  }

  //   visitInlineCStatement(ctx: any) {
  //     const string = ctx.STRING_LITERAL().getText().slice(1, -1);
  //     ctx.code = string + "\n"; // type: ignore
  //   }

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

  visitNamedObjectExpr(ctx) {
    throw new InternalError("Not implemented");
    // self.visitChildren(ctx)
    // structtype = self.getNodeDatatype(ctx)
    // if not structtype.isStruct():
    //     raise InternalError("StructDatatype is not of type struct")

    // ctx.code = f"({structtype.generateUsageCode()}){{ "  # type: ignore
    // fields = getStructFields(structtype)
    // for i in range(len(fields)):
    //     expr = ctx.objectattribute()[i].expr()
    //     ctx.code += f".{fields[i].name} = {implicitConversion(self.getNodeDatatype(expr), fields[i].type, expr.code, self.getLocation(ctx))}, "  # type: ignore
    // ctx.code += " }"  # type: ignore
  }

  visitExprMemberAccess(self, ctx) {
    throw new InternalError("Not implemented");

    // self.visitChildren(ctx)

    // symbol = self.getNodeSymbol(ctx.expr())
    // if symbol.type.isStruct():
    //     if self.hasNodeMemberAccessFieldIndex(ctx):
    //         fieldIndex = self.getNodeMemberAccessFieldIndex(ctx)
    //         ctx.code = (  # type: ignore
    //             f"{symbol.name}.{getStructFields(symbol.type)[fieldIndex].name}"
    //         )
    //         # symbol.type.genericsDict = symbol.type.genericsDict
    //         ctx.structSymbol = symbol  # type: ignore

    //     elif self.hasNodeMemberAccessFunctionSymbol(ctx):
    //         memberFuncSymbol = self.getNodeMemberAccessFunctionSymbol(ctx)
    //         # memberFuncSymbol.parentNamespace = Namespace(
    //         #     symbol.type.getDisplayName()
    //         # )
    //         # memberFuncSymbol.type.genericsDict = symbol.type.genericsDict
    //         ctx.code = f"{memberFuncSymbol.getMangledName()}"  # type: ignore
    //         ctx.structSymbol = symbol  # type: ignore
    //     else:
    //         raise InternalError("Neither field nor function")
    // elif symbol.type.isPointer():
    //     if self.hasNodeMemberAccessFieldIndex(ctx) and symbol.type.pointee:
    //         fieldIndex = self.getNodeMemberAccessFieldIndex(ctx)
    //         ctx.code = f"{symbol.name}->{getStructFields(symbol.type.pointee)[fieldIndex].name}"  # type: ignore
    //         # ctx.structSymbol = symbol
    //     else:
    //         raise InternalError("Cannot call function on pointer")
    // else:
    //     raise InternalError(
    //         f"Member access type {symbol.type.getDisplayName()} is not structural"
    //     )
  }
}

export function generateCode(program: Program, outfile: string) {
  const gen = new CodeGenerator(program);
  gen.generate();
  gen.writeFile(outfile);
}
