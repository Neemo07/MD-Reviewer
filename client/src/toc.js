/**
 * Outline panel (table of contents).
 *
 * The entries are taken from the rendered preview, so the outline always
 * matches what the reader sees - including the anchor ids and the source
 * lines that markdown-it recorded while rendering.
 */
export function createToc(container, { onJump }) {
  let headings = [];

  function render() {
    container.replaceChildren();
    if (!headings.length) {
      const empty = document.createElement('div');
      empty.className = 'toc-empty';
      empty.textContent = 'No headings in this document.';
      container.appendChild(empty);
      return;
    }

    const list = document.createElement('ul');
    list.className = 'toc-list';
    for (const heading of headings) {
      const item = document.createElement('li');
      item.className = `toc-item toc-level-${heading.level}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'toc-link';
      button.textContent = heading.title;
      button.title = heading.title;
      button.dataset.headingId = heading.id;
      button.addEventListener('click', () => onJump?.(heading));
      item.appendChild(button);
      list.appendChild(item);
    }
    container.appendChild(list);
  }

  return {
    /**
     * Collect the headings of the rendered preview.
     * @param {HTMLElement} preview the preview element
     */
    update(preview) {
      const next = [];
      if (preview) {
        for (const element of preview.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
          const title = (element.textContent || '').trim();
          if (!title) continue;
          next.push({
            id: element.id,
            title,
            level: Number(element.tagName.slice(1)),
            line: Number(element.dataset.line) || 1,
          });
        }
      }
      const changed = next.length !== headings.length
        || next.some((heading, index) => heading.id !== headings[index]?.id);
      headings = next;
      if (changed) render();
    },

    /** Highlight the heading that is currently on top of the preview. */
    setActive(id) {
      for (const link of container.querySelectorAll('.toc-link')) {
        link.classList.toggle('active', link.dataset.headingId === id);
      }
    },

    get headings() {
      return headings;
    },
  };
}
