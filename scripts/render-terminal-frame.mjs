/** Render captured terminal cells, not a proposed UI or native terminal screenshot. */
import { readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { visibleWidth } from '@earendil-works/pi-tui'

const [input, output = `${input}.png`] = process.argv.slice(2)
const record = JSON.parse(await readFile(input, 'utf8'))
const { columns, rows } = record.dimensions
const cellWidth = 9, cellHeight = 20, padding = 16
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
const colors = ['#171717', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5', '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#ffffff']
function color(value, fallback) {
  if (!value || value === 'default') return fallback
  if (!value.startsWith('ansi:')) return value
  const n = Number(value.slice(5))
  if (n < 16) return colors[n]
  if (n >= 232) return `rgb(${[8 + (n - 232) * 10].flatMap(x => [x, x, x]).join(',')})`
  const levels = [0, 95, 135, 175, 215, 255], cube = n - 16
  return `rgb(${[levels[Math.floor(cube / 36)], levels[Math.floor(cube / 6) % 6], levels[cube % 6]].join(',')})`
}
const width = columns * cellWidth + padding * 2, height = rows * cellHeight + padding * 2
const pieces = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#171717"/>`]
record.frame.lines.forEach((line, row) => {
  for (const run of line.runs) {
    const background = color(run.attrs.includes('inverse') ? run.fg : run.bg, run.attrs.includes('inverse') ? '#dddddd' : '#171717')
    pieces.push(`<rect x="${padding + run.from * cellWidth}" y="${padding + row * cellHeight}" width="${(run.to - run.from) * cellWidth}" height="${cellHeight}" fill="${background}"/>`)
  }
  let column = 0
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(line.text)) {
    const run = line.runs.find(run => run.from <= column && run.to > column)
    const attrs = run?.attrs ?? []
    const foreground = color(attrs.includes('inverse') ? run?.bg : run?.fg, attrs.includes('inverse') ? '#171717' : '#dddddd')
    pieces.push(`<text x="${padding + column * cellWidth}" y="${padding + row * cellHeight + 15}" font-family="Menlo, PingFang TC, monospace" font-size="14" fill="${foreground}" font-weight="${attrs.includes('bold') ? 700 : 400}" opacity="${attrs.includes('dim') ? 0.65 : 1}" xml:space="preserve">${escape(segment)}</text>`)
    column += visibleWidth(segment)
  }
})
const { column, row } = record.frame.cursor
pieces.push(`<rect x="${padding + column * cellWidth}" y="${padding + row * cellHeight}" width="${cellWidth}" height="${cellHeight}" fill="none" stroke="#dddddd"/></svg>`)
await writeFile(output, await sharp(Buffer.from(pieces.join(''))).png().toBuffer())
console.log(output)
