import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { createMcpFixture } from './mcp-protocol.mjs'

const eventPath = process.argv[2]
const record = (event) => appendFileSync(eventPath, `${JSON.stringify(event)}\n`)
const fixture = createMcpFixture()
// Report names only: the fixture never reads or logs ambient credential values.
const credentialKeys = Object.keys(process.env).filter(name => /KEY|PASSWORD|SECRET|TOKEN/i.test(name) || /^DSH_/i.test(name))
record({ event: 'started', pid: process.pid, credentialKeys })
const input = createInterface({ input: process.stdin })
input.on('line', (line) => {
  const message = JSON.parse(line)
  record({ event: 'request', message })
  const response = fixture.handle(message)
  if (response !== undefined) process.stdout.write(`${JSON.stringify(response)}\n`)
})
input.on('close', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
process.on('exit', () => record({ event: 'closed', pid: process.pid }))
