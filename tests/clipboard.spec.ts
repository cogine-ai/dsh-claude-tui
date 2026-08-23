/** Platform clipboard command routing without reading the developer's real clipboard. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clipboardInternals, readSystemClipboardImage } from '../src/clipboard.ts'

const originalInternals = { ...clipboardInternals }
const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

afterEach(() => {
  Object.assign(clipboardInternals, originalInternals)
})

describe('readSystemClipboardImage', () => {
  it('times out a clipboard helper that never exits', async () => {
    const controller = new AbortController()
    clipboardInternals.commandTimeoutMs = () => 20

    const pending = originalInternals.runCommand(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1_000)'],
      controller.signal,
    )
    const outcome = await Promise.race([
      pending.then(() => 'completed', (error: unknown) => error),
      new Promise<string>(resolve => setTimeout(() => { resolve('still pending') }, 100)),
    ])
    if (outcome === 'still pending') controller.abort(new Error('test cleanup'))
    await pending.catch(() => undefined)

    expect(outcome).toBeInstanceOf(Error)
    expect((outcome as Error).message).toContain('timed out')
  })

  it('uses macOS PNG clipboard coercion and removes its private temporary directory', async () => {
    const remove = vi.fn(async () => undefined)
    const calls: Array<{ command: string; args: readonly string[] }> = []
    clipboardInternals.platform = () => 'darwin'
    clipboardInternals.createTemporaryDirectory = async () => '/private/tmp/clipboard-test'
    clipboardInternals.fileSize = async () => png.byteLength
    clipboardInternals.readFile = async () => png
    clipboardInternals.removeTemporaryDirectory = remove
    clipboardInternals.runCommand = async (command, args) => {
      calls.push({ command, args })
      return { kind: 'completed', code: 0, stdout: new Uint8Array() }
    }

    await expect(readSystemClipboardImage(new AbortController().signal)).resolves.toEqual({
      data: png,
      mediaType: 'image/png',
      name: 'clipboard.png',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.command).toBe('/usr/bin/osascript')
    expect(calls[0]?.args.at(-1)).toBe('/private/tmp/clipboard-test/clipboard.png')
    expect(calls[0]?.args.join(' ')).toContain('the clipboard as «class PNGf»')
    expect(remove).toHaveBeenCalledWith('/private/tmp/clipboard-test')
  })

  it('uses the Windows STA clipboard API and writes an intermediate PNG', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = []
    const writes: Array<{ path: string; data: string }> = []
    clipboardInternals.platform = () => 'win32'
    clipboardInternals.createTemporaryDirectory = async () => 'C:\\Temp\\clipboard-test'
    clipboardInternals.fileSize = async () => png.byteLength
    clipboardInternals.readFile = async () => png
    clipboardInternals.writeTextFile = async (path, data) => { writes.push({ path, data }) }
    clipboardInternals.removeTemporaryDirectory = async () => undefined
    clipboardInternals.runCommand = async (command, args) => {
      calls.push({ command, args })
      return { kind: 'completed', code: 0, stdout: new Uint8Array() }
    }

    const image = await readSystemClipboardImage(new AbortController().signal)

    expect(image).toMatchObject({ mediaType: 'image/png', name: 'clipboard.png' })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.command).toBe('powershell.exe')
    expect(calls[0]?.args).toEqual(expect.arrayContaining([
      '-NoProfile',
      '-NonInteractive',
      '-Sta',
      '-File',
    ]))
    expect(calls[0]?.args).not.toContain('-Command')
    expect(calls[0]?.args.at(-2)).toContain('read-clipboard.ps1')
    expect(calls[0]?.args.at(-1)).toContain('clipboard.png')
    expect(writes).toHaveLength(1)
    expect(writes[0]?.path).toContain('read-clipboard.ps1')
    expect(writes[0]?.data).toContain('param([string]$OutputPath)')
    expect(writes[0]?.data).toContain('Clipboard]::ContainsImage()')
    expect(writes[0]?.data).toContain('$image.Save($OutputPath')
    expect(writes[0]?.data).not.toContain('$args[0]')
  })

  it('rejects an oversized Windows clipboard file before loading it into memory', async () => {
    const read = vi.fn(async () => { throw new Error('oversized file was read') })
    clipboardInternals.fileSize = async () => (64 * 1024 * 1024) + 1
    clipboardInternals.platform = () => 'win32'
    clipboardInternals.createTemporaryDirectory = async () => 'C:\\Temp\\oversized-clipboard'
    clipboardInternals.readFile = read
    clipboardInternals.writeTextFile = async () => undefined
    clipboardInternals.removeTemporaryDirectory = async () => undefined
    clipboardInternals.runCommand = async () => ({
      kind: 'completed',
      code: 0,
      stdout: new Uint8Array(),
    })

    await expect(readSystemClipboardImage(new AbortController().signal)).rejects.toThrow('64 MiB')
    expect(read).not.toHaveBeenCalled()
  })

  it('reads Linux image bytes directly through wl-paste before trying xclip', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = []
    clipboardInternals.platform = () => 'linux'
    clipboardInternals.runCommand = async (command, args) => {
      calls.push({ command, args })
      return { kind: 'completed', code: 0, stdout: png }
    }

    await expect(readSystemClipboardImage(new AbortController().signal)).resolves.toMatchObject({
      mediaType: 'image/png',
      name: 'clipboard.png',
    })
    expect(calls).toEqual([{
      command: 'wl-paste',
      args: ['--no-newline', '--type', 'image/png'],
    }])
  })

  it('returns no image for a text-only macOS clipboard and still cleans up', async () => {
    const read = vi.fn(async () => png)
    const remove = vi.fn(async () => undefined)
    clipboardInternals.platform = () => 'darwin'
    clipboardInternals.createTemporaryDirectory = async () => '/private/tmp/text-clipboard'
    clipboardInternals.readFile = read
    clipboardInternals.removeTemporaryDirectory = remove
    clipboardInternals.runCommand = async () => ({
      kind: 'completed',
      code: 1,
      stdout: new Uint8Array(),
    })

    await expect(readSystemClipboardImage(new AbortController().signal)).resolves.toBeUndefined()
    expect(read).not.toHaveBeenCalled()
    expect(remove).toHaveBeenCalledOnce()
  })

  it('does not load a platform helper after cancellation or on an unsupported platform', async () => {
    const run = vi.fn(originalInternals.runCommand)
    clipboardInternals.runCommand = run
    clipboardInternals.platform = () => 'freebsd'
    await expect(readSystemClipboardImage(new AbortController().signal)).resolves.toBeUndefined()
    expect(run).not.toHaveBeenCalled()

    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    const createTemporaryDirectory = vi.fn(async () => '/private/tmp/cancelled')
    clipboardInternals.platform = () => 'darwin'
    clipboardInternals.createTemporaryDirectory = createTemporaryDirectory
    await expect(readSystemClipboardImage(controller.signal)).rejects.toThrow('cancelled')
    expect(createTemporaryDirectory).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })
})
