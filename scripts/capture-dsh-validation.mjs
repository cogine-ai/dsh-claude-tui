/** Exercise the real launcher in an isolated HOME against a local Messages fixture. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import * as pty from 'node-pty'
import xterm from '@xterm/headless'
import { extractFrame } from './terminal-frame.mjs'
import { startReferenceAnthropicServer } from './mock-anthropic-reference.mjs'

const output = resolve(process.argv[2] ?? '.validation/dsh')
const cwd = resolve(process.argv[3] ?? process.cwd())
await mkdir(output, { recursive: true })
const server = await startReferenceAnthropicServer('streaming-slow')
const home = await mkdtemp(join(output, 'home-'))
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const env = { ...process.env }
for (const key of Object.keys(env)) {
  if (/^(DSH_|DEEPSEEK_|ANTHROPIC_|CLAUDE_CODE_)/u.test(key)) delete env[key]
}
delete env.NO_COLOR
Object.assign(env, {
  HOME: home, XDG_CONFIG_HOME: join(home, '.config'), DSH_HOME: join(home, '.dsh'),
  DSH_CLAUDE_TUI_RUNTIME: 'bundled', DSH_TELEMETRY_DISABLED: '1',
  DEEPSEEK_API_KEY: 'local-ui-fixture', DEEPSEEK_BASE_URL: server.baseUrl,
  TERM: 'xterm-256color', COLORTERM: 'truecolor', NO_PROXY: '127.0.0.1',
})
const terminal = new xterm.Terminal({
  cols: 100, rows: 30, scrollback: 2000, allowProposedApi: true, logLevel: 'off',
})
const child = pty.spawn(process.execPath, [resolve('lib/cli.js'), '--session-id', 'ux-validation'], {
  cwd, env, cols: 100, rows: 30, name: 'xterm-256color',
})
let pending = Promise.resolve()
let exited = false
child.onData(data => { pending = pending.then(() => new Promise(done => terminal.write(data, done))) })
const response = terminal.onData(data => child.write(data))
const exit = new Promise(done => child.onExit(event => { exited = true; done(event) }))
const sleep = ms => new Promise(done => setTimeout(done, ms))
const text = () => extractFrame(terminal).lines.map(line => line.text).join('\n')
async function wait(expected) {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    await pending
    if (text().includes(expected)) { await sleep(150); await pending; return }
    if (exited) break
    await sleep(25)
  }
  throw new Error(`Expected ${JSON.stringify(expected)}; viewport:\n${text()}`)
}
async function capture(name, input = '', expected) {
  if (input) child.write(input)
  if (expected) await wait(expected)
  await sleep(250)
  await pending
  const record = {
    formatVersion: 1, source: { product: 'dsh-claude-tui', version, transport: 'loopback-reference-api', cwd },
    scenario: name, dimensions: { columns: terminal.cols, rows: terminal.rows }, frame: extractFrame(terminal),
  }
  await writeFile(join(output, `${name}-${terminal.cols}x${terminal.rows}.json`), JSON.stringify(record, null, 2) + '\n')
  console.log(`captured ${name} ${terminal.cols}x${terminal.rows}`)
}
function resize(columns, rows) { terminal.resize(columns, rows); child.resize(columns, rows) }
try {
  await wait('Run /help for commands and shortcuts')
  await capture('welcome')
  resize(80, 24)
  await capture('prompt', '检查中文输入与路径 src/example.ts', '检查中文输入')
  await capture('multiline', '\u001b[200~\n第二行：保留草稿与光标\n第三行 🙂\u001b[201~', '第三行')
  child.write('\u0003')
  await capture('slash', '/', '/help')
  for (let i = 0; i < 6; i++) child.write('\u001b[B')
  await capture('slash-later')
  child.write('\u001b'); await sleep(50); child.write('\u0003')
  await capture('model', '/model\r', 'Select model')
  resize(42, 12)
  await capture('model-short')
  child.write('\u001b'); await sleep(80)
  await capture('slash-short', '/', '/help')
  resize(32, 8)
  await capture('slash-tiny')
  child.write('\u001b'); await sleep(50); child.write('\u0003')
  resize(80, 24)
  await capture('response-streaming', 'Return one deterministic reference response.\r', 'Streaming')
  await wait('Streaming reference response.')
  await sleep(1500)
  await capture('response-complete')
  await capture('history', '\u0012', 'search prompts:')
  child.write('\u001b'); await sleep(50)
  await capture('file-mention', '@', 'README')
  child.write('\u001b'); await sleep(50); child.write('\u0003')
  await capture('help', '/help\r', 'shortcuts')
} finally {
  if (!exited) child.write('\u0003\u0003')
  await Promise.race([exit, sleep(2000)])
  if (!exited) child.kill()
  response.dispose()
  terminal.dispose()
  await server.close()
}
