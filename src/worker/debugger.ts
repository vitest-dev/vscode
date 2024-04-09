import type { Vitest as VitestCore } from 'vitest'
import type { Vitest } from './vitest'

export class VitestDebugger {
  private _enabled = false
  private _port: number | undefined

  constructor(
    private ctx: VitestCore,
    private vitest: Vitest,
  ) {
    // @ts-expect-error not released yet
    const inspector = ctx.config.inspector
    Object.defineProperty(ctx.config, 'inspector', {
      get: () => {
        return {
          ...inspector,
          enabled: this.enabled,
          port: this._port,
          waitForDebugger: true,
        }
      },
    })
  }

  public get enabled() {
    return this._enabled && !this.vitest.collecting
  }

  public start(port: number) {
    this._enabled = true
    this._port = port
  }

  public stop() {
    this._enabled = false
  }
}
