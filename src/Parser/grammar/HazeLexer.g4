lexer grammar HazeLexer;

// ╔═══════════════════════════════════════════════════════════════════════════════╗
// ║                           L E X E R   R U L E S                               ║
// ╚═══════════════════════════════════════════════════════════════════════════════╝

IMPORT: 'import';
EXPORT: 'export';
AS: 'as';
IS: 'is';
FROM: 'from';
NAMESPACE: 'namespace';
PUB: 'pub';
NOEMIT: 'noemit';
INLINEC: '__c__';
EXTERN: 'extern';
STATIC: 'static';
STRUCT: 'struct';
NODISCARD: 'nodiscard';
NONCLONABLE: 'nonclonable';
CLONABLE: 'clonable';
REQUIRES: 'requires';
UNSAFE: 'unsafe';
DO: 'do';
YIELD: 'yield';
RAISE: 'raise';
EMIT: 'emit';
INLINE: 'inline';
ATTEMPT: 'attempt';
NORETURN: 'noreturn';
NORETURNIF: 'noreturn_if';
WITH: 'with';
FINAL: 'final';
UNION: 'union';
ENUM: 'enum';
BITFLAG: 'bitflag';
UNSCOPED: 'unscoped';
TRY: 'try';
OPAQUE: 'opaque';
PLAIN: 'plain';
PURE: 'pure';
SOURCE_LOCATION_DIRECTIVE: '#source';

OPERATORSUBSCRIPT: 'operator[]';
OPERATORREBIND: 'operator=';
OPERATORASSIGN: 'operator:=';
OPERATORPLUS: 'operator+';
OPERATORMINUS: 'operator-';
OPERATORMUL: 'operator*';
OPERATORDIV: 'operator/';
OPERATORMOD: 'operator%';
OPERATORAS: 'operator as';
OPERATOREQ: 'operator==';
OPERATORNEQ: 'operator!=';
OPERATORLT: 'operator<';
OPERATORGT: 'operator>';
OPERATORLTE: 'operator<=';
OPERATORGTE: 'operator>=';

TRUE: 'true';
FALSE: 'false';
TYPE: 'type';
TYPEOF: 'typeof';
RETURN: 'return';
IF: 'if';
ELSE: 'else';
IN: 'in';
FOR: 'for';
WHILE: 'while';
COMPTIME: 'comptime';
LET: 'let'; CONST: 'const'; MUT: 'mut';
DOT: '.';
LCURLY: '{' -> pushMode(DEFAULT_MODE);
RCURLY: '}' -> popMode;
LASTERISKBRACKET: '*[';
LAMPERSANDBRACKET: '&[';
LBRACKET: '[';
RBRACKET: ']';
LB: '(';
RB: ')';
DOUBLEARROW: '=>';
SINGLEARROW: '->';
LANGLE: '<';
RANGLE: '>';
EQUALS: '=';
COLONEQUALS: ':=';
DOUBLEEQUALS: '==';
NOTEQUALS: '!=';
SEMI: ';';
DOUBLECOLON: '::';
COLON: ':';
COMMA: ',';
PLUS: '+';
MINUS: '-';
NOT: '!';
PLUSPLUS: '++';
MINUSMINUS: '--';
MUL: '*';
DIV: '/';
MOD: '%';
ELLIPSIS: '...';
SINGLEAND: '&';
QUESTIONMARK: '?';
AMPERSANDQUESTION: '&?';
QUESTIONAMPERSAND: '?&';
QUESTIONDOT: '?.';
QUESTIONEXCL: '?!';
SINGLEOR: '|';
DOUBLEAND: '&&';
DOUBLEOR: '||';
LEQ: '<=';
GEQ: '>=';
PLUSEQ: '+=';
MULEQ: '*=';
MINUSEQ: '-=';
DIVEQ: '/=';
MODEQ: '%=';

UNIT_INTEGER_LITERAL: (DEC_PART) ('s' | 'ms' | 'us' | 'ns' | 'm' | 'h' | 'd');
UNIT_FLOAT_LITERAL: (FLOAT_PART) ('s' | 'ms' | 'us' | 'ns' | 'm' | 'h' | 'd');
FLOAT_LITERAL: (FLOAT_PART);

INTEGER_LITERAL: (DEC_PART);
HEX_INTEGER_LITERAL
    : '0' [xX] HEX_DIGIT+
    ;

RAW_ID: [a-zA-Z_][a-zA-Z_0-9]*;

REGEX_LITERAL
    : 'r"' REGEX_BODY '"' REGEX_FLAGS?
    ;

// ╔═══════════════════════════════════════════════════════════════════════════════╗
// ║                        F R A G M E N T   R U L E S                            ║
// ╚═══════════════════════════════════════════════════════════════════════════════╝

fragment ESC
    :   '\\x' HEX HEX
    |   '\\' [btnfr"'\\]
    |   '\\' ('u' HEX HEX HEX HEX | 'U' HEX HEX HEX HEX HEX HEX HEX HEX)
    |   '\\' OCTAL
    ;

fragment OCTAL
    :   [0-3]? [0-7] [0-7]?                    // Matches up to \377
    ;

fragment HEX
    :   [0-9a-fA-F]
    ;

fragment DEC_PART: DIGIT+;
fragment FLOAT_PART: DIGIT+ '.' DIGIT*; // Handles 123., .456, 123.45
fragment DIGIT: [0-9];
fragment HEX_DIGIT: [0-9a-fA-F];

fragment REGEX_BODY
    : REGEX_CHAR*
    ;

fragment REGEX_CHAR
    : ~["\r\n]
    ;

fragment REGEX_FLAGS
    : [a-zA-Z]+
    ;


// ╔═══════════════════════════════════════════════════════════════════════════════╗
// ║                  W H I T E S P A C E   &   C O M M E N T S                    ║
// ╚═══════════════════════════════════════════════════════════════════════════════╝

WS: [ \t\r\n]+ -> channel(HIDDEN);
COMMENT: '//' ~[\r\n]* -> channel(HIDDEN); 
BLOCK_COMMENT: '/*' .*? '*/' -> channel(HIDDEN);

// ╔═══════════════════════════════════════════════════════════════════════════════╗
// ║                     S T R I N G S   &   F - S T R I N G S                     ║
// ╚═══════════════════════════════════════════════════════════════════════════════╝

// ------------------------
// Main mode (normal code)
// ------------------------

FTRIPLE_STRING_START
    : 'f"""' -> pushMode(InterpolatedStringTriple)
    ;

fragment TRIPLE_ESCAPE_TRIPLE_QUOTE
    : '\\"""'
    ;

TRIPLE_STRING_LITERAL
    : '"""' TRIPLE_STRING_BODY '"""'
    ;

fragment TRIPLE_STRING_BODY
    : (
        TRIPLE_ESCAPE_TRIPLE_QUOTE
      | '""' ~'"'
      | '"' ~'"'
      | ~'"'
      )*
    ;

STRING_LITERAL: ('"' | 'b"') (ESC | ~["\\])* '"' ;

FSTRING_START: 'f"' -> pushMode(InterpolatedString);

mode InterpolatedString;

FSTRING_ESCAPE_OPENING_BRACES: '{{' -> type(FSTRING_GRAPHEME);
FSTRING_ESCAPE_CLOSING_BRACES: '}}' -> type(FSTRING_GRAPHEME);
FSTRING_ESCAPE_QUOTE: '\\"' -> type(FSTRING_GRAPHEME);
FSTRING_ESCAPE: ESC -> type(FSTRING_GRAPHEME);

FSTRING_EXPR_START: '{' -> type(LCURLY), pushMode(DEFAULT_MODE);
FSTRING_END: '"' -> popMode;

FSTRING_GRAPHEME: ~('{' | '"' | '\\');

mode InterpolatedStringTriple;

FTRIPLE_ESCAPE_TRIPLE_QUOTE
    : '\\"""' -> type(FSTRING_GRAPHEME)
    ;
FTRIPLE_END: '"""' -> popMode;

FTRIPLE_ESCAPE_OPENING_BRACES: '{{' -> type(FSTRING_GRAPHEME);
FTRIPLE_ESCAPE_CLOSING_BRACES: '}}' -> type(FSTRING_GRAPHEME);

fragment FTRIPLE_ESC
    : '\\x' HEX HEX
    | '\\' [btnfr'\\]
    | '\\' ('u' HEX HEX HEX HEX | 'U' HEX HEX HEX HEX HEX HEX HEX HEX)
    | '\\' OCTAL
    ;

FTRIPLE_ESCAPE
    : FTRIPLE_ESC -> type(FSTRING_GRAPHEME)
    ;

FTRIPLE_EXPR_START: '{' -> type(LCURLY), pushMode(DEFAULT_MODE);

// allow everything except start of interpolation or terminator
FTRIPLE_GRAPHEME
    : (
        '""' ~'"'
      | '"' ~'"'
      | ~'{'
      )
    -> type(FSTRING_GRAPHEME)
    ;
