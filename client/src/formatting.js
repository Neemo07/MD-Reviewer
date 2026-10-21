/**
 * Markdown formatting actions.
 *
 * Every action works on the current selection: it wraps it, prefixes the
 * touched lines or inserts a template. The functions only use the small
 * editor interface exposed by editor.js, so they stay independent of
 * CodeMirror internals.
 */

const HEADING_RE = /^(#{1,6})\s+/;

/** Toolbar entries: the action, the label and the keyboard shortcut. */
export const FORMAT_ACTIONS = [
  { action: 'bold', label: 'B', title: 'Bold', shortcut: 'Ctrl+B', className: 'fmt-bold' },
  { action: 'italic', label: 'I', title: 'Italic', shortcut: 'Ctrl+I', className: 'fmt-italic' },
  { action: 'heading', label: 'H', title: 'Heading', shortcut: 'Ctrl+Alt+H', className: 'fmt-heading' },
  { action: 'link', label: '🔗', title: 'Link', shortcut: 'Ctrl+K', className: 'fmt-link' },
  { action: 'code', label: '‹›', title: 'Inline code', shortcut: 'Ctrl+E', className: 'fmt-code' },
  { action: 'codeBlock', label: '{ }', title: 'Code block', shortcut: 'Ctrl+Shift+E', className: 'fmt-codeblock' },
  { action: 'bulletList', label: '•', title: 'Bullet list', shortcut: 'Ctrl+Shift+L', className: 'fmt-list' },
  { action: 'orderedList', label: '1.', title: 'Numbered list', shortcut: 'Ctrl+Shift+N', className: 'fmt-list' },
  { action: 'quote', label: '❝', title: 'Quote', shortcut: 'Ctrl+Alt+Q', className: 'fmt-quote' },
  { action: 'table', label: '▦', title: 'Table', shortcut: 'Ctrl+Alt+T', className: 'fmt-table' },
];

/** Keyboard shortcuts for the toolbar actions (CodeMirror key names). */
export const FORMAT_KEYS = {
  bold: 'Mod-b',
  italic: 'Mod-i',
  heading: 'Mod-Alt-h',
  link: 'Mod-k',
  code: 'Mod-e',
  codeBlock: 'Mod-Shift-e',
  bulletList: 'Mod-Shift-l',
  orderedList: 'Mod-Shift-n',
  quote: 'Mod-Alt-q',
  table: 'Mod-Alt-t',
};

function selectionLines(editor) {
  const sel = editor.getSelection();
  const first = editor.getLineInfo(editor.lineNumberAt(sel.from));
  const last = editor.getLineInfo(editor.lineNumberAt(sel.to));
  const lines = [];
  for (let number = first.number; number <= last.number; number += 1) {
    lines.push(editor.getLineInfo(number));
  }
  return { sel, first, last, lines };
}

/**
 * Wrap the selection in `before`/`after`. When the selection already sits
 * inside such a wrapper the wrapper is removed again.
 */
function wrap(editor, before, after, placeholder) {
  const sel = editor.getSelection();
  const text = sel.text || placeholder;

  if (sel.text) {
    const beforeText = editor.getRange(Math.max(0, sel.from - before.length), sel.from);
    const afterText = editor.getRange(sel.to, sel.to + after.length);
    if (beforeText === before && afterText === after) {
      const from = sel.from - before.length;
      editor.replaceRange(from, sel.to + after.length, sel.text, {
        anchor: from,
        head: from + sel.text.length,
      });
      return;
    }
  }

  editor.replaceRange(sel.from, sel.to, before + text + after, {
    anchor: sel.from + before.length,
    head: sel.from + before.length + text.length,
  });
}

/**
 * Add a prefix to every touched line, or remove it when all of the lines
 * already carry it.
 */
function togglePrefix(editor, prefix) {
  const { sel, first, last, lines } = selectionLines(editor);
  const remove = lines.every((line) => line.text.startsWith(prefix));
  const texts = lines.map((line) => (remove ? line.text.slice(prefix.length) : prefix + line.text));
  const insert = texts.join('\n');

  let selection;
  if (sel.empty) {
    const delta = remove ? -prefix.length : prefix.length;
    const anchor = Math.max(0, sel.from + delta);
    selection = { anchor };
  } else {
    selection = { anchor: first.from, head: first.from + insert.length };
  }
  editor.replaceRange(first.from, last.to, insert, selection);
}

function applyHeading(editor) {
  const { sel, first, last, lines } = selectionLines(editor);
  const match = HEADING_RE.exec(lines[0].text);
  // Not a heading yet -> h2, h2..h6 -> next level, h6 -> plain text.
  const level = match ? (match[1].length >= 6 ? 0 : match[1].length + 1) : 2;
  const prefix = level ? `${'#'.repeat(level)} ` : '';
  const texts = lines.map((line) => {
    const m = HEADING_RE.exec(line.text);
    return prefix + (m ? line.text.slice(m[0].length) : line.text);
  });
  const insert = texts.join('\n');
  const selection = sel.empty
    ? { anchor: first.from + insert.length }
    : { anchor: first.from, head: first.from + insert.length };
  editor.replaceRange(first.from, last.to, insert, selection);
}

function applyLink(editor) {
  const sel = editor.getSelection();
  const text = sel.text || 'link text';
  const isUrl = /^(https?:|mailto:)/i.test(text.trim());
  const insert = isUrl ? `[link text](${text.trim()})` : `[${text}](url)`;
  const urlStart = insert.indexOf('(') + 1;
  editor.replaceRange(sel.from, sel.to, insert, {
    anchor: sel.from + urlStart,
    head: sel.from + urlStart + 3,
  });
}

function applyCodeBlock(editor) {
  const sel = editor.getSelection();
  const code = sel.text || 'code';
  const insert = `\`\`\`\n${code}\n\`\`\``;
  editor.replaceRange(sel.from, sel.to, insert, {
    anchor: sel.from + 4,
    head: sel.from + 4 + code.length,
  });
}

function applyTable(editor) {
  const sel = editor.getSelection();
  const table = [
    '| Column 1 | Column 2 |',
    '| -------- | -------- |',
    '| Cell     | Cell     |',
    '',
  ].join('\n');
  const line = editor.getLineInfo(editor.lineNumberAt(sel.from));
  const needsNewline = line.text.length > 0 && sel.from > line.from;
  const insert = (needsNewline ? '\n' : '') + table;
  editor.replaceRange(sel.from, sel.to, insert, { anchor: sel.from + insert.length });
}

/**
 * Run a formatting action.
 * @param {object} editor editor instance (see editor.js)
 * @param {string} action one of the FORMAT_ACTIONS
 */
export function applyFormat(editor, action) {
  switch (action) {
    case 'bold':
      wrap(editor, '**', '**', 'bold text');
      break;
    case 'italic':
      wrap(editor, '*', '*', 'italic text');
      break;
    case 'code':
      wrap(editor, '`', '`', 'code');
      break;
    case 'heading':
      applyHeading(editor);
      break;
    case 'link':
      applyLink(editor);
      break;
    case 'codeBlock':
      applyCodeBlock(editor);
      break;
    case 'bulletList':
      togglePrefix(editor, '- ');
      break;
    case 'orderedList':
      togglePrefix(editor, '1. ');
      break;
    case 'quote':
      togglePrefix(editor, '> ');
      break;
    case 'table':
      applyTable(editor);
      break;
    default:
      break;
  }
}
