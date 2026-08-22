# G. Obtaining the `claude` binary (distribution)

The extension ships its own copy of the CLI (`resources/native-binary/claude`, 337 MB,
version-locked to the extension: 2.1.239 here). A third-party editor should **not** bundle or
extract that copy. The same binary is published by Anthropic through a plain, versioned,
checksummed HTTP release channel — the one `https://claude.ai/install.sh` uses. Observed
2026-08-22 by reading the install script (not executing it) and fetching the public manifest.

## 1. The official release channel

```
GET https://downloads.claude.ai/claude-code-releases/latest
    → "2.1.240"                                   (text/plain version string; also "stable")

GET https://downloads.claude.ai/claude-code-releases/<version>/manifest.json
    → {
        "version": "2.1.240",
        "commit": "d235569e…",
        "buildDate": "2026-08-22T06:09:50Z",
        "platforms": {
          "darwin-arm64":      {"binary":"claude","checksum":"<sha256 hex>","size":325055632},
          "darwin-x64":        {"binary":"claude","checksum":"…","size":333784816},
          "linux-x64":         {"binary":"claude","checksum":"…","size":342636848},
          "linux-arm64":       {"binary":"claude","checksum":"…","size":339794152},
          "linux-x64-musl":    {…},
          "linux-arm64-musl":  {…}
        }
      }

GET https://downloads.claude.ai/claude-code-releases/<version>/<platform>/claude
    → the executable (single static Bun-compiled file, ~330–340 MB)
```

`<version>` may be `latest`-resolved, `stable`-resolved, or an explicit `x.y.z` — so an editor
can **pin** a version it has tested its client against. Windows is served through a different
path (the script refuses on MINGW/MSYS; see https://code.claude.com/docs).

Platform key = `<os>-<arch>[-musl]` with `os ∈ {darwin, linux}`, `arch ∈ {x64, arm64}`; the
installer detects musl via `ldd --version` mentioning musl.

## 2. What the official installer does (reference algorithm)

1. `version = GET …/latest` (or the requested target); reject anything not matching
   `^[0-9]+\.[0-9]+\.[0-9]+` (guards against HTML error pages).
2. `manifest = GET …/<version>/manifest.json`; read `platforms[<platform>].checksum`; must be
   64 hex chars.
3. Download `…/<version>/<platform>/claude` to `~/.claude/downloads/claude-<version>-<platform>`.
4. `sha256` the file; on mismatch delete and abort.
5. `chmod +x`.
6. Run `<binary> install [stable|latest|VERSION]` — the CLI's own installer sets up
   `~/.local/bin/claude` (launcher) plus versioned copies, shell integration and the
   auto-updater. The temporary download is then deleted.

An editor can reproduce steps 1–5 directly in ~50 lines (HTTP GET, JSON parse, sha256, chmod)
and keep the file in its own app-data directory, skipping step 6; or it can run the script
verbatim and then use `~/.local/bin/claude`.

## 3. Recommended policy for a third-party editor

Order of preference, mirroring what the VS Code extension does in terminal mode (it launches
`claude` from `PATH`, not its bundled copy) and its `claudeCode.claudeProcessWrapper` setting:

1. **User-configured path** (setting). Always wins.
2. **Existing install**: `claude` on `PATH`, then `~/.local/bin/claude`.
3. **Offer to install** when missing: either run the official
   `curl -fsSL https://claude.ai/install.sh | bash` with the user's consent, or perform §2
   steps 1–5 against a pinned version into the editor's own directory.
4. Never bundle the binary in the editor's own download; never extract it from the VSIX
   (Marketplace terms prohibit use outside VS Code-family products; the VSIX endpoint is not a
   public API; and it carries an older, unchecksummed copy anyway).

Version handling: record the version you validated the client against (see section A for the
message surface); check `…/latest` periodically and prompt rather than silently upgrade, since
newer CLIs may add control subtypes/fields. The CLI also self-updates when installed via
`claude install`; the editor must tolerate the binary changing under it between spawns (one
process per conversation makes this harmless).

## 4. Auth and identity are the CLI's, not the editor's

Once the binary runs, login is entirely inside it: `--enable-auth-status` yields `auth_status`
messages, and the `claude_authenticate` / `claude_oauth_wait_for_completion` /
`claude_oauth_callback` control requests drive the browser OAuth flow (A §3.2, B §7).
Credentials live in `~/.claude/.credentials.json` and `~/.claude.json` (E §5); the editor
never touches them. `CLAUDE_CODE_ENTRYPOINT` is only a telemetry tag — use your own value
(the extension uses `claude-vscode`).

## 5. Terms

Using the binary through `--input-format stream-json` from a third-party client is what the
Agent SDK interface exists for. Whether an editor may *automatically* download the binary on the
user's behalf (vs. the user running Anthropic's installer) is a terms question, not a technical
one — see https://code.claude.com/docs/en/legal-and-compliance. The conservative default is
option 3a above (run the official installer with explicit user consent).
