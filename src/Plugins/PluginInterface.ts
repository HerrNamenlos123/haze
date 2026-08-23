// ============================================================================
// Generic compiler plugin interface.
//
// HARD RULE: nothing in this file (or anywhere else in the compiler core) may
// know anything specific to any particular plugin (e.g. UI/SFC files). The
// core provides only: registration ([plugins] in haze.toml), loading, routing
// every module source file through the loaded transforms, and generic error
// reporting. Everything else lives in the plugin itself.
//
// v0: plugins are TypeScript modules, dynamically imported from the plugin
// module's directory. Phase 1 replaces the loading mechanism with compiled
// haze shared libraries behind the exact same `TransformPlugin` contract --
// keep this interface FFI-shaped: plain data in, plain data out.
// ============================================================================

import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { GeneralError } from "../shared/Errors";

/**
 * The result of a transform. `code` is a complete, syntactically valid haze
 * source file. Source locations pointing back at the original file are
 * expressed *inside* the generated code via `#source` directives -- there is
 * deliberately no side-channel line map.
 */
export type TransformResult = {
  code: string;
};

/**
 * Thrown by plugins for user-facing errors. There are intentionally no
 * per-plugin error codes (they could never be unique across plugins): a
 * plugin error is the plugin's name plus a message string plus an optional
 * location in the ORIGINAL (untransformed) file.
 */
export class PluginError extends Error {
  constructor(
    public pluginName: string,
    message: string,
    public filepath?: string,
    public line?: number, // 1-based
    public column?: number // 1-based
  ) {
    super(message);
  }

  format(): string {
    const loc =
      this.filepath !== undefined
        ? `${this.filepath}${this.line !== undefined ? `:${this.line}` : ""}${
            this.column !== undefined ? `:${this.column}` : ""
          }: `
        : "";
    return `${loc}Plugin '${this.pluginName}': ${this.message}`;
  }
}

/**
 * What a plugin's entry file must export (as `default`).
 *
 * `transform` is called for EVERY source file of the module that declared the
 * plugin (non-inheriting: never for files of other modules). The plugin
 * decides for itself whether a file concerns it (markers, filename, ...) and
 * returns `null` to decline, leaving the file untouched.
 *
 * MUST be pure and deterministic in `source`/`filepath` -- transform output
 * is cacheable by (pluginVersion, sourceHash), and per-file purity is what
 * keeps single-file incremental compiles and hot reload possible.
 */
export type TransformPlugin = {
  name: string;
  /** Bumping this invalidates cached transform output. */
  version: string;
  /**
   * Additional source file extensions this plugin claims (e.g. [".hzui"]).
   * The compiler collects files with these extensions as module sources
   * exactly like `.hz` files (discovery, watching, hashing) and routes them
   * through `transform`. `.hz` files are always collected and are offered
   * to plugins too.
   */
  extensions: string[];
  transform(filepath: string, source: string): TransformResult | null;
};

/** One `[plugins]` entry from haze.toml. */
export type PluginConfigEntry = {
  name: string; // the toml key; informational for now
  path: string; // module directory containing plugin/index.ts
};

/** Relative to the plugin entry's `path`. Convention, v0 only. */
const PLUGIN_ENTRY_RELPATH = join("plugin", "index.ts");

export class PluginHost {
  private plugins: TransformPlugin[] = [];

  private constructor() {}

  /**
   * Loads all plugins declared by ONE module's config. `baseDir` is the
   * directory of that module's haze.toml (plugin paths are relative to it).
   */
  static async load(
    entries: PluginConfigEntry[],
    baseDir: string
  ): Promise<PluginHost> {
    const host = new PluginHost();
    for (const entry of entries) {
      // Must be absolute: a relative specifier would make existsSync resolve
      // against process.cwd() but import() against THIS file's directory.
      const entryFile = resolve(baseDir, entry.path, PLUGIN_ENTRY_RELPATH);
      if (!existsSync(entryFile)) {
        throw new GeneralError(
          `Plugin '${entry.name}': entry file not found: ${entryFile}`
        );
      }
      const mod = await import(entryFile);
      const plugin = mod.default as TransformPlugin | undefined;
      if (
        !plugin ||
        typeof plugin.transform !== "function" ||
        typeof plugin.name !== "string" ||
        !Array.isArray(plugin.extensions)
      ) {
        throw new GeneralError(
          `Plugin '${entry.name}': ${entryFile} must default-export a TransformPlugin ({ name, version, extensions, transform })`
        );
      }
      for (const ext of plugin.extensions) {
        if (!ext.startsWith(".") || ext === ".hz") {
          throw new GeneralError(
            `Plugin '${entry.name}': invalid claimed extension '${ext}' (must start with '.' and not be '.hz')`
          );
        }
      }
      host.plugins.push(plugin);
    }
    return host;
  }

  get isEmpty(): boolean {
    return this.plugins.length === 0;
  }

  /** True if some loaded plugin claims this extension (e.g. ".hzui"). */
  claimsExtension(ext: string): boolean {
    return this.plugins.some((p) => p.extensions.includes(ext));
  }

  /**
   * Runs the file through every loaded plugin. v0: at most one plugin may
   * claim a given file -- a second claimer is an error (no ordering
   * semantics, no plugin composition).
   */
  transform(filepath: string, source: string): string {
    let claimedBy: string | null = null;
    let code = source;
    for (const plugin of this.plugins) {
      const result = plugin.transform(filepath, code);
      if (result === null) {
        continue;
      }
      if (claimedBy !== null) {
        throw new PluginError(
          plugin.name,
          `file is already claimed by plugin '${claimedBy}' -- a file may be transformed by at most one plugin`,
          filepath
        );
      }
      claimedBy = plugin.name;
      code = result.code;
    }
    return code;
  }
}
