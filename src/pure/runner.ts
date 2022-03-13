import { existsSync } from "fs-extra";
import * as path from "path";
import { tmpdir } from "os";

export function getVitePath(projectRoot: string): string | undefined {
  const node_modules = path.resolve(projectRoot, "node_modules");
  if (!existsSync(node_modules)) {
    return;
  }

  if (existsSync(path.resolve(node_modules, ".bin", "vitest"))) {
    return path.resolve(node_modules, ".bin", "vitest");
  }

  if (existsSync(path.resolve(node_modules, ".bin", "vitest.cmd"))) {
    return path.resolve(node_modules, ".bin", "vitest.cmd");
  }


  return;
}

export function getDebuggerConfig() {

}


let i = 0;
export function getTempPath(): string {
  return path.join(tmpdir(), `vitest-report-${i++}.json`);
}