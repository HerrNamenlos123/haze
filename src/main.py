from enum import Enum

ValidIdentifierStartChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_"
ValidIdentifierChars = ValidIdentifierStartChars + "0123456789"
ValidNumberChars = "0123456789"
WhitespaceChars = " \n\r\t"
PunctuationChars = "{}[]()<>.:;-,"

class TokenType(Enum):
    Identifier = 1
    StringLiteral = 2
    Number = 3
    Punctuation = 4

class Token:
    def __init__(self, text, type):
        self.text = text
        self.type = type
    def __str__(self):
        return f"'{self.text}'"
    def __repr__(self):
        return f"'{self.text}'"

def tokenize(file: str):
    tokens: List[Token] = []

    token = None

    for c in file:
        if not token:
            if c in ValidIdentifierStartChars:
                token = Token(c, TokenType.Identifier)
            elif c in WhitespaceChars:
                pass
            elif c == "\"":
                token = Token(c, TokenType.StringLiteral)
            elif c in PunctuationChars:
                tokens.append(Token(c, TokenType.Punctuation))
            elif c in ValidNumberChars:
                token = Token(c, TokenType.Number)
            else:
                raise Exception(f"Unexpected token in string literal: '{c}' ({ord(c)})")
        elif token.type is TokenType.Number:
            if c in ValidNumberChars or c == ".":
                token.text += c
            elif c in WhitespaceChars:
                tokens.append(token)
                token = None
            elif c in PunctuationChars:
                tokens.append(token)
                tokens.append(Token(c, TokenType.Punctuation))
                token = None
            else:
                raise Exception(f"Unexpected token in number: '{c}' ({ord(c)})")
        elif token.type is TokenType.Identifier:
            if c in ValidIdentifierChars:
                token.text += c
            elif c in WhitespaceChars:
                tokens.append(token)
                token = None
            elif c == "\"":
                tokens.append(token)
                token = Token("\"" + c, TokenType.StringLiteral)
            elif c in PunctuationChars:
                tokens.append(token)
                tokens.append(Token(c, TokenType.Punctuation))
                token = None
            else:
                raise Exception(f"Unexpected token in identifier: '{c}' ({ord(c)})")
        elif token.type is TokenType.StringLiteral:
            if c == "\"":
                token.text += "\""
                tokens.append(token)
                token = None
            else:
                token.text += c
        else:
            raise Exception(f"Internal Error: Invalid tokenizer state")

    if token:
        tokens.append(token)

    print("Tokens: ")
    print(tokens)

def main():
    with open("example.hz") as f:
        file = f.read()
        tokenize(file)

if __name__ == "__main__":
    main()
