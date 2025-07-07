import { SymbolFlags } from "typescript";
import { BinaryOperationToString, EExternLanguage, IncrOperationToString } from "../shared/AST";
import { EPrimitive, primitiveToString } from "../shared/common";
import { GLOBAL_NAMESPACE_NAME } from "../shared/Config";
import { ImpossibleSituation, InternalError } from "../shared/Errors";
import type { Semantic } from "./SemanticSymbols";

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
            return `(${datatype.parameters.map((p) => serializeDatatype(p)).join(", ")}${datatype.vararg ? ', ...' : ''}) => ${serializeDatatype(datatype.returnType)}`;

        case "CallableDatatype":
            return `Callable<${serializeDatatype(datatype.functionType)}>(this=${datatype.thisExprType ? serializeDatatype(datatype.thisExprType) : ''})`;

        default:
            throw new InternalError("Not handled: " + datatype.variant);
    }
}

function getParentNames(symbol: Semantic.NamespaceSymbol | Semantic.StructDatatypeSymbol) {
    let fullName = "";
    let node: Semantic.NamespaceSymbol | Semantic.StructDatatypeSymbol | undefined = symbol;
    while (node) {
        if (node.variant === "StructDatatype") {
            const generics = node.generics.map((g) => serializeDatatype(g)).join(", ");
            fullName = `${node.name}${generics.length > 0 ? `<${generics}>` : ''}${fullName.length === 0 ? fullName : '.' + fullName}`;
            node = node.parent;
        }
        else {
            if (node.name !== GLOBAL_NAMESPACE_NAME) {
                fullName = `${node.name}${fullName.length === 0 ? fullName : '.' + fullName}`;
            }
            node = node.parent;
        }
    }
    return fullName;
}

export function serializeNestedName(expr: Semantic.FunctionDefinitionSymbol | Semantic.FunctionDeclarationSymbol): string {
    if (expr.variant === "FunctionDeclaration") {
        return `${expr.parent.name !== GLOBAL_NAMESPACE_NAME ? (getParentNames(expr.parent) + '.') : ''}${expr.name}`;
    }
    else if (expr.methodOf) {
        return `${getParentNames(expr.methodOf)}.${expr.name}`;
    }
    else {
        return `${expr.parent.name !== GLOBAL_NAMESPACE_NAME ? (getParentNames(expr.parent) + '.') : ''}${expr.name}`;
    }
}

export function mangleNestedName(
    symbol:
        | Semantic.StructDatatypeSymbol
        | Semantic.NamespaceSymbol
        | Semantic.FunctionDeclarationSymbol
        | Semantic.FunctionDefinitionSymbol,
) {
    if (symbol.variant !== "Namespace" && symbol.externLanguage === EExternLanguage.Extern_C) {
        return symbol.name;
    }

    const fragments: string[] = [];
    let p:
        | Semantic.StructDatatypeSymbol
        | Semantic.NamespaceSymbol
        | Semantic.FunctionDeclarationSymbol
        | Semantic.FunctionDefinitionSymbol
        | undefined = symbol;
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
        const pParent: Semantic.DatatypeSymbol | Semantic.NamespaceSymbol | undefined = p.parent;
        if (pParent) {
            if (pParent.variant !== "StructDatatype" && pParent.variant !== "Namespace") {
                throw new ImpossibleSituation();
            }
        }
        p = pParent;
        if (p?.name === GLOBAL_NAMESPACE_NAME) {
            p = undefined;
        }
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

export function mangleDatatype(type: Semantic.DatatypeSymbol): string {
    switch (type.variant) {
        case "StructDatatype": {
            return mangleNestedName(type);
        }

        case "CallableDatatype": {
            const name = "Callable";
            const generic =
                (type.thisExprType && "I" + mangleDatatype(type.thisExprType) + "E") || "";
            return name.length + name + generic + mangleDatatype(type.functionType);
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

        case "ExplicitCast":
            return `(${serializeExpr(expr.expr)} as ${serializeDatatype(expr.type)})`;

        case "ExprCall":
            return `((${serializeExpr(expr.calledExpr)})(${expr.arguments.map((a) => serializeExpr(a)).join(', ')}))`;

        case "PostIncrExpr":
            return `((${serializeExpr(expr.expr)})${IncrOperationToString(expr.operation)})`;

        case "PreIncrExpr":
            return `(${IncrOperationToString(expr.operation)}(${serializeExpr(expr.expr)}))`;

        case "SymbolValue":
            if (expr.symbol.variant === "Variable") {
                return expr.symbol.name;
            }
            else if (expr.symbol.variant === "FunctionDeclaration") {
                return expr.symbol.name;
            }
            else if (expr.symbol.variant === "FunctionDefinition") {
                return expr.symbol.name;
            }
            throw new InternalError("Symbol not supported: " + expr.symbol.variant)

        case "StructInstantiation":
            return `${serializeDatatype(expr.type)} { ${expr.assign.map((a) => `.${a.name} = ${serializeExpr(a.value)}`).join(", ")} }`;

        case "Constant":
            if (expr.type.variant === "PrimitiveDatatype" && expr.type.primitive === EPrimitive.str) {
                return `${JSON.stringify(expr.value)}`;
            }
            else {
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
    }
}