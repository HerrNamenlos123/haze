
// ╔═══════════════════════════════════════════════════════════════════════════════╗
// ║                        G R A M M A R   H E A D E R                            ║
// ╚═══════════════════════════════════════════════════════════════════════════════╝

parser grammar HazeParser;
options { tokenVocab=HazeLexer; }

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
    : IMPORT (module=ID | path=STRING_LITERAL) (AS alias=ID)? SEMI?                         #ImportStatement
    | FROM (module=ID | path=STRING_LITERAL) IMPORT importAs (COMMA importAs)* SEMI?        #FromImportStatement
    ;

importAs
    : symbol=ID (AS alias=ID)?
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
    : (export=EXPORT)? NAMESPACE ID (DOT ID)* LCURLY globalDeclaration* RCURLY
    ;

// Directives

cInjectDirective: (export=EXPORT)? INLINEC LB STRING_LITERAL RB SEMI;

// Functions

externLanguage: EXTERNC;

functionDefinition: (export=EXPORT)? (extern=EXTERN externLang=externLanguage? pub=PUB? noemit=NOEMIT?)?  ID (LANGLE ID (COMMA ID)* RANGLE)? LB params RB (COLON datatype)? (ARROW)? (funcbody | SEMI);
lambda: LB params RB (COLON datatype)? ARROW funcbody;
param: ID COLON (datatype | ellipsis);
params: (param (COMMA param)* (COMMA ellipsis)?)? | ellipsis;
ellipsis: ELLIPSIS;

funcbody: (scope | exprAsFuncbody);
scope: LCURLY (statement)* RCURLY;
exprAsFuncbody: expr;

// Variables

globalVariableDef
    : (export=EXPORT)? (extern=EXTERN externLang=externLanguage?)? pub=PUB? variableMutabilitySpecifier comptime=COMPTIME? ID (((COLON datatype)? EQUALS expr) | (COLON datatype)) SEMI        #GlobalVariableDefinition
    ;

typeDef
    : (export=EXPORT)? (extern=EXTERN externLang=externLanguage?)? pub=PUB? TYPE ID EQUALS datatype SEMI?        #TypedefDirective
    ;

variableMutabilitySpecifier
    : LET                               #VariableBindingImmutable
    | CONST                             #VariableImmutable
    | LET MUT                           #VariableMutable
    ;

// Datatypes

literal
    : (TRUE | FALSE)                            #BooleanConstant
    | UNIT_INTEGER_LITERAL                      #IntegerUnitLiteral
    | UNIT_FLOAT_LITERAL                        #FloatUnitLiteral
    | INTEGER_LITERAL                           #IntegerLiteral
    | FLOAT_LITERAL                             #FloatLiteral
    | STRING_LITERAL                            #StringConstant
    ;

datatype
    : datatypeFragment (DOT datatypeFragment)*                                  #NamedDatatype
    | datatype MUL                                                              #PointerDatatype
    | datatype SINGLEAND                                                        #ReferenceDatatype
    | datatype LBRACKET n=INTEGER_LITERAL RBRACKET                              #ArrayDatatype
    | datatype LBRACKET RBRACKET                                                #SliceDatatype
    | LB params RB ARROW datatype                                               #FunctionDatatype
    ;

datatypeFragment
    : ID (LANGLE genericLiteral (COMMA genericLiteral)* RANGLE)?
    ;

genericLiteral
    : datatype              #GenericLiteralDatatype
    | literal               #GenericLiteralConstant
    ;

structContent
    : ID COLON datatype (EQUALS expr)? SEMI                                                                 #StructMember
    | static=STATIC? ID (LANGLE ID (COMMA ID)* RANGLE)? LB params RB (COLON datatype)? (funcbody | SEMI)    #StructMethod
    | structDefinition                                                                                      #NestedStructDefinition
    ;

structDefinition
    : (export=EXPORT)? (extern=EXTERN externLang=externLanguage)? pub=PUB? noemit=NOEMIT? STRUCT attributes+=(CLONABLE | NONCLONABLE)* ID (LANGLE ID (COMMA ID)* RANGLE)? LCURLY (content+=structContent)* RCURLY (SEMI)?
    ;

typeDefinition
    : structDefinition
    ;

// Expressions

expr
    // https://en.cppreference.com/w/c/language/operator_precedence
    : LB expr RB                                                                    #ParenthesisExpr
    | TYPE LANGLE datatype RANGLE                                                   #TypeLiteralExpr
    | lambda                                                                        #LambdaExpr
    | literal                                                                       #LiteralExpr
    | LBRACKET expr? (COMMA expr)* COMMA? RBRACKET                                  #ArrayLiteral
    | datatype? LCURLY (ID COLON expr)? (COMMA (ID COLON expr))* COMMA? RCURLY      #StructInstantiationExpr

    // Part 1: Left to right
    | expr op=(PLUSPLUS | MINUSMINUS)                                               #PostIncrExpr
    | expr LB (expr (COMMA expr)*)? RB                                              #ExprCallExpr
    | value=expr LBRACKET index+=expr (COMMA index+=expr)* COMMA? RBRACKET          #ArraySubscriptExpr
    | expr DOT ID (LANGLE genericLiteral (COMMA genericLiteral)* RANGLE)?           #ExprMemberAccess

    // Part 2: Right to left
    | <assoc=right> op=(MINUSMINUS | PLUSPLUS) expr                                 #PreIncrExpr
    | <assoc=right> op=(PLUS | MINUS) expr                                          #UnaryExpr
    | <assoc=right> op=NOT expr /* and bitwise not */                               #UnaryExpr
    | <assoc=right> expr AS datatype                                                #ExplicitCastExpr
    | <assoc=right> MUL expr                                                        #PointerDereference
    | <assoc=right> SINGLEAND expr                                                  #PointerAddressOf

    // Part 3: Left to right
    | expr op+=(MUL|DIV|MOD) expr                                                   #BinaryExpr
    | expr op+=(PLUS|MINUS) expr                                                    #BinaryExpr
    // | expr ('<<'|'>>') expr                                                      #BinaryExpr
    | expr op+=(LANGLE|RANGLE|LEQ|GEQ) expr                                         #BinaryExpr
    | expr (op+=DOUBLEEQUALS|op+=NOTEQUALS) expr                                    #BinaryExpr
    // | expr ('&') expr                                                            #BinaryExpr
    // | expr ('^') expr                                                            #BinaryExpr
    // | expr ('|') expr                                                            #BinaryExpr
    | expr op+=(DOUBLEAND|DOUBLEOR) expr                                            #BinaryExpr
    // <- ternary
    | expr op=(EQUALS|PLUSEQ|MINUSEQ|MULEQ|DIVEQ|MODEQ) expr                        #ExprAssignmentExpr

    | ID (LANGLE genericLiteral (COMMA genericLiteral)* RANGLE)?                    #SymbolValueExpr
    ;

// Statements & Conditionals

statement
    : INLINEC LB STRING_LITERAL RB SEMI                         #CInlineStatement
    | expr SEMI                                                 #ExprStatement
    | RETURN expr? SEMI                                         #ReturnStatement
    | variableMutabilitySpecifier comptime=COMPTIME? ID (((COLON datatype)? EQUALS expr) | (COLON datatype)) SEMI       #VariableCreationStatement
    | IF comptime=COMPTIME? ifExpr=expr then=scope (ELSE IF elseIfExpr+=expr elseIfThen+=scope)* (ELSE elseBlock=scope)? #IfStatement
    | FOR comptime=COMPTIME? ID (COMMA ID)? IN expr scope       #ForEachStatement
    | WHILE expr scope                                          #WhileStatement
    | scope                                                     #ScopeStatement
    | typeDef                                                   #TypedefStatement
    ;
