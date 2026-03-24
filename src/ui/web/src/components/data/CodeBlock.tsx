import { useState, type ReactNode } from 'react';

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
  'switch', 'case', 'break', 'continue', 'new', 'this', 'class', 'extends', 'super',
  'import', 'export', 'from', 'default', 'try', 'catch', 'finally', 'throw',
  'async', 'await', 'yield', 'typeof', 'instanceof', 'in', 'of', 'void', 'delete',
  'type', 'interface', 'enum', 'as', 'implements', 'declare', 'readonly', 'abstract',
  'true', 'false', 'null', 'undefined',
]);

function highlightLine(line: string): ReactNode[] {
  const tokens: ReactNode[] = [];
  // Regex: strings, comments, numbers, identifiers
  const re = /(\/\/.*$|\/\*[\s\S]*?\*\/|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|[a-zA-Z_$]\w*)/gm;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(line)) !== null) {
    if (match.index > last) tokens.push(line.slice(last, match.index));
    const text = match[0];
    const key = `${match.index}`;

    if (text.startsWith('//') || text.startsWith('/*')) {
      tokens.push(<span key={key} className="text-text-muted/60 italic">{text}</span>);
    } else if (text.startsWith("'") || text.startsWith('"') || text.startsWith('`')) {
      tokens.push(<span key={key} className="text-success">{text}</span>);
    } else if (/^\d/.test(text)) {
      tokens.push(<span key={key} className="text-warning">{text}</span>);
    } else if (KEYWORDS.has(text)) {
      tokens.push(<span key={key} className="text-accent font-medium">{text}</span>);
    } else {
      tokens.push(text);
    }
    last = match.index + text.length;
  }

  if (last < line.length) tokens.push(line.slice(last));
  return tokens;
}

export function CodeBlock({ code, filename }: { code: string; filename?: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const lines = code.split('\n');

  return (
    <div className="rounded-lg border border-border-primary bg-bg-primary overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-2 bg-bg-secondary border-b border-border-primary cursor-pointer select-none"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-2">
          <span className="text-text-muted text-xs">{collapsed ? '\u25b6' : '\u25bc'}</span>
          {filename && <span className="font-mono text-xs text-text-secondary">{filename}</span>}
          <span className="text-text-muted text-xs">{lines.length} lines</span>
        </div>
        <span className="text-text-muted text-xs">Source</span>
      </div>
      {!collapsed && (
        <div className="overflow-x-auto">
          <pre className="text-xs leading-5 p-0 m-0">
            <code>
              {lines.map((line, i) => (
                <div key={i} className="flex hover:bg-bg-secondary/50">
                  <span className="select-none text-text-muted/40 text-right pr-4 pl-4 min-w-[3.5rem] inline-block border-r border-border-primary/30">
                    {i + 1}
                  </span>
                  <span className="pl-4 pr-4 whitespace-pre">{highlightLine(line)}</span>
                </div>
              ))}
            </code>
          </pre>
        </div>
      )}
    </div>
  );
}
