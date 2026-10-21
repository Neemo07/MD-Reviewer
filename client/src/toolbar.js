/**
 * The formatting toolbar above the editor.
 *
 * The buttons are generated from FORMAT_ACTIONS so that the toolbar and the
 * keyboard shortcuts can never drift apart.
 */
import { FORMAT_ACTIONS } from './formatting.js';

export function createToolbar(container, { onAction }) {
  container.replaceChildren();

  for (const entry of FORMAT_ACTIONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `fmt-btn ${entry.className ?? ''}`.trim();
    button.textContent = entry.label;
    button.title = `${entry.title} (${entry.shortcut})`;
    button.setAttribute('aria-label', entry.title);
    button.dataset.action = entry.action;
    button.addEventListener('mousedown', (event) => {
      // Keep the editor selection when the button is pressed.
      event.preventDefault();
      onAction?.(entry.action);
    });
    container.appendChild(button);
  }

  return {
    element: container,
  };
}
