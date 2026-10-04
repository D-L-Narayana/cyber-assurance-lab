// Line-oriented Markdown helpers: fenced-code awareness, inline code spans, links, headings, sections.

/** Split markdown into [{ n, text, inFence }] (n is 1-based). Fence content lines carry inFence: true. */
export function parseMarkdown(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      out.push({ n: i + 1, text: line, inFence: true });
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
    } else if (m) {
      fence = m[1];
      out.push({ n: i + 1, text: line, inFence: true });
    } else {
      out.push({ n: i + 1, text: line, inFence: false });
    }
  }
  return out;
}

/** Inline code spans outside fenced blocks: [{ n, code }]. */
export function inlineCodeSpans(lines) {
  const out = [];
  for (const l of lines) {
    if (l.inFence) continue;
    const re = /`([^`\n]+)`/g;
    let m;
    while ((m = re.exec(l.text))) out.push({ n: l.n, code: m[1] });
  }
  return out;
}

/** Markdown links and images outside fenced blocks: [{ n, label, target, image }]. Also `<img src>` in raw HTML. */
export function markdownLinks(lines) {
  const out = [];
  for (const l of lines) {
    if (l.inFence) continue;
    const re = /(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    let m;
    while ((m = re.exec(l.text))) out.push({ n: l.n, label: m[2], target: m[3], image: m[1] === '!' });
    const img = /<img\b[^>]*\bsrc=["']([^"']+)["']/g;
    while ((m = img.exec(l.text))) out.push({ n: l.n, label: '<img>', target: m[1], image: true });
  }
  return out;
}

/** ATX headings outside fences: [{ n, level, title }]. */
export function headings(lines) {
  const out = [];
  for (const l of lines) {
    if (l.inFence) continue;
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l.text);
    if (m) out.push({ n: l.n, level: m[1].length, title: m[2] });
  }
  return out;
}

/**
 * Lines of the section introduced by the first heading matching `predicate(title, level)`, up to (excluding) the next
 * heading of the same or higher level. Returns null when no heading matches.
 */
export function section(lines, predicate) {
  const hs = headings(lines);
  const idx = hs.findIndex((h) => predicate(h.title, h.level));
  if (idx === -1) return null;
  const start = hs[idx];
  let end = lines.length + 1;
  for (let j = idx + 1; j < hs.length; j++) {
    if (hs[j].level <= start.level) {
      end = hs[j].n;
      break;
    }
  }
  return { heading: start, lines: lines.filter((l) => l.n > start.n && l.n < end) };
}

/** Plain text of lines (joined with newlines). */
export function textOf(lines) {
  return lines.map((l) => l.text).join('\n');
}

/** Does a target look like an external URL / mail / anchor (i.e. not a repository path)? */
export function isExternalTarget(target) {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('//');
}
