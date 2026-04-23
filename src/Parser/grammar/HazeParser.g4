
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
    | typeDef SEMI
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

functionDefinition: (export=EXPORT)? (extern=EXTERN externLang=externLanguage? pub=PUB? noemit=NOEMIT?)? FN comptime=COMPTIME? id (LANGLE id (COMMA id)* RANGLE)? LB params RB (COLON typeExpr)? requiresBlock? (DOUBLEARROW)? (funcbody | SEMI?);
lambda: LB params RB (COLON typeExpr)? requiresBlock? DOUBLEARROW funcbody;
param: id QUESTIONMARK? COLON (typeExpr | ellipsis) (EQUALS expr)?;
params: (param (COMMA param)* (COMMA ellipsis)? COMMA?)? | ellipsis;
ellipsis: ELLIPSIS;

funcbody: (rawScope | exprAsFuncbody);
rawScope: LCURLY (statement)* RCURLY;
doScope: DO UNSAFE? LCURLY (statement)* RCURLY;
exprAsFuncbody: expr;

// Variables

globalVariableDef
    : (export=EXPORT)? (extern=EXTERN externLang=externLanguage?)? pub=PUB? variableMutabilitySpecifier comptime=COMPTIME? id (((COLON typeExpr)? EQUALS expr) | (COLON typeExpr)) SEMI?        #GlobalVariableDefinition
    ;

typeDef
    : (export=EXPORT)? (extern=EXTERN externLang=externLanguage?)? pub=PUB? TYPE name=id (LANGLE generic+=id (COMMA generic+=id)* RANGLE)? EQUALS typeExpr        #TypeAliasDirective
    ;

variableMutabilitySpecifier
    : LET                               #VariableLet
    | CONST                             #VariableConst
    ;

// Type Expressions

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

typeExprPrimary
    : nameExpr
    | TYPE LANGLE typeExpr RANGLE
    | LB typeExpr RB
    ;

typeExprPostfix
    : LB argList? RB withAllocator?
    | LBRACKET indexList RBRACKET
    | DOT LBRACKET expr RBRACKET
    | (DOT | QUESTIONDOT) nameSegment
    | QUESTIONEXCL
    | AS typeExpr
    | IS typeExpr
    ;

typeExprSimple
    : typeExprPrimary typeExprPostfix*
    ;

typeExprModified
    : INLINE typeExprModified
    | MUT typeExprModified
    | CONST typeExprModified
    | LBRACKET n=(INTEGER_LITERAL | HEX_INTEGER_LITERAL) RBRACKET typeExprModified
    | LBRACKET RBRACKET typeExprModified
    | LB params RB (DOUBLEARROW | SINGLEARROW) typeExprModified requiresBlock?
    | typeExprSimple
    ;

typeExprUnion
    : typeExprModified (SINGLEOR typeExprModified)*
    ;

typeExpr
    : typeExprUnion
    | NODISCARD? UNION LCURLY (id COLON typeExprUnion COMMA)+ (id COLON typeExprUnion COMMA?) RCURLY
    ;

genericLiteral
    : typeExpr              #GenericLiteralTypeExpr
    | literal               #GenericLiteralConstant
    ;

structContent
    : sourceLocationPrefixRule LCURLY structContent* RCURLY                                                 #StructContentWithSourceloc
    | variableMutabilitySpecifier? id QUESTIONMARK? COLON typeExpr (EQUALS expr)? SEMI?                     #StructMember
    | static=STATIC? mutability=(MUT | CONST)? FN comptime=COMPTIME? name=(RAW_ID | TYPE | OPERATORASSIGN | OPERATORREBIND | OPERATORPLUS | OPERATORMINUS | OPERATORMUL | OPERATORDIV | OPERATORMOD | OPERATORSUBSCRIPT | OPERATORAS | OPERATOREQ | OPERATORNEQ | OPERATORLT | OPERATORGT | OPERATORLTE | OPERATORGTE) (LANGLE generic+=id (COMMA generic+=id)* RANGLE)? LB params RB (COLON typeExpr)? requiresBlock? (funcbody | SEMI?)    #StructMethod
    | structDefinition                                                                                      #NestedStructDefinition
    ;

enumContent
    : id (EQUALS expr)?
    ;

enumDefinition
    : (export=EXPORT)? (extern=EXTERN externLang=externLanguage)? pub=PUB? noemit=NOEMIT? ENUM BITFLAG? UNSCOPED? id requiresBlock? LCURLY (((content+=enumContent COMMA)+ (content+=enumContent COMMA?)?) | (content+=enumContent COMMA?))? RCURLY (SEMI)?
    ;

structDefinition
    : (export=EXPORT)? (extern=EXTERN externLang=externLanguage)? pub=PUB? noemit=NOEMIT? OPAQUE? PLAIN? INLINE? STRUCT id (LANGLE id (COMMA id)* RANGLE)? requiresBlock? LCURLY (content+=structContent)* RCURLY (SEMI)?
    ;

typeDefinition
    : structDefinition
    | enumDefinition
    ;

// Expressions

nameSegment
    : id genericArgs?
    ;

nameExpr
    : nameSegment (DOT nameSegment)*
    ;

primaryExpr
    : LB expr RB
    | doScope
    | TYPE LANGLE typeExpr RANGLE
    | lambda
    | literal
    | interpolatedString
    | arrayExpr
    | braceExpr
    | nameExpr
    ;

subscriptExpr
    : expr
    | start=expr? COLON end=expr?
    ;

requiresPart
    : NORETURN
    | NORETURNIF LB expr RB
    | FINAL
    | PURE
    | LB requiresPart RB
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

postfixExpr
    : primaryExpr postfix*
    ;

prefixExpr
    : preUnaryOp prefixExpr
    | postfixExpr
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

arrayExpr
    : LBRACKET aggregateBody RBRACKET withAllocator?
    ;

braceExpr
    : nameExpr? LCURLY aggregateBody RCURLY withAllocator?
    ;

postfix
    : PLUSPLUS
    | MINUSMINUS
    | LB argList? RB withAllocator?
    | LBRACKET indexList RBRACKET
    | DOT LBRACKET expr RBRACKET
    | (DOT | QUESTIONDOT) nameSegment
    | QUESTIONEXCL
    | AS typeExpr
    | IS typeExpr
    ;

multiplicative
    : prefixExpr ((MUL|DIV|MOD) prefixExpr)*
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
    : logical (QUESTIONMARK expr COLON ternary)?
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

expr
    : assignment
    ;

// Statements & Conditionals

variableCreation
    : variableMutabilitySpecifier comptime=COMPTIME? id (((COLON typeExpr)? EQUALS expr) | (COLON typeExpr)) SEMI? #VariableCreationStatementRule
    ;

ifStatementConditionImpl
    : ifExpr=expr #IfStatementCondition
    | LET id (COLON typeExpr)? EQUALS letExpr=expr (SEMI guardExpr=expr)? #IfLetStatementCondition
    ;

statement
    : INLINEC LB expr RB SEMI?                                                      #CInlineStatement
    | typeDef SEMI                                                                  #TypeAliasStatement
    | expr SEMI                                                                     #ExprStatement
    | RETURN expr? SEMI                                                             #ReturnStatement
    | RAISE expr? SEMI                                                              #RaiseStatement
    | variableCreation                                                              #VariableCreationStatement
    | IF ifCondition=ifStatementConditionImpl then=rawScope (ELSE IF elseIfCondition+=ifStatementConditionImpl elseIfThen+=rawScope)* (ELSE elseBlock=rawScope)? #IfStatement
    | IF COMPTIME ifCondition=ifStatementConditionImpl then=rawScope (ELSE IF COMPTIME elseIfCondition+=ifStatementConditionImpl elseIfThen+=rawScope)* (ELSE elseBlock=rawScope)? #ComptimeIfStatement
    | FOR comptime=COMPTIME? id (COMMA id)? IN expr rawScope                        #ForEachStatement
    | FOR comptime=COMPTIME? LB statement? SEMI condition=expr? SEMI incr=expr? RB rawScope #ForStatement
    | WHILE expr rawScope                                                           #WhileStatement
    | WHILE LET id (COLON typeExpr)? EQUALS expr (SEMI expr)? rawScope              #WhileLetStatement
    ;

// This is a hack-around so the word "type" can be used as variable names without creating a syntax error
id
    : TYPE
    | RAW_ID
    ;
