import type { Server } from 'node:http'
import { createServer } from 'node:http'

/**
 * Creates an HTTP server bound to an OS-assigned port by listening on port 0.
 *
 * This avoids the TOCTOU race present in the get-port pattern
 * (bind to 0 → read port → close → re-listen on that port) which causes
 * `EADDRINUSE` under WSL2 mirrored networking, where the kernel holds a
 * phantom listener on ephemeral ports for ~1 second after close.
 *
 * The returned server is already listening; callers should read the port via
 * `(server.address() as AddressInfo).port` and call `server.unref()` as needed.
 */
export function createBoundServer(): Promise<Server> {
  return new Promise<Server>((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, () => resolve(server))
  })
}
