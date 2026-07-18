import * as child_process from "node:child_process";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  generateModuleId,
  type ModuleConfig,
  ModuleType,
  PlatformStrings,
  PLATFORM,
  Platform,
} from "../shared/Config";
import {
  assert,
  CompilerError,
  GeneralError,
  InternalError,
  UnreachableCode,
} from "../shared/Errors";
import { HazeErrorCode } from "../shared/ErrorCodes";
import { acquireBuildLock } from "../ModuleCompiler/Lock";
import {
  Cache,
  catchErrors,
  exec,
  execInherit,
  getCurrentPlatform,
  getFileWithProgress,
  getStdlibDirectory,
  getToolsDirectory,
  HAZE_C_COMPILER,
  HAZE_CACHE,
  HAZE_CMAKE_TOOLCHAIN,
  HAZE_CXX_COMPILER,
  HAZE_GLOBAL_DIR,
  HAZE_MUSL_SYSROOT,
  HAZE_STDLIB_NAME,
  HAZE_TMP_DIR,
  ModuleCompiler,
  parseConfig,
} from "../ModuleCompiler/ModuleCompiler";
import { CLIPrinter } from "../ModuleCompiler/CLIPrinter";

const HAZE_BUILD_LOCKFILE = "build.lock";

let LLVM_TOOLCHAIN_DOWNLOAD_URL: string;
if (PLATFORM === Platform.Win32) {
  LLVM_TOOLCHAIN_DOWNLOAD_URL =
    "https://github.com/llvm/llvm-project/releases/download/llvmorg-18.1.8/clang+llvm-18.1.8-x86_64-pc-windows-msvc.tar.xz";
} else {
  LLVM_TOOLCHAIN_DOWNLOAD_URL =
    "https://github.com/llvm/llvm-project/releases/download/llvmorg-18.1.8/clang+llvm-18.1.8-x86_64-linux-gnu-ubuntu-18.04.tar.xz";
}

function toCIdentifier(str: string) {
  let id = str.replace(/[^A-Za-z0-9_]/g, "_");
  if (/^[0-9]/.test(id)) {
    id = "_" + id;
  }
  if (id.length === 0) {
    id = "_";
  }
  return id;
}

function commandExists(cmd: string) {
  return new Promise<boolean>((resolve) => {
    const child = spawn("command", ["-v", cmd], { shell: true });
    child.on("close", (code) => resolve(code === 0));
  });
}

async function detectPackageManager() {
  if (await commandExists("dnf")) {
    return "fedora";
  }
  if (await commandExists("yum")) {
    return "rhel";
  }
  if (await commandExists("zypper")) {
    return "suse";
  }
  if (await commandExists("apt-get")) {
    return "debian";
  }
  return "unknown";
}

export class ProjectCompiler {
  cache: Cache = new Cache();
  globalBuildDir = "";
  verbose: boolean;
  ignoreLock: boolean;
  strip: boolean;
  showTiming: boolean;
  silent: boolean;

  constructor(
    verbose = false,
    ignoreLock = false,
    strip = false,
    showTiming = false,
    silent = false
  ) {
    this.verbose = verbose;
    this.ignoreLock = ignoreLock;
    this.strip = strip;
    this.showTiming = showTiming;
    this.silent = silent;
  }

  async getConfig(
    singleFilename?: string,
    explicitDir?: string,
    sourceloc?: boolean
  ) {
    let config: ModuleConfig | undefined;
    if (singleFilename) {
      config = {
        configFilePath: undefined,
        dependencies: [],
        linkerFlags: new PlatformStrings(),
        interfaceLinkerFlags: new PlatformStrings(),
        moduleType: ModuleType.Executable,
        nostdlib: false,
        platform: getCurrentPlatform(),
        name: toCIdentifier(basename(singleFilename)),
        // No haze.toml exists for a single-file `haze exec` run, so there's
        // nothing to persist an id into -- generate a fresh one in memory
        // each time, same as any other ephemeral/scratch config field here.
        id: generateModuleId(),
        version: "0.0.0",
        scripts: {
          any: [],
          linux: [],
          win32: [],
        },
        source: {
          type: "single-file",
          filepath: singleFilename,
        },
        authors: undefined,
        description: undefined,
        license: undefined,
        compilerFlags: new PlatformStrings(),
        includeDirs: new PlatformStrings(),
        macros: new PlatformStrings(),
        interfaceMacros: new PlatformStrings(),
        hzstdLocation: null,
        includeSourceloc: sourceloc ?? true,
        generators: [],
      };
    } else {
      config = await parseConfig(undefined, explicitDir, sourceloc);
    }
    return config;
  }

  setEnv(config: ModuleConfig) {
    const env = process.env as any;
    if (config.configFilePath) {
      env.HAZE_PROJECT_DIR = dirname(config.configFilePath);
    }
    env.HAZE_SYSROOT = HAZE_MUSL_SYSROOT;
    env.HAZE_CMAKE_TOOLCHAIN = HAZE_CMAKE_TOOLCHAIN;
  }

  async build(
    singleFilename?: string,
    explicitDir?: string,
    sourceloc?: boolean,
    fullRebuild?: boolean
  ) {
    if (!(await this.setupToolchain())) {
      return false;
    }

    const config = await this.getConfig(singleFilename, explicitDir, sourceloc);
    if (!config) {
      return false;
    }
    this.globalBuildDir = join(process.cwd(), "__haze__");
    this.setEnv(config);
    mkdirSync(this.globalBuildDir, { recursive: true });

    const releaseBuildLock = this.ignoreLock
      ? null
      : await acquireBuildLock(join(this.globalBuildDir, HAZE_BUILD_LOCKFILE));

    const printer = this.silent ? null : new CLIPrinter(this.showTiming);

    try {
      if (!singleFilename) {
        await this.cache.load(join(this.globalBuildDir, "cache.json"));
      }

      const stdlibDir = await getStdlibDirectory();

      const makeModule = (c: ModuleConfig) =>
        new ModuleCompiler(
          c,
          this.cache,
          this.globalBuildDir,
          join(this.globalBuildDir, c.name),
          this.verbose,
          this.strip
        );

      // -----------------------------------------------------------------------
      // Discover all modules (main + stdlib + transitive deps) recursively.
      // Insertion order: main first, then deps discovered depth-first.
      // -----------------------------------------------------------------------
      type ModuleEntry = {
        config: ModuleConfig;
        compiler: ModuleCompiler;
        effectiveDeps: string[];
      };
      const modules = new Map<string, ModuleEntry>();

      const loadModule = async (cfg: ModuleConfig): Promise<void> => {
        if (modules.has(cfg.name)) {
          return;
        }

        // Compute direct dependency names (stdlib is implicit unless nostdlib).
        const effectiveDeps: string[] = cfg.dependencies.map((d) => d.name);
        if (cfg.name !== HAZE_STDLIB_NAME && !cfg.nostdlib) {
          effectiveDeps.push(HAZE_STDLIB_NAME);
        }

        modules.set(cfg.name, {
          config: cfg,
          compiler: makeModule(cfg),
          effectiveDeps: effectiveDeps,
        });

        // Load stdlib first so it is available as a dependency.
        if (
          cfg.name !== HAZE_STDLIB_NAME &&
          !cfg.nostdlib &&
          !modules.has(HAZE_STDLIB_NAME)
        ) {
          const stdlibConfig = await parseConfig(
            join(stdlibDir, "core"),
            undefined,
            sourceloc
          );
          if (!stdlibConfig) {
            throw new GeneralError("Failed to load stdlib configuration");
          }
          await loadModule(stdlibConfig);
        }

        // Load explicit deps recursively (project builds only).
        if (!singleFilename) {
          for (const dep of cfg.dependencies) {
            if (!modules.has(dep.name)) {
              const depBaseDir = cfg.configFilePath
                ? dirname(cfg.configFilePath)
                : stdlibDir;
              const resolvedDepPath = join(depBaseDir, dep.path);
              let depConfig: Awaited<ReturnType<typeof parseConfig>>;
              try {
                depConfig = await parseConfig(
                  undefined,
                  resolvedDepPath,
                  sourceloc
                );
              } catch {
                throw new GeneralError(
                  `Failed to load dependency '${dep.name}' of module '${cfg.name}':\n` +
                    `  Declared path: ${dep.path}\n` +
                    `  Resolved path: ${resolvedDepPath}\n` +
                    `  No 'haze.toml' found at that location.`
                );
              }
              if (!depConfig) {
                throw new GeneralError(
                  `Failed to load dependency '${dep.name}' of module '${cfg.name}'`
                );
              }
              await loadModule(depConfig);
            }
          }
        }
      };

      await loadModule(config);

      // -----------------------------------------------------------------------
      // Module id conflict detection, project-local only.
      //
      // A machine-global registry (catching collisions across unrelated
      // projects on the same machine, per "expected to be globally unique
      // across all projects ever built by anyone" in
      // `R&D/Hot Reload & Module Identity.md`) is explicitly deferred, not
      // built here. This only catches collisions within this project's own
      // dependency graph, persisted across builds so a stale/removed
      // module's id isn't forgotten the moment its build cache is cleared.
      // -----------------------------------------------------------------------
      if (!singleFilename) {
        const moduleIdsPath = join(this.globalBuildDir, "module-ids.json");
        let idCache: Record<string, string> = {};
        if (existsSync(moduleIdsPath)) {
          idCache = JSON.parse(readFileSync(moduleIdsPath, "utf-8"));
        }

        const conflicts: string[] = [];
        for (const [, entry] of modules) {
          const existingName = idCache[entry.config.id];
          if (existingName === undefined) {
            idCache[entry.config.id] = entry.config.name;
          } else if (existingName !== entry.config.name) {
            conflicts.push(
              `  id '${entry.config.id}': previously registered to module '${existingName}', now also claimed by module '${entry.config.name}'`
            );
          }
        }

        if (conflicts.length > 0) {
          throw new GeneralError(
            `Module id conflict detected -- two different modules share the same id:\n${conflicts.join("\n")}\n\n` +
              "This means two unrelated modules were assigned the same id -- either an accidental collision (e.g. a copy-pasted haze.toml) or a stale cache entry.\n" +
              "Normal fix: regenerate the id of whichever module is actually new/unrelated by deleting its 'id = \"...\"' line from haze.toml and rebuilding.\n" +
              `Only edit or delete the entry directly in '${moduleIdsPath}' if you are confident it is stale (e.g. left over from a module that no longer exists on disk).`
          );
        }

        // Nothing is persisted if a conflict was found above -- fails closed,
        // same as this design's other atomic reload/validation checks.
        writeFileSync(moduleIdsPath, JSON.stringify(idCache, null, 2));
      }

      // -----------------------------------------------------------------------
      // Register all modules with the printer in topological order so indices
      // ([1/N]) are stable and correct from the very first frame.
      // -----------------------------------------------------------------------
      if (printer) {
        for (const name of this.topoSortModules(modules)) {
          assert(modules.has(name));
          const { compiler } = modules.get(name)!;
          compiler.setPrinter(printer, printer.addModule(compiler.config.name));
        }
        printer.start();
      }

      // -----------------------------------------------------------------------
      // Build in parallel, starting each module the moment its deps finish.
      // -----------------------------------------------------------------------
      const success = await this.buildInParallel(
        modules,
        config.name,
        fullRebuild
      );

      if (!singleFilename) {
        await this.cache.save();
      }
      return success;
    } finally {
      printer?.stop();
      releaseBuildLock?.();
    }
  }

  /**
   * Topological sort (post-order DFS) over the module dependency graph.
   * Returns module names in an order where every dependency precedes its
   * dependents — suitable for printer registration and display.
   */
  private topoSortModules(
    modules: Map<string, { effectiveDeps: string[] }>
  ): string[] {
    const visited = new Set<string>();
    const order: string[] = [];

    const visit = (name: string) => {
      if (visited.has(name)) {
        return;
      }
      visited.add(name);
      const entry = modules.get(name);
      if (entry) {
        for (const dep of entry.effectiveDeps) {
          visit(dep);
        }
      }
      order.push(name);
    };

    for (const name of modules.keys()) {
      visit(name);
    }

    return order;
  }

  /**
   * Build all modules concurrently, respecting the dependency graph.
   * A module starts building the instant all of its direct deps complete —
   * no waiting for an entire "layer" to finish.
   */
  private async buildInParallel(
    modules: Map<
      string,
      {
        config: ModuleConfig;
        compiler: ModuleCompiler;
        effectiveDeps: string[];
      }
    >,
    mainModuleName: string,
    fullRebuild: boolean | undefined
  ): Promise<boolean> {
    type BuildResult = { name: string; success: boolean };

    const completed = new Set<string>();
    const running = new Map<string, Promise<BuildResult>>();
    let anyFailed = false;

    const startReady = () => {
      for (const [name, { compiler, effectiveDeps }] of modules) {
        if (completed.has(name) || running.has(name)) {
          continue;
        }
        if (effectiveDeps.some((d) => !completed.has(d))) {
          continue;
        }
        const isTopLevel = name === mainModuleName;
        // The top-level module is forced to rebuild when strip is on (same
        // behaviour as the old serial build).
        const forceRebuild = isTopLevel
          ? (fullRebuild ?? false) || this.strip
          : fullRebuild;

        running.set(
          name,
          compiler
            .build(isTopLevel, forceRebuild)
            .then((success) => ({ name: name, success: !!success }))
            .catch((err: unknown) => {
              process.stderr.write(
                `[${name}] Unhandled build error: ${String(err)}\n`
              );
              return { name: name, success: false };
            })
        );
      }
    };

    startReady();

    while (running.size > 0) {
      // Wait for whichever in-flight build finishes first.
      const result = await Promise.race([...running.values()]);
      running.delete(result.name);

      if (result.success) {
        completed.add(result.name);
      } else {
        anyFailed = true;
      }

      // Start any modules newly unblocked by this completion.
      if (!anyFailed) {
        startReady();
      }
    }

    if (!anyFailed && completed.size < modules.size) {
      // Some modules never became runnable — dependency cycle.
      throw new GeneralError(
        "Build graph has a dependency cycle or unresolvable dependency"
      );
    }

    return !anyFailed;
  }

  /**
   * Run the built executable with all stdout+stderr captured and returned.
   * The caller is responsible for displaying or logging the output.
   */
  async runCaptured(
    singleFilename?: string,
    explicitDir?: string,
    sourceloc?: boolean,
    args?: string[]
  ): Promise<{ exitCode: number; output: string }> {
    const config = await this.getConfig(singleFilename, explicitDir, sourceloc);
    if (!config) {
      return { exitCode: -1, output: "Failed to load configuration\n" };
    }
    this.setEnv(config);

    let moduleExecutable = join(
      join(this.globalBuildDir, config.name, "bin"),
      config.name
    );
    if (PLATFORM === Platform.Win32) {
      moduleExecutable += ".exe";
    }

    const result = child_process.spawnSync(moduleExecutable, args ?? [], {
      stdio: "pipe",
      env: process.env,
    });

    const stdout = result.stdout ? result.stdout.toString("utf8") : "";
    const stderr = result.stderr ? result.stderr.toString("utf8") : "";
    const output = stderr ? stdout + stderr : stdout;
    return { exitCode: result.status ?? -1, output: output };
  }

  async run(
    singleFilename?: string,
    explicitDir?: string,
    sourceloc?: boolean,
    args?: string[]
  ): Promise<number> {
    try {
      const config = await this.getConfig(
        singleFilename,
        explicitDir,
        sourceloc
      );
      if (!config) {
        return -1;
      }
      this.setEnv(config);

      if (config?.moduleType === ModuleType.Library) {
        throw new GeneralError(
          `This module is a library and cannot be executed. Use 'haze build' to build it instead.`
        );
      }

      let moduleExecutable = join(
        join(this.globalBuildDir, config.name, "bin"),
        config.name
      );
      if (PLATFORM === Platform.Win32) {
        moduleExecutable += ".exe";
      }
      process.stdout.write("\n");
      child_process.execSync(`"${moduleExecutable}" ${args?.join(" ")}`, {
        stdio: "inherit",
        env: process.env,
      });
      return 0;
    } catch (e: any) {
      if (e instanceof GeneralError) {
        console.error(e.message);
      } else if (e instanceof InternalError) {
        console.error(e.stack);
        console.error(e.message);
      } else if (e instanceof CompilerError) {
        console.error(e.message);
      } else if (e instanceof UnreachableCode) {
        console.error(e.message);
      } else {
        console.error("Execution failed");
        return e.status as number;
      }
      return -1;
    }
  }

  markStepDone(marker: string) {
    writeFileSync(marker, "ok");
  }

  isStepDone(marker: string) {
    return existsSync(marker);
  }

  async setupToolchain() {
    return await catchErrors(async () => {
      if (!existsSync(HAZE_CACHE)) {
        mkdirSync(HAZE_CACHE, { recursive: true });
      }
      if (!existsSync(HAZE_TMP_DIR)) {
        mkdirSync(HAZE_TMP_DIR, { recursive: true });
      }
      if (!existsSync(HAZE_GLOBAL_DIR)) {
        mkdirSync(HAZE_GLOBAL_DIR, { recursive: true });
      }

      process.env["CC"] = HAZE_C_COMPILER;
      process.env["CXX"] = HAZE_CXX_COMPILER;

      const MARKERS = {
        download: HAZE_CACHE + "/01-download-marker",
        extract: HAZE_CACHE + "/02-extract-marker",
        finish: HAZE_CACHE + "/03-finish-marker",
        ncursesLib: HAZE_CACHE + "/ncurses-lib",
        musl: HAZE_CACHE + "/musl",
        winSDK: HAZE_CACHE + "/win-sdk",
        winNinja: HAZE_CACHE + "/win-ninja",
        systemPackagesInstall: HAZE_CACHE + "/system-packages-install",
        linuxNinja: HAZE_CACHE + "/linux-ninja",
        libunwind: HAZE_CACHE + "/libunwind",
        cmakeToolchain: HAZE_CACHE + "/cmake-toolchain",
        bdwgc: HAZE_CACHE + "/bdgwc",
        regexEngine: HAZE_CACHE + "/regex-engine",
        regexCompiler: HAZE_CACHE + "/regex-compiler",
      };

      if (!this.isStepDone(MARKERS.download)) {
        console.info("Downloading LLVM toolchain...");
        await getFileWithProgress(
          LLVM_TOOLCHAIN_DOWNLOAD_URL,
          HAZE_TMP_DIR + "/llvm.tar.xz"
        );
        this.markStepDone(MARKERS.download);
        console.info("Downloading LLVM toolchain... Done");
      }

      if (!this.isStepDone(MARKERS.systemPackagesInstall)) {
        console.info("Installing required system packages...");
        const packageManager = await detectPackageManager();
        if (packageManager === "debian") {
          exec(
            `sudo apt install autoconf libtool-bin cmake libdwarf-dev liblzma-dev`
          );
        } else if (packageManager === "fedora") {
          exec(`sudo apt install libdwarf-static zlib-static libzstd-static`);
        }
        this.markStepDone(MARKERS.systemPackagesInstall);
        console.info("Installing required system packages... Done");
      }

      if (!this.isStepDone(MARKERS.extract)) {
        console.info("Extracting LLVM toolchain...");
        exec(
          `tar -xf "${HAZE_TMP_DIR + "/llvm.tar.xz"}" -C "${HAZE_GLOBAL_DIR}" --strip-components=1`
        );
        this.markStepDone(MARKERS.extract);
        console.info("Extracting LLVM toolchain... Done");
      }

      if (!this.isStepDone(MARKERS.finish)) {
        this.markStepDone(MARKERS.finish);
        console.info("Toolchain setup finished.");
      }

      if (!this.isStepDone(MARKERS.ncursesLib) && PLATFORM === Platform.Linux) {
        console.info("Retrieving libtinfo.so.5...");
        mkdirSync(`${HAZE_TMP_DIR}/`, { recursive: true });
        const packageManager = await detectPackageManager();
        exec(`rm -f ${HAZE_GLOBAL_DIR}/lib/libtinfo.so.5`);
        if (packageManager === "debian") {
          exec(`rm -f ${HAZE_TMP_DIR}/libtinfo5_6.1-1ubuntu1_amd64.deb*`);
          exec(
            `cd ${HAZE_TMP_DIR} && wget http://archive.ubuntu.com/ubuntu/pool/main/n/ncurses/libtinfo5_6.1-1ubuntu1_amd64.deb`
          );
          exec(
            `dpkg-deb -x ${HAZE_TMP_DIR}/libtinfo5_6.1-1ubuntu1_amd64.deb ${HAZE_GLOBAL_DIR}`
          );
          exec(
            `cd ${HAZE_GLOBAL_DIR + "/lib"} && ln -s x86_64-linux-gnu/libtinfo.so.5 libtinfo.so.5`
          );
        } else if (packageManager === "fedora") {
          exec(`rm -f ${HAZE_TMP_DIR}/libtinfo5_6.1-1ubuntu1_amd64.deb*`);
          exec(
            `cd ${HAZE_TMP_DIR} && wget http://archive.ubuntu.com/ubuntu/pool/main/n/ncurses/libtinfo5_6.1-1ubuntu1_amd64.deb`
          );
          exec(`cd ${HAZE_TMP_DIR} && ar x libtinfo5_6.1-1ubuntu1_amd64.deb`);
          exec(
            `cd ${HAZE_TMP_DIR} && tar -xf data.tar.xz -C ${HAZE_GLOBAL_DIR}`
          );
          exec(
            `cd ${HAZE_GLOBAL_DIR + "/lib"} && ln -s x86_64-linux-gnu/libtinfo.so.5 libtinfo.so.5`
          );
        } else {
          throw new CompilerError(
            "This Distro/Package Manager is not supported yet, please report",
            null,
            HazeErrorCode.ThisDistroPackageManagerNotSupportedYetPlease
          );
        }
        this.markStepDone(MARKERS.ncursesLib);
        console.info("Retrieving libtinfo.so.5... Done");
      }

      if (!this.isStepDone(MARKERS.winSDK) && PLATFORM === Platform.Win32) {
        console.info("Installing Windows SDK...");
        execInherit(
          `powershell -NoLogo -NoProfile -Command \\"if (-not (winget list --name 'Visual Studio Community 2022' | Select-String 'Visual Studio Community 2022')) { winget install 'Visual Studio Community 2022' --override '--add Microsoft.VisualStudio.Workload.NativeDesktop Microsoft.VisualStudio.ComponentGroup.WindowsAppSDK.Cpp' -s msstore } else { Write-Host 'Visual Studio already installed.' }\\"`
        );
        this.markStepDone(MARKERS.winSDK);
        console.info("Installing Windows SDK... Done");
      }

      if (!this.isStepDone(MARKERS.winNinja) && PLATFORM === Platform.Win32) {
        console.info("Installing Ninja Build System...");
        execInherit(
          `powershell -NoLogo -NoProfile -Command "if (-not (winget list --id 'Ninja-build.Ninja' | Select-String 'Ninja-build.Ninja')) { winget install 'Ninja-build.Ninja' } else { Write-Host 'Ninja already installed.'; exit 0 }"`
        );
        this.markStepDone(MARKERS.winNinja);
        console.info("Installing Ninja Build System... Done");
      }

      if (!this.isStepDone(MARKERS.linuxNinja) && PLATFORM === Platform.Linux) {
        console.info("Installing Ninja Build System...");
        switch (await detectPackageManager()) {
          case "debian":
            execInherit(
              "sudo apt-get update && sudo apt-get install ninja-build"
            );
            break;
          case "fedora":
            execInherit("sudo dnf install ninja-build");
            break;
          default:
            throw new GeneralError(
              "Unsupported package manager for Ninja installation"
            );
        }
        this.markStepDone(MARKERS.linuxNinja);
        console.info("Installing Ninja Build System... Done");
      }

      if (!this.isStepDone(MARKERS.libunwind) && PLATFORM === Platform.Linux) {
        const builddir = `${HAZE_TMP_DIR}/libunwind-builddir`;
        const outdir = `${HAZE_GLOBAL_DIR}/haze-libunwind`;
        const commitHash = "812a5305ff097c864d2786b577d2ca0bda76827f";
        console.info("Retrieving and building libunwind...");
        execInherit(`rm -rf ${builddir}`);
        execInherit(`rm -rf ${outdir}`);
        execInherit(`mkdir -p ${builddir}`);
        execInherit(
          `git clone https://github.com/libunwind/libunwind.git ${builddir} && cd ${builddir} && git checkout ${commitHash}`
        );
        execInherit(`cd ${builddir} && autoreconf -i`);
        // DWARF_DEFAULT_LOG_UNW_CACHE_SIZE overrides libunwind's own default
        // per-instruction-pointer unwind-rule cache size (128 entries by
        // default -- 1 << 7). That's a plain fixed-size array baked into
        // dwarf_rs_cache at compile time (no allocation logic changes), so
        // this is exactly libunwind's own intended tuning knob -- normally
        // exposed via unw_set_cache_size(), which is unconditionally broken
        // on any platform with __thread TLS support (i.e. virtually all of
        // them), hence overriding the compile-time default here instead. 15
        // (32768 entries, ~6.5 MB) is libunwind's own supported maximum --
        // see unw_set_cache_size's `if (log_size >= 15) break;` -- and keeps
        // real applications' actual hot-address working sets from evicting
        // each other and forcing constant, expensive re-resolution
        // (dl_iterate_phdr + CFI table parsing) on every sample.
        // Kept as its own CPPFLAGS assignment (a single token, no embedded
        // space) rather than appended into the CFLAGS="..." string below:
        // execInherit wraps this whole command in an extra, unescaped layer
        // of double quotes, and a value containing a space inside one of the
        // already-quoted CFLAGS/CXXFLAGS assignments collides with that outer
        // layer's own quote parsing and silently mangles the whole command
        // (verified: it makes `./configure` receive garbled arguments and
        // produce no Makefile, while `execInherit` still sees exit code 0).
        // A second single-token assignment doesn't have this problem.
        execInherit(
          `cd ${builddir} && CFLAGS="-fPIC" CPPFLAGS="-DDWARF_DEFAULT_LOG_UNW_CACHE_SIZE=15" CXXFLAGS="-fPIC" ./configure --prefix=${outdir} -disable-tests -disable-shared`
        );
        execInherit(`cd ${builddir} && make -j`);
        execInherit(`cd ${builddir} && make install`);
        this.markStepDone(MARKERS.libunwind);
        console.info("Retrieving and building libunwind... Done");
      }

      if (!this.isStepDone(MARKERS.bdwgc)) {
        const builddir = `${HAZE_TMP_DIR}/bdwgc-builddir`;
        const outdir = `${HAZE_GLOBAL_DIR}/haze-bdwgc`;
        const commitHash = "6d018a1f241a9d892e67f25cac1b5b119ae60a88";
        console.info("Retrieving and building bdwgc...");
        if (existsSync(builddir)) {
          const { rmSync } = await import("node:fs");
          rmSync(builddir, { recursive: true, force: true });
        }
        if (existsSync(outdir)) {
          const { rmSync } = await import("node:fs");
          rmSync(outdir, { recursive: true, force: true });
        }
        mkdirSync(builddir);
        execInherit(
          `git clone https://github.com/bdwgc/bdwgc.git "${builddir}" && cd "${builddir}" && git checkout ${commitHash}`
        );
        execInherit(
          `cmake . -B build -G Ninja -DCMAKE_C_COMPILER="${HAZE_C_COMPILER}" -DCMAKE_CXX_COMPILER="${HAZE_CXX_COMPILER}" -DCMAKE_BUILD_TYPE=RelWithDebInfo -DGC_BUILD_SHARED_LIBS=OFF -DCMAKE_INSTALL_PREFIX="${outdir}" -DCMAKE_POSITION_INDEPENDENT_CODE=ON -DBUILD_TESTING=OFF`,
          builddir
        );
        execInherit("cmake --build build -j", builddir);
        execInherit("cmake --build build --target=install", builddir);
        this.markStepDone(MARKERS.bdwgc);
        console.info("Retrieving and building bdwgc... Done");
      }

      if (!this.isStepDone(MARKERS.regexEngine)) {
        const builddir = `${HAZE_TMP_DIR}/pcre2-build`;
        const outdir = `${HAZE_GLOBAL_DIR}/pcre2`;
        const commitHash = "pcre2-10.47";
        console.info("Retrieving and building Regex Engine...");
        if (existsSync(builddir)) {
          const { rmSync } = await import("node:fs");
          rmSync(builddir, { recursive: true, force: true });
        }
        if (existsSync(outdir)) {
          const { rmSync } = await import("node:fs");
          rmSync(outdir, { recursive: true, force: true });
        }
        mkdirSync(builddir);
        execInherit(
          `git clone https://github.com/PCRE2Project/pcre2.git "${builddir}" --branch ${commitHash} -c advice.detachedHead=false --depth 1`
        );
        execInherit("git submodule update --init", builddir);
        execInherit(
          `cmake . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_BUILD_SHARED_LIBS=OFF -DPCRE2_SUPPORT_JIT=ON -DCMAKE_INSTALL_PREFIX="${outdir}" -DCMAKE_POSITION_INDEPENDENT_CODE=ON -DBUILD_TESTING=OFF`,
          builddir
        );
        execInherit("cmake --build build -j", builddir);
        execInherit("cmake --build build --target=install", builddir);
        this.markStepDone(MARKERS.regexEngine);
        console.info("Retrieving and building Regex Engine... Done");
      }

      if (!this.isStepDone(MARKERS.regexCompiler)) {
        console.info("Building Regex Compiler...");
        const outfile = `${HAZE_GLOBAL_DIR}/regex-compiler/haze-regex-compile${
          PLATFORM === Platform.Win32 ? ".exe" : ""
        }`;
        const toolsDir = await getToolsDirectory();
        const projDir = join(toolsDir, "regex-compiler");
        mkdirSync(dirname(outfile), { recursive: true });
        execInherit(
          `cmake . -B "${HAZE_TMP_DIR}/regex-compiler-build" -DHAZE_GLOBAL_DIR="${HAZE_GLOBAL_DIR}" -G Ninja -DCMAKE_C_COMPILER="${HAZE_C_COMPILER}" -DCMAKE_CXX_COMPILER="${HAZE_CXX_COMPILER}"`,
          projDir
        );
        execInherit(
          `cmake --build "${HAZE_TMP_DIR}/regex-compiler-build"`,
          projDir
        );
        this.markStepDone(MARKERS.regexCompiler);
        console.info("Building Regex Compiler... Done");
      }
    });
  }
}
