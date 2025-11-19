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
EXTERNC: 'C';
EXTERN: 'extern';
STATIC: 'static';
STRUCT: 'struct';
NONCLONABLE: 'nonclonable';
CLONABLE: 'clonable';
REQUIRES: 'requires';
UNSAFE: 'unsafe';
DO: 'do';
YIELD: 'yield';
EMIT: 'emit';
INLINE: 'inline';
AUTODEST: 'autodest';
NORETURN: 'noreturn';
FINAL: 'final';
SOURCE_LOCATION_DIRECTIVE: '#source';

OPERATORSUBSCRIPT: 'operator[]';
OPERATORPLUS: 'operator+';
OPERATORMINUS: 'operator-';
OPERATORMUL: 'operator*';
OPERATORDIV: 'operator/';
OPERATORMOD: 'operator%';
OPERATORAS: 'operator as';

TRUE: 'true';
FALSE: 'false';
TYPE: 'type';
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
ARROW: '=>';
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
INTEGER_LITERAL: (DEC_PART);
FLOAT_LITERAL: (FLOAT_PART);

ID: [a-zA-Z_][a-zA-Z_0-9]*;

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
STRING_LITERAL: '"' (ESC | ~["\\])* '"' ;

FSTRING_START: 'f"' -> pushMode(InterpolatedString);

mode InterpolatedString;

FSTRING_ESCAPE_OPENING_BRACES: '{{' -> type(FSTRING_GRAPHEME);
FSTRING_ESCAPE_CLOSING_BRACES: '}}' -> type(FSTRING_GRAPHEME);
FSTRING_ESCAPE_QUOTE: '\\"' -> type(FSTRING_GRAPHEME);
FSTRING_EXPR_START: '{' -> type(LCURLY), pushMode(DEFAULT_MODE);
FSTRING_END: '"' -> popMode;
FSTRING_EXPR_END: '}' -> popMode;
FSTRING_GRAPHEME: ~('{' | '"' | '\\');

