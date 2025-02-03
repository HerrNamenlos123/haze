from enum import Enum
import re

class Token:
    def __init__(self, text, type):
        self.text = text
        self.type = type
    def __str__(self):
        return f"'{self.text}'"
    def __repr__(self):
        return f"'{self.text}'"

def tokenize(file: str, matchers):
  tokens: List[Token] = []
  
  while len(file) > 0:
    matched = False
    for matcher in matchers:
      match = re.match(matcher["matcher"], file)
      if match:
        span = match.span()
        if span == (-1,-1) or span[0] != 0:
          raise Exception(f"token match has invalid span at '{file[:10]}'")
        
        text = file[0:span[1]]
        file = file[span[1]:]
        matched = True

        if matcher["type"] is None:
          break # ignore whitespace
  
        if "valueExtractor" in matcher:
          text = matcher["valueExtractor"](text)

        tokens.append(Token(text, matcher["type"]))
        # print(f"Matched token '{text}'")
        break
    
    if not matched:
      raise Exception(f"Unexpected token at '{file[:10]}'")

def main():
  with open("example.hz") as f:
    file = f.read()
    # tokenize(file)
    matchers = [
    # { "matcher": r"", "type": "", "valueExtractor": lambda },
      { "matcher": r"[ \r\n\t]+", "type": None },
    # { "matcher": r"\r?\n", "type": None },
      { "matcher": r"\/\/(.*?)(?=\r?\n|$)", "type": "comment", "valueExtractor": lambda s: s[2:] },
      { "matcher": r"import", "type": "import" },
    # { "matcher": r"\/\/(.*?)(?=\r?\n|$)", "type": "comment", "valueExtractor": lambda s: s[1:-2] },
      { "matcher": r"\"[^\"\r\n]+\"", "type": "string-literal", "valueExtractor": lambda s: s[1:-2] },
      { "matcher": r"'[^'\r\n]+'", "type": "string-literal", "valueExtractor": lambda s: s[1:-2] },
      { "matcher": r"-?[0-9]+\.?[0-9]*(?![a-zA-Z$_])", "type": "number-literal" },
      { "matcher": r"{", "type": "{" },
      { "matcher": r"}", "type": "}" },
      { "matcher": r"\[", "type": "[" },
      { "matcher": r"\]", "type": "]" },
      { "matcher": r"\(", "type": "(" },
      { "matcher": r"\)", "type": ")" },
      { "matcher": r";", "type": ";" },
      { "matcher": r":", "type": ":" },
      { "matcher": r",", "type": "," },
      { "matcher": r"\.\.\.", "type": "..." },
      { "matcher": r"\.", "type": "." },
      { "matcher": r"\*\*", "type": "**" },
      { "matcher": r"\*", "type": "*" },
      # { "matcher": r"===", "type": "===" },
      { "matcher": r"==", "type": "==" },
      { "matcher": r"=>", "type": "=>" },
      { "matcher": r"=", "type": "=" },
      # { "matcher": r"!==", "type": "!==" },
      { "matcher": r"!=", "type": "!=" },
      { "matcher": r"&&", "type": "&&" },
      { "matcher": r"&", "type": "&" },
      # { "matcher": r"\^", "type": "^" },
      # { "matcher": r"~", "type": "~" },
      { "matcher": r"!", "type": "!" },
      { "matcher": r"\|\|", "type": "||" },
      { "matcher": r"\|", "type": "|" },
      { "matcher": r"\+\+", "type": "++" },
      { "matcher": r"\+", "type": "+" },
      { "matcher": r"\-\-", "type": "--" },
      { "matcher": r"\-", "type": "-" },
      # { "matcher": r"\\", "type": "\\" },
      # { "matcher": r"%", "type": "%" },
      # { "matcher": r"\?\?", "type": "??" },
      # { "matcher": r"\?", "type": "?" },
      { "matcher": r">=", "type": ">=" },
      { "matcher": r"<=", "type": "<=" },
      # { "matcher": r">>", "type": ">>" },
      { "matcher": r">", "type": ">" },
      # { "matcher": r"<<", "type": "<<" },
      { "matcher": r"<", "type": "<" },
      # { "matcher": r"null", "type": "null" },
      { "matcher": r"none", "type": "none" },
      { "matcher": r"unknown", "type": "unknown" },
      { "matcher": r"true", "type": "true", "valueExtractor": lambda x: True },
      { "matcher": r"false", "type": "false", "valueExtractor": lambda x: False },
      { "matcher": r"import", "type": "import" },
      { "matcher": r"export", "type": "export" },
      { "matcher": r"from", "type": "from" },
      { "matcher": r"as", "type": "as" },
      { "matcher": r"for", "type": "for" },
      { "matcher": r"while", "type": "while" },
      # { "matcher": r"in", "type": "in" },
      # { "matcher": r"of", "type": "of" },
      { "matcher": r"break", "type": "break" },
      { "matcher": r"continue", "type": "continue" },
      { "matcher": r"do", "type": "do" },
      { "matcher": r"if", "type": "if" },
      { "matcher": r"else", "type": "else" },
      { "matcher": r"switch", "type": "switch" },
      { "matcher": r"case", "type": "case" },
      # { "matcher": r"default", "type": "default" },
      # { "matcher": r"function", "type": "function" },
      { "matcher": r"return", "type": "return" },
      # { "matcher": r"yield", "type": "yield" },
      # { "matcher": r"await", "type": "await" },
      # { "matcher": r"try", "type": "try" },
      # { "matcher": r"catch", "type": "catch" },
      # { "matcher": r"finally", "type": "finally" },
      # { "matcher": r"throw", "type": "throw" },
      { "matcher": r"new", "type": "new" },
      { "matcher": r"class", "type": "class" },
      # { "matcher": r"super", "type": "super" },
      { "matcher": r"let", "type": "let" },
      { "matcher": r"const", "type": "const" },
      { "matcher": r"this", "type": "this" },
      { "matcher": r"[a-zA-Z$_][a-zA-Z0-9$_]*", "type": "identifier", "valueExtractor": lambda x: x },
    ]
    tokenize(file, matchers)

if __name__ == "__main__":
    main()
