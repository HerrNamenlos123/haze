// Where a module built in a workspace keeps what its dependents read.
//
// Every module of a build lives in the same workspace (ProjectCompiler uses
// <cwd>/__haze__), so a dependent reads its dependencies straight from their
// build directories: the interface (import.hz), the metadata (metadata.json:
// flags, include dirs, the module graph, the library's file name) and, for
// linking, the static library. Nothing is packed or copied per dependent.
//
// A module has one build directory per set of build settings ("build" for the
// defaults, see buildVariantSuffix), and a dependent reads the one of its own
// settings.

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type BuildSettings,
  buildSettingsFromFlags,
  buildVariantSuffix,
  DEFAULT_BUILD_SETTINGS,
} from "./BuildSettings";

export const MODULE_IMPORT_FILE = "import.hz";
export const MODULE_METADATA_FILE = "metadata.json";
/** The build directory of a build with the default settings. */
export const DEFAULT_BUILD_DIR_NAME = "build";

/** The workspace a build in this process uses (see ProjectCompiler.build). */
export function defaultWorkspaceDir() {
  return join(process.cwd(), "__haze__");
}

/** The directory holding a module's import.hz, metadata.json and library. */
export function moduleInterfaceDir(
  workspaceDir: string,
  moduleName: string,
  buildDirName: string
) {
  return join(workspaceDir, moduleName, buildDirName);
}

export function moduleMetadataFile(
  workspaceDir: string,
  moduleName: string,
  buildDirName: string
) {
  return join(
    moduleInterfaceDir(workspaceDir, moduleName, buildDirName),
    MODULE_METADATA_FILE
  );
}

/**
 * The settings of a build whose outputs are in this workspace, for a reader
 * that has none of its own (the language server): the defaults, unless only
 * a --release build was made here. Judged by the standard library, which
 * every module depends on.
 */
export function settingsOfExistingBuild(workspaceDir: string): BuildSettings {
  const release = buildSettingsFromFlags(true, undefined, undefined);
  const built = (settings: BuildSettings) =>
    existsSync(
      moduleMetadataFile(
        workspaceDir,
        "haze-stdlib",
        `${DEFAULT_BUILD_DIR_NAME}${buildVariantSuffix(settings)}`
      )
    );
  if (!built(DEFAULT_BUILD_SETTINGS) && built(release)) {
    return release;
  }
  return DEFAULT_BUILD_SETTINGS;
}
