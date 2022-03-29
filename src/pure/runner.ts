import { spawn } from "child_process";
import { existsSync, readFile } from "fs-extra";
import { tmpdir } from "os";
import * as path from "path";

import { chunksToLinesAsync } from "@rauschma/stringio";

export function getDebuggerConfig() {}

let i = 0;
export function getTempPath(): string {
  return path.join(tmpdir(), `vitest-report-${i++}.json`);
}

type Status = "passed" | "failed" | "skipped" | "pending" | "todo" | "disabled";
type Milliseconds = number;
interface FormattedAssertionResult {
  ancestorTitles: Array<string>;
  fullName: string;
  status: Status;
  title: string;
  duration?: Milliseconds | null;
  failureMessages: Array<string>;
  // location?: Callsite | null
}

interface FormattedTestResult {
  message: string;
  name: string;
  status: "failed" | "passed";
  startTime: number;
  endTime: number;
  assertionResults: Array<FormattedAssertionResult>;
  // summary: string
  // coverage: unknown
}

export interface FormattedTestResults {
  numFailedTests: number;
  numFailedTestSuites: number;
  numPassedTests: number;
  numPassedTestSuites: number;
  numPendingTests: number;
  numPendingTestSuites: number;
  numTodoTests: number;
  numTotalTests: number;
  numTotalTestSuites: number;
  startTime: number;
  success: boolean;
  testResults: Array<FormattedTestResult>;
  // coverageMap?: CoverageMap | null | undefined
  // numRuntimeErrorTestSuites: number
  // snapshot: SnapshotSummary
  // wasInterrupted: boolean
}

export class TestRunner {
  constructor(
    private workspacePath: string,
    private vitestPath: string | undefined,
  ) {}

  async scheduleRun(
    testFile: string[] | undefined,
    testNamePattern: string | undefined,
    log: (msg: string) => void = () => {},
    workspaceEnv: Record<string, string> = {},
    vitestCommand: string[] = this.vitestPath
      ? [this.vitestPath]
      : ["npx", "vitest"],
  ): Promise<FormattedTestResults> {
    const path = getTempPath();
    const command = vitestCommand[0];
    const args = [
      ...vitestCommand.slice(1),
      ...(testFile ? testFile : []),
      "--reporter=json",
      "--reporter=verbose",
      "--outputFile",
      path,
      "--run",
    ] as string[];
    if (testNamePattern) {
      args.push("-t", testNamePattern);
    }

    const workspacePath = this.workspacePath;
    let error: any;
    let outputs: string[] = [];
    const env = { ...process.env, ...workspaceEnv };
    try {
      // it will throw when test failed or the testing is failed to run
      const child = spawn(command, args, {
        cwd: workspacePath,
        stdio: ["ignore", "pipe", "pipe"],
        env,
      });

      for await (const line of chunksToLinesAsync(child.stdout)) {
        log(line + "\r\n");
        outputs.push(line);
      }
    } catch (e) {
      error = e;
    }

    if (!existsSync(path)) {
      await handleError();
    }

    const file = await readFile(path, "utf-8");
    const out = JSON.parse(file) as FormattedTestResults;
    if (out.testResults.length === 0) {
      await handleError();
    }

    return out;

    async function handleError() {
      const prefix = `When running:\n` +
        `    ${command + " " + args.join(" ")}\n` +
        `cwd: ${workspacePath}\n` +
        `node: ${await getNodeVersion()}` +
        `env.PATH: ${env.PATH}`;
      if (error) {
        console.error("scheduleRun error", error.toString());
        console.error(error.stack);
        const e = error;
        error = new Error(prefix + "\n" + error.toString());
        error.stack = e.stack;
      } else {
        error = new Error(prefix + "\n\n------\n\nLog:\n" + outputs.join("\n"));
      }

      console.error(outputs.join("\n"));
      throw error;
    }
  }
}

export async function getNodeVersion() {
  const process = spawn("node", ["-v"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  for await (const line of chunksToLinesAsync(process.stdout)) {
    return line;
  }
}
