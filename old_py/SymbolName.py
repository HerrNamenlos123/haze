from typing import List, Optional
from Error import InternalError, getCallerLocation


class SymbolName:
    def __init__(self, name: str, namespaces: Optional[List[str]] = None):
        self.namespaces = namespaces or []
        self.name = name
        if isinstance(name, SymbolName):
            raise InternalError(
                "SymbolName cannot be initialized with another SymbolName",
                getCallerLocation(),
            )

    def toArray(self):
        return self.namespaces + [self.name]

    def __str__(self):
        return ".".join(self.toArray())

    def __repr__(self):
        return self.__str__()

    def __eq__(self, other):
        if not isinstance(other, SymbolName):
            other = SymbolName(other)
        if self.namespaces != other.namespaces:
            return False
        if self.name != other.name:
            return False
        return True

    def __hash__(self):
        return hash(str(self))
