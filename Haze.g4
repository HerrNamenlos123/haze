grammar Haze;

prog: (cdefinitiondecl | prebuildcmd | postbuildcmd | namedfunc | funcdecl | compilationhint | linkerhint | structdecl | namespace | variablestatement)*;

namespacecontent: (namedfunc | funcdecl | compilationhint | linkerhint | structdecl | namespace | variablestatement)*;
namespace
    : 'namespace' ID ('.' ID)* '{' namespacecontent '}'
    ;

namedfunc: (export='export')? ID '(' params ')' (':' datatype)? funcbody;
func: '(' params ')' (':' datatype)? funcbody;

funcbody: ('=>')? '{' body '}' | '=>' expr;
body: (statement)*;

param: ID ':' datatype;
params: (param (',' param)* (',' ellipsis)?)? | ellipsis;

cdefinitiondecl: 'inject' STRING_LITERAL ';';
prebuildcmd: 'prebuildcmd' STRING_LITERAL ';';
postbuildcmd: 'postbuildcmd' STRING_LITERAL ';';
funcdecl: (export='export')? 'declare' (externlang)? (ID '.')* ID '(' params ')' (':' datatype)? ';';
externlang: '"C"' | '"C++"';

ifexpr: expr;
elseifexpr: expr;
thenblock: body;
elseifblock: body;
elseblock: body;

variablemutability
    : ('let' | 'const')     #VariableMutability
    ;

variablestatement
    : (export='export')? variablemutability ID (':' datatype)? '=' expr ';'        #VariableDefinition
    | (export='export')? variablemutability ID (':' datatype) ';'                  #VariableDeclaration
    ;

statement
    : '__c__' '(' STRING_LITERAL ')' ';'                        #InlineCStatement
    | expr ';'                                                  #ExprStatement
    | 'return' expr? ';'                                        #ReturnStatement
    | variablestatement                                         #VariableStatement
    | 'if' ifexpr '{' thenblock '}' ('else' 'if' elseifexpr '{' elseifblock '}')* ('else' '{' elseblock '}')?  #IfStatement
    | 'while' expr '{' body '}'                                 #WhileStatement
    ;

structmembervalue
    : '.' ID ':' expr   #StructMemberValue
    ;

expr
    // https://en.cppreference.com/w/c/language/operator_precedence
    : '(' expr ')'                                                                  #ParenthesisExpr
    // | '{' objectattribute? (',' objectattribute)* ','? '}'              #AnonymousStructInstantiationExpr
    | func                                                      #FuncRefExpr
    | constant                                                  #ConstantExpr

    // Part 1: Left to right
    | expr op=('++' | '--')                                                         #PostIncrExpr
    | expr '(' args ')'                                                             #ExprCallExpr
    // <- Array Subscripting here: expr[]
    | expr '.' ID                                                                   #ExprMemberAccess
    | datatype '{' structmembervalue? (',' structmembervalue)* ','? '}'             #StructInstantiationExpr
    // Part 2: Right to left
    | <assoc=right> op=('++' | '--') expr                                           #PreIncrExpr
    | <assoc=right> op=('+' | '-') expr                                             #UnaryExpr
    | <assoc=right> ('not' | '!') expr /* and bitwise not */                        #UnaryExpr
    | <assoc=right> expr 'as' datatype                                              #ExplicitCastExpr
    // Part 3: Left to right
    | expr ('*'|'/'|'%') expr                                   #BinaryExpr
    | expr ('+'|'-') expr                                       #BinaryExpr
    // | expr ('<<'|'>>') expr                                       #BinaryExpr
    | expr ('<'|'>'|'<='|'>=') expr                             #BinaryExpr
    | expr ('=='|'!='|'is'|('is' 'not')) expr                   #BinaryExpr
    // | expr ('&') expr                                           #BinaryExpr
    // | expr ('^') expr                                           #BinaryExpr
    // | expr ('|') expr                                           #BinaryExpr
    | expr ('and'|'or') expr                                    #BinaryExpr
    // <- ternary
    | expr op=('='|'+='|'-='|'*='|'/='|'%='|'<<='|'>>='|'&='|'^='|'|=') expr   #ExprAssignmentExpr

    | ID ('<' datatype (',' datatype)* '>')?                    #SymbolValueExpr
    ;

args: (expr (',' expr)*)?;

ellipsis: '...';

functype: '(' params ')' '=>' datatype;

constant
    : ('true' | 'false')                        #BooleanConstant
    | UNIT_LITERAL                              #LiteralConstant
    | NUMBER_LITERAL                            #LiteralConstant
    | STRING_LITERAL                            #StringConstant
    ;

compilationhint: '#compile' compilationlang compilationhintfilename compilationhintflags?;
compilationhintfilename: STRING_LITERAL;
compilationhintflags: STRING_LITERAL;
compilationlang: '"C"' | '"C++"';
linkerhint: 'link' STRING_LITERAL;

structcontent
    : ID ':' datatype ';'                                    #StructMember
    | ID '(' params ')' (':' datatype)? funcbody             #StructMethod
    | 'unsafe_union' '{' (structcontent)* '}'                   #StructUnionFields
    ;

structdecl
    : (export='export')? ('declare' externlang)? 'struct' ID ('<' ID (',' ID)* '>')? '{' (structcontent)* '}' (';')?      #StructDecl
    ;

datatype
    : datatypeimpl ('.' datatypeimpl)*                                                          #CommonDatatype
    | functype                                                                                  #FunctionDatatype
    ;

datatypeimpl
    : ID ('<' generics+=datatype (',' generics+=datatype)* '>')?
    ;

STRING_LITERAL
    :   '"' (ESC | ~["\\])* '"'
    ;

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

UNIT_LITERAL: (DEC_PART | FLOAT_PART) ('s' | 'ms' | 'us' | 'ns' | 'm' | 'h' | 'd');
NUMBER_LITERAL: (DEC_PART | FLOAT_PART);

// Tokens

ID: [a-zA-Z_][a-zA-Z_0-9]*;
WS: [ \t\n\r]+ -> skip;
COMMENT: '//' ~[\r\n]* -> skip; // Single-line comments
