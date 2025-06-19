const levels = ["none", "trace", "debug", "info", "warn", "error"];
const current = process.env["LOG_LEVEL"] ?? "info";

function enabled(level: string) {
  return levels.indexOf(level) >= levels.indexOf(current);
}

export const logger = {
  trace: (...args: any[]) => enabled("trace") && console.log("[trace]", ...args),
  debug: (...args: any[]) => enabled("debug") && console.log("[debug]", ...args),
  info: (...args: any[]) => enabled("info") && console.log("[info]", ...args),
  warn: (...args: any[]) => enabled("warn") && console.warn("[warn]", ...args),
  error: (...args: any[]) => enabled("error") && console.error("[error]", ...args),
};
