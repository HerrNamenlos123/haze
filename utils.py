from Error import CompilerError
from Datatype import Datatype
from typing import Dict, List
from SymbolName import SymbolName


def unescapeString(input: str) -> str:
    result = ""
    index = 0
    while index < len(input):
        print("Matching: ", input[index])
        if input[index] == "\\" and index + 1 < len(input):
            match input[index + 1]:
                case "n":
                    result += "\n"
                    index += 1

                case "t":
                    result += "\t"
                    index += 1

                case "r":
                    result += "\r"
                    index += 1

                case '"':
                    result += '"'
                    index += 1

                case "\\":
                    result += "\\"
                    index += 1

                # case 'u': # Handle Unicode escape sequence
                #     # Example for simplicity, real handling would be more complex
                #     if ((it + 4) < input.end()) {
                #         std::string hex_str(it + 1, it + 5);
                #         unsigned int unicode;
                #         std::stringstream ss(hex_str);
                #         ss >> std::hex >> unicode;
                #         result += static_cast<char>(unicode);
                #         it += 4; // Skip the hex digits
                #     }

                case _:
                    result += "\\"
                    result += input[index + 1]
                    index += 1
        else:
            result += input[index]
        index += 1
    return result


def implGenericDatatype(
    self,
    ctx,
    deferDatatypes: bool,
    instantiateGenerics: bool,
):
    self.useCurrentNodeScope(ctx)
    name = ctx.ID().getText()
    self.visitChildren(ctx)

    dt = self.db.getCurrentScope().tryLookupSymbol(
        SymbolName(name), self.getLocation(ctx)
    )
    if not dt and deferDatatypes:
        self.setNodeDatatype(ctx, Datatype.createDeferredType())
        return

    datatype: Datatype = (
        self.db.getCurrentScope()
        .lookupSymbol(SymbolName(name), self.getLocation(ctx))
        .type
    )
    g = [self.getNodeDatatype(n) for n in ctx.datatype()]

    if len(datatype.generics) != len(g):
        raise CompilerError(
            f"Generic datatype expected {len(datatype.generics)} generic arguments but got {len(g)}.",
            self.getLocation(ctx),
        )

    # if not instantiateGenerics:  # This is for declarations such as 'Array<T>'
    #     generics: Dict[str, Datatype] = {}
    #     for i in range(len(datatype.genericsList)):
    #         generics[datatype.genericsList[i]] = g[i]
    # else:  # This is for instantiations such as 'Array<i32>'
    #     generics: Dict[str, Datatype] = {}
    #     for i in range(len(datatype.genericsList)):
    #         generics[datatype.genericsList[i]] = g[i]

    # datatype = datatype.instantiate(generics)
    self.setNodeDatatype(ctx, datatype)
