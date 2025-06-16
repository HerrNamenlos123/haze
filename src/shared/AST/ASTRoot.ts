import type { SourceLoc } from "../../Errors";

// export type ASTNamespace = {};

export enum EExternLanguage {
  None,
  C,
}

export type ASTFunctionDeclaration = {
  export: boolean;
  externLanguage: EExternLanguage;
  name: string;
  namespacePath: string[];
  params: ASTParam[];
  ellipsis: boolean;
  returnType: ASTDatatype;
  sourceloc: SourceLoc;
};

export type ASTParam = {
  name: string;
  datatype: ASTDatatype;
};

export type ASTNamedDatatype = {
  variant: "NamedDatatype";
};

export type ASTFunctionDatatype = {
  variant: "FunctionDatatype";
};

export type ASTDatatype = ASTNamedDatatype | ASTFunctionDatatype;

export type ASTFunctionDefinition = {
  sourceloc: SourceLoc;
};

export type ASTRoot = {
  cInjectStatements: {
    rawCode: string;
    sourceloc: SourceLoc;
  }[];

  functionDeclarations: ASTFunctionDeclaration[];
  functionDefinitions: ASTFunctionDefinition[];

  variableDefinitions: {
    sourceloc: SourceLoc;
  }[];

  typeDefinitions: {
    sourceloc: SourceLoc;
  }[];
};

// Namespace in typeDefinitions
//   namespaceDefinitions: {}[];
