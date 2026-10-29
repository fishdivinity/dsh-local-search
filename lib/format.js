/**
 * Model-facing formatting. Results stay bounded: callers cap items and text
 * before these functions run.
 */

/** Convert a Windows FILETIME (100 ns ticks since 1601) to an ISO string. */
export function filetimeToIso(ft) {
  if (typeof ft !== 'number' || ft <= 0) return undefined
  const date = new Date(ft / 10000 - 11644473600000)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function sizeSuffix(size) {
  return typeof size === 'number' && Number.isFinite(size) ? `\t${size} B` : ''
}

function modifiedSuffix(modified) {
  return typeof modified === 'string' && modified.length > 0 ? `\t${modified}` : ''
}

/** Format the files result (Everything). */
export function formatFiles(value) {
  const items = Array.isArray(value.items) ? value.items : []
  if (items.length === 0) return 'No files found.'
  const header = value.truncated
    ? `Found ${items.length} path(s) (capped)`
    : `Found ${items.length} path(s)`
  const body = items
    .map((item) => `${item.path}${sizeSuffix(item.size)}${modifiedSuffix(item.modified)}`)
    .join('\n')
  return `${header}\n\n${body}`
}

/** Format the content result (Anytxt). */
export function formatContent(value) {
  const items = Array.isArray(value.items) ? value.items : []
  if (items.length === 0) return `No content matches (indexed total ${value.total ?? 0}).`
  const header = `${items.length} of ${value.total ?? items.length} indexed file(s) match`
  const body = items.map((item) => `${item.ref}\t${item.path}`).join('\n')
  const footer = value.truncated ? '\n\n(Showing the first results; narrow the query or raise limit to see more.)' : ''
  return `${header}\n\n${body}${footer}`
}

/** Format fragments from one indexed document. */
export function formatFragments(value) {
  const fragments = Array.isArray(value.fragments) ? value.fragments.filter(Boolean) : []
  return fragments.length > 0 ? fragments.join('\n---\n') : 'No fragments returned.'
}

/** Format a document excerpt with its total length. */
export function formatRead(value) {
  const total = typeof value.totalChars === 'number' ? value.totalChars : 0
  const offset = typeof value.offset === 'number' ? value.offset : 0
  const returned = typeof value.returned === 'number' ? value.returned : 0
  if (returned === 0) return `chars ${total}; nothing to show at offset ${offset}`
  // The end is inclusive so a reader can subtract the two numbers directly.
  return `chars ${total}; showing ${offset}..${offset + returned - 1}\n\n${value.text ?? ''}`
}

/** Format both engine statuses and the configured roots. */
export function formatStatus(value) {
  const lines = []
  const everything = value.everything ?? {}
  if (everything.ok) {
    lines.push(
      `Everything: OK${everything.version ? ` (${everything.version})` : ''}${everything.path ? ` via ${everything.path}` : ''}`,
    )
  } else if (everything.code === 'SKIPPED') {
    lines.push(`Everything: SKIPPED${everything.message ? ` — ${everything.message}` : ''}`)
  } else {
    lines.push(
      `Everything: DOWN — ${everything.code ?? 'UNKNOWN'}${everything.message ? `: ${everything.message}` : ''}`,
    )
  }
  const anytxt = value.anytxt ?? {}
  if (anytxt.ok) {
    lines.push(`Anytxt: OK${anytxt.url ? ` at ${anytxt.url}` : ''}`)
  } else if (anytxt.code === 'SKIPPED') {
    lines.push(`Anytxt: SKIPPED${anytxt.message ? ` — ${anytxt.message}` : ''}`)
  } else {
    lines.push(
      `Anytxt: DOWN — ${anytxt.code ?? 'UNKNOWN'}${anytxt.message ? `: ${anytxt.message}` : ''}`,
    )
  }
  const roots = value.roots ?? {}
  lines.push(`workspace=${roots.workspace ?? ''}`)
  lines.push(`work=${roots.work ?? ''}`)
  lines.push(`personal=${roots.personal ?? ''}`)
  lines.push(`all=${Array.isArray(roots.all) ? roots.all.join(',') : ''}`)
  if (value.engines) {
    lines.push(`engines=files:${(value.engines.files ?? []).join(',')} content:${(value.engines.content ?? []).join(',')}`)
  }
  return lines.join('\n')
}
