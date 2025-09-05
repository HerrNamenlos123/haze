lexer grammar HazeLexer;

// ╔═══════════════════════════════════════════════════════════════════════════════╗
// ║                           L E X E R   R U L E S                               ║
// ╚═══════════════════════════════════════════════════════════════════════════════╝

IMPORT: 'import';
EXPORT: 'export';
AS: 'as';
FROM: 'from';
NAMESPACE: 'namespace';
PUB: 'pub';
NOEMIT: 'noemit';
INLINEC: '__c__';
EXTERNC: '"C"';
EXTERN: 'extern';
STATIC: 'static';
STRUCT: 'struct';
NONCLONABLE: 'nonclonable';
CLONABLE: 'clonable';
TYPE: 'type';
RETURN: 'return';
IF: 'if';
ELSE: 'else';
IN: 'in';
FOR: 'for';
WHILE: 'while';
COMPTIME: 'comptime';
LET: 'let';
CONST: 'const';
MUT: 'mut';
TRUE: 'true';
FALSE: 'false';

DOT: '.';
LCURLY: '{';
RCURLY: '}';
LBRACKET: '[';
RBRACKET: ']';
LB: '(';
RB: ')';
ARROW: '=>';
LANGLE: '<';
RANGLE: '>';
EQUALS: '=';
DOUBLEEQUALS: '==';
NOTEQUALS: '!=';

SEMI: ';';
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

STRING_LITERAL
    : '"' (ESC | ~["\\])* '"'
    ;

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

fragment DEC_PART: '-'? DIGIT+;
fragment FLOAT_PART: '-'? DIGIT+ '.' DIGIT*; // Handles 123., .456, 123.45
fragment DIGIT: [0-9];

// ╔═══════════════════════════════════════════════════════════════════════════════╗
// ║                  W H I T E S P A C E   &   C O M M E N T S                    ║
// ╚═══════════════════════════════════════════════════════════════════════════════╝

WS: [ \t\r\n]+ -> channel(HIDDEN);
COMMENT: '//' ~[\r\n]* -> channel(HIDDEN); 
BLOCK_COMMENT: '/*' .*? '*/' -> channel(HIDDEN);