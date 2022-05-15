import WebSocket from "ws";
import { computed, effect, reactive, ref, shallowRef } from "@vue/reactivity";
import type { ResolvedConfig, WebSocketEvents } from "vitest";
import { createClient } from "./ws-client";

type WebSocketStatus = "OPEN" | "CONNECTING" | "CLOSED";
(globalThis as any).WebSocket = WebSocket;
export type RunState = "idle" | "running";

export function buildWatchClient(
  { url = "ws://localhost:51204/__vitest_api__", handlers }: {
    url?: string;
    handlers?: Partial<WebSocketEvents>;
  },
) {
  const client = createClient(url, {
    handlers,
    WebSocketConstructor: WebSocket as any,
    reactive: reactive as any,
  });

  const config = shallowRef<ResolvedConfig>({} as any);
  const status = ref<WebSocketStatus>("CONNECTING");
  const files = computed(() => client.state.getFiles());

  effect(() => {
    const ws = client.ws;
    status.value = "CONNECTING";
    ws.addEventListener("open", () => {
      console.log("WS Opened");
      status.value = "OPEN";
      client.state.filesMap.clear();
      client.rpc.getFiles().then((files) => client.state.collectFiles(files));
      client.rpc.getConfig().then((_config) => config.value = _config);
    });

    ws.addEventListener("error", (e) => {
      console.error("WS ERROR", e);
    });

    ws.addEventListener("close", () => {
      console.log("WS Close");
      setTimeout(() => {
        if (status.value === "CONNECTING") {
          status.value = "CLOSED";
        }
      }, 1000);
    });
  });

  return {
    client,
    config,
    status,
    files,
  };
}
