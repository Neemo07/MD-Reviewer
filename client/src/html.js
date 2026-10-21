/**
 * Small HTML helpers that are shared by the renderer, the plugins and the
 * exporter.
 */
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape a value so that it can be used inside HTML text or attributes. */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}
