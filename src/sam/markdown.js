/**
 * markdown.js — an agent's Markdown answer, as elements (central-specs capability sam-chat, decision 0006).
 * Ported from smart-office's twin/src/office/ui/ai/markdown.js (itself from South Zone School's assistantText.js).
 *
 * **NEVER innerHTML.** Every element is created by name and every piece of text is set as text, so a `<script>`
 * or an `<img onerror>` in an answer shows as those characters. A subset on purpose: paragraphs, headings, lists,
 * bold, italic, inline and fenced code, and pipe tables (in a wrapper that scrolls sideways). Links and images
 * stay as their literal text.
 */

/**
 * Renders a Markdown answer into a fragment of elements.
 * @param {Document} doc the document
 * @param {string} markdown the answer
 * @returns {DocumentFragment} the elements
 */
export function renderAnswer(doc, markdown) {
  const out = doc.createDocumentFragment();
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // Fenced code: everything to the closing fence, verbatim.
    if (/^\s*```/.test(line)) {
      const body = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      const pre = doc.createElement('pre');
      const code = doc.createElement('code');
      code.textContent = body.join('\n');
      pre.appendChild(code);
      out.appendChild(pre);
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      // Headings inside an answer sit below the chat's own heading, whatever level they claim.
      const h = doc.createElement(heading[1].length <= 2 ? 'h3' : 'h4');
      appendInline(doc, h, heading[2]);
      out.appendChild(h);
      i += 1;
      continue;
    }

    if (isTableStart(lines, i)) {
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(lines[i]);
        i += 1;
      }
      out.appendChild(table(doc, rows));
      continue;
    }

    const bullet = /^\s*[-*+]\s+/;
    const numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const marker = ordered ? numbered : bullet;
      const list = doc.createElement(ordered ? 'ol' : 'ul');
      while (i < lines.length && marker.test(lines[i])) {
        const li = doc.createElement('li');
        appendInline(doc, li, lines[i].replace(marker, ''));
        list.appendChild(li);
        i += 1;
      }
      out.appendChild(list);
      continue;
    }

    // A paragraph: consecutive lines until a blank line or another block starts.
    const para = [];
    while (i < lines.length && lines[i].trim() !== '' && !startsBlock(lines, i)) {
      para.push(lines[i].trim());
      i += 1;
    }
    const p = doc.createElement('p');
    appendInline(doc, p, para.join(' '));
    out.appendChild(p);
  }

  return out;
}

/** Whether a line begins a block other than a paragraph. */
function startsBlock(lines, i) {
  const line = lines[i];
  return /^\s*```/.test(line)
    || /^#{1,4}\s+/.test(line)
    || /^\s*[-*+]\s+/.test(line)
    || /^\s*\d+[.)]\s+/.test(line)
    || isTableStart(lines, i);
}

/** Whether a pipe table starts here: a row, then a separator row. */
function isTableStart(lines, i) {
  return /^\s*\|.*\|\s*$/.test(lines[i] ?? '')
    && /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(lines[i + 1] ?? '');
}

/** Splits a pipe-table row into its cells. */
function cells(row) {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

/** A pipe table, as a table in a wrapper that scrolls sideways inside the bubble. */
function table(doc, rows) {
  const wrap = doc.createElement('div');
  wrap.className = 'sam-table';
  const t = doc.createElement('table');
  const head = doc.createElement('thead');
  const headRow = doc.createElement('tr');
  for (const c of cells(rows[0])) {
    const th = doc.createElement('th');
    th.scope = 'col';
    appendInline(doc, th, c);
    headRow.appendChild(th);
  }
  head.appendChild(headRow);
  t.appendChild(head);

  const body = doc.createElement('tbody');
  for (const row of rows.slice(2)) {
    const tr = doc.createElement('tr');
    for (const c of cells(row)) {
      const td = doc.createElement('td');
      // a figure reads right-aligned, like every other table on the dashboard
      if (/^[-+]?(S?\$)?[\d,.]+\s*(%|k|K|M|s|ms|km|bpm)?$/.test(c)) td.className = 'num';
      appendInline(doc, td, c);
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  t.appendChild(body);
  wrap.appendChild(t);
  return wrap;
}

/** Inline spans: code first, so nothing inside backticks is read as emphasis. */
const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)/;

/**
 * Appends a line of inline Markdown to an element, as text and emphasis elements.
 * @param {Document} doc the document
 * @param {HTMLElement} el where it goes
 * @param {string} text the line
 * @returns {void}
 */
export function appendInline(doc, el, text) {
  let rest = text;
  while (rest.length > 0) {
    const m = INLINE.exec(rest);
    if (!m) {
      el.appendChild(doc.createTextNode(rest));
      return;
    }
    if (m.index > 0) el.appendChild(doc.createTextNode(rest.slice(0, m.index)));
    const token = m[0];
    let node;
    if (m[1]) {
      node = doc.createElement('code');
      node.textContent = token.slice(1, -1);
    } else if (m[2] || m[3]) {
      node = doc.createElement('strong');
      node.textContent = token.slice(2, -2);
    } else {
      node = doc.createElement('em');
      node.textContent = token.slice(1, -1);
    }
    el.appendChild(node);
    rest = rest.slice(m.index + token.length);
  }
}
