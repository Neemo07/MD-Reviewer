/**
 * Sidebar file tree. Only markdown files are shown (the server filters the
 * rest out).
 */
export function createTree(container, { onOpen, onContext }) {
  const collapsed = new Set();
  let nodes = [];
  let activePath = null;

  function renderNode(node, depth) {
    const wrapper = document.createElement('div');

    if (node.type === 'dir') {
      const isCollapsed = collapsed.has(node.path);
      const row = document.createElement('div');
      row.className = 'tree-item';
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-expanded', String(!isCollapsed));
      row.dataset.path = node.path;
      row.dataset.type = 'dir';
      row.innerHTML = `<span class="icon">${isCollapsed ? '▸' : '▾'}</span><span class="label"></span>`;
      row.querySelector('.label').textContent = node.name;
      row.addEventListener('click', () => {
        if (collapsed.has(node.path)) collapsed.delete(node.path);
        else collapsed.add(node.path);
        render();
      });
      row.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        onContext?.(node, event);
      });
      wrapper.appendChild(row);

      const children = document.createElement('div');
      children.className = 'tree-children';
      children.setAttribute('role', 'group');
      if (!isCollapsed) {
        for (const child of node.children ?? []) children.appendChild(renderNode(child, depth + 1));
      }
      wrapper.appendChild(children);
      return wrapper;
    }

    const row = document.createElement('div');
    row.className = 'tree-item';
    row.setAttribute('role', 'treeitem');
    row.dataset.path = node.path;
    row.dataset.type = 'file';
    row.innerHTML = '<span class="icon">&#9642;</span><span class="label"></span>';
    row.querySelector('.label').textContent = node.name;
    if (node.path === activePath) row.classList.add('active');
    row.addEventListener('click', () => onOpen?.(node.path));
    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      onContext?.(node, event);
    });
    wrapper.appendChild(row);
    return wrapper;
  }

  function render() {
    container.replaceChildren();
    if (!nodes.length) {
      const empty = document.createElement('div');
      empty.className = 'tree-empty';
      empty.textContent = 'No markdown files found in this folder.';
      container.appendChild(empty);
      return;
    }
    for (const node of nodes) container.appendChild(renderNode(node, 0));
  }

  return {
    setData(nextNodes) {
      nodes = nextNodes ?? [];
      render();
    },
    setActive(path) {
      activePath = path;
      render();
    },
    expandTo(path) {
      if (!path) return;
      const parts = path.split('/');
      parts.pop();
      let prefix = '';
      for (const part of parts) {
        prefix = prefix ? `${prefix}/${part}` : part;
        collapsed.delete(prefix);
      }
    },
    /** Look up a node by its path (files and folders). */
    find(path) {
      const search = (list) => {
        for (const node of list) {
          if (node.path === path) return node;
          if (node.type === 'dir') {
            const hit = search(node.children ?? []);
            if (hit) return hit;
          }
        }
        return null;
      };
      return search(nodes);
    },
    render,
  };
}
