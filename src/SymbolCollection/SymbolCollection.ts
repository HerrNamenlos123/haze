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
  ASTExpr,
  ASTStatement,
  ASTStructMemberDefinition,
  ASTStructMethodDefinition,
} from "../shared/AST";
import type { ModuleConfig } from "../shared/Config";
import {
  addComponent,
  addEntity,
  createWorld,
  defineComponent,
  defineQuery,
  getAllEntities,
  hasComponent,
  Types,
  type Component,
  type ComponentType,
  type ISchema,
  type IWorld,
} from "bitecs";

function exportMermaidScopeTree(cc: CollectionContext): string {
  let output = "";
  // output += `\`\`\`mermaid\n`;
  output += `graph TD\n`;

  for (const sc of defineQuery([Collect.ModuleScopeComponent])(cc.collectWorld)) {
    output += `  E${sc}["Module Scope"]\n`;
  }

  for (const sc of defineQuery([Collect.UnitScopeComponent])(cc.collectWorld)) {
    const parent = Collect.UnitScopeComponent.moduleScope[sc];
    output += `  E${sc}["Unit Scope"] --> E${parent}\n`;
  }

  for (const sc of defineQuery([Collect.FileScopeComponent])(cc.collectWorld)) {
    const parent = Collect.FileScopeComponent.unitScope[sc];
    const filename = cc.idToString.get(Collect.FileScopeComponent.filename[sc]);
    output += `  E${sc}["${filename}"] --> E${parent}\n`;
  }

  for (const ns of defineQuery([Collect.NamespaceSymbolComponent])(cc.collectWorld)) {
    const parent = Collect.NamespaceSymbolComponent.parentScope[ns];
    const name = cc.idToString.get(Collect.NamespaceSymbolComponent.name[ns]);
    output += `  E${ns}["Namespace ${name}"] --> E${parent}\n`;
  }

  for (const ns of defineQuery([Collect.FunctionSymbolComponent])(cc.collectWorld)) {
    const parent = Collect.FunctionSymbolComponent.parentScope[ns];
    const overloadGroup = Collect.FunctionSymbolComponent.overloadGroup[ns];
    output += `  E${ns}["Function Symbol"] --> E${parent}\n`;
    output += `  E${ns} --> E${overloadGroup}\n`;
  }

  for (const ns of defineQuery([Collect.FunctionOverloadGroupComponent])(cc.collectWorld)) {
    const parent = Collect.FunctionOverloadGroupComponent.parentScope[ns];
    const name = cc.idToString.get(Collect.FunctionOverloadGroupComponent.name[ns]);
    output += `  E${ns}["Function '${name}' Overload"] --> E${parent}\n`;
  }

  // output += "\n\`\`\`";
  return output;
}

export type CollectionContext = {
  config: ModuleConfig;
  collectWorld: IWorld;
  nextEntityId: number;

  stringToId: Map<string, number>;
  idToString: Map<number, string>;
  nextStringId: number;

  sourcelocToId: Map<SourceLoc, number>;
  idToSourceloc: Map<number, SourceLoc>;
  nextSourcelocId: number;

  // scopeSymbolMap: Map<number, number[]>;
};

export enum EVariableMutability {
  Immutable, // Fully immutable
  BindingImmutable, // Binding is immutable, but value inside is not (e.g. struct fields)
  Mutable, // Fully mutable
}

export function makeCollectionContext(config: ModuleConfig): CollectionContext {
  const cc: CollectionContext = {
    config: config,
    stringToId: new Map(),
    idToString: new Map(),
    nextEntityId: 1,
    nextStringId: 1,
    idToSourceloc: new Map(),
    sourcelocToId: new Map(),
    nextSourcelocId: 1,
    collectWorld: createWorld(),
  };

  const globalScope = addEntity(cc.collectWorld);
  setComponent(cc, globalScope, Collect.ModuleScopeComponent, {});

  return cc;
}

export function internSourceloc(cc: CollectionContext, loc: SourceLoc) {
  if (loc === null) {
    return 0;
  }
  for (const [s, id] of cc.sourcelocToId) {
    if (s === null) continue;
    if (s.column === loc.column && s.line === loc.line && s.filename === loc.filename) {
      return id;
    }
  }
  const id = cc.nextSourcelocId++;
  cc.sourcelocToId.set(loc, id);
  cc.idToSourceloc.set(id, loc);
  return id;
}

export function internString(cc: CollectionContext, path: string): number {
  if (!cc.stringToId.has(path)) {
    const id = cc.nextStringId++;
    cc.stringToId.set(path, id);
    cc.idToString.set(id, path);
    return id;
  }
  return cc.stringToId.get(path)!;
}

export function getFilePath(cc: CollectionContext, id: number): string | undefined {
  return cc.idToString.get(id);
}

export function setComponent<T extends Record<string, any>>(
  cc: CollectionContext,
  eid: number,
  component: T,
  data: { [K in keyof T]: number }
): void {
  addComponent(cc.collectWorld, component, eid);
  for (const key in data) {
    (component as any)[key][eid] = data[key];
  }
}

export function getEntityByComponent(cc: CollectionContext, component: Component | Component[]) {
  return getEntitiesByComponent(cc, component)[0];
}

export function getEntitiesByComponent(cc: CollectionContext, component: Component | Component[]) {
  const query = defineQuery(Array.isArray(component) ? component : [component]);
  const entity = query(cc.collectWorld);
  return entity;
}

export namespace Collect {
  export type GenericParameter = {
    variant: "GenericParameter";
    name: string;
    sourceloc: SourceLoc;
  };

  export type Symbol =
    | ASTFunctionDefinition
    | ASTNamespaceDefinition
    | ASTVariableDefinitionStatement
    | ASTGlobalVariableDefinition
    | ASTStructDefinition
    | ASTStructMethodDefinition
    | ASTStructMemberDefinition
    | GenericParameter;

  export type Statement = ASTStatement;

  /// ===============================================================
  /// ===                         Scopes                          ===
  /// ===============================================================

  export const ModuleScopeComponent = defineComponent({});

  export const UnitScopeComponent = defineComponent({
    moduleScope: Types.eid,
  });

  export const FileScopeComponent = defineComponent({
    unitScope: Types.eid,
    filename: Types.eid,
  });

  export const FunctionScopeComponent = defineComponent({
    parentScope: Types.eid,
    owningSymbol: Types.eid,
    sourceloc: Types.eid,
  });

  export const BlockScopeComponent = defineComponent({
    parentScope: Types.eid,
    owningFunctionSymbol: Types.eid,
    sourceloc: Types.eid,
    firstStatement: Types.eid,
    lastStatement: Types.eid,
  });

  /// ===============================================================
  /// ===                       Overloads                         ===
  /// ===============================================================

  export const FunctionOverloadGroupComponent = defineComponent({
    name: Types.eid,
    parentScope: Types.eid,
  });

  /// ===============================================================
  /// ===                     Function Symbols                    ===
  /// ===============================================================

  export const FunctionSymbolComponent = defineComponent({
    parentScope: Types.eid,
    overloadGroup: Types.eid,
    returnType: Types.eid,
    sourceloc: Types.eid,
  });

  export const FunctionParameterComponent = defineComponent({
    name: Types.eid,
    type: Types.eid,
    index: Types.ui8,
    owningFunctionSymbol: Types.eid,
  });

  export const VariableSymbolComponent = defineComponent({
    parentScope: Types.eid,
    name: Types.eid,
    type: Types.eid,
    sourceloc: Types.eid,
    bindingMutability: Types.ui8,
  });

  /// ===============================================================
  /// ===                       Type Symbols                      ===
  /// ===============================================================

  export const NamedDatatypeSymbolComponent = defineComponent({
    name: Types.eid,
    sourceloc: Types.eid,
  });

  export const PointerDatatypeSymbolComponent = defineComponent({
    pointee: Types.eid,
    sourceloc: Types.eid,
  });

  export const ReferenceDatatypeSymbolComponent = defineComponent({
    referee: Types.eid,
    sourceloc: Types.eid,
  });

  export const StructSymbolComponent = defineComponent({
    parentScope: Types.eid,
    name: Types.eid,
    sourceloc: Types.eid,
  });

  export const NamespaceSymbolComponent = defineComponent({
    parentScope: Types.eid,
    name: Types.eid,
    sourceloc: Types.eid,
  });

  export const GenericTypeParameterComponent = defineComponent({
    name: Types.eid,
    index: Types.ui8,
    owningSymbol: Types.eid,
  });

  /// ===============================================================
  /// ===                         Flags                           ===
  /// ===============================================================

  export const ExportedFlagComponent = defineComponent({});

  export const PubFlagComponent = defineComponent({});

  export const ExternFlagComponent = defineComponent({
    language: Types.ui8,
  });

  /// ===============================================================
  /// ===                       Statements                        ===
  /// ===============================================================

  export const StatementLink = defineComponent({
    nextStatement: Types.eid,
    prevStatement: Types.eid,
  });

  export const ExprStatement = defineComponent({
    expr: Types.eid,
    sourceloc: Types.eid,
  });

  export const InlineCStatement = defineComponent({
    value: Types.eid,
    sourceloc: Types.eid,
  });

  export const ReturnStatement = defineComponent({
    expr: Types.eid,
    sourceloc: Types.eid,
  });

  export const BlockScopeStatement = defineComponent({
    block: Types.eid,
    sourceloc: Types.eid,
  });

  export const IfStatement = defineComponent({
    firstChainLink: Types.eid,
    sourceloc: Types.eid,
  });

  export const IfChainLink = defineComponent({
    conditionExpr: Types.eid,
    block: Types.eid,
    next: Types.eid,
  });

  export const WhileStatement = defineComponent({
    nextStatement: Types.eid,
    prevStatement: Types.eid,
    conditionExpr: Types.eid,
    block: Types.eid,
    sourceloc: Types.eid,
  });

  /// ===============================================================
  /// ===                      Expressions                        ===
  /// ===============================================================

  export const ParenthesisExpr = defineComponent({
    innerExpr: Types.eid,
    sourceloc: Types.eid,
  });

  export const BinaryExpr = defineComponent({
    left: Types.eid,
    operator: Types.ui8,
    right: Types.eid,
    sourceloc: Types.eid,
  });

  export const UnaryExpr = defineComponent({
    operator: Types.ui8,
    expr: Types.eid,
    sourceloc: Types.eid,
  });

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

function makeNamedType(cc: CollectionContext, name: string, sourceloc: SourceLoc) {
  const e = addEntity(cc.collectWorld);
  setComponent(cc, e, Collect.NamedDatatypeSymbolComponent, {
    name: internString(cc, name),
    sourceloc: internSourceloc(cc, sourceloc),
  });
  return e;
}

// function addSymbolToScope(cc: CollectionContext, scope: number, symbol: number) {
//   if (!cc.scopeSymbolMap.has(scope)) {
//     cc.scopeSymbolMap.set(scope, []);
//   }

//   const arr = cc.scopeSymbolMap.get(scope)!;
//   arr.push(symbol);
// }

// function getScope(cc: CollectionContext, scope: number) {
//   if (!hasComponent(cc.collectWorld, Collect.Scope, scope)) {
//     assert(`Entity ${scope} is not a scope`);
//   }
//   defineQuery([Collect.NamespaceSymbolComponent])(cc.collectWorld);
// }

function findAllNamespacesInScope(cc: CollectionContext, scope: number) {
  const symbols = [];
  for (const ns of defineQuery([Collect.NamespaceSymbolComponent])(cc.collectWorld)) {
    const parentScope = Collect.NamespaceSymbolComponent.parentScope[ns];
    if (parentScope === scope) {
      symbols.push(ns);
    }
  }
  return symbols;
}

function findAllOverloadGroupsInScope(cc: CollectionContext, scope: number) {
  const symbols = [];
  for (const ns of defineQuery([Collect.FunctionOverloadGroupComponent])(cc.collectWorld)) {
    const parentScope = Collect.FunctionOverloadGroupComponent.parentScope[ns];
    if (parentScope === scope) {
      symbols.push(ns);
    }
  }
  return symbols;
}

function findAllFunctionOverloadGroupsInScope(cc: CollectionContext, scope: number) {
  const symbols = [];
  for (const ns of defineQuery([Collect.FunctionOverloadGroupComponent])(cc.collectWorld)) {
    const parentScope = Collect.FunctionOverloadGroupComponent.parentScope[ns];
    if (parentScope === scope) {
      symbols.push(ns);
    }
  }
  return symbols;
}

function findAllStructsInScope(cc: CollectionContext, scope: number) {
  const symbols = [];
  for (const ns of defineQuery([Collect.StructSymbolComponent])(cc.collectWorld)) {
    const parentScope = Collect.StructSymbolComponent.parentScope[ns];
    if (parentScope === scope) {
      symbols.push(ns);
    }
  }
  return symbols;
}

function makeBlockScope(cc: CollectionContext, parentBlockScope: number, sourceloc: SourceLoc) {
  let functionSymbol = 0;
  if (hasComponent(cc.collectWorld, Collect.BlockScopeComponent, parentBlockScope)) {
    functionSymbol = Collect.BlockScopeComponent.owningFunctionSymbol[parentBlockScope];
  } else if (hasComponent(cc.collectWorld, Collect.FunctionScopeComponent, parentBlockScope)) {
    functionSymbol = Collect.FunctionScopeComponent.owningSymbol[parentBlockScope];
  } else {
    assert(false);
  }
  const scope = addEntity(cc.collectWorld);
  setComponent(cc, scope, Collect.BlockScopeComponent, {
    owningFunctionSymbol: functionSymbol,
    parentScope: parentBlockScope,
    sourceloc: internSourceloc(cc, sourceloc),
    firstStatement: 0,
    lastStatement: 0,
  });
  return scope;
}

function collectType(cc: CollectionContext, type: ASTDatatype, sourceloc: SourceLoc) {
  switch (type.variant) {
    case "NamedDatatype": {
      return makeNamedType(cc, type.name, sourceloc);
    }

    case "PointerDatatype": {
      const e = addEntity(cc.collectWorld);
      setComponent(cc, e, Collect.PointerDatatypeSymbolComponent, {
        pointee: collectType(cc, type.pointee, type.sourceloc),
        sourceloc: internSourceloc(cc, sourceloc),
      });
      return e;
    }

    case "ReferenceDatatype": {
      const e = addEntity(cc.collectWorld);
      setComponent(cc, e, Collect.ReferenceDatatypeSymbolComponent, {
        referee: collectType(cc, type.referee, type.sourceloc),
        sourceloc: internSourceloc(cc, sourceloc),
      });
      return e;
    }

    default:
      assert(false, "" + type.variant);
  }
}

function makeOverloadGroup(cc: CollectionContext, scope: number, name: string) {
  for (const g of findAllOverloadGroupsInScope(cc, scope)) {
    if (cc.idToString.get(Collect.NamespaceSymbolComponent.name[g]) === name) {
      return g;
    }
  }

  const g = addEntity(cc.collectWorld);
  setComponent(cc, g, Collect.FunctionOverloadGroupComponent, {
    name: internString(cc, name),
    parentScope: scope,
  });
  return g;
}

function appendStatement<T extends Component>(
  cc: CollectionContext,
  blockscope: number,
  component: T,
  data: Omit<{ [K in keyof T]: number }, "nextStatement" | "prevStatement">
) {
  const statement = addEntity(cc.collectWorld);
  Collect.InlineCStatement;

  // Point last statement here
  if (Collect.BlockScopeComponent.lastStatement[blockscope] === 0) {
    // It's the first statement
    Collect.BlockScopeComponent.firstStatement[blockscope] = statement;
    Collect.BlockScopeComponent.lastStatement[blockscope] = statement;
    setComponent(cc, statement, component, {
      nextStatement: 0,
      prevStatement: 0,
      ...data,
    } as any);
  } else {
    const lastStatementLink = Collect.BlockScopeComponent.lastStatement[blockscope];
    Collect.StatementLink.nextStatement[lastStatementLink] = statement;
    setComponent(cc, statement, component, {
      nextStatement: 0,
      prevStatement: lastStatementLink,
      ...data,
    } as any);
    Collect.BlockScopeComponent.lastStatement[blockscope] = statement;
  }
  return statement;
}

function collectExpr(cc: CollectionContext, expr: ASTExpr): number {
  switch (expr.variant) {
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
          mutable: false,
          name: param.name,
          datatype: param.datatype,
          sourceloc: param.sourceloc,
          kind: EVariableContext.FunctionParameter,
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
  }
}

function collectStatement(cc: CollectionContext, statement: ASTStatement): number {
  switch (statement.variant) {
    case "ExprStatement": {
      const entity = addEntity(cc.collectWorld);
      setComponent(cc, entity, Collect.ExprStatement, {
        expr: collectExpr(cc, s.expr),
        sourceloc: internSourceloc(cc, s.sourceloc),
      });
      break;
    }

    case "IfStatement": {
      let firstChainLink = 0;
      let lastChainLink = 0;
      collect(cc, s.condition, { currentParentScope: args.currentParentScope });
      const firstBlock = makeBlockScope(cc, args.currentParentScope, s.then.sourceloc);
      collect(cc, s.then, {
        currentParentScope: firstBlock,
      });
      firstChainLink = addEntity(cc.collectWorld);
      lastChainLink = firstChainLink;
      setComponent(cc, firstChainLink, Collect.IfChainLink, {
        block: firstBlock,
        conditionExpr: 0,
        next: 0,
      });
      for (const e of s.elseIfs) {
        collect(cc, e.condition, { currentParentScope: args.currentParentScope });
        const block = makeBlockScope(cc, args.currentParentScope, e.then.sourceloc);
        collect(cc, e.then, {
          currentParentScope: block,
        });
        const link = addEntity(cc.collectWorld);
        Collect.IfChainLink.next[lastChainLink] = link;
        setComponent(cc, link, Collect.IfChainLink, {
          block: block,
          conditionExpr: 0,
          next: 0,
        });
        lastChainLink = link;
      }
      if (s.else) {
        const block = makeBlockScope(cc, args.currentParentScope, s.else.sourceloc);
        collect(cc, s.else, {
          currentParentScope: block,
        });
        const link = addEntity(cc.collectWorld);
        Collect.IfChainLink.next[lastChainLink] = link;
        setComponent(cc, link, Collect.IfChainLink, {
          block: block,
          conditionExpr: 0,
          next: 0,
        });
        lastChainLink = link;
      }

      const entity = addEntity(cc.collectWorld);
      setComponent(cc, entity, Collect.IfStatement, {
        firstChainLink: firstChainLink,
      });
      break;
    }

    case "InlineCStatement": {
      appendStatement(cc, args.currentParentScope, Collect.InlineCStatement, {
        value: internString(cc, s.code),
      });
      break;
    }

    case "ReturnStatement":
      appendStatement(cc, args.currentParentScope, Collect.ReturnStatement, {
        expr: 0,
      });
      // if (s.expr) {
      //   collect(cc, functionScope, s.expr, meta);
      // }
      break;

    case "WhileStatement":
      collect(cc, s.condition, { currentParentScope: args.currentParentScope });
      const block = makeBlockScope(cc, args.currentParentScope, s.body.sourceloc);
      collect(cc, s.body, {
        currentParentScope: block,
      });
      appendStatement(cc, args.currentParentScope, Collect.WhileStatement, {
        block: block,
        conditionExpr: 0,
      });
      break;

    case "VariableDefinitionStatement":
      if (functionScope.tryLookupSymbolHere(cc, s.name)) {
        throw new CompilerError(
          `Variable '${s.name}' is already defined in this scope`,
          s.sourceloc
        );
      }
      if (s.datatype) {
        collect(cc, functionScope, s.datatype, meta);
      }
      if (s.expr) {
        collect(cc, functionScope, s.expr, meta);
      }
      functionScope.defineSymbol(cc, s);
      cc.symbols.set(s.id, s);
      break;
  }
}

function collect(
  cc: CollectionContext,
  item:
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
) {
  switch (item.variant) {
    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "FunctionDefinition":
      const overloadGroup = makeOverloadGroup(cc, args.currentParentScope, item.name);

      const functionSymbol = addEntity(cc.collectWorld);
      setComponent(cc, functionSymbol, Collect.FunctionSymbolComponent, {
        overloadGroup: overloadGroup,
        parentScope: args.currentParentScope,
        returnType:
          (item.returnType && collectType(cc, item.returnType, item.sourceloc)) ||
          makeNamedType(cc, primitiveToString(EPrimitive.none), item.sourceloc),
        sourceloc: internSourceloc(cc, item.sourceloc),
      });

      console.warn("TODO: Check if function is redefined with conflicting parameters");

      for (const [i, param] of item.params.entries()) {
        const paramType = collectType(cc, param.datatype, param.sourceloc);
        const paramEntity = addEntity(cc.collectWorld);
        setComponent(cc, paramEntity, Collect.FunctionParameterComponent, {
          index: i,
          name: internString(cc, param.name),
          owningFunctionSymbol: functionSymbol,
          type: paramType,
        });
      }

      if (item.funcbody) {
        const functionScope = addEntity(cc.collectWorld);
        setComponent(cc, functionScope, Collect.FunctionScopeComponent, {
          owningSymbol: functionSymbol,
          parentScope: args.currentParentScope,
          sourceloc: internSourceloc(cc, item.sourceloc),
        });

        const topBlockScope = makeBlockScope(cc, functionScope, item.sourceloc);

        // for (const g of item.generics) {
        //   getScope(cc, item.declarationScope).defineSymbol(cc, g);
        // }

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

        collect(cc, item.funcbody, {
          currentParentScope: topBlockScope,
        });
      }

      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExprAsFuncBody":
      throw new InternalError("This is handled elsewhere");

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "GlobalVariableDefinition": {
      const variable = addEntity(cc.collectWorld);
      setComponent(cc, variable, Collect.VariableSymbolComponent, {
        bindingMutability: item.bindingMutability,
        name: internString(cc, item.name),
        parentScope: args.currentParentScope,
        sourceloc: internSourceloc(cc, item.sourceloc),
        type: (item.datatype && collectType(cc, item.datatype, item.sourceloc)) || 0,
      });
      // addSymbolToScope(cc, args.currentParentScope, variable);
      break;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "NamespaceDefinition": {
      const allNamespaces = findAllNamespacesInScope(cc, args.currentParentScope);
      let existingNamespace = 0;
      for (const ns of allNamespaces) {
        if (cc.idToString.get(Collect.NamespaceSymbolComponent.name[ns]) === item.name) {
          existingNamespace = ns;
          break;
        }
      }

      if (existingNamespace === 0) {
        existingNamespace = addEntity(cc.collectWorld);
        setComponent(cc, existingNamespace, Collect.NamespaceSymbolComponent, {
          name: internString(cc, item.name),
          parentScope: args.currentParentScope,
          sourceloc: internSourceloc(cc, item.sourceloc),
        });
      }

      for (const s of item.declarations) {
        collect(cc, s, {
          currentParentScope: existingNamespace,
        });
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
              mutable: false,
              name: "this",
              sourceloc: method.sourceloc,
              datatype: undefined,
              kind: EVariableContext.ThisReference,
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
              mutable: false,
              name: param.name,
              datatype: param.datatype,
              sourceloc: param.sourceloc,
              kind: EVariableContext.FunctionParameter,
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

    case "Scope":
      for (const s of item.statements) {
        switch (s.variant) {
        }
      }
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "Deferred":
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "RawPointerDatatype":
      collect(cc, functionScope, item.pointee, meta);
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
  const fileScope = addEntity(cc.collectWorld);
  setComponent(cc, fileScope, Collect.FileScopeComponent, {
    filename: internString(cc, filepath),
    unitScope: unitScope,
  });

  for (const decl of ast) {
    switch (decl.variant) {
      case "CInjectDirective":
        // cc.cInjections.push({
        //   code: decl.code,
        //   sourceloc: decl.sourceloc,
        // });
        break;

      case "FunctionDeclaration":
      case "FunctionDefinition":
      case "GlobalVariableDefinition":
      case "NamespaceDefinition":
      case "StructDefinition":
        collect(cc, decl, {
          currentParentScope: fileScope,
          fileScope: fileScope,
        });
        break;
    }
  }

  const globalScope = getEntityByComponent(cc, Collect.ModuleScopeComponent);
  assert(globalScope);
  const mermaid = exportMermaidScopeTree(cc);
  console.log(mermaid);
  Bun.write("log.md", mermaid);
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
