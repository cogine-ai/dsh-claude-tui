/** Cell-grid snapshots of a real ANSI terminal, independent of either UI. */
function color(cell, foreground) {
  const rgb = foreground ? cell.isFgRGB() : cell.isBgRGB()
  const palette = foreground ? cell.isFgPalette() : cell.isBgPalette()
  const value = foreground ? cell.getFgColor() : cell.getBgColor()
  if (rgb) return `#${value.toString(16).padStart(6, '0')}`
  if (palette) return `ansi:${value}`
  return 'default'
}

function style(cell) {
  return {
    fg: color(cell, true),
    bg: color(cell, false),
    attrs: [
      cell.isBold() ? 'bold' : '',
      cell.isDim() ? 'dim' : '',
      cell.isItalic() ? 'italic' : '',
      cell.isUnderline() ? 'underline' : '',
      cell.isInverse() ? 'inverse' : '',
      cell.isStrikethrough() ? 'strike' : '',
    ].filter(Boolean),
  }
}

function styleKey(value) {
  return `${value.fg}|${value.bg}|${value.attrs.join(',')}`
}

export function extractFrame(terminal) {
  const buffer = terminal.buffer.active
  const viewport = buffer.viewportY
  const lines = []
  for (let row = 0; row < terminal.rows; row += 1) {
    const line = buffer.getLine(viewport + row)
    const text = line?.translateToString(true) ?? ''
    const runs = []
    let active
    for (let column = 0; column < terminal.cols; column += 1) {
      const cell = line?.getCell(column)
      if (cell === undefined) continue
      const current = style(cell)
      const key = styleKey(current)
      if (key === 'default|default|') {
        if (active !== undefined) {
          runs.push(active)
          active = undefined
        }
        continue
      }
      if (active !== undefined && active.key === key && active.to === column) {
        active.to = column + 1
      } else {
        if (active !== undefined) runs.push(active)
        active = { from: column, to: column + 1, ...current, key }
      }
    }
    if (active !== undefined) runs.push(active)
    lines.push({
      text,
      runs: runs.map(({ key: _key, ...run }) => run),
    })
  }
  return {
    buffer: buffer.type,
    cursor: { column: buffer.cursorX, row: buffer.cursorY },
    lines,
  }
}

