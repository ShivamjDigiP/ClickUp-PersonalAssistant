import type { ReactNode } from "react";

// A small, safe renderer for the chat's answers: paragraphs, bullet and numbered lists, headings, **bold**, `code` and
// real tables. Nothing is ever injected as HTML, so text from tasks or commits cannot do anything but show up as text.
const inline = (text: string): ReactNode[] =>
  text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <b key={i} className="font-semibold">{part.slice(2, -2)}</b>
    : part.startsWith("`") && part.endsWith("`") && part.length > 2 ? <code key={i} className="rounded bg-[rgb(var(--tint)/0.1)] px-1 py-0.5 text-[0.85em]">{part.slice(1, -1)}</code>
    : part,
  );

const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isRule = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const isTableLine = (line: string) => line.trim().startsWith("|") && line.includes("|", line.indexOf("|") + 1);
const numeric = (s: string) => /^[~≈<>+\-−]?\s*\d[\d,.\s]*(%|\s?(days?|d|h|weeks?|tasks?|commits?|PRs?))?$/i.test(s);

type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] };

function parse(text: string): Block[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: Block[] = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (isTableLine(line)) {
      const rows: string[][] = [];
      while (i < lines.length && isTableLine(lines[i])) { if (!isRule(lines[i])) rows.push(cells(lines[i])); i++; }
      if (rows.length) out.push({ kind: "table", head: rows[0], rows: rows.slice(1) });
      continue;
    }
    if (/^#{1,4}\s+/.test(line)) { out.push({ kind: "h", text: line.replace(/^#{1,4}\s+/, "") }); i++; continue; }
    const bullet = /^\s*(?:[-*•])\s+/;
    const number = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || number.test(line)) {
      const kind = bullet.test(line) ? "ul" : "ol";
      const re = kind === "ul" ? bullet : number;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) { items.push(lines[i].replace(re, "")); i++; }
      out.push(kind === "ul" ? { kind: "ul", items } : { kind: "ol", items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !isTableLine(lines[i]) && !/^#{1,4}\s+/.test(lines[i]) && !bullet.test(lines[i]) && !number.test(lines[i])) { para.push(lines[i]); i++; }
    out.push({ kind: "p", text: para.join("\n") });
  }
  return out;
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-3">
      {parse(text).map((b, i) =>
        b.kind === "p" ? <p key={i} className="whitespace-pre-line">{inline(b.text)}</p>
        : b.kind === "h" ? <p key={i} className="pt-1 text-[11px] uppercase tracking-widest text-[var(--muted)]">{inline(b.text)}</p>
        : b.kind === "ul" ? <ul key={i} className="space-y-1.5">{b.items.map((t, k) => <li key={k} className="flex gap-2.5"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--muted)]" aria-hidden />{inline(t)}</li>)}</ul>
        : b.kind === "ol" ? <ol key={i} className="list-decimal space-y-1.5 pl-5">{b.items.map((t, k) => <li key={k}>{inline(t)}</li>)}</ol>
        : (
          <div key={i} className="overflow-x-auto rounded-xl border border-[var(--glass-border)]">
            <table className="w-full min-w-[320px] text-left text-sm">
              <thead className="bg-[rgb(var(--tint)/0.06)] text-[11px] uppercase tracking-wider text-[var(--muted)]">
                <tr>{b.head.map((h, k) => <th key={k} className={`px-3 py-2 font-normal ${k > 0 ? "text-right" : ""}`}>{inline(h)}</th>)}</tr>
              </thead>
              <tbody>
                {b.rows.map((r, ri) => (
                  <tr key={ri} className="border-t border-[var(--glass-border)]">
                    {b.head.map((_, k) => <td key={k} className={`px-3 py-2 ${k === 0 ? "font-medium" : numeric(r[k] ?? "") ? "text-right tabular-nums" : "text-right"}`}>{inline(r[k] ?? "")}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ),
      )}
    </div>
  );
}

// The assistant can end a reply with  OPTIONS: first | second | third  to offer answers as buttons (for example the period).
export function splitOptions(text: string): { body: string; options: string[] } {
  const m = text.match(/^\s*OPTIONS:\s*(.+)$/im);
  if (!m) return { body: text, options: [] };
  const options = m[1].split("|").map((o) => o.replace(/\*+/g, "").trim()).filter(Boolean).slice(0, 5);
  return { body: text.replace(m[0], "").trimEnd(), options };
}
