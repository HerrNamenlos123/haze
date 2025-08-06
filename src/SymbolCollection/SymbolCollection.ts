import {
  assert,
  CompilerError,
  formatSourceLoc,
  InternalError,
  type SourceLoc,
} from "../shared/Errors";
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
  ASTRawPointerAddressOfExpr,
  ASTRawPointerDereferenceExpr,
  ASTRoot,
  ASTScope,
  ASTStructDefinition,
  ASTStructInstantiationExpr,
  ASTSymbolValueExpr,
  ASTUnaryExpr,
} from "../shared/AST";
import { assertScope, EMethodType, EVariableContext } from "../shared/common";
import { Collect, type CollectionContext } from "./CollectSymbols";

export function getScope(cc: CollectionContext, id: string) {
  const scope = cc.scopes.get(id);
  assert(scope);
  return scope;
}

export function makeScope(cc: CollectionContext, sourceloc: SourceLoc, parentScope: string) {
  const scope = new Collect.Scope(cc.moduleName, sourceloc, parentScope);
  cc.scopes.set(scope.id, scope);
  return scope.id;
}

function collect(
  cc: CollectionContext,
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
    | ASTRawPointerAddressOfExpr
    | ASTRawPointerDereferenceExpr
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
          cstruct: false,
          generics: [],
          sourceloc: item.sourceloc,
          _collect: {
            usedInScope: scope.id,
          },
        };
      }

      item._collect.definedInNamespaceOrStruct = meta.currentNamespaceOrStruct;
      item._collect.definedInScope = scope.id;
      item._collect.namespacePath = [
        ...meta.namespaceStack.map((n) => n.name),
        ...item.namespacePath,
      ];
      item.methodType = EMethodType.NotAMethod;
      if (item._collect.definedInNamespaceOrStruct?.variant === "StructDefinition") {
        item.methodType = EMethodType.Method;
      }

      if (scope.tryLookupSymbolHere(item.name)) {
        throw new CompilerError(`Symbol was already declared in this scope`, item.sourceloc);
      }

      for (const param of item.params) {
        collect(cc, scope, param.datatype, meta);
      }
      collect(cc, scope, item.returnType, meta);

      scope.defineSymbol(item);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "FunctionDefinition":
      item.declarationScope = makeScope(cc, item.sourceloc, scope.id);
      if (item.funcbody) {
        item.funcbody._collect.scope = makeScope(cc, item.sourceloc, item.declarationScope);
      }
      item._collect.definedInNamespaceOrStruct = meta.currentNamespaceOrStruct;
      item._collect.definedInScope = scope.id;
      item.methodType = EMethodType.NotAMethod;
      if (item._collect.definedInNamespaceOrStruct?.variant === "StructDefinition") {
        item.methodType = EMethodType.Method;
      }

      if (!item.returnType) {
        item.returnType = {
          variant: "NamedDatatype",
          name: "none",
          cstruct: false,
          generics: [],
          sourceloc: item.sourceloc,
          _collect: {},
        };
      }

      if (scope.tryLookupSymbolHere(item.name)) {
        throw new CompilerError(`Symbol was already declared in this scope`, item.sourceloc);
      }

      for (const g of item.generics) {
        getScope(cc, item.declarationScope).defineSymbol(g);
      }

      if (item.funcbody?._collect.scope) {
        for (const param of item.params) {
          getScope(cc, item.funcbody._collect.scope).defineSymbol({
            variant: "VariableDefinitionStatement",
            mutable: false,
            name: param.name,
            datatype: param.datatype,
            sourceloc: param.sourceloc,
            kind: EVariableContext.FunctionParameter,
            _semantic: {},
          });
        }
      }

      for (const param of item.params) {
        collect(cc, scope, param.datatype, meta);
      }
      collect(cc, scope, item.returnType, meta);

      scope.defineSymbol(item);
      if (item.funcbody?._collect.scope) {
        if (item.funcbody.variant === "ExprAsFuncBody") {
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
          assert(item.funcbody._collect.scope);
          collect(cc, getScope(cc, item.funcbody._collect.scope), item.funcbody, meta);
        } else {
          collect(cc, getScope(cc, item.funcbody._collect.scope), item.funcbody, meta);
        }
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
      scope.defineSymbol(item);
      item._collect.definedInNamespaceOrStruct = meta.currentNamespaceOrStruct;
      item._collect.definedInScope = scope.id;
      if (item.datatype) {
        collect(cc, scope, item.datatype, meta);
      }
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "NamespaceDefinition": {
      let namespace = item;
      item._collect.definedInNamespaceOrStruct = meta.currentNamespaceOrStruct;
      if (scope.tryLookupSymbolHere(namespace.name)) {
        namespace = scope.tryLookupSymbolHere(namespace.name) as ASTNamespaceDefinition;
      } else {
        namespace._collect.scope = makeScope(cc, namespace.sourceloc, scope.id);
        scope.defineSymbol(namespace);
      }
      for (const s of item.declarations) {
        collect(cc, getScope(cc, namespace._collect.scope!), s, {
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
      item._collect.definedInScope = scope.id;
      item._collect.scope = makeScope(cc, item.sourceloc, scope.id);
      item._collect.namespaces = meta.namespaceStack.map((n) => n.name);
      item._collect.definedInNamespaceOrStruct = meta.currentNamespaceOrStruct;
      item._collect.fullNamespacedName = [...item._collect.namespaces, item.name];
      for (const g of item.generics) {
        getScope(cc, item._collect.scope).defineSymbol(g);
      }

      const alreadyExists = scope.tryLookupSymbolHere(item.name);
      if (alreadyExists) {
        const msg =
          (alreadyExists.sourceloc &&
            `Conflicting declaration at ${formatSourceLoc(alreadyExists.sourceloc)}`) ||
          "";
        throw new CompilerError(
          `Symbol ${item.name} already exists in this scope. ${msg}`,
          item.sourceloc,
        );
      }
      scope.defineSymbol(item);

      const newMeta = {
        ...meta,
        currentNamespaceOrStruct: item,
        namespaceStack: [...meta.namespaceStack, item],
      };

      for (const decl of item.declarations) {
        collect(cc, getScope(cc, item._collect.scope), decl, newMeta);
      }

      for (const member of item.members) {
        collect(cc, getScope(cc, item._collect.scope), member.type, newMeta);
      }

      for (const method of item.methods) {
        method.declarationScope = makeScope(cc, item.sourceloc, item._collect.scope);
        if (method.funcbody) {
          method.funcbody._collect.scope = makeScope(cc,
            item.sourceloc,
            method.declarationScope,
          );
        }

        if (!method.returnType) {
          method.returnType = {
            variant: "NamedDatatype",
            name: "none",
            cstruct: false,
            generics: [],
            sourceloc: item.sourceloc,
            _collect: {},
          };
        }

        method._collect.fullNamespacePath = [
          ...meta.namespaceStack.map((n) => n.name),
          method.name,
        ];
        method._collect.definedInScope = item._collect.scope;

        for (const g of method.generics) {
          getScope(cc, method.declarationScope).defineSymbol(g);
        }

        if (method.funcbody?._collect.scope) {
          if (!method.static && method.name !== "constructor") {
            getScope(cc, method.funcbody._collect.scope).defineSymbol({
              variant: "VariableDefinitionStatement",
              mutable: false,
              name: "this",
              sourceloc: method.sourceloc,
              datatype: undefined,
              kind: EVariableContext.ThisReference,
              _semantic: {},
            });
          }

          for (const param of method.params) {
            getScope(cc, method.funcbody._collect.scope).defineSymbol({
              variant: "VariableDefinitionStatement",
              mutable: false,
              name: param.name,
              datatype: param.datatype,
              sourceloc: param.sourceloc,
              kind: EVariableContext.FunctionParameter,
              _semantic: {},
            });
            collect(cc, getScope(cc, method.declarationScope), param.datatype, newMeta);
          }
          if (method.returnType) {
            collect(cc, getScope(cc, method.declarationScope), method.returnType, newMeta);
          }
          collect(cc, getScope(cc, method.funcbody._collect.scope), method.funcbody, newMeta);
        }
      }
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "Scope":
      for (const s of item.statements) {
        switch (s.variant) {
          case "ExprStatement":
            collect(cc, scope, s.expr, meta);
            break;

          case "IfStatement":
            collect(cc, scope, s.condition, meta);
            s.then._collect.scope = makeScope(cc, s.then.sourceloc, scope.id);
            collect(cc, getScope(cc, s.then._collect.scope), s.then, meta);
            for (const e of s.elseIfs) {
              collect(cc, scope, e.condition, meta);
              e.then._collect.scope = makeScope(cc, e.then.sourceloc, scope.id);
              collect(cc, getScope(cc, e.then._collect.scope), e.then, meta);
            }
            if (s.else) {
              s.else._collect.scope = makeScope(cc, s.else.sourceloc, scope.id);
              collect(cc, getScope(cc, s.else._collect.scope), s.else, meta);
            }
            break;

          case "InlineCStatement":
            break;

          case "ReturnStatement":
            if (s.expr) {
              collect(cc, scope, s.expr, meta);
            }
            break;

          case "WhileStatement":
            collect(cc, scope, s.condition, meta);
            s.body._collect.scope = makeScope(cc, s.body.sourceloc, scope.id);
            collect(cc, getScope(cc, s.body._collect.scope), s.body, meta);
            break;

          case "VariableDefinitionStatement":
            if (scope.tryLookupSymbolHere(s.name)) {
              throw new CompilerError(
                `Variable '${s.name}' is already defined in this scope`,
                s.sourceloc,
              );
            }
            if (s.datatype) {
              collect(cc, scope, s.datatype, meta);
            }
            if (s.expr) {
              collect(cc, scope, s.expr, meta);
            }
            scope.defineSymbol(s);
            break;
        }
        scope.rawStatements.push(s);
      }
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ParenthesisExpr":
      collect(cc, scope, item.expr, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "BinaryExpr":
      collect(cc, scope, item.a, meta);
      collect(cc, scope, item.b, meta);
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
      item.lambda.funcbody._collect.scope = makeScope(cc, item.sourceloc, scope.id);
      for (const param of item.lambda.params) {
        getScope(cc, item.lambda.funcbody._collect.scope).defineSymbol({
          variant: "VariableDefinitionStatement",
          mutable: false,
          name: param.name,
          datatype: param.datatype,
          sourceloc: param.sourceloc,
          kind: EVariableContext.FunctionParameter,
          _semantic: {},
        });
      }

      for (const param of item.lambda.params) {
        collect(cc, scope, param.datatype, meta);
      }
      if (item.lambda.returnType) {
        collect(cc, scope, item.lambda.returnType, meta);
      }

      collect(cc, getScope(cc, item.lambda.funcbody._collect.scope), item.lambda.funcbody, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "StructInstantiationExpr":
      for (const member of item.members) {
        collect(cc, scope, member.value, meta);
      }
      collect(cc, scope, item.datatype, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "UnaryExpr":
      collect(cc, scope, item.expr, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "PreIncrExpr":
      collect(cc, scope, item.expr, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "PostIncrExpr":
      collect(cc, scope, item.expr, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExprMemberAccess":
      collect(cc, scope, item.expr, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExplicitCastExpr":
      collect(cc, scope, item.expr, meta);
      collect(cc, scope, item.castedTo, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "RawPointerAddressOf":
      collect(cc, scope, item.expr, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "RawPointerDereference":
      collect(cc, scope, item.expr, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExprAssignmentExpr":
      collect(cc, scope, item.target, meta);
      collect(cc, scope, item.value, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExprCallExpr":
      collect(cc, scope, item.calledExpr, meta);
      for (const a of item.arguments) {
        collect(cc, scope, a, meta);
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

    case "RawPointerDatatype":
      collect(cc, scope, item.pointee, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "FunctionDatatype":
      for (const param of item.params) {
        collect(cc, scope, param.datatype, meta);
      }
      collect(cc, scope, item.returnType, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ReferenceDatatype": {
      collect(cc, scope, item.referee, meta);
      break;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "NamedDatatype": {
      const process = (_item: ASTNamedDatatype) => {
        let p: ASTNamedDatatype | undefined = _item;
        while (p) {
          p._collect.usedInScope = scope.id;

          for (const g of p.generics) {
            if (g.variant === "NamedDatatype") {
              process(g);
            }
          }

          p = p.nested;
        }
      };
      process(item);
      break;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    default:
      assert(false && "All cases handled");
  }
}

function collectProg(cc: CollectionContext, ast: ASTRoot) {
  for (const statement of ast) {
    switch (statement.variant) {
      case "CInjectDirective":
        cc.cInjections.push({
          code: statement.code,
          sourceloc: statement.sourceloc,
        });
        break;

      case "FunctionDeclaration":
      case "FunctionDefinition":
      case "GlobalVariableDefinition":
      case "NamespaceDefinition":
      case "StructDefinition":
        collect(cc, getScope(cc, cc.globalScope), statement, {
          namespaceStack: [],
        });
        break;
    }
  }
}

export function CollectSymbols(cc: CollectionContext, ast: ASTRoot, rootLocation: SourceLoc) {
  collectProg(cc, ast);
  // PrettyPrintCollected(cc);
}

export function PrettyPrintCollected(cc: CollectionContext) {
  console.log("C Injections:");
  for (const i of cc.cInjections) {
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
    } else if (datatype.variant === "ReferenceDatatype") {
      return serializeAstDatatype(datatype.referee) + "&";
    } else {
      return datatype.value.toString();
    }
  };

  const printScope = (scope: Collect.Scope, indent: number) => {
    const print = (str: string, _indent = 0) => {
      console.log(" ".repeat(indent + _indent) + str);
    };

    print(`Statements (${scope.rawStatements.length}):`);
    for (const s of scope.rawStatements) {
      // print("  - " + JSON.stringify(s));
    }
    print(`Symbols (${scope.symbols.length}):`);
    for (const s of scope.symbols) {
      switch (s.variant) {
        case "NamespaceDefinition":
          print(`  - Namespace ${s.name}: export=${s.export}`);
          if (s._collect.scope) printScope(getScope(cc, s._collect.scope), indent + 6);
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
          if (s.funcbody?._collect.scope) printScope(getScope(cc, s.funcbody._collect.scope), indent + 6);
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
            if (m.funcbody?._collect.scope) printScope(getScope(cc, m.funcbody._collect.scope), indent + 12);
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
  printScope(getScope(cc, cc.globalScope), 2);
}
