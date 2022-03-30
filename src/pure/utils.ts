import { chunksToLinesAsync } from "@rauschma/stringio";
import { spawn } from "child_process";
import { existsSync } from "fs-extra";
import { isWindows } from "./platform";
import * as path from "path";

export function getVitestPath(projectRoot: string): string | undefined {
  const node_modules = path.resolve(projectRoot, "node_modules");
  if (!existsSync(node_modules)) {
    return;
  }

  if (existsSync(path.resolve(node_modules, "vitest", "vitest.mjs"))) {
    return path.resolve(node_modules, "vitest", "vitest.mjs");
  }

  const suffixes = [".js", "", ".cmd"];
  for (const suffix of suffixes) {
    if (existsSync(path.resolve(node_modules, ".bin", "vitest" + suffix))) {
      return path.resolve(node_modules, ".bin", "vitest" + suffix);
    }
  }

  return;
}

export async function getVitestVersion(vitestPath?: string): Promise<string> {
  let process;
  if (vitestPath == null) {
    process = spawn("npx", ["vitest", "-v"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } else if (vitestPath.endsWith("js") && isWindows) {
    process = spawn("node", [vitestPath, "-v"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } else {
    process = spawn(vitestPath, ["-v"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  for await (const line of chunksToLinesAsync(process.stdout)) {
    process.kill();
    return line.match(/vitest\/(\d+.\d+.\d+)/)![1];
  }

  throw new Error(`Cannot get vitest version from "${vitestPath}"`);
}
