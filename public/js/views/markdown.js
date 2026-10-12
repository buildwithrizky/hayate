import { escapeHtml } from "../state.js";

// Pure lightweight Markdown renderer
export function renderMarkdownHtml(mdText) {
  if (!mdText) return "";
  let src = escapeHtml(mdText);

  // Code blocks ```lang ... ```
  src = src.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_m, _lang, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  // Inline code `...`
  src = src.replace(/`([^`\n]+)`/g, "<code>$1</code>");

  // Headings
  src = src.replace(/^#### (.*?)$/gm, "<h4>$1</h4>");
  src = src.replace(/^### (.*?)$/gm, "<h3>$1</h3>");
  src = src.replace(/^## (.*?)$/gm, "<h2>$1</h2>");
  src = src.replace(/^# (.*?)$/gm, "<h1>$1</h1>");

  // Bold & Italic
  src = src.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  src = src.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  // Blockquotes
  src = src.replace(/^> (.*?)$/gm, "<blockquote>$1</blockquote>");

  // Horizontal Rule
  src = src.replace(/^---$/gm, "<hr />");

  // Links [text](url)
  src = src.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // Tables: simple detection of | col | col |
  const lines = src.split("\n");
  const parsedLines = [];
  let inTable = false;
  let tableRows = [];

  const flushTable = () => {
    if (!tableRows.length) return;
    let tableHtml = "<table>";
    tableRows.forEach((r, idx) => {
      if (idx === 1 && r.some((c) => /^:?-+:?$/.test(c.trim()))) {
        return; // Skip separator line
      }
      const tag = idx === 0 ? "th" : "td";
      tableHtml += "<tr>" + r.map((c) => `<${tag}>${c.trim()}</${tag}>`).join("") + "</tr>";
    });
    tableHtml += "</table>";
    parsedLines.push(tableHtml);
    tableRows = [];
    inTable = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
      inTable = true;
      const cells = line.trim().slice(1, -1).split("|");
      tableRows.push(cells);
    } else {
      if (inTable) flushTable();
      // Unordered lists
      if (/^\s*[-*]\s+(.*)$/.test(line)) {
        parsedLines.push(`<li>${line.replace(/^\s*[-*]\s+/, "")}</li>`);
      } else if (/^\s*\d+\.\s+(.*)$/.test(line)) {
        parsedLines.push(`<li>${line.replace(/^\s*\d+\.\s+/, "")}</li>`);
      } else if (line.trim().length > 0 && !line.startsWith("<h") && !line.startsWith("<blockquote") && !line.startsWith("<pre")) {
        parsedLines.push(`<p>${line}</p>`);
      } else {
        parsedLines.push(line);
      }
    }
  }
  if (inTable) flushTable();

  return parsedLines.join("\n");
}
