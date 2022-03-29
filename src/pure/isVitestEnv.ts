import { existsSync } from "fs";
import { readFile } from "fs-extra";
import path = require("path");
import { getVitestPath } from "./utils";

export async function isVitestEnv(projectRoot: string) {
  if (getVitestPath(projectRoot)) {
    return true;
  }

  const pkgPath = path.join(projectRoot, "package.json") as string;
  const pkg = JSON.parse(await readFile(pkgPath, "utf-8")) as any;
  if (existsSync(pkg)) {
    if (pkg.devDependencies && pkg.devDependencies["vitest"]) {
      return true;
    }
    if (pkg.devDependencies && pkg.devDependencies["jest"]) {
      return false;
    }
  }

  return (
    existsSync(path.join(projectRoot, "vite.config.js")) ||
    existsSync(path.join(projectRoot, "vite.config.ts")) ||
    existsSync(path.join(projectRoot, "vitest.config.js")) ||
    existsSync(path.join(projectRoot, "vitest.config.ts"))
  );
}
