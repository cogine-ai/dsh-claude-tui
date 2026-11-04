/** Bounded checks for the remaining undici advisory paths through the selected owner. */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { finished } from 'node:stream/promises'
import { Worker } from 'node:worker_threads'

export async function verifyUndiciParserBounds(ownerPath: string): Promise<void> {
  const owner = createRequire(ownerPath)
  const { EventSourceStream } = owner('undici/lib/web/eventsource/eventsource-stream.js')
  for (const fragments of [Array(1025).fill('data:\n'), Array(1025).fill('x')]) {
    const parser = new EventSourceStream({ maxEventSize: 128 * 1024 })
    parser.resume()
    const completion = finished(parser)
    for (const part of fragments) parser.write(Buffer.from(part))
    parser.end()
    await assert.rejects(completion, /event.*size|maximum.*size|maxEventSize/i)
  }
  const parser = new EventSourceStream({ maxEventSize: 128 * 1024 })
  const events: Array<{ options: { data: string } }> = []
  parser.on('data', (event: { options: { data: string } }) => events.push(event))
  const completion = finished(parser)
  parser.end(Buffer.from('data: healthy event\n\n'))
  await completion
  assert.equal(events[0]?.options.data, 'healthy event')

  await verifyUndiciWebSocketBounds(ownerPath)
}

export async function verifyUndiciWebSocketBounds(ownerPath: string): Promise<void> {
  const { ByteParser } = createRequire(ownerPath)('undici/lib/web/websocket/receiver.js')
  const socket = Object.assign(new EventEmitter(), {
    writableNeedDrain: true,
    writes: 0,
    write(_frame: Buffer) { this.writes++; return !this.writableNeedDrain },
  })
  let pings = 0
  const receiver = new ByteParser({ socket, closeState: new Set(), onPing: () => pings++ }, null)
  // Two legal zero-byte PING frames. A congested socket may queue only one PONG.
  const received = new Promise<void>((resolve, reject) => {
    receiver.write(Buffer.from([0x89, 0, 0x89, 0]), (error?: Error | null) => error ? reject(error) : resolve())
  })
  try {
    assert.equal(socket.writes, 1, 'PING parsing must pause when automatic PONG output encounters backpressure')
    assert.equal(pings, 1)
    socket.writableNeedDrain = false
    socket.emit('drain')
    await received
    assert.equal(socket.writes, 2)
    assert.equal(pings, 2, 'Ordinary PING parsing must resume after drain')
  } finally { receiver.destroy() }
}

export async function verifyUndiciAsyncSurvival(
  ownerPath: string, url: string, modes: readonly ('tls-error' | 'decompress')[] = ['tls-error', 'decompress'],
): Promise<void> {
  for (const mode of modes) {
    const worker = new Worker(`
      const { createRequire } = require('node:module')
      const { parentPort, workerData } = require('node:worker_threads')
      const undici = createRequire(workerData.ownerPath)('undici')
      ;(async () => {
        if (workerData.mode === 'tls-error') {
          let socket
          const client = new undici.Client(workerData.url.replace('http:', 'https:'), {
            connect(options, callback) {
              socket = require('node:net').connect(new URL(workerData.url).port, '127.0.0.1')
              socket.once('connect', () => callback(null, socket))
            },
          })
          try {
            const response = await client.request({ path: '/body', method: 'GET' })
            await response.body.text()
            // Inject Node's post-connect TLS hostname error at the established
            // socket boundary; certificate-changing TLS 1.2 renegotiation emits it.
            socket.emit('error', Object.assign(new Error('fixture renegotiated hostname'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' }))
            await new Promise(resolve => setTimeout(resolve, 50))
          } finally { await client.destroy() }
        } else {
          const agent = new undici.Agent().compose(
            undici.interceptors.decompress(), undici.interceptors.dump({ maxSize: 128 }),
          )
          try {
            let rejected = false
            try { await (await undici.request(workerData.url + '/compressed', { dispatcher: agent, signal: AbortSignal.timeout(5000) })).body.text() }
            catch { rejected = true }
            if (!rejected) throw new Error('Oversized decompressed response was accepted')
            await new Promise(resolve => setTimeout(resolve, 50))
          } finally { await agent.close() }
        }
        const healthy = new undici.Agent()
        try {
          const response = await undici.fetch(workerData.url + '/body', { dispatcher: healthy, signal: AbortSignal.timeout(5000) })
          parentPort.postMessage(await response.text())
        } finally { await healthy.close() }
      })().catch(error => { throw error })
    `, { eval: true, workerData: { ownerPath, url, mode }, env: {}, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 64 } })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await new Promise<string>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${mode}: worker timeout`)), 8000)
        worker.once('message', resolve)
        worker.once('error', reject)
        worker.once('exit', code => reject(new Error(`${mode}: worker exited without result (${code})`)))
      })
      assert.equal(result, 'safe fixture body', `${mode}: process must survive and complete a healthy request`)
    } finally { clearTimeout(timer); await worker.terminate() }
  }
}
