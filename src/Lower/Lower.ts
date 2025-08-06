import { type Semantic, type SemanticResult } from "../Semantic/SemanticSymbols";
import {
  mangleDatatype,
  mangleNestedName,
  serializeDatatype,
  serializeNestedName,
} from "../Semantic/Serialize";
import {
  BinaryOperationToString,
  EExternLanguage,
  IncrOperationToString,
  UnaryOperationToString,
} from "../shared/AST";
import { EPrimitive, EVariableContext } from "../shared/common";
import { assert, ImpossibleSituation, InternalError, type SourceLoc } from "../shared/Errors";
import { makeTempName } from "../shared/store";
import type { CollectionContext } from "../SymbolCollection/CollectSymbols";
import type { Lowered } from "./LowerTypes";

const storeInTempVarAndGet = (
  type: Lowered.Datatype,
  value: Lowered.Expression,
  sourceloc: SourceLoc,
  flattened: Lowered.Statement[],
): Lowered.Expression => {
  const varname = makeTempName();
  flattened.push({
    variant: "VariableStatement",
    prettyName: varname,
    mangledName: varname,
    wasMangled: false,
    type: type,
    variableContext: EVariableContext.FunctionLocal,
    value: value,
    sourceloc: sourceloc,
  });
  return {
    variant: "SymbolValue",
    prettyName: varname,
    mangledName: varname,
    wasMangled: false,
    type: type,
  };
};

function lowerExpr(
  lr: Lowered.Module,
  expr: Semantic.Expression,
  flattened: Lowered.Statement[],
): Lowered.Expression {
  switch (expr.variant) {
    case "ExprCall": {
      const calledExpr = lowerExpr(lr, expr.calledExpr, flattened);
      assert(calledExpr.type.variant === "Function" || calledExpr.type.variant === "Callable");

      if (calledExpr.type.variant === "Callable") {
        let thisExpr: Lowered.Expression;
        if (calledExpr.variant === "CallableExpr") {
          thisExpr = calledExpr.thisExpr;
        } else if (calledExpr.variant === "SymbolValue") {
          thisExpr = calledExpr;
        } else {
          throw new InternalError("Not implemented");
        }

        // Always store a Callable
        const calledValue = storeInTempVarAndGet(
          calledExpr.type,
          calledExpr,
          expr.sourceloc,
          flattened,
        );

        const type = lowerHighlevelType(lr, expr.type);
        const callExpr: Lowered.ExprCallExpr = {
          variant: "ExprCallExpr",
          expr: {
            variant: "ExprMemberAccess",
            memberName: "fn",
            isReference: false,
            type: calledExpr.type,
            expr: calledValue,
          },
          arguments: [
            {
              variant: "ExprMemberAccess",
              expr: calledValue,
              isReference: false,
              memberName: "thisPtr",
              type: thisExpr.type,
            },
            ...expr.arguments.map((a) => lowerExpr(lr, a, flattened)),
          ],
          type: type,
        };

        if (callExpr.type.variant === "Struct" || callExpr.type.variant === "Callable") {
          const value = storeInTempVarAndGet(type, callExpr, expr.sourceloc, flattened);
          if (callExpr.type.variant === "Struct" && callExpr.type.cstruct) {
            return value;
          } else {
            return {
              variant: "RawPointerAddressOf",
              expr: value,
              type: callExpr.type,
            };
          }
        } else {
          return callExpr;
        }
      } else {
        const exprCall: Lowered.ExprCallExpr = {
          variant: "ExprCallExpr",
          expr: calledExpr,
          arguments: expr.arguments.map((a) => lowerExpr(lr, a, flattened)),
          type: lowerHighlevelType(lr, expr.type),
        };
        if (calledExpr.type.returnType.variant === "Struct") {
          // If the return value is a struct, store it in a temp var and reference it, to allow chaining of methods.
          const value = storeInTempVarAndGet(
            calledExpr.type.returnType,
            exprCall,
            expr.sourceloc,
            flattened,
          );
          if (calledExpr.type.returnType.cstruct) {
            return value;
          } else {
            return {
              variant: "RawPointerAddressOf",
              expr: value,
              type: calledExpr.type.returnType,
            };
          }
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
        type: lowerHighlevelType(lr, expr.type),
      };
    }

    case "UnaryExpr": {
      return {
        variant: "UnaryExpr",
        expr: lowerExpr(lr, expr.expr, flattened),
        operation: expr.operation,
        type: lowerHighlevelType(lr, expr.type),
      };
    }

    case "SymbolValue": {
      assert(
        expr.symbol.variant === "Variable" ||
        expr.symbol.variant === "GlobalVariableDefinition" ||
        expr.symbol.variant === "FunctionDeclaration" ||
        expr.symbol.variant === "FunctionDefinition",
      );
      if (
        expr.symbol.variant === "Variable" ||
        expr.symbol.variant === "GlobalVariableDefinition"
      ) {
        const value: Lowered.SymbolValueExpr = {
          variant: "SymbolValue",
          prettyName: expr.symbol.name,
          mangledName: expr.symbol.name,
          wasMangled: false,
          type: lowerHighlevelType(lr, expr.symbol.type),
        };
        return value;
      } else {
        lower(lr, expr.symbol);
        return {
          variant: "SymbolValue",
          prettyName: serializeNestedName(expr.symbol),
          mangledName: mangleNestedName(expr.symbol),
          wasMangled: expr.symbol.externLanguage !== EExternLanguage.Extern_C,
          type: lowerHighlevelType(lr, expr.symbol.type),
        };
      }
    }

    case "RawPointerAddressOf": {
      return {
        variant: "RawPointerAddressOf",
        expr: lowerExpr(lr, expr.expr, flattened),
        type: lowerHighlevelType(lr, expr.type),
      };
    }

    case "RawPointerDereference": {
      return {
        variant: "RawPointerDereference",
        expr: lowerExpr(lr, expr.expr, flattened),
        type: lowerHighlevelType(lr, expr.type),
      };
    }

    case "ExplicitCast": {
      const loweredExpr = lowerExpr(lr, expr.expr, flattened);
      const targetType = lowerHighlevelType(lr, expr.type);

      if (expr.type.variant === "ReferenceDatatype" && expr.type.referee === expr.expr.type) {
        // Conversion from anything to its own reference form
        if (expr.expr.type.variant === "RawPointerDatatype") {
          return loweredExpr;
        } else if (
          expr.expr.type.variant === "StructDatatype" ||
          expr.expr.type.variant === "PrimitiveDatatype"
        ) {
          // Prevent double indirection &*a => a
          if (expr.expr.variant === "RawPointerDereference") {
            return lowerExpr(lr, expr.expr.expr, flattened);
          }
          return {
            variant: "RawPointerAddressOf",
            expr: loweredExpr,
            type: targetType,
          };
        } else {
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
        isReference:
          expr.expr.type.variant === "RawPointerDatatype" ||
          (expr.expr.type.variant === "StructDatatype" && !expr.expr.type.cstruct),
        memberName: expr.memberName,
        type: lowerHighlevelType(lr, expr.type),
      };
    }

    case "Constant": {
      return {
        variant: "ConstantExpr",
        value: expr.value,
        type: lowerHighlevelType(lr, expr.type),
      };
    }

    case "StructInstantiation": {
      const structType = lowerTypeDirect(lr, expr.type);
      const value = storeInTempVarAndGet(
        structType,
        {
          variant: "StructInstantiation",
          type: structType,
          memberAssigns: expr.assign.map((a) => ({
            name: a.name,
            value: lowerExpr(lr, a.value, flattened),
          })),
        },
        expr.sourceloc,
        flattened,
      );
      return {
        variant: "RawPointerAddressOf",
        expr: value,
        type: lowerHighlevelType(lr, expr.type),
      };
    }

    case "PostIncrExpr": {
      return {
        variant: "PostIncrExpr",
        expr: lowerExpr(lr, expr.expr, flattened),
        operation: expr.operation,
        type: lowerHighlevelType(lr, expr.type),
      };
    }

    case "PreIncrExpr": {
      return {
        variant: "PreIncrExpr",
        expr: lowerExpr(lr, expr.expr, flattened),
        operation: expr.operation,
        type: lowerHighlevelType(lr, expr.type),
      };
    }

    case "CallableExpr": {
      lower(lr, expr.functionSymbol);
      return {
        variant: "CallableExpr",
        functionMangledName: mangleNestedName(expr.functionSymbol),
        functionPrettyName: serializeNestedName(expr.functionSymbol),
        thisExpr: lowerExpr(lr, expr.thisExpr, flattened),
        type: lowerHighlevelType(lr, expr.type),
      };
    }

    case "ExprAssignmentExpr": {
      return {
        variant: "ExprAssignmentExpr",
        target: lowerExpr(lr, expr.target, flattened),
        value: lowerExpr(lr, expr.value, flattened),
        type: lowerHighlevelType(lr, expr.type),
      };
    }

    case "SizeofExpr": {
      return {
        variant: "Sizeof",
        datatype: expr.datatype && lowerHighlevelType(lr, expr.datatype),
        value: expr.value && lowerExpr(lr, expr.value, flattened),
        type: lowerHighlevelType(lr, expr.type),
      };
    }

    case "NamespaceValue": {
      assert(
        false,
        "A Namespace Value cannot be lowered. This value should not have gotten through semantic analysis",
      );
    }

    default:
      assert(false, "All cases handled");
  }
}

function lowerHighlevelType(lr: Lowered.Module, type: Semantic.DatatypeSymbol): Lowered.Datatype {
  if (type.variant === "StructDatatype") {
    if (!type.cstruct) {
      type = {
        variant: "RawPointerDatatype",
        pointee: type,
        concrete: true,
      };
    }
  }
  return lowerTypeDirect(lr, type);
}

function lowerTypeDirect(lr: Lowered.Module, type: Semantic.DatatypeSymbol): Lowered.Datatype {
  if (type.variant === "StructDatatype") {
    if (lr.loweredTypes.has(type)) {
      return lr.loweredTypes.get(type)!;
    } else {
      let p: Lowered.StructDatatype = {
        variant: "Struct",
        noemit: type.noemit,
        cstruct: type.cstruct,
        prettyName: serializeDatatype(type),
        mangledName: mangleDatatype(type),
        wasMangled: type.externLanguage !== EExternLanguage.Extern_C,
        generics: type.generics.map((id) => lowerTypeDirect(lr, id)),
        members: [],
      };
      lr.loweredTypes.set(type, p);

      p.members = type.members.map((m) => {
        if (m.variant !== "Variable") throw new ImpossibleSituation();
        return {
          name: m.name,
          type: lowerTypeDirect(lr, m.type),
        };
      });

      return p;
    }
  } else if (type.variant === "PrimitiveDatatype") {
    if (lr.loweredTypes.has(type)) {
      return lr.loweredTypes.get(type)!;
    } else {
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
    } else {
      const p: Lowered.FunctionDatatype = {
        variant: "Function",
        parameters: type.parameters.map((p) => lowerTypeDirect(lr, p)),
        returnType: lowerTypeDirect(lr, type.returnType),
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
    } else {
      const p: Lowered.RawPointerDatatype = {
        variant: "RawPointer",
        pointee: lowerTypeDirect(lr, type.pointee),
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
    } else {
      const p: Lowered.ReferenceDatatype = {
        variant: "Reference",
        referee: lowerTypeDirect(lr, type.referee),
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
    } else {
      const ftype = lowerTypeDirect(lr, type.functionType);
      assert(ftype.variant === "Function");
      const p: Lowered.CallableDatatype = {
        variant: "Callable",
        thisExprType: type.thisExprType && lowerTypeDirect(lr, type.thisExprType),
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
        type: lowerHighlevelType(lr, statement.variableSymbol.type),
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
      let value = statement.expr && lowerExpr(lr, statement.expr, flattened);

      if (value && statement.expr) {
        if (statement.expr.type.variant === "StructDatatype" && !statement.expr.type.cstruct) {
          value = {
            variant: "RawPointerDereference",
            expr: value,
            type: lowerTypeDirect(lr, statement.expr.type),
          };
        }
      }

      const s: Lowered.Statement = {
        variant: "ReturnStatement",
        expr: value,
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
      if (symbol.noemit) {
        return;
      }
      const ftype = lowerHighlevelType(lr, symbol.type);
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
        const ftype = lowerHighlevelType(lr, symbol.type);
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
        assert(symbol.scope);
        const ftype = lowerHighlevelType(lr, symbol.type);
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
      if (symbol.noemit) {
        return undefined;
      }
      for (const g of symbol.generics) {
        if (g.variant === "GenericParameterDatatype") {
          return undefined;
        }
        if (g.variant === "DeferredDatatype") {
          return undefined;
        }
      }
      lr.loweredTypes.set(symbol, lowerHighlevelType(lr, symbol));
      break;
    }

    case "PrimitiveDatatype": {
      lr.loweredTypes.set(symbol, lowerHighlevelType(lr, symbol));
      break;
    }

    case "FunctionDatatype": {
      lr.loweredTypes.set(symbol, lowerHighlevelType(lr, symbol));
      break;
    }

    case "RawPointerDatatype": {
      lr.loweredTypes.set(symbol, lowerHighlevelType(lr, symbol));
      break;
    }

    case "CallableDatatype": {
      lr.loweredTypes.set(symbol, lowerHighlevelType(lr, symbol));
      break;
    }

    case "ReferenceDatatype": {
      lr.loweredTypes.set(symbol, lowerHighlevelType(lr, symbol));
      break;
    }

    case "Variable": {
      if (symbol.variableContext !== EVariableContext.Global) {
        return undefined;
      }
      assert(false, "not implemented");
    }

    case "NamespaceDatatype": {
      for (const s of symbol.scope.symbolTable.symbols) {
        lower(lr, s);
      }
      break;
    }

    case "GlobalVariableDefinition": {
      const flattened: Lowered.Statement[] = [];
      const p: Lowered.VariableStatement = {
        variant: "VariableStatement",
        mangledName: mangleNestedName(symbol),
        prettyName: serializeNestedName(symbol),
        type: lowerHighlevelType(lr, symbol.type),
        variableContext: EVariableContext.Global,
        wasMangled: symbol.externLanguage !== EExternLanguage.Extern_C,
        value: symbol.value && lowerExpr(lr, symbol.value, flattened),
        sourceloc: symbol.sourceloc,
      };
      lr.loweredGlobalVariables.set(symbol, [...flattened, p]);
      return;
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

    case "UnaryExpr":
      return `(${UnaryOperationToString(expr.operation)}${serializeLoweredExpr(expr.expr)})`;

    case "ExplicitCast":
      return `(${serializeLoweredExpr(expr.expr)} as ${expr.type.prettyName})`;

    case "ExprCallExpr":
      return `((${serializeLoweredExpr(expr.expr)})(${expr.arguments.map((a) => serializeLoweredExpr(a)).join(", ")}))`;

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
      } else {
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

    case "ExprAssignmentExpr":
      return `${serializeLoweredExpr(expr.target)} = ${serializeLoweredExpr(expr.value)}`;

    case "Sizeof":
      if (expr.value) {
        return `sizeof(${serializeLoweredExpr(expr.value)})`;
      } else {
        return `sizeof<${expr.datatype?.prettyName}>`;
      }
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
      print("return" + (s.expr ? ` ${serializeLoweredExpr(s.expr)}` : "") + ";", indent);
      break;

    case "VariableStatement":
      print(
        "var " +
        s.prettyName +
        ": " +
        s.type.prettyName +
        (s.value ? " = " + serializeLoweredExpr(s.value) : "") +
        ";",
        indent,
      );
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
  } else {
    print("Funcdecl " + f.prettyName + ":");
    printScope(f.scope);
  }
}

export function PrettyPrintLowered(lr: Lowered.Module) {
  print("C Declarations:");
  for (const d of lr.cDeclarations) {
    print("C Decl " + JSON.stringify(d));
  }

  print("Lowered Types:");
  for (const t of [...lr.loweredTypes.values()]) {
    printLoweredType(t);
  }

  print("Lowered Functions:");
  for (const t of [...lr.loweredFunctions.values()]) {
    printLoweredFunction(t);
  }
}

export function LowerModule(cc: CollectionContext, sr: SemanticResult): Lowered.Module {
  const lr: Lowered.Module = {
    cc: cc,
    sr: sr,

    cDeclarations: cc.cInjections.map((i) => i.code),

    loweredTypes: new Map(),
    loweredFunctions: new Map(),
    loweredGlobalVariables: new Map(),

    sortedLoweredTypes: [],
  };

  const symbolsForLowering = [
    ...sr.elaboratedFuncdeclSymbols,
    ...sr.elaboratedFuncdefSymbols,
    ...sr.elaboratedPrimitiveTypes,
    ...sr.elaboratedStructDatatypes,
    ...sr.elaboratedGlobalVariableSymbols,
  ];

  for (const symbol of symbolsForLowering) {
    const s = "resultSymbol" in symbol ? symbol.resultSymbol : symbol;
    assert(s.concrete);
    lower(lr, s);
  }

  // PrettyPrintLowered(lr);

  return lr;
}
