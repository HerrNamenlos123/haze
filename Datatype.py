from enum import Enum
from typing import List, Tuple, Dict, Optional
from Error import InternalError, UnreachableCode, CompilerError, getCallerLocation
from Location import Location
import copy


class FunctionLinkage(Enum):
    Haze = (1,)
    External_C = (2,)
    External_CXX = (3,)


class Datatype:
    class Variants(Enum):
        Primitive = (1,)
        Function = (2,)
        Struct = (3,)
        Pointer = (4,)
        ResolutionDeferred = (5,)
        GenericPlaceholder = (6,)

    class PrimitiveVariants(Enum):
        none = (1,)
        unknown = (2,)
        boolean = (3,)
        booleanptr = (4,)
        i8 = (5,)
        i16 = (6,)
        i32 = (7,)
        i64 = (8,)
        u8 = (9,)
        u16 = (10,)
        u32 = (11,)
        u64 = (12,)
        stringview = (13,)

    @staticmethod
    def primitiveVariantToString(variant: PrimitiveVariants) -> str:
        match variant:
            case Datatype.PrimitiveVariants.none:
                return "none"
            case Datatype.PrimitiveVariants.unknown:
                return "unknown"
            case Datatype.PrimitiveVariants.boolean:
                return "boolean"
            case Datatype.PrimitiveVariants.booleanptr:
                return "booleanptr"
            case Datatype.PrimitiveVariants.i8:
                return "i8"
            case Datatype.PrimitiveVariants.i16:
                return "i16"
            case Datatype.PrimitiveVariants.i32:
                return "i32"
            case Datatype.PrimitiveVariants.i64:
                return "i64"
            case Datatype.PrimitiveVariants.u8:
                return "u8"
            case Datatype.PrimitiveVariants.u16:
                return "u16"
            case Datatype.PrimitiveVariants.u32:
                return "u32"
            case Datatype.PrimitiveVariants.u64:
                return "u64"
            case Datatype.PrimitiveVariants.stringview:
                return "stringview"
        raise InternalError("Datatype has no string representation")

    def __init__(
        self,
        variant: Variants,
        name: str,
        primitiveVariant: PrimitiveVariants,
        functionParameters: List[Tuple[str, "Datatype"]],
        functionReturnType: Optional["Datatype"],
        generics: List[Tuple[str, Optional["Datatype"]]],
        pointee: Optional["Datatype"],
        structMemberSymbols,
    ):
        self.variant = variant
        self.name = name
        self.primitiveVariant = primitiveVariant
        self.functionParameters = functionParameters
        self.functionReturnType = functionReturnType
        self.generics = generics
        self.pointee = pointee
        self.structMemberSymbols = structMemberSymbols

    @staticmethod
    def createPrimitiveType(variant: PrimitiveVariants):
        from SymbolTable import SymbolTable

        return Datatype(
            Datatype.Variants.Primitive,
            Datatype.primitiveVariantToString(variant),
            variant,
            [],
            None,
            [],
            None,
            SymbolTable(),
        )

    @staticmethod
    def createGenericPlaceholder(name: str):
        from SymbolTable import SymbolTable

        return Datatype(
            Datatype.Variants.GenericPlaceholder,
            name,
            Datatype.PrimitiveVariants.unknown,
            [],
            None,
            [],
            None,
            SymbolTable(),
        )

    @staticmethod
    def createFunctionType(
        params: List[Tuple[str, "Datatype"]], returnType: "Datatype"
    ):
        from SymbolTable import SymbolTable

        if not isinstance(returnType, Datatype):
            raise InternalError(
                "Tried to create function with symbol return", getCallerLocation(1)
            )

        return Datatype(
            Datatype.Variants.Function,
            "",
            Datatype.PrimitiveVariants.unknown,
            params,
            returnType,
            [],
            None,
            SymbolTable(),
        )

    @staticmethod
    def createDeferredType():
        from SymbolTable import SymbolTable

        return Datatype(
            Datatype.Variants.ResolutionDeferred,
            "__Deferred",
            Datatype.PrimitiveVariants.unknown,
            [],
            None,
            [],
            None,
            SymbolTable(),
        )

    @staticmethod
    def createPointerDatatype(pointee: "Datatype"):
        from SymbolTable import SymbolTable

        return Datatype(
            Datatype.Variants.Pointer,
            "",
            Datatype.PrimitiveVariants.unknown,
            [],
            None,
            [],
            pointee,
            SymbolTable(),
        )

    @staticmethod
    def createStructDatatype(
        name: str,
        generics: List[Tuple[str, Optional["Datatype"]]],
    ):
        from SymbolTable import SymbolTable

        return Datatype(
            Datatype.Variants.Struct,
            name,
            Datatype.PrimitiveVariants.unknown,
            [],
            None,
            generics,
            None,
            SymbolTable(),
        )

    def isPrimitive(self):
        return self.variant == Datatype.Variants.Primitive

    def isPointer(self):
        return self.variant == Datatype.Variants.Pointer

    def isStruct(self):
        return self.variant == Datatype.Variants.Struct

    def isFunction(self):
        return self.variant == Datatype.Variants.Function

    def isInteger(self):
        if self.variant != Datatype.Variants.Primitive:
            return False
        match self.primitiveVariant:
            case Datatype.PrimitiveVariants.i64:
                return True
            case Datatype.PrimitiveVariants.i32:
                return True
            case Datatype.PrimitiveVariants.i16:
                return True
            case Datatype.PrimitiveVariants.i8:
                return True
            case Datatype.PrimitiveVariants.u64:
                return True
            case Datatype.PrimitiveVariants.u32:
                return True
            case Datatype.PrimitiveVariants.u16:
                return True
            case Datatype.PrimitiveVariants.u8:
                return True
        return False

    def isBoolean(self):
        return (
            self.variant == Datatype.Variants.Primitive
            and self.primitiveVariant == Datatype.PrimitiveVariants.boolean
        )

    def isCallable(self):
        return self.variant == Datatype.Variants.Function

    def isNone(self):
        return (
            self.variant == Datatype.Variants.Primitive
            and self.primitiveVariant == Datatype.PrimitiveVariants.none
        )

    def isDeferred(self):
        return self.variant == Datatype.Variants.ResolutionDeferred

    def isUnknown(self):
        return (
            self.variant == Datatype.Variants.Primitive
            and self.primitiveVariant == Datatype.PrimitiveVariants.unknown
        )

    def getDisplayName(self):
        match self.variant:
            case Datatype.Variants.Primitive:
                return Datatype.primitiveVariantToString(self.primitiveVariant)
            case Datatype.Variants.Function:
                if self.functionReturnType is None:
                    raise InternalError("Function is missing functionReturnType")
                g = []
                for gen in self.generics:
                    name = gen[0]
                    if gen[1]:
                        name = f"{gen[0]} = {gen[1].getDisplayName()}"
                    g.append(name)
                params = []
                for name, type in self.functionParameters:
                    params.append(type.getDisplayName())
                s = ""
                if len(g) > 0:
                    s += f"<{','.join(g)}>"
                return (
                    s
                    + f"({', '.join(params)}) -> {self.functionReturnType.getDisplayName()}"
                )
            case Datatype.Variants.Pointer:
                if self.pointee is None:
                    raise InternalError("Pointer is missing pointee")
                return f"Ptr<{self.pointee.getDisplayName()}>"
            case Datatype.Variants.ResolutionDeferred:
                return "__Deferred"
            case Datatype.Variants.Struct:
                if self.name.startswith("__anonym_"):
                    val = "struct {"
                    for (
                        name,
                        symbol,
                    ) in self.structMemberSymbols.symbols.items():
                        val += f"{name}: {symbol.type.getDisplayName()}, "
                    if len(self.structMemberSymbols.getAllSymbols().keys()) > 0:
                        val = val[:-2]
                    val += " }"
                    return val
                else:
                    s = self.name
                    if self.generics:
                        g = [
                            f"{gg[0]} = {gg[1]}" if gg[1] else gg[0]
                            for gg in self.generics
                        ]
                        s += f"<{','.join(g)}>"
                    return s
            case Datatype.Variants.GenericPlaceholder:
                return self.name
        raise InternalError("Invalid variant")

    def __str__(self):
        return str(self.getDisplayName())

    def __repr__(self):
        return str(self.getDisplayName())

    def getMangledName(self):
        match self.variant:
            case Datatype.Variants.Primitive:
                return Datatype.primitiveVariantToString(self.primitiveVariant)
            case Datatype.Variants.Pointer:
                raise InternalError("Cannot mangle pointer")
            case Datatype.Variants.ResolutionDeferred:
                raise InternalError("Cannot mangle deferred")
            case Datatype.Variants.Struct:
                mangled = str(len(self.name))
                mangled += self.name
                if len(self.generics) > 0:
                    mangled += "I"
                    for name, tp in self.generics:
                        if not tp:
                            raise InternalError(
                                f"Generic placeholder '{name}' is missing value",
                                getCallerLocation(),
                            )
                        mangled += tp.getMangledName()
                    mangled += "E"
                return mangled
            case Datatype.Variants.Function:
                mangled = "F"
                for name, tp in self.functionParameters:
                    mangled += tp.getMangledName()
                mangled += "E"
                return mangled
        raise InternalError("Invalid variant " + str(self.variant))

    def areAllGenericsResolved(self):
        from Symbol import VariableSymbol

        if not self.isGeneric():
            return True
        match self.variant:
            case Datatype.Variants.Primitive:
                return True
            case Datatype.Variants.GenericPlaceholder:
                return False
            case Datatype.Variants.ResolutionDeferred:
                raise InternalError("Deferred type should no longer be in this stage")
            case Datatype.Variants.Pointer:
                return self.pointee and self.pointee.areAllGenericsResolved()
            case Datatype.Variants.Function:
                if (
                    self.functionReturnType
                    and not self.functionReturnType.areAllGenericsResolved()
                ):
                    return False
                for name, type in self.functionParameters:
                    if not type.areAllGenericsResolved():
                        return False
                for name, tp in self.generics:
                    if not tp:
                        return False
                return True
            case Datatype.Variants.Struct:
                for vsym in self.structMemberSymbols.getFiltered(VariableSymbol):
                    vsymbol: VariableSymbol = vsym
                    if not vsymbol.type.areAllGenericsResolved():
                        return False
                for name, tp in self.generics:
                    if not tp:
                        return False
                return True
        raise InternalError("Invalid variant " + str(self.variant))

    def isGeneric(self):
        match self.variant:
            case Datatype.Variants.Primitive:
                return False

            case Datatype.Variants.GenericPlaceholder:
                return True

            case Datatype.Variants.ResolutionDeferred:
                return False

            case Datatype.Variants.Pointer:
                return self.pointee and self.pointee.isGeneric()

            case Datatype.Variants.Function:
                if self.functionReturnType and self.functionReturnType.isGeneric():
                    return True
                for name, type in self.functionParameters:
                    if type.isGeneric():
                        return True
                return len(self.generics) > 0

            case Datatype.Variants.Struct:
                from Symbol import VariableSymbol

                for vsym in self.structMemberSymbols.getFiltered(VariableSymbol):
                    vsymbol: VariableSymbol = vsym
                    if vsymbol.type.isGeneric():
                        return True
                return len(self.generics) > 0

        raise InternalError("Invalid variant " + str(self.variant))

    def containsUnknown(self):
        match self.variant:
            case Datatype.Variants.Primitive:
                return self.isUnknown()
            case Datatype.Variants.Function:
                if self.functionReturnType is None:
                    raise InternalError("bullshit happening")
                if self.functionReturnType.isUnknown():
                    return True
                for name, type in self.functionParameters:
                    if type.isUnknown():
                        return True
                return False
        raise InternalError("Invalid variant: " + str(self.variant))

    def generateDefinitionCCode(self):
        match self.variant:
            case Datatype.Variants.Primitive:
                return ""
            case Datatype.Variants.Struct:
                from Symbol import VariableSymbol

                out = f"typedef struct __{self.generateUsageCode()}__ {{\n"
                for memberSymbol in self.structMemberSymbols.symbols:
                    if isinstance(memberSymbol, VariableSymbol):
                        out += f"    {memberSymbol.type.generateUsageCode()
                                      } {memberSymbol.name};\n"
                out += f"}} {self.generateUsageCode()};\n"
                return out
        raise InternalError("Invalid variant: " + str(self.variant))

    def generateUsageCode(self):
        match self.variant:
            case Datatype.Variants.Primitive:
                match self.primitiveVariant:
                    case Datatype.PrimitiveVariants.none:
                        return "void"
                    case Datatype.PrimitiveVariants.unknown:
                        raise InternalError(
                            "Type 'unknown' is compiler internal and must not appear in generated C-code"
                        )
                    case Datatype.PrimitiveVariants.boolean:
                        return "bool"
                    case Datatype.PrimitiveVariants.booleanptr:
                        return "bool*"
                    case Datatype.PrimitiveVariants.i8:
                        return "int8_t"
                    case Datatype.PrimitiveVariants.i16:
                        return "int16_t"
                    case Datatype.PrimitiveVariants.i32:
                        return "int32_t"
                    case Datatype.PrimitiveVariants.i64:
                        return "int64_t"
                    case Datatype.PrimitiveVariants.u8:
                        return "uint8_t"
                    case Datatype.PrimitiveVariants.u16:
                        return "uint16_t"
                    case Datatype.PrimitiveVariants.u32:
                        return "uint32_t"
                    case Datatype.PrimitiveVariants.u64:
                        return "uint64_t"
                    case Datatype.PrimitiveVariants.stringview:
                        return "char*"
                raise UnreachableCode()
            # case Datatype.Variants.Function:
            #     return f"void*"
            case Datatype.Variants.Pointer:
                if self.pointee is None:
                    raise InternalError("bullshit happening")
                return f"{self.pointee.generateUsageCode()}*"
            case Datatype.Variants.ResolutionDeferred:
                raise InternalError("Cannot generate usage code for deferred")
            case Datatype.Variants.Struct:
                return "_H" + self.getMangledName()
            case Datatype.Variants.Function:
                return self.getMangledName()
        raise InternalError("Invalid variant: " + str(self.variant))


def isSame(a: Datatype, b: Datatype):
    if a.isPrimitive() and b.isPrimitive():
        return a.primitiveVariant == b.primitiveVariant

    if a.isPointer() and b.isPointer():
        if a.pointee is None or b.pointee is None:
            return False
        return isSame(a.pointee, b.pointee)

    if a.isFunction() and b.isFunction():
        if not a.functionReturnType or not b.functionReturnType:
            return False
        if not isSame(a.functionReturnType, b.functionReturnType):
            return False
        if len(a.functionParameters) != len(b.functionParameters):
            return False
        for i in range(len(a.functionParameters)):
            if not isSame(a.functionParameters[i][1], b.functionParameters[i][1]):
                return False
        return True

    if a.isStruct() and b.isStruct():
        from Symbol import VariableSymbol

        aMembers = a.structMemberSymbols.getFiltered(VariableSymbol)
        bMembers = b.structMemberSymbols.getFiltered(VariableSymbol)
        if len(aMembers) != len(bMembers):
            return False
        for i in range(len(aMembers)):
            if aMembers[i].name != bMembers[i].name:
                return False
            if not isSame(aMembers[i].type, bMembers[i].type):
                return False
        return True
    return False


def implicitConversion(_from: Datatype, to: Datatype, expr: str, loc: Location) -> str:
    if isSame(_from, to):
        return expr

    if _from.isPrimitive() and to.isPrimitive():
        if _from.isInteger() and to.isInteger():
            return f"({to.generateUsageCode()})({expr})"
        raise InternalError(
            f"No implicit conversion from {_from.getDisplayName()} to {
                to.getDisplayName()}"
        )

    if _from.isPointer() and to.isPointer():
        raise CompilerError(
            "Pointer types are not convertible. Polymorphism is not implemented yet",
            loc,
        )

    if _from.isFunction() and to.isFunction():
        if _from.functionReturnType is None or to.functionReturnType is None:
            raise InternalError("bullshit happening")
        if isSame(_from.functionReturnType, to.functionReturnType):
            if len(_from.functionParameters) == len(to.functionParameters):
                equal = True
                for i in range(len(_from.functionParameters)):
                    if not isSame(
                        _from.functionParameters[i][1], to.functionParameters[i][1]
                    ):
                        equal = False
                if equal:
                    return expr
        raise CompilerError(
            f"No implicit conversion from '{_from.getDisplayName()}' to '{
                to.getDisplayName()}'",
            loc,
        )

    if _from.isStruct() and to.isStruct():
        from SymbolTable import SymbolTable, getStructFields, getStructMethods
        from Symbol import VariableSymbol

        a_list = getStructFields(_from)
        b_list = getStructFields(to)

        if len(a_list) != len(b_list):
            raise CompilerError(
                f"No implicit conversion from '{_from.getDisplayName()}' to '{
                    to.getDisplayName()}'",
                loc,
            )

        def exactMatchInTheOther(a: VariableSymbol, b_list: List[VariableSymbol]):
            for b in b_list:
                if a.name == b.name and isSame(a.type, b.type):
                    return True
            return False

        equal = True
        for a in a_list:
            if not exactMatchInTheOther(a, b_list):
                equal = False
        for b in b_list:
            if not exactMatchInTheOther(b, a_list):
                equal = False

        if equal:
            return expr

        raise CompilerError(
            f"No implicit conversion from '{_from.getDisplayName()}' to '{
                to.getDisplayName()}'",
            loc,
        )

    raise CompilerError(
        f"No implicit conversion from '{_from.getDisplayName()}' to '{
            to.getDisplayName()}'",
        loc,
    )
