from enum import Enum
from typing import List, Tuple
from Error import InternalError


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
    string = (13,)
    stringview = (14,)


class Datatype:
    def __init__(self):
        pass

    def getDisplayName(self):
        pass

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


class PrimitiveDatatype(Datatype):
    def __init__(self, type: PrimitiveType):
        self.type = type

    def getDisplayName(self):
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


class FunctionDatatype(Datatype):
    def __init__(self, parameters: List[Tuple[str, Datatype]], returnType: Datatype):
        self.parameters = parameters
        self.returnType = returnType

    def getDisplayName(self):
        params = ""
        for name, type in self.parameters:
            params += type.getDisplayName() + ", "
        if params != "":
            params = params[:-2]
        return f"({params}) -> {self.returntype.getDisplayName()}"

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


class PointerDatatype(Datatype):
    def __init__(self, pointee: Datatype):
        self.pointee = pointee

    def getDisplayName(self):
        return f"Ptr<{self.pointee.getDisplayName()}>"

    def getPointee(self):
        return self.pointee


class StructDatatype(Datatype):
    def __init__(self, name: str):
        self.name = name
        from SymbolTable import SymbolTable

        self.memberSymbols = SymbolTable()

    def getName(self):
        return self.name

    def getDisplayName(self):
        if self.name.starts_with("__anonym_"):
            val = "struct {"
            for name, symbol in self.memberSymbols.getAllSymbols():
                val += f"{name}: {symbol.getType().getDisplayName()}, "
            if not self.memberSymbols.getAllSymbols().empty():
                val = val[:-2]
            val += " }"
            return val
        else:
            return self.name

    def addMember(self, symbol):
        self.memberSymbols.insert(symbol)

    def getMembers(self):
        return self.memberSymbols.getAllSymbols()

    def getMember(self, name: str):
        return self.memberSymbols.get(name)

    def getMemberFuncsOnly(self) -> List[any]:
        return self.memberSymbols.getMemberFuncsOnly()

    def getFieldsOnly(self) -> List[any]:
        return self.memberSymbols.getFieldsOnly()


def isSame(a: Datatype, b: Datatype):
    if isinstance(a, PrimitiveDatatype) and isinstance(b, PrimitiveDatatype):
        return a.getTypeEnum() == b.getTypeEnum()

    if isinstance(a, PointerDatatype) and isinstance(b, PointerDatatype):
        return Datatype.isSame(a.getPointee(), b.getPointee())

    if isinstance(a, FunctionDatatype) and isinstance(b, FunctionDatatype):
        if not Datatype.isSame(a.getReturnType(), b.getReturnType()):
            return False

        if a.numParameters() != b.numParameters():
            return False

        for i in range(a.numParameters()):
            if not Datatype.isSame(a.getParameters()[i][1], b.getParameters()[i][1]):
                return False

        return True

    if isinstance(a, StructDatatype) and isinstance(b, StructDatatype):
        aMembers = a.getFieldsOnly()
        bMembers = b.getFieldsOnly()
        if aMembers.size() != bMembers.size():
            return False

        for i in range(len(aMembers)):
            if aMembers[i].getName() != bMembers[i].getName():
                return False

            if not Datatype.isSame(aMembers[i].getType(), bMembers[i].getType()):
                return False
        return True
    return False


Datatype.isSame = isSame


def isImplicitlyConvertibleTo(a: Datatype, b: Datatype):
    if Datatype.isSame(a, b):
        return True

    if isinstance(a, PrimitiveDatatype) and isinstance(b, PrimitiveDatatype):
        if a.isInteger() and b.isInteger():
            return True
        return False

    if isinstance(a, PointerDatatype) and isinstance(b, PointerDatatype):
        return isImplicitlyConvertibleTo(a.getPointee(), b.getPointee())

    if isinstance(a, FunctionDatatype) and isinstance(b, FunctionDatatype):
        if not isImplicitlyConvertibleTo(a.getReturnType(), b.getReturnType()):
            return False
        if a.numParameters() != b.numParameters():
            return False
        for i in range(a.numParameters()):
            if not isImplicitlyConvertibleTo(
                a.getParameters()[i][1], b.getParameters()[i][1]
            ):
                return False
        return True

    if isinstance(a, StructDatatype) and isinstance(b, StructDatatype):
        aMembers = a.getMembers()
        bMembers = b.getMembers()
        for name, symbol in aMembers:
            if not bMembers.contains(name):
                return False
            if aMembers.at(name).getName() != bMembers.at(name).getName():
                return False

            if not Datatype.isSame(
                aMembers.at(name).getType(), bMembers.at(name).getType()
            ):
                return False

        for name, symbol in bMembers:
            if not aMembers.contains(name):
                return False

            if aMembers.at(name).getName() != bMembers.at(name).getName():
                return False

            if not Datatype.isSame(
                aMembers.at(name).getType(), bMembers.at(name).getType()
            ):
                return False
        return True
    return False


Datatype.isImplicitlyConvertibleTo = isImplicitlyConvertibleTo


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
        case PrimitiveType.string:
            return "string"
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
