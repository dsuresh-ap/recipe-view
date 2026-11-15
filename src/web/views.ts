import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import { jsonForScript } from "../parser/jsonld.js";
import type { Group } from "../parser/recipe.js";
import type { StoredRecipe } from "../store.js";
import { styles } from "./styles.js";

type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

const ICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#b5532a"/><text x="32" y="44" font-size="34" text-anchor="middle">🍳</text></svg>`,
  );

function layout(opts: { title: string; head?: Html | string; body: Html }): Html {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Recipes">
<link rel="icon" href="${ICON}">
<title>${opts.title}</title>
<style>${raw(styles)}</style>
${opts.head ?? ""}
</head>
<body>
<main>
${opts.body}
</main>
</body>
</html>`;
}

function relativeTime(iso: string | undefined): string {
  if (!iso) return "never";
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 90) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function footer(exportedAt: string | undefined): Html {
  return html`<footer>Synced from Apple Notes ${relativeTime(exportedAt)}.</footer>`;
}

export function indexPage(recipes: StoredRecipe[], exportedAt: string | undefined, folder: string | undefined): Html {
  const list = recipes.length
    ? html`<ul class="recipes" id="recipes">
${recipes.map((r) => {
  const count = r.recipe.ingredients.reduce((n, g) => n + g.items.length, 0);
  const meta = [r.recipe.yield, count ? `${count} ingredients` : undefined].filter(Boolean).join(" · ");
  return html`<li data-name="${r.recipe.title.toLowerCase()}"><a href="/r/${r.slug}">
${r.imagePaths[0] ? html`<img src="${r.imagePaths[0]}" alt="" loading="lazy">` : ""}
<span><span class="name">${r.recipe.title}</span>${meta ? html`<br><span class="meta">${meta}</span>` : ""}</span>
</a></li>`;
})}
</ul>
<p class="empty" id="no-match" hidden>No recipes match.</p>`
    : html`<p class="empty">No recipes yet. Add notes to the “${folder ?? "Recipes"}” folder in Apple Notes, then wait for the next sync.</p>`;

  return layout({
    title: "Recipes",
    body: html`<h1>Recipes</h1>
<input class="search" id="search" type="search" placeholder="Search recipes" aria-label="Search recipes" autocomplete="off">
${list}
${footer(exportedAt)}
<script>
(() => {
  const input = document.getElementById("search");
  const items = [...document.querySelectorAll("#recipes li")];
  const none = document.getElementById("no-match");
  input?.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    for (const li of items) {
      const hit = !q || li.dataset.name.includes(q);
      li.hidden = !hit;
      if (hit) shown++;
    }
    if (none) none.hidden = shown > 0;
  });
})();
</script>`,
  });
}

function groups(list: Group[], render: (g: Group, offset: number) => Html): Html[] {
  let offset = 0;
  return list.map((g) => {
    const out = render(g, offset);
    offset += g.items.length;
    return out;
  });
}

export function recipePage(r: StoredRecipe, jsonLd: Record<string, unknown> | undefined, exportedAt: string | undefined): Html {
  const { recipe } = r;
  const chips = [
    recipe.yield,
    recipe.prepTime && `Prep ${formatDuration(recipe.prepTime)}`,
    recipe.cookTime && `Cook ${formatDuration(recipe.cookTime)}`,
    recipe.totalTime && `Total ${formatDuration(recipe.totalTime)}`,
  ].filter(Boolean) as string[];

  const ingredients = recipe.ingredients.length
    ? html`<section aria-labelledby="ingredients-heading">
<h2 id="ingredients-heading">Ingredients</h2>
${groups(recipe.ingredients, (g, offset) => html`${g.label ? html`<h3>${g.label}</h3>` : ""}
<ul class="ingredients">
${g.items.map((item, i) => html`<li><label><input type="checkbox" data-key="i${offset + i}"><span>${raw(item.html)}</span></label></li>`)}
</ul>`)}
</section>`
    : "";

  const steps = recipe.steps.length
    ? html`<section aria-labelledby="steps-heading">
<h2 id="steps-heading">Steps</h2>
${groups(recipe.steps, (g, offset) => html`${g.label ? html`<h3>${g.label}</h3>` : ""}
<ol class="steps" style="counter-reset: step ${offset}">
${g.items.map((item, i) => html`<li data-key="s${offset + i}">${raw(item.html)}</li>`)}
</ol>`)}
</section>`
    : "";

  const notes = recipe.notes.length
    ? html`<section class="notes" aria-labelledby="notes-heading">
<h2 id="notes-heading">Notes</h2>
${recipe.notes.map((n) => (n.list ? html`<li>${raw(n.html)}</li>` : html`<p>${raw(n.html)}</p>`))}
</section>`
    : "";

  const head = jsonLd
    ? html`<script type="application/ld+json">${raw(jsonForScript(jsonLd))}</script>`
    : "";

  return layout({
    title: recipe.title,
    head,
    body: html`<a class="back" href="/">‹ All recipes</a>
<article>
<h1>${recipe.title}</h1>
${chips.length ? html`<ul class="chips">${chips.map((c) => html`<li>${c}</li>`)}</ul>` : ""}
${r.imagePaths[0] ? html`<img class="hero" src="${r.imagePaths[0]}" alt="">` : ""}
${recipe.description.length ? html`<div class="description">${recipe.description.map((d) => html`<p>${raw(d.html)}</p>`)}</div>` : ""}
${r.isRecipe ? html`<div class="columns">${ingredients}${steps}</div>` : ""}
${notes}
</article>
${r.isRecipe ? html`<button class="reset" id="reset" type="button">Clear checkmarks</button>` : ""}
${footer(exportedAt)}
<script>
(() => {
  // Ticks for ingredients and finished steps, remembered on this device for this recipe.
  const key = "recipe-view:" + ${raw(jsonForScript(r.slug + ":" + r.meta.modified))};
  let state = {};
  try { state = JSON.parse(localStorage.getItem(key) || "{}"); } catch {}
  const save = () => { try { localStorage.setItem(key, JSON.stringify(state)); } catch {} };
  for (const box of document.querySelectorAll(".ingredients input")) {
    box.checked = !!state[box.dataset.key];
    box.addEventListener("change", () => { state[box.dataset.key] = box.checked; save(); });
  }
  for (const step of document.querySelectorAll(".steps li")) {
    step.classList.toggle("done", !!state[step.dataset.key]);
    step.setAttribute("role", "button");
    step.setAttribute("aria-pressed", String(!!state[step.dataset.key]));
    step.tabIndex = 0;
    const toggle = (e) => {
      if (e.target.closest("a")) return;
      state[step.dataset.key] = !state[step.dataset.key];
      step.classList.toggle("done", state[step.dataset.key]);
      step.setAttribute("aria-pressed", String(state[step.dataset.key]));
      save();
    };
    step.addEventListener("click", toggle);
    step.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(e); } });
  }
  document.getElementById("reset")?.addEventListener("click", () => {
    state = {}; save();
    document.querySelectorAll(".ingredients input").forEach((b) => (b.checked = false));
    document.querySelectorAll(".steps li").forEach((s) => { s.classList.remove("done"); s.setAttribute("aria-pressed", "false"); });
  });
})();
</script>`,
  });
}

export function notFoundPage(): Html {
  return layout({
    title: "Not found",
    body: html`<a class="back" href="/">‹ All recipes</a><h1>Recipe not found</h1><p class="muted">It may have been renamed or removed from Notes.</p>`,
  });
}

/** "PT1H20M" → "1 h 20 min" */
export function formatDuration(iso: string): string {
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/);
  if (!m) return iso;
  return [m[1] && `${m[1]} h`, m[2] && `${m[2]} min`].filter(Boolean).join(" ");
}
