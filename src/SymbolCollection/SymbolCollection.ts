import {
  assert,
  CompilerError,
  formatSourceLoc,
  InternalError,
  type SourceLoc,
} from "../shared/Errors";
import {
  EExternLanguage,
  type ASTBinaryExpr,
  type ASTConstant,
  type ASTConstantExpr,
  type ASTDatatype,
  type ASTExplicitCastExpr,
  type ASTExprAsFuncbody,
  type ASTExprAssignmentExpr,
  type ASTExprCallExpr,
  type ASTExprMemberAccess,
  type ASTFunctionDefinition,
  type ASTGlobalVariableDefinition,
  type ASTLambdaExpr,
  type ASTNamedDatatype,
  type ASTNamespaceDefinition,
  type ASTParenthesisExpr,
  type ASTPostIncrExpr,
  type ASTPreIncrExpr,
  type ASTPointerAddressOfExpr,
  type ASTPointerDereferenceExpr,
  type ASTRoot,
  type ASTScope,
  type ASTStructDefinition,
  type ASTStructInstantiationExpr,
  type ASTSymbolValueExpr,
  type ASTUnaryExpr,
  type ASTVariableDefinitionStatement,
} from "../shared/AST";
import {
  assertScope,
  EMethodType,
  EPrimitive,
  EVariableContext,
  primitiveToString,
} from "../shared/common";
import { makeModulePrefix } from "../Module";

import type {
  ASTCInjectDirective,
  ASTExpr,
  ASTStatement,
  ASTStructMemberDefinition,
  ASTStructMethodDefinition,
  EBinaryOperation,
  EVariableMutability,
} from "../shared/AST";
import type { ModuleConfig } from "../shared/Config";

function exportMermaidScopeTree(cc: CollectionContext): string {
  let output = "";
  // output += `\`\`\`mermaid\n`;
  output += `graph TD\n`;

  // for (const sc of defineQuery([Collect.ModuleScopeComponent])(cc.collectWorld)) {
  //   output += `  E${sc}["Module Scope"]\n`;
  // }

  // for (const sc of defineQuery([Collect.UnitScopeComponent])(cc.collectWorld)) {
  //   const parent = Collect.UnitScopeComponent.moduleScope[sc];
  //   output += `  E${sc}["Unit Scope"] --> E${parent}\n`;
  // }

  // for (const sc of defineQuery([Collect.FileScopeComponent])(cc.collectWorld)) {
  //   const parent = Collect.FileScopeComponent.unitScope[sc];
  //   const filename = cc.idToString.get(Collect.FileScopeComponent.filename[sc]);
  //   output += `  E${sc}["${filename}"] --> E${parent}\n`;
  // }

  // for (const ns of defineQuery([Collect.NamespaceSymbolComponent])(cc.collectWorld)) {
  //   const parent = Collect.NamespaceSymbolComponent.parentScope[ns];
  //   const name = cc.idToString.get(Collect.NamespaceSymbolComponent.name[ns]);
  //   output += `  E${ns}["Namespace ${name}"] --> E${parent}\n`;
  // }

  // for (const ns of defineQuery([Collect.FunctionSymbolComponent])(cc.collectWorld)) {
  //   const parent = Collect.FunctionSymbolComponent.parentScope[ns];
  //   const overloadGroup = Collect.FunctionSymbolComponent.overloadGroup[ns];
  //   output += `  E${ns}["Function Symbol"] --> E${parent}\n`;
  //   output += `  E${ns} --> E${overloadGroup}\n`;
  // }

  // for (const ns of defineQuery([Collect.FunctionOverloadGroupComponent])(cc.collectWorld)) {
  //   const parent = Collect.FunctionOverloadGroupComponent.parentScope[ns];
  //   const name = cc.idToString.get(Collect.FunctionOverloadGroupComponent.name[ns]);
  //   output += `  E${ns}["Function '${name}' Overload"] --> E${parent}\n`;
  // }

  // output += "\n\`\`\`";
  return output;
}

export type CollectionContext = {
  config: ModuleConfig;
  entities: Collect.Symbol[];

  // Helper utilities
  overloadGroups: Set<number>;
  blockScopes: Set<number>;
};

export function makeCollectionContext(config: ModuleConfig): CollectionContext {
  const cc: CollectionContext = {
    config: config,
    entities: [
      {
        variant: Collect.EEntityType.ModuleScope,
      },
    ],
    blockScopes: new Set(),
    overloadGroups: new Set(),
  };
  return cc;
}

export namespace Collect {
  export const enum EEntityType {
    ModuleScope,
    UnitScope,
    FileScope,
    FunctionScope,
    StructScope,
    NamespaceScope,
    BlockScope,
    FunctionOverloadGroup,
    FunctionSymbol,
    VariableSymbol,
    GlobalVariableDefinition,
    NamedDatatype,
    ReferenceDatatype,
    PointerDatatype,
    StructDefinitionSymbol,
    NamespaceDefinitionSymbol,
    GenericTypeParameter,
    ExprStatement,
    IfStatement,
    WhileStatement,
    ReturnStatement,
    InlineCStatement,
    BlockScopeStatement,
    VariableDefinitionStatement,
    ParenthesisExpr,
    BinaryExpr,
    UnaryExpr,
  }

  /// ===============================================================
  /// ===                         Scopes                          ===
  /// ===============================================================

  export type ModuleScope = {
    variant: EEntityType.ModuleScope;
  };

  export type UnitScope = {
    variant: EEntityType.UnitScope;
    parentScope: number;
  };

  export type FileScope = {
    variant: EEntityType.FileScope;
    filepath: string;
    parentScope: number;
    symbols: number[];
  };

  export type FunctionScope = {
    variant: EEntityType.FunctionScope;
    parentScope: number;
    owningSymbol: number;
    sourceloc: SourceLoc;
    blockScope: number;
    symbols: number[];
  };

  export type StructScope = {
    variant: EEntityType.StructScope;
    parentScope: number;
    owningSymbol: number;
    sourceloc: SourceLoc;
    blockScope: number;
    symbols: number[];
  };

  export type NamespaceScope = {
    variant: EEntityType.NamespaceScope;
    parentScope: number;
    owningSymbol: number;
    sourceloc: SourceLoc;
    symbols: number[];
  };

  export type BlockScope = {
    variant: EEntityType.BlockScope;
    parentScope: number;
    owningSymbol: number;
    sourceloc: SourceLoc;
    statements: number[];
    symbols: number[];
  };

  export type Scope =
    | ModuleScope
    | UnitScope
    | FileScope
    | FunctionScope
    | StructScope
    | NamespaceScope
    | BlockScope;

  /// ===============================================================
  /// ===                       Overloads                         ===
  /// ===============================================================

  export type FunctionOverloadGroup = {
    variant: EEntityType.FunctionOverloadGroup;
    parentScope: number;
    name: string;
    overloads: number[];
  };

  export type Overloads = FunctionOverloadGroup;

  /// ===============================================================
  /// ===                          Symbols                        ===
  /// ===============================================================

  export type FunctionSymbol = {
    variant: EEntityType.FunctionSymbol;
    parentScope: number;
    overloadGroup: number;
    returnType: number | null;
    parameters: {
      name: string;
      type: number;
    }[];
    export: boolean;
    pub: boolean;
    extern: EExternLanguage;
    sourceloc: SourceLoc;
    functionScope: number | null;
  };

  export type VariableSymbol = {
    variant: EEntityType.VariableSymbol;
    name: string;
    inScope: number;
    type: number | null;
    mutability: EVariableMutability;
    variableContext: EVariableContext;
    sourceloc: SourceLoc;
  };

  export type GlobalVariableDefinition = {
    variant: EEntityType.GlobalVariableDefinition;
    variableSymbol: number;
    value: number | null;
    sourceloc: SourceLoc;
  };

  // export const VariableSymbolComponent = defineComponent({
  //   parentScope: Types.eid,
  //   name: Types.eid,
  //   type: Types.eid,
  //   sourceloc: Types.eid,
  //   bindingMutability: Types.ui8,
  // });

  export type Symbols = FunctionSymbol | VariableSymbol | GlobalVariableDefinition;

  /// ===============================================================
  /// ===                       Type Symbols                      ===
  /// ===============================================================

  export type NamedDatatype = {
    variant: EEntityType.NamedDatatype;
    name: string;
    sourceloc: SourceLoc;
  };

  export type PointerDatatype = {
    variant: EEntityType.PointerDatatype;
    pointee: number;
    sourceloc: SourceLoc;
  };

  export type ReferenceDatatype = {
    variant: EEntityType.ReferenceDatatype;
    referee: number;
    sourceloc: SourceLoc;
  };

  export type StructDefinitionSymbol = {
    variant: EEntityType.StructDefinitionSymbol;
    parentScope: number;
    name: string;
    export: boolean;
    pub: boolean;
    extern: EExternLanguage;
    sourceloc: SourceLoc;
    structScope: number | null;
  };

  export type NamespaceDefinitionSymbol = {
    variant: EEntityType.NamespaceDefinitionSymbol;
    parentScope: number;
    name: string;
    extern: EExternLanguage;
    pub: boolean;
    export: boolean;
    sourceloc: SourceLoc;
    namespaceScope: number;
  };

  export type GenericTypeParameter = {
    variant: EEntityType.GenericTypeParameter;
    name: string;
    owningSymbol: number;
    sourceloc: SourceLoc;
  };

  export type Datatypes =
    | NamedDatatype
    | PointerDatatype
    | ReferenceDatatype
    | StructDefinitionSymbol
    | NamespaceDefinitionSymbol
    | GenericTypeParameter;

  /// ===============================================================
  /// ===                       Statements                        ===
  /// ===============================================================

  type BaseStatement = {
    owningScope: number;
    sourceloc: SourceLoc;
  };

  export type ExprStatement = BaseStatement & {
    variant: EEntityType.ExprStatement;
    expr: number;
  };

  export type InlineCStatement = BaseStatement & {
    variant: EEntityType.InlineCStatement;
    value: string;
  };

  export type ReturnStatement = BaseStatement & {
    variant: EEntityType.ReturnStatement;
    expr: number | null;
  };

  export type BlockScopeStatement = BaseStatement & {
    variant: EEntityType.BlockScopeStatement;
    blockscope: number;
  };

  export type IfStatement = BaseStatement & {
    variant: EEntityType.IfStatement;
    condition: number;
    thenBlock: number;
    elseif: {
      condition: number;
      thenBlock: number;
    }[];
    elseBlock: number | null;
  };

  export type WhileStatement = BaseStatement & {
    variant: EEntityType.WhileStatement;
    condition: number;
    block: number;
  };

  export type VariableDefinitionStatement = BaseStatement & {
    variant: EEntityType.VariableDefinitionStatement;
    variableSymbol: number;
    value: number | null;
  };

  export type Statements =
    | ExprStatement
    | InlineCStatement
    | ReturnStatement
    | BlockScopeStatement
    | IfStatement
    | WhileStatement
    | VariableDefinitionStatement;

  export type StatementsWithoutOwningScope =
    | Omit<ExprStatement, "owningScope">
    | Omit<InlineCStatement, "owningScope">
    | Omit<ReturnStatement, "owningScope">
    | Omit<BlockScopeStatement, "owningScope">
    | Omit<IfStatement, "owningScope">
    | Omit<WhileStatement, "owningScope">
    | Omit<VariableDefinitionStatement, "owningScope">;

  /// ===============================================================
  /// ===                      Expressions                        ===
  /// ===============================================================

  type BaseExpr = {
    sourceloc: SourceLoc;
  };

  export type ParenthesisExpr = BaseExpr & {
    variant: EEntityType.ParenthesisExpr;
    expr: number;
  };

  export type BinaryExpr = BaseExpr & {
    variant: EEntityType.BinaryExpr;
    left: number;
    right: number;
    operation: EBinaryOperation;
  };

  export type UnaryExpr = BaseExpr & {
    variant: EEntityType.UnaryExpr;
    expr: number;
    operation: EBinaryOperation;
  };

  export type Expressions = ParenthesisExpr | BinaryExpr | UnaryExpr;

  // export class Scope {
  //   variant = "Collect.ScopeClass" as const;
  //   id: string;
  //   rawStatements: ASTStatement[] = [];
  //   symbols: string[] = [];

  //   private static nextId = 1;

  //   constructor(modulePrefix: string, public sourceloc: SourceLoc, public parentScope?: string) {
  //     this.id = `${modulePrefix}.scope.${Scope.nextId++} `;
  //   }

  //   static rebuild(input: Scope) {
  //     // Rebuild class instance if it was JSON deserialized, so methods work
  //     const scope = new Scope("", null, undefined);
  //     Scope.nextId--;
  //     scope.variant = input.variant;
  //     scope.id = input.id;
  //     scope.rawStatements = input.rawStatements;
  //     scope.symbols = input.symbols;
  //     scope.sourceloc = input.sourceloc;
  //     scope.parentScope = input.parentScope;
  //     return scope;
  //   }

  //   defineSymbol(cc: CollectionContext, symbol: Symbol) {
  //     if (this.tryLookupSymbolHere(cc, symbol.name)) {
  //       throw new InternalError(
  //         `Symbol '${symbol.name}' already exists in symbol table`,
  //         undefined,
  //         1
  //       );
  //     }
  //     this.symbols.push(symbol.id);
  //   }

  //   tryLookupSymbol(cc: CollectionContext, name: string, loc: SourceLoc): Symbol | undefined {
  //     const _symbol = this.symbols.find((s) => {
  //       const sym = getSymbol(cc, s);
  //       return "name" in sym && sym.name === name;
  //     });
  //     const symbol = _symbol && getSymbol(cc, _symbol);
  //     if (symbol) {
  //       return symbol;
  //     }

  //     if (this.parentScope) {
  //       const parent = cc.scopes.get(this.parentScope);
  //       assert(parent);
  //       return parent.tryLookupSymbol(cc, name, loc);
  //     }
  //     return undefined;
  //   }

  //   tryLookupSymbolHere(cc: CollectionContext, name: string): Symbol | undefined {
  //     const symbol = this.symbols.find((s) => {
  //       const sym = getSymbol(cc, s);
  //       return "name" in sym && sym.name === name;
  //     });
  //     if (symbol) {
  //       return getSymbol(cc, symbol);
  //     }
  //     return undefined;
  //   }

  //   lookupSymbol(cc: CollectionContext, name: string, loc: SourceLoc): Symbol {
  //     const symbol = this.tryLookupSymbol(cc, name, loc);
  //     if (symbol) {
  //       return symbol;
  //     }
  //     throw new CompilerError(`Symbol '${name}' was not declared in this scope`, loc);
  //   }
  // }

  export type Symbol = Scope | Overloads | Symbols | Datatypes | Statements | Expressions;
}

// export function getScope(cc: CollectionContext, id: string) {
//   const scope = cc.scopes.get(id);
//   assert(scope);
//   return scope;
// }

// export function getSymbol(cc: CollectionContext, id: string) {
//   const symbol = cc.symbols.get(id);
//   if (!symbol) {
//     console.error(id)
//     assert(symbol);
//   }
//   return symbol;
// }

// export function makeScope(cc: CollectionContext, sourceloc: SourceLoc, parentScope: string) {
//   const scope = new Collect.Scope(makeModulePrefix(cc.config), sourceloc, parentScope);
//   cc.scopes.set(scope.id, scope);
//   return scope.id;
// }

export function makeSymbol(cc: CollectionContext, symbol: Collect.Symbol): number {
  cc.entities.push(symbol);
  return cc.entities.length - 1;
}

function makeOverloadGroupAvailable(cc: CollectionContext, parentScope: number, name: string) {
  for (const group of cc.overloadGroups) {
    const og = cc.entities[group];
    assert(og.variant === Collect.EEntityType.FunctionOverloadGroup);
    if (og.parentScope === parentScope && og.name === name) {
      return group;
    }
  }
  const g = makeSymbol(cc, {
    variant: Collect.EEntityType.FunctionOverloadGroup,
    name: name,
    overloads: [],
    parentScope: parentScope,
  });
  cc.overloadGroups.add(g);
  return g;
}

function makeBlockScope(cc: CollectionContext, parentScope: number, sourceloc: SourceLoc): number {
  const parent = cc.entities[parentScope];
  assert(
    parent.variant === Collect.EEntityType.BlockScope ||
      parent.variant === Collect.EEntityType.FunctionScope
  );
  const scope = makeSymbol(cc, {
    variant: Collect.EEntityType.BlockScope,
    owningSymbol: parent.owningSymbol,
    parentScope: parentScope,
    statements: [],
    sourceloc: sourceloc,
    symbols: [],
  });
  cc.blockScopes.add(scope);
  return scope;
}

function addStatement(
  cc: CollectionContext,
  parentScope: number,
  statement: Collect.StatementsWithoutOwningScope
) {
  const parent = cc.entities[parentScope];
  assert(parent.variant === Collect.EEntityType.BlockScope);
  const st = makeSymbol(cc, {
    ...statement,
    owningScope: parentScope,
  });
  parent.statements.push(st);
  return st;
}

function defineGenericTypeParameter(
  cc: CollectionContext,
  name: string,
  functionOrStructScopeId: number,
  sourceloc: SourceLoc
) {
  const functionOrStructScope = cc.entities[functionOrStructScopeId];
  assert(
    functionOrStructScope.variant === Collect.EEntityType.FunctionScope ||
      functionOrStructScope.variant === Collect.EEntityType.StructScope
  );
  const owner = cc.entities[functionOrStructScope.owningSymbol];
  assert(
    owner.variant === Collect.EEntityType.FunctionSymbol ||
      owner.variant === Collect.EEntityType.StructDefinitionSymbol
  );
  const gg = makeSymbol(cc, {
    variant: Collect.EEntityType.GenericTypeParameter,
    name: name,
    owningSymbol: functionOrStructScope.owningSymbol,
    sourceloc: sourceloc,
  });
  functionOrStructScope.symbols.push(gg);
  return gg;
}

function defineVariableSymbol(
  cc: CollectionContext,
  variable: Omit<Collect.VariableSymbol, "inScope">,
  scope: number
) {
  const sc = cc.entities[scope];
  assert(
    sc.variant === Collect.EEntityType.FileScope ||
      sc.variant === Collect.EEntityType.BlockScope ||
      sc.variant === Collect.EEntityType.FunctionScope ||
      sc.variant === Collect.EEntityType.StructScope
  );

  for (const id of sc.symbols) {
    const s = cc.entities[id];
    if (s.variant === Collect.EEntityType.VariableSymbol && s.name === variable.name) {
      throw new CompilerError(
        `Symbol '${variable.name}' was already declared in this scope. Previous definition: ${
          (s.sourceloc && formatSourceLoc(s.sourceloc)) || ""
        }`,
        variable.sourceloc
      );
    }
  }

  const varsym = makeSymbol(cc, {
    ...variable,
    inScope: scope,
  });
  sc.symbols.push(varsym);
  return varsym;
}

function collect(
  cc: CollectionContext,
  item:
    | ASTDatatype
    | ASTStructDefinition
    | ASTExpr
    | ASTScope
    | ASTStatement
    | ASTCInjectDirective
    | ASTNamespaceDefinition
    | ASTFunctionDefinition
    | ASTGlobalVariableDefinition
    | ASTNamespaceDefinition
    | ASTScope
    | ASTParenthesisExpr
    | ASTExprAssignmentExpr
    | ASTExprCallExpr
    | ASTUnaryExpr
    | ASTExprMemberAccess
    | ASTLambdaExpr
    | ASTPreIncrExpr
    | ASTConstantExpr
    | ASTPointerAddressOfExpr
    | ASTPointerDereferenceExpr
    | ASTPostIncrExpr
    | ASTStructInstantiationExpr
    | ASTExplicitCastExpr
    | ASTBinaryExpr
    | ASTExprAsFuncbody
    | ASTSymbolValueExpr
    | ASTStructDefinition
    | ASTDatatype,
  args: {
    currentParentScope: number;
  }
): number {
  switch (item.variant) {
    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "FunctionDefinition": {
      const overloadGroup = makeOverloadGroupAvailable(cc, args.currentParentScope, item.name);

      const functionSymbol = makeSymbol(cc, {
        variant: Collect.EEntityType.FunctionSymbol,
        export: item.export,
        extern: item.externLanguage,
        overloadGroup: overloadGroup,
        parameters: item.params.map((p) => ({
          name: p.name,
          type: collect(cc, p.datatype, args),
        })),
        parentScope: args.currentParentScope,
        pub: item.pub,
        returnType: (item.returnType && collect(cc, item.returnType, args)) || null,
        sourceloc: item.sourceloc,
        functionScope: null,
      });

      console.warn("TODO: Check if function is redefined with conflicting parameters");

      if (item.funcbody) {
        const funcSym = cc.entities[functionSymbol];
        assert(funcSym.variant === Collect.EEntityType.FunctionSymbol);

        const functionScope = makeSymbol(cc, {
          variant: Collect.EEntityType.FunctionScope,
          owningSymbol: functionSymbol,
          parentScope: args.currentParentScope,
          sourceloc: item.sourceloc,
          blockScope: -1,
          symbols: [],
        });

        if (item.funcbody.variant === "ExprAsFuncBody") {
          item.funcbody = {
            variant: "Scope",
            statements: [
              {
                variant: "ReturnStatement",
                sourceloc: item.sourceloc,
                expr: item.funcbody.expr,
              },
            ],
            sourceloc: item.sourceloc,
          };
        }

        const blockScope = collect(cc, item.funcbody, {
          currentParentScope: functionScope,
        });
        (cc.entities[functionScope] as Collect.FunctionScope).blockScope = blockScope;

        for (const g of item.generics) {
          defineGenericTypeParameter(cc, g.name, functionScope, g.sourceloc);
        }

        console.warn("TODO: Define parameters as symbols");
      }

      break;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExprAsFuncBody":
      throw new InternalError("This is handled elsewhere");

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "GlobalVariableDefinition": {
      const variableSymbol = defineVariableSymbol(
        cc,
        {
          variant: Collect.EEntityType.VariableSymbol,
          name: item.name,
          type:
            (item.datatype &&
              collect(cc, item.datatype, { currentParentScope: args.currentParentScope })) ||
            null,
          mutability: item.mutability,
          variableContext: EVariableContext.Global,
          sourceloc: item.sourceloc,
        },
        args.currentParentScope
      );
      const globvar = makeSymbol(cc, {
        variant: Collect.EEntityType.GlobalVariableDefinition,
        value:
          (item.expr && collect(cc, item.expr, { currentParentScope: args.currentParentScope })) ||
          null,
        variableSymbol: variableSymbol,
        sourceloc: item.sourceloc,
      });
      const parentScope = cc.entities[args.currentParentScope];
      assert(
        parentScope.variant === Collect.EEntityType.FileScope ||
          parentScope.variant === Collect.EEntityType.NamespaceScope
      );
      parentScope.symbols.push(globvar);
      break;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "NamespaceDefinition": {
      const parent = cc.entities[args.currentParentScope];
      assert(
        parent.variant === Collect.EEntityType.FileScope ||
          parent.variant === Collect.EEntityType.NamespaceScope
      );

      let existingNamespace = -1;
      for (const id of parent.symbols) {
        const sym = cc.entities[id];
        if (sym.variant === Collect.EEntityType.NamespaceDefinitionSymbol) {
          if (sym.name === item.name) {
            existingNamespace = id;
            break;
          }
        } else if (sym.variant === Collect.EEntityType.StructDefinitionSymbol) {
          throw new CompilerError(
            `Symbol '${
              item.name
            }' has already been declared as a Struct, which cannot be extended by a namespace. Original definition: ${
              (sym.sourceloc && formatSourceLoc(sym.sourceloc)) || ""
            }`,
            item.sourceloc
          );
        }
      }

      if (existingNamespace === -1) {
        existingNamespace = makeSymbol(cc, {
          variant: Collect.EEntityType.NamespaceDefinitionSymbol,
          name: item.name,
          export: item.export,
          // extern: item.
          extern: EExternLanguage.None,
          pub: false,
          namespaceScope: -1,
          parentScope: args.currentParentScope,
          sourceloc: item.sourceloc,
        });
        const namespaceScope = makeSymbol(cc, {
          variant: Collect.EEntityType.NamespaceScope,
          owningSymbol: existingNamespace,
          parentScope: args.currentParentScope,
          sourceloc: item.sourceloc,
          symbols: [],
        });
        (cc.entities[existingNamespace] as Collect.NamespaceDefinitionSymbol).namespaceScope =
          namespaceScope;
      }

      for (const s of item.declarations) {
        // collect(cc, s, {
        //   currentParentScope: existingNamespace,
        // });
        console.log("push back into namespace now");
      }
      break;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "StructDefinition":
      return;
      item._collect.definedInScope = functionScope.id;
      item._collect.scope = makeScope(cc, item.sourceloc, functionScope.id);
      item._collect.namespaces = meta.namespaceStack.map((n) => n.name);
      item._collect.definedInNamespaceOrStruct = meta.currentNamespaceOrStruct?.id;
      item._collect.fullNamespacedName = [...item._collect.namespaces, item.name];
      for (const g of item.generics) {
        getScope(cc, item._collect.scope).defineSymbol(cc, g);
      }

      const alreadyExists = functionScope.tryLookupSymbolHere(cc, item.name);
      if (alreadyExists) {
        const msg =
          (alreadyExists.sourceloc &&
            `Conflicting declaration at ${formatSourceLoc(alreadyExists.sourceloc)}`) ||
          "";
        throw new CompilerError(
          `Symbol ${item.name} already exists in this scope. ${msg}`,
          item.sourceloc
        );
      }
      functionScope.defineSymbol(cc, item);
      cc.symbols.set(item.id, item);

      const newMeta = {
        ...meta,
        currentNamespaceOrStruct: item,
        namespaceStack: [...meta.namespaceStack, item],
      };

      for (const decl of item.declarations) {
        collect(cc, getScope(cc, item._collect.scope), decl, newMeta);
      }

      for (const m of item.members) {
        collect(cc, getScope(cc, item._collect.scope), m.type, newMeta);
      }

      for (const method of item.methods) {
        method.declarationScope = makeScope(cc, item.sourceloc, item._collect.scope);
        if (method.funcbody) {
          method.funcbody._collect.scope = makeScope(cc, item.sourceloc, method.declarationScope);
        }

        if (!method.returnType) {
          method.returnType = {
            variant: "NamedDatatype",
            name: "none",
            cstruct: false,
            generics: [],
            sourceloc: item.sourceloc,
            _collect: {},
          };
        }

        method._collect.fullNamespacePath = [
          ...meta.namespaceStack.map((n) => n.name),
          method.name,
        ];
        method._collect.definedInScope = item._collect.scope;

        for (const g of method.generics) {
          getScope(cc, method.declarationScope).defineSymbol(cc, g);
        }

        if (method.funcbody?._collect.scope) {
          if (!method.static && method.name !== "constructor") {
            const s: ASTVariableDefinitionStatement = {
              variant: "VariableDefinitionStatement",
              id:
                makeModulePrefix(cc.config) + ".vardef." + (cc.config.symbolIdCounter++).toString(),
              mutability: false,
              name: "this",
              sourceloc: method.sourceloc,
              datatype: undefined,
              variableContext: EVariableContext.ThisReference,
              _semantic: {},
            };
            getScope(cc, method.funcbody._collect.scope).defineSymbol(cc, s);
            cc.symbols.set(s.id, s);
          }

          for (const param of method.params) {
            const s: ASTVariableDefinitionStatement = {
              variant: "VariableDefinitionStatement",
              id:
                makeModulePrefix(cc.config) + ".vardef." + (cc.config.symbolIdCounter++).toString(),
              mutability: false,
              name: param.name,
              datatype: param.datatype,
              sourceloc: param.sourceloc,
              variableContext: EVariableContext.FunctionParameter,
              _semantic: {},
            };
            getScope(cc, method.funcbody._collect.scope).defineSymbol(cc, s);
            cc.symbols.set(s.id, s);
            collect(cc, getScope(cc, method.declarationScope), param.datatype, newMeta);
          }
          if (method.returnType) {
            collect(cc, getScope(cc, method.declarationScope), method.returnType, newMeta);
          }
          collect(cc, getScope(cc, method.funcbody._collect.scope), method.funcbody, newMeta);
        }
      }
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "NamedDatatype": {
      console.warn("TODO: Properly read named datatype with generics and nesting");
      return makeSymbol(cc, {
        variant: Collect.EEntityType.NamedDatatype,
        name: item.name,
        // referee: collect(cc, item.n, args),
        sourceloc: item.sourceloc,
      });
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "PointerDatatype": {
      return makeSymbol(cc, {
        variant: Collect.EEntityType.PointerDatatype,
        pointee: collect(cc, item.pointee, args),
        sourceloc: item.sourceloc,
      });
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ReferenceDatatype": {
      return makeSymbol(cc, {
        variant: Collect.EEntityType.ReferenceDatatype,
        referee: collect(cc, item.referee, args),
        sourceloc: item.sourceloc,
      });
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "CInjectDirective": {
      console.warn("TODO: C Inject Directive");
      break;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "Scope": {
      const blockScope = makeBlockScope(cc, args.currentParentScope, item.sourceloc);
      for (const astStatement of item.statements) {
        switch (astStatement.variant) {
          case "ExprStatement": {
            addStatement(cc, blockScope, {
              variant: Collect.EEntityType.ExprStatement,
              expr: collect(cc, astStatement.expr, { currentParentScope: blockScope }),
              sourceloc: astStatement.sourceloc,
            });
            break;
          }

          case "IfStatement": {
            addStatement(cc, blockScope, {
              variant: Collect.EEntityType.IfStatement,
              condition: collect(cc, astStatement.condition, { currentParentScope: blockScope }),
              elseBlock:
                (astStatement.else &&
                  collect(cc, astStatement.else, { currentParentScope: blockScope })) ||
                null,
              thenBlock: collect(cc, astStatement.then, { currentParentScope: blockScope }),
              elseif: astStatement.elseIfs.map((e) => ({
                condition: collect(cc, e.condition, { currentParentScope: blockScope }),
                thenBlock: collect(cc, e.then, { currentParentScope: blockScope }),
              })),
              sourceloc: astStatement.sourceloc,
            });
            break;
          }

          case "InlineCStatement": {
            addStatement(cc, blockScope, {
              variant: Collect.EEntityType.InlineCStatement,
              value: astStatement.code,
              sourceloc: astStatement.sourceloc,
            });
            break;
          }

          case "ReturnStatement":
            addStatement(cc, blockScope, {
              variant: Collect.EEntityType.ReturnStatement,
              expr:
                (astStatement.expr &&
                  collect(cc, astStatement.expr, { currentParentScope: blockScope })) ||
                null,
              sourceloc: astStatement.sourceloc,
            });
            break;

          case "WhileStatement":
            addStatement(cc, blockScope, {
              variant: Collect.EEntityType.WhileStatement,
              condition: collect(cc, astStatement.condition, { currentParentScope: blockScope }),
              block: collect(cc, astStatement.body, { currentParentScope: blockScope }),
              sourceloc: astStatement.sourceloc,
            });
            break;

          case "VariableDefinitionStatement":
            const variableSymbol = defineVariableSymbol(
              cc,
              {
                variant: Collect.EEntityType.VariableSymbol,
                name: astStatement.name,
                type:
                  (astStatement.datatype &&
                    collect(cc, astStatement.datatype, { currentParentScope: blockScope })) ||
                  null,
                mutability: astStatement.mutability,
                variableContext: astStatement.variableContext,
                sourceloc: astStatement.sourceloc,
              },
              blockScope
            );
            addStatement(cc, blockScope, {
              variant: Collect.EEntityType.VariableDefinitionStatement,
              sourceloc: astStatement.sourceloc,
              value:
                (astStatement.expr &&
                  collect(cc, astStatement.expr, { currentParentScope: blockScope })) ||
                null,
              variableSymbol: variableSymbol,
            });
            break;
        }
      }
      break;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "Deferred":
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "FunctionDatatype":
      for (const param of item.params) {
        collect(cc, functionScope, param.datatype, meta);
      }
      collect(cc, functionScope, item.returnType, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ReferenceDatatype": {
      collect(cc, functionScope, item.referee, meta);
      break;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "NamedDatatype": {
      const process = (_item: ASTNamedDatatype) => {
        let p: ASTNamedDatatype | undefined = _item;
        while (p) {
          p._collect.usedInScope = functionScope.id;

          for (const g of p.generics) {
            if (g.variant === "NamedDatatype") {
              process(g);
            }
          }

          p = p.nested;
        }
      };
      process(item);
      break;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ParenthesisExpr": {
      const entity = addEntity(cc.collectWorld);
      setComponent(cc, entity, Collect.ParenthesisExpr, {
        innerExpr: collectExpr(cc, expr.expr),
        sourceloc: internSourceloc(cc, expr.sourceloc),
      });
      return entity;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "BinaryExpr": {
      const entity = addEntity(cc.collectWorld);
      setComponent(cc, entity, Collect.BinaryExpr, {
        left: collectExpr(cc, expr.a),
        right: collectExpr(cc, expr.b),
        operator: expr.operation,
        sourceloc: internSourceloc(cc, expr.sourceloc),
      });
      return entity;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ConstantExpr":
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "SymbolValueExpr":
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "LambdaExpr":
      item.lambda.funcbody._collect.scope = makeScope(cc, item.sourceloc, functionScope.id);
      for (const param of item.lambda.params) {
        const s: ASTVariableDefinitionStatement = {
          variant: "VariableDefinitionStatement",
          id: makeModulePrefix(cc.config) + ".vardef." + (cc.config.symbolIdCounter++).toString(),
          mutability: false,
          name: param.name,
          datatype: param.datatype,
          sourceloc: param.sourceloc,
          variableContext: EVariableContext.FunctionParameter,
          _semantic: {},
        };
        getScope(cc, item.lambda.funcbody._collect.scope).defineSymbol(cc, s);
        cc.symbols.set(s.id, s);
      }

      for (const param of item.lambda.params) {
        collect(cc, functionScope, param.datatype, meta);
      }
      if (item.lambda.returnType) {
        collect(cc, functionScope, item.lambda.returnType, meta);
      }

      collect(cc, getScope(cc, item.lambda.funcbody._collect.scope), item.lambda.funcbody, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "StructInstantiationExpr":
      for (const member of item.members) {
        collect(cc, functionScope, member.value, meta);
      }
      collect(cc, functionScope, item.datatype, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "UnaryExpr":
      collect(cc, functionScope, item.expr, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "PreIncrExpr":
      collect(cc, functionScope, item.expr, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "PostIncrExpr":
      collect(cc, functionScope, item.expr, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExprMemberAccess":
      collect(cc, functionScope, item.expr, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExplicitCastExpr":
      collect(cc, functionScope, item.expr, meta);
      collect(cc, functionScope, item.castedTo, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "RawPointerAddressOf":
      collect(cc, functionScope, item.expr, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "RawPointerDereference":
      collect(cc, functionScope, item.expr, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExprAssignmentExpr":
      collect(cc, functionScope, item.target, meta);
      collect(cc, functionScope, item.value, meta);
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExprCallExpr":
      collect(cc, functionScope, item.calledExpr, meta);
      for (const a of item.arguments) {
        collect(cc, functionScope, a, meta);
      }
      break;

    default:
      assert(false, "All cases handled" + item.variant);
  }
}

export function CollectFileInUnit(
  cc: CollectionContext,
  ast: ASTRoot,
  unitScope: number,
  filepath: string
) {
  const fileScope = makeSymbol(cc, {
    variant: Collect.EEntityType.FileScope,
    filepath: filepath,
    parentScope: unitScope,
    symbols: [],
  });

  for (const decl of ast) {
    collect(cc, decl, {
      currentParentScope: fileScope,
    });
  }

  // const globalScope = getEntityByComponent(cc, Collect.ModuleScopeComponent);
  // assert(globalScope);
  // const mermaid = exportMermaidScopeTree(cc);
  // console.log(mermaid);
  // Bun.write("log.md", mermaid);
}

export function PrettyPrintCollected(cc: CollectionContext) {
  console.log("C Injections:");
  for (const i of cc.cInjections) {
    console.log(" - " + i.code);
  }
  console.log("\n");

  const serializeAstDatatype = (datatype: ASTDatatype | ASTConstant): string => {
    if (datatype.variant === "FunctionDatatype") {
      return `(${datatype.params
        .map((p) => `${p.name}: ${serializeAstDatatype(p.datatype)}`)
        .join(", ")}${datatype.ellipsis ? ", ..." : ""}) => ${serializeAstDatatype(
        datatype.returnType
      )}`;
    } else if (datatype.variant === "NamedDatatype") {
      let s = "";
      let d: ASTNamedDatatype | undefined = datatype;
      while (d) {
        s += `${datatype.name}${
          datatype.generics.length > 0
            ? `<${datatype.generics.map((g) => serializeAstDatatype(g)).join(", ")}>`
            : ""
        }`;
        d = d.nested;
      }
      return s;
    } else if (datatype.variant === "Deferred") {
      return "_deferred_";
    } else if (datatype.variant === "RawPointerDatatype") {
      return serializeAstDatatype(datatype.pointee) + "*";
    } else if (datatype.variant === "ReferenceDatatype") {
      return serializeAstDatatype(datatype.referee) + "&";
    } else {
      return datatype.value.toString();
    }
  };

  const printScope = (scope: Collect.Scope, indent: number) => {
    const print = (str: string, _indent = 0) => {
      console.log(" ".repeat(indent + _indent) + str);
    };

    print(`Statements (${scope.rawStatements.length}):`);
    for (const s of scope.rawStatements) {
      // print("  - " + JSON.stringify(s));
    }
    print(`Symbols (${scope.symbols.length}):`);
    for (const _s of scope.symbols) {
      const s = getSymbol(cc, _s);
      switch (s.variant) {
        case "NamespaceDefinition":
          print(`  - Namespace ${s.name}: export=${s.export}`);
          if (s._collect.scope) printScope(getScope(cc, s._collect.scope), indent + 6);
          break;

        case "FunctionDeclaration":
          print(
            `  - FuncDecl ${s.namespacePath.length > 0 ? s.namespacePath.join(".") + "." : ""}${
              s.name
            }(${s.params.map((p) => `${p.name}: ${serializeAstDatatype(p.datatype)}`).join(", ")}${
              s.ellipsis ? ", ..." : ""
            }): ${s.returnType && serializeAstDatatype(s.returnType)} export=${s.export}`
          );
          break;

        case "FunctionDefinition":
          print(
            `  - FuncDef ${s.name}${
              s.generics.length > 0 ? "<" + s.generics.join(", ") + ">" : ""
            }(${s.params.map((p) => `${p.name}: ${serializeAstDatatype(p.datatype)}`).join(", ")}${
              s.ellipsis ? ", ..." : ""
            }): ${s.returnType && serializeAstDatatype(s.returnType)} export=${s.export}`
          );
          if (s.funcbody?._collect.scope)
            printScope(getScope(cc, s.funcbody._collect.scope), indent + 6);
          break;

        case "GlobalVariableDefinition":
          print(`  - Global Variable ${s.mutable ? "let" : "const"} ${s.name} export=${s.export}`);
          break;

        case "StructDefinition":
          print(
            `  - Struct ${s.name}${s.generics.length > 0 ? "<" + s.generics.join(", ") + ">" : ""}`
          );
          print(`      Members:`);
          for (const member of s.members) {
            // const member = getSymbol(cc, m);
            // assert(member.variant === "StructMember");
            print(`        - ${member.name}: ${serializeAstDatatype(member.type)}`);
          }
          print(`      Methods:`);
          for (const method of s.methods) {
            // const method = getSymbol(cc, m);
            // assert(method.variant === "StructMethod");
            print(
              `        - ${method.name}${
                method.generics.length > 0 ? "<" + method.generics.join(", ") + ">" : ""
              }(${method.params
                .map((p) => `${p.name}: ${serializeAstDatatype(p.datatype)}`)
                .join(", ")}${method.ellipsis ? ", ..." : ""}): ${
                method.returnType && serializeAstDatatype(method.returnType)
              }`
            );
            if (method.funcbody?._collect.scope)
              printScope(getScope(cc, method.funcbody._collect.scope), indent + 12);
          }
          break;

        case "VariableDefinitionStatement":
          print(`  - Variable ${s.mutable ? "let" : "const"} ${s.name}`);
          break;
      }
    }
    console.log("\n");
  };

  console.log("Global Scope:");
  printScope(getScope(cc, cc.globalScope), 2);
}
