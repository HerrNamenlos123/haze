import * as child_process from "node:child_process";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  type ModuleConfig,
  ModuleType,
  PlatformStrings,
  PLATFORM,
  Platform,
} from "../shared/Config";
import {
  CompilerError,
  GeneralError,
  InternalError,
  UnreachableCode,
} from "../shared/Errors";
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
  HAZE_TMP_DIR,
  ModuleCompiler,
  parseConfig,
} from "../ModuleCompiler/ModuleCompiler";

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

  constructor(verbose = false, ignoreLock = false, strip = false) {
    this.verbose = verbose;
    this.ignoreLock = ignoreLock;
    this.strip = strip;
  }

  async getConfig(singleFilename?: string, sourceloc?: boolean) {
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
      config = await parseConfig(undefined, sourceloc);
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
    sourceloc?: boolean,
    fullRebuild?: boolean
  ) {
    if (!(await this.setupToolchain())) {
      return false;
    }

    const config = await this.getConfig(singleFilename, sourceloc);
    if (!config) {
      return false;
    }
    this.globalBuildDir = join(process.cwd(), "__haze__");
    this.setEnv(config);
    mkdirSync(this.globalBuildDir, { recursive: true });

    const releaseBuildLock = this.ignoreLock
      ? null
      : await acquireBuildLock(join(this.globalBuildDir, HAZE_BUILD_LOCKFILE));

    try {
      if (!singleFilename) {
        await this.cache.load(join(this.globalBuildDir, "cache.json"));
      }
      const mainModule = new ModuleCompiler(
        config,
        this.cache,
        this.globalBuildDir,
        join(this.globalBuildDir, config.name),
        this.verbose,
        this.strip
      );

      if (!mainModule.config.nostdlib) {
        const stdlibConfig = await parseConfig(
          join(await getStdlibDirectory(), "core"),
          sourceloc
        );
        if (!stdlibConfig) {
          return false;
        }
        const stdlibModule = new ModuleCompiler(
          stdlibConfig,
          this.cache,
          this.globalBuildDir,
          join(this.globalBuildDir, stdlibConfig.name),
          this.verbose,
          this.strip
        );
        if (!(await stdlibModule.build(false, fullRebuild))) {
          return false;
        }
      }

      if (!singleFilename) {
        const deps = mainModule.config.dependencies;
        for (const dep of deps) {
          const depdir = join(await getStdlibDirectory(), dep.path);

          const depConfig = await parseConfig(depdir, sourceloc);
          if (!depConfig) {
            return false;
          }

          const depModule = new ModuleCompiler(
            depConfig,
            this.cache,
            this.globalBuildDir,
            join(this.globalBuildDir, depConfig.name),
            this.verbose,
            this.strip
          );
          if (!(await depModule.build(false, fullRebuild))) {
            return false;
          }
        }
      }

      if (!(await mainModule.build(true, fullRebuild || this.strip))) {
        return false;
      }

      if (!singleFilename) {
        await this.cache.save();
      }
      return true;
    } finally {
      releaseBuildLock?.();
    }
  }

  async run(
    singleFilename?: string,
    sourceloc?: boolean,
    args?: string[]
  ): Promise<number> {
    try {
      const config = await this.getConfig(singleFilename, sourceloc);
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
            null
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
            execInherit("sudo apt-get update && sudo apt-get install ninja-build");
            break;
          case "fedora":
            execInherit("sudo dnf install ninja-build");
            break;
          default:
            throw new GeneralError("Unsupported package manager for Ninja installation");
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
        execInherit(
          `cd ${builddir} && CFLAGS="-fPIC" CXXFLAGS="-fPIC" ./configure --prefix=${outdir} -disable-tests -disable-shared`
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
