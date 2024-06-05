export interface VitestProcess {
  close: () => void
  id: number
  closed: boolean
  on: (event: string, listener: (...args: any[]) => void) => void
  off: (event: string, listener: (...args: any[]) => void) => void
  once: (event: string, listener: (...args: any[]) => void) => void
}
