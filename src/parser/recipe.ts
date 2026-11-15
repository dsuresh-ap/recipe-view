import { htmlToLines, isAllBold, lineText, type Line, type Segment } from "./lines.js";

export interface Item {
  /** Plain text, used for schema.org data. */
  text: string;
  /** The same text with bold/italic/links kept, HTML-escaped and safe to render. */
  html: string;
}

export interface Group {
  label?: string;
  items: Item[];
}

export interface NoteBlock extends Item {
  list?: boolean;
}

export interface Recipe {
  title: string;
  description: Item[];
  /** e.g. "4 servings", "8 cookies" */
  yield?: string;
  /** ISO 8601 durations, e.g. "PT15M" */
  prepTime?: string;
  cookTime?: string;
  totalTime?: string;
  ingredients: Group[];
  steps: Group[];
  notes: NoteBlock[];
  /** Image sources in order: data: URIs or URLs. */
  images: string[];
  tags: string[];
}

type Section = "intro" | "ingredients" | "steps" | "notes";

const SECTION_PATTERNS: [Section, RegExp][] = [
  ["ingredients", /^(ingredients?|ingredient list|what you('|’)?ll need|you('|’)?ll need|shopping list)$/i],
  ["steps", /^(steps?|instructions?|method|directions?|preparation|how to( make( it)?)?|to make|procedure)$/i],
  ["notes", /^(notes?|tips?|tips (and|&) (notes|tricks)|variations?|storage|to store|serving suggestions?|nutrition( facts| info)?|make ahead)$/i],
];

const TAG_LINE_RE = /^(#[\p{L}\d_-]+\s*)+$/u;

const YIELD_RE =
  /\b(?:serves|servings?|yields?|makes)\b\s*:?\s*(?:about|approx\.?|approximately|around|~)?\s*(\d+(?:[.,/]\d+)?(?:\s*[-–]\s*\d+)?|[½¼¾⅓⅔])\s*([a-z]+(?:\s+[a-z]+)?)?/i;
const YIELD_STOPWORDS = new Set(["a", "an", "as", "and", "of", "or", "for", "to", "in", "with", "at", "on"]);
const GENERIC_YIELD_UNITS = /^(servings?|people|persons?|portions?)$/;

const TIME_RE = /\b(prep(?:aration)?|cook(?:ing)?|total|active)(?:\s+time)?\s*:\s*([^·|,;]+)/gi;
const DURATION_RE = /(\d+(?:\.\d+)?)\s*(?:[-–]\s*(\d+(?:\.\d+)?))?\s*(h|hrs?|hours?|m|mins?|minutes?)\b/gi;

function classify(text: string): Section | undefined {
  const clean = text.replace(/[:：\s]+$/, "").trim();
  return SECTION_PATTERNS.find(([, re]) => re.test(clean))?.[0];
}

/** A short line that reads like a label: a heading, all bold, or ending in ":". */
function isLabelLike(line: Line): boolean {
  if (line.kind === "heading") return true;
  if (line.hasChildren) return true;
  if (line.kind !== "para") return false;
  const text = lineText(line);
  if (text.length > 60) return false;
  return (
    isAllBold(line) ||
    /[:：]$/.test(text) ||
    classify(text) !== undefined ||
    isShouty(text)
  );
}

/** "PUMPKIN OATMEAL (serves 2)": an all-caps line used as a heading. */
function isShouty(text: string): boolean {
  const letters = text.replace(/\([^)]*\)/g, "").replace(/[^\p{L}]/gu, "");
  return letters.length >= 4 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
}

/** Prose rather than a list entry. Trailing "..." is ignored. */
function looksLikeSentence(text: string, strict = false): boolean {
  const t = text.replace(/(\.{3}|…)$/, "");
  if (strict) return t.length > 120 || /[.!?]\s+[A-Z]/.test(t);
  return t.length > 80 || /[.!?]\s+\S/.test(t) || (t.length > 40 && /[.!]$/.test(t));
}

const QUANTITY_START_RE =
  /^(\d|[½¼¾⅓⅔⅛]|(a|an|one|two|three|four|half|pinch|dash|handful|splash|drizzle|juice|zest|some|few|small|large|medium|a few)\b)/i;

/** "2 tbsp olive oil", "Pinch of salt", "Juice of ½ lemon". */
function looksLikeIngredient(line: Line | undefined): boolean {
  if (!line || line.kind !== "para") return false;
  const text = lineText(line);
  return text.length <= 90 && QUANTITY_START_RE.test(text) && !looksLikeSentence(text, true);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function segmentsToHtml(segments: Segment[]): string {
  return segments
    .map((s) => {
      let html = escapeHtml(s.text);
      if (s.italic) html = `<em>${html}</em>`;
      if (s.bold) html = `<strong>${html}</strong>`;
      if (s.href && /^https?:\/\//i.test(s.href)) {
        html = `<a href="${escapeHtml(s.href)}" rel="noopener noreferrer">${html}</a>`;
      }
      return html;
    })
    .join("");
}

function toItem(line: Line): Item {
  return { text: lineText(line), html: segmentsToHtml(line.segments) };
}

function stripTrailingColon(text: string): string {
  return text.replace(/\s*[:：]\s*$/, "");
}

export function parseYield(text: string): string | undefined {
  const m = text.match(YIELD_RE);
  if (!m) return undefined;
  const amount = m[1]!.replace(/\s+/g, "");
  const words = (m[2]?.toLowerCase().split(/\s+/) ?? []).filter(Boolean);
  // Keep a second word only when it is part of the unit ("small cookies").
  const unitWords = words.length && YIELD_STOPWORDS.has(words[0]!) ? [] : words.slice(0, 2);
  if (unitWords.length === 2 && YIELD_STOPWORDS.has(unitWords[1]!)) unitWords.pop();
  const unit = unitWords.join(" ");
  if (!unit || GENERIC_YIELD_UNITS.test(unit)) return `${amount} servings`;
  return `${amount} ${unit}`;
}

/** Converts "1 hr 15 min" or "10-15 minutes" to an ISO 8601 duration (upper bound of a range). */
export function parseDuration(text: string): string | undefined {
  let minutes = 0;
  let found = false;
  for (const m of text.matchAll(DURATION_RE)) {
    const value = Number(m[2] ?? m[1]);
    minutes += /^h/i.test(m[3]!) ? value * 60 : value;
    found = true;
  }
  if (!found || minutes <= 0) return undefined;
  const h = Math.floor(minutes / 60);
  const min = Math.round(minutes % 60);
  return `PT${h ? `${h}H` : ""}${min || !h ? `${min}M` : ""}`;
}

function parseTimes(text: string, recipe: Recipe): boolean {
  let matched = false;
  for (const m of text.matchAll(TIME_RE)) {
    const duration = parseDuration(m[2]!);
    if (!duration) continue;
    const kind = m[1]!.toLowerCase();
    if (kind.startsWith("prep") || kind === "active") recipe.prepTime ??= duration;
    else if (kind.startsWith("cook")) recipe.cookTime ??= duration;
    else recipe.totalTime ??= duration;
    matched = true;
  }
  return matched;
}

/**
 * Turns the HTML of an Apple Note into a structured recipe.
 *
 * The parser walks the note line by line with a small state machine. Section
 * headings ("Ingredients", "Method", "Notes", ...) switch sections explicitly;
 * without them, bullet lists are read as ingredients and numbered lists as
 * steps, which is how most hand-written recipe notes are laid out.
 */
export function parseRecipe(html: string, fallbackTitle = "Untitled"): Recipe {
  const lines = htmlToLines(html);
  const recipe: Recipe = {
    title: fallbackTitle,
    description: [],
    ingredients: [],
    steps: [],
    notes: [],
    images: [],
    tags: [],
  };

  // Apple Notes always uses the first line of a note as its title.
  const titleIndex = lines.findIndex((l) => l.kind !== "image");
  if (titleIndex >= 0) {
    const text = lineText(lines[titleIndex]!).trim();
    if (text) recipe.title = stripTrailingColon(text);
  }

  let section = "intro" as Section;
  let explicitSection = false;
  let numberedSteps = false;
  let ingredientGroup: Group | undefined;
  let stepGroup: Group | undefined;

  const addIngredient = (item: Item) => {
    if (!ingredientGroup) recipe.ingredients.push((ingredientGroup = { items: [] }));
    ingredientGroup.items.push(item);
  };
  const addStep = (item: Item) => {
    if (!stepGroup) recipe.steps.push((stepGroup = { items: [] }));
    stepGroup.items.push(item);
  };
  const enter = (next: Section, explicit: boolean) => {
    if (next !== section) {
      if (next === "steps") numberedSteps = false;
      section = next;
    }
    explicitSection = explicit;
  };

  const nextContent = (from: number): Line | undefined => {
    for (let j = from + 1; j < lines.length; j++) {
      if (lines[j]!.kind !== "image") return lines[j];
    }
    return undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (i === titleIndex) continue;

    if (line.kind === "image") {
      if (line.src) recipe.images.push(line.src);
      continue;
    }

    const text = lineText(line);
    if (TAG_LINE_RE.test(text)) {
      recipe.tags.push(...text.split(/\s+/).map((t) => t.slice(1)));
      continue;
    }

    if (isLabelLike(line)) {
      const kind = classify(text);
      if (kind) {
        enter(kind, true);
        if (kind === "ingredients") ingredientGroup = undefined;
        if (kind === "steps") stepGroup = undefined;
        continue;
      }
      const yieldText = parseYield(text);
      if (yieldText) recipe.yield ??= yieldText;
      // "SERVES 4" on its own line is metadata, not a heading.
      if (yieldText && text.replace(YIELD_RE, "").replace(/[^\p{L}]/gu, "") === "") continue;
      const label = stripTrailingColon(text);
      const next = nextContent(i);
      const nextIsList = next?.kind === "bullet" || next?.kind === "numbered";
      // A label followed by ingredient-looking lines starts an ingredient group,
      // e.g. "Wet:", "For the marinade", "PUMPKIN OATMEAL (serves 2)".
      const startsIngredients =
        next?.kind === "bullet" && section !== "steps" && section !== "notes"
          ? true
          : looksLikeIngredient(next) && looksLikeIngredient(nextContent(lines.indexOf(next!)));
      if (startsIngredients && section !== "notes") {
        enter("ingredients", explicitSection && section === "ingredients");
        recipe.ingredients.push((ingredientGroup = { label, items: [] }));
        continue;
      }
      if (section === "intro" && yieldText) continue;
      if ((section === "intro" || section === "ingredients") && next?.kind === "numbered") {
        enter("steps", false);
        recipe.steps.push((stepGroup = { label, items: [] }));
        continue;
      }
      if (section === "steps" && nextIsList) {
        recipe.steps.push((stepGroup = { label, items: [] }));
        continue;
      }
      if (section === "intro") {
        recipe.description.push(toItem(line));
        continue;
      }
      if (section === "steps" && !numberedSteps && next && !isLabelLike(next)) {
        // A bold run-in step heading followed by paragraph steps.
        recipe.steps.push((stepGroup = { label, items: [] }));
        continue;
      }
      if (section === "ingredients" && !explicitSection) {
        recipe.description.push(toItem(line));
        continue;
      }
      recipe.notes.push(toItem(line));
      continue;
    }

    const item = toItem(line);
    switch (section) {
      case "intro":
        if (line.kind === "bullet" || (looksLikeIngredient(line) && looksLikeIngredient(nextContent(i)))) {
          enter("ingredients", false);
          addIngredient(item);
        } else if (line.kind === "numbered") {
          enter("steps", false);
          numberedSteps = true;
          addStep(item);
        } else {
          const yieldText = parseYield(text);
          if (yieldText) recipe.yield ??= yieldText;
          const isTime = parseTimes(text, recipe);
          // Drop lines that only state the yield, e.g. "Serves 4".
          if (!(yieldText && text.length <= 24) && !(isTime && text.length <= 40)) {
            recipe.description.push(item);
          }
        }
        break;

      case "ingredients":
        if (line.kind === "numbered" && !(explicitSection && recipe.ingredients.length === 0)) {
          enter("steps", false);
          numberedSteps = true;
          addStep(item);
        } else if (
          line.kind === "para" &&
          recipe.ingredients.length > 0 &&
          (looksLikeSentence(text, explicitSection) || (!looksLikeIngredient(line) && text.length > 40))
        ) {
          // Prose after the ingredient list: these are the steps.
          enter("steps", false);
          addStep(item);
        } else {
          addIngredient(item);
        }
        break;

      case "steps":
        if (line.kind === "numbered") {
          numberedSteps = true;
          addStep(item);
        } else if (line.kind === "para" && numberedSteps) {
          // Text after numbered steps is usually a serving note.
          recipe.notes.push(item);
        } else {
          addStep(item);
        }
        break;

      case "notes":
        recipe.notes.push({ ...item, list: line.kind !== "para" });
        break;
    }
  }

  // Notes often repeats the title on the second line.
  const sameAsTitle = (t: string) => stripTrailingColon(t).toLowerCase() === recipe.title.toLowerCase();
  recipe.description = recipe.description.filter((d) => !sameAsTitle(d.text));
  recipe.ingredients = recipe.ingredients.filter((g) => g.items.length > 0);
  recipe.steps = recipe.steps.filter((g) => g.items.length > 0);
  return recipe;
}

export function isRecipe(recipe: Recipe): boolean {
  return recipe.ingredients.length > 0 || recipe.steps.length > 0;
}
