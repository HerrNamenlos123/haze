import { AbstractParseTreeVisitor, type ParserRuleContext } from "antlr4ng";
import type { DatatypeRef } from "./Datatype";
import type { ParamContext } from "./parser/HazeParser";
import type { Program } from "./Program";
import type { FunctionSymbol, FunctionType } from "./Symbol";
import HazeVisitor from "./parser/HazeVisitor";

export class Hans<Result> extends AbstractParseTreeVisitor<Result> {
  // Optional visitParam method
  visitParam?: (ctx: ParamContext) => Result;

  // Other visit methods...
}

class Hans2 extends Hans<number> {
  // Override the optional visitParam method
  visitParam(ctx: ParamContext): number {
    // Custom logic for visiting Param
    console.log("Visiting Param:", ctx);
    return 0; // Return an appropriate value (e.g., 0 or calculated sum)
  }

  // Override other methods as needed
}

class SumVisitor extends HazeVisitor<number> {
  visitParam(ctx: ParserRuleContext): number {
    return parseInt(ctx.getText(), 10); // Return the number value
  }

  visitAddition(ctx: AdditionContext): number {
    const left = this.visit(ctx.left); // Visit the left child
    const right = this.visit(ctx.right); // Visit the right child
    return left + right; // Return the sum
  }
}

export class Test extends HazeVisitor<number> {
  visitParam(ctx: ParserRuleContext): number {
    return 0;
  }
}

export class SymbolCollector extends HazeVisitor<number> {
  private program: Program;
  private currentFunctionType: FunctionType | undefined;
  private structStack: DatatypeRef[];
  private currentFunctionSymbols: FunctionSymbol[];

  constructor(program: Program) {
    super();
    this.program = program;
    this.currentFunctionType = undefined;
    this.structStack = [];
    this.currentFunctionSymbols = [];
  }

  visitParam = (ctx): any => {
    return [ctx.ID().getText(), this.visit(ctx.datatype())];
  };

  public visitGenericDatatype(
    ctx: HazeParser.GenericDatatypeContext,
  ): Datatype {
    const name = ctx.ID().getText();
    const foundSymbol = this.db
      .getCurrentScope()
      .tryLookupSymbol(name, this.getLocation(ctx));
    if (!foundSymbol) {
      throw new CompilerError(
        `Type '${name}' is not defined.`,
        this.getLocation(ctx),
      );
    }

    const genericsProvided = ctx.datatype().map((n) => this.visit(n));
    if (foundSymbol.type.generics().length !== genericsProvided.length) {
      throw new CompilerError(
        `Datatype expected ${foundSymbol.type.generics().length} generic arguments but got ${genericsProvided.length}.`,
        this.getLocation(ctx),
      );
    }

    const generics: [string, Datatype | null][] = [];
    const scope = new Scope(this.getLocation(ctx), this.db.getCurrentScope());
    for (let i = 0; i < foundSymbol.type.generics().length; i++) {
      const name = foundSymbol.type.generics()[i][0];
      const givenType = genericsProvided[i];
      if (givenType && !givenType.isGeneric()) {
        generics.push([name, givenType]);
      } else {
        generics.push([name, null]);
      }
      if (givenType) {
        scope.defineSymbol(
          new DatatypeSymbol(name, null, givenType),
          this.getLocation(ctx),
        );
      }
    }

    foundSymbol = Object.assign({}, foundSymbol);
    foundSymbol.type._generics = generics;

    const dt = resolveGenerics(foundSymbol.type, scope, this.getLocation(ctx));
    return dt;
  }

  public visitFunctionDatatype(
    ctx: HazeParser.FunctionDatatypeContext,
  ): Datatype {
    const params = ctx
      .functype()
      .params()
      .param()
      .map((n) => this.visit(n));
    const dt = Datatype.createFunctionType(
      params,
      this.visit(ctx.functype().returntype()),
    );
    if (dt.areAllGenericsResolved()) {
      this.program.resolvedDatatypes[dt.getMangledName()] = dt;
    }
    return dt;
  }

  public visitExternblock(ctx: HazeParser.ExternblockContext): void {
    const lang = ctx.externlang().getText()[1];
    if (lang === "C") {
      if (this.currentFunctionType) {
        throw new CompilerError(
          "Extern blocks cannot be nested",
          this.getLocation(ctx),
        );
      }
      this.currentFunctionType = FunctionLinkage.External_C;
      this.visitChildren(ctx);
      this.currentFunctionType = undefined;
    } else {
      throw new CompilerError(
        `Extern Language '${lang}' is not supported.`,
        this.getLocation(ctx),
      );
    }
  }

  public visitReturntype(ctx: HazeParser.ReturntypeContext): Datatype {
    return this.visit(ctx.datatype());
  }

  public visitExternfuncdef(ctx: HazeParser.ExternfuncdefContext): void {
    if (!this.currentFunctionType) {
      throw new ImpossibleSituation();
    }

    const signature = ctx.ID().map((n) => n.getText());
    if (
      signature.length > 1 &&
      this.currentFunctionType === FunctionLinkage.External_C
    ) {
      throw new CompilerError(
        "Extern C functions cannot be namespaced",
        this.getLocation(ctx),
      );
    }

    if (signature.length > 1) {
      throw new InternalError(
        "Namespacing for external function is not implemented yet",
      );
    }

    const name = signature[signature.length - 1];
    const symbol = new FunctionSymbol(
      name,
      null,
      Datatype.createFunctionType(
        [],
        Datatype.createPrimitiveType(Datatype.PrimitiveVariants.none),
      ),
      this.currentFunctionType,
      null,
      null,
      false,
      [],
      ctx,
    );

    const params: [string, Datatype][] = [];
    for (let i = 0; i < ctx.params().param().length; i++) {
      const name = ctx.params().param()[i].ID().getText();
      const datatype = this.visit(ctx.params().param()[i].datatype());
      params.push([name, datatype]);
    }

    this.currentFunctionSymbols.push(symbol);
    this.visitChildren(ctx);
    this.currentFunctionSymbols.pop();

    const returntype = symbol.type.functionReturnType();
    if (ctx.returntype()) {
      returntype = this.visit(ctx.returntype());
    }

    symbol.type = Datatype.createFunctionType(params, returntype);
    this.program.globalScope.defineSymbol(symbol, this.getLocation(ctx));
    this.program.externFunctionRefs.push(
      new ExternFunctionRef(
        FunctionLinkage.External_C,
        this.getLocation(ctx),
        symbol,
      ),
    );
    this.setNodeSymbol(ctx, symbol);
  }

  private implFunc(
    ctx:
      | HazeParser.FuncContext
      | HazeParser.NamedfuncContext
      | HazeParser.StructFuncDeclContext,
    name: string,
  ): FunctionSymbol {
    const scope = this.db.pushScope(
      new Scope(this.getLocation(ctx), this.db.getCurrentScope()),
    );

    if (this.currentFunctionType) {
      throw new ImpossibleSituation();
    }

    const symbol = new FunctionSymbol(
      name,
      this.structStack[this.structStack.length - 1],
      Datatype.createFunctionType([], Datatype.createDeferredType()),
      FunctionLinkage.Haze,
      scope,
      null,
      false,
      [],
      ctx,
    );
    this.setNodeSymbol(ctx, symbol);

    const params: [string, Datatype][] = [];
    for (let i = 0; i < ctx.params().param().length; i++) {
      const nm = ctx.params().param()[i].ID().getText();
      const datatype = this.visit(ctx.params().param()[i].datatype());
      params.push([nm, datatype]);
      if (symbol.scope) {
        symbol.scope.defineSymbol(
          new VariableSymbol(nm, symbol, datatype, VariableType.Parameter),
          this.getLocation(ctx),
        );
      }
    }

    let returntype = Datatype.createDeferredType();
    if (ctx.returntype()) {
      returntype = this.visit(ctx.returntype());
    } else {
      if (ctx.funcbody().expr()) {
        const expr = this.visit(ctx.funcbody().expr());
        returntype = expr.type;
      }
    }

    if (symbol.parentSymbol && symbol.parentSymbol.type.isStruct()) {
      if (name === "constructor") {
        symbol.isConstructor = true;
        if (returntype.isDeferred()) {
          returntype = symbol.parentSymbol.type;
        } else {
          throw new CompilerError(
            `Constructor of struct '${symbol.parentSymbol.name}' returns the struct itself implicitly`,
            this.getLocation(ctx),
          );
        }
      } else {
        symbol.thisPointerType = Datatype.createPointerDatatype(
          symbol.parentSymbol.type,
        );
        if (!symbol.scope) {
          throw new ImpossibleSituation();
        }
        symbol.scope.defineSymbol(
          new VariableSymbol(
            "this",
            symbol,
            symbol.thisPointerType,
            VariableType.Parameter,
          ),
          this.getLocation(ctx),
        );
      }
    }

    symbol.type = Datatype.createFunctionType(params, returntype);
    this.program.globalScope.defineSymbol(symbol, this.getLocation(ctx));

    this.db.popScope();
    this.setNodeSymbol(ctx, symbol);
    return symbol;
  }

  public visitFunc(ctx: HazeParser.FuncContext): FunctionSymbol {
    return this.implFunc(ctx, this.db.makeAnonymousFunctionName());
  }

  public visitNamedfunc(ctx: HazeParser.NamedfuncContext): FunctionSymbol {
    return this.implFunc(ctx, ctx.ID().getText());
  }

  public visitStructFieldDecl(
    ctx: HazeParser.StructFieldDeclContext,
  ): VariableSymbol {
    const name = ctx.ID().getText();
    const datatype = this.visit(ctx.datatype());
    return new VariableSymbol(
      name,
      this.structStack[this.structStack.length - 1],
      datatype,
      VariableType.MutableStructField,
    );
  }

  public visitStructDecl(ctx: HazeParser.StructDeclContext): DatatypeSymbol {
    const name = ctx.ID().getText();
    const parentScope = this.db.getCurrentScope();
    const scope = this.db.pushScope(
      new Scope(this.getLocation(ctx), parentScope),
    );

    const genericsList = ctx.datatype().map((n) => [n.getText(), null]);
    genericsList.forEach((generic) => {
      scope.defineSymbol(
        new GenericPlaceholderSymbol(generic[0]),
        this.getLocation(ctx),
      );
    });

    const parentSymbol =
      this.structStack.length > 0
        ? this.structStack[this.structStack.length - 1]
        : undefined;
    const symbol = new DatatypeSymbol(
      name,
      parentSymbol,
      Datatype.createStructDatatype(name, genericsList, new SymbolTable()),
    );
    symbol.ctx = ctx;
    parentScope.defineSymbol(symbol, this.getLocation(ctx));

    this.structStack.push(symbol);

    const symbolTable = new SymbolTable();
    ctx.structcontent().forEach((content) => {
      symbolTable.insert(this.visit(content), this.getLocation(ctx));
    });

    symbol.type = Datatype.createStructDatatype(
      name,
      genericsList,
      symbolTable,
    );
    symbol.type._structMemberSymbols = symbolTable;

    this.structStack.pop();
    this.db.popScope();
    this.setNodeSymbol(ctx, symbol);
    return symbol;
  }

  public visitStructFuncDecl(
    ctx: HazeParser.StructFuncDeclContext,
  ): FunctionSymbol {
    const name = ctx.ID().getText();
    return this.implFunc(ctx, name);
  }
}
