import {
  BinaryOperationToString,
  EExternLanguage,
  IncrOperationToString,
  UnaryOperationToString,
} from "../shared/AST";
import { EPrimitive, primitiveToString, type LiteralValue } from "../shared/common";
import { assert, ImpossibleSituation, InternalError } from "../shared/Errors";
import { Semantic, type SemanticResult } from "./SemanticSymbols";

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

    case Semantic.ENode.NamespaceDatatype:
      return getParentNames(sr, datatypeId);

    case Semantic.ENode.LiteralValueDatatype:
      return serializeLiteralValue(datatype.literal);

    case Semantic.ENode.ArrayDatatype:
      return `${serializeDatatype(sr, datatype.datatype)}[${datatype.length}]`;

    case Semantic.ENode.SliceDatatype:
      return `${serializeDatatype(sr, datatype.datatype)}[]`;

    case Semantic.ENode.ParameterPackDatatypeSymbol:
      return `Pack[${datatype.parameters.map((p) => {
        const param = sr.nodes.get(p);
        assert(param.variant === Semantic.ENode.VariableSymbol);
        assert(param.type);
        return `${param.name}: ${serializeDatatype(sr, param.type)}`;
      })}]`;

    default:
      throw new InternalError("Not handled: " + datatype.variant);
  }
}

export function serializeLiteralValue(value: LiteralValue) {
  if (value.type === EPrimitive.str) {
    return `${JSON.stringify(value.value)}`;
  } else if (value.type === EPrimitive.bool) {
    return `${value.value ? "true" : "false"}`;
  } else {
    return `${primitiveToString(value.type)}(${value.value})`;
  }
}

export function getParentNames(sr: SemanticResult, symbolId: Semantic.Id) {
  let fullName = "";
  let nodeId: Semantic.Id | null = symbolId;
  while (nodeId) {
    const node = sr.nodes.get(nodeId);
    assert(
      node.variant === Semantic.ENode.NamespaceDatatype ||
        node.variant === Semantic.ENode.StructDatatype ||
        node.variant === Semantic.ENode.FunctionSymbol
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
        const pp = sr.nodes.get(p);
        if (pp.variant === Semantic.ENode.ParameterPackDatatypeSymbol) continue;
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
      let params = "";
      for (const p of type.parameters) {
        const pp = sr.nodes.get(p);
        if (pp.variant === Semantic.ENode.ParameterPackDatatypeSymbol) {
          for (const packParam of pp.parameters) {
            const packParamS = sr.nodes.get(packParam);
            assert(packParamS.variant === Semantic.ENode.VariableSymbol);
            assert(packParamS.type);
            params += mangleDatatype(sr, packParamS.type);
          }
        } else {
          params += mangleDatatype(sr, p);
        }
      }
      return "F" + params + "E" + mangleDatatype(sr, type.returnType);
    }

    case Semantic.ENode.PointerDatatype: {
      return "P" + mangleDatatype(sr, type.pointee);
    }

    case Semantic.ENode.ReferenceDatatype: {
      return "R" + mangleDatatype(sr, type.referee);
    }

    case Semantic.ENode.ArrayDatatype: {
      const lengthStr = type.length.toString();
      return "A" + lengthStr + "_" + mangleDatatype(sr, type.datatype);
    }

    case Semantic.ENode.SliceDatatype: {
      return "S" + mangleDatatype(sr, type.datatype);
    }

    case Semantic.ENode.ParameterPackDatatypeSymbol: {
      assert(false, "A parameter pack may not be mangled");
    }

    case Semantic.ENode.LiteralValueDatatype: {
      if (type.literal.type === EPrimitive.bool) {
        return `Lb${type.literal.value ? "1" : "0"}E`;
      } else if (type.literal.type === EPrimitive.str) {
        const utf8 = new TextEncoder().encode(type.literal.value);
        let base64 = btoa(String.fromCharCode(...utf8));
        // make it C-identifier-safe: base64 → base64url (replace +/ with _)
        base64 = base64.replace(/\+/g, "_").replace(/\//g, "_").replace(/=+$/, "");
        return `Ls${base64}E`;
      } else {
        if (Number.isInteger(type.literal.value)) {
          return type.literal.value < 0 ? `Lin${-type.literal.value}E` : `Li${type.literal.value}E`;
        } else {
          const repr = type.literal.value.toString().replace("-", "n").replace(".", "_");
          return `Lf${repr}E`;
        }
      }
    }

    default:
      throw new InternalError("Unhandled variant: " + type.variant);
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

    case Semantic.ENode.SymbolValueExpr: {
      const symbol = sr.nodes.get(expr.symbol);
      if (symbol.variant === Semantic.ENode.VariableSymbol) {
        return symbol.name;
      } else if (symbol.variant === Semantic.ENode.FunctionSymbol) {
        const generic =
          symbol.generics.length > 0
            ? "<" + symbol.generics.map((g) => serializeDatatype(sr, g)).join(", ") + ">"
            : "";
        return getParentNames(sr, expr.symbol) + generic;
      }
      throw new InternalError("Symbol not supported: " + symbol.variant);
    }

    case Semantic.ENode.StructInstantiationExpr:
      return `${serializeDatatype(sr, expr.type)} { ${expr.assign
        .map((a) => `${a.name}: ${serializeExpr(sr, a.value)}`)
        .join(", ")} }`;

    case Semantic.ENode.LiteralExpr: {
      return serializeLiteralValue(expr.literal);
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

    case Semantic.ENode.DatatypeAsValueExpr:
      return `${serializeDatatype(sr, expr.type)}`;

    case Semantic.ENode.ArrayLiteralExpr:
      return `[${expr.values.map((v) => serializeExpr(sr, v)).join(", ")}]`;

    case Semantic.ENode.ArraySubscriptExpr:
      return `${serializeExpr(sr, expr.expr)}[${expr.indices
        .map((i) => serializeExpr(sr, i))
        .join(", ")}]`;

    default:
      assert(false, expr.variant.toString());
  }
}
