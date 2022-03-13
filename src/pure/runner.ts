import { existsSync, readFile } from "fs-extra";
import * as path from "path";
import { tmpdir } from "os";
import { Lock } from "mighty-promise";
import execa = require("execa");

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
  private lock = new Lock();
  constructor(
    private workspacePath: string,
    private vitePath: string | undefined
  ) {}
  async scheduleRun(
    testFile: string | undefined,
    testNamePattern: string | undefined
  ): Promise<AggregatedResult> {
    const release = await this.lock.acquire(10000).catch(() => () => {});
    try {
      const path = getTempPath();
      const args = [
        "--reporter=json",
        "--outputFile",
        path,
        "--run",
      ] as string[];
      if (testFile) {
        args.push(testFile);
      }
      if (testNamePattern) {
        args.push("-t", testNamePattern);
      }

      try {
        if (this.vitePath) {
          await execa(this.vitePath, args, {
            windowsHide: false,
            cwd: this.workspacePath,
          });
        } else {
          await execa("npx", ["vitest"].concat(args), {
            cwd: this.workspacePath,
          });
        }
      } catch (e) {
        console.error(e);
      }

      const file = await readFile(path, "utf-8");
      return JSON.parse(file) as AggregatedResult;
    } finally {
      release();
    }
  }
}
