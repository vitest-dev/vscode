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
    return sanitizeFilePath(path.resolve(node_modules, "vitest", "vitest.mjs"));
  }

  const suffixes = [".js", "", ".cmd"];
  for (const suffix of suffixes) {
    if (existsSync(path.resolve(node_modules, ".bin", "vitest" + suffix))) {
      return sanitizeFilePath(
        path.resolve(node_modules, ".bin", "vitest" + suffix),
      );
    }
  }

  return;
}

export function getVitestCommand(
  projectRoot: string,
): { cmd: string; args: string[] } | undefined {
  const node_modules = path.resolve(projectRoot, "node_modules");
  if (!existsSync(node_modules)) {
    return;
  }

  const suffixes = [""];
  if (isWindows) {
    suffixes.unshift(".cmd", ".CMD");
  }

  for (const suffix of suffixes) {
    if (existsSync(path.resolve(node_modules, ".bin", "vitest" + suffix))) {
      return {
        cmd: path.resolve(node_modules, ".bin", "vitest" + suffix),
        args: [],
      };
    }
  }

  if (existsSync(path.resolve(node_modules, "vitest", "vitest.mjs"))) {
    return {
      cmd: "node",
      args: [
        sanitizeFilePath(path.resolve(node_modules, "vitest", "vitest.mjs")),
      ],
    };
  }

  return;
}

export async function getVitestVersion(
  vitestCommand?: { cmd: string; args: string[] },
): Promise<string> {
  let process;
  if (vitestCommand == null) {
    process = spawn("npx", ["vitest", "-v"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } else {
    process = spawn(vitestCommand.cmd, [...vitestCommand.args, "-v"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  for await (const line of chunksToLinesAsync(process.stdout)) {
    process.kill();
    return line.match(/vitest\/(\d+.\d+.\d+)/)![1];
  }

  throw new Error(`Cannot get vitest version from "${vitestCommand}"`);
}

const capitalizeFirstLetter = (string: string) =>
  string.charAt(0).toUpperCase() + string.slice(1);

const replaceDoubleSlashes = (string: string) => string.replace(/\\/g, "/");

export function sanitizeFilePath(path: string) {
  if (isWindows) {
    return capitalizeFirstLetter(replaceDoubleSlashes(path));
  }
  return path;
}

export function filterColorFormatOutput(s: string): string {
  return s.replace(/\u001b\[\d+m/g, "");
}
