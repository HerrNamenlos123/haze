from graphviz import Digraph


class Symbol:
    def __init__(self, name, symbol_type):
        self.name = name
        self.symbol_type = symbol_type

    def __repr__(self):
        return f"{self.name}: {self.symbol_type}"


class SymbolTable:
    def __init__(self):
        self.symbols = {}

    def define(self, name, symbol_type):
        self.symbols[name] = Symbol(name, symbol_type)


# Example Usage
table = SymbolTable()
table.define("MyStruct", "struct")
table.define("foo", "function(MyStruct) -> MyStruct")


def visualize_symbol_table(symbol_table):
    dot = Digraph()

    for name, symbol in symbol_table.symbols.items():
        dot.node(name, label=f"{name}\n{symbol.symbol_type}")

        # If the type references another symbol, draw an edge
        if "->" in symbol.symbol_type:
            ret_type = symbol.symbol_type.split("->")[-1].strip()
            if ret_type in symbol_table.symbols:
                dot.edge(name, ret_type)

    dot.render("symbol_table", format="png", view=True)


visualize_symbol_table(table)
