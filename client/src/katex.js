/**
 * KaTeX support for markdown-it.
 *
 *   inline math:   $E = mc^2$
 *   block math:    $$
 *                   \int_0^1 x^2 \, dx
 *                   $$
 *
 * The rules are written by hand instead of using markdown-it-katex so that
 * they follow the "no raw HTML" policy of the app (the formula is rendered
 * by KaTeX itself, never by the browser) and so that a broken formula
 * degrades into a readable error instead of breaking the whole preview.
 */
import katex from 'katex';
import { escapeHtml } from './html.js';

/** Render a formula, or a readable error message when KaTeX refuses it. */
function renderMath(content, displayMode) {
  try {
    return katex.renderToString(content, {
      displayMode,
      throwOnError: true,
      output: 'htmlAndMathml',
      strict: 'ignore',
      trust: false,
      maxExpand: 1000,
    });
  } catch (err) {
    const message = err?.message ? String(err.message) : 'The formula could not be rendered.';
    const tag = displayMode ? 'div' : 'span';
    return `<${tag} class="math-error" title="${escapeHtml(message)}">${escapeHtml(content)}</${tag}>`;
  }
}

/**
 * Inline rule for `$...$`.
 *
 * The rule is deliberately conservative: the opening `$` may not be followed
 * by a space, the closing `$` may not be preceded by one, and inline math
 * never spans a line break. That keeps prices like "5 $ and 7 $" readable.
 */
function mathInline(state, silent) {
  const src = state.src;
  const start = state.pos;
  if (src[start] !== '$') return false;
  // "$$" is handled by the block rule.
  if (src[start + 1] === '$') return false;
  if (src[start + 1] === ' ' || src[start + 1] === '\n') return false;

  let pos = start + 1;
  let found = -1;
  while (pos < state.posMax) {
    const ch = src[pos];
    if (ch === '\n') return false;
    if (ch === '\\') {
      pos += 2;
      continue;
    }
    if (ch === '$') {
      if (pos === start + 1) return false;
      if (src[pos - 1] === ' ') return false;
      found = pos;
      break;
    }
    pos += 1;
  }
  if (found < 0) return false;

  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.markup = '$';
    token.content = src.slice(start + 1, found);
  }
  state.pos = found + 1;
  return true;
}

/** Block rule for `$$ ... $$`. */
function mathBlock(state, start, end, silent) {
  const firstLine = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]).trim();
  if (!firstLine.startsWith('$$')) return false;

  let content = '';
  let nextLine = start;
  let found = false;

  if (firstLine.length > 4 && firstLine.endsWith('$$')) {
    // Everything on one line: $$x^2$$
    content = firstLine.slice(2, -2);
    found = true;
    nextLine = start + 1;
  } else {
    const lines = [];
    for (let line = start + 1; line < end; line += 1) {
      const text = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]).trim();
      if (text.endsWith('$$')) {
        lines.push(text.slice(0, -2));
        found = true;
        nextLine = line + 1;
        break;
      }
      lines.push(text);
    }
    if (found) content = lines.join('\n');
  }
  if (!found) return false;

  if (!silent) {
    const token = state.push('math_block', 'math', 0);
    token.block = true;
    token.markup = '$$';
    token.content = content;
    token.map = [start, nextLine];
  }
  state.line = nextLine;
  return true;
}

/**
 * @param {import('markdown-it').MarkdownIt} md
 */
export function katexPlugin(md) {
  md.inline.ruler.after('escape', 'math_inline', mathInline);
  md.block.ruler.after('blockquote', 'math_block', mathBlock, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
  md.renderer.rules.math_inline = (tokens, idx) => renderMath(tokens[idx].content, false);
  md.renderer.rules.math_block = (tokens, idx) => renderMath(tokens[idx].content, true);
}
