import copy
from Error import CompilerError, UnreachableCode
from Datatype import Datatype
from typing import Dict, List
from SymbolName import SymbolName
from CompilationDatabase import ObjAttribute
from Symbol import VariableSymbol, VariableType
from SymbolTable import SymbolTable, getStructFunctions, getStructFields
from Scope import Scope
from Location import Location


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

    self.setNodeDatatype(ctx, datatype)


def getObjectAttributes(self, ctx):
    attributes: List[ObjAttribute] = []
    for attr in ctx.objectattribute():
        att = self.getNodeObjectAttribute(attr)
        attributes.append(att)
        # memberSymbol = VariableSymbol(
        #     att.name,
        #     None,
        #     att.declaredType,
        #     VariableType.MutableStructField,
        # )
    return attributes


def getNamedObjectAttributes(self, ctx):
    datatype = self.getNodeDatatype(ctx.datatype())
    if not datatype.isStruct():
        raise CompilerError(
            f"Trying to instantiate a non-structural datatype '{datatype.getDisplayName()}'",
            self.getLocation(ctx),
        )

    atts = ctx.objectattribute()
    attributes: List[ObjAttribute] = []
    members = getStructFields(datatype)
    if len(members) != len(atts):
        raise CompilerError(
            f"Type '{datatype.getDisplayName()}' expects {len(members)} fields, but {len(atts)} were provided",
            self.getLocation(ctx),
        )

    for i in range(len(atts)):
        att = self.getNodeObjectAttribute(atts[i])

        field = None
        for f in getStructFields(datatype):
            if f.name == att.name:
                field = f
                break

        if not field:
            raise CompilerError(
                f"Type '{datatype.getDisplayName()}' has no member named '{att.name}'",
                self.getLocation(ctx),
            )

        att.declaredType = field.type
        att.receivedType = self.getNodeDatatype(att.expr)
        attributes.append(att)

    return attributes


def resolveGenerics(datatype: Datatype, scope: Scope, loc: Location):
    match datatype.variant:
        case Datatype.Variants.GenericPlaceholder:
            symbol = scope.lookupSymbol(datatype.name, loc)
            if symbol.type.isGeneric():
                return datatype
            return symbol.type

        case Datatype.Variants.Struct:
            d = datatype.deepcopy()
            for field in getStructFields(datatype):
                newType = resolveGenerics(field.type, scope, loc)
                d.structMemberSymbols.setSymbol(
                    field.name,
                    VariableSymbol(
                        field.name, field.parentSymbol, newType, field.variableType
                    ),
                )
            for i in range(len(d.generics)):
                s = scope.lookupSymbol(d.generics[i][0], loc)
                if not s.type.isGeneric():
                    d.generics[i] = (s.name, s.type)
            return d

        case Datatype.Variants.Function:
            f = datatype.deepcopy()
            if (
                not f.isFunction()
                or f.functionReturnType is None
                or f.functionParameters is None
            ):
                raise UnreachableCode()
            f.functionReturnType = resolveGenerics(f.functionReturnType, scope, loc)
            for i in range(len(datatype.functionParameters)):
                newType = resolveGenerics(datatype.functionParameters[i][1], scope, loc)
                f.functionParameters[i] = (f.functionParameters[i][0], newType)
            return f

        case Datatype.Variants.Pointer:
            p = datatype.deepcopy()
            if p.pointee is None:
                raise UnreachableCode()
            p.pointee = resolveGenerics(p.pointee, scope, loc)
            return p

        case Datatype.Variants.ResolutionDeferred:
            raise UnreachableCode()

        case Datatype.Variants.Primitive:
            return datatype

    raise InternalError("Invalid variant: " + str(datatype.variant))
