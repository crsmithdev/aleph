import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type Frontmatter = { name?: string; description?: string };

/**
 * Split a leading YAML frontmatter block from markdown. Rendered raw, frontmatter
 * mis-parses (the closing `---` turns the keys into a setext heading + <hr>), so
 * the preview pulls out name/description and drops the block from the body.
 * Handles single-line values and folded (`>`) / literal (`|`) block scalars.
 */
function splitFrontmatter(content: string): { meta: Frontmatter; body: string } {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: content };
  const meta: Frontmatter = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([a-zA-Z][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    let value = kv[2].trim();
    if (value === '>' || value === '|' || value === '') {
      const folded: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) folded.push(lines[++i].trim());
      if (folded.length) value = folded.join(value === '|' ? '\n' : ' ');
    }
    if (key === 'name') meta.name = value;
    else if (key === 'description') meta.description = value;
  }
  return { meta, body: content.slice(m[0].length) };
}

export function MarkdownBlock({ content, filename }: { content: string; filename?: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const [viewRaw, setViewRaw] = useState(false);
  const { meta, body } = splitFrontmatter(content);

  return (
    <div className="rounded-lg border border-border-primary bg-bg-primary overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-2 bg-bg-secondary border-b border-border-primary cursor-pointer select-none"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-2">
          <span className="text-text-muted text-xs">{collapsed ? '\u25b6' : '\u25bc'}</span>
          {filename && <span className="font-mono text-xs text-text-secondary">{filename}</span>}
        </div>
        <div className="flex items-center gap-2">
          {!collapsed && (
            <button
              onClick={(e) => { e.stopPropagation(); setViewRaw(!viewRaw); }}
              className="text-xs text-text-muted hover:text-text-secondary transition-colors px-1.5 py-0.5 rounded border border-border-primary bg-bg-tertiary"
            >
              {viewRaw ? 'Preview' : 'Raw'}
            </button>
          )}
          <span className="text-text-muted text-xs">Source</span>
        </div>
      </div>
      {!collapsed && (
        viewRaw ? (
          <pre className="text-xs leading-5 p-4 overflow-x-auto whitespace-pre-wrap text-text-secondary font-mono">
            {content}
          </pre>
        ) : (
          <div className="p-4 prose-sm max-w-none
            [&_h1]:text-lg [&_h1]:font-bold [&_h1]:text-text-primary [&_h1]:mt-4 [&_h1]:mb-2
            [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-text-primary [&_h2]:mt-3 [&_h2]:mb-1.5
            [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-text-primary [&_h3]:mt-2 [&_h3]:mb-1
            [&_p]:text-sm [&_p]:text-text-secondary [&_p]:leading-relaxed [&_p]:mb-2
            [&_ul]:text-sm [&_ul]:text-text-secondary [&_ul]:ml-4 [&_ul]:mb-2 [&_ul]:list-disc
            [&_ol]:text-sm [&_ol]:text-text-secondary [&_ol]:ml-4 [&_ol]:mb-2 [&_ol]:list-decimal
            [&_li]:mb-0.5
            [&_code]:text-xs [&_code]:font-mono [&_code]:bg-bg-tertiary [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-accent
            [&_pre]:bg-bg-secondary [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:overflow-x-auto [&_pre]:mb-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0
            [&_strong]:font-semibold [&_strong]:text-text-primary
            [&_em]:italic
            [&_hr]:border-border-primary [&_hr]:my-3
            [&_blockquote]:border-l-2 [&_blockquote]:border-accent [&_blockquote]:pl-3 [&_blockquote]:text-text-muted [&_blockquote]:italic
            [&_a]:text-accent [&_a]:hover:underline
            [&_table]:text-sm [&_table]:w-full [&_table]:border-collapse
            [&_th]:text-left [&_th]:text-text-muted [&_th]:font-medium [&_th]:border-b [&_th]:border-border-primary [&_th]:pb-1 [&_th]:pr-4
            [&_td]:text-text-secondary [&_td]:border-b [&_td]:border-border-primary/50 [&_td]:py-1 [&_td]:pr-4
          ">
            {meta.name && <h1 className="text-lg font-bold text-text-primary mt-0 mb-1">{meta.name}</h1>}
            {meta.description && <p className="text-sm text-text-muted leading-relaxed mb-3">{meta.description}</p>}
            <Markdown remarkPlugins={[remarkGfm]}>{body}</Markdown>
          </div>
        )
      )}
    </div>
  );
}
