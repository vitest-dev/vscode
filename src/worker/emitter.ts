import type WebSocket from 'ws'
import type { WorkerEvent } from './types'

abstract class WorkerEventEmitter {
  abstract name: string

  abstract send(event: any): void
  abstract on(event: string, listener: (...args: any[]) => void): void
  abstract off(event: string, listener: (...args: any[]) => void): void

  ready() {
    this.sendWorkerEvent({ type: 'ready' })
  }

  error(err: any) {
    this.sendWorkerEvent({ type: 'error', error: String(err.stack) })
  }

  debug(...args: string[]) {
    this.sendWorkerEvent({ type: 'debug', args })
  }

  protected sendWorkerEvent(event: WorkerEvent) {
    this.send(event)
  }
}

export class WorkerWSEventEmitter extends WorkerEventEmitter {
  name = 'ws'

  constructor(private ws: WebSocket) {
    super()
  }

  protected override sendWorkerEvent(event: WorkerEvent): void {
    this.ws.send(JSON.stringify(event))
  }

  override send(event: any) {
    this.ws.send(event)
  }

  override on(event: string, listener: (...args: any[]) => void) {
    this.ws.on(event, listener)
  }

  override off(event: string, listener: (...args: any[]) => void) {
    this.ws.off(event, listener)
  }
}

export class WorkerProcessEmitter extends WorkerEventEmitter {
  name = 'process'

  override send(event: WorkerEvent) {
    process.send!(event)
  }

  override on(event: string, listener: (...args: any[]) => void) {
    process.on(event, listener)
  }

  override off(event: string, listener: (...args: any[]) => void) {
    process.off(event, listener)
  }
}
