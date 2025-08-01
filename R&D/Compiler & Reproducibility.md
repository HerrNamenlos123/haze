
# Haze CLI & Compiler System Specification

## Overview

Haze is a programming language with a focus on **reproducible builds** and **zero-friction developer experience**. Projects are version-locked and isolated, while users only interact with a single global `haze` CLI.

---

## Components

### `haze` (Frontend CLI)

* A lightweight, system-wide executable installed via `curl`, package manager, or installer.
* Acts as a **shim** or **launcher**.
* Handles:

  * Reading the project configuration (`haze.toml`)
  * Resolving the correct compiler version
  * Downloading and caching `hazec` if necessary
  * Forwarding all arguments to `hazec`

### `hazec` (Compiler Implementation)

* The actual compiler binary for a specific version.
* Downloaded from GitHub Releases.
* Stored in a global cache (e.g. `~/.haze/versions/v1.2.3/hazec`).
* Never called directly by users.

---

## Project Structure

A Haze project includes:

```text
myproject/
├── haze.toml          # Project configuration
├── src/               # Source files
└── .haze/             # (optional) internal state, like symlinks or logs
```

---

## `haze.toml` Format

```toml
[toolchain]
version = "1.2.3"
```

* Created automatically on first `haze init` or `haze build`.
* Pins the exact compiler version for the project.

---

## Behavior Summary

### On First Run (`haze init` or `haze build`)

1. If `haze.toml` does not exist:

   * Create it with the **latest known stable version**.
2. Read the pinned compiler version.
3. If that version is **not cached**:

   * Download from GitHub Releases.
   * Show a CLI progress bar during download.
   * Cache it in: `~/.haze/versions/1.2.3/hazec`
4. Forward all arguments to `hazec` with no visible indirection.

### On Subsequent Runs

* If the version is cached:

  * Instantly forward arguments to `hazec`.
  * No internet required.
  * No delay.

---

## Reproducibility

* Every project has a pinned compiler version.
* Builds are guaranteed to be identical across machines and over time.
* Users can archive or zip the project + `.haze.toml` for long-term reproducibility.
* No global version drift.

---

## Caching Strategy

* Compiler binaries are stored globally (e.g. `~/.haze/versions/`).
* This avoids redownloading across multiple projects.
* Projects may optionally symlink `.haze/compiler → ~/.haze/versions/{version}` for transparency.

---

## CLI Example

```bash
# One-time install
curl -fsSL https://hazelang.dev/install.sh | bash

# Initialize a new project
haze init

# Build the project
haze build

# Fast repeat builds (fully cached)
haze build
```

## Update strategy

The main `haze` executable itself is never updated. It does not do any web requests by itself. Therefore, `haze init` will always use the latest known toolchain version, which is not necessarily the latest one. `haze update` can be used to fetch the list of new versions and then, a new toolchain version is available and can be used by choosing it in `haze.toml`.

If the actual `haze` wrapper executable should be updated, the installation script can simply be executed again.