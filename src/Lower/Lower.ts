import { setTextRange } from "typescript";
import { Conversion } from "../Semantic/Conversion";
import { type Semantic, type SemanticResult } from "../Semantic/SemanticSymbols";
import { mangleDatatype, mangleNestedName, serializeDatatype, serializeExpr, serializeNestedName } from "../Semantic/Serialize";
import { BinaryOperationToString, EExternLanguage, IncrOperationToString } from "../shared/AST";
import { EPrimitive, EVariableContext } from "../shared/common";
import { assert, ImpossibleSituation, InternalError } from "../shared/Errors";
import {
  makeTempName,
} from "../shared/store";
import type { CollectResult } from "../SymbolCollection/CollectSymbols";
import type { Lowered } from "./LowerTypes";

function lowerExpr(
  lr: Lowered.Module,
  expr: Semantic.Expression,
  flattened: Lowered.Statement[],
): Lowered.Expression {
  switch (expr.variant) {
    case "ExprCall": {
      const calledExpr = lowerExpr(lr, expr.calledExpr, flattened);
      assert(calledExpr.type.variant === "Function" || calledExpr.type.variant === "Callable");

      const storeInTempVarAndGet = (type: Lowered.Datatype, value: Lowered.Expression): Lowered.Expression => {
        const varname = makeTempName();
        flattened.push({
          variant: "VariableStatement",
          prettyName: varname,
          mangledName: varname,
          wasMangled: false,
          type: type,
          variableContext: EVariableContext.FunctionLocal,
          value: value,
          sourceloc: expr.sourceloc,
        });
        return {
          variant: "SymbolValue",
          prettyName: varname,
          mangledName: varname,
          wasMangled: false,
          type: calledExpr.type,
        };
      }

      if (calledExpr.type.variant === "Callable") {
        assert(calledExpr.variant === "CallableExpr");
        const tempCallableValue = storeInTempVarAndGet(calledExpr.type, calledExpr);

        const type = lowerType(lr, expr.type);
        let thisExpr = calledExpr.thisExpr;

        return storeInTempVarAndGet(type, {
          variant: "ExprCallExpr",
          expr: {
            variant: "ExprMemberAccess",
            memberName: "fn",
            isReference: false,
            type: calledExpr.type,
            expr: tempCallableValue,
          },
          arguments: [thisExpr, ...expr.arguments.map((a) => lowerExpr(lr, a, flattened))],
          type: type,
        });
      }
      else {
        const exprCall: Lowered.ExprCallExpr = {
          variant: "ExprCallExpr",
          expr: calledExpr,
          arguments: expr.arguments.map((a) => lowerExpr(lr, a, flattened)),
          type: lowerType(lr, expr.type),
        };
        if (calledExpr.type.returnType.variant === "Struct") {
          // If the return value is a struct, store it in a temp var and reference it, to allow chaining of methods.
          return storeInTempVarAndGet(calledExpr.type.returnType, exprCall);
        } else {
          return exprCall;
        }
      }
    }

    case "BinaryExpr": {
      return {
        variant: "BinaryExpr",
        left: lowerExpr(lr, expr.left, flattened),
        right: lowerExpr(lr, expr.right, flattened),
        operation: expr.operation,
        type: lowerType(lr, expr.type),
      };
    }

    case "SymbolValue": {
      assert(expr.symbol.variant === "Variable" || expr.symbol.variant === "FunctionDeclaration" || expr.symbol.variant === "FunctionDefinition")
      if (expr.symbol.variant === "Variable") {
        return {
          variant: "SymbolValue",
          prettyName: expr.symbol.name,
          mangledName: expr.symbol.name,
          wasMangled: false,
          type: lowerType(lr, expr.symbol.type),
        };
      }
      else {
        lower(lr, expr.symbol)
        return {
          variant: "SymbolValue",
          prettyName: serializeNestedName(expr.symbol),
          mangledName: mangleNestedName(expr.symbol),
          wasMangled: expr.symbol.externLanguage !== EExternLanguage.Extern_C,
          type: lowerType(lr, expr.symbol.type),
        };
      }
    }

    case "RawPointerAddressOf": {
      return {
        variant: "RawPointerAddressOf",
        expr: lowerExpr(lr, expr.expr, flattened),
        type: lowerType(lr, expr.type),
      };
    }

    case "RawPointerDereference": {
      return {
        variant: "RawPointerDereference",
        expr: lowerExpr(lr, expr.expr, flattened),
        type: lowerType(lr, expr.type),
      };
    }

    case "ExplicitCast": {
      const loweredExpr = lowerExpr(lr, expr.expr, flattened);
      const targetType = lowerType(lr, expr.type);

      if (expr.type.variant === "ReferenceDatatype" && expr.type.referee === expr.expr.type) {
        // Conversion from anything to its own reference form
        if (expr.expr.type.variant === "RawPointerDatatype") {
          return loweredExpr;
        }
        else if (expr.expr.type.variant === "StructDatatype") {
          return {
            variant: "RawPointerAddressOf",
            expr: loweredExpr,
            type: targetType,
          };
        }
        else {
          throw new InternalError("Not implemented");
        }
      }

      if (expr.expr.type.variant === "ReferenceDatatype" && expr.type === expr.expr.type.referee) {
        // Conversion from a reference to what it points to
        if (expr.type.variant === "RawPointerDatatype") {
          return loweredExpr;
        }
        return {
          variant: "RawPointerDereference",
          expr: loweredExpr,
          type: targetType,
        };
      }

      if (expr.expr.type === expr.type) {
        return loweredExpr;
      }

      return {
        variant: "ExplicitCast",
        expr: loweredExpr,
        type: targetType,
      };
    }

    case "ExprMemberAccess": {
      return {
        variant: "ExprMemberAccess",
        expr: lowerExpr(lr, expr.expr, flattened),
        isReference: expr.isReference,
        memberName: expr.memberName,
        type: lowerType(lr, expr.type),
      };
    }

    case "Constant": {
      return {
        variant: "ConstantExpr",
        value: expr.value,
        type: lowerType(lr, expr.type),
      };
    }

    case "StructInstantiation": {
      return {
        variant: "StructInstantiation",
        type: lowerType(lr, expr.type),
        memberAssigns: expr.assign.map((a) => ({
          name: a.name,
          value: lowerExpr(lr, a.value, flattened),
        })),
      };
    }

    case "PostIncrExpr": {
      return {
        variant: "PostIncrExpr",
        expr: lowerExpr(lr, expr.expr, flattened),
        operation: expr.operation,
        type: lowerType(lr, expr.type),
      };
    }

    case "PreIncrExpr": {
      return {
        variant: "PreIncrExpr",
        expr: lowerExpr(lr, expr.expr, flattened),
        operation: expr.operation,
        type: lowerType(lr, expr.type),
      };
    }

    case "CallableExpr": {
      lower(lr, expr.functionSymbol);
      return {
        variant: "CallableExpr",
        functionMangledName: mangleNestedName(expr.functionSymbol),
        functionPrettyName: serializeNestedName(expr.functionSymbol),
        thisExpr: lowerExpr(lr, expr.thisExpr, flattened),
        type: lowerType(lr, expr.type),
      };
    }

    default:
      assert(false, "All cases handled");
  }
}

function lowerType(lr: Lowered.Module, type: Semantic.DatatypeSymbol): Lowered.Datatype {
  if (type.variant === "StructDatatype") {
    if (lr.loweredTypes.has(type)) {
      return lr.loweredTypes.get(type)!;
    }
    else {
      const p: Lowered.StructDatatype = {
        variant: "Struct",
        prettyName: serializeDatatype(type),
        mangledName: mangleDatatype(type),
        wasMangled: true,
        generics: type.generics.map((id) => lowerType(lr, id)),
        members: [],
      };
      lr.loweredTypes.set(type, p);

      p.members = type.members.map((m) => {
        if (m.variant !== "Variable") throw new ImpossibleSituation();
        return {
          name: m.name,
          type: lowerType(lr, m.type),
        };
      });

      return p;
    }
  } else if (type.variant === "PrimitiveDatatype") {
    if (lr.loweredTypes.has(type)) {
      return lr.loweredTypes.get(type)!;
    }
    else {
      const p: Lowered.PrimitiveDatatype = {
        variant: "Primitive",
        primitive: type.primitive,
        mangledName: mangleDatatype(type),
        prettyName: serializeDatatype(type),
        wasMangled: true,
      };
      lr.loweredTypes.set(type, p);
      return p;
    }
  } else if (type.variant === "FunctionDatatype") {
    if (lr.loweredTypes.has(type)) {
      return lr.loweredTypes.get(type)!;
    }
    else {
      const p: Lowered.FunctionDatatype = {
        variant: "Function",
        parameters: type.parameters.map((p) =>
          lowerType(lr, p)
        ),
        returnType: lowerType(lr, type.returnType),
        prettyName: serializeDatatype(type),
        mangledName: mangleDatatype(type),
        wasMangled: true,
        vararg: type.vararg,
      };
      lr.loweredTypes.set(type, p);
      return p;
    }
  } else if (type.variant === "RawPointerDatatype") {
    if (lr.loweredTypes.has(type)) {
      return lr.loweredTypes.get(type)!;
    }
    else {
      const p: Lowered.RawPointerDatatype = {
        variant: "RawPointer",
        pointee: lowerType(lr, type.pointee),
        mangledName: mangleDatatype(type),
        wasMangled: true,
        prettyName: serializeDatatype(type),
      };
      lr.loweredTypes.set(type, p);
      return p;
    }
  } else if (type.variant === "ReferenceDatatype") {
    if (lr.loweredTypes.has(type)) {
      return lr.loweredTypes.get(type)!;
    }
    else {
      const p: Lowered.ReferenceDatatype = {
        variant: "Reference",
        referee: lowerType(lr, type.referee),
        mangledName: mangleDatatype(type),
        wasMangled: true,
        prettyName: serializeDatatype(type),
      };
      lr.loweredTypes.set(type, p);
      return p;
    }
  } else if (type.variant === "CallableDatatype") {
    if (lr.loweredTypes.has(type)) {
      return lr.loweredTypes.get(type)!;
    }
    else {
      const ftype = lowerType(lr, type.functionType)
      assert(ftype.variant === "Function");
      const p: Lowered.CallableDatatype = {
        variant: "Callable",
        thisExprType: type.thisExprType && lowerType(lr, type.thisExprType),
        functionType: ftype,
        mangledName: mangleDatatype(type),
        wasMangled: true,
        prettyName: serializeDatatype(type),
      };
      lr.loweredTypes.set(type, p);
      return p;
    }
  } else {
    throw new InternalError("Unhandled variant: " + type.variant);
  }
}

function lowerStatement(lr: Lowered.Module, statement: Semantic.Statement): Lowered.Statement[] {
  switch (statement.variant) {
    case "VariableStatement": {
      const flattened: Lowered.Statement[] = [];
      if (statement.variableSymbol.variant !== "Variable") throw new ImpossibleSituation();
      const s: Lowered.Statement = {
        variant: "VariableStatement",
        mangledName: statement.name,
        prettyName: statement.name,
        wasMangled: false,
        type: lowerType(lr, statement.variableSymbol.type),
        value: statement.value && lowerExpr(lr, statement.value, flattened),
        variableContext: statement.variableSymbol.variableContext,
        sourceloc: statement.sourceloc,
      };
      return [...flattened, s];
    }

    case "IfStatement": {
      const flattened: Lowered.Statement[] = [];
      const s: Lowered.Statement = {
        variant: "IfStatement",
        condition: lowerExpr(lr, statement.condition, flattened),
        then: lowerScope(lr, statement.then),
        elseIfs: statement.elseIfs.map((e) => {
          const flattened: Lowered.Statement[] = [];
          return {
            condition: lowerExpr(lr, e.condition, flattened),
            then: lowerScope(lr, e.then),
          };
        }),
        else: statement.else && lowerScope(lr, statement.else),
        sourceloc: statement.sourceloc,
      };
      return [...flattened, s];
    }

    case "WhileStatement": {
      const flattened: Lowered.Statement[] = [];
      const s: Lowered.Statement = {
        variant: "WhileStatement",
        condition: lowerExpr(lr, statement.condition, flattened),
        then: lowerScope(lr, statement.then),
        sourceloc: statement.sourceloc,
      };
      return [...flattened, s];
    }

    case "ExprStatement": {
      const flattened: Lowered.Statement[] = [];
      const s: Lowered.Statement = {
        variant: "ExprStatement",
        expr: lowerExpr(lr, statement.expr, flattened),
        sourceloc: statement.sourceloc,
      };
      return [...flattened, s];
    }

    case "ReturnStatement": {
      const flattened: Lowered.Statement[] = [];
      const s: Lowered.Statement = {
        variant: "ReturnStatement",
        expr: statement.expr && lowerExpr(lr, statement.expr, flattened),
        sourceloc: statement.sourceloc,
      };
      return [...flattened, s];
    }

    case "InlineCStatement": {
      return [
        {
          variant: "InlineCStatement",
          value: statement.value,
          sourceloc: statement.sourceloc,
        },
      ];
    }

    default:
      throw new InternalError("Unhandled case: ");
  }
}

function lowerScope(lr: Lowered.Module, semanticScope: Semantic.BlockScope): Lowered.Scope {
  const scope: Lowered.Scope = {
    statements: [],
  };
  for (const s of semanticScope.statements) {
    scope.statements.push(...lowerStatement(lr, s));
  }
  return scope;
}

function lower(lr: Lowered.Module, symbol: Semantic.Symbol) {
  switch (symbol.variant) {
    case "FunctionDeclaration": {
      const ftype = lowerType(lr, symbol.type);
      assert(ftype.variant === "Function");
      const f: Lowered.FunctionDeclaration = {
        variant: "FunctionDeclaration",
        parameterNames: symbol.parameterNames,
        prettyName: serializeNestedName(symbol),
        mangledName: mangleNestedName(symbol),
        wasMangled: symbol.externLanguage !== EExternLanguage.Extern_C,
        type: ftype,
        externLanguage: symbol.externLanguage,
        sourceloc: symbol.sourceloc,
      };
      lr.loweredFunctions.set(symbol, f);
      break;
    }

    case "FunctionDefinition": {
      if (lr.loweredFunctions.has(symbol)) {
        return lr.loweredFunctions.get(symbol)!;
      }

      if (symbol.methodOf === undefined) {
        // Normal function
        const ftype = lowerType(lr, symbol.type);
        assert(ftype.variant === "Function");
        assert(symbol.scope);
        const f: Lowered.FunctionDefinition = {
          variant: "FunctionDefinition",
          prettyName: serializeNestedName(symbol),
          mangledName: mangleNestedName(symbol),
          parameterNames: symbol.parameterNames,
          wasMangled: symbol.externLanguage !== EExternLanguage.Extern_C,
          type: ftype,
          scope: lowerScope(lr, symbol.scope),
          sourceloc: symbol.sourceloc,
          externLanguage: symbol.externLanguage,
        };
        lr.loweredFunctions.set(symbol, f);
      } else {
        // Method
        assert(symbol.scope)
        const ftype = lowerType(lr, symbol.type)
        assert(ftype.variant === "Function");
        const f: Lowered.FunctionDefinition = {
          variant: "FunctionDefinition",
          prettyName: serializeNestedName(symbol),
          mangledName: mangleNestedName(symbol),
          parameterNames: symbol.parameterNames,
          type: ftype,
          wasMangled: symbol.externLanguage !== EExternLanguage.Extern_C,
          scope: lowerScope(lr, symbol.scope),
          externLanguage: symbol.externLanguage,
          sourceloc: symbol.sourceloc,
        };
        lr.loweredFunctions.set(symbol, f);
      }
      break;
    }

    case "DeferredDatatype":
      throw new InternalError("No deferred type should exist in lowering");

    case "StructDatatype": {
      for (const g of symbol.generics) {
        if (g.variant === "GenericParameterDatatype") {
          return undefined;
        }
        if (g.variant === "DeferredDatatype") {
          return undefined;
        }
      }
      lr.loweredTypes.set(symbol, lowerType(lr, symbol));
      break;
    }

    case "PrimitiveDatatype": {
      lr.loweredTypes.set(symbol, lowerType(lr, symbol));
      break;
    }

    case "FunctionDatatype": {
      lr.loweredTypes.set(symbol, lowerType(lr, symbol));
      break;
    }

    case "RawPointerDatatype": {
      lr.loweredTypes.set(symbol, lowerType(lr, symbol));
      break;
    }

    case "CallableDatatype": {
      lr.loweredTypes.set(symbol, lowerType(lr, symbol));
      break;
    }

    case "ReferenceDatatype": {
      lr.loweredTypes.set(symbol, lowerType(lr, symbol));
      break;
    }

    case "Variable": {
      if (symbol.variableContext !== EVariableContext.Global) {
        return undefined;
      }
      throw new InternalError("Not implemented");
    }

    case "Namespace": {
      for (const s of symbol.scope.symbolTable.symbols) {
        lower(lr, s);
      }
      break;
    }

    default:
      throw new InternalError("Unhandled variant: " + symbol.variant);
  }
}

const print = (str: string, indent = 0) => {
  console.log(" ".repeat(indent) + str);
};

function printLoweredType(type: Lowered.Datatype) {
  switch (type.variant) {
    case "Callable":
    case "Function":
    case "RawPointer":
    case "Reference":
    case "Primitive":
      print("Typedef " + type.prettyName);
      break;

    case "Struct":
      print("Struct " + type.prettyName + " {");
      for (const member of type.members) {
        print(`${member.name}: ${member.type.prettyName}`, 2);
      }
      print("}");
      break;

  }
}

function serializeLoweredExpr(expr: Lowered.Expression): string {
  switch (expr.variant) {

    case "BinaryExpr":
      return `(${serializeLoweredExpr(expr.left)} ${BinaryOperationToString(expr.operation)} ${serializeLoweredExpr(expr.left)})`;

    case "ExplicitCast":
      return `(${serializeLoweredExpr(expr.expr)} as ${expr.type.prettyName})`;

    case "ExprCallExpr":
      return `((${serializeLoweredExpr(expr.expr)})(${expr.arguments.map((a) => serializeLoweredExpr(a)).join(', ')}))`;

    case "PostIncrExpr":
      return `((${serializeLoweredExpr(expr.expr)})${IncrOperationToString(expr.operation)})`;

    case "PreIncrExpr":
      return `(${IncrOperationToString(expr.operation)}(${serializeLoweredExpr(expr.expr)}))`;

    case "SymbolValue":
      return expr.prettyName;

    case "StructInstantiation":
      return `${expr.type.prettyName} { ${expr.memberAssigns.map((a) => `.${a.name} = ${serializeLoweredExpr(a.value)}`).join(", ")} }`;

    case "ConstantExpr":
      if (expr.type.variant === "Primitive" && expr.type.primitive === EPrimitive.str) {
        return `${JSON.stringify(expr.value)}`;
      }
      else {
        return `${expr.value}`;
      }

    case "ExprMemberAccess":
      return `(${serializeLoweredExpr(expr.expr)}.${expr.memberName})`;

    case "CallableExpr":
      return `Callable(${expr.functionPrettyName}, this=${serializeLoweredExpr(expr.thisExpr)})`;

    case "RawPointerAddressOf":
      return `&${serializeLoweredExpr(expr.expr)}`;

    case "RawPointerDereference":
      return `*${serializeLoweredExpr(expr.expr)}`;
  }
}

export function printStatement(s: Lowered.Statement, indent = 0) {
  switch (s.variant) {
    case "ExprStatement":
      print(serializeLoweredExpr(s.expr) + ";", indent);
      break;

    case "InlineCStatement":
      print("Inline C " + JSON.stringify(s.value), indent);
      break;

    case "ReturnStatement":
      print("return" + (s.expr ? ` ${serializeLoweredExpr(s.expr)}` : '') + ";", indent);
      break;

    case "VariableStatement":
      print("var " + s.prettyName + ": " + s.type.prettyName + (s.value ? " = " + serializeLoweredExpr(s.value) : '') + ";", indent);
      break;

    case "IfStatement":
      print(`If ${serializeLoweredExpr(s.condition)} {`, indent);
      printScope(s.then, indent);
      for (const elseif of s.elseIfs) {
        print(`} else if ${serializeLoweredExpr(elseif.condition)} {`, indent);
        printScope(elseif.then, indent);
      }
      if (s.else) {
        print(`} else {`, indent);
        printScope(s.else, indent);
      }
      print(`}`, indent);
      break;

    case "WhileStatement":
      print(`While ${serializeLoweredExpr(s.condition)} {`, indent);
      printScope(s.then, indent);
      print(`}`, indent);
      break;
  }
}

function printScope(scope: Lowered.Scope, indent = 0) {
  for (const s of scope.statements) {
    printStatement(s, indent + 2);
  }
}

function printLoweredFunction(f: Lowered.FunctionDeclaration | Lowered.FunctionDefinition) {
  if (f.variant === "FunctionDeclaration") {
    print("Funcdef " + f.prettyName);
  }
  else {
    print("Funcdecl " + f.prettyName + ":");
    printScope(f.scope);
  }
}

export function PrettyPrintLowered(lr: Lowered.Module) {
  print("C Declarations:")
  for (const d of lr.cDeclarations) {
    print("C Decl " + JSON.stringify(d));
  }

  print("Lowered Types:")
  for (const t of [...lr.loweredTypes.values()]) {
    printLoweredType(t);
  }

  print("Lowered Functions:")
  for (const t of [...lr.loweredFunctions.values()]) {
    printLoweredFunction(t);
  }
}

export function LowerModule(cr: CollectResult, sr: SemanticResult): Lowered.Module {
  const lr: Lowered.Module = {
    cr: cr,
    sr: sr,

    cDeclarations: cr.cInjections.map((i) => i.code),

    loweredTypes: new Map(),
    loweredFunctions: new Map(),
  };

  for (const symbol of sr.globalNamespace.scope.symbolTable.symbols) {
    if (!symbol.concrete) {
      continue;
    }
    lower(lr, symbol);
  }

  // PrettyPrintLowered(lr);

  return lr;
}