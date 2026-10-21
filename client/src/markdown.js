/**
 * markdown-it configuration.
 *
 * - html:false      raw HTML in the markdown source is escaped, not executed
 * - linkify         bare URLs become links (GFM autolinks)
 * - tables / strikethrough are built into markdown-it
 * - task lists come from markdown-it-task-lists
 * - relative links and images are resolved against the open file's folder
 */
import MarkdownIt from 'markdown-it';
// The "common" bundle covers ~40 languages and is far smaller than the full
// highlight.js distribution (which is ~1.7 MB minified).
import hljs from 'highlight.js/lib/common';
import { escapeHtml } from './html.js';
import { katexPlugin } from './katex.js';

export { escapeHtml };

/** GitHub style heading anchor. */
export function slugify(text) {
  const slug = String(text)
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  return slug || 'section';
}

/**
 * Make a slug unique inside one document: "intro", "intro-1", "intro-2" ...
 * The counter is shared by every caller that renders the same document, so
 * the preview ids and the outline entries stay in sync.
 */
export function uniqueSlug(slug, counts) {
  const seen = counts.get(slug) ?? 0;
  counts.set(slug, seen + 1);
  return seen === 0 ? slug : `${slug}-${seen}`;
}

/** True for URLs that must not be rewritten (absolute, protocol relative, data:). */
export function isExternalUrl(url) {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//');
}

/** Folder part of a relative path ('' for files in the root). */
export function dirOf(relPath) {
  const index = relPath.lastIndexOf('/');
  return index === -1 ? '' : relPath.slice(0, index);
}

/** Resolve a relative path against the folder of the open document. */
export function resolveRelative(baseDir, relative) {
  const withoutQuery = relative.split('#')[0].split('?')[0];
  const joined = baseDir ? `${baseDir}/${withoutQuery}` : withoutQuery;
  const parts = [];
  for (const part of joined.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

/** URL of the raw asset endpoint for a file inside the root folder. */
export function rawUrl(relPath) {
  return new URL(`api/raw?path=${encodeURIComponent(relPath)}`, document.baseURI).toString();
}

/**
 * Rewrite relative links and images so that they resolve against the folder
 * of the document that is currently open.
 */
function relativePathsPlugin(md, { getBaseDir }) {
  const defaultLinkOpen = md.renderer.rules.link_open
    || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const href = token.attrGet('href');
    if (href && !href.startsWith('#') && !isExternalUrl(href)) {
      const resolved = resolveRelative(getBaseDir(), href);
      if (/\.md$/i.test(resolved)) {
        // Markdown links stay inside the app and open in the editor.
        token.attrSet('href', `#md:${resolved}`);
        token.attrSet('data-md-path', resolved);
      } else {
        token.attrSet('href', rawUrl(resolved));
        token.attrSet('target', '_blank');
        token.attrSet('rel', 'noopener noreferrer');
      }
    }
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  const defaultImage = md.renderer.rules.image
    || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const src = token.attrGet('src');
    if (src && !isExternalUrl(src) && !src.startsWith('#')) {
      token.attrSet('src', rawUrl(resolveRelative(getBaseDir(), src)));
    }
    return defaultImage(tokens, idx, options, env, self);
  };
}

/** Give every heading a stable id and every block a source line number. */
function anchorsPlugin(md) {
  md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const inline = tokens[idx + 1];
    const text = inline && inline.type === 'inline' ? inline.content : '';
    // One counter per render, so duplicate headings get unique ids.
    const counts = env.headingCounts ?? (env.headingCounts = new Map());
    token.attrSet('id', uniqueSlug(slugify(text), counts));
    return self.renderToken(tokens, idx, options);
  };

  const defaultRenderToken = md.renderer.renderToken.bind(md.renderer);
  md.renderer.renderToken = (tokens, idx, options) => {
    const token = tokens[idx];
    // nesting: 1 = opening tag, 0 = void/self closing, -1 = closing tag.
    // Only opening and void tokens carry the line number.
    if (token.map && token.nesting !== -1 && !token.attrGet('data-line')) {
      token.attrSet('data-line', String(token.map[0] + 1));
    }
    return defaultRenderToken(tokens, idx, options);
  };
}

/**
 * GFM task lists: "- [ ] item" and "- [x] item".
 *
 * Implemented directly instead of pulling in a plugin because the plugin
 * injects raw HTML into the inline stream, which markdown-it escapes when
 * html:false is on.
 */
function taskListsPlugin(md) {
  md.core.ruler.after('inline', 'task_lists', (state) => {
    const tokens = state.tokens;
    for (let i = 1; i < tokens.length; i += 1) {
      if (tokens[i].type !== 'inline') continue;

      // The inline token sits inside a paragraph, which sits inside the list
      // item: list_item_open > paragraph_open > inline.
      let j = i - 1;
      while (j >= 0 && (tokens[j].type === 'paragraph_open' || tokens[j].type === 'paragraph_close')) {
        j -= 1;
      }
      const open = j >= 0 ? tokens[j] : null;
      if (!open || open.type !== 'list_item_open') continue;

      const inline = tokens[i];
      const match = /^\[([ xX])\][ \t]+/.exec(inline.content);
      if (!match) continue;

      const checked = match[1].toLowerCase() === 'x';
      inline.content = inline.content.slice(match[0].length);
      const first = inline.children?.[0];
      if (first && (first.type === 'text' || first.type === 'inline')) {
        first.content = first.content.replace(/^\[([ xX])\][ \t]+/, '');
      }

      open.attrJoin('class', 'task-list-item');
      open.attrSet('data-checked', checked ? 'true' : 'false');
    }
  });

  md.renderer.rules.list_item_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const classes = token.attrGet('class') || '';
    if (!classes.includes('task-list-item')) {
      return self.renderToken(tokens, idx, options);
    }
    const checked = token.attrGet('data-checked') === 'true';
    const attrs = self.renderAttrs(token);
    return `<li${attrs}><input class="task-list-item-checkbox" type="checkbox" disabled${checked ? ' checked' : ''}>`;
  };
}

/**
 * Mermaid diagrams.
 *
 * A ```mermaid fence is not rendered by markdown-it: the source code is put
 * into the document as a marked block and the client replaces it with the
 * rendered diagram once mermaid itself has drawn it.
 */
function mermaidPlugin(md) {
  const defaultFence = md.renderer.rules.fence;

  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const info = token.info.trim().toLowerCase();
    if (info === 'mermaid' || info.startsWith('mermaid ')) {
      return `<pre class="mermaid-source" data-mermaid="1">${escapeHtml(token.content)}</pre>`;
    }
    return defaultFence(tokens, idx, options, env, self);
  };
}

/**
 * @param {{getBaseDir: () => string}} options
 */
export function createMarkdown({ getBaseDir }) {
  const md = new MarkdownIt({
    html: false,
    xhtmlOut: false,
    breaks: false,
    linkify: true,
    typographer: false,
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
        } catch {
          /* fall through to the escaped fallback */
        }
      }
      return escapeHtml(code);
    },
  });

  md.use(taskListsPlugin);
  md.use(relativePathsPlugin, { getBaseDir });
  md.use(anchorsPlugin);
  md.use(katexPlugin);
  md.use(mermaidPlugin);

  return md;
}
