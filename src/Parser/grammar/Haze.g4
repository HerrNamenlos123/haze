
// ╔═══════════════════════════════════════════════════════════════════════════════╗
// ║                        G R A M M A R   H E A D E R                            ║
// ╚═══════════════════════════════════════════════════════════════════════════════╝

grammar Haze;

// ╔═══════════════════════════════════════════════════════════════════════════════╗
// ║                           P A R S E R   R U L E S                             ║
// ╚═══════════════════════════════════════════════════════════════════════════════╝

prog: topLevelDeclaration* EOF;
topLevelDeclaration
    : cInjectDirective
    | globalDeclaration
    | importStatements
    ;

// Imports

importStatements
    : 'import' (module=ID | path=STRING_LITERAL) ('as' alias=ID)? ';'?                    #ImportStatement
    | 'from' (module=ID | path=STRING_LITERAL) 'import' importAs (',' importAs)* ';'?          #FromImportStatement
    ;

importAs
    : symbol=ID ('as' alias=ID)?
    ;

// Namespaces

globalDeclaration
    : functionDefinition
    | typeDefinition
    | namespaceDefinition
    | globalVariableDef
    | typeDef
    ;

namespaceDefinition
    : (export='export')? 'namespace' ID ('.' ID)* '{' globalDeclaration* '}'
    ;

// Directives

cInjectDirective: '__c__' '(' STRING_LITERAL ')' ';';

// Functions

externLanguage: '"C"';

functionDefinition: (export='export')? (extern='extern' externLang=externLanguage? pub='pub'? noemit='noemit'?)?  ID ('<' ID (',' ID)* '>')? '(' params ')' (':' datatype)? ('=>')? (funcbody | ';');
lambda: '(' params ')' (':' datatype)? '=>' funcbody;
param: ID ':' datatype;
params: (param (',' param)* (',' ellipsis)?)? | ellipsis;
ellipsis: '...';

funcbody: (scope | exprAsFuncbody);
scope: '{' (statement)* '}';
exprAsFuncbody: expr;

// Variables

globalVariableDef
    : (export='export')? (extern='extern' externLang=externLanguage?)? pub='pub'? variableMutabilitySpecifier comptime='comptime'? ID (((':' datatype)? '=' expr) | (':' datatype)) ';'        #GlobalVariableDefinition
    ;

typeDef
    : (export='export')? (extern='extern' externLang=externLanguage?)? pub='pub'? 'type' ID '=' datatype ';'?        #TypedefDirective
    ;

variableMutabilitySpecifier
    : 'let'                             #VariableBindingImmutable
    | 'const'                           #VariableImmutable
    | 'let' 'mut'                       #VariableMutable
    ;

// Datatypes

literal
    : ('true' | 'false')                        #BooleanConstant
    | UNIT_INTEGER_LITERAL                      #IntegerUnitLiteral
    | UNIT_FLOAT_LITERAL                        #FloatUnitLiteral
    | INTEGER_LITERAL                           #IntegerLiteral
    | FLOAT_LITERAL                             #FloatLiteral
    | STRING_LITERAL                            #StringConstant
    ;

datatype
    : datatypeFragment ('.' datatypeFragment)*                          #NamedDatatype
    | datatype '*'                                                      #PointerDatatype
    | datatype '&'                                                      #ReferenceDatatype
    | '(' params ')' '=>' datatype                                      #FunctionDatatype
    ;

datatypeFragment
    : ID ('<' genericLiteral (',' genericLiteral)* '>')?
    ;

genericLiteral
    : datatype              #GenericLiteralDatatype
    | literal               #GenericLiteralConstant
    ;

structContent
    : ID ':' datatype ';'                                                                   #StructMember
    | static='static'? ID ('<' ID (',' ID)* '>')? '(' params ')' (':' datatype)? (funcbody | ';')  #StructMethod
    | structDefinition                                                                      #NestedStructDefinition
    ;

structDefinition
    : (export='export')? (extern='extern' externLang=externLanguage pub='pub'? noemit='noemit'?)? 'struct' ID ('<' ID (',' ID)* '>')? '{' (content+=structContent)* '}' (';')?
    ;

typeDefinition
    : structDefinition
    ;

// Expressions

expr
    // https://en.cppreference.com/w/c/language/operator_precedence
    : '(' expr ')'                                                                  #ParenthesisExpr
    // | '{' objectattribute? (',' objectattribute)* ','? '}'                       #AnonymousStructInstantiationExpr
    | lambda                                                                        #LambdaExpr
    | literal                                                                       #LiteralExpr

    // Part 1: Left to right
    | expr op=('++' | '--')                                                         #PostIncrExpr
    | expr '(' (expr (',' expr)*)? ')'                                              #ExprCallExpr
    // <- Array Subscripting here: expr[]
    | expr '.' ID ('<' genericLiteral (',' genericLiteral)* '>')?                   #ExprMemberAccess
    | datatype '{' (ID ':' expr)? (',' (ID ':' expr))* ','? '}'                     #StructInstantiationExpr

    // Part 2: Right to left
    | <assoc=right> op=('++' | '--') expr                                           #PreIncrExpr
    | <assoc=right> op=('+' | '-') expr                                             #UnaryExpr
    | <assoc=right> op=('not' | '!') expr /* and bitwise not */                     #UnaryExpr
    | <assoc=right> expr 'as' datatype                                              #ExplicitCastExpr
    | <assoc=right> '*' expr                                                        #PointerDereference
    | <assoc=right> '&' expr                                                        #PointerAddressOf

    // Part 3: Left to right
    | expr op+=('*'|'/'|'%') expr                                                   #BinaryExpr
    | expr op+=('+'|'-') expr                                                       #BinaryExpr
    // | expr ('<<'|'>>') expr                                                      #BinaryExpr
    | expr op+=('<'|'>'|'<='|'>=') expr                                             #BinaryExpr
    | expr (op+='=='|op+='!='|op+='is'|(op+='is' op+='not')) expr                   #BinaryExpr
    // | expr ('&') expr                                                            #BinaryExpr
    // | expr ('^') expr                                                            #BinaryExpr
    // | expr ('|') expr                                                            #BinaryExpr
    | expr op+=('and'|'or') expr                                                    #BinaryExpr
    // <- ternary
    | expr op=('='|'+='|'-='|'*='|'/='|'%=') expr                                   #ExprAssignmentExpr

    | ID ('<' genericLiteral (',' genericLiteral)* '>')?                            #SymbolValueExpr
    ;

// Statements & Conditionals

statement
    : '__c__' '(' STRING_LITERAL ')' ';'                        #CInlineStatement
    | expr ';'                                                  #ExprStatement
    | 'return' expr? ';'                                        #ReturnStatement
    | variableMutabilitySpecifier comptime='comptime'? ID (((':' datatype)? '=' expr) | (':' datatype)) ';'       #VariableCreationStatement
    | 'if' comptime='comptime'? ifExpr=expr then=scope ('else' 'if' elseIfExpr+=expr elseIfThen+=scope)* ('else' elseBlock=scope)? #IfStatement
    | 'while' expr scope                                        #WhileStatement
    | scope                                                     #ScopeStatement
    | typeDef                                                   #TypedefStatement
    ;

// ╔═══════════════════════════════════════════════════════════════════════════════╗
// ║                           L E X E R   R U L E S                               ║
// ╚═══════════════════════════════════════════════════════════════════════════════╝

STRING_LITERAL
    :   '"' (ESC | ~["\\])* '"'
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

fragment DEC_PART: DIGIT+;
fragment FLOAT_PART: DIGIT+ '.' DIGIT*; // Handles 123., .456, 123.45
fragment DIGIT: [0-9];

// ╔═══════════════════════════════════════════════════════════════════════════════╗
// ║                  W H I T E S P A C E   &   C O M M E N T S                    ║
// ╚═══════════════════════════════════════════════════════════════════════════════╝

WS: [ \t\r\n]+ -> channel(HIDDEN);
COMMENT: '//' ~[\r\n]* -> channel(HIDDEN); 
BLOCK_COMMENT: '/*' .*? '*/' -> channel(HIDDEN);