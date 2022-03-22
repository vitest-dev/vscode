import { spawn } from "child_process";
import { existsSync, readFile } from "fs-extra";
import { TaskQueue } from "mighty-promise";
import { tmpdir } from "os";
import * as path from "path";

import { chunksToLinesAsync } from "@rauschma/stringio";

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

export function getDebuggerConfig() {}

let i = 0;
export function getTempPath(): string {
  return path.join(tmpdir(), `vitest-report-${i++}.json`);
}

interface TestResult {
  displayName?: string;
  failureMessage?: string | null;
  skipped: boolean;
  status?: string;
  testFilePath?: string;
  perfStats: {
    end?: number;
    runtime?: number;
    start?: number;
  };
}

interface AggregatedResult {
  numFailedTests: number;
  numFailedTestSuites: number;
  numPassedTests: number;
  numPassedTestSuites: number;
  numPendingTests: number;
  numTodoTests: number;
  numPendingTestSuites: number;
  numTotalTests: number;
  numTotalTestSuites: number;
  startTime: number;
  success: boolean;
  testResults: Array<TestResult>;
}

export class TestRunner {
  private queue = new TaskQueue<Promise<AggregatedResult>>({
    maxParallelNum: 4,
  });
  constructor(
    private workspacePath: string,
    private vitePath: string | undefined
  ) {}

  async scheduleRun(
    testFile: string[] | undefined,
    testNamePattern: string | undefined,
    log: (msg: string) => void = () => {}
  ): Promise<AggregatedResult> {
    return this.queue.push(async () => {
      const path = getTempPath();
      const args = [
        "--reporter=json",
        "--reporter=verbose",
        "--outputFile",
        path,
        "--run",
      ] as string[];
      if (testFile) {
        args.push(...testFile);
      }
      if (testNamePattern) {
        args.push("-t", testNamePattern);
      }

      try {
        let child;
        if (this.vitePath) {
          child = spawn(this.vitePath, args, {
            cwd: this.workspacePath,
            stdio: ["ignore", "pipe", "pipe"],
          });
        } else {
          child = spawn("npx", ["vitest"].concat(args), {
            cwd: this.workspacePath,
            stdio: ["ignore", "pipe", "pipe"],
          });
        }

        for await (const line of chunksToLinesAsync(child.stdout)) {
          log(line + "\r\n");
          console.log("LINE", line);
        }
      } catch (e) {
        console.error(e);
      }

      if (!existsSync(path)) {
        return {
          numFailedTests: 0,
          numFailedTestSuites: 0,
          numPassedTests: 0,
          numPassedTestSuites: 0,
          numPendingTests: 0,
          numTodoTests: 0,
          numPendingTestSuites: 0,
          numTotalTests: 0,
          numTotalTestSuites: 0,
          startTime: 0,
          success: false,
          testResults: [],
        };
      }

      const file = await readFile(path, "utf-8");
      const out = JSON.parse(file) as AggregatedResult;
      return out;
    });
  }
}
