import { SymbolFlags } from "typescript";
import {
  BinaryOperationToString,
  EExternLanguage,
  IncrOperationToString,
  UnaryOperationToString,
} from "../shared/AST";
import { EPrimitive, primitiveToString } from "../shared/common";
import { assert, ImpossibleSituation, InternalError } from "../shared/Errors";
import { Semantic, type SemanticResult } from "./SemanticSymbols";
import { scaleRadial } from "d3";

export function serializeDatatype(sr: SemanticResult, datatypeId: Semantic.Id): string {
  const datatype = sr.nodes.get(datatypeId);

  switch (datatype.variant) {
    case Semantic.ENode.PrimitiveDatatype:
      return primitiveToString(datatype.primitive);

    case Semantic.ENode.PointerDatatype:
      return serializeDatatype(sr, datatype.pointee) + "*";

    case Semantic.ENode.ReferenceDatatype:
      return serializeDatatype(sr, datatype.referee) + "&";

    case Semantic.ENode.GenericParameterDatatype:
      return datatype.name;

    case Semantic.ENode.StructDatatype:
      return getParentNames(sr, datatypeId);

    case Semantic.ENode.FunctionDatatype:
      return `(${datatype.parameters.map((p) => serializeDatatype(sr, p)).join(", ")}${
        datatype.vararg ? ", ..." : ""
      }) => ${serializeDatatype(sr, datatype.returnType)}`;

    case Semantic.ENode.CallableDatatype:
      return `Callable<${serializeDatatype(sr, datatype.functionType)}>(this=${
        datatype.thisExprType ? serializeDatatype(sr, datatype.thisExprType) : ""
      })`;

    default:
      throw new InternalError("Not handled: " + datatype.variant);
  }
}

function getParentNames(sr: SemanticResult, symbolId: Semantic.Id) {
  let fullName = "";
  let nodeId: Semantic.Id | null = symbolId;
  while (nodeId) {
    const node = sr.nodes.get(nodeId);
    assert(
      node.variant === Semantic.ENode.NamespaceDatatype ||
        node.variant === Semantic.ENode.StructDatatype
    );
    if (node.variant === Semantic.ENode.StructDatatype) {
      const generics = node.generics.map((g) => serializeDatatype(sr, g)).join(", ");
      fullName = `${node.name}${generics.length > 0 ? `<${generics}>` : ""}${
        fullName.length === 0 ? fullName : "." + fullName
      }`;
      nodeId = node.parentStructOrNS;
    } else {
      fullName = `${node.name}${fullName.length === 0 ? fullName : "." + fullName}`;
      nodeId = node.parentStructOrNS;
    }
  }
  return fullName;
}

export function serializeNestedName(sr: SemanticResult, exprId: Semantic.Id): string {
  const expr = sr.nodes.get(exprId);
  if (expr.variant === Semantic.ENode.GlobalVariableDefinitionSymbol) {
    return `${(expr.parentStructOrNS && getParentNames(sr, expr.parentStructOrNS) + ".") || ""}${
      expr.name
    }`;
  } else if (expr.variant === Semantic.ENode.FunctionSymbol) {
    return `${(expr.parentStructOrNS && getParentNames(sr, expr.parentStructOrNS) + ".") || ""}${
      expr.name
    }`;
    // } else if (expr.methodOf) {
    //   return `${getParentNames(sr, expr.methodOf)}.${expr.name}`;
  } else if ("parentStructOrNS" in expr) {
    return `${(expr.parentStructOrNS && getParentNames(sr, expr.parentStructOrNS) + ".") || ""}${
      expr.name
    }`;
  } else {
    assert(false, expr.variant.toString());
  }
}

export function mangleNestedName(sr: SemanticResult, symbolId: Semantic.Id) {
  const symbol = sr.nodes.get(symbolId);
  assert(
    symbol.variant === Semantic.ENode.FunctionSymbol ||
      symbol.variant === Semantic.ENode.NamespaceDatatype ||
      symbol.variant === Semantic.ENode.GlobalVariableDefinitionSymbol ||
      symbol.variant === Semantic.ENode.StructDatatype
  );

  if (
    symbol.variant !== Semantic.ENode.NamespaceDatatype &&
    symbol.extern === EExternLanguage.Extern_C
  ) {
    return symbol.name;
  }

  const fragments: string[] = [];
  let pId: Semantic.Id | null = symbolId;
  while (pId) {
    const p = sr.nodes.get(pId);
    assert(
      p.variant === Semantic.ENode.FunctionSymbol ||
        p.variant === Semantic.ENode.NamespaceDatatype ||
        p.variant === Semantic.ENode.GlobalVariableDefinitionSymbol ||
        p.variant === Semantic.ENode.StructDatatype
    );
    if (p.variant !== Semantic.ENode.StructDatatype) {
      fragments.push(p.name.length + p.name);
    } else {
      let generics = "";
      if (p.generics.length > 0) {
        generics += "I";
        for (const g of p.generics) {
          generics += mangleDatatype(sr, g);
        }
        generics += "E";
      }
      fragments.push(p.name.length + p.name + generics);
    }
    const pParentId: Semantic.Id | null = p.parentStructOrNS;
    if (pParentId) {
      const pParent = sr.nodes.get(pParentId);
      if (
        pParent.variant !== Semantic.ENode.StructDatatype &&
        pParent.variant !== Semantic.ENode.NamespaceDatatype
      ) {
        throw new ImpossibleSituation();
      }
    }
    pId = pParentId;
  }
  fragments.reverse();
  let functionPart = "";
  if (symbol.variant === Semantic.ENode.FunctionSymbol) {
    const ftype = sr.nodes.get(symbol.type);
    if (ftype.variant !== Semantic.ENode.FunctionDatatype) throw new ImpossibleSituation();
    if (ftype.parameters.length === 0) {
      functionPart += "v";
    } else {
      for (const p of ftype.parameters) {
        functionPart += mangleDatatype(sr, p);
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

export function mangleDatatype(sr: SemanticResult, typeId: Semantic.Id): string {
  const type = sr.nodes.get(typeId);

  switch (type.variant) {
    case Semantic.ENode.StructDatatype: {
      return mangleNestedName(sr, typeId);
    }

    case Semantic.ENode.CallableDatatype: {
      if (!CallableManglingHashStore.has(type)) {
        CallableManglingHashStore.set(type, CallableUniqueCounter++);
      }
      const uniqueID = CallableManglingHashStore.get(type);
      assert(uniqueID);

      // const generic =
      //     (type.thisExprType && "I" + mangleDatatype(type.thisExprType) + "E") || "";
      return "__Callable__" + uniqueID.toString();
    }

    case Semantic.ENode.PrimitiveDatatype: {
      const name = primitiveToString(type.primitive);
      return name.length + name;
    }

    case Semantic.ENode.FunctionDatatype: {
      return (
        "F" +
        type.parameters.map((p) => mangleDatatype(sr, p)).join("") +
        "E" +
        mangleDatatype(sr, type.returnType)
      );
    }

    case Semantic.ENode.PointerDatatype: {
      return "P" + mangleDatatype(sr, type.pointee);
    }

    case Semantic.ENode.ReferenceDatatype: {
      return "R" + mangleDatatype(sr, type.referee);
    }

    default:
      throw new InternalError("Unhandled variant: ");
  }
}

export function serializeExpr(sr: SemanticResult, exprId: Semantic.Id): string {
  const expr = sr.nodes.get(exprId);

  switch (expr.variant) {
    case Semantic.ENode.BinaryExpr:
      return `(${serializeExpr(sr, expr.left)} ${BinaryOperationToString(
        expr.operation
      )} ${serializeExpr(sr, expr.left)})`;

    case Semantic.ENode.UnaryExpr:
      return `(${UnaryOperationToString(expr.operation)} ${serializeExpr(sr, expr.expr)})`;

    case Semantic.ENode.SizeofExpr:
      return `sizeof<${expr.datatype ? serializeDatatype(sr, expr.datatype) : ""}>`;

    case Semantic.ENode.ExplicitCastExpr:
      return `(${serializeExpr(sr, expr.expr)} as ${serializeDatatype(sr, expr.type)})`;

    case Semantic.ENode.ExprCallExpr:
      return `(${serializeExpr(sr, expr.calledExpr)}(${expr.arguments
        .map((a) => serializeExpr(sr, a))
        .join(", ")}))`;

    case Semantic.ENode.PostIncrExpr:
      return `((${serializeExpr(sr, expr.expr)})${IncrOperationToString(expr.operation)})`;

    case Semantic.ENode.PreIncrExpr:
      return `(${IncrOperationToString(expr.operation)}(${serializeExpr(sr, expr.expr)}))`;

    case Semantic.ENode.SymbolValueExpr:
      if (expr.symbol.variant === Semantic.ENode.VariableSymbol) {
        return expr.symbol.name;
      } else if (expr.symbol.variant === Semantic.ENode.FunctionSymbol) {
        const generic =
          expr.symbol.generics.length > 0
            ? "<" + expr.symbol.generics.map((g) => serializeDatatype(sr, g)).join(", ") + ">"
            : "";
        return expr.symbol.name + generic;
      }
      throw new InternalError("Symbol not supported: " + expr.symbol.variant);

    case Semantic.ENode.StructInstantiationExpr:
      return `${serializeDatatype(sr, expr.type)} { ${expr.assign
        .map((a) => `.${a.name} = ${serializeExpr(sr, a.value)}`)
        .join(", ")} }`;

    case Semantic.ENode.LiteralExpr: {
      const type = sr.nodes.get(expr.type);
      if (type.variant === Semantic.ENode.PrimitiveDatatype && type.primitive === EPrimitive.str) {
        return `${JSON.stringify(expr.literal.value)}`;
      } else {
        return `${primitiveToString(expr.literal.type)}(${expr.literal.value})`;
      }
    }

    case Semantic.ENode.MemberAccessExpr:
      return `(${serializeExpr(sr, expr.expr)}.${expr.memberName})`;

    case Semantic.ENode.CallableExpr:
      return `Callable(${serializeNestedName(sr, expr.functionSymbol)}, this=${serializeExpr(
        sr,
        expr.thisExpr
      )})`;

    case Semantic.ENode.PointerAddressOfExpr:
      return `&${serializeExpr(sr, expr.expr)}`;

    case Semantic.ENode.PointerDereferenceExpr:
      return `*${serializeExpr(sr, expr.expr)}`;

    case Semantic.ENode.ExprAssignmentExpr:
      return `${serializeExpr(sr, expr.target)} = ${serializeExpr(sr, expr.value)}`;

    case Semantic.ENode.NamespaceValueExpr:
      return `${serializeDatatype(sr, expr.symbol)}`;

    default:
      assert(false, expr.variant.toString());
  }
}
