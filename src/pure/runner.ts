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
    onError: (err) => {
      throw err;
    },
  });
  constructor(
    private workspacePath: string,
    private vitestPath: string | undefined
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

      let child;
      let error: any;
      let outputs: string[] = [];
      try {
        // it will throw when test failed or the testing is failed to run
        if (this.vitestPath) {
          child = spawn(this.vitestPath, args, {
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
          outputs.push(line);
        }
      } catch (e) {
        error = e;
      }

      if (!existsSync(path)) {
        handleError();
      }

      const file = await readFile(path, "utf-8");
      const out = JSON.parse(file) as AggregatedResult;
      if (out.testResults.length === 0) {
        handleError();
      }

      return out;

      function handleError() {
        if (error) {
          console.error("scheduleRun error", error.toString());
          console.error(error.stack);
        } else {
          error = new Error(outputs.join("\n"));
        }

        console.error(outputs.join("\n"));
        return error as Error;
      }
    });
  }
}
