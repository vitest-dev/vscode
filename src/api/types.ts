export interface ExtensionWorkerProcess {
  id: number
  closed: boolean
  close: () => Promise<void>
  onError: (listener: (error: Error) => void) => () => void
  onExit: (listener: (code: number | null) => void) => () => void
}
