/**
 * CodeMirror 6 editor setup: markdown mode, line numbers, history,
 * search/replace, bracket matching and the application key bindings.
 */
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { foldKeymap, indentOnInput, bracketMatching } from '@codemirror/language';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { FORMAT_KEYS } from './formatting.js';

const editorTheme = EditorView.theme({
  '&': { color: 'var(--text)', backgroundColor: 'var(--bg)', height: '100%' },
  '.cm-content': { caretColor: 'var(--text)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)', borderLeftWidth: '2px' },
  '.cm-gutters': { backgroundColor: 'var(--bg-alt)', color: 'var(--text-dim)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--bg-hover)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--bg-hover)', color: 'var(--text)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'var(--bg-active)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--bg-active)' },
  '.cm-searchMatch': { backgroundColor: 'var(--bg-active)', outline: '1px solid var(--accent)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--accent)', color: 'var(--accent-contrast)' },
  '.cm-panels': { backgroundColor: 'var(--bg-alt)', color: 'var(--text)' },
  '.cm-panels input, .cm-panels button': { color: 'var(--text)', background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)', borderRadius: '4px' },
  '.cm-tooltip': { backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)' },
}, { dark: true });

/**
 * @param {object} options
 * @param {HTMLElement} options.parent
 * @param {(text: string) => void} options.onChange
 * @param {(info: {line: number, column: number, words: number, chars: number}) => void} options.onStatus
 * @param {() => void} options.onSave
 * @param {(action: string) => void} options.onFormat
 */
export function createEditor({ parent, onChange, onStatus, onSave, onFormat, extraKeymaps = [] }) {
  const themeCompartment = new Compartment();

  const statusCompartment = new Compartment();

  // Counting the words of a large document is expensive, so the numbers are
  // recomputed a moment after the last change instead of on every keystroke.
  let counts = { words: 0, chars: 0 };
  let countsTimer = null;

  function computeCounts(view) {
    const text = view.state.doc.toString();
    counts = { words: countWords(text), chars: text.length };
  }

  function reportStatus(view) {
    if (!onStatus) return;
    const selection = view.state.selection.main;
    const head = selection.head;
    const line = view.state.doc.lineAt(head);
    onStatus({
      line: line.number,
      column: head - line.from + 1,
      words: counts.words,
      chars: counts.chars,
      selected: selection.empty ? 0 : selection.to - selection.from,
    });
  }

  function scheduleCounts(view) {
    if (countsTimer) clearTimeout(countsTimer);
    countsTimer = setTimeout(() => {
      countsTimer = null;
      computeCounts(view);
      reportStatus(view);
    }, 200);
  }

  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      onChange?.(update.state.doc.toString());
      scheduleCounts(update.view);
    }
    if (update.docChanged || update.selectionSet) reportStatus(update.view);
  });

  const saveBinding = {
    key: 'Mod-s',
    preventDefault: true,
    run: () => {
      onSave?.();
      return true;
    },
  };

  // Formatting shortcuts, one per toolbar button.
  const formatBindings = Object.entries(FORMAT_KEYS).map(([action, key]) => ({
    key,
    preventDefault: true,
    run: () => {
      onFormat?.(action);
      return true;
    },
  }));

  const state = EditorState.create({
    doc: '',
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      autocompletion(),
      markdown(),
      EditorView.lineWrapping,
      themeCompartment.of(editorTheme),
      statusCompartment.of([]),
      keymap.of([saveBinding, ...formatBindings, ...extraKeymaps]),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap,
        ...foldKeymap, ...completionKeymap]),
      updateListener,
    ],
  });

  const view = new EditorView({ state, parent });

  return {
    view,

    /** Push the current word/char/cursor numbers to the status bar. */
    reportStatus() {
      reportStatus(view);
    },

    getValue() {
      return view.state.doc.toString();
    },

    /** Replace the whole document (used when opening a file). */
    setValue(text) {
      const current = view.state.doc.toString();
      if (current === text) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: 0 },
        scrollIntoView: true,
      });
      computeCounts(view);
      reportStatus(view);
    },

    /** Replace the current selection (used by the formatting toolbar). */
    replaceSelection(text, selectOffset = text.length) {
      const selection = view.state.selection.main;
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert: text },
        selection: { anchor: selection.from + selectOffset },
      });
      view.focus();
    },

    /** The current selection: offsets and text. */
    getSelection() {
      const selection = view.state.selection.main;
      return {
        from: selection.from,
        to: selection.to,
        text: view.state.sliceDoc(selection.from, selection.to),
        empty: selection.empty,
      };
    },

    /** Text between two document offsets. */
    getRange(from, to) {
      return view.state.sliceDoc(from, to);
    },

    /** Line number (1 based) that contains the given offset. */
    lineNumberAt(pos) {
      return view.state.doc.lineAt(pos).number;
    },

    /** Number, offsets and text of a line (1 based). */
    getLineInfo(number) {
      const clamped = Math.max(1, Math.min(number, view.state.doc.lines));
      const line = view.state.doc.line(clamped);
      return { number: clamped, from: line.from, to: line.to, text: line.text };
    },

    /** Replace a range and set the selection afterwards. */
    replaceRange(from, to, insert, selection) {
      view.dispatch({
        changes: { from, to, insert },
        selection,
        scrollIntoView: true,
      });
      view.focus();
    },

    /** Insert text at the cursor. */
    insert(text) {
      const selection = view.state.selection.main;
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert: text },
        selection: { anchor: selection.from + text.length },
      });
      view.focus();
    },

    focus() {
      view.focus();
    },

    /** Move the cursor to a line (1 based) and scroll it into view. */
    goToLine(lineNumber) {
      const lineNumberClamped = Math.max(1, Math.min(lineNumber, view.state.doc.lines));
      const line = view.state.doc.line(lineNumberClamped);
      view.dispatch({
        selection: { anchor: line.from },
        scrollIntoView: true,
      });
      view.focus();
    },

    /** Scroll so that the given line is visible without moving the cursor. */
    revealLine(lineNumber) {
      const lineNumberClamped = Math.max(1, Math.min(lineNumber, view.state.doc.lines));
      const line = view.state.doc.line(lineNumberClamped);
      view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
    },

    /** Scroll a line to the top of the viewport (used by the scroll sync). */
    scrollToLine(lineNumber) {
      const lineNumberClamped = Math.max(1, Math.min(lineNumber, view.state.doc.lines));
      const line = view.state.doc.line(lineNumberClamped);
      view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'start' }) });
    },

    setDark(isDark) {
      view.dispatch({ effects: themeCompartment.reconfigure(editorTheme) });
      view.dispatch({ effects: statusCompartment.reconfigure([]) });
      if (isDark) {
        view.dom.classList.add('cm-dark');
      } else {
        view.dom.classList.remove('cm-dark');
      }
    },
  };
}

/** Count words the way editors usually do. */
export function countWords(text) {
  const matches = text.match(/[\p{L}\p{N}'’-]+/gu);
  return matches ? matches.length : 0;
}
