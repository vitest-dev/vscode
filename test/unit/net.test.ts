import net from 'node:net'
import { expect } from 'chai'
import { createBoundServer } from '../../packages/extension/src/net'
import type { AddressInfo } from 'node:net'

function closeServer(server: import('node:http').Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

it('createBoundServer resolves with a server bound to a valid port', async () => {
  const server = await createBoundServer()
  try {
    const addr = server.address() as AddressInfo
    expect(addr.port).to.be.a('number').and.greaterThan(0)
  } finally {
    await closeServer(server)
  }
})

it('createBoundServer: port is already listening (no TOCTOU gap)', async () => {
  const server = await createBoundServer()
  const { port } = (server.address() as AddressInfo)
  try {
    // A TCP connection to the port must succeed immediately — the socket is
    // never released and re-acquired, so there is no window for EADDRINUSE.
    await new Promise<void>((resolve, reject) => {
      const sock = net.connect(port, '127.0.0.1', () => {
        sock.destroy()
        resolve()
      })
      sock.on('error', reject)
    })
  } finally {
    await closeServer(server)
  }
})

it('two concurrent createBoundServer calls receive different ports', async () => {
  const [s1, s2] = await Promise.all([createBoundServer(), createBoundServer()])

  try {
    const p1 = (s1.address() as AddressInfo).port
    const p2 = (s2.address() as AddressInfo).port
    expect(p1).to.not.equal(p2)
  } finally {
    await Promise.all([closeServer(s1), closeServer(s2)])
  }
})
