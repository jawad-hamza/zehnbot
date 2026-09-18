// A deliberately small Markdown subset for bot replies: paragraphs, bullet/numbered lists,
// **bold**, *italic*, `code`, [links](https://…) and bare URLs.
//
// Security: the reply is model output shaped by whatever the visitor typed, so it is untrusted.
// Nothing here ever touches innerHTML. Every node is created with createElement/createTextNode,
// and links are only made for http(s) URLs.

const INLINE = /(\*\*[^*\n]+?\*\*|\*[^*\s][^*\n]*?\*|`[^`\n]+?`|\[[^\]\n]+?\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>"']+)/g;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.*)$/;

function safeLink(url, label) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return document.createTextNode(label);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return document.createTextNode(label);
  const a = document.createElement("a");
  a.href = parsed.href;
  a.textContent = label;
  a.target = "_blank";
  a.rel = "noopener noreferrer nofollow";
  return a;
}

function appendInline(parent, text) {
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) parent.appendChild(document.createTextNode(text.slice(last, match.index)));
    const token = match[0];
    last = match.index + token.length;

    if (token.startsWith("**")) {
      const el = document.createElement("strong");
      el.textContent = token.slice(2, -2);
      parent.appendChild(el);
    } else if (token.startsWith("*")) {
      const el = document.createElement("em");
      el.textContent = token.slice(1, -1);
      parent.appendChild(el);
    } else if (token.startsWith("`")) {
      const el = document.createElement("code");
      el.textContent = token.slice(1, -1);
      parent.appendChild(el);
    } else if (token.startsWith("[")) {
      const split = token.lastIndexOf("](");
      parent.appendChild(safeLink(token.slice(split + 2, -1), token.slice(1, split)));
    } else {
      // bare URL: sentence punctuation right after it is not part of the address
      const trailing = (token.match(/[.,;:!?)\]]+$/) || [""])[0];
      const url = trailing ? token.slice(0, -trailing.length) : token;
      parent.appendChild(safeLink(url, url));
      if (trailing) parent.appendChild(document.createTextNode(trailing));
    }
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

export function renderRichText(container, text) {
  const fragment = document.createDocumentFragment();
  let paragraph = null;
  let list = null;

  const closeBlocks = () => {
    paragraph = null;
    list = null;
  };

  for (const rawLine of String(text).replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.replace(/^#{1,6}\s+/, "");   // headings are shown as plain lines
    if (!line.trim()) {
      closeBlocks();
      continue;
    }

    const bullet = line.match(BULLET);
    const numbered = bullet ? null : line.match(NUMBERED);
    if (bullet || numbered) {
      const tag = bullet ? "UL" : "OL";
      if (!list || list.tagName !== tag) {
        list = document.createElement(tag);
        fragment.appendChild(list);
      }
      paragraph = null;
      const item = document.createElement("li");
      appendInline(item, (bullet || numbered)[1]);
      list.appendChild(item);
      continue;
    }

    list = null;
    if (!paragraph) {
      paragraph = document.createElement("p");
      fragment.appendChild(paragraph);
    } else {
      paragraph.appendChild(document.createElement("br"));
    }
    appendInline(paragraph, line);
  }

  container.replaceChildren(fragment);
}
