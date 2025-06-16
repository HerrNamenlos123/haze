
// ╔═══════════════════════════════════════════════════════════════════════════════╗
// ║                        G R A M M A R   H E A D E R                            ║
// ╚═══════════════════════════════════════════════════════════════════════════════╝

grammar Haze;

// ╔═══════════════════════════════════════════════════════════════════════════════╗
// ║                           P A R S E R   R U L E S                             ║
// ╚═══════════════════════════════════════════════════════════════════════════════╝

prog: topLevelStatement*;
topLevelStatement
    : cInjectDirective
    | functionDefinition
    | functionDeclaration
    | structDefinition
    | namespaceDefinition
    | globalVariableDef
    ;

// Namespaces

namespacedStatement
    : functionDefinition
    | functionDeclaration
    | structDefinition
    | namespaceDefinition
    | variableCreation
    ;

namespaceDefinition
    : (export='export')? 'namespace' ID ('.' ID)* '{' namespacedStatement* '}'
    ;

// Directives

cInjectDirective: 'inject' STRING_LITERAL ';';

// Functions

functionDeclaration: (export='export')? (extern='extern' externLanguage?)? (ID '.')* ID '(' params ')' (':' datatype)? ';';
externLanguage: '"C"';

functionDefinition: (export='export')? ID '(' params ')' (':' datatype)? funcbody;
func: '(' params ')' (':' datatype)? funcbody;
param: ID ':' datatype;
params: (param (',' param)* (',' ellipsis)?)? | ellipsis;
ellipsis: '...';

funcbody: '=>' (scope | expr);
scope: '{' (statement)* '}';

// Variables

globalVariableDef
    : (export='export')? (extern='extern' externLanguage?)? mutability=('let' | 'const') ID (':' datatype)? '=' expr ';'        #GlobalVariableDefinition
    | (export='export')? (extern='extern' externLanguage?)? mutability=('let' | 'const') ID (':' datatype) ';'                  #GlobalVariableDeclaration
    ;

variableCreation
    : mutability=('let' | 'const') ID (':' datatype)? '=' expr ';'        #VariableDefinition
    | mutability=('let' | 'const') ID (':' datatype) ';'                  #VariableDeclaration
    ;

// Datatypes

funcDatatype: '(' params ')' '=>' datatype;

constant
    : ('true' | 'false')                        #BooleanConstant
    | UNIT_LITERAL                              #LiteralConstant
    | NUMBER_LITERAL                            #NumberConstant
    | STRING_LITERAL                            #StringConstant
    ;

datatype
    : datatypeFragment ('.' datatypeFragment)*    #NamedDatatype
    | funcDatatype                                #FunctionDatatype
    ;

datatypeFragment
    : ID ('<' generics+=genericLiteral (',' generics+=genericLiteral)* '>')?
    ;

genericLiteral
    : datatype | constant
    ;

structContent
    : ID ':' datatype ';'                                           #StructMember
    | ID '(' params ')' (':' datatype)? (funcbody | ';')            #StructMethod
    ;

structDefinition
    : (export='export')? ('extern' externLanguage)? 'struct' ID ('<' ID (',' ID)* '>')? '{' (structContent)* '}' (';')?
    ;

// Expressions

structmembervalue
    : '.' ID ':' expr   #StructMemberValue
    ;

expr
    // https://en.cppreference.com/w/c/language/operator_precedence
    : '(' expr ')'                                                                  #ParenthesisExpr
    // | '{' objectattribute? (',' objectattribute)* ','? '}'                       #AnonymousStructInstantiationExpr
    | func                                                                          #FuncRefExpr
    | constant                                                                      #ConstantExpr

    // Part 1: Left to right
    | expr op=('++' | '--')                                                         #PostIncrExpr
    | expr '(' (expr (',' expr)*)? ')'                                              #ExprCallExpr
    // <- Array Subscripting here: expr[]
    | expr '.' ID                                                                   #ExprMemberAccess
    | datatype '{' structmembervalue? (',' structmembervalue)* ','? '}'             #StructInstantiationExpr

    // Part 2: Right to left
    | <assoc=right> op=('++' | '--') expr                                           #PreIncrExpr
    | <assoc=right> op=('+' | '-') expr                                             #UnaryExpr
    | <assoc=right> ('not' | '!') expr /* and bitwise not */                        #UnaryExpr
    | <assoc=right> expr 'as' datatype                                              #ExplicitCastExpr

    // Part 3: Left to right
    | expr ('*'|'/'|'%') expr                                                       #BinaryExpr
    | expr ('+'|'-') expr                                                           #BinaryExpr
    // | expr ('<<'|'>>') expr                                                      #BinaryExpr
    | expr ('<'|'>'|'<='|'>=') expr                                                 #BinaryExpr
    | expr ('=='|'!='|'is'|('is' 'not')) expr                                       #BinaryExpr
    // | expr ('&') expr                                                            #BinaryExpr
    // | expr ('^') expr                                                            #BinaryExpr
    // | expr ('|') expr                                                            #BinaryExpr
    | expr ('and'|'or') expr                                                        #BinaryExpr
    // <- ternary
    | expr op=('='|'+='|'-='|'*='|'/='|'%='|'<<='|'>>='|'&='|'^='|'|=') expr        #ExprAssignmentExpr

    | ID ('<' (datatype | constant) (',' (datatype | constant))* '>')?              #SymbolValueExpr
    ;

// Statements & Conditionals

statement
    : '__c__' '(' STRING_LITERAL ')' ';'                        #CInlineDirective
    | expr ';'                                                  #ExprStatement
    | 'return' expr? ';'                                        #ReturnStatement
    | variableCreation                                          #VariableCreationStatement
    | 'if' ifExpr=expr then=scope ('else' 'if' elseIfExpr=expr elseIfThen=scope)* ('else' elseBlock=scope)?  #IfStatement
    | 'while' expr scope                                        #WhileStatement
    ;

// ╔═══════════════════════════════════════════════════════════════════════════════╗
// ║                           L E X E R   R U L E S                               ║
// ╚═══════════════════════════════════════════════════════════════════════════════╝

STRING_LITERAL
    :   '"' (ESC | ~["\\])* '"'
    ;

UNIT_LITERAL: (DEC_PART | FLOAT_PART) ('s' | 'ms' | 'us' | 'ns' | 'm' | 'h' | 'd');
NUMBER_LITERAL: (DEC_PART | FLOAT_PART);

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