/**
 * Mermaid diagram rendering.
 *
 * Mermaid is a large library, so it is only downloaded when a document
 * actually contains a diagram. Every diagram is rendered with the security
 * level "strict": mermaid sanitises the generated SVG itself, so a diagram
 * can never inject scripts or links into the preview.
 *
 * The rendered SVG is cached per source code and theme, so re-rendering the
 * preview while typing does not re-run mermaid over and over again.
 */
import { escapeHtml } from './html.js';

const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

let mermaidPromise = null;
let renderCounter = 0;
const svgCache = new Map();

/** Load mermaid once and keep it for the rest of the session. */
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((module) => {
      const instance = module.default;
      instance.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'default',
        fontFamily: FONT_FAMILY,
        flowchart: { htmlLabels: false },
      });
      return instance;
    }).catch((err) => {
      mermaidPromise = null;
      throw err;
    });
  }
  return mermaidPromise;
}

/** A readable message for a failed render. */
function errorMessage(err) {
  const message = err?.message ? String(err.message) : String(err ?? 'Unknown error');
  return message
    .replace(/^Error:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Render every mermaid block inside the given element.
 *
 * The blocks are the `<pre data-mermaid>` elements that the markdown
 * renderer produced; they are replaced by the rendered diagram (or by an
 * error box when the diagram cannot be parsed).
 *
 * @param {HTMLElement} root
 * @param {{dark?: boolean}} [options]
 */
export async function renderMermaidBlocks(root, { dark = false } = {}) {
  const blocks = [...root.querySelectorAll('[data-mermaid]')];
  if (!blocks.length) return;

  const mermaid = await loadMermaid();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: dark ? 'dark' : 'default',
    fontFamily: FONT_FAMILY,
    flowchart: { htmlLabels: false },
  });

  for (const block of blocks) {
    const code = block.textContent ?? '';
    const key = `${dark ? 'dark' : 'light'}\u0000${code}`;
    let svg = svgCache.get(key);

    if (svg === undefined) {
      renderCounter += 1;
      const id = `md-reader-mermaid-${renderCounter}`;
      try {
        const result = await mermaid.render(id, code);
        svg = result.svg;
      } catch (err) {
        svg = `<div class="mermaid-error"><strong>The diagram could not be rendered.</strong>\n${escapeHtml(errorMessage(err))}</div>`;
      }
      svgCache.set(key, svg);
    }

    block.outerHTML = `<div class="mermaid">${svg}</div>`;
  }
}

/** True when the rendered preview contains at least one diagram. */
export function hasMermaid(root) {
  return Boolean(root?.querySelector('[data-mermaid]'));
}
