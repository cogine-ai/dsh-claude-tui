/** Cross-platform image clipboard intake behind Claude Code's Ctrl+V gesture. */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ImageMediaType, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'

/** Replaceable composer boundary used by the terminal application and tests. */
export type ReadClipboardImage = (
  signal: AbortSignal,
) => Promise<SaveImageAttachment | undefined>

interface ClipboardCommandResult {
  readonly kind: 'completed' | 'unavailable'
  readonly code: number | null
  readonly stdout: Uint8Array
}

interface ClipboardInternals {
  platform(): NodeJS.Platform
  createTemporaryDirectory(): Promise<string>
  readFile(path: string): Promise<Uint8Array>
  removeTemporaryDirectory(path: string): Promise<void>
  runCommand(
    command: string,
    args: readonly string[],
    signal: AbortSignal,
  ): Promise<ClipboardCommandResult>
}

const MAX_CLIPBOARD_OUTPUT_BYTES = 64 * 1024 * 1024

/** Run one clipboard helper without invoking a shell or retaining its diagnostics. */
async function runClipboardCommand(
  command: string,
  args: readonly string[],
  signal: AbortSignal,
): Promise<ClipboardCommandResult> {
  signal.throwIfAborted()
  return await new Promise<ClipboardCommandResult>((resolve, reject) => {
    const child = spawn(command, [...args], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    })
    const chunks: Buffer[] = []
    let bytes = 0
    let settled = false
    const finish = (
      outcome: ClipboardCommandResult | undefined,
      error?: unknown,
    ): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      if (error !== undefined) reject(error)
      else resolve(outcome!)
    }
    const onAbort = (): void => {
      child.kill()
      finish(undefined, signal.reason ?? new Error('Clipboard image read aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.byteLength
      if (bytes > MAX_CLIPBOARD_OUTPUT_BYTES) {
        child.kill()
        finish(undefined, new Error('Clipboard image exceeds the 64 MiB intake buffer'))
        return
      }
      chunks.push(chunk)
    })
    child.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        finish({ kind: 'unavailable', code: null, stdout: new Uint8Array() })
        return
      }
      finish(undefined, error)
    })
    child.once('close', code => {
      finish({ kind: 'completed', code, stdout: Buffer.concat(chunks) })
    })
  })
}

/** Mutable only so platform command paths can be covered without touching a real clipboard. */
export const clipboardInternals: ClipboardInternals = {
  platform: () => process.platform,
  createTemporaryDirectory: async () => await mkdtemp(join(tmpdir(), 'dsh-claude-tui-clipboard-')),
  readFile: async path => await readFile(path),
  removeTemporaryDirectory: async path => { await rm(path, { recursive: true, force: true }) },
  runCommand: runClipboardCommand,
}

function detectedMediaType(data: Uint8Array): ImageMediaType | undefined {
  if (
    data.length >= 8
    && data[0] === 0x89
    && data[1] === 0x50
    && data[2] === 0x4e
    && data[3] === 0x47
    && data[4] === 0x0d
    && data[5] === 0x0a
    && data[6] === 0x1a
    && data[7] === 0x0a
  ) return 'image/png'
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg'
  }
  const signature = Buffer.from(data.subarray(0, 6)).toString('ascii')
  if (signature === 'GIF87a' || signature === 'GIF89a') return 'image/gif'
  if (
    data.length >= 12
    && Buffer.from(data.subarray(0, 4)).toString('ascii') === 'RIFF'
    && Buffer.from(data.subarray(8, 12)).toString('ascii') === 'WEBP'
  ) return 'image/webp'
  return undefined
}

function clipboardImage(data: Uint8Array): SaveImageAttachment | undefined {
  const mediaType = detectedMediaType(data)
  if (mediaType === undefined) return undefined
  const extension = mediaType === 'image/jpeg' ? 'jpg' : mediaType.slice('image/'.length)
  return {
    data: Uint8Array.from(data),
    mediaType,
    name: `clipboard.${extension}`,
  }
}

const MACOS_CLIPBOARD_SCRIPT = [
  'on run argv',
  'set pngData to (the clipboard as «class PNGf»)',
  'set outputFile to open for access POSIX file (item 1 of argv) with write permission',
  'try',
  'set eof outputFile to 0',
  'write pngData to outputFile',
  'close access outputFile',
  'on error errorMessage number errorNumber',
  'try',
  'close access outputFile',
  'end try',
  'error errorMessage number errorNumber',
  'end try',
  'end run',
] as const

async function readMacClipboard(signal: AbortSignal): Promise<SaveImageAttachment | undefined> {
  const directory = await clipboardInternals.createTemporaryDirectory()
  const outputPath = join(directory, 'clipboard.png')
  try {
    const args = MACOS_CLIPBOARD_SCRIPT.flatMap(line => ['-e', line])
    const result = await clipboardInternals.runCommand(
      '/usr/bin/osascript',
      [...args, outputPath],
      signal,
    )
    if (result.kind !== 'completed' || result.code !== 0) return undefined
    return clipboardImage(await clipboardInternals.readFile(outputPath))
  } finally {
    await clipboardInternals.removeTemporaryDirectory(directory)
  }
}

const WINDOWS_CLIPBOARD_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms',
  'if (-not [System.Windows.Forms.Clipboard]::ContainsImage()) { exit 3 }',
  '$image = [System.Windows.Forms.Clipboard]::GetImage()',
  'try {',
  '  $image.Save($args[0], [System.Drawing.Imaging.ImageFormat]::Png)',
  '} finally {',
  '  $image.Dispose()',
  '}',
].join('\n')

async function readWindowsClipboard(signal: AbortSignal): Promise<SaveImageAttachment | undefined> {
  const directory = await clipboardInternals.createTemporaryDirectory()
  const outputPath = join(directory, 'clipboard.png')
  try {
    const result = await clipboardInternals.runCommand(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Sta', '-Command', WINDOWS_CLIPBOARD_SCRIPT, outputPath],
      signal,
    )
    if (result.kind !== 'completed' || result.code !== 0) return undefined
    return clipboardImage(await clipboardInternals.readFile(outputPath))
  } finally {
    await clipboardInternals.removeTemporaryDirectory(directory)
  }
}

const LINUX_CLIPBOARD_TARGETS = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
] as const

async function readLinuxClipboard(signal: AbortSignal): Promise<SaveImageAttachment | undefined> {
  const helpers = [
    (mediaType: string) => ({
      command: 'wl-paste',
      args: ['--no-newline', '--type', mediaType],
    }),
    (mediaType: string) => ({
      command: 'xclip',
      args: ['-selection', 'clipboard', '-target', mediaType, '-out'],
    }),
  ] as const
  for (const helper of helpers) {
    for (const mediaType of LINUX_CLIPBOARD_TARGETS) {
      const invocation = helper(mediaType)
      const result = await clipboardInternals.runCommand(
        invocation.command,
        invocation.args,
        signal,
      )
      if (result.kind === 'unavailable') break
      if (result.code !== 0) continue
      const image = clipboardImage(result.stdout)
      if (image !== undefined) return image
    }
  }
  return undefined
}

/** Read one supported raster image from the current desktop clipboard. */
export const readSystemClipboardImage: ReadClipboardImage = async (signal) => {
  signal.throwIfAborted()
  switch (clipboardInternals.platform()) {
    case 'darwin':
      return await readMacClipboard(signal)
    case 'win32':
      return await readWindowsClipboard(signal)
    case 'linux':
      return await readLinuxClipboard(signal)
    default:
      return undefined
  }
}
