class Location:
    def __init__(self, filename: str, line: int, column: int):
        self.filename = filename
        self.line = line
        self.column = column

    def __str__(self):
        return f"{self.filename}:{self.line}:{self.column}"

    def __repr__(self):
        return self.__str__()
