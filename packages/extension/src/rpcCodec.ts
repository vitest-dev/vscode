import type { RpcCodec } from 'vitest-vscode-shared'
import v8 from 'node:v8'
import { parse, stringify } from 'flatted'

// Imported by both the extension host and the worker, so it must not import "vscode".

/**
 * The structured-clone format version this process's V8 writes. V8 reads every
 * format up to its own and rejects anything newer ("Unable to deserialize cloned
 * data due to invalid or unsupported version"), so two processes can exchange
 * `v8.serialize` payloads only when these match. The extension host runs on
 * VS Code's Electron, which can be ahead of (or behind) the user's Node.
 */
export function v8FormatVersion(): number {
  // header is 0xFF followed by the version as a varint; every version so far fits in one byte
  return v8.serialize(null)[1]
}

export function pickRpcCodec(
  runtime: string,
  extensionFormatVersion: number | undefined,
  workerFormatVersion: number,
): RpcCodec {
  if (runtime !== 'node') {
    return 'json'
  }
  if (extensionFormatVersion != null && extensionFormatVersion !== workerFormatVersion) {
    return 'json'
  }
  return 'v8'
}

export function createRpcCodec(codec: RpcCodec) {
  if (codec === 'v8') {
    return {
      serialize: (v: any) => v8.serialize(v),
      deserialize: (v: any) => v8.deserialize(Buffer.from(v)),
    }
  }
  return {
    serialize: (v: any) =>
      stringify(v, (_, value) => {
        if (value instanceof Error) {
          return {
            name: value.name,
            message: value.message,
            stack: value.stack,
          }
        }
        return value
      }),
    deserialize: (v: any) => parse(v.toString()),
  }
}
