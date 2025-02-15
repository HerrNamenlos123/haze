from enum import Enum
from Location import Location
from colorama import Fore
from typing import Optional
import inspect


class ErrorType(Enum):
    Error = (1,)
    Warning = (2,)


def formatCompilerMessage(loc: Location, type: ErrorType, error: str, msg: str) -> str:
    return f"[{loc.filename}:{loc.line}:{loc.column}]: {Fore.RED if type == ErrorType.Error else Fore.YELLOW}{error}{Fore.RESET}: {msg}"


def printCompilerMessage(loc: Location, type: ErrorType, error: str, msg: str):
    print(formatCompilerMessage(loc, type, error, msg))


def formatErrorMessage(loc: Location, msg: str) -> str:
    return formatCompilerMessage(loc, ErrorType.Error, "Error", msg)


def printErrorMessage(loc: Location, msg: str):
    printCompilerMessage(loc, ErrorType.Error, "Error", msg)


def formatWarningMessage(loc: Location, msg: str) -> str:
    return formatCompilerMessage(loc, ErrorType.Warning, "Warning", msg)


def printWarningMessage(loc: Location, msg: str):
    printCompilerMessage(loc, ErrorType.Warning, "Warning", msg)


def getCallerLocation(depth=1):
    frame = inspect.currentframe()
    if frame is None:
        return Location("Unknown", 0, 0)
    for i in range(depth + 1):
        if frame.f_back:
            frame = frame.f_back
    return Location(frame.f_code.co_filename, frame.f_lineno, 0)


class CompilerError(Exception):
    def __init__(self, msg: str, loc: Location):
        super().__init__(formatErrorMessage(loc, msg))


class InternalError(Exception):
    def __init__(self, msg: str, loc: Optional[Location] = None):
        super().__init__(
            formatErrorMessage(getCallerLocation() if not loc else loc, msg)
        )


class ImpossibleSituation(Exception):
    def __init__(self):
        super().__init__(
            formatErrorMessage(
                getCallerLocation(),
                "Impossible situation, something fatal has happened",
            )
        )


class UnreachableCode(Exception):
    pass
