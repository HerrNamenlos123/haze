grammar Haze;

prog: (namedfunc | funcdecl | compilationhint | linkerhint | structdecl)*;

namedfunc: ID '(' params ')' (':' datatype)? funcbody;
func: '(' params ')' (':' datatype)? funcbody;

funcbody: ('=>')? '{' body '}' | '=>' expr;
body: (statement)*;

param: ID ':' datatype;
params: (param (',' param)* (',' ellipsis)?)? | ellipsis;

funcdecl: 'declare' (externlang)? (ID '.')* ID '(' params ')' (':' datatype)? ';';
externlang: '"C"' | '"C++"';

ifexpr: expr;
elseifexpr: expr;
thenblock: body;
elseifblock: body;
elseblock: body;

variablemutability
    : ('let' | 'const')     #VariableMutability
    ;

statement
    : '__c__' '(' STRING_LITERAL ')' ';'                        #InlineCStatement
    | expr ';'                                                  #ExprStatement
    | 'return' expr? ';'                                        #ReturnStatement
    | expr '=' expr ';'                                         #ExprAssignmentStatement
    | variablemutability ID (':' datatype)? '=' expr ';'         #VariableDefinition
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

    | ID ('<' datatype (',' datatype)* '>')?                    #SymbolValueExpr
    | constant                                                  #ConstantExpr
    ;

args: (expr (',' expr)*)?;

ellipsis: '...';

functype: '(' params ')' '=>' datatype;

constant
    : INT                   #IntegerConstant
    | STRING_LITERAL        #StringConstant
    | ('true' | 'false')    #BooleanConstant
    ;

compilationhint: '#compile' compilationlang compilationhintfilename compilationhintflags?;
compilationhintfilename: STRING_LITERAL;
compilationhintflags: STRING_LITERAL;
compilationlang: '"C"' | '"C++"';
linkerhint: '#link' STRING_LITERAL;

structcontent
    : ID ':' datatype ';'                                    #StructMember
    | ID '(' params ')' (':' datatype)? funcbody             #StructMethod
    ;

structdecl
    : 'struct' ID ('<' ID (',' ID)* '>')? '{' (structcontent)* '}'      #StructDecl
    ;

datatype
    : ID ('<' datatype (',' datatype)* '>')?        #CommonDatatype
    | functype                                      #FunctionDatatype
    ;

STRING_LITERAL
    :   '"' (ESC | ~["\\])* '"'
    ;

fragment ESC
    :   '\\' [btnfr"'\\]
    |   '\\' ('u' HEX HEX HEX HEX | 'U' HEX HEX HEX HEX HEX HEX HEX HEX)
    ;

fragment HEX
    :   [0-9a-fA-F]
    ;

// Tokens
ID: [a-zA-Z_][a-zA-Z_0-9]*;
INT: [0-9]+;
WS: [ \t\n\r]+ -> skip;
COMMENT: '//' ~[\r\n]* -> skip; // Single-line comments
