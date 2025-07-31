import { SymbolFlags } from "typescript";
import {
  BinaryOperationToString,
  EExternLanguage,
  IncrOperationToString,
  UnaryOperationToString,
} from "../shared/AST";
import { EPrimitive, primitiveToString } from "../shared/common";
import { assert, ImpossibleSituation, InternalError } from "../shared/Errors";
import { Semantic } from "./SemanticSymbols";

export function serializeDatatype(datatype: Semantic.DatatypeSymbol): string {
  switch (datatype.variant) {
    case "PrimitiveDatatype":
      return primitiveToString(datatype.primitive);

    case "RawPointerDatatype":
      return serializeDatatype(datatype.pointee) + "*";

    case "ReferenceDatatype":
      return serializeDatatype(datatype.referee) + "&";

    case "GenericParameterDatatype":
      return datatype.name;

    case "StructDatatype":
      return getParentNames(datatype);

    case "FunctionDatatype":
      return `(${datatype.parameters.map((p) => serializeDatatype(p)).join(", ")}${datatype.vararg ? ", ..." : ""}) => ${serializeDatatype(datatype.returnType)}`;

    case "CallableDatatype":
      return `Callable<${serializeDatatype(datatype.functionType)}>(this=${datatype.thisExprType ? serializeDatatype(datatype.thisExprType) : ""})`;

    default:
      throw new InternalError("Not handled: " + datatype.variant);
  }
}

function getParentNames(symbol: Semantic.NamespaceDatatypeSymbol | Semantic.StructDatatypeSymbol) {
  let fullName = "";
  let node: Semantic.NamespaceDatatypeSymbol | Semantic.StructDatatypeSymbol | null = symbol;
  while (node) {
    if (node.variant === "StructDatatype") {
      const generics = node.generics.map((g) => serializeDatatype(g)).join(", ");
      fullName = `${node.name}${generics.length > 0 ? `<${generics}>` : ""}${fullName.length === 0 ? fullName : "." + fullName}`;
      node = node.parent;
    } else {
      fullName = `${node.name}${fullName.length === 0 ? fullName : "." + fullName}`;
      node = node.parent;
    }
  }
  return fullName;
}

export function serializeNestedName(
  expr: Semantic.FunctionDefinitionSymbol | Semantic.FunctionDeclarationSymbol,
): string {
  if (expr.variant === "FunctionDeclaration") {
    return `${(expr.parent && getParentNames(expr.parent) + ".") || ""}${expr.name}`;
  } else if (expr.methodOf) {
    return `${getParentNames(expr.methodOf)}.${expr.name}`;
  } else {
    return `${(expr.parent && getParentNames(expr.parent) + ".") || ""}${expr.name}`;
  }
}

export function mangleNestedName(
  symbol:
    | Semantic.StructDatatypeSymbol
    | Semantic.NamespaceDatatypeSymbol
    | Semantic.FunctionDeclarationSymbol
    | Semantic.FunctionDefinitionSymbol,
) {
  if (
    symbol.variant !== "NamespaceDatatype" &&
    symbol.externLanguage === EExternLanguage.Extern_C
  ) {
    return symbol.name;
  }

  const fragments: string[] = [];
  let p:
    | Semantic.StructDatatypeSymbol
    | Semantic.NamespaceDatatypeSymbol
    | Semantic.FunctionDeclarationSymbol
    | Semantic.FunctionDefinitionSymbol
    | null = symbol;
  while (p) {
    if (p.variant !== "StructDatatype") {
      fragments.push(p.name.length + p.name);
    } else {
      let generics = "";
      if (p.generics.length > 0) {
        generics += "I";
        for (const g of p.generics) {
          generics += mangleDatatype(g);
        }
        generics += "E";
      }
      fragments.push(p.name.length + p.name + generics);
    }
    const pParent: Semantic.DatatypeSymbol | Semantic.NamespaceDatatypeSymbol | null = p.parent;
    if (pParent) {
      if (pParent.variant !== "StructDatatype" && pParent.variant !== "NamespaceDatatype") {
        throw new ImpossibleSituation();
      }
    }
    p = pParent;
  }
  fragments.reverse();
  let functionPart = "";
  if (symbol.variant === "FunctionDeclaration" || symbol.variant === "FunctionDefinition") {
    const ftype = symbol.type;
    if (ftype.variant !== "FunctionDatatype") throw new ImpossibleSituation();
    if (ftype.parameters.length === 0) {
      functionPart += "v";
    } else {
      for (const p of ftype.parameters) {
        functionPart += mangleDatatype(p);
      }
    }
  }
  if (fragments.length > 1) {
    return "N" + fragments.join("") + "E" + functionPart;
  } else {
    return fragments[0] + functionPart;
  }
}

let CallableUniqueCounter = 1;
const CallableManglingHashStore = new Map<Semantic.CallableDatatypeSymbol, number>();

export function mangleDatatype(type: Semantic.DatatypeSymbol): string {
  switch (type.variant) {
    case "StructDatatype": {
      return mangleNestedName(type);
    }

    case "CallableDatatype": {
      if (!CallableManglingHashStore.has(type)) {
        CallableManglingHashStore.set(type, CallableUniqueCounter++);
      }
      const uniqueID = CallableManglingHashStore.get(type);
      assert(uniqueID);

      // const generic =
      //     (type.thisExprType && "I" + mangleDatatype(type.thisExprType) + "E") || "";
      return "__Callable__" + uniqueID.toString();
    }

    case "PrimitiveDatatype": {
      const name = primitiveToString(type.primitive);
      return name.length + name;
    }

    case "FunctionDatatype": {
      return (
        "F" +
        type.parameters.map((p) => mangleDatatype(p)).join("") +
        "E" +
        mangleDatatype(type.returnType)
      );
    }

    case "RawPointerDatatype": {
      return "P" + mangleDatatype(type.pointee);
    }

    case "ReferenceDatatype": {
      return "R" + mangleDatatype(type.referee);
    }

    default:
      throw new InternalError("Unhandled variant: ");
  }
}

export function serializeExpr(expr: Semantic.Expression): string {
  switch (expr.variant) {
    case "BinaryExpr":
      return `(${serializeExpr(expr.left)} ${BinaryOperationToString(expr.operation)} ${serializeExpr(expr.left)})`;

    case "UnaryExpr":
      return `(${UnaryOperationToString(expr.operation)} ${serializeExpr(expr.expr)})`;

    // case "SizeofExpr":
    //   return `sizeof<${serializeExpr(expr.datatype)}>`;

    case "ExplicitCast":
      return `(${serializeExpr(expr.expr)} as ${serializeDatatype(expr.type)})`;

    case "ExprCall":
      return `(${serializeExpr(expr.calledExpr)}(${expr.arguments.map((a) => serializeExpr(a)).join(", ")}))`;

    case "PostIncrExpr":
      return `((${serializeExpr(expr.expr)})${IncrOperationToString(expr.operation)})`;

    case "PreIncrExpr":
      return `(${IncrOperationToString(expr.operation)}(${serializeExpr(expr.expr)}))`;

    case "SymbolValue":
      if (expr.symbol.variant === "Variable") {
        return expr.symbol.name;
      } else if (expr.symbol.variant === "FunctionDeclaration") {
        return expr.symbol.name;
      } else if (expr.symbol.variant === "FunctionDefinition") {
        const generic =
          expr.symbol.generics.length > 0
            ? "<" + expr.symbol.generics.map((g) => serializeDatatype(g)).join(", ") + ">"
            : "";
        return expr.symbol.name + generic;
      }
      throw new InternalError("Symbol not supported: " + expr.symbol.variant);

    case "StructInstantiation":
      return `${serializeDatatype(expr.type)} { ${expr.assign.map((a) => `.${a.name} = ${serializeExpr(a.value)}`).join(", ")} }`;

    case "Constant":
      if (expr.type.variant === "PrimitiveDatatype" && expr.type.primitive === EPrimitive.str) {
        return `${JSON.stringify(expr.value)}`;
      } else {
        return `${expr.value}`;
      }

    case "ExprMemberAccess":
      return `(${serializeExpr(expr.expr)}.${expr.memberName})`;

    case "CallableExpr":
      return `Callable(${serializeNestedName(expr.functionSymbol)}, this=${serializeExpr(expr.thisExpr)})`;

    case "RawPointerAddressOf":
      return `&${serializeExpr(expr.expr)}`;

    case "RawPointerDereference":
      return `*${serializeExpr(expr.expr)}`;

    case "ExprAssignmentExpr":
      return `${serializeExpr(expr.target)} = ${serializeExpr(expr.value)}`;

    case "NamespaceValue":
      return `${serializeDatatype(expr.symbol)}`;
  }
}
