import type { Vitest as VitestCore } from 'vitest/node'
import type { Vitest } from './vitest'

export class VitestDebugger {
  private _enabled = false
  private _port: number | undefined
  private _address: string | undefined

  constructor(
    ctx: VitestCore,
    private vitest: Vitest,
  ) {
    const inspector = ctx.config.inspector
    Object.defineProperty(ctx.config, 'inspector', {
      get: () => {
        return {
          ...inspector,
          enabled: this.enabled,
          port: this._port,
          host: this._address,
          waitForDebugger: true,
        }
      },
    })
  }

  private get enabled() {
    return this._enabled && !this.vitest.collecting
  }

  public start(port: number, address?: string) {
    this._enabled = true
    this._port = port
    this._address = address
  }

  public stop() {
    this._enabled = false
  }
}
