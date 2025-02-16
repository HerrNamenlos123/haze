from typing import List, Tuple
from Symbol import Symbol, DatatypeSymbol
from Location import Location
from Datatype import Datatype
from Scope import Scope
from Error import InternalError, getCallerLocation
from grammar import HazeParser
from SymbolName import SymbolName


class CompilationUnit:
    def __init__(self, filename: str, language: str, flags: List[str]):
        self.filename = filename
        self.lang = language
        self.flags = flags


class ExternFunctionRef:
    def __init__(self, lang: str, location: Location, symbol: Symbol):
        self.lang = lang
        self.location = location
        self.symbol = symbol


class ObjAttribute:
    def __init__(
        self,
        name: str,
        declaredType: Datatype,
        receivedType: Datatype,
        expr: HazeParser.ParserRuleContext,
    ):
        self.name = name
        self.declaredType = declaredType
        self.receivedType = receivedType
        self.expr = expr


# class NodeData:
#   DECLARE_NODE_PROPERTY(Datatype, Ptr<Datatype>);
#   DECLARE_NODE_PROPERTY(Externlang, Str);
#   DECLARE_NODE_PROPERTY(CompilationHintFilename, Str);
#   DECLARE_NODE_PROPERTY(Scope, Ptr<Scope>);
#   DECLARE_NODE_PROPERTY(BinaryOperator, Str);
#   DECLARE_NODE_PROPERTY(LlvmValue, llvm::Value*);
#   DECLARE_NODE_PROPERTY(LlvmValuePtr, llvm::Value*);
#   DECLARE_NODE_PROPERTY(ThisPointer, llvm::Value*)
#   DECLARE_NODE_PROPERTY(Symbol, Ptr<Symbol>);
#   // DECLARE_NODE_PROPERTY(FunctionParameters, List<Ptr<Datatype>>)
#   DECLARE_NODE_PROPERTY(Argtypes, List<Ptr<Datatype>>)
#   // DECLARE_NODE_PROPERTY(StructField, Ptr<Symbol>)
#   // DECLARE_NODE_PROPERTY(StructMemberFunction, Ptr<Symbol>)
#   DECLARE_NODE_PROPERTY(DatatypeAsValue, Ptr<Datatype>)
#   DECLARE_NODE_PROPERTY(ObjectAttribute, ObjAttribute)
#   DECLARE_NODE_PROPERTY(ObjectAttributes, List<ObjAttribute>)
#   DECLARE_NODE_PROPERTY(MemberAccessFieldIndex, int64_t)
#   DECLARE_NODE_PROPERTY(MemberAccessFunctionSymbol, Ptr<Symbol>)
# };


class CompilationDatabase:
    anonymousFunctionCounter = 0
    anonymousStructCounter = 0
    anonymoussCounter = 0
    globalVariableCounter = 0

    def __init__(self):
        self.topLevelLocation = Location("global", 0, 0)
        self.globalScope = Scope(self.topLevelLocation, None)
        self.scopeStack: List[Scope] = []
        self.extraCompilationUnits: List[Tuple[str, str, List[str]]] = []
        self.externFunctionRefs = []
        self.externalLinkerFlags = []
        self.__defineBuiltinTypes()

    def pushScope(self, scope: Scope):
        self.scopeStack.append(scope)
        return scope

    def popScope(self):
        if len(self.scopeStack) == 0:
            raise InternalError("Cannot pop global scope", getCallerLocation())
        self.scopeStack.pop()

    def getCurrentScope(self):
        if len(self.scopeStack) == 0:
            return self.globalScope
        return self.scopeStack[-1]

    def getGlobalScope(self):
        return self.globalScope

    def getBuiltinDatatype(self, name: str, loc: Location = Location("global", 0, 0)):
        return self.getGlobalScope().lookupSymbol(name, loc).type

    def defineExternalCompilationUnit(self, filename: str, lang: str, flags: List[str]):
        self.extraCompilationUnits.append((filename, lang, flags))

    def defineExternFunctionRef(self, lang: str, location: Location, symbol: Symbol):
        self.externFunctionRefs.append({lang, location, symbol})

    def addExternalLinkerFlags(self, flags: List[str]):
        for flag in flags:
            self.externalLinkerFlags.append(flag)

    def getExternalLinkerFlags(self):
        return self.externalLinkerFlags

    def getExternFunctionRefs(self):
        return self.externFunctionRefs

    def getExternalCompilationUnits(self):
        return self.extraCompilationUnits

    def makeAnonymousFunctionName(self):
        self.anonymousFunctionCounter += 1
        return f"__anonym_func_{self.anonymousFunctionCounter}"

    def makeGlobalVariableName(self):
        self.globalVariableCounter += 1
        return f"__global_var_{self.globalVariableCounter}"

    def makeAnonymousStructName(self):
        self.anonymousStructCounter += 1
        return f"__anonym_struct_{self.anonymousStructCounter}"

    def __defineBuiltinTypes(self):
        def define(name: str, type: Datatype.PrimitiveVariants):
            self.globalScope.defineSymbol(
                DatatypeSymbol(
                    name,
                    None,
                    Datatype.createPrimitiveType(type),
                ),
                self.topLevelLocation,
            )

        define("none", Datatype.PrimitiveVariants.none)
        define("unknown", Datatype.PrimitiveVariants.unknown)
        define("stringview", Datatype.PrimitiveVariants.stringview)
        define("boolean", Datatype.PrimitiveVariants.boolean)
        define("booleanptr", Datatype.PrimitiveVariants.booleanptr)
        define("u8", Datatype.PrimitiveVariants.u8)
        define("u16", Datatype.PrimitiveVariants.u16)
        define("u32", Datatype.PrimitiveVariants.u32)
        define("u64", Datatype.PrimitiveVariants.u64)
        define("i8", Datatype.PrimitiveVariants.i8)
        define("i16", Datatype.PrimitiveVariants.i16)
        define("i32", Datatype.PrimitiveVariants.i32)
        define("i64", Datatype.PrimitiveVariants.i64)
