export interface TocHeading {
  id: string
  level: 2 | 3
  text: string
}

export interface RenderedMarkdown {
  html: string
  headings: TocHeading[]
  wordCount: number
  readingMinutes: number
}

export interface MomentTextSegment {
  type: 'text' | 'link' | 'tag'
  value: string
  href?: string
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/`/g, '&#96;')
}

function normalizeUrlInput(raw: string): string {
  // Strip ASCII control characters and surrounding whitespace before scheme checks.
  return raw.replace(/[\u0000-\u001F\u007F]/g, '').trim()
}

function sanitizeLinkUrl(raw: string): string | null {
  const cleaned = normalizeUrlInput(raw)
  if (!cleaned) return null
  if (/^https?:\/\//i.test(cleaned)) return cleaned
  if (cleaned.startsWith('/') && !cleaned.startsWith('//') && !cleaned.startsWith('/\\')) return cleaned
  if (cleaned.startsWith('#')) return cleaned
  return null
}

function sanitizeImageUrl(raw: string): string | null {
  const cleaned = normalizeUrlInput(raw)
  if (!cleaned) return null
  if (/^https?:\/\//i.test(cleaned)) return cleaned
  if (cleaned.startsWith('/api/blog/media/')) return cleaned
  return null
}

function trimUrlTrailingPunctuation(url: string): { url: string; trailing: string } {
  let end = url.length
  while (end > 0) {
    const ch = url[end - 1]
    if (/[.,!?;:，。！？；：、]/.test(ch)) {
      end -= 1
      continue
    }
    if (ch === ')') {
      const slice = url.slice(0, end)
      const openCount = (slice.match(/\(/g) || []).length
      const closeCount = (slice.match(/\)/g) || []).length
      if (closeCount > openCount) {
        end -= 1
        continue
      }
    }
    if (ch === ']') {
      const slice = url.slice(0, end)
      const openCount = (slice.match(/\[/g) || []).length
      const closeCount = (slice.match(/\]/g) || []).length
      if (closeCount > openCount) {
        end -= 1
        continue
      }
    }
    if (/[）】【》」』"'<>]/.test(ch)) {
      end -= 1
      continue
    }
    break
  }
  return {
    url: url.slice(0, end),
    trailing: url.slice(end)
  }
}

function renderInlineFormattingOnEscaped(escaped: string): string {
  let out = escaped
  // Bold + italic ***text***
  out = out.replace(/\*\*\*([^*\n]+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  // Bold **text**
  out = out.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
  // Strikethrough ~~text~~
  out = out.replace(/~~([^~\n]+?)~~/g, '<del>$1</del>')
  // Italic *text*
  out = out.replace(/(?<!\*)\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)/g, '<em>$1</em>')
  return out
}

function findClosingParen(text: string, openParenIdx: number): number {
  let depth = 1
  for (let i = openParenIdx + 1; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '\n') return -1
    if (ch === '\\' && i + 1 < text.length) {
      i += 1
      continue
    }
    if (ch === '(') depth += 1
    else if (ch === ')') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function replaceMarkdownConstructs(
  input: string,
  kind: 'image' | 'link',
  replacer: (label: string, target: string) => string
): string {
  let out = ''
  let i = 0
  while (i < input.length) {
    const isImageStart = kind === 'image' && input[i] === '!' && input[i + 1] === '['
    const isLinkStart = kind === 'link' && input[i] === '[' && (i === 0 || input[i - 1] !== '!')
    if (isImageStart || isLinkStart) {
      const labelStart = isImageStart ? i + 2 : i + 1
      let closeBracket = -1
      for (let j = labelStart; j < input.length; j += 1) {
        if (input[j] === '\n') break
        if (input[j] === '\\' && j + 1 < input.length) {
          j += 1
          continue
        }
        if (input[j] === ']') {
          closeBracket = j
          break
        }
      }
      if (closeBracket !== -1 && input[closeBracket + 1] === '(') {
        const closeParen = findClosingParen(input, closeBracket + 1)
        if (closeParen !== -1) {
          const label = input.slice(labelStart, closeBracket)
          const target = input.slice(closeBracket + 2, closeParen)
          out += replacer(label, target)
          i = closeParen + 1
          continue
        }
      }
    }
    out += input[i]
    i += 1
  }
  return out
}

function renderInline(rawInput: string, allowLinks = true): string {
  // Remove null bytes so placeholder tokens can never collide with user content.
  let text = rawInput.replace(/\u0000/g, '')
  const tokens: string[] = []
  const stash = (html: string): string => {
    const idx = tokens.length
    tokens.push(html)
    return `\u0000TOK${idx}\u0000`
  }

  // 1. Inline code spans (`code` or ``code``)
  text = text.replace(/(`+)([^\n]*?)\1/g, (_match, _ticks: string, code: string) => {
    const trimmed = code.length >= 2 && code.startsWith(' ') && code.endsWith(' ') ? code.slice(1, -1) : code
    return stash(`<code>${escapeHtml(trimmed)}</code>`)
  })

  // 2. Inline images ![alt](url "optional title")
  text = replaceMarkdownConstructs(text, 'image', (alt, target) => {
    const urlPart = target.trim().replace(/\s+"[^"]*"\s*$/, '').trim()
    const safeSrc = sanitizeImageUrl(urlPart)
    if (!safeSrc) {
      return stash(escapeHtml(alt))
    }
    const escapedSrc = escapeAttr(safeSrc)
    const escapedAlt = escapeAttr(alt.trim())
    return stash(
      `<img class="blog-md-inline-img" src="${escapedSrc}" alt="${escapedAlt}" loading="lazy" data-lightbox-src="${escapedSrc}" />`
    )
  })

  // 3. Markdown links [label](url "optional title")
  if (allowLinks) {
    text = replaceMarkdownConstructs(text, 'link', (label, target) => {
      const urlPart = target.trim().replace(/\s+"[^"]*"\s*$/, '').trim()
      const safeHref = sanitizeLinkUrl(urlPart)
      const renderedLabel = renderInline(label, false)
      if (!safeHref) {
        return stash(renderedLabel)
      }
      const isExternal = /^https?:\/\//i.test(safeHref)
      const extraAttrs = isExternal ? ' target="_blank" rel="noopener noreferrer"' : ''
      return stash(`<a href="${escapeAttr(safeHref)}"${extraAttrs}>${renderedLabel}</a>`)
    })

    // 4. Bare http(s):// auto-links (only at start or after whitespace / CJK / opening brackets, never inside HTML attrs)
    text = text.replace(
      /(^|[\s(（【\[，。！？；：、])(https?:\/\/[^\s<>"'\u0000，。！？；：、（）【】《》「」『』]+)/gi,
      (_match, prefix: string, rawUrl: string) => {
        const { url, trailing } = trimUrlTrailingPunctuation(rawUrl)
        const safeHref = sanitizeLinkUrl(url)
        if (!safeHref) return `${prefix}${rawUrl}`
        const escapedHref = escapeAttr(safeHref)
        const escapedText = escapeHtml(safeHref)
        return `${prefix}${stash(`<a href="${escapedHref}" target="_blank" rel="noopener noreferrer">${escapedText}</a>`)}${trailing}`
      }
    )
  }

  // 5. Escape all remaining raw HTML before applying inline emphasis
  let escaped = escapeHtml(text)
  escaped = renderInlineFormattingOnEscaped(escaped)

  // 6. Restore protected tokens
  return escaped.replace(/\u0000TOK(\d+)\u0000/g, (_match, idxStr: string) => tokens[Number(idxStr)] ?? '')
}

function stripInlineMarkdownToPlain(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\(([^)\n]+)\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)\n]+)\)/g, '$1')
    .replace(/`+([^`\n]+?)`+/g, '$1')
    .replace(/\*\*\*([^*\n]+?)\*\*\*/g, '$1')
    .replace(/\*\*([^*\n]+?)\*\*/g, '$1')
    .replace(/~~([^~\n]+?)~~/g, '$1')
    .replace(/(?<!\*)\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitTableRow(line: string): string[] {
  let trimmed = line.trim()
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1)
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) trimmed = trimmed.slice(0, -1)

  const cells: string[] = []
  let current = ''
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed[i] === '\\' && trimmed[i + 1] === '|') {
      current += '|'
      i += 1
    } else if (trimmed[i] === '|') {
      cells.push(current.trim())
      current = ''
    } else {
      current += trimmed[i]
    }
  }
  cells.push(current.trim())
  return cells
}

type TableAlign = 'left' | 'center' | 'right' | null

function parseTableSeparator(line: string): TableAlign[] | null {
  if (!line.includes('|')) return null
  const cells = splitTableRow(line)
  if (cells.length === 0) return null
  const alignments: TableAlign[] = []
  for (const cell of cells) {
    const clean = cell.trim()
    if (!/^:?-+:?$/.test(clean)) return null
    const startsColon = clean.startsWith(':')
    const endsColon = clean.endsWith(':')
    if (startsColon && endsColon) alignments.push('center')
    else if (endsColon) alignments.push('right')
    else if (startsColon) alignments.push('left')
    else alignments.push(null)
  }
  return alignments
}

function isHorizontalRule(line: string): boolean {
  return /^\s*(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line)
}

function matchStandaloneImage(line: string): { alt: string; url: string } | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('![')) return null
  const closeBracket = trimmed.indexOf('](', 2)
  if (closeBracket === -1) return null
  const closeParen = findClosingParen(trimmed, closeBracket + 1)
  if (closeParen !== trimmed.length - 1) return null
  const alt = trimmed.slice(2, closeBracket)
  const target = trimmed.slice(closeBracket + 2, closeParen)
  const url = target.trim().replace(/\s+"[^"]*"\s*$/, '').trim()
  return { alt, url }
}

function renderCodeBlock(rawLang: string, codeLines: string[]): string {
  const langToken = rawLang.trim().split(/\s+/)[0] || ''
  const displayLang = langToken || 'text'
  const safeLang = escapeHtml(displayLang)
  const safeLangAttr = escapeAttr(displayLang.toLowerCase().replace(/[^a-z0-9_+#.-]/gi, '') || 'text')
  const lineCount = Math.max(1, codeLines.length)
  const lineNumbersHtml = Array.from({ length: lineCount }, (_, idx) => `<span>${idx + 1}</span>`).join('')
  const escapedCode = escapeHtml(codeLines.join('\n'))

  return (
    `<div class="blog-code-block" data-lang="${safeLangAttr}">` +
    `<div class="blog-code-header">` +
    `<div class="blog-code-dots" aria-hidden="true"><span></span><span></span><span></span></div>` +
    `<span class="blog-code-lang">${safeLang}</span>` +
    `<button type="button" class="blog-code-copy" data-code-copy>复制</button>` +
    `</div>` +
    `<div class="blog-code-body">` +
    `<div class="blog-code-lines" aria-hidden="true">${lineNumbersHtml}</div>` +
    `<pre><code class="language-${safeLangAttr}">${escapedCode}</code></pre>` +
    `</div>` +
    `</div>`
  )
}

function isBlockStart(lines: string[], idx: number): boolean {
  const line = lines[idx]
  if (!line || !line.trim()) return true
  if (/^\s*(`{3,}|~{3,})/.test(line)) return true
  if (/^#{1,4}\s+/.test(line)) return true
  if (/^\s*>\s?/.test(line)) return true
  if (isHorizontalRule(line)) return true
  if (matchStandaloneImage(line)) return true
  if (/^\s*[-*+]\s+/.test(line)) return true
  if (/^\s*\d+\.\s+/.test(line)) return true
  if (line.includes('|') && idx + 1 < lines.length && parseTableSeparator(lines[idx + 1])) return true
  return false
}

interface ParseContext {
  headings: TocHeading[]
  extractToc: boolean
  depth: number
}

function renderBlocks(lines: string[], ctx: ParseContext): string {
  const parts: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Blank line
    if (!line.trim()) {
      i += 1
      continue
    }

    // 1. Fenced code block (``` or ~~~)
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})(.*)$/)
    if (fenceMatch) {
      const fenceChar = fenceMatch[1][0]
      const fenceLen = fenceMatch[1].length
      const lang = fenceMatch[2] || ''
      const codeLines: string[] = []
      i += 1
      const closeRe = new RegExp(`^\\s*${fenceChar === '`' ? '`' : '~'}{${fenceLen},}\\s*$`)
      while (i < lines.length && !closeRe.test(lines[i])) {
        codeLines.push(lines[i])
        i += 1
      }
      if (i < lines.length) i += 1
      parts.push(renderCodeBlock(lang, codeLines))
      continue
    }

    // 2. Headings h1..h4
    const headingMatch = line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/)
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3 | 4
      const rawText = headingMatch[2]
      const inlineHtml = renderInline(rawText)
      if (ctx.extractToc && (level === 2 || level === 3)) {
        const id = `h-${ctx.headings.length + 1}`
        const plain = stripInlineMarkdownToPlain(rawText)
        ctx.headings.push({ id, level, text: plain })
        parts.push(`<h${level} id="${id}">${inlineHtml}</h${level}>`)
      } else {
        parts.push(`<h${level}>${inlineHtml}</h${level}>`)
      }
      i += 1
      continue
    }

    // 3. GFM Table
    if (line.includes('|') && i + 1 < lines.length) {
      const alignments = parseTableSeparator(lines[i + 1])
      if (alignments) {
        const headerCells = splitTableRow(line)
        const colCount = Math.max(headerCells.length, alignments.length)
        const theadCells = Array.from({ length: colCount }, (_, colIdx) => {
          const align = alignments[colIdx]
          const styleAttr = align ? ` style="text-align:${align}"` : ''
          return `<th${styleAttr}>${renderInline(headerCells[colIdx] ?? '')}</th>`
        }).join('')

        const bodyRows: string[] = []
        i += 2
        while (i < lines.length) {
          const rowLine = lines[i]
          if (!rowLine.trim() || !rowLine.includes('|')) break
          if (/^\s*(`{3,}|~{3,})/.test(rowLine) || /^#{1,4}\s+/.test(rowLine)) break
          const rowCells = splitTableRow(rowLine)
          const tds = Array.from({ length: colCount }, (_, colIdx) => {
            const align = alignments[colIdx]
            const styleAttr = align ? ` style="text-align:${align}"` : ''
            return `<td${styleAttr}>${renderInline(rowCells[colIdx] ?? '')}</td>`
          }).join('')
          bodyRows.push(`<tr>${tds}</tr>`)
          i += 1
        }

        const tbodyHtml = bodyRows.length ? `<tbody>${bodyRows.join('')}</tbody>` : ''
        parts.push(
          `<div class="blog-table-wrap"><table><thead><tr>${theadCells}</tr></thead>${tbodyHtml}</table></div>`
        )
        continue
      }
    }

    // 4. Horizontal rule
    if (isHorizontalRule(line)) {
      parts.push('<hr />')
      i += 1
      continue
    }

    // 5. Blockquote (merge consecutive > lines)
    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ''))
        i += 1
      }
      if (ctx.depth < 4) {
        const inner = renderBlocks(quoteLines, {
          headings: ctx.headings,
          extractToc: false,
          depth: ctx.depth + 1
        })
        parts.push(`<blockquote>${inner}</blockquote>`)
      } else {
        parts.push(`<blockquote><p>${quoteLines.map((l) => renderInline(l)).join('<br />')}</p></blockquote>`)
      }
      continue
    }

    // 6. Standalone image -> figure
    const standaloneImg = matchStandaloneImage(line)
    if (standaloneImg) {
      const safeSrc = sanitizeImageUrl(standaloneImg.url)
      const altText = standaloneImg.alt.trim()
      if (safeSrc) {
        const escapedSrc = escapeAttr(safeSrc)
        const escapedAlt = escapeAttr(altText)
        const caption = altText ? `<figcaption>${escapeHtml(altText)}</figcaption>` : ''
        parts.push(
          `<figure class="blog-md-figure"><img src="${escapedSrc}" alt="${escapedAlt}" loading="lazy" data-lightbox-src="${escapedSrc}" />${caption}</figure>`
        )
      } else if (altText) {
        parts.push(`<p>${escapeHtml(altText)}</p>`)
      }
      i += 1
      continue
    }

    // 7. Unordered list (including task list checkboxes)
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: Array<{ html: string; isTask: boolean }> = []
      let hasTask = false
      while (i < lines.length) {
        const itemMatch = lines[i].match(/^\s*[-*+]\s+(.*)$/)
        if (!itemMatch) break
        let content = itemMatch[1]
        i += 1
        while (
          i < lines.length &&
          lines[i].trim() !== '' &&
          /^\s{2,}\S/.test(lines[i]) &&
          !/^\s*[-*+]\s+/.test(lines[i]) &&
          !/^\s*\d+\.\s+/.test(lines[i])
        ) {
          content += `\n${lines[i].trim()}`
          i += 1
        }
        const taskMatch = content.match(/^\[([ xX])\]\s+([\s\S]*)$/)
        if (taskMatch) {
          hasTask = true
          const checked = taskMatch[1].toLowerCase() === 'x'
          const bodyHtml = taskMatch[2]
            .split('\n')
            .map((seg) => renderInline(seg))
            .join('<br />')
          items.push({
            isTask: true,
            html: `<li class="blog-task-item"><label><input type="checkbox" disabled${checked ? ' checked' : ''} /><span>${bodyHtml}</span></label></li>`
          })
        } else {
          const bodyHtml = content
            .split('\n')
            .map((seg) => renderInline(seg))
            .join('<br />')
          items.push({ isTask: false, html: `<li>${bodyHtml}</li>` })
        }
      }
      const cls = hasTask ? ' class="blog-task-list"' : ''
      parts.push(`<ul${cls}>${items.map((item) => item.html).join('')}</ul>`)
      continue
    }

    // 8. Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length) {
        const itemMatch = lines[i].match(/^\s*\d+\.\s+(.*)$/)
        if (!itemMatch) break
        let content = itemMatch[1]
        i += 1
        while (
          i < lines.length &&
          lines[i].trim() !== '' &&
          /^\s{2,}\S/.test(lines[i]) &&
          !/^\s*[-*+]\s+/.test(lines[i]) &&
          !/^\s*\d+\.\s+/.test(lines[i])
        ) {
          content += `\n${lines[i].trim()}`
          i += 1
        }
        const bodyHtml = content
          .split('\n')
          .map((seg) => renderInline(seg))
          .join('<br />')
        items.push(`<li>${bodyHtml}</li>`)
      }
      parts.push(`<ol>${items.join('')}</ol>`)
      continue
    }

    // 9. Paragraph
    const paraLines: string[] = [line]
    i += 1
    while (i < lines.length && !isBlockStart(lines, i)) {
      paraLines.push(lines[i])
      i += 1
    }
    const paraHtml = paraLines.map((l) => renderInline(l.replace(/\s{2,}$/, ''))).join('<br />')
    parts.push(`<p>${paraHtml}</p>`)
  }

  return parts.join('\n')
}

function countWords(markdown: string): number {
  const withoutUrls = markdown
    .replace(/!\[([^\]]*)\]\([^)\n]+\)/g, ' $1 ')
    .replace(/\[([^\]]+)\]\([^)\n]+\)/g, ' $1 ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/^\s*(`{3,}|~{3,}).*$/gm, ' ')
    .replace(/<[^>]+>/g, ' ')

  const cjkMatches = withoutUrls.match(/[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/g)
  const cjkCount = cjkMatches ? cjkMatches.length : 0

  const withoutCjk = withoutUrls.replace(/[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/g, ' ')
  const latinMatches = withoutCjk.match(/[A-Za-z0-9]+(?:['’_-][A-Za-z0-9]+)*/g)
  const latinCount = latinMatches ? latinMatches.length : 0

  return cjkCount + latinCount
}

export function renderArticleMarkdown(markdown: string): RenderedMarkdown {
  const normalized = (markdown || '').replace(/\r\n?/g, '\n')
  const headings: TocHeading[] = []
  const html = renderBlocks(normalized.split('\n'), {
    headings,
    extractToc: true,
    depth: 0
  })
  const wordCount = countWords(normalized)
  const readingMinutes = Math.max(1, Math.ceil(wordCount / 320))
  return {
    html,
    headings,
    wordCount,
    readingMinutes
  }
}

export function generateExcerpt(markdown: string, maxLength = 140): string {
  const normalized = (markdown || '').replace(/\r\n?/g, '\n')
  const stripSyntax = (source: string): string =>
    source
      .replace(/!\[[^\]]*\]\([^)\n]+\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)\n]+\)/g, '$1')
      .replace(/^\s*\|?(?:\s*:?-{1,}:?\s*\|)+\s*:?-{1,}:?\s*\|?\s*$/gm, ' ')
      .replace(/^\s*(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/gm, ' ')
      .replace(/^\s*#{1,6}\s+/gm, '')
      .replace(/^\s*>\s?/gm, '')
      .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/\|/g, ' ')
      .replace(/`+([^`\n]+?)`+/g, '$1')
      .replace(/\*\*\*([^*\n]+?)\*\*\*/g, '$1')
      .replace(/\*\*([^*\n]+?)\*\*/g, '$1')
      .replace(/~~([^~\n]+?)~~/g, '$1')
      .replace(/(?<!\*)\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

  const withoutFences = normalized.replace(/(^|\n)\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\s*\2\s*(?=\n|$)|$)/g, ' ')
  let plain = stripSyntax(withoutFences)
  if (!plain) {
    // Fall back to keeping fenced block content if the article consists solely of code.
    plain = stripSyntax(normalized.replace(/^\s*(`{3,}|~{3,}).*$/gm, ' '))
  }

  if (maxLength <= 0 || plain.length <= maxLength) {
    return plain
  }
  return `${plain.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`
}

export function formatMomentText(text: string): MomentTextSegment[] {
  if (!text) return []

  const segments: MomentTextSegment[] = []
  const pushText = (value: string) => {
    if (!value) return
    const last = segments[segments.length - 1]
    if (last && last.type === 'text') {
      last.value += value
    } else {
      segments.push({ type: 'text', value })
    }
  }

  const pattern =
    /(https?:\/\/[^\s<>"'，。！？；：、（）【】《》「」『』]+)|((?:^|[\s，。！？、；：（【\[])#([A-Za-z0-9_\-\u4e00-\u9fff]+))/gi
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    const matchStart = match.index
    if (matchStart > cursor) {
      pushText(text.slice(cursor, matchStart))
    }

    if (match[1]) {
      const rawUrl = match[1]
      const { url, trailing } = trimUrlTrailingPunctuation(rawUrl)
      const safeHref = sanitizeLinkUrl(url)
      if (safeHref) {
        segments.push({ type: 'link', value: safeHref, href: safeHref })
        pushText(trailing)
      } else {
        pushText(rawUrl)
      }
      cursor = matchStart + rawUrl.length
    } else if (match[2] && match[3]) {
      const fullTagMatch = match[2]
      const hashIndex = fullTagMatch.indexOf('#')
      const prefix = hashIndex > 0 ? fullTagMatch.slice(0, hashIndex) : ''
      const tagValue = fullTagMatch.slice(hashIndex)
      pushText(prefix)
      segments.push({ type: 'tag', value: tagValue })
      cursor = matchStart + fullTagMatch.length
    }
  }

  if (cursor < text.length) {
    pushText(text.slice(cursor))
  }

  return segments
}
