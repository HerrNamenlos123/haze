import type { ParserRuleContext } from "antlr4";
import { CompilerError, Location } from "./Errors";
import { Scope } from "./Scope";
import type { FunctionSymbol } from "./Symbol";
import {
  primitiveVariantToString,
  type BaseDatatype,
  type BaseStructDatatype,
  type ConcreteDatatype,
} from "./Datatype";
import { isDeeplyEqual } from "./deep-equal";

export class Program {
  globalScope: Scope;
  resolvedFunctions: { [name: string]: FunctionSymbol };
  resolvedDatatypes: { [name: string]: ConcreteDatatype };
  filename: string;
  scopeStack: Scope[];

  baseDatatypes: BaseDatatype[] = [];
  concreteDatatypes: ConcreteDatatype[] = [];

  private anonymousStuffCounter = 0;

  constructor(filename: string) {
    this.filename = filename;
    this.globalScope = new Scope(new Location("global", 0, 0));
    this.resolvedFunctions = {};
    this.resolvedDatatypes = {};
    this.scopeStack = [];
  }

  pushScope(scope: Scope) {
    this.scopeStack.push(scope);
    return scope;
  }

  popScope() {
    this.scopeStack.pop();
  }

  get currentScope() {
    if (this.scopeStack.length === 0) {
      return this.globalScope;
    }
    return this.scopeStack[this.scopeStack.length - 1];
  }

  getLoc(ctx: ParserRuleContext) {
    return new Location(this.filename, ctx.start.line, ctx.start.column);
  }

  findBaseDatatype(basename: string) {
    for (const dt of this.baseDatatypes) {
      switch (dt.variant) {
        case "Primitive":
          if (primitiveVariantToString(dt) === basename) {
            return dt;
          }
          break;

        case "Struct":
          if (dt.name === basename) {
            return dt;
          }
          break;
      }
    }
    return undefined;
  }

  addBaseDatatypeRef(type: BaseDatatype, loc: Location) {
    switch (type.variant) {
      case "Primitive":
        if (
          !this.baseDatatypes.find(
            (d) => d.variant === "Primitive" && d.primitive === type.primitive,
          )
        ) {
          this.baseDatatypes.push(type);
        }
        break;

      case "Generic":
        break;

      case "Struct":
        const found = this.baseDatatypes.find(
          (d) => d.variant === "Struct" && d.name === type.name,
        ) as BaseStructDatatype | undefined;
        if (found) {
          if (found.generics !== type.generics) {
            throw new CompilerError(
              `Type '${found.name}<>' was already declared with incompatible generics list`,
              loc,
            );
          }
          if (!isDeeplyEqual(found.members, type.members)) {
            throw new CompilerError(
              `Type '${found.name}<>' was already declared with incompatible members list`,
              loc,
            );
          }
          if (!isDeeplyEqual(found.methods, type.methods)) {
            throw new CompilerError(
              `Type '${found.name}<>' was already declared with incompatible methods list`,
              loc,
            );
          }
        } else {
          this.baseDatatypes.push(type);
        }
        break;

      case "Function":
        this.addBaseDatatypeRef(type.functionReturnType, loc);
        type.functionParameters.forEach((p) =>
          this.addBaseDatatypeRef(p[1], loc),
        );
        break;
    }
    this.baseDatatypes.push(type);
  }

  makeAnonymousName() {
    return `__anonym_${this.anonymousStuffCounter++}`;
  }
}
