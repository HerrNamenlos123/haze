import { primitiveToString } from "../shared/common";
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
            if (datatype.generics.length === 0) {
                return datatype.name;
            }
            else {
                return datatype.name + "<" + datatype.generics.map((g) => serializeDatatype(g)).join(", ") + ">";
            }

        default:
            throw new InternalError("Not handled: " + datatype.variant);
    }
}