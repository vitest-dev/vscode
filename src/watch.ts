import {
  Disposable,
  TestController,
  TestItem,
  TestMessage,
  TestRun,
  TestRunRequest,
  workspace,
} from "vscode";
import { buildWatchClient } from "./pure/watch/client";
import type { File, Task } from "vitest";
import { TestFileDiscoverer } from "./discover";
import { effect, ref } from "@vue/reactivity";
import { ChildProcess, spawn } from "child_process";
import { getTasks } from "@vitest/ws-client";
import {
  TestCase,
  TestDescribe,
  TestFile,
  WEAKMAP_TEST_DATA,
} from "./TestData";
import { chunksToLinesAsync } from "@rauschma/stringio";
import { isWindows } from "./pure/platform";
import { file } from "@babel/types";

export class TestWatcher extends Disposable {
  static cache: undefined | TestWatcher;
  static isWatching() {
    return !!this.cache?.isWatching.value;
  }

  static create(
    ctrl: TestController,
    discover: TestFileDiscoverer,
    vitest: { cmd: string; args: string[] },
  ) {
    if (this.cache) {
      return this.cache;
    }

    TestWatcher.cache = new TestWatcher(ctrl, discover, vitest);

    return TestWatcher.cache;
  }

  private isWatching = ref(false);
  private process?: ChildProcess;
  private vitestState?: ReturnType<typeof buildWatchClient>;
  private run: TestRun | undefined;
  private constructor(
    private ctrl: TestController,
    private discover: TestFileDiscoverer,
    private vitest: { cmd: string; args: string[] },
  ) {
    super(() => {
      this.dispose();
    });
  }

  public watch() {
    console.log("Start watch mode");
    this.isWatching.value = true;
    this.process = spawn(this.vitest.cmd, [...this.vitest.args, "--api"], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: workspace.workspaceFolders?.[0].uri.fsPath,
      // env,
      shell: isWindows,
      // https://nodejs.org/api/child_process.html#child_process_options_detached
      detached: !isWindows,
    });

    this.process.on("error", (err) => {
      console.error("WATCH PROCESS", err.toString());
      console.log(err.stack);
    });

    this.process.on("close", () => {
      console.log("WATCH PROCESS CLOSE");
    });

    this.process.on("exit", () => {
      console.log("WATCH PROCESS EXIT");
    });

    (async () => {
      for await (const line of chunksToLinesAsync(process.stdout)) {
        console.log("WATCH PROCESS", line);
      }
    })();
    (async () => {
      for await (const line of chunksToLinesAsync(process.stderr)) {
        console.error("WATCH PROCESS", line);
      }
    })();

    this.vitestState = buildWatchClient({
      handlers: {
        onTaskUpdate: (packs) => {
          try {
            if (!this.vitestState) {
              return;
            }

            const idMap = this.vitestState.client.state.idMap;
            const fileSet = new Set<File>();
            for (const [id, _] of packs) {
              const task = idMap.get(id);
              if (!task) {
                continue;
              }

              task.file && fileSet.add(task.file);
            }

            this.onUpdated(Array.from(fileSet), false);
          } catch (e) {
            console.error(e);
          }
        },
        onFinished: (files) => {
          try {
            this.onUpdated(files, true);
            if (!this.run) {
              return;
            }

            this.run.end();
            this.run = undefined;
          } catch (e) {
            console.error(e);
          }
        },
      },
    });
    effect(() => {
      this.onFileUpdated(this.vitestState!.files.value);
    });
  }

  public runTests(tests?: readonly TestItem[]) {
    if (!this.vitestState) {
      return;
    }

    if (tests == null) {
      const files = this.vitestState.files.value;
      this.runFiles(files);
      return;
    }

    this.runFiles(
      this.vitestState.files.value.filter((file) =>
        tests.some((test) =>
          WEAKMAP_TEST_DATA.get(test)!.getFilePath().includes(file.filepath)
        )
      ),
    );
  }

  private runFiles(files: File[]) {
    if (!this.vitestState) {
      return;
    }

    if (!this.run) {
      this.run = this.ctrl.createTestRun(new TestRunRequest());
    }

    for (const file of files) {
      const data = this.discover.discoverTestFromPath(
        this.ctrl,
        file.filepath,
      );

      const run = this.run;
      started(data.item);

      function started(item: TestItem) {
        run.started(item);
        if (item.children) {
          item.children.forEach((child) => {
            started(child);
          });
        }
      }
    }

    files.forEach((f) => {
      delete f.result;
      getTasks(f).forEach((i) => delete i.result);
    });

    const client = this.vitestState.client;
    return client.rpc.rerun(files.map((i) => i.filepath));
  }

  private readonly onFileUpdated = (files?: File[]) => {
    if (files == undefined) {
      this.discover.discoverAllFilesInWorkspace(this.ctrl);
    } else {
      for (const file of files) {
        this.discover.discoverTestFromPath(
          this.ctrl,
          file.filepath,
        );
      }
    }
  };

  private readonly onUpdated = (
    files: File[] | undefined,
    finished: boolean,
  ) => {
    if (!files) {
      return;
    }
    if (!this.run) {
      this.run = this.ctrl.createTestRun(new TestRunRequest());
    }

    for (const file of files) {
      const data = this.discover.discoverTestFromPath(
        this.ctrl,
        file.filepath,
      );

      this.attach(data, file, finished);
    }
  };

  private attach(vscodeFile: TestFile, vitestFile: File, finished: boolean) {
    const run = this.run;
    if (!run) {
      return;
    }

    attach(run, vscodeFile.children, vitestFile.tasks);

    function attach(
      run: TestRun,
      vscode: (TestDescribe | TestCase)[],
      vitest: Task[],
    ) {
      const set = new Set(vscode);
      for (const task of vitest) {
        const data = matchTask(task, set, task.type);
        if (task.type === "test") {
          if (task.result == null) {
            if (finished) {
              run.skipped(data.item);
            }
          } else {
            switch (task.result?.state) {
              case "pass":
                run.passed(data.item, task.result.duration);
                break;
              case "fail":
                run.failed(
                  data.item,
                  new TestMessage(task.result.error?.message ?? ""),
                );
                break;
              case "skip":
              case "todo":
                run.skipped(data.item);
                break;
              case "run":
                run.started(data.item);
                break;
              case "only":
                break;
              default:
                console.error("unexpected result state", task.result);
            }
          }
        } else {
          attach(run, (data as TestDescribe).children, task.tasks);
        }
      }
    }

    function matchTask(
      task: Task,
      candidates: Set<TestDescribe | TestCase>,
      type: "suite" | "test",
    ): (TestDescribe | TestCase) {
      let ans: (TestDescribe | TestCase) | undefined;
      for (const candidate of candidates) {
        if (type === "suite" && !(candidate instanceof TestDescribe)) {
          continue;
        }

        if (type === "test" && !(candidate instanceof TestCase)) {
          continue;
        }

        if (candidate.pattern === task.name) {
          ans = candidate;
          break;
        }
      }

      if (ans) {
        candidates.delete(ans);
      } else {
        // TODO: blur match;
        throw new Error("not implemented");
      }

      return ans;
    }
  }

  public dispose() {
    console.log("Stop watch mode");
    this.isWatching.value = false;
    this.process?.kill();
    this.process = undefined;
    this.vitestState?.client.ws.close();
    this.vitestState = undefined;
  }
}
