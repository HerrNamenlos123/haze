// Where a module built in a workspace keeps what its dependents read.
//
// Every module of a build lives in the same workspace (ProjectCompiler uses
// <cwd>/__haze__), so a dependent reads its dependencies straight from their
// build directories: the interface (import.hz), the metadata (metadata.json:
// flags, include dirs, the module graph, the library's file name) and, for
// linking, the static library. Nothing is packed or copied per dependent.

import { join } from "node:path";

export const MODULE_IMPORT_FILE = "import.hz";
export const MODULE_METADATA_FILE = "metadata.json";

/** The workspace a build in this process uses (see ProjectCompiler.build). */
export function defaultWorkspaceDir() {
  return join(process.cwd(), "__haze__");
}

/** The directory holding a module's import.hz, metadata.json and library. */
export function moduleInterfaceDir(workspaceDir: string, moduleName: string) {
  return join(workspaceDir, moduleName, "build");
}

export function moduleMetadataFile(workspaceDir: string, moduleName: string) {
  return join(
    moduleInterfaceDir(workspaceDir, moduleName),
    MODULE_METADATA_FILE
  );
}
