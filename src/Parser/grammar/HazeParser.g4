
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
    : (importStatements | globalDeclaration)*
    ;

// Imports

importStatements
    : IMPORT (module=id | path=STRING_LITERAL) (AS alias=id)? SEMI?                         #ImportStatement
    | FROM (module=id | path=STRING_LITERAL) IMPORT importAs (COMMA importAs)* SEMI?        #FromImportStatement
    ;

importAs
    : symbol=id (AS alias=id)?
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
    // The cInjectDirective must be here in global and cannot be part of topLevel directly, because
    // MANY declarations start with an optional "export" and it is ambiguous for ANTLR.
    // If "export __c__" is used, it would eagerly commit to globalDeclaration because it matches more tokens,
    // no longer matches cInjectDirective and fails.
    // So ig we have to live with the case that cInject can now live in namespaces
    | cInjectDirective
    ;

namespaceDefinition
    : (export=EXPORT)? NAMESPACE id (DOT id)* LCURLY globalDeclaration* RCURLY
    ;

// Directives

cInjectDirective: (export=EXPORT)? INLINEC LB expr RB SEMI?;

// Functions

externLanguage: id;

functionDefinition: (export=EXPORT)? (extern=EXTERN externLang=externLanguage? pub=PUB? noemit=NOEMIT?)? id (LANGLE id (COMMA id)* RANGLE)? LB params RB (COLON datatype)? requiresBlock? (ARROW)? (funcbody | SEMI?);
lambda: LB params RB (COLON datatype)? requiresBlock? ARROW funcbody;
param: id QUESTIONMARK? COLON (datatype | ellipsis);
params: (param (COMMA param)* (COMMA ellipsis)? COMMA?)? | ellipsis;
ellipsis: ELLIPSIS;

funcbody: (rawScope | exprAsFuncbody);
rawScope: LCURLY (statement)* RCURLY;
doScope: DO UNSAFE? LCURLY (statement)* RCURLY;
exprAsFuncbody: expr;

// Variables

globalVariableDef
    : (export=EXPORT)? (extern=EXTERN externLang=externLanguage?)? pub=PUB? variableMutabilitySpecifier comptime=COMPTIME? id (((COLON datatype)? EQUALS expr) | (COLON datatype)) SEMI?        #GlobalVariableDefinition
    ;

typeDef
    : (export=EXPORT)? (extern=EXTERN externLang=externLanguage?)? pub=PUB? TYPE name=id (LANGLE generic+=id (COMMA generic+=id)* RANGLE)? EQUALS datatype SEMI?        #TypeAliasDirective
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
    | HEX_INTEGER_LITERAL                       #HexIntegerLiteral
    | FLOAT_LITERAL                             #FloatLiteral
    | STRING_LITERAL                            #StringConstant
    | TRIPLE_STRING_LITERAL                     #TripleStringConstant
    | REGEX_LITERAL                             #RegexLiteral
    ;

interpolatedString
    : FSTRING_START (interpolatedStringFragment)* FSTRING_END (WITH allocatorExpr=expr)?            #SingleFString
    | FTRIPLE_STRING_START (interpolatedStringFragment)* FTRIPLE_END (WITH allocatorExpr=expr)?     #TripleFString
    ;

interpolatedStringFragment: FSTRING_GRAPHEME | interpolatedStringExpression;
interpolatedStringExpression: LCURLY expr RCURLY;

datatypeImpl
    : INLINE datatypeImpl                                                       #InlineDatatype
    | MUT datatypeImpl                                                          #MutDatatype
    | CONST datatypeImpl                                                        #ConstDatatype
    | datatypeFragment (DOT datatypeFragment)*                                  #NamedDatatype
    | LBRACKET n=(INTEGER_LITERAL | HEX_INTEGER_LITERAL) RBRACKET datatype      #StackArrayDatatype
    | LBRACKET RBRACKET datatype                                                #DynamicArrayDatatype
    | LB params RB ARROW datatype requiresBlock?                                #FunctionDatatype
    ;

baseDatatype
    : datatypeImpl                                                              #DatatypeWithMutability
    | LB datatype RB                                                            #DatatypeInParenthesis
    ;

datatype
    : baseDatatype (SINGLEOR baseDatatype)*                                     #UntaggedUnionDatatype
    | NODISCARD? UNION LCURLY (id COLON baseDatatype COMMA)+ (id COLON baseDatatype COMMA?) RCURLY   #TaggedUnionDatatype
    ;

datatypeFragment
    : id (LANGLE genericLiteral (COMMA genericLiteral)* RANGLE)?
    ;

genericLiteral
    : datatype              #GenericLiteralDatatype
    | literal               #GenericLiteralConstant
    ;

structContent
    : sourceLocationPrefixRule LCURLY structContent* RCURLY                                                 #StructContentWithSourceloc
    | variableMutabilitySpecifier? id QUESTIONMARK? COLON datatype (EQUALS expr)? SEMI?                     #StructMember
    | static=STATIC? mutability=(MUT | CONST)? name=(RAW_ID | TYPE | OPERATORASSIGN | OPERATORREBIND | OPERATORPLUS | OPERATORMINUS | OPERATORMUL | OPERATORDIV | OPERATORMOD | OPERATORSUBSCRIPT | OPERATORAS) (LANGLE generic+=id (COMMA generic+=id)* RANGLE)? LB params RB (COLON datatype)? requiresBlock? (funcbody | SEMI?)    #StructMethod
    | structDefinition                                                                                      #NestedStructDefinition
    ;

enumContent
    : id (EQUALS expr)?
    ;

enumDefinition
    : (export=EXPORT)? (extern=EXTERN externLang=externLanguage)? pub=PUB? noemit=NOEMIT? ENUM BITFLAG? UNSCOPED? id requiresBlock? LCURLY (((content+=enumContent COMMA)+ (content+=enumContent COMMA?)?) | (content+=enumContent COMMA?))? RCURLY (SEMI)?
    ;

structDefinition
    : (export=EXPORT)? (extern=EXTERN externLang=externLanguage)? pub=PUB? noemit=NOEMIT? OPAQUE? PLAIN? STRUCT id (LANGLE id (COMMA id)* RANGLE)? requiresBlock? LCURLY (content+=structContent)* RCURLY (SEMI)?
    ;

typeDefinition
    : structDefinition
    | enumDefinition
    ;

// Expressions

subscriptExpr
    : expr                  #SubscriptSingleExpr
    | start=expr? COLON end=expr?     #SubscriptSliceExpr
    ;

requiresPart
    // : expr               #RequiresExpr
    : NORETURN                              #RequiresNoreturn
    | NORETURNIF LB expr RB                 #RequiresNoreturnIf
    | FINAL                                 #RequiresFinal
    | PURE                                  #RequiresPure
    | LB requiresPart RB                    #RequiresInParens
    ;

requiresBlock
    : DOUBLECOLON requiresPart (COMMA requiresPart)*
    ;

aggregateLiteralElement
    : (key=id COLON)? value=expr
    ;

genericArgs
    : LANGLE genericLiteral (COMMA genericLiteral)* RANGLE
    ;

withAllocator
    : WITH expr
    ;

prefixExpr
    : LB expr RB
    | doScope
    | TYPE LANGLE datatype RANGLE
    | lambda
    | literal
    | interpolatedString
    | braceExpr
    | id genericArgs?
    | preUnaryOp prefixExpr
    ;

preUnaryOp
    : MINUSMINUS
    | PLUSPLUS
    | PLUS
    | MINUS
    | NOT
    ;

indexList
    : subscriptExpr (COMMA subscriptExpr)* COMMA?
    ;

argList
    : expr (COMMA expr)* COMMA?
    ;

aggregateBody
    : aggregateLiteralElement?
      (COMMA aggregateLiteralElement)*
      COMMA?
    ;

braceExpr
    : datatype LCURLY aggregateBody RCURLY withAllocator?
    | LCURLY aggregateBody RCURLY withAllocator?
    ;

postfixExpr
    : prefixExpr postfix*
    ;

postfix
    : PLUSPLUS
    | MINUSMINUS
    | LB argList? RB withAllocator?
    | LBRACKET indexList RBRACKET
    | (DOT | QUESTIONDOT) id genericArgs?
    | QUESTIONEXCL
    ;

multiplicative
    : postfixExpr ((MUL|DIV|MOD) postfixExpr)*
    ;

additive
    : multiplicative ((PLUS|MINUS) multiplicative)*
    ;

comparison
    : additive ((LANGLE|RANGLE|LEQ|GEQ) additive)*
    ;

equality
    : comparison ((DOUBLEEQUALS|NOTEQUALS) comparison)*
    ;

logical
    : equality ((DOUBLEAND|DOUBLEOR|SINGLEOR) equality)*
    ;

ternary
    : logical ('?' expr ':' ternary)?
    | ATTEMPT rawScope ELSE id? rawScope
    ;

assignment
    : ternary (assignOp assignment)?
    ;

assignOp
    : EQUALS
    | COLONEQUALS
    | PLUSEQ
    | MINUSEQ
    | MULEQ
    | DIVEQ
    | MODEQ
    ;

typeExpr
    : logical
    | logical (AS | IS) typeExpr
    ;

expr
    : assignment
    ;

// expr
//     // https://en.cppreference.com/w/c/language/operator_precedence
//     : LB expr RB                                                                    #ParenthesisExpr
//     | doScope                                                                       #BlockScopeExpr
//     | TYPE LANGLE datatype RANGLE                                                   #TypeLiteralExpr
//     | lambda                                                                        #LambdaExpr
//     | literal                                                                       #LiteralExpr
//     | interpolatedString                                                            #FStringLiteralExpr
//     | datatype? LCURLY aggregateLiteralElement? (COMMA aggregateLiteralElement)* COMMA? RCURLY (WITH allocatorExpr=expr)?      #AggregateLiteralExpr

//     // Part 1: Left to right
//     | expr op=(PLUSPLUS | MINUSMINUS)                                               #PostIncrExpr
//     | callExpr=expr LB (argExpr+=expr (COMMA argExpr+=expr)* COMMA?)? RB (WITH allocatorExpr=expr)?                  #ExprCallExpr
//     | value=expr LBRACKET (index+=subscriptExpr) (COMMA index+=subscriptExpr)* COMMA? RBRACKET          #ArraySubscriptExpr
//     | expr (DOT | QUESTIONDOT) id (LANGLE genericLiteral (COMMA genericLiteral)* RANGLE)?              #ExprMemberAccess
//     | expr QUESTIONEXCL                                                             #PostfixResultPropagationExpr

//     // Part 2: Right to left
//     | <assoc=right> op=(MINUSMINUS | PLUSPLUS) expr                                 #PreIncrExpr
//     | <assoc=right> op=(PLUS | MINUS) expr                                          #UnaryExpr
//     | <assoc=right> op=NOT expr /* and bitwise not */                               #UnaryExpr
//     | <assoc=right> expr AS datatype                                                #ExplicitCastExpr
//     | <assoc=right> expr IS datatype                                                #ExprIsTypeExpr
//     // | <assoc=right> MUL expr                                                     #DereferenceExpr
//     // | <assoc=right> SINGLEAND expr                                               #AddressOfExpr

//     // Part 3: Left to right
//     | expr op+=(MUL|DIV|MOD) expr                                                   #BinaryExpr
//     | expr op+=(PLUS|MINUS) expr                                                    #BinaryExpr
//     // | expr ('<<'|'>>') expr                                                      #BinaryExpr
//     | expr op+=(LANGLE|RANGLE|LEQ|GEQ) expr                                         #BinaryExpr
//     | expr (op+=DOUBLEEQUALS|op+=NOTEQUALS) expr                                    #BinaryExpr
//     // | expr ('&') expr                                                            #BinaryExpr
//     // | expr ('^') expr                                                            #BinaryExpr
//     | expr op+=SINGLEOR expr                                                        #BinaryExpr
//     | expr op+=(DOUBLEAND|DOUBLEOR) expr                                            #BinaryExpr
    
//     // Ternary-like control expressions
//     // <- ternary
//     | expr QUESTIONMARK expr COLON expr                                             #TernaryExpr
//     | ATTEMPT rawScope ELSE (id)? rawScope                                          #AttemptExpr

//     // Assignment
//     | <assoc=right> expr op=(EQUALS|COLONEQUALS|PLUSEQ|MINUSEQ|MULEQ|DIVEQ|MODEQ) expr     #ExprAssignmentExpr

//     | id (LANGLE genericLiteral (COMMA genericLiteral)* RANGLE)?                    #SymbolValueExpr
//     ;

// Statements & Conditionals

variableCreation
    : variableMutabilitySpecifier comptime=COMPTIME? id (((COLON datatype)? EQUALS expr) | (COLON datatype)) SEMI? #VariableCreationStatementRule
    ;

ifStatementConditionImpl
    : ifExpr=expr #IfStatementCondition
    | LET id (COLON datatype)? EQUALS letExpr=expr (SEMI guardExpr=expr)? #IfLetStatementCondition
    ;

statement
    : INLINEC LB expr RB SEMI?                                                      #CInlineStatement
    | expr SEMI?                                                                    #ExprStatement
    | RETURN expr? SEMI?                                                            #ReturnStatement
    | RAISE expr? SEMI?                                                             #RaiseStatement
    | variableCreation                                                              #VariableCreationStatement
    | IF comptime=COMPTIME? ifCondition=ifStatementConditionImpl then=rawScope (ELSE IF elseIfCondition+=ifStatementConditionImpl elseIfThen+=rawScope)* (ELSE elseBlock=rawScope)? #IfStatement
    | FOR comptime=COMPTIME? id (COMMA id)? IN expr rawScope                        #ForEachStatement
    | FOR comptime=COMPTIME? LB statement? SEMI condition=expr? SEMI incr=expr? RB rawScope #ForStatement
    | WHILE expr rawScope                                                           #WhileStatement
    | WHILE LET id (COLON datatype)? EQUALS expr (SEMI expr)? rawScope              #WhileLetStatement
    | typeDef                                                                       #TypeAliasStatement
    ;

// This is a hack-around so the word "type" can be used as variable names without creating a syntax error
id
    : TYPE
    | RAW_ID
    ;