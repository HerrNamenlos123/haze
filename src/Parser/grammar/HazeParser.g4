
// ╔═══════════════════════════════════════════════════════════════════════════════╗
// ║                        G R A M M A R   H E A D E R                            ║
// ╚═══════════════════════════════════════════════════════════════════════════════╝

parser grammar HazeParser;
options { tokenVocab=HazeLexer; }

// ╔═══════════════════════════════════════════════════════════════════════════════╗
// ║                           P A R S E R   R U L E S                             ║
// ╚═══════════════════════════════════════════════════════════════════════════════╝

prog: topLevelDeclarations EOF;
topLevelDeclarations
    : (cInjectDirective | importStatements | globalDeclaration)*
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

sourceLocationPrefixRule
    : SOURCE_LOCATION_DIRECTIVE STRING_LITERAL COLON INTEGER_LITERAL (
        (COLON INTEGER_LITERAL) | 
        (COLON INTEGER_LITERAL MINUS INTEGER_LITERAL) | 
        (COLON INTEGER_LITERAL MINUS FLOAT_LITERAL) // Not supposed to be float, but ROW.COLUMN parses as float
    )?
    ;

globalDeclarationWithSource
    : sourceLocationPrefixRule LCURLY globalDeclaration* RCURLY
    ;

globalDeclaration
    : functionDefinition
    | typeDefinition 
    | namespaceDefinition 
    | globalVariableDef 
    | typeDef 
    | globalDeclarationWithSource
    ;

namespaceDefinition
    : (export=EXPORT)? NAMESPACE ID (DOT ID)* LCURLY globalDeclaration* RCURLY
    ;

// Directives

cInjectDirective: (export=EXPORT)? INLINEC LB STRING_LITERAL RB SEMI?;

// Functions

externLanguage: EXTERNC;

functionDefinition: (export=EXPORT)? (extern=EXTERN externLang=externLanguage? pub=PUB? noemit=NOEMIT?)?  ID (LANGLE ID (COMMA ID)* RANGLE)? LB params RB (COLON datatype)? requiresBlock? (ARROW)? (funcbody | SEMI?);
lambda: LB params RB (COLON datatype)? requiresBlock? ARROW funcbody;
param: ID QUESTIONMARK? COLON (datatype | ellipsis);
params: (param (COMMA param)* (COMMA ellipsis)?)? | ellipsis;
ellipsis: ELLIPSIS;

funcbody: (rawScope | exprAsFuncbody);
rawScope: LCURLY (statement)* RCURLY;
doScope: DO UNSAFE? LCURLY (statement)* (EMIT expr SEMI?)? RCURLY;
exprAsFuncbody: expr;

// Variables

globalVariableDef
    : (export=EXPORT)? (extern=EXTERN externLang=externLanguage?)? pub=PUB? variableMutabilitySpecifier comptime=COMPTIME? ID (((COLON datatype)? EQUALS expr) | (COLON datatype)) SEMI?        #GlobalVariableDefinition
    ;

typeDef
    : (export=EXPORT)? (extern=EXTERN externLang=externLanguage?)? pub=PUB? TYPE ID EQUALS datatype SEMI?        #TypeAliasDirective
    ;

variableMutabilitySpecifier
    : LET                               #VariableLet
    | CONST                             #VariableConst
    ;

// Datatypes

literal
    : (TRUE | FALSE)                            #BooleanConstant
    | UNIT_INTEGER_LITERAL                      #IntegerUnitLiteral
    | UNIT_FLOAT_LITERAL                        #FloatUnitLiteral
    | INTEGER_LITERAL                           #IntegerLiteral
    | FLOAT_LITERAL                             #FloatLiteral
    | interpolatedString                        #FStringLiteral
    | STRING_LITERAL                            #StringConstant
    ;

interpolatedString: FSTRING_START (interpolatedStringFragment)* FSTRING_END;
interpolatedStringFragment: FSTRING_GRAPHEME | interpolatedStringExpression;
interpolatedStringExpression: LCURLY expr RCURLY;

datatypeImpl
    : datatypeFragment (DOT datatypeFragment)*                                  #NamedDatatype
    | LBRACKET n=INTEGER_LITERAL RBRACKET datatype                              #StackArrayDatatype
    | LBRACKET RBRACKET datatype                                                #DynamicArrayDatatype
    | LB params RB ARROW datatype requiresBlock?                                #FunctionDatatype
    ;

baseDatatype
    : (MUT | CONST)? (INLINE)? datatypeImpl                                     #DatatypeWithMutability
    | LB datatype RB                                                            #DatatypeInParenthesis
    ;

datatype
    : baseDatatype (SINGLEOR baseDatatype)*                                     #UnionDatatype
    ;

datatypeFragment
    : ID (LANGLE genericLiteral (COMMA genericLiteral)* RANGLE)?
    ;

genericLiteral
    : datatype              #GenericLiteralDatatype
    | literal               #GenericLiteralConstant
    ;

structContent
    : sourceLocationPrefixRule LCURLY structContent* RCURLY                                                 #StructContentWithSourceloc
    | variableMutabilitySpecifier? ID COLON datatype (EQUALS expr)? SEMI?                                    #StructMember
    | static=STATIC? ID (LANGLE ID (COMMA ID)* RANGLE)? LB params RB (COLON datatype)? requiresBlock? (funcbody | SEMI?)    #StructMethod
    | structDefinition                                                                                      #NestedStructDefinition
    ;

structDefinition
    : (export=EXPORT)? (extern=EXTERN externLang=externLanguage)? pub=PUB? noemit=NOEMIT? STRUCT ID (LANGLE ID (COMMA ID)* RANGLE)? requiresBlock? LCURLY (content+=structContent)* RCURLY (SEMI)?
    ;

typeDefinition
    : structDefinition
    ;

// Expressions

sliceIndex
    : expr? COLON expr?
    ;

requiresPart
    // : expr               #RequiresExpr
    : AUTODEST              #RequiresAutodest
    | FINAL                 #RequiresFinal
    | LB requiresPart RB    #RequiresInParens
    ;

requiresBlock
    : DOUBLECOLON requiresPart (COMMA requiresPart)*
    ;

expr
    // https://en.cppreference.com/w/c/language/operator_precedence
    : LB expr RB                                                                    #ParenthesisExpr
    | doScope                                                                       #BlockScopeExpr
    | TYPE LANGLE datatype RANGLE                                                   #TypeLiteralExpr
    | lambda                                                                        #LambdaExpr
    | literal                                                                       #LiteralExpr
    | LBRACKET expr? (COMMA expr)* COMMA? RBRACKET                                  #ArrayLiteral
    | datatype? LCURLY (ID COLON valueExpr+=expr)? (COMMA (ID COLON valueExpr+=expr))* COMMA? RCURLY (IN arenaExpr=expr)?      #StructInstantiationExpr

    // Part 1: Left to right
    | expr op=(PLUSPLUS | MINUSMINUS)                                               #PostIncrExpr
    | callExpr=expr LB (argExpr+=expr (COMMA argExpr+=expr)*)? RB (IN arenaExpr=expr)?                         #ExprCallExpr
    | value=expr LBRACKET (index+=expr) (COMMA index+=expr)* COMMA? RBRACKET        #ArraySubscriptExpr
    | value=expr LBRACKET (index+=sliceIndex) (COMMA index+=sliceIndex)* COMMA? RBRACKET        #ArraySliceExpr
    | expr DOT ID (LANGLE genericLiteral (COMMA genericLiteral)* RANGLE)?           #ExprMemberAccess

    // Part 2: Right to left
    | <assoc=right> op=(MINUSMINUS | PLUSPLUS) expr                                 #PreIncrExpr
    | <assoc=right> op=(PLUS | MINUS) expr                                          #UnaryExpr
    | <assoc=right> op=NOT expr /* and bitwise not */                               #UnaryExpr
    | <assoc=right> expr AS datatype                                                #ExplicitCastExpr
    // | <assoc=right> MUL expr                                                        #DereferenceExpr
    // | <assoc=right> SINGLEAND expr                                                  #AddressOfExpr

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
    | <assoc=right> expr op=(EQUALS|COLONEQUALS|PLUSEQ|MINUSEQ|MULEQ|DIVEQ|MODEQ) expr     #ExprAssignmentExpr

    | ID (LANGLE genericLiteral (COMMA genericLiteral)* RANGLE)?                    #SymbolValueExpr
    ;

// Statements & Conditionals

statement
    : INLINEC LB STRING_LITERAL RB SEMI?                         #CInlineStatement
    | expr SEMI?                                                #ExprStatement
    | RETURN expr? SEMI?                                         #ReturnStatement
    | variableMutabilitySpecifier comptime=COMPTIME? ID (((COLON datatype)? EQUALS expr) | (COLON datatype)) SEMI?       #VariableCreationStatement
    | IF comptime=COMPTIME? ifExpr=expr then=rawScope (ELSE IF elseIfExpr+=expr elseIfThen+=rawScope)* (ELSE elseBlock=rawScope)? #IfStatement
    | FOR comptime=COMPTIME? ID (COMMA ID)? IN expr rawScope       #ForEachStatement
    | WHILE expr rawScope                                          #WhileStatement
    | typeDef                                                   #TypeAliasStatement
    ;
