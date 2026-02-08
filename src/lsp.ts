import {
  createConnection,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  TextDocumentSyncKind,
  TextDocuments,
} from "vscode-languageserver/node";
import type { InitializeParams } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import path from "node:path";
import { existsSync } from "node:fs";

import { ModuleCompiler, ProjectCompiler } from "./Module";
import { ModuleType } from "./shared/Config";
import {
  CompilerError,
  ErrorType,
  setDiagnosticSink,
  SyntaxError,
  type CompilerDiagnostic,
  type SourceLoc,
} from "./shared/Errors";
import { Semantic } from "./Semantic/SemanticTypes";

// Walk up the directory tree to find the module root (haze.toml location).
function findModuleRoot(filePath: string): string | null {
  let current = path.dirname(path.resolve(filePath));
  const root = path.parse(current).root;

  let lastResult = null as string | null;

  while (current !== root) {
    const configPath = path.join(current, "haze.toml");
    if (existsSync(configPath)) {
      lastResult = current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return lastResult;
}

// Analyze the entire module containing the changed file.
// Returns diagnostics grouped by file path.
async function analyzeModule(
  changedFile: string,
  changedText: string,
): Promise<Map<string, CompilerDiagnostic[]>> {
  const diagnostics: CompilerDiagnostic[] = [];
  const push = (diag: CompilerDiagnostic) => diagnostics.push(diag);

  setDiagnosticSink(push);
  try {
    const moduleRoot = findModuleRoot(changedFile);
    if (!moduleRoot) {
      // No haze.toml found - treat as single-file module
      return new Map();
    }

    // Module-based analysis
    const project = new ProjectCompiler();
    const previousCwd = process.cwd();
    process.chdir(moduleRoot);
    const config = await project.getConfig(undefined, true);
    process.chdir(previousCwd);

    if (!config) {
      return new Map();
    }

    const globalBuildDir = path.join(process.cwd(), "__haze__");
    const moduleDir = path.join(globalBuildDir, config.name);
    const moduleCompiler = new ModuleCompiler(config, project.cache, globalBuildDir, moduleDir);
    moduleCompiler.currentModuleRootDir = moduleRoot;

    // Collect all module sources
    await moduleCompiler.addInternalBuiltinSources();
    await moduleCompiler.collectImports();
    await moduleCompiler.addProjectSourceFiles();

    // Run semantic analysis once for the entire module
    Semantic.SemanticallyAnalyze(
      moduleCompiler,
      moduleCompiler.cc,
      config.moduleType === ModuleType.Library,
      config.name,
      config.version,
    );

    // Group diagnostics by file (include all module files)
    const diagnosticsByFile = new Map<string, CompilerDiagnostic[]>();
    for (const diag of diagnostics) {
      if (diag.loc?.filename) {
        const resolved = path.resolve(diag.loc.filename);
        if (!diagnosticsByFile.has(resolved)) {
          diagnosticsByFile.set(resolved, []);
        }
        diagnosticsByFile.get(resolved)!.push(diag);
      }
    }

    return diagnosticsByFile;
  } catch (err) {
    const errorDiag: CompilerDiagnostic = {
      type: ErrorType.Error,
      message: err instanceof Error ? err.message : String(err),
    };

    if (err instanceof CompilerError) {
      errorDiag.message = err.rawMessage ?? err.message;
      errorDiag.loc = err.loc;
    } else if (err instanceof SyntaxError && diagnostics.length === 0) {
      errorDiag.message = "Syntax error";
    }

    diagnostics.push(errorDiag);

    const result = new Map<string, CompilerDiagnostic[]>();
    const filepath = path.resolve(changedFile);
    result.set(filepath, diagnostics);
    return result;
  } finally {
    setDiagnosticSink(null);
  }
}

function uriToPath(uri: string): string | null {
  try {
    return URI.parse(uri).fsPath;
  } catch {
    return null;
  }
}

function rangeFromLoc(loc: SourceLoc | undefined | null) {
  if (!loc) {
    return {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 },
    };
  }

  const startLine = Math.max(0, (loc.start.line ?? 1) - 1);
  const startCol = Math.max(0, loc.start.column ?? 0);

  let endLine = startLine;
  let endCol = startCol + 1;
  if (loc.end) {
    endLine = Math.max(0, (loc.end.line ?? loc.start.line) - 1);
    endCol = Math.max(0, (loc.end.column ?? startCol) + 1);
  }

  if (endLine < startLine || (endLine === startLine && endCol <= startCol)) {
    endLine = startLine;
    endCol = startCol + 1;
  }

  return {
    start: { line: startLine, character: startCol },
    end: { line: endLine, character: endCol },
  };
}

function belongsToFile(loc: SourceLoc | undefined | null, filePath: string): boolean {
  if (!loc?.filename) {
    return true;
  }
  return path.resolve(loc.filename) === path.resolve(filePath);
}

function toLspDiagnostics(diagnostics: CompilerDiagnostic[], filePath: string): Diagnostic[] {
  return diagnostics
    .filter((d) => belongsToFile(d.loc, filePath))
    .map((d) => ({
      message: d.message,
      range: rangeFromLoc(d.loc),
      severity:
        d.type === ErrorType.Warning ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error,
      source: "haze",
    }));
}

// Entry point for the stdio-based language server.
// Returns a promise that keeps the process alive.
export function startLsp(): Promise<never> {
  // Ensure --stdio is in process.argv so vscode-languageserver can auto-detect the transport
  if (!process.argv.includes("--stdio")) {
    process.argv.push("--stdio");
  }

  // Create the connection FIRST, before any stream redirection
  // This allows vscode-languageserver to properly detect stdin/stdout
  const connection = createConnection(ProposedFeatures.all);
  const documents = new TextDocuments(TextDocument);
  const lastPublished = new Set<string>();

  connection.onInitialize((_params: InitializeParams) => {
    console.error("[DEBUG] onInitialize called");
    return {
      capabilities: {
        textDocumentSync: {
          openClose: true,
          change: TextDocumentSyncKind.Incremental,
        },
      },
    };
  });

  connection.onInitialized(() => {
    console.error("[DEBUG] Server initialized successfully");
  });

  const analyzeAndPublish = async (document: TextDocument) => {
    const filePath = uriToPath(document.uri);
    connection.console.log(`[LSP] analyzeAndPublish called for: ${document.uri}`);
    if (!filePath) {
      connection.console.error(`[LSP] Could not convert URI to path: ${document.uri}`);
      return;
    }
    connection.console.log(`[LSP] Analyzing module at: ${filePath}`);

    const diagnosticsByFile = await analyzeModule(filePath, document.getText());
    connection.console.log(
      `[LSP] Analysis complete. Files with diagnostics: ${diagnosticsByFile.size}`,
    );

    const nextPublished = new Set<string>();

    // Publish diagnostics for all files in the module
    for (const [filepath, diags] of diagnosticsByFile) {
      const fileUri = URI.file(filepath).toString();
      const lspDiagnostics = toLspDiagnostics(diags, filepath);
      connection.console.log(
        `[LSP] Publishing ${lspDiagnostics.length} diagnostics for ${fileUri}`,
      );
      for (const diag of lspDiagnostics) {
        connection.console.log(
          `[LSP]   - ${diag.severity === 1 ? "ERROR" : "WARN"}: ${diag.message} at line ${diag.range.start.line}`,
        );
      }
      await connection.sendDiagnostics({ uri: fileUri, diagnostics: lspDiagnostics });
      nextPublished.add(fileUri);
    }

    // Clear diagnostics for files that no longer have errors or are no longer in the module
    for (const uri of lastPublished) {
      if (!nextPublished.has(uri)) {
        await connection.sendDiagnostics({ uri, diagnostics: [] });
      }
    }

    lastPublished.clear();
    for (const uri of nextPublished) {
      lastPublished.add(uri);
    }
  };

  documents.onDidOpen((e) => {
    console.error(`[DEBUG] Document opened: ${e.document.uri}`);
    connection.console.log(`[LSP] Document opened: ${e.document.uri}`);
    analyzeAndPublish(e.document).catch((err) => {
      console.error(`[DEBUG] Error in onDidOpen: ${String(err)}`);
      connection.console.error(`[LSP] Error in onDidOpen: ${String(err)}`);
      connection.console.error(err instanceof Error && err.stack ? err.stack : String(err));
    });
  });

  documents.onDidChangeContent((e) => {
    console.error(`[DEBUG] Document changed: ${e.document.uri}`);
    connection.console.log(`[LSP] Document changed: ${e.document.uri}`);
    analyzeAndPublish(e.document).catch((err) => {
      console.error(`[DEBUG] Error in onDidChangeContent: ${String(err)}`);
      connection.console.error(`[LSP] Error in onDidChangeContent: ${String(err)}`);
      connection.console.error(err instanceof Error && err.stack ? err.stack : String(err));
    });
  });

  documents.onDidClose((e) => {
    void connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
  });

  documents.listen(connection);
  console.error("[DEBUG] Documents listener attached to connection");

  connection.listen();
  console.error("[DEBUG] Connection is now listening on stdin/stdout");
  console.error("[DEBUG] LSP server fully initialized and ready");

  // Return a promise that never resolves to keep the process alive
  return new Promise<never>(() => {});
}
