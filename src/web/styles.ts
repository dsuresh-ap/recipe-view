/**
 * Styles for a kitchen display. HomeView's Safari viewport is roughly 448×364
 * CSS px, so type is large, nothing is fixed to the top or bottom, and the
 * layout widens to two columns on bigger screens.
 */
export const styles = /* css */ `
:root {
  color-scheme: light dark;
  --bg: #faf7f2;
  --surface: #ffffff;
  --text: #2a2622;
  --muted: #6f665d;
  --line: #e7e0d6;
  --accent: #b5532a;
  --accent-soft: #f6e6dc;
  --done: #a39a90;
  --radius: 14px;
  --font: ui-rounded, -apple-system, BlinkMacSystemFont, "SF Pro Rounded", system-ui, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1a1816;
    --surface: #24211e;
    --text: #f1ece5;
    --muted: #a99f94;
    --line: #38332e;
    --accent: #f0905f;
    --accent-soft: #3a2a21;
    --done: #6f675f;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 19px/1.45 var(--font);
}
a { color: var(--accent); }
main { max-width: 1100px; margin: 0 auto; padding: 16px 18px 40px; }
h1 { font-size: 1.6rem; line-height: 1.2; margin: 6px 0 8px; text-wrap: balance; }
h2 { font-size: 1.15rem; margin: 22px 0 10px; letter-spacing: .01em; }
h3 { font-size: 1rem; margin: 14px 0 6px; color: var(--muted); }
.muted { color: var(--muted); }

/* Index */
.search {
  width: 100%; font: inherit; padding: 12px 16px; margin: 4px 0 14px;
  border: 1px solid var(--line); border-radius: var(--radius);
  background: var(--surface); color: var(--text);
}
.recipes { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
@media (min-width: 700px) { .recipes { grid-template-columns: 1fr 1fr; } }
.recipes a {
  display: flex; gap: 14px; align-items: center; min-height: 64px;
  padding: 12px 16px; border-radius: var(--radius);
  background: var(--surface); border: 1px solid var(--line);
  color: inherit; text-decoration: none;
}
.recipes a:active { background: var(--accent-soft); }
.recipes img { width: 56px; height: 56px; object-fit: cover; border-radius: 10px; flex: none; }
.recipes .name { font-weight: 600; line-height: 1.25; }
.recipes .meta { font-size: .85rem; color: var(--muted); }
.empty { padding: 24px; text-align: center; color: var(--muted); }

/* Recipe */
.back {
  display: inline-flex; align-items: center; gap: 6px; min-height: 44px;
  font-weight: 600; text-decoration: none;
}
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 4px 0 8px; padding: 0; list-style: none; }
.chips li { background: var(--accent-soft); border-radius: 999px; padding: 4px 12px; font-size: .9rem; }
.hero { width: 100%; max-height: 45svh; object-fit: cover; border-radius: var(--radius); margin: 8px 0; }
.description p { margin: 6px 0; }
.columns { display: grid; gap: 0 32px; }
@media (min-width: 760px) { .columns { grid-template-columns: minmax(260px, 2fr) 3fr; } }

.ingredients { list-style: none; margin: 0; padding: 0; }
.ingredients label {
  display: flex; gap: 12px; align-items: flex-start; padding: 9px 0;
  border-bottom: 1px solid var(--line); cursor: pointer;
}
.ingredients input {
  appearance: none; -webkit-appearance: none; flex: none;
  width: 24px; height: 24px; margin: 2px 0 0; border-radius: 7px;
  border: 2px solid var(--muted); background: var(--surface);
}
.ingredients input:checked { background: var(--accent); border-color: var(--accent); }
.ingredients input:checked + span { color: var(--done); text-decoration: line-through; }

.steps { list-style: none; counter-reset: step; margin: 0; padding: 0; }
.steps li {
  counter-increment: step; position: relative;
  padding: 14px 14px 14px 58px; margin: 0 0 10px;
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
  cursor: pointer;
}
.steps li::before {
  content: counter(step); position: absolute; left: 14px; top: 12px;
  width: 32px; height: 32px; border-radius: 50%;
  display: grid; place-items: center;
  background: var(--accent); color: var(--surface); font-weight: 700; font-size: .95rem;
}
.steps li.done { color: var(--done); }
.steps li.done::before { background: var(--done); content: "✓"; }

.notes p, .notes li { margin: 6px 0; }
.note-body p { margin: 6px 0; }
.reset {
  font: inherit; font-size: .9rem; padding: 10px 16px; min-height: 44px; margin-top: 18px;
  border-radius: var(--radius); border: 1px solid var(--line);
  background: var(--surface); color: var(--text);
}
footer { margin-top: 28px; font-size: .85rem; color: var(--muted); }
`;
