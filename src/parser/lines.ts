import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";

/**
 * Apple Notes stores a note as loose HTML: <div> per line, <h1>/<h2> for
 * titles, <ul>/<ol> for real lists, and often "    •    item" or "1. step"
 * typed as plain text. This module flattens that HTML into a list of lines,
 * each with its inline formatting and what kind of line it looks like.
 */

export interface Segment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  href?: string;
}

export type LineKind = "heading" | "bullet" | "numbered" | "para" | "image";

export interface Line {
  kind: LineKind;
  segments: Segment[];
  /** Nesting depth for list items (0 = top level). */
  level: number;
  /** A list item that has a nested list under it, e.g. "For the marinade". */
  hasChildren?: boolean;
  /** For image lines: a data: URI or URL. */
  src?: string;
}

const BLOCK_TAGS = new Set([
  "div", "p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre",
  "table", "tbody", "thead", "tr", "section", "article", "header", "footer",
]);
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

export function htmlToLines(html: string): Line[] {
  const $ = cheerio.load(html, null, false);
  const lines: Line[] = [];

  const emit = (kind: LineKind, segments: Segment[], level: number) => {
    if (segments.some((s) => s.text.trim() !== "")) {
      lines.push({ kind, segments, level });
    }
  };

  /** Walk an element whose content becomes one or more lines. */
  const block = (el: AnyNode, kind: LineKind, level: number) => {
    let segs: Segment[] = [];
    const flush = () => {
      emit(kind, segs, level);
      segs = [];
    };
    const inline = (node: AnyNode, fmt: Omit<Segment, "text">) => {
      for (const child of (node as Element).children ?? []) {
        if (child.type === "text") {
          segs.push({ ...fmt, text: (child as unknown as { data: string }).data });
          continue;
        }
        if (child.type !== "tag") continue;
        const tag = child.tagName.toLowerCase();
        if (tag === "br") {
          flush();
        } else if (tag === "img") {
          flush();
          const src = child.attribs.src;
          if (src) lines.push({ kind: "image", segments: [], level: 0, src });
        } else if (tag === "ul" || tag === "ol") {
          flush();
          list(child, kind === "bullet" || kind === "numbered" ? level + 1 : 0);
        } else if (tag === "li") {
          flush();
          block(child, "bullet", level);
        } else if (tag === "td" || tag === "th") {
          if (segs.length) segs.push({ text: " · " });
          inline(child, fmt);
        } else if (BLOCK_TAGS.has(tag)) {
          flush();
          block(child, HEADING_TAGS.has(tag) ? "heading" : "para", level);
        } else if (tag === "b" || tag === "strong") {
          inline(child, { ...fmt, bold: true });
        } else if (tag === "i" || tag === "em") {
          inline(child, { ...fmt, italic: true });
        } else if (tag === "a") {
          inline(child, { ...fmt, href: child.attribs.href });
        } else if (tag === "script" || tag === "style") {
          // never render
        } else {
          inline(child, fmt);
        }
      }
    };
    inline(el, {});
    flush();
  };

  const list = (el: Element, level: number) => {
    const kind: LineKind = el.tagName.toLowerCase() === "ol" ? "numbered" : "bullet";
    for (const child of el.children) {
      if (child.type !== "tag") continue;
      const tag = child.tagName.toLowerCase();
      if (tag === "ul" || tag === "ol") list(child, level + 1);
      else block(child, kind, level);
    }
  };

  const root = $.root()[0];
  if (root) block(root, "para", 0);

  // Mark list items that introduce a deeper list.
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i]!;
    const next = lines[i + 1]!;
    const isItem = line.kind === "bullet" || line.kind === "numbered";
    const nextIsItem = next.kind === "bullet" || next.kind === "numbered";
    if (isItem && nextIsItem && next.level > line.level) line.hasChildren = true;
  }

  return lines.map(detectTextMarkers);
}

const WS = "[\\s\\u00a0]";
/** "•  item", "- item", "* item" typed as plain text. */
const BULLET_RE = new RegExp(`^${WS}*[•◦▪▫‣⁃●○■□–\\-*]${WS}+`);
/** "1. step", "2) step", or Notes' pasted "    1    step" / "1\tstep". */
const NUMBER_RE = new RegExp(`^(?:${WS}*\\d{1,2}[.)](?:${WS}+|(?=\\D))|${WS}+\\d{1,2}${WS}{2,}|\\d{1,2}\\t${WS}*)`);
/** "## Ingredients" typed as Markdown. */
const MD_HEADING_RE = new RegExp(`^${WS}*#{1,6}${WS}+`);

function detectTextMarkers(line: Line): Line {
  if (line.kind === "image") return line;
  const raw = line.segments.map((s) => s.text).join("");
  let kind = line.kind;
  let strip = 0;
  let m: RegExpMatchArray | null;
  if (kind === "numbered") {
    // An <ol> item that also has "1." typed in front of it.
    if ((m = raw.match(NUMBER_RE))) strip = m[0].length;
  } else if (kind === "para" || kind === "bullet") {
    if ((m = raw.match(MD_HEADING_RE))) {
      kind = "heading";
      strip = m[0].length;
    } else if ((m = raw.match(NUMBER_RE))) {
      kind = kind === "para" ? "numbered" : kind;
      strip = kind === "numbered" ? m[0].length : 0;
    } else if ((m = raw.match(BULLET_RE))) {
      kind = "bullet";
      strip = m[0].length;
    }
  }
  return { ...line, kind, segments: normalize(stripPrefix(line.segments, strip)) };
}

function stripPrefix(segments: Segment[], count: number): Segment[] {
  const out: Segment[] = [];
  let left = count;
  for (const seg of segments) {
    if (left >= seg.text.length) {
      left -= seg.text.length;
      continue;
    }
    out.push(left > 0 ? { ...seg, text: seg.text.slice(left) } : seg);
    left = 0;
  }
  return out;
}

/** Collapses whitespace, trims the line, and merges neighbours with equal formatting. */
function normalize(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const seg of segments) {
    const text = seg.text.replace(/[\s ]+/g, " ");
    const prev = out[out.length - 1];
    if (prev && prev.bold === seg.bold && prev.italic === seg.italic && prev.href === seg.href) {
      prev.text += text;
    } else {
      out.push({ ...seg, text });
    }
  }
  if (out[0]) out[0].text = out[0].text.trimStart();
  const last = out[out.length - 1];
  if (last) last.text = last.text.trimEnd();
  return out.filter((s) => s.text !== "");
}

export function lineText(line: Line): string {
  return line.segments.map((s) => s.text).join("");
}

/** True when every visible character in the line is bold. */
export function isAllBold(line: Line): boolean {
  const visible = line.segments.filter((s) => s.text.trim() !== "");
  return visible.length > 0 && visible.every((s) => s.bold);
}
