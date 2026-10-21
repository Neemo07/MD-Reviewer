/**
 * Preview rendering: markdown -> sanitised HTML.
 *
 * Two independent layers keep the preview safe:
 *   1. markdown-it runs with html:false, so raw HTML in the source is
 *      escaped instead of being emitted.
 *   2. DOMPurify sanitises the resulting HTML.
 */
import DOMPurify from 'dompurify';
import { createMarkdown } from './markdown.js';

let md = null;

const PURIFY_CONFIG = {
  USE_PROFILES: { html: true, svg: true, mathMl: true },
  ADD_TAGS: ['svg', 'g', 'path', 'rect', 'circle', 'line', 'polyline', 'polygon', 'text', 'marker',
    'defs', 'use', 'symbol', 'foreignObject', 'math', 'semantics', 'mrow', 'mi', 'mo', 'mn',
    'msup', 'msub', 'mfrac', 'msqrt', 'annotation'],
  ADD_ATTR: ['data-line', 'data-md-path', 'target', 'rel', 'viewBox', 'xmlns:xlink', 'preserveAspectRatio'],
  ALLOW_DATA_ATTR: true,
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'button',
    'link', 'meta', 'base', 'video', 'audio', 'source'],
  FORBID_ATTR: ['srcset'],
};

/**
 * Only task list checkboxes may survive as form controls: every other input
 * is removed, and the checkbox loses everything but its type and state.
 */
let hooksInstalled = false;

function installSanitizerHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName !== 'INPUT') return;
    const type = (node.getAttribute('type') || '').toLowerCase();
    if (type !== 'checkbox') {
      node.remove();
      return;
    }
    for (const attr of [...node.attributes]) {
      if (!['type', 'checked', 'disabled', 'class'].includes(attr.name.toLowerCase())) {
        node.removeAttribute(attr.name);
      }
    }
  });
}

export function initPreview({ getBaseDir }) {
  md = createMarkdown({ getBaseDir });
  installSanitizerHooks();
}

/**
 * @param {string} text markdown source
 * @returns {string} sanitised HTML
 */
export function renderMarkdown(text) {
  if (!md) throw new Error('Preview is not initialised.');
  const raw = md.render(text ?? '');
  return DOMPurify.sanitize(raw, PURIFY_CONFIG);
}
