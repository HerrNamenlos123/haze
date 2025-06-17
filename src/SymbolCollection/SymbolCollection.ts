import { CompilerError, type SourceLoc } from "../Errors";
import type {
  ASTBinaryExpr,
  ASTConstant,
  ASTConstantExpr,
  ASTDatatype,
  ASTExplicitCastExpr,
  ASTExprAsFuncbody,
  ASTExprAssignmentExpr,
  ASTExprCallExpr,
  ASTExprMemberAccess,
  ASTFunctionDeclaration,
  ASTFunctionDefinition,
  ASTGlobalVariableDefinition,
  ASTLambdaExpr,
  ASTNamedDatatype,
  ASTNamespaceDefinition,
  ASTParenthesisExpr,
  ASTPostIncrExpr,
  ASTPreIncrExpr,
  ASTRoot,
  ASTScope,
  ASTStructDefinition,
  ASTStructInstantiationExpr,
  ASTSymbolValueExpr,
  ASTUnaryExpr,
} from "../shared/AST";
import { Collect, type CollectResult } from "./CollectSymbols";

function collect(
  scope: Collect.Scope,
  statement:
    | ASTFunctionDeclaration
    | ASTFunctionDefinition
    | ASTGlobalVariableDefinition
    | ASTNamespaceDefinition
    | ASTScope
    | ASTParenthesisExpr
    | ASTExprAssignmentExpr
    | ASTExprCallExpr
    | ASTUnaryExpr
    | ASTExprMemberAccess
    | ASTLambdaExpr
    | ASTPreIncrExpr
    | ASTConstantExpr
    | ASTPostIncrExpr
    | ASTStructInstantiationExpr
    | ASTExplicitCastExpr
    | ASTBinaryExpr
    | ASTExprAsFuncbody
    | ASTSymbolValueExpr
    | ASTStructDefinition,
) {
  switch (statement.variant) {
    case "FunctionDeclaration":
      scope.symbolTable.defineSymbol(statement);
      break;

    case "FunctionDefinition":
      statement.funcbody.scope = new Collect.Scope(statement.sourceloc, scope);
      scope.symbolTable.defineSymbol(statement);
      for (const param of statement.params) {
        statement.funcbody.scope.symbolTable.defineSymbol({
          variant: "VariableDefinitionStatement",
          mutable: false,
          name: param.name,
          datatype: param.datatype,
          sourceloc: param.sourceloc,
          isParameter: true,
        });
      }
      collect(statement.funcbody.scope, statement.funcbody);
      break;

    case "ExprAsFuncBody":
      collect(statement.scope!, statement.expr);
      break;

    case "GlobalVariableDefinition":
      scope.symbolTable.defineSymbol(statement);
      break;

    case "NamespaceDefinition": {
      let namespace = statement;
      if (scope.symbolTable.tryLookupSymbolHere(namespace.name)) {
        namespace = scope.symbolTable.tryLookupSymbolHere(
          namespace.name,
        ) as ASTNamespaceDefinition;
      } else {
        namespace.scope = new Collect.Scope(namespace.sourceloc, scope);
        scope.symbolTable.defineSymbol(namespace);
      }
      for (const s of statement.declarations) {
        collect(namespace.scope!, s);
      }
      break;
    }

    case "StructDefinition":
      for (const method of statement.methods) {
        method.funcbody.scope = new Collect.Scope(statement.sourceloc, scope);
        if (method.funcbody.variant === "Scope") {
          for (const param of method.params) {
            method.funcbody.scope.symbolTable.defineSymbol({
              variant: "VariableDefinitionStatement",
              mutable: false,
              name: param.name,
              datatype: param.datatype,
              sourceloc: param.sourceloc,
              isParameter: true,
            });
          }
          collect(method.funcbody.scope, method.funcbody);
        }
      }
      scope.symbolTable.defineSymbol(statement);
      break;

    case "Scope":
      for (const s of statement.statements) {
        switch (s.variant) {
          case "ExprStatement":
            collect(scope, s.expr);
            break;

          case "IfStatement":
            collect(scope, s.condition);
            s.then.scope = new Collect.Scope(s.then.sourceloc, scope);
            collect(s.then.scope, s.then);
            for (const e of s.elseIfs) {
              collect(scope, e.condition);
              e.then.scope = new Collect.Scope(e.then.sourceloc, scope);
              collect(e.then.scope, e.then);
            }
            if (s.else) {
              s.else.scope = new Collect.Scope(s.else.sourceloc, scope);
              collect(s.else.scope, s.else);
            }
            break;

          case "InlineCStatement":
            break;

          case "ReturnStatement":
            if (s.expr) {
              collect(scope, s.expr);
            }
            break;

          case "WhileStatement":
            collect(scope, s.condition);
            s.body.scope = new Collect.Scope(s.body.sourceloc, scope);
            collect(s.body.scope, s.body);
            break;

          case "VariableDefinitionStatement":
            if (scope.symbolTable.tryLookupSymbolHere(s.name)) {
              throw new CompilerError(
                `Variable '${s.name}' is already defined in this scope`,
                s.sourceloc,
              );
            }
            scope.symbolTable.defineSymbol(s);
            break;
        }
      }
      break;

    case "ParenthesisExpr":
      collect(scope, statement.expr);
      break;

    case "BinaryExpr":
      collect(scope, statement.a);
      collect(scope, statement.b);
      break;

    case "ConstantExpr":
      break;

    case "SymbolValueExpr":
      break;

    case "LambdaExpr":
      statement.lambda.funcbody.scope = new Collect.Scope(
        statement.sourceloc,
        scope,
      );
      for (const param of statement.lambda.params) {
        statement.lambda.funcbody.scope.symbolTable.defineSymbol({
          variant: "VariableDefinitionStatement",
          mutable: false,
          name: param.name,
          datatype: param.datatype,
          sourceloc: param.sourceloc,
          isParameter: true,
        });
      }
      collect(statement.lambda.funcbody.scope, statement.lambda.funcbody);
      break;

    case "StructInstantiationExpr":
      for (const member of statement.members) {
        collect(scope, member.value);
      }
      break;

    case "UnaryExpr":
      collect(scope, statement.expr);
      break;

    case "PreIncrExpr":
      collect(scope, statement.expr);
      break;

    case "PostIncrExpr":
      collect(scope, statement.expr);
      break;

    case "ExprMemberAccess":
      collect(scope, statement.expr);
      break;

    case "ExplicitCastExpr":
      collect(scope, statement.expr);
      break;

    case "ExprAssignmentExpr":
      collect(scope, statement.target);
      collect(scope, statement.value);
      break;

    case "ExprCallExpr":
      collect(scope, statement.calledExpr);
      for (const a of statement.arguments) {
        collect(scope, a);
      }
      break;
  }
}

function collectProg(cr: CollectResult, ast: ASTRoot) {
  for (const statement of ast) {
    switch (statement.variant) {
      case "CInjectDirective":
        cr.cInjections.push({
          code: statement.code,
          sourceloc: statement.sourceloc,
        });
        break;

      case "FunctionDeclaration":
      case "FunctionDefinition":
      case "GlobalVariableDefinition":
      case "NamespaceDefinition":
      case "StructDefinition":
        collect(cr.globalScope, statement);
        break;
    }
  }
}

export function CollectSymbols(ast: ASTRoot, rootLocation: SourceLoc) {
  const cr: CollectResult = {
    cInjections: [],
    globalScope: new Collect.Scope(rootLocation),
  };
  collectProg(cr, ast);
  return cr;
}

export function PrettyPrintCollected(cr: CollectResult) {
  console.log("C Injections:");
  for (const i of cr.cInjections) {
    console.log(" - " + i.code);
  }
  console.log("\n");

  const serializeAstDatatype = (
    datatype: ASTDatatype | ASTConstant,
  ): string => {
    if (datatype.variant === "FunctionDatatype") {
      return `(${datatype.params.map((p) => `${p.name}: ${serializeAstDatatype(p.datatype)}`).join(", ")}${datatype.ellipsis ? ", ..." : ""}) => ${serializeAstDatatype(datatype.returnType)}`;
    } else if (datatype.variant === "NamedDatatype") {
      let s = "";
      let d: ASTNamedDatatype | undefined = datatype;
      while (d) {
        s =
          `${datatype.name}${datatype.generics.length > 0 ? `<${datatype.generics.map((g) => serializeAstDatatype(g)).join(", ")}>` : ""}` +
          s;
        d = d.nestedParent;
      }
      return s;
    } else {
      return datatype.value.toString();
    }
  };

  const printScope = (scope: Collect.Scope, indent: number) => {
    const print = (str: string, _indent = 0) => {
      console.log(" ".repeat(indent + _indent) + str);
    };

    print(`Statements (${scope.statements.length}):`);
    for (const s of scope.statements) {
      print("  - " + JSON.stringify(s));
    }
    print(`Symbols (${scope.symbolTable.symbols.length}):`);
    for (const s of scope.symbolTable.symbols) {
      switch (s.variant) {
        case "NamespaceDefinition":
          print(`  - Namespace ${s.name}: export=${s.export}`);
          if (s.scope) printScope(s.scope, indent + 6);
          break;

        case "FunctionDeclaration":
          print(
            `  - FuncDecl ${s.namespacePath.length > 0 ? s.namespacePath.join(".") + "." : ""}${s.name}(${s.params.map((p) => `${p.name}: ${serializeAstDatatype(p.datatype)}`).join(", ")}${s.ellipsis ? ", ..." : ""}): ${serializeAstDatatype(s.returnType)} export=${s.export}`,
          );
          break;

        case "FunctionDefinition":
          print(
            `  - FuncDef ${s.name}${s.generics.length > 0 ? "<" + s.generics.join(", ") + ">" : ""}(${s.params.map((p) => `${p.name}: ${serializeAstDatatype(p.datatype)}`).join(", ")}${s.ellipsis ? ", ..." : ""}): ${s.returnType && serializeAstDatatype(s.returnType)} export=${s.export}`,
          );
          if (s.funcbody.scope) printScope(s.funcbody.scope, indent + 6);
          break;

        case "GlobalVariableDefinition":
          print(
            `  - Global Variable ${s.mutable ? "let" : "const"} ${s.name} export=${s.export}`,
          );
          break;

        case "StructDefinition":
          print(
            `  - Struct ${s.name}${s.generics.length > 0 ? "<" + s.generics.join(", ") + ">" : ""}`,
          );
          print(`      Members:`);
          for (const member of s.members) {
            print(
              `        - ${member.name}: ${serializeAstDatatype(member.type)}`,
            );
          }
          print(`      Methods:`);
          for (const m of s.methods) {
            print(
              `        - ${m.name}${m.generics.length > 0 ? "<" + m.generics.join(", ") + ">" : ""}(${m.params.map((p) => `${p.name}: ${serializeAstDatatype(p.datatype)}`).join(", ")}${m.ellipsis ? ", ..." : ""}): ${m.returnType && serializeAstDatatype(m.returnType)}`,
            );
            if (m.funcbody.scope) printScope(m.funcbody.scope, indent + 12);
          }
          break;

        case "VariableDefinitionStatement":
          print(`  - Variable ${s.mutable ? "let" : "const"} ${s.name}`);
          break;
      }
    }
    console.log("\n");
  };

  console.log("Global Scope:");
  printScope(cr.globalScope, 2);
}
