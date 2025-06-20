import { CompilerError, InternalError, type SourceLoc } from "../shared/Errors";
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
  item:
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
    | ASTStructDefinition
    | ASTDatatype,
  meta: {
    currentNamespaceOrStruct?: ASTNamespaceDefinition | ASTStructDefinition;
    namespaceStack: (ASTNamespaceDefinition | ASTStructDefinition)[];
  },
) {
  switch (item.variant) {
    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "FunctionDeclaration":
      if (!item.returnType) {
        item.returnType = {
          variant: "NamedDatatype",
          name: "none",
          generics: [],
          sourceloc: item.sourceloc,
          _collect: {
            usedInScope: scope,
          },
        };
      }

      item._collect.definedInNamespaceOrStruct = meta.currentNamespaceOrStruct;
      item._collect.definedInScope = scope;
      item._collect.namespacePath = [
        ...meta.namespaceStack.map((n) => n.name),
        ...item.namespacePath,
      ];
      item._collect.method = EMethodType.NotAMethod;
      if (item._collect.definedInNamespaceOrStruct?.variant === "StructDefinition") {
        item._collect.method = EMethodType.Method;
      }

      if (scope.symbolTable.tryLookupSymbolHere(item.name)) {
        throw new CompilerError(`Symbol was already declared in this scope`, item.sourceloc);
      }

      for (const param of item.params) {
        collect(scope, param.datatype, meta);
      }
      collect(scope, item.returnType, meta);

      scope.symbolTable.defineSymbol(item);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "FunctionDefinition":
      item.funcbody._collect.scope = new Collect.Scope(item.sourceloc, scope);
      item._collect.definedInNamespaceOrStruct = meta.currentNamespaceOrStruct;
      item._collect.definedInScope = scope;

      if (!item.returnType) {
        // item.returnType = {
        //   variant: "Deferred",
        // };
        item.returnType = {
          variant: "NamedDatatype",
          name: "none",
          generics: [],
          sourceloc: item.sourceloc,
          _collect: {},
        };
      }

      if (scope.symbolTable.tryLookupSymbolHere(item.name)) {
        throw new CompilerError(`Symbol was already declared in this scope`, item.sourceloc);
      }

      for (const param of item.params) {
        item.funcbody._collect.scope.symbolTable.defineSymbol({
          variant: "VariableDefinitionStatement",
          mutable: false,
          name: param.name,
          datatype: param.datatype,
          sourceloc: param.sourceloc,
          isParameter: true,
          _semantic: {},
        });
      }

      for (const param of item.params) {
        collect(scope, param.datatype, meta);
      }
      collect(scope, item.returnType, meta);

      scope.symbolTable.defineSymbol(item);
      if (item.funcbody.variant === "ExprAsFuncBody") {
        // Rebuilding "() => x" into "() => { return x; }"
        item.funcbody = {
          variant: "Scope",
          statements: [
            {
              variant: "ReturnStatement",
              sourceloc: item.sourceloc,
              expr: item.funcbody.expr,
            },
          ],
          sourceloc: item.sourceloc,
          _collect: {
            scope: item.funcbody._collect.scope,
          },
        };
        collect(assertScope(item.funcbody._collect.scope), item.funcbody, meta);
      } else {
        collect(item.funcbody._collect.scope, item.funcbody, meta);
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
      scope.symbolTable.defineSymbol(item);
      if (item.datatype) {
        collect(scope, item.datatype, meta);
      }
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "NamespaceDefinition": {
      let namespace = item;
      item._collect.definedInNamespaceOrStruct = meta.currentNamespaceOrStruct;
      if (scope.symbolTable.tryLookupSymbolHere(namespace.name)) {
        namespace = scope.symbolTable.tryLookupSymbolHere(namespace.name) as ASTNamespaceDefinition;
      } else {
        namespace._collect.scope = new Collect.Scope(namespace.sourceloc, scope);
        scope.symbolTable.defineSymbol(namespace);
      }
      for (const s of item.declarations) {
        collect(namespace._collect.scope!, s, {
          ...meta,
          currentNamespaceOrStruct: namespace,
          namespaceStack: [...meta.namespaceStack, namespace],
        });
      }
      break;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "StructDefinition":
      item._collect.definedInScope = scope;
      item._collect.scope = new Collect.Scope(item.sourceloc, scope);
      item._collect.namespaces = meta.namespaceStack.map((n) => n.name);
      item._collect.definedInNamespaceOrStruct = meta.currentNamespaceOrStruct;
      item._collect.fullNamespacedName = [...item._collect.namespaces, item.name];
      for (const g of item.generics) {
        item._collect.scope.symbolTable.defineSymbol({
          variant: "GenericPlaceholder",
          name: g,
          belongsToSymbol: item,
          sourceloc: item.sourceloc,
        });
      }
      scope.symbolTable.defineSymbol(item);

      const newMeta = {
        ...meta,
        currentNamespaceOrStruct: item,
        namespaceStack: [...meta.namespaceStack, item],
      };

      for (const decl of item.declarations) {
        collect(item._collect.scope, decl, newMeta);
      }

      for (const member of item.members) {
        collect(item._collect.scope, member.type, newMeta);
      }

      for (const method of item.methods) {
        method.funcbody._collect.scope = new Collect.Scope(item.sourceloc, item._collect.scope);
        method._collect.fullNamespacePath = [
          ...meta.namespaceStack.map((n) => n.name),
          method.name,
        ];
        method._collect.definedInScope = item._collect.scope;
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
          collect(item._collect.scope, param.datatype, newMeta);
        }
        if (method.returnType) {
          collect(item._collect.scope, method.returnType, newMeta);
        }
        collect(method.funcbody._collect.scope, method.funcbody, newMeta);
      }
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "Scope":
      for (const s of item.statements) {
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
              e.then._collect.scope = new Collect.Scope(e.then.sourceloc, scope);
              collect(e.then._collect.scope, e.then, meta);
            }
            if (s.else) {
              s.else._collect.scope = new Collect.Scope(s.else.sourceloc, scope);
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
            if (s.datatype) {
              collect(scope, s.datatype, meta);
            }
            if (s.expr) {
              collect(scope, s.expr, meta);
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
      collect(scope, item.expr, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "BinaryExpr":
      collect(scope, item.a, meta);
      collect(scope, item.b, meta);
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
      item.lambda.funcbody._collect.scope = new Collect.Scope(item.sourceloc, scope);
      for (const param of item.lambda.params) {
        item.lambda.funcbody._collect.scope.symbolTable.defineSymbol({
          variant: "VariableDefinitionStatement",
          mutable: false,
          name: param.name,
          datatype: param.datatype,
          sourceloc: param.sourceloc,
          isParameter: true,
          _semantic: {},
        });
      }

      for (const param of item.lambda.params) {
        collect(scope, param.datatype, meta);
      }
      if (item.lambda.returnType) {
        collect(scope, item.lambda.returnType, meta);
      }

      collect(item.lambda.funcbody._collect.scope, item.lambda.funcbody, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "StructInstantiationExpr":
      for (const member of item.members) {
        collect(scope, member.value, meta);
      }
      collect(scope, item.datatype, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "UnaryExpr":
      collect(scope, item.expr, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "PreIncrExpr":
      collect(scope, item.expr, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "PostIncrExpr":
      collect(scope, item.expr, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExprMemberAccess":
      collect(scope, item.expr, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExplicitCastExpr":
      collect(scope, item.expr, meta);
      collect(scope, item.castedTo, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExprAssignmentExpr":
      collect(scope, item.target, meta);
      collect(scope, item.value, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExprCallExpr":
      collect(scope, item.calledExpr, meta);
      for (const a of item.arguments) {
        collect(scope, a, meta);
      }
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "Deferred":
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "FunctionDatatype":
      for (const param of item.params) {
        collect(scope, param.datatype, meta);
      }
      collect(scope, item.returnType, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "NamedDatatype":
      let p: ASTNamedDatatype | undefined = item;
      while (p) {
        p._collect.usedInScope = scope;
        p = p.nested;
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

export function CollectSymbols(cr: CollectResult, ast: ASTRoot, rootLocation: SourceLoc) {
  collectProg(cr, ast);
  // PrettyPrintCollected(cr);
}

export function PrettyPrintCollected(cr: CollectResult) {
  console.log("C Injections:");
  for (const i of cr.cInjections) {
    console.log(" - " + i.code);
  }
  console.log("\n");

  const serializeAstDatatype = (datatype: ASTDatatype | ASTConstant): string => {
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
    } else if (datatype.variant === "RawPointerDatatype") {
      return serializeAstDatatype(datatype.pointee) + "*";
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
          if (s.funcbody._collect.scope) printScope(s.funcbody._collect.scope, indent + 6);
          break;

        case "GlobalVariableDefinition":
          print(`  - Global Variable ${s.mutable ? "let" : "const"} ${s.name} export=${s.export}`);
          break;

        case "StructDefinition":
          print(
            `  - Struct ${s.name}${s.generics.length > 0 ? "<" + s.generics.join(", ") + ">" : ""}`,
          );
          print(`      Members:`);
          for (const member of s.members) {
            print(`        - ${member.name}: ${serializeAstDatatype(member.type)}`);
          }
          print(`      Methods:`);
          for (const m of s.methods) {
            print(
              `        - ${m.name}${m.generics.length > 0 ? "<" + m.generics.join(", ") + ">" : ""}(${m.params.map((p) => `${p.name}: ${serializeAstDatatype(p.datatype)}`).join(", ")}${m.ellipsis ? ", ..." : ""}): ${m.returnType && serializeAstDatatype(m.returnType)}`,
            );
            if (m.funcbody._collect.scope) printScope(m.funcbody._collect.scope, indent + 12);
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
