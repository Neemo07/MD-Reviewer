/**
 * Export of the open document.
 *
 * "Export as HTML" writes a standalone file: the rendered preview, the
 * stylesheets of the app and every referenced asset (images, the KaTeX
 * fonts) are inlined, so the file can be opened without the app, without the
 * server and without a network connection.
 *
 * "Print / save as PDF" uses the print dialog of the browser; the print
 * stylesheet of the app hides the user interface and prints the preview
 * only.
 */
import { escapeHtml } from './html.js';

/** Layout of the exported file; it wins over the styles of the app. */
const EXPORT_CSS = `
body { overflow: auto !important; height: auto !important; margin: 0; }
.export-page { max-width: 900px; margin: 0 auto; padding: 40px 24px 64px; }
.export-page .preview { max-width: none; padding: 0; }
@media print {
  body { overflow: visible !important; }
  .export-page { max-width: none; padding: 0; }
}
`;

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * All stylesheets of the app as one CSS string.
 *
 * Every rule keeps the address of the stylesheet it came from: the url(...)
 * references inside a stylesheet are relative to that stylesheet, not to the
 * document.
 */
function collectCss() {
  const parts = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const base = sheet.href || document.baseURI;
      for (const rule of Array.from(sheet.cssRules)) {
        parts.push({ css: rule.cssText, base });
      }
    } catch {
      // Stylesheets from another origin cannot be read; they are skipped.
    }
  }
  return parts;
}

/**
 * Keep only the first format of every @font-face rule.
 *
 * The KaTeX stylesheet offers every font as woff2, woff and truetype; only
 * the first one is needed for the export, and dropping the others saves
 * hundreds of kilobytes in the exported file.
 */
function keepFirstFontFormat(parts) {
  return parts.map(({ css, base }) => ({
    base,
    css: css.replace(/src:\s*([^;}]+)/g, (full, value) => {
      const url = value.match(/url\(\s*(['"]?)([^'")]+)\1\s*\)/);
      if (!url) return full;
      const format = value.match(/format\(\s*(['"]?)([^'")]+)\1\s*\)/);
      return `src: url(${url[2]})${format ? ` format("${format[2]}")` : ''}`;
    }),
  }));
}

/**
 * Replace every url(...) reference with a data URI, so that the exported
 * file does not depend on the server.
 */
async function inlineUrls(parts) {
  const references = new Map();

  const resolve = (url, base) => {
    try {
      return new URL(url, base).toString();
    } catch {
      return null;
    }
  };

  for (const { css, base } of parts) {
    for (const match of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
      const url = match[2];
      if (!url || url.startsWith('data:')) continue;
      const resolved = resolve(url, base);
      if (!resolved || references.has(resolved)) continue;
      references.set(resolved, null);
    }
  }

  await Promise.all([...references.keys()].map(async (url) => {
    try {
      const response = await fetch(url);
      if (!response.ok) return;
      const blob = await response.blob();
      references.set(url, await readAsDataUrl(blob));
    } catch {
      // The asset stays as it is when it cannot be read.
    }
  }));

  return parts.map(({ css, base }) => css.replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/g,
    (full, quote, url) => {
      if (!url || url.startsWith('data:') || url.startsWith('#')) return full;
      const resolved = resolve(url, base);
      return (resolved && references.get(resolved)) || full;
    },
  )).join('\n');
}

/** Replace the images of the preview with data URIs. */
async function inlineImages(root) {
  const images = [...root.querySelectorAll('img')];
  await Promise.all(images.map(async (image) => {
    const src = image.getAttribute('src');
    if (!src || src.startsWith('data:')) return;
    try {
      const response = await fetch(src);
      if (!response.ok) return;
      const blob = await response.blob();
      image.setAttribute('src', await readAsDataUrl(blob));
    } catch {
      // The image keeps its original source.
    }
  }));
}

/**
 * Build a standalone HTML document from the current preview.
 *
 * @param {{title: string, preview: HTMLElement, theme?: string}} options
 * @returns {Promise<string>}
 */
export async function buildStandaloneHtml({ title, preview, theme = 'light' }) {
  const clone = preview.cloneNode(true);
  await inlineImages(clone);
  const css = await inlineUrls(keepFirstFontFormat(collectCss()));

  return `<!doctype html>
<html lang="en" data-theme="${escapeHtml(theme)}" data-resolved-theme="${escapeHtml(theme)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="MD Reader">
<title>${escapeHtml(title)}</title>
<style>
${css}
${EXPORT_CSS}
</style>
</head>
<body>
<main class="export-page">
${clone.outerHTML}
</main>
</body>
</html>
`;
}

/** Save a string as a file. */
export function downloadText(text, filename, type = 'text/html;charset=utf-8') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Open the print dialog of the browser (print to PDF). */
export function printDocument() {
  window.print();
}
