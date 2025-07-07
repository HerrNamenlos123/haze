import { BinaryOperationToString, IncrOperationToString } from "../shared/AST";
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
            node = node.nestedParentTypeSymbol;
        }
    }
    return fullName;
}

export function serializeFunctionName(expr: Semantic.FunctionDefinitionSymbol): string {
    if (expr.methodOf) {
        return `${getParentNames(expr.methodOf)}${expr.name}`;
    }
    else {
        throw new InternalError("Not implemented");
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
            return `Callable(${serializeFunctionName(expr.functionSymbol)}, this=${serializeExpr(expr.thisExpr)})`;
    }
}