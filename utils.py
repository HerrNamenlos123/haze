import copy
from Error import CompilerError, UnreachableCode, InternalError
from Datatype import Datatype
from typing import Dict, List, Tuple
from SymbolName import SymbolName
from CompilationDatabase import ObjAttribute
from Symbol import VariableSymbol, VariableType
from FunctionSymbol import FunctionSymbol
from SymbolTable import SymbolTable, getStructMethods, getStructFields
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

    if len(datatype.generics()) != len(g):
        raise CompilerError(
            f"Generic datatype expected {len(datatype.generics())} generic arguments but got {len(g)}.",
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


def resolveGenerics(
    datatype: Datatype, scope: Scope, loc: Location, forceResolve: bool = False
):
    match datatype.variant():
        case Datatype.Variants.GenericPlaceholder:
            symbol = scope.lookupSymbol(datatype.name(), loc)
            if symbol.type.isGeneric():
                return datatype
            return symbol.type

        case Datatype.Variants.Struct:
            symbolTable = SymbolTable()
            for field in getStructFields(datatype):
                symbolTable.insert(
                    VariableSymbol(
                        field.name,
                        field.parentSymbol,
                        resolveGenerics(field.type, scope, loc),
                        field.variableType,
                    ),
                    loc,
                )
            for method in getStructMethods(datatype):
                symbolTable.insert(
                    FunctionSymbol(
                        method.name,
                        method.parentSymbol,
                        resolveGenerics(method.type, scope, loc),
                        method.functionLinkage,
                        method.scope,
                        method.thisPointerType,
                        method.isConstructor,
                        method.statements,
                        method.ctx,  # type: ignore
                    ),
                    loc,
                )
            generics: List[Tuple[str, Datatype | None]] = []
            for i in range(len(datatype.generics())):
                sym = scope.lookupSymbol(datatype.generics()[i][0], loc)
                if sym.type.isGeneric():
                    generics.append((sym.name, None))
                else:
                    generics.append((sym.name, sym.type))
            dt = Datatype.createStructDatatype(
                datatype.name(),
                generics,
                symbolTable,
            )
            return dt

        case Datatype.Variants.Function:
            if not datatype.isFunction():
                raise UnreachableCode()
            returntype = resolveGenerics(datatype.functionReturnType(), scope, loc)
            params: List[Tuple[str, Datatype]] = []
            for i in range(len(datatype.functionParameters())):
                newType = resolveGenerics(
                    datatype.functionParameters()[i][1], scope, loc
                )
                params.append(
                    (
                        datatype.functionParameters()[i][0],
                        newType,
                    )
                )
            return Datatype.createFunctionType(params, returntype)

        case Datatype.Variants.Pointer:
            if datatype.pointee() is None:
                raise UnreachableCode()
            pointee = resolveGenerics(datatype.pointee(), scope, loc)
            return Datatype.createPointerDatatype(pointee)

        case Datatype.Variants.ResolutionDeferred:
            return datatype

        case Datatype.Variants.Primitive:
            return datatype

    raise InternalError("Invalid variant: " + str(datatype.variant()))
