import fs from "node:fs";
import { GeneralError } from "../shared/Errors";

const HAZE_BUILD_LOCK_TIMEOUT_MS = 60_000;
const HAZE_BUILD_LOCK_RETRY_MS = 200;

// function copyFile(source: string, targetFolder: string) {
//   const parent = dirname(targetFolder);
//   if (!fs.existsSync(parent)) {
//     fs.mkdirSync(parent, { recursive: true });
//   }

//   fs.copyFileSync(source, targetFolder);
// }

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isProcessAlive(pid: number) {
  if (!Number.isFinite(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    if (err?.code === "ESRCH") {
      return false;
    }
    return true;
  }
}

export async function acquireBuildLock(lockPath: string) {
  const start = Date.now();

  while (true) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      const payload = {
        pid: process.pid,
        startedAt: new Date().toISOString(),
        cwd: process.cwd(),
      };
      fs.writeFileSync(fd, JSON.stringify(payload), "utf8");
      fs.closeSync(fd);

      return () => {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // ignore
        }
      };
    } catch (err: any) {
      if (err?.code !== "EEXIST") {
        throw err;
      }

      let shouldClear = false;
      try {
        const raw = fs.readFileSync(lockPath, "utf8");
        const data = JSON.parse(raw);
        const pid = typeof data?.pid === "number" ? data.pid : null;
        if (pid !== null && !isProcessAlive(pid)) {
          shouldClear = true;
        }
      } catch {
        // ignore parse/read errors
      }

      if (!shouldClear) {
        try {
          const stat = fs.statSync(lockPath);
          if (Date.now() - stat.mtimeMs > HAZE_BUILD_LOCK_TIMEOUT_MS) {
            shouldClear = true;
          }
        } catch {
          // ignore stat errors
        }
      }

      if (shouldClear) {
        try {
          fs.unlinkSync(lockPath);
          continue;
        } catch {
          // ignore unlink failures and continue to wait
        }
      }

      if (Date.now() - start > HAZE_BUILD_LOCK_TIMEOUT_MS) {
        throw new GeneralError(
          `Timed out waiting for build lock at ${lockPath}. Another build may still be running.`
        );
      }

      await sleep(HAZE_BUILD_LOCK_RETRY_MS);
    }
  }
}
