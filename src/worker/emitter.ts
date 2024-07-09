import type WebSocket from 'ws'
import type { WorkerEvent } from './types'

abstract class WorkerEventEmitter {
  abstract send(event: WorkerEvent): void

  ready() {
    this.send({ type: 'ready' })
  }

  error(err: any) {
    this.send({ type: 'error', error: String(err.stack) })
  }

  debug(...args: string[]) {
    this.send({ type: 'debug', args })
  }
}

export class WorkerWSEventEmitter extends WorkerEventEmitter {
  constructor(private ws: WebSocket) {
    super()
  }

  override send(event: WorkerEvent) {
    this.ws.send(JSON.stringify(event))
  }
}

export class WorkerProcessEmitter extends WorkerEventEmitter {
  override send(event: WorkerEvent) {
    process.send!(event)
  }
}
