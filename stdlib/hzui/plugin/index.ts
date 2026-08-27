// ============================================================================
// hzui SFC transformer -- compiler plugin entry (v0, TypeScript).
//
// The compiler knows NOTHING about this file's contents beyond the
// TransformPlugin shape (src/Plugins/PluginInterface.ts): a default export
// with { name, version, transform }. The contract is structural on purpose --
// this module does not import compiler code, so it keeps working when the
// module is extracted as a dependency, and Phase 1 can swap it for a
// compiled-haze shared library behind the same shape.
//
// Enable per module (non-inheriting) in haze.toml. Both tables are required:
// [plugins] runs this transformer, [dependencies] is what makes the
// `from hzui import ...` line it generates resolve.
//
//   [dependencies]
//   hzui = { path = "path/to/stdlib/hzui" }
//
//   [plugins]
//   hzui = { path = "path/to/stdlib/hzui" }
// ============================================================================

import { hasMarkers, SectionError } from "./sections";
import { compose, ComposeError } from "./compose";
import { ClassListError } from "./classlist";

const PLUGIN_NAME = "hzui";
const PLUGIN_VERSION = "0.0.1";

/** SFC source files. Registered with the compiler; collected like .hz. */
const SFC_EXTENSION = ".hzui";

export default {
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  extensions: [SFC_EXTENSION],

  transform: (filepath: string, source: string): { code: string } | null => {
    // Routing: by extension. Plain .hz files are never touched.
    if (!filepath.endsWith(SFC_EXTENSION)) {
      return null;
    }
    if (!hasMarkers(source)) {
      throw new Error(
        `${filepath}: a ${SFC_EXTENSION} file must contain at least one section marker (@props, @emit, @slot, @setup, @template)`
      );
    }
    try {
      return { code: compose(filepath, source) };
    } catch (e) {
      // Plugin errors are plain strings -- no error codes (they could never
      // be unique across plugins). The compiler prefixes the plugin name.
      if (e instanceof SectionError || e instanceof ComposeError) {
        throw new Error(`${filepath}:${e.line}: ${e.message}`);
      }
      if (e instanceof ClassListError) {
        throw new Error(`${filepath}: ${e.message}`);
      }
      throw e;
    }
  },
};
