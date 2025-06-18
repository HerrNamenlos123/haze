import { CompilerError, InternalError, type SourceLoc } from "../Errors";
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
  ASTFuncBody,
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
import { assertScope, EMethodType } from "../shared/common";
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
  meta: {
    currentNamespace?: ASTNamespaceDefinition;
    currentStruct?: ASTStructDefinition;
    namespaceStack: ASTNamespaceDefinition[];
  },
) {
  switch (statement.variant) {
    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "FunctionDeclaration":
      if (!statement.returnType) {
        statement.returnType = {
          variant: "NamedDatatype",
          name: "none",
          generics: [],
          sourceloc: statement.sourceloc,
        };
      }

      statement._collect.definedInStruct = meta.currentStruct;
      statement._collect.definedInNamespace = meta.currentNamespace;
      statement._collect.definedInScope = scope;
      statement._collect.namespacePath = [
        ...meta.namespaceStack.map((n) => n.name),
        ...statement.namespacePath,
      ];
      statement._collect.method = EMethodType.NotAMethod;
      if (statement._collect.definedInStruct) {
        statement._collect.method = EMethodType.Method;
      }

      if (scope.symbolTable.tryLookupSymbolHere(statement.name)) {
        throw new CompilerError(
          `Symbol was already declared in this scope`,
          statement.sourceloc,
        );
      }

      scope.symbolTable.defineSymbol(statement);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "FunctionDefinition":
      statement.funcbody._collect.scope = new Collect.Scope(
        statement.sourceloc,
        scope,
      );
      statement._collect.definedInNamespace = meta.currentNamespace;
      statement._collect.definedInStruct = meta.currentStruct;
      statement._collect.definedInScope = scope;
      statement._collect.namespacePath = meta.namespaceStack.map((n) => n.name);

      if (!statement.returnType) {
        statement.returnType = {
          variant: "Deferred",
        };
      }

      if (scope.symbolTable.tryLookupSymbolHere(statement.name)) {
        throw new CompilerError(
          `Symbol was already declared in this scope`,
          statement.sourceloc,
        );
      }

      for (const param of statement.params) {
        statement.funcbody._collect.scope.symbolTable.defineSymbol({
          variant: "VariableDefinitionStatement",
          mutable: false,
          name: param.name,
          datatype: param.datatype,
          sourceloc: param.sourceloc,
          isParameter: true,
          _semantic: {},
        });
      }

      scope.symbolTable.defineSymbol(statement);
      if (statement.funcbody.variant === "ExprAsFuncBody") {
        // Rebuilding "() => x" into "() => { return x; }"
        statement.funcbody = {
          variant: "Scope",
          statements: [
            {
              variant: "ReturnStatement",
              sourceloc: statement.sourceloc,
              expr: statement.funcbody.expr,
            },
          ],
          sourceloc: statement.sourceloc,
          _collect: {
            scope: statement.funcbody._collect.scope,
          },
        };
        collect(
          assertScope(statement.funcbody._collect.scope),
          statement.funcbody,
          meta,
        );
      } else {
        collect(statement.funcbody._collect.scope, statement.funcbody, meta);
      }
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExprAsFuncBody":
      throw new InternalError("This is handled elsewhere");

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "GlobalVariableDefinition":
      scope.symbolTable.defineSymbol(statement);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "NamespaceDefinition": {
      let namespace = statement;
      if (scope.symbolTable.tryLookupSymbolHere(namespace.name)) {
        namespace = scope.symbolTable.tryLookupSymbolHere(
          namespace.name,
        ) as ASTNamespaceDefinition;
      } else {
        namespace._collect.scope = new Collect.Scope(
          namespace.sourceloc,
          scope,
        );
        scope.symbolTable.defineSymbol(namespace);
      }
      for (const s of statement.declarations) {
        collect(namespace._collect.scope!, s, {
          ...meta,
          currentNamespace: namespace,
          namespaceStack: [...meta.namespaceStack, namespace],
        });
      }
      break;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "StructDefinition":
      statement._collect.definedInScope = scope;
      statement._collect.scope = new Collect.Scope(statement.sourceloc, scope);
      statement._collect.namespaces = meta.namespaceStack.map((n) => n.name);
      statement._collect.fullNamespacedName = [
        ...statement._collect.namespaces,
        statement.name,
      ];
      for (const g of statement.generics) {
        statement._collect.scope.symbolTable.defineSymbol({
          variant: "GenericPlaceholder",
          name: g,
          belongsToSymbol: statement,
          sourceloc: statement.sourceloc,
        });
      }
      scope.symbolTable.defineSymbol(statement);

      console.log(
        "Collected: ",
        statement.name,
        statement._collect.scope.symbolTable.symbols.map((s) => s.name),
      );

      for (const method of statement.methods) {
        method.funcbody._collect.scope = new Collect.Scope(
          statement.sourceloc,
          scope,
        );
        for (const param of method.params) {
          method.funcbody._collect.scope.symbolTable.defineSymbol({
            variant: "VariableDefinitionStatement",
            mutable: false,
            name: param.name,
            datatype: param.datatype,
            sourceloc: param.sourceloc,
            isParameter: true,
            _semantic: {},
          });
        }
        collect(method.funcbody._collect.scope, method.funcbody, {
          ...meta,
          currentStruct: statement,
        });
      }
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "Scope":
      for (const s of statement.statements) {
        switch (s.variant) {
          case "ExprStatement":
            collect(scope, s.expr, meta);
            break;

          case "IfStatement":
            collect(scope, s.condition, meta);
            s.then._collect.scope = new Collect.Scope(s.then.sourceloc, scope);
            collect(s.then._collect.scope, s.then, meta);
            for (const e of s.elseIfs) {
              collect(scope, e.condition, meta);
              e.then._collect.scope = new Collect.Scope(
                e.then.sourceloc,
                scope,
              );
              collect(e.then._collect.scope, e.then, meta);
            }
            if (s.else) {
              s.else._collect.scope = new Collect.Scope(
                s.else.sourceloc,
                scope,
              );
              collect(s.else._collect.scope, s.else, meta);
            }
            break;

          case "InlineCStatement":
            break;

          case "ReturnStatement":
            if (s.expr) {
              collect(scope, s.expr, meta);
            }
            break;

          case "WhileStatement":
            collect(scope, s.condition, meta);
            s.body._collect.scope = new Collect.Scope(s.body.sourceloc, scope);
            collect(s.body._collect.scope, s.body, meta);
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
        scope.statements.push(s);
      }
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ParenthesisExpr":
      collect(scope, statement.expr, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "BinaryExpr":
      collect(scope, statement.a, meta);
      collect(scope, statement.b, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ConstantExpr":
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "SymbolValueExpr":
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "LambdaExpr":
      statement.lambda.funcbody._collect.scope = new Collect.Scope(
        statement.sourceloc,
        scope,
      );
      for (const param of statement.lambda.params) {
        statement.lambda.funcbody._collect.scope.symbolTable.defineSymbol({
          variant: "VariableDefinitionStatement",
          mutable: false,
          name: param.name,
          datatype: param.datatype,
          sourceloc: param.sourceloc,
          isParameter: true,
          _semantic: {},
        });
      }
      collect(
        statement.lambda.funcbody._collect.scope,
        statement.lambda.funcbody,
        meta,
      );
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "StructInstantiationExpr":
      for (const member of statement.members) {
        collect(scope, member.value, meta);
      }
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "UnaryExpr":
      collect(scope, statement.expr, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "PreIncrExpr":
      collect(scope, statement.expr, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "PostIncrExpr":
      collect(scope, statement.expr, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExprMemberAccess":
      collect(scope, statement.expr, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExplicitCastExpr":
      collect(scope, statement.expr, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExprAssignmentExpr":
      collect(scope, statement.target, meta);
      collect(scope, statement.value, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExprCallExpr":
      collect(scope, statement.calledExpr, meta);
      for (const a of statement.arguments) {
        collect(scope, a, meta);
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
        collect(cr.globalScope, statement, {
          namespaceStack: [],
        });
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
        s += `${datatype.name}${datatype.generics.length > 0 ? `<${datatype.generics.map((g) => serializeAstDatatype(g)).join(", ")}>` : ""}`;
        d = d.nested;
      }
      return s;
    } else if (datatype.variant === "Deferred") {
      return "_deferred_";
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
      // print("  - " + JSON.stringify(s));
    }
    print(`Symbols (${scope.symbolTable.symbols.length}):`);
    for (const s of scope.symbolTable.symbols) {
      switch (s.variant) {
        case "NamespaceDefinition":
          print(`  - Namespace ${s.name}: export=${s.export}`);
          if (s._collect.scope) printScope(s._collect.scope, indent + 6);
          break;

        case "FunctionDeclaration":
          print(
            `  - FuncDecl ${s.namespacePath.length > 0 ? s.namespacePath.join(".") + "." : ""}${s.name}(${s.params.map((p) => `${p.name}: ${serializeAstDatatype(p.datatype)}`).join(", ")}${s.ellipsis ? ", ..." : ""}): ${s.returnType && serializeAstDatatype(s.returnType)} export=${s.export}`,
          );
          break;

        case "FunctionDefinition":
          print(
            `  - FuncDef ${s.name}${s.generics.length > 0 ? "<" + s.generics.join(", ") + ">" : ""}(${s.params.map((p) => `${p.name}: ${serializeAstDatatype(p.datatype)}`).join(", ")}${s.ellipsis ? ", ..." : ""}): ${s.returnType && serializeAstDatatype(s.returnType)} export=${s.export}`,
          );
          if (s.funcbody._collect.scope)
            printScope(s.funcbody._collect.scope, indent + 6);
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
            if (m.funcbody._collect.scope)
              printScope(m.funcbody._collect.scope, indent + 12);
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
