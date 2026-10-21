/**
 * A small context menu for the file tree.
 *
 * The menu is positioned inside the viewport, closes on Escape, on a click
 * outside of it and after an item was chosen.
 */
let openMenu = null;

function closeOpenMenu() {
  if (!openMenu) return;
  openMenu.remove();
  openMenu = null;
  document.removeEventListener('keydown', onKey, true);
  document.removeEventListener('mousedown', onOutside, true);
  window.removeEventListener('resize', closeOpenMenu);
  window.removeEventListener('blur', closeOpenMenu);
}

function onKey(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeOpenMenu();
  }
}

function onOutside(event) {
  if (openMenu && !openMenu.contains(event.target)) closeOpenMenu();
}

/**
 * @param {number} x viewport x coordinate
 * @param {number} y viewport y coordinate
 * @param {{label: string, action?: string, danger?: boolean, disabled?: boolean}[]} items
 * @param {(action: string, item: object) => void} onSelect
 */
export function showContextMenu(x, y, items, onSelect) {
  closeOpenMenu();

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.setAttribute('role', 'menu');

  for (const item of items) {
    if (item.separator) {
      const separator = document.createElement('div');
      separator.className = 'context-menu-separator';
      menu.appendChild(separator);
      continue;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `context-menu-item${item.danger ? ' danger' : ''}`;
    button.textContent = item.label;
    button.disabled = Boolean(item.disabled);
    button.addEventListener('click', () => {
      closeOpenMenu();
      onSelect?.(item.action, item);
    });
    menu.appendChild(button);
  }

  document.body.appendChild(menu);
  openMenu = menu;

  // Keep the menu inside the window.
  const rect = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;

  document.addEventListener('keydown', onKey, true);
  document.addEventListener('mousedown', onOutside, true);
  window.addEventListener('resize', closeOpenMenu);
  window.addEventListener('blur', closeOpenMenu);

  return menu;
}

export { closeOpenMenu };
