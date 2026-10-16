// The settings a build is made with, as Haze code sees them.
//
// Each setting is independent of the others, so they combine freely.
// `--release` is only a preset for them (optimized, debug features off, no
// debug info; main.ts also strips), and every part of it can be switched back
// on: `--release --debug` is an optimized build that keeps the debug features.
// Code should test the setting it actually depends on -- `build.debug` for a
// hot-reload file watcher -- and never "is this a release build".
//
// They reach Haze code as an ordinary source file that the compiler writes into
// every module's build directory (buildSettingsSource below), so what a build
// saw is always on disk to look at. Every module gets its own copy, unexported,
// because a module's interface carries no constants to the modules using it.

export type BuildSettings = {
  /** C is compiled with full optimizations (-O3). */
  optimize: boolean;
  /** Debug-only features are on, such as watching embedded files for changes. */
  debug: boolean;
  /**
   * C is compiled with debug info (-g), which is what lets panics and the
   * profiler name file:line.
   */
  debugInfo: boolean;
};

export const DEFAULT_BUILD_SETTINGS: BuildSettings = {
  optimize: false,
  debug: true,
  debugInfo: true,
};

/** An explicit `--[no-]debug` / `--[no-]debug-info` wins over `--release`. */
export function buildSettingsFromFlags(
  release: boolean,
  debug: boolean | null | undefined,
  debugInfo: boolean | null | undefined
): BuildSettings {
  return {
    optimize: release,
    debug: debug ?? !release,
    debugInfo: debugInfo ?? !release,
  };
}

/**
 * Part of every module's build-cache key: artifacts built with different
 * settings are never reused for each other. Empty for the defaults.
 */
export function buildSettingsCacheKey(settings: BuildSettings): string {
  return (
    (settings.optimize ? ":optimize" : "") +
    (settings.debug ? "" : ":nodebug") +
    (settings.debugInfo ? "" : ":nodebuginfo")
  );
}

/**
 * What keeps the outputs of builds with different settings apart, so that
 * switching between them (dev and --release) rebuilds nothing that was built
 * before: each module's build directory is "build" plus this, and so is its
 * build cache's name. Empty for the defaults, whose directory stays "build";
 * "-optimize-nodebug-nodebuginfo" for --release.
 */
export function buildVariantSuffix(settings: BuildSettings): string {
  return buildSettingsCacheKey(settings).replaceAll(":", "-");
}

export const BUILD_SETTINGS_FILENAME = "build_settings.hz";

export function buildSettingsSource(settings: BuildSettings): string {
  return [
    "// Written by the Haze compiler: the settings this build is made with.",
    "// Rewritten when they change -- see src/shared/BuildSettings.ts.",
    "namespace build {",
    `    const comptime optimize = ${settings.optimize};`,
    `    const comptime debug = ${settings.debug};`,
    `    const comptime debugInfo = ${settings.debugInfo};`,
    "}",
    "",
  ].join("\n");
}
