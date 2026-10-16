import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSettingsFromFlags,
  DEFAULT_BUILD_SETTINGS,
} from "./BuildSettings";
import { settingsOfExistingBuild } from "./Workspace";

const root = mkdtempSync(join(tmpdir(), "haze-workspace-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function built(workspace: string, dir: string) {
  mkdirSync(join(workspace, "haze-stdlib", dir), { recursive: true });
  writeFileSync(join(workspace, "haze-stdlib", dir, "metadata.json"), "{}");
}

describe("settingsOfExistingBuild", () => {
  test("nothing built: the defaults", () => {
    const ws = join(root, "empty");
    expect(settingsOfExistingBuild(ws)).toEqual(DEFAULT_BUILD_SETTINGS);
  });

  test("only a release build: its settings", () => {
    const ws = join(root, "release");
    built(ws, "build-optimize-nodebug-nodebuginfo");
    expect(settingsOfExistingBuild(ws)).toEqual(
      buildSettingsFromFlags(true, undefined, undefined)
    );
  });

  test("both: the defaults", () => {
    const ws = join(root, "both");
    built(ws, "build");
    built(ws, "build-optimize-nodebug-nodebuginfo");
    expect(settingsOfExistingBuild(ws)).toEqual(DEFAULT_BUILD_SETTINGS);
  });
});
