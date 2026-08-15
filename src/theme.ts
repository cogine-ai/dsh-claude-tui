/** ANSI palette and pi-tui themes for the Claude-like surface. */
import type { EditorTheme, MarkdownTheme, SelectListTheme } from '@earendil-works/pi-tui'

/** Semantic foreground and attribute functions. */
export interface Palette {
  plain(text: string): string
  brand(text: string): string
  brandOnBlack(text: string): string
  dshBadge(text: string): string
  accent(text: string): string
  selection(text: string): string
  selectionTab(text: string): string
  questionText(text: string): string
  plan(text: string): string
  userPromptPrefix(text: string): string
  userPromptText(text: string): string
  userPromptFill(text: string): string
  divider(text: string): string
  dim(text: string): string
  success(text: string): string
  warning(text: string): string
  error(text: string): string
  bold(text: string): string
  faint(text: string): string
  italic(text: string): string
  underline(text: string): string
  reverse(text: string): string
}

/** Wrap one string in a complete SGR sequence. */
function sgr(enabled: boolean, open: number | string, close: number | string): (text: string) => string {
  if (!enabled) return text => text
  return text => `\u001B[${open}m${text}\u001B[${close}m`
}

/** Exact RGB foreground observed from the pinned Claude Code reference. */
function foreground(enabled: boolean, hex: string): (text: string) => string {
  const value = Number.parseInt(hex.slice(1), 16)
  const red = (value >> 16) & 0xff
  const green = (value >> 8) & 0xff
  const blue = value & 0xff
  return sgr(enabled, `38;2;${red};${green};${blue}`, 39)
}

/** Exact true-color foreground/background pair with independent reset. */
function foregroundOn(enabled: boolean, foregroundHex: string | undefined, backgroundHex: string): (text: string) => string {
  if (!enabled) return text => text
  const rgb = (hex: string): [number, number, number] => {
    const value = Number.parseInt(hex.slice(1), 16)
    return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
  }
  const [red, green, blue] = rgb(backgroundHex)
  const foreground = foregroundHex === undefined
    ? ''
    : `38;2;${rgb(foregroundHex).join(';')};`
  return text => `\u001B[${foreground}48;2;${red};${green};${blue}m${text}\u001B[49m${foregroundHex === undefined ? '' : '\u001B[39m'}`
}

/** Create the terminal palette without fixing a background color. */
export function createPalette(color: boolean): Palette {
  const brand = foreground(color, '#d77757')
  return {
    plain: text => text,
    brand,
    brandOnBlack: color
      ? text => `\u001B[38;2;215;119;87m\u001B[48;2;0;0;0m${text}\u001B[49m\u001B[39m`
      : text => text,
    dshBadge: foregroundOn(color, '#ffffff', '#4D6BFE'),
    accent: brand,
    selection: foreground(color, '#b1b9f9'),
    selectionTab: foregroundOn(color, '#000000', '#b1b9f9'),
    questionText: foreground(color, '#ffffff'),
    plan: foreground(color, '#48968c'),
    userPromptPrefix: foregroundOn(color, '#505050', '#373737'),
    userPromptText: foregroundOn(color, '#ffffff', '#373737'),
    userPromptFill: foregroundOn(color, undefined, '#373737'),
    divider: foreground(color, '#888888'),
    dim: foreground(color, '#999999'),
    success: foreground(color, '#4eba65'),
    warning: sgr(color, 33, 39),
    error: foreground(color, '#ff6b80'),
    bold: sgr(color, 1, 22),
    faint: sgr(color, 2, 22),
    italic: sgr(color, 3, 23),
    underline: sgr(color, 4, 24),
    reverse: sgr(color, 7, 27),
  }
}

/** Selection styling shared by editor autocomplete and modal lists. */
export function selectTheme(palette: Palette): SelectListTheme {
  return {
    selectedPrefix: palette.accent,
    selectedText: palette.reverse,
    description: palette.dim,
    scrollInfo: palette.dim,
    noMatch: palette.warning,
  }
}

/** Theme for the multiline prompt editor. */
export function editorTheme(palette: Palette): EditorTheme {
  return { borderColor: palette.dim, selectList: selectTheme(palette) }
}

/** Markdown roles used for assistant responses. */
export function markdownTheme(palette: Palette): MarkdownTheme {
  return {
    heading: text => palette.bold(palette.accent(text)),
    link: palette.underline,
    linkUrl: palette.dim,
    code: palette.warning,
    codeBlock: palette.plain,
    codeBlockBorder: palette.dim,
    quote: palette.dim,
    quoteBorder: palette.dim,
    hr: palette.dim,
    listBullet: palette.accent,
    bold: palette.bold,
    italic: palette.italic,
    strikethrough: palette.dim,
    underline: palette.underline,
  }
}
