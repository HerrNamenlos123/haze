from __future__ import annotations  # Enables forward references
from enum import Enum
from typing import List, Tuple, Dict, Optional, TYPE_CHECKING
from Error import InternalError, UnreachableCode, CompilerError, getCallerLocation
from Location import Location
import copy

if TYPE_CHECKING:
    from SymbolTable import SymbolTable


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
        structMemberSymbols: Optional[SymbolTable],
    ):
        self._variant = variant
        self._name = name
        self._primitiveVariant = primitiveVariant
        self._functionParameters = functionParameters
        self._functionReturnType = functionReturnType
        self._generics = generics
        self._pointee = pointee
        self._structMemberSymbols = structMemberSymbols

    def functionReturnType(self):
        if self._functionReturnType is None:
            raise InternalError("Function is missing return type", getCallerLocation())
        return copy.deepcopy(self._functionReturnType)

    def functionParameters(self):
        if self._functionParameters is None:
            raise InternalError("Function is missing parameters", getCallerLocation())
        return copy.deepcopy(self._functionParameters)

    def generics(self):
        return copy.deepcopy(self._generics)

    def variant(self):
        return copy.deepcopy(self._variant)

    def name(self):
        return copy.deepcopy(self._name)

    def structSymbolTable(self):
        if self._structMemberSymbols is None:
            raise InternalError(
                "Struct is missing struct symbol table", getCallerLocation()
            )
        return copy.deepcopy(self._structMemberSymbols)

    def pointee(self):
        if self._pointee is None:
            raise InternalError("Pointer is missing pointee", getCallerLocation())
        return copy.deepcopy(self._pointee)

    @staticmethod
    def createPrimitiveType(variant: PrimitiveVariants):
        return Datatype(
            Datatype.Variants.Primitive,
            Datatype.primitiveVariantToString(variant),
            variant,
            [],
            None,
            [],
            None,
            None,
        )

    @staticmethod
    def createGenericPlaceholder(name: str):
        return Datatype(
            Datatype.Variants.GenericPlaceholder,
            name,
            Datatype.PrimitiveVariants.unknown,
            [],
            None,
            [],
            None,
            None,
        )

    @staticmethod
    def createFunctionType(
        params: List[Tuple[str, "Datatype"]], returnType: "Datatype"
    ):
        return Datatype(
            Datatype.Variants.Function,
            "",
            Datatype.PrimitiveVariants.unknown,
            params,
            returnType,
            [],
            None,
            None,
        )

    @staticmethod
    def createDeferredType():
        return Datatype(
            Datatype.Variants.ResolutionDeferred,
            "__Deferred",
            Datatype.PrimitiveVariants.unknown,
            [],
            None,
            [],
            None,
            None,
        )

    @staticmethod
    def createPointerDatatype(pointee: "Datatype"):
        return Datatype(
            Datatype.Variants.Pointer,
            "",
            Datatype.PrimitiveVariants.unknown,
            [],
            None,
            [],
            pointee,
            None,
        )

    @staticmethod
    def createStructDatatype(
        name: str,
        generics: List[Tuple[str, Optional["Datatype"]]],
        symbolTable: Optional[SymbolTable],
    ):
        return Datatype(
            Datatype.Variants.Struct,
            name,
            Datatype.PrimitiveVariants.unknown,
            [],
            None,
            generics,
            None,
            symbolTable,
        )

    def isPrimitive(self):
        return self._variant == Datatype.Variants.Primitive

    def isPointer(self):
        return self._variant == Datatype.Variants.Pointer

    def isStruct(self):
        return self._variant == Datatype.Variants.Struct

    def isFunction(self):
        return self._variant == Datatype.Variants.Function

    def isInteger(self):
        if self._variant != Datatype.Variants.Primitive:
            return False
        match self._primitiveVariant:
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
            self._variant == Datatype.Variants.Primitive
            and self._primitiveVariant == Datatype.PrimitiveVariants.boolean
        )

    def isCallable(self):
        return self._variant == Datatype.Variants.Function

    def isNone(self):
        return (
            self._variant == Datatype.Variants.Primitive
            and self._primitiveVariant == Datatype.PrimitiveVariants.none
        )

    def isDeferred(self):
        return self._variant == Datatype.Variants.ResolutionDeferred

    def isUnknown(self):
        return (
            self._variant == Datatype.Variants.Primitive
            and self._primitiveVariant == Datatype.PrimitiveVariants.unknown
        )

    def getDisplayName(self):
        match self._variant:
            case Datatype.Variants.Primitive:
                return Datatype.primitiveVariantToString(self._primitiveVariant)
            case Datatype.Variants.Function:
                if self._functionReturnType is None:
                    raise InternalError("Function is missing functionReturnType")
                g = []
                for gen in self._generics:
                    name = gen[0]
                    if gen[1]:
                        name = f"{gen[0]} = {gen[1].getDisplayName()}"
                    g.append(name)
                params = []
                for name, type in self._functionParameters:
                    params.append(type.getDisplayName())
                s = ""
                if len(g) > 0:
                    s += f"<{','.join(g)}>"
                return (
                    s
                    + f"({', '.join(params)}) -> {self._functionReturnType.getDisplayName()}"
                )
            case Datatype.Variants.Pointer:
                if self._pointee is None:
                    raise InternalError("Pointer is missing pointee")
                return f"Ptr<{self._pointee.getDisplayName()}>"
            case Datatype.Variants.ResolutionDeferred:
                return "__Deferred"
            case Datatype.Variants.Struct:
                if self._name.startswith("__anonym_"):
                    val = "struct {"
                    for symbol in self.structSymbolTable().symbols:
                        val += f"{symbol.name}: {symbol.type.getDisplayName()}, "
                    if len(self.structSymbolTable().symbols) > 0:
                        val = val[:-2]
                    val += " }"
                    return val
                else:
                    s = self._name
                    if self._generics:
                        g = [
                            f"{gg[0]} = {gg[1]}" if gg[1] else gg[0]
                            for gg in self._generics
                        ]
                        s += f"<{','.join(g)}>"
                    return s
            case Datatype.Variants.GenericPlaceholder:
                return self._name
        raise InternalError("Invalid variant")

    def __str__(self):
        return str(self.getDisplayName())

    def __repr__(self):
        return str(self.getDisplayName())

    def getMangledName(self):
        match self._variant:
            case Datatype.Variants.Primitive:
                return Datatype.primitiveVariantToString(self._primitiveVariant)
            case Datatype.Variants.Pointer:
                raise InternalError("Cannot mangle pointer")
            case Datatype.Variants.ResolutionDeferred:
                raise InternalError("Cannot mangle deferred")
            case Datatype.Variants.Struct:
                mangled = str(len(self._name))
                mangled += self._name
                if len(self._generics) > 0:
                    mangled += "I"
                    for name, tp in self._generics:
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
                for name, tp in self._functionParameters:
                    mangled += tp.getMangledName()
                mangled += "E"
                return mangled
        raise InternalError("Invalid variant " + str(self._variant))

    def areAllGenericsResolved(self):
        from Symbol import VariableSymbol

        if not self.isGeneric():
            return True
        match self._variant:
            case Datatype.Variants.Primitive:
                return True
            case Datatype.Variants.GenericPlaceholder:
                return False
            case Datatype.Variants.ResolutionDeferred:
                raise InternalError("Deferred type should no longer be in this stage")
            case Datatype.Variants.Pointer:
                return self._pointee and self._pointee.areAllGenericsResolved()
            case Datatype.Variants.Function:
                if (
                    self._functionReturnType
                    and not self._functionReturnType.areAllGenericsResolved()
                ):
                    return False
                for name, type in self._functionParameters:
                    if not type.areAllGenericsResolved():
                        return False
                for name, tp in self._generics:
                    if not tp:
                        return False
                return True
            case Datatype.Variants.Struct:
                for vsym in self.structSymbolTable().getFiltered(VariableSymbol):
                    vsymbol: VariableSymbol = vsym
                    if not vsymbol.type.areAllGenericsResolved():
                        return False
                for name, tp in self._generics:
                    if not tp:
                        return False
                return True
        raise InternalError("Invalid variant " + str(self.variant))

    def isGeneric(self):
        match self._variant:
            case Datatype.Variants.Primitive:
                return False

            case Datatype.Variants.GenericPlaceholder:
                return True

            case Datatype.Variants.ResolutionDeferred:
                return False

            case Datatype.Variants.Pointer:
                return self._pointee and self._pointee.isGeneric()

            case Datatype.Variants.Function:
                if self._functionReturnType and self._functionReturnType.isGeneric():
                    return True
                for name, type in self._functionParameters:
                    if type.isGeneric():
                        return True
                return len(self._generics) > 0

            case Datatype.Variants.Struct:
                from Symbol import VariableSymbol

                for vsym in self.structSymbolTable().getFiltered(VariableSymbol):
                    vsymbol: VariableSymbol = vsym
                    if vsymbol.type.isGeneric():
                        return True
                return len(self._generics) > 0

        raise InternalError("Invalid variant " + str(self.variant))

    def containsUnknown(self):
        match self._variant:
            case Datatype.Variants.Primitive:
                return self.isUnknown()
            case Datatype.Variants.Function:
                if self._functionReturnType is None:
                    raise InternalError("bullshit happening")
                if self._functionReturnType.isUnknown():
                    return True
                for name, type in self._functionParameters:
                    if type.isUnknown():
                        return True
                return False
        raise InternalError("Invalid variant: " + str(self._variant))

    def generateDefinitionCCode(self):
        match self._variant:
            case Datatype.Variants.Primitive:
                return ""

            case Datatype.Variants.Struct:
                from Symbol import VariableSymbol

                out = f"typedef struct __{self.generateUsageCode()}__ {{\n"
                for memberSymbol in self.structSymbolTable().symbols:
                    if isinstance(memberSymbol, VariableSymbol):
                        out += f"    {memberSymbol.type.generateUsageCode()
                                      } {memberSymbol.name};\n"
                out += f"}} {self.generateUsageCode()};\n"
                return out

            case Datatype.Variants.Function:
                if self._functionParameters is None or self._functionReturnType is None:
                    raise InternalError(
                        "Function is missing functionReturnType or functionParameters"
                    )
                params: List[str] = []
                for name, tp in self._functionParameters:
                    params += f"{tp.generateUsageCode()}"
                return f"typedef {self._functionReturnType.generateUsageCode()} (*{self.generateUsageCode()})({", ".join(params)});\n"
        raise InternalError("Invalid variant: " + str(self._variant))

    def generateUsageCode(self):
        match self._variant:
            case Datatype.Variants.Primitive:
                match self._primitiveVariant:
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
                if self._pointee is None:
                    raise InternalError("bullshit happening")
                return f"{self._pointee.generateUsageCode()}*"
            case Datatype.Variants.ResolutionDeferred:
                raise InternalError("Cannot generate usage code for deferred")
            case Datatype.Variants.Struct:
                return "_H" + self.getMangledName()
            case Datatype.Variants.Function:
                return "_H" + self.getMangledName()
        raise InternalError("Invalid variant: " + str(self._variant))


def isSame(a: Datatype, b: Datatype):
    if a.isPrimitive() and b.isPrimitive():
        return a._primitiveVariant == b._primitiveVariant

    if a.isPointer() and b.isPointer():
        if a._pointee is None or b._pointee is None:
            return False
        return isSame(a._pointee, b._pointee)

    if a.isFunction() and b.isFunction():
        if not a._functionReturnType or not b._functionReturnType:
            return False
        if not isSame(a._functionReturnType, b._functionReturnType):
            return False
        if len(a._functionParameters) != len(b._functionParameters):
            return False
        for i in range(len(a._functionParameters)):
            if not isSame(a._functionParameters[i][1], b._functionParameters[i][1]):
                return False
        return True

    if a.isStruct() and b.isStruct():
        from Symbol import VariableSymbol

        aMembers = a.structSymbolTable().getFiltered(VariableSymbol)
        bMembers = b.structSymbolTable().getFiltered(VariableSymbol)
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
        if _from._functionReturnType is None or to._functionReturnType is None:
            raise InternalError("bullshit happening")
        if isSame(_from._functionReturnType, to._functionReturnType):
            if len(_from._functionParameters) == len(to._functionParameters):
                equal = True
                for i in range(len(_from._functionParameters)):
                    if not isSame(
                        _from._functionParameters[i][1], to._functionParameters[i][1]
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
