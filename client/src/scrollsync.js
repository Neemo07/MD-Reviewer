/**
 * Synchronised scrolling between the editor and the preview.
 *
 * Both panes carry the source line of every block (markdown-it records it
 * while rendering), so the two views can be mapped onto each other by line
 * number instead of by pixel ratio.
 *
 * A short lock after every programmatic scroll keeps the two sides from
 * pushing each other back and forth.
 */
const LOCK_MS = 150;

export function createScrollSync({
  editor,
  getPreviewScroller,
  getEditorScroller,
  isEnabled,
  onPreviewScrolled,
}) {
  let lockedUntil = 0;
  // The blocks of the preview are collected once per render instead of once
  // per scroll event; a large document has thousands of them.
  let previewBlocks = [];
  let frame = null;

  function lock() {
    lockedUntil = Date.now() + LOCK_MS;
  }

  function isLocked() {
    return Date.now() < lockedUntil;
  }

  /** The line that is currently at the top of the editor. */
  function editorTopLine() {
    const scroller = getEditorScroller();
    const view = editor?.view;
    if (!scroller || !view) return null;
    // The viewport of CodeMirror includes a generous margin, so the visible
    // line is looked up in the DOM instead of in view.viewport.
    const scrollerRect = scroller.getBoundingClientRect();
    for (const element of scroller.querySelectorAll('.cm-line')) {
      const rect = element.getBoundingClientRect();
      if (rect.bottom <= scrollerRect.top) continue;
      try {
        const pos = view.posAtDOM(element, 0);
        return view.state.doc.lineAt(pos).number;
      } catch {
        break;
      }
    }
    return null;
  }

  /** The outermost preview block that belongs to the given line. */
  function previewElementForLine(line) {
    let best = null;
    let bestLine = -1;
    for (const element of previewBlocks) {
      const value = Number(element.dataset.line);
      if (!value || value > line) continue;
      if (value > bestLine) {
        best = element;
        bestLine = value;
      }
    }
    return best;
  }

  /** The line that is currently at the top of the preview. */
  function previewTopLine() {
    const scroller = getPreviewScroller();
    if (!scroller) return null;
    const scrollerRect = scroller.getBoundingClientRect();
    // The blocks are in document order, so the first one that reaches into
    // the visible area is the block at the top of the pane.
    for (const element of previewBlocks) {
      const value = Number(element.dataset.line);
      if (!value) continue;
      const rect = element.getBoundingClientRect();
      if (rect.bottom <= scrollerRect.top) continue;
      return { line: value, element };
    }
    return null;
  }

  function syncPreviewToEditor() {
    if (!isEnabled() || isLocked()) return;
    const top = previewTopLine();
    if (!top) return;
    lock();
    editor.scrollToLine(top.line);
    onPreviewScrolled?.(top.line, top.element);
  }

  function syncEditorToPreview() {
    if (!isEnabled() || isLocked()) return;
    const line = editorTopLine();
    if (!line) return;
    const element = previewElementForLine(line);
    if (!element) return;
    const scroller = getPreviewScroller();
    if (!scroller) return;
    const elementRect = element.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    lock();
    scroller.scrollTop += elementRect.top - scrollerRect.top - 8;
  }

  function handleEditorScroll() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      syncEditorToPreview();
    });
  }

  function handlePreviewScroll() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      syncPreviewToEditor();
    });
  }

  return {
    start() {
      getEditorScroller()?.addEventListener('scroll', handleEditorScroll, { passive: true });
      getPreviewScroller()?.addEventListener('scroll', handlePreviewScroll, { passive: true });
    },

    stop() {
      getEditorScroller()?.removeEventListener('scroll', handleEditorScroll);
      getPreviewScroller()?.removeEventListener('scroll', handlePreviewScroll);
    },

    /** Called after the preview was re-rendered: the list of blocks with a
     *  source line is collected once, so that scrolling stays cheap. */
    refresh() {
      const scroller = getPreviewScroller();
      previewBlocks = scroller ? [...scroller.querySelectorAll('[data-line]')] : [];
    },

    /** Jump both panes to a source line. */
    goToLine(line) {
      const scroller = getPreviewScroller();
      const element = previewElementForLine(line);
      if (scroller && element) {
        const elementRect = element.getBoundingClientRect();
        const scrollerRect = scroller.getBoundingClientRect();
        lock();
        scroller.scrollTop += elementRect.top - scrollerRect.top - 8;
      }
      editor.revealLine(line);
    },

    /** Called after the preview was re-rendered: the scroll position of the
     *  preview was restored by the caller, this keeps the two panes from
     *  fighting each other while the browser settles. */
    hold() {
      lock();
    },
  };
}
