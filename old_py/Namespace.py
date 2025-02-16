class Namespace:
    def __init__(self, name: str, parent: "Namespace" = None):
        self.name = name
        self.parent = parent
