from enum import Enum
from typing import List, Tuple, Dict
from Error import InternalError, UnreachableCode, CompilerError, getCallerLocation
from Location import Location
import copy


class PrimitiveType(Enum):
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


class Datatype:
    def __init__(self):
        self.genericsList: List[str] = []
        self.genericsDict: Dict[str, "Datatype"] = {}
        pass

    def getDisplayName(self):
        pass

    def getMangledName(self):
        raise InternalError("Not implemented")

    def isPrimitive(self):
        return False

    def isFunction(self):
        return False

    def isInteger(self):
        return False

    def isBoolean(self):
        return False

    def isCallable(self):
        return False

    def isNone(self):
        return False

    def isUnknown(self):
        return False

    def getCCode(self):
        raise InternalError("Not implemented")

    def instantiate(self, generics: Dict[str, "Datatype"]):
        raise InternalError("Not implemented", getCallerLocation())

    def __str__(self):
        return self.getDisplayName()

    def __repr__(self):
        return self.getDisplayName()


class GenericPlaceholder(Datatype):
    def __init__(self, name: str):
        super().__init__()
        self.name = name

    def getDisplayName(self):
        return self.name

    def instantiate(self, generics: Dict[str, "Datatype"]):
        if self.name in generics:
            return generics[self.name]
        else:
            return self


class PrimitiveDatatype(Datatype):
    def __init__(self, type: PrimitiveType):
        super().__init__()
        self.type = type

    def getDisplayName(self):
        return Datatype.primitiveTypeToString(self.type)

    def getMangledName(self):
        return Datatype.primitiveTypeToString(self.type)

    def getTypeEnum(self) -> PrimitiveType:
        return self.type

    def isPrimitive(self):
        return True

    def isInteger(self):
        match self.type:
            case PrimitiveType.i8:
                return True
            case PrimitiveType.i16:
                return True
            case PrimitiveType.i32:
                return True
            case PrimitiveType.i64:
                return True
            case PrimitiveType.u8:
                return True
            case PrimitiveType.u16:
                return True
            case PrimitiveType.u32:
                return True
            case PrimitiveType.u64:
                return True
        return False

    def isNone(self):
        return self.type == PrimitiveType.none

    def isUnknown(self):
        return self.type == PrimitiveType.unknown

    def isBoolean(self):
        return self.type == PrimitiveType.boolean

    def isUnsignedInteger(self):
        match self.type:
            case PrimitiveType.u8:
                return True
            case PrimitiveType.u16:
                return True
            case PrimitiveType.u32:
                return True
            case PrimitiveType.u64:
                return True
        return False

    def getIntegerBits(self):
        match self.type:
            case PrimitiveType.i8:
                return 8
            case PrimitiveType.i16:
                return 16
            case PrimitiveType.i32:
                return 32
            case PrimitiveType.i64:
                return 64
            case PrimitiveType.u8:
                return 8
            case PrimitiveType.u16:
                return 16
            case PrimitiveType.u32:
                return 32
            case PrimitiveType.u64:
                return 64
        raise InternalError("Cannot take integer bits of non-integer")

    def getCCode(self):
        match self.type:
            case PrimitiveType.none:
                return "void"
            case PrimitiveType.unknown:
                raise InternalError(
                    "Type 'unknown' is compiler internal and must not appear in generated C-code"
                )
            case PrimitiveType.boolean:
                return "bool"
            case PrimitiveType.booleanptr:
                return "bool*"
            case PrimitiveType.i8:
                return "int8_t"
            case PrimitiveType.i16:
                return "int16_t"
            case PrimitiveType.i32:
                return "int32_t"
            case PrimitiveType.i64:
                return "int64_t"
            case PrimitiveType.u8:
                return "uint8_t"
            case PrimitiveType.u16:
                return "uint16_t"
            case PrimitiveType.u32:
                return "uint32_t"
            case PrimitiveType.u64:
                return "uint64_t"
            case PrimitiveType.stringview:
                return "char*"
        raise UnreachableCode()

    def instantiate(self, generics: Dict[str, "Datatype"]):
        return self


class FunctionDatatype(Datatype):
    def __init__(self, parameters: List[Tuple[str, Datatype]], returnType: Datatype):
        super().__init__()
        self.parameters = parameters
        self.returnType = returnType

    def getDisplayName(self):
        params = ""
        for name, type in self.parameters:
            params += type.getDisplayName() + ", "
        if params != "":
            params = params[:-2]
        return f"({params}) -> {self.returnType.getDisplayName()}"

    def getMangledName(self):
        from Symbol import FunctionType

        if self.functionType == FunctionType.External_C:
            return self.name
        mangled = "_H"
        if self.parentNamespace is not None:
            mangled += "N"
            pns = self.parentNamespace
            while pns is not None:
                mangled += str(len(pns.name))
                mangled += pns.name
                pns = pns.parent
        mangled += str(len(self.name))
        mangled += self.name
        if self.parentNamespace is not None:
            mangled += "E"
        return mangled

    def getParameters(self) -> List[Tuple[str, Datatype]]:
        return self.parameters

    def isFunction(self):
        return True

    def isCallable(self):
        return True

    def containsUnknown(self):
        if self.returnType.isUnknown():
            return True

        for name, type in self.parameters:
            if type.isUnknown():
                return True
        return False

    def getReturnType(self):
        return self.returnType

    def insertParameter(self, index: int, name: str, type: Datatype):
        self.parameters.insert(index, (name, type))

    def getCCode(self):
        raise InternalError("Not implemented")

    def instantiate(self, generics: Dict[str, "Datatype"]):
        n = copy.deepcopy(self)
        for i in range(len(n.parameters)):
            n.parameters[i] = (
                n.parameters[i][0],
                n.parameters[i][1].instantiate(generics),
            )
        return n


class PointerDatatype(Datatype):
    def __init__(self, pointee: Datatype):
        super().__init__()
        self.pointee = pointee

    def getDisplayName(self):
        return f"Ptr<{self.pointee.getDisplayName()}>"

    def getPointee(self):
        return self.pointee

    def getCCode(self):
        return f"{self.pointee.getCCode()}*"

    def instantiate(self, generics: Dict[str, "Datatype"]):
        return PointerDatatype(self.pointee.instantiate(generics))


class StructDatatype(Datatype):
    def __init__(self, name: str):
        super().__init__()
        self.name = name
        from SymbolTable import SymbolTable

        self.memberSymbols = SymbolTable()

    def getName(self):
        return self.name

    def getDisplayName(self):
        if self.name.startswith("__anonym_"):
            val = "struct {"
            for name, symbol in self.memberSymbols.getAllSymbols().items():
                val += f"{name}: {symbol.getType().getDisplayName()}, "
            if len(self.memberSymbols.getAllSymbols().keys()) > 0:
                val = val[:-2]
            val += " }"
            return val
        else:
            return self.name

    def getMangledName(self):
        mangled = "_H"
        mangled += str(len(self.name))
        mangled += self.name
        if len(self.genericsDict.keys()) > 0:
            mangled += "I"
            for name, type in self.genericsDict.items():
                mangled += type.getMangledName()
            mangled += "E"
        return mangled

    def addMember(self, symbol):
        self.memberSymbols.insert(symbol)

    def getMembers(self):
        return self.memberSymbols.getAllSymbols()

    def getMember(self, name: str):
        return self.memberSymbols.get(name)

    def getMemberFuncsOnly(self) -> List[any]:
        from Symbol import FunctionSymbol

        funcs = []
        for symbol in self.memberSymbols.getAllSymbols().values():
            if isinstance(symbol, FunctionSymbol):
                funcs.append(symbol)
        return funcs

    def getFieldsOnly(self) -> List[any]:
        from Symbol import VariableSymbol

        funcs = []
        for symbol in self.memberSymbols.getAllSymbols().values():
            if isinstance(symbol, VariableSymbol):
                funcs.append(symbol)
        return funcs

    def getCCode(self):
        return self.getMangledName()

    def instantiate(self, generics: Dict[str, "Datatype"]):
        from Symbol import VariableSymbol, FunctionSymbol

        n = copy.deepcopy(self)
        for name in n.memberSymbols.getAllSymbols().keys():
            n.memberSymbols.getAllSymbols()[name].type = (
                n.memberSymbols.getAllSymbols()[name].getType().instantiate(generics)
            )
        return n

    def generateDefinitionCCode(self):
        from Symbol import VariableSymbol

        out = f"typedef struct __{self.getCCode()}__ {{\n"
        for memberSymbol in self.getMembers().values():
            if isinstance(memberSymbol, VariableSymbol):
                out += f"    {memberSymbol.getType().getCCode()} {memberSymbol.getName()};\n"

        out += f"}} {self.getCCode()};\n"
        return out


def isSame(a: Datatype, b: Datatype):
    if isinstance(a, PrimitiveDatatype) and isinstance(b, PrimitiveDatatype):
        return a.getTypeEnum() == b.getTypeEnum()

    if isinstance(a, PointerDatatype) and isinstance(b, PointerDatatype):
        return Datatype.isSame(a.getPointee(), b.getPointee())

    if isinstance(a, FunctionDatatype) and isinstance(b, FunctionDatatype):
        if not Datatype.isSame(a.getReturnType(), b.getReturnType()):
            return False

        if len(a.getParameters()) != len(b.getParameters()):
            return False

        for i in range(len(a.getParameters())):
            if not Datatype.isSame(a.getParameters()[i][1], b.getParameters()[i][1]):
                return False

        return True

    if isinstance(a, StructDatatype) and isinstance(b, StructDatatype):
        aMembers = a.getFieldsOnly()
        bMembers = b.getFieldsOnly()
        if len(aMembers) != len(bMembers):
            return False

        for i in range(len(aMembers)):
            if aMembers[i].getName() != bMembers[i].getName():
                return False

            if not Datatype.isSame(aMembers[i].getType(), bMembers[i].getType()):
                return False
        return True
    return False


Datatype.isSame = isSame


def implicitConversion(_from: Datatype, to: Datatype, expr: str, loc: Location) -> str:
    if Datatype.isSame(_from, to):
        return expr

    if isinstance(_from, PrimitiveDatatype) and isinstance(to, PrimitiveDatatype):
        if _from.isInteger() and to.isInteger():
            return f"({to.getCCode()})({expr})"
        raise InternalError(
            f"No implicit conversion from {_from.getDisplayName()} to {to.getDisplayName()}"
        )

    if isinstance(_from, PointerDatatype) and isinstance(to, PointerDatatype):
        raise CompilerError(
            "Pointer types are not convertible. Polymorphism is not implemented yet",
            loc,
        )

    if isinstance(_from, FunctionDatatype) and isinstance(to, FunctionDatatype):
        if Datatype.isSame(_from.getReturnType(), to.getReturnType()):
            if len(_from.getParameters()) == len(to.getParameters()):
                equal = True
                for i in range(len(_from.getParameters())):
                    if not Datatype.isSame(
                        _from.getParameters()[i][1], to.getParameters()[i][1]
                    ):
                        equal = False
                if equal:
                    return expr
        raise CompilerError(
            f"No implicit conversion from '{_from.getDisplayName()}' to '{to.getDisplayName()}'",
            loc,
        )

    if isinstance(_from, StructDatatype) and isinstance(to, StructDatatype):
        equal = True
        aMembers = _from.getMembers()
        bMembers = to.getMembers()
        for name in aMembers.keys():
            if not name in bMembers:
                equal = False
            if aMembers[name].getName() != bMembers[name].getName():
                equal = False

            if not Datatype.isSame(aMembers[name].getType(), bMembers[name].getType()):
                equal = False

        for name in bMembers.keys():
            if not name in aMembers:
                equal = False

            if aMembers[name].getName() != bMembers[name].getName():
                equal = False

            if not Datatype.isSame(aMembers[name].getType(), bMembers[name].getType()):
                equal = False

        if equal:
            return expr

    raise CompilerError(
        f"No implicit conversion from '{_from.getDisplayName()}' to '{to.getDisplayName()}'",
        loc,
    )


def primitiveTypeToString(type: PrimitiveType) -> str:
    match type:
        case PrimitiveType.none:
            return "none"
        case PrimitiveType.unknown:
            return "unknown"
        case PrimitiveType.boolean:
            return "boolean"
        case PrimitiveType.booleanptr:
            return "booleanptr"
        case PrimitiveType.i8:
            return "i8"
        case PrimitiveType.i16:
            return "i16"
        case PrimitiveType.i32:
            return "i32"
        case PrimitiveType.i64:
            return "i64"
        case PrimitiveType.u8:
            return "u8"
        case PrimitiveType.u16:
            return "u16"
        case PrimitiveType.u32:
            return "u32"
        case PrimitiveType.u64:
            return "u64"
        case PrimitiveType.stringview:
            return "stringview"
    raise InternalError("Datatype has no string representation")


Datatype.primitiveTypeToString = primitiveTypeToString

# llvm::Value* convertValueImplicit(Location loc,
#                                   Ptr<Datatype> from,
#                                   Ptr<Datatype> to,
#                                   llvm::Value* value,
#                                   llvm::IRBuilder<>& builder,
#                                   Location sourceloc = SourceLoc::current());


# llvm::Value* convertValueImplicit(Location loc,
#                                   Ptr<Datatype> from,
#                                   Ptr<Datatype> to,
#                                   llvm::Value* value,
#                                   llvm::IRBuilder<>& builder,
#                                   Location sourceloc)
# {
#   if (Datatype::isSame(from, to)) {
#     return value;
#   }
#
#   if (!Datatype::isImplicitlyConvertibleTo(from, to)) {
#     throw SemanticError(
#         loc, std::format("Cannot implicitly convert type {} to {}", from->getDisplayName(), to->getDisplayName()));
#   }
#
#   auto fromStruct = std::dynamic_pointer_cast<StructDatatype>(from);
#   auto toStruct = std::dynamic_pointer_cast<StructDatatype>(to);
#   if (fromStruct && toStruct) {
#     throw InternalError("Conversion of structs is not implemented yet!", sourceloc);
#   }
#
#   if (!from->isInteger() || !to->isInteger()) {
#     throw SemanticError(
#         loc, std::format("Cannot implicitly convert type {} to {}", from->getDisplayName(), to->getDisplayName()));
#   }
#
#   auto fromInt = dynamic_cast<const PrimitiveDatatype*>(from.get());
#   auto toInt = dynamic_cast<const PrimitiveDatatype*>(to.get());
#
#   bool isFromUnsigned = fromInt->isUnsignedInteger();
#   bool isToUnsigned = toInt->isUnsignedInteger();
#   int fromBits = fromInt->getIntegerBits();
#   int toBits = toInt->getIntegerBits();
#
#   if (toBits > fromBits) {
#     if (!isToUnsigned && !isFromUnsigned) {
#       return builder.CreateSExt(value, to->getLLVMType());
#     }
#     else if (!isToUnsigned || !isFromUnsigned) {
#       printWarningMessage(
#           loc,
#           std::format("Conversion from {} to {} may cause unexpected behavior due to different signedness",
#                       from->getDisplayName(),
#                       to->getDisplayName()));
#       return builder.CreateSExt(value, to->getLLVMType());
#     }
#     else {
#       return builder.CreateZExt(value, to->getLLVMType());
#     }
#   }
#   else if (toBits < fromBits) {
#     printWarningMessage(loc,
#                         std::format("Conversion from {} to {} may cause unexpected overflows",
#                                     from->getDisplayName(),
#                                     to->getDisplayName()));
#     if (isFromUnsigned != isToUnsigned) {
#       printWarningMessage(
#           loc,
#           std::format("Conversion from {} to {} may cause unexpected behavior due to different signedness",
#                       from->getDisplayName(),
#                       to->getDisplayName()));
#     }
#     return builder.CreateTrunc(value, to->getLLVMType());
#   }
#   else {
#     if (isFromUnsigned != isToUnsigned) {
#       printWarningMessage(
#           loc,
#           std::format("Conversion from {} to {} may cause unexpected behavior due to different signedness",
#                       from->getDisplayName(),
#                       to->getDisplayName()));
#     }
#     return value;
#   }
# }
