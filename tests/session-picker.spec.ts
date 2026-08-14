/** Claude-like startup session picker over the real pi-tui renderer. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ClaudeSessionPicker, type SessionPickerEntry } from '../src/session-picker.ts'
import { createPalette } from '../src/theme.ts'
import { HeadlessTerminal } from './headless-terminal.ts'

interface ReferenceFrame {
  frame: {
    buffer: 'normal' | 'alternate'
    cursor: { column: number; row: number }
    lines: Array<{
      text: string
      runs: Array<{
        from: number
        to: number
        fg: string
        bg: string
        attrs: string[]
      }>
    }>
  }
}

function reference(name: string): ReferenceFrame {
  return JSON.parse(readFileSync(
    new URL(`./fixtures/claude-code-2.1.227/${name}-80x24.json`, import.meta.url),
    'utf8',
  )) as ReferenceFrame
}

function referenceCell(frame: ReferenceFrame, row: number, column: number) {
  const run = frame.frame.lines[row]?.runs.find(item => item.from <= column && column < item.to)
  return {
    fg: run?.fg ?? 'default',
    bg: run?.bg ?? 'default',
    bold: run?.attrs.includes('bold') ?? false,
    dim: run?.attrs.includes('dim') ?? false,
    inverse: run?.attrs.includes('inverse') ?? false,
  }
}

function rowContaining(lines: string[], text: string): number {
  return lines.findIndex(line => line.includes(text))
}

const cwd = '/Users/kiedis/Coding/examples/deepseek-harness'

describe('ClaudeSessionPicker', () => {
  it('matches the independently captured empty-picker geometry and palette', async () => {
    const frame = reference('session-picker-empty')
    const terminal = new HeadlessTerminal(80, 24)
    const picker = new ClaudeSessionPicker(terminal, createPalette(true), { cwd, now: () => 10_000 })
    const result = picker.run([])
    await terminal.settle()

    const lines = terminal.lines()
    const expectedLines = frame.frame.lines.map(line => line.text)
    const dividerRow = rowContaining(expectedLines, '────')
    const titleRow = rowContaining(expectedLines, 'Resume session')
    const emptyRow = rowContaining(expectedLines, 'No conversations found in this project.')
    expect({
      buffer: terminal.bufferType(),
      dividerRow: rowContaining(lines, '────'),
      titleRow: rowContaining(lines, 'Resume session'),
      emptyRow: rowContaining(lines, 'No conversations found in this project.'),
      dividerStyle: terminal.cellStyle(dividerRow, 0),
      titleStyle: terminal.cellStyle(titleRow, 2),
    }).toEqual({
      buffer: frame.frame.buffer,
      dividerRow,
      titleRow,
      emptyRow,
      dividerStyle: referenceCell(frame, dividerRow, 0),
      titleStyle: referenceCell(frame, titleRow, 2),
    })

    terminal.send('\u001b')
    await expect(result).resolves.toBeUndefined()
  })

  it('matches the captured selected-row placement and returns the exact session id', async () => {
    const frame = reference('session-picker-list')
    const terminal = new HeadlessTerminal(80, 24)
    const picker = new ClaudeSessionPicker(terminal, createPalette(true), { cwd, now: () => 10_000 })
    const entries: SessionPickerEntry[] = [{
      id: 'session-reference',
      cwd,
      title: 'Review the session picker implementation',
      createdAt: 8_000,
    }]
    const result = picker.run(entries)
    await terminal.settle()

    const lines = terminal.lines()
    const expectedLines = frame.frame.lines.map(line => line.text)
    const expectedRow = rowContaining(expectedLines, 'Review the session picker implementation')
    const actualRow = rowContaining(lines, 'Review the session picker implementation')
    expect({
      row: actualRow,
      style: terminal.cellStyle(actualRow, 2),
      cursor: terminal.cursor(),
    }).toEqual({
      row: expectedRow,
      style: referenceCell(frame, expectedRow, 2),
      cursor: frame.frame.cursor,
    })

    terminal.send('\r')
    await expect(result).resolves.toBe('session-reference')
  })

  it('toggles all projects, searches titles, and selects only a visible result', async () => {
    const terminal = new HeadlessTerminal(80, 24)
    const picker = new ClaudeSessionPicker(terminal, createPalette(false), { cwd, now: () => 10_000 })
    const result = picker.run([
      { id: 'current', cwd, title: 'Current project', createdAt: 9_000 },
      { id: 'other', cwd: '/workspace/other', title: 'Other project', createdAt: 8_000 },
    ])
    await terminal.settle()
    expect(terminal.text()).not.toContain('Other project')

    terminal.send('\u0001')
    terminal.send('Other')
    await terminal.settle()
    expect(terminal.text()).toContain('Other project')
    expect(terminal.text()).not.toContain('Current project')

    terminal.send('\r')
    await expect(result).resolves.toBe('other')
  })

  it('restores terminal ownership when startup is aborted', async () => {
    const terminal = new HeadlessTerminal(80, 24)
    const controller = new AbortController()
    const picker = new ClaudeSessionPicker(terminal, createPalette(false), {
      cwd,
      now: () => 10_000,
      signal: controller.signal,
    })
    const result = picker.run([])
    await terminal.settle()

    controller.abort(new Error('test shutdown'))

    await expect(result).resolves.toBeUndefined()
    expect(terminal.stopped).toBe(1)
  })
})
