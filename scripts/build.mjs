import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const apiDir = path.join(root, "src", "app", "api");
const backupDir = path.join(root, "src", "_api_local_backup");

const isCloudflareOrStatic =
  process.env.STATIC_EXPORT === "1" ||
  process.env.CF_PAGES === "1" ||
  process.env.WORKERS_CI === "1" ||
  process.argv.includes("--static");

if (isCloudflareOrStatic && fs.existsSync(apiDir)) {
  console.log("[RAMA Build] Static/Cloudflare mode detected — exporting static bundle to ./out");
  fs.renameSync(apiDir, backupDir);
}

try {
  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const result = spawnSync(process.execPath, [nextBin, "build"], {
    stdio: "inherit",
    env: {
      ...process.env,
      ...(isCloudflareOrStatic ? { STATIC_EXPORT: "1" } : {}),
    },
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
} finally {
  if (fs.existsSync(backupDir)) {
    fs.renameSync(backupDir, apiDir);
  }
}
