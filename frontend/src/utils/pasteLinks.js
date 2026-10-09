/**
 * pasteLinks
 * Preserves hyperlinks when pasting rich (HTML) content copied from external
 * sources — e.g. selecting text on a Reddit page and pasting it into a plain
 * <textarea>. Browsers normally flatten such a paste to plain text, dropping
 * every <a href> link. Here we read the "text/html" clipboard flavor (when
 * present), convert any <a href="..."> into inline `[text](url)` markdown,
 * and insert that into the textarea in place of the browser's default paste.
 *
 * `[text](url)` is a NEW token, separate from this app's existing
 * `@[Name](id)` object-mention syntax (that one always starts with `@`), so
 * the two never collide. Renderers (renderRichContent.jsx and
 * ObjectDetailPage's renderRichNotes) turn `[text](url)` into a real
 * clickable link, same as it already does for bare https:// URLs.
 */

// True only if the HTML actually contains a hyperlink — if it doesn't,
// there's nothing to preserve, so the caller should fall back to the
// browser's normal plain-text paste instead of intercepting it.
export function htmlHasLink(html) {
  return !!html && /<a\s[^>]*href\s*=/i.test(html)
}

export function htmlToLinkMarkdown(html) {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    doc.querySelectorAll('script, style').forEach(n => n.remove())

    const BLOCK_TAGS = new Set(['p', 'div', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote'])

    function walk(node) {
      let out = ''
      node.childNodes.forEach(child => {
        if (child.nodeType === Node.TEXT_NODE) {
          out += child.textContent
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const tag = child.tagName.toLowerCase()
          if (tag === 'a' && child.getAttribute('href')) {
            const href = (child.getAttribute('href') || '').trim()
            const text = child.textContent.replace(/\s+/g, ' ').trim()
            if (/^https?:\/\//i.test(href) && text) {
              out += `[${text}](${href})`
            } else if (/^https?:\/\//i.test(href)) {
              out += href
            } else {
              out += text
            }
          } else if (tag === 'br') {
            out += '\n'
          } else if (BLOCK_TAGS.has(tag)) {
            out += walk(child) + '\n'
          } else {
            out += walk(child)
          }
        }
      })
      return out
    }

    const text = walk(doc.body)
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    return text || null
  } catch {
    return null
  }
}

// Programmatically sets a <textarea>'s value and fires a real 'input' event
// so React's onChange (and this app's own segsRef/reconcile logic wired to
// it) runs exactly as if the user had typed the text themselves.
function setTextareaValue(ta, value, selectionStart) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(ta, value)
  ta.setSelectionRange(selectionStart, selectionStart)
  ta.dispatchEvent(new Event('input', { bubbles: true }))
}

/**
 * Attach to a textarea's onPaste. Returns true if it handled the paste
 * (caller should NOT also run its own paste logic), false if the event was
 * left alone (no HTML / no links — normal plain-text paste applies).
 */
export function handleLinkPaste(e) {
  const html = e.clipboardData?.getData('text/html')
  if (!htmlHasLink(html)) return false

  const converted = htmlToLinkMarkdown(html)
  if (!converted) return false

  e.preventDefault()
  const ta = e.target
  const start = ta.selectionStart
  const end = ta.selectionEnd
  const newVal = ta.value.slice(0, start) + converted + ta.value.slice(end)
  setTextareaValue(ta, newVal, start + converted.length)
  return true
}
