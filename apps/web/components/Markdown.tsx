/** Minimal, safe markdown renderer for our own legal/patch-note documents (escapes all HTML). */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`(.+?)`/g, "<code>$1</code>");

export function Markdown({ text }: { text: string }) {
  const out: string[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{1,3} /.test(l)) { const n = l.match(/^#+/)![0].length + 1; out.push(`<h${n}>${inline(l.replace(/^#+ /, ""))}</h${n}>`); }
    else if (l.startsWith("> ")) out.push(`<div class="banner warn" style="margin:8px 0">${inline(l.slice(2))}</div>`);
    else if (/^- /.test(l)) { const items: string[] = []; while (i < lines.length && /^- /.test(lines[i])) items.push(`<li>${inline(lines[i++].slice(2))}</li>`); i--; out.push(`<ul>${items.join("")}</ul>`); }
    else if (l.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) { const cells = lines[i++].split("|").slice(1, -1).map((c) => c.trim()); if (!cells.every((c) => /^-+$/.test(c))) rows.push(cells); }
      i--;
      out.push(`<div class="scroll-x"><table class="table small"><thead><tr>${rows[0].map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.slice(1).map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
    } else if (l.trim()) out.push(`<p>${inline(l)}</p>`);
  }
  return <div dangerouslySetInnerHTML={{ __html: out.join("\n") }} />;
}
