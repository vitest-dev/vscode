import { createClient, getTasks } from "@vitest/ws-client";
import WebSocket from "ws";
import { Ref } from "@vue/reactivity";
import { computed, reactive, ref, shallowRef } from "@vue/reactivity";
import type { File, ResolvedConfig } from "vitest";

type WebSocketStatus = "OPEN" | "CONNECTING" | "CLOSED";
export type RunState = "idle" | "running";

export function buildWatchClient(url = "http://localhost:51204") {
  const testRunState: Ref<RunState> = ref("idle");

  const client = createClient(url, {
    WebSocketConstructor: WebSocket as any,
    reactive: reactive as any,
    handlers: {
      onTaskUpdate() {
        testRunState.value = "running";
      },
      onFinished() {
        testRunState.value = "idle";
      },
    },
  });

  const config = shallowRef<ResolvedConfig>({} as any);
  const status = ref<WebSocketStatus>("CONNECTING");
  const files = computed(() => client.state.getFiles());
  const findById = (id: string) => {
    return files.value.find((file) => file.id === id);
  };

  const isConnected = computed(() => status.value === "OPEN");
  const isConnecting = computed(() => status.value === "CONNECTING");
  const isDisconnected = computed(() => status.value === "CLOSED");

  function runAll(files = client.state.getFiles()) {
    return runFiles(files);
  }

  function runFiles(files: File[]) {
    files.forEach((f) => {
      delete f.result;
      getTasks(f).forEach((i) => delete i.result);
    });
    return client.rpc.rerun(files.map((i) => i.filepath));
  }

  const ws = client.ws;
  status.value = "CONNECTING";

  ws.addEventListener("open", () => {
    status.value = "OPEN";
    client.state.filesMap.clear();
    client.rpc.getFiles().then((files) => client.state.collectFiles(files));
    client.rpc.getConfig().then((_config) => config.value = _config);
  });

  ws.addEventListener("close", () => {
    setTimeout(() => {
      if (status.value === "CONNECTING") {
        status.value = "CLOSED";
      }
    }, 1000);
  });

  return {
    testRunState,
    client,
    config,
    status,
    files,
    isConnected,
    isConnecting,
    isDisconnected,
    runAll,
    runFiles,
    findById,
  };
}
