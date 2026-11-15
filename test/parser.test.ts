import { describe, expect, it } from "vitest";
import { buildRecipeJsonLd, jsonForScript } from "../src/parser/jsonld.js";
import { htmlToLines, lineText } from "../src/parser/lines.js";
import { isRecipe, parseDuration, parseRecipe, parseYield } from "../src/parser/recipe.js";

// Each fixture mirrors a layout Apple Notes actually produces.

const headingsAndLists = `
<h2><b>Lemon Garlic Pasta</b></h2>
<div>A quick weeknight pasta. Serves 2.</div>
<h2><b>Ingredients</b></h2>
<ul>
<li>200 g spaghetti</li>
<li>2 tbsp olive oil</li>
<li>3 garlic cloves, sliced</li>
</ul>
<h2><b>Steps</b></h2>
<ol>
<li>Boil the pasta for 9 minutes.</li>
<li>Warm the oil and garlic for 2 minutes.<br></li>
<li>Toss everything together.</li>
</ol>
<h2><b>Notes</b></h2>
<div>Add chilli flakes if you like heat.</div>`;

const pastedBullets = `
<h1><b>Tomato Lentil Soup</b><br></h1>
<div><b>Tomato Lentil Soup</b> — makes 4 servings</div>
<div><b>Ingredients:</b><br></div>
<div>    •    1 cup red lentils</div>
<div>    •    1 can (14 oz) tomatoes</div>
<div>    •    1 onion, diced</div>
<div><b>Instructions:</b><br></div>
<div><b>    1    Soften the onion</b> — Cook it in oil for 5 minutes.</div>
<div><b>    2    Simmer &amp season</b> — Add everything and simmer for 20 minutes.</div>`;

const plainText = `
<div>Pea Pesto Beans</div>
<div><br></div>
<div>Serves: 4</div>
<div><br></div>
<div>Ingredients</div>
<div><br></div>
<div>Pesto:</div>
<div>- 200g peas</div>
<div>- Handful basil</div>
<div><br></div>
<div>Beans:</div>
<div>- 2 tins butter beans</div>
<div><br></div>
<div>Method</div>
<div>1. Blend the pesto.</div>
<div>2. Warm the beans and stir in the pesto.</div>
<div><br></div>
<div>Serve on toast!</div>`;

const markdownInNotes = `
<h1>Red Lentil Dal</h1>
<div>Prep time: 10 min · Cook time: 1 hr 5 min</div>
<div>## Ingredients</div>
<div>- 200 g red lentils</div>
<div>- 1 tsp turmeric</div>
<div>## Steps</div>
<div>1. Rinse the lentils.</div>
<div>2. Simmer with turmeric until soft.</div>`;

const nestedListAndProse = `
<h1>Grilled Chicken</h1>
<h3>SERVES 4</h3>
<ul class="Apple-dash-list">
<li>1 kg chicken pieces</li>
<li>For the marinade</li>
<ul class="Apple-dash-list">
<li>Juice of 2 limes</li>
<li>1 tsp salt</li>
</ul>
</ul>
<div><br></div>
<div>Mix the marinade, rub it into the chicken and leave it for 1 hour.</div>
<div>Grill for 30 minutes, turning once, until cooked through.</div>
<div><br></div>
<div>#dinner #grill</div>`;

const unmarkedLists = `
<h1>Oat Breakfast</h1>
<div>OATMEAL (serves 2)</div>
<div>1 cup rolled oats</div>
<div>2 cup milk</div>
<div>Pinch of salt</div>
<div><br></div>
<div>Simmer the oats and milk until thick (about 5-7 min)</div>
<div>Take the pot off the heat and stir in the salt.</div>`;

const items = (groups: { items: { text: string }[] }[]) =>
  groups.flatMap((g) => g.items.map((i) => i.text));

describe("htmlToLines", () => {
  it("decodes the entities Notes writes without semicolons", () => {
    const lines = htmlToLines("<div>Beans &amp Greens, 6&quot pan</div>");
    expect(lineText(lines[0]!)).toBe('Beans & Greens, 6" pan');
  });

  it("strips typed bullets and numbers but keeps bold text", () => {
    const lines = htmlToLines(
      "<div><b>\t•\t</b>2 tsp oil</div><div><b>    3    Bake</b> for 20 min.</div>",
    );
    expect(lines.map((l) => [l.kind, lineText(l)])).toEqual([
      ["bullet", "2 tsp oil"],
      ["numbered", "Bake for 20 min."],
    ]);
    expect(lines[1]!.segments[0]).toEqual({ text: "Bake", bold: true });
  });

  it("does not treat a quantity as a step number", () => {
    const [line] = htmlToLines("<div>2 tins butter beans</div>");
    expect(line!.kind).toBe("para");
  });

  it("splits a div on <br> and pulls out images", () => {
    const lines = htmlToLines('<div>one<br>two</div><div><img src="data:image/png;base64,AAAA"/></div>');
    expect(lines.map((l) => l.kind)).toEqual(["para", "para", "image"]);
  });
});

describe("parseRecipe", () => {
  it("reads headings with real lists", () => {
    const r = parseRecipe(headingsAndLists);
    expect(r.title).toBe("Lemon Garlic Pasta");
    expect(r.yield).toBe("2 servings");
    expect(r.description[0]!.text).toBe("A quick weeknight pasta. Serves 2.");
    expect(items(r.ingredients)).toEqual(["200 g spaghetti", "2 tbsp olive oil", "3 garlic cloves, sliced"]);
    expect(items(r.steps)).toHaveLength(3);
    expect(r.notes.map((n) => n.text)).toEqual(["Add chilli flakes if you like heat."]);
  });

  it("reads bullets and numbers pasted as text", () => {
    const r = parseRecipe(pastedBullets);
    expect(r.title).toBe("Tomato Lentil Soup");
    expect(r.yield).toBe("4 servings");
    expect(items(r.ingredients)).toEqual(["1 cup red lentils", "1 can (14 oz) tomatoes", "1 onion, diced"]);
    expect(items(r.steps)).toEqual([
      "Soften the onion — Cook it in oil for 5 minutes.",
      "Simmer & season — Add everything and simmer for 20 minutes.",
    ]);
    expect(r.steps[0]!.items[0]!.html).toBe(
      "<strong>Soften the onion</strong> — Cook it in oil for 5 minutes.",
    );
  });

  it("reads plain text with ingredient groups and a closing note", () => {
    const r = parseRecipe(plainText);
    expect(r.yield).toBe("4 servings");
    expect(r.description).toEqual([]);
    expect(r.ingredients.map((g) => g.label)).toEqual(["Pesto", "Beans"]);
    expect(items(r.ingredients)).toEqual(["200g peas", "Handful basil", "2 tins butter beans"]);
    expect(items(r.steps)).toEqual(["Blend the pesto.", "Warm the beans and stir in the pesto."]);
    expect(r.notes.map((n) => n.text)).toEqual(["Serve on toast!"]);
  });

  it("reads Markdown headings and times", () => {
    const r = parseRecipe(markdownInNotes);
    expect(r.prepTime).toBe("PT10M");
    expect(r.cookTime).toBe("PT1H5M");
    expect(items(r.ingredients)).toEqual(["200 g red lentils", "1 tsp turmeric"]);
    expect(items(r.steps)).toHaveLength(2);
  });

  it("reads nested lists as groups and prose after them as steps", () => {
    const r = parseRecipe(nestedListAndProse);
    expect(r.yield).toBe("4 servings");
    expect(r.ingredients.map((g) => g.label)).toEqual([undefined, "For the marinade"]);
    expect(items(r.ingredients)).toEqual(["1 kg chicken pieces", "Juice of 2 limes", "1 tsp salt"]);
    expect(items(r.steps)).toHaveLength(2);
    expect(r.tags).toEqual(["dinner", "grill"]);
  });

  it("finds ingredients with no bullets at all", () => {
    const r = parseRecipe(unmarkedLists);
    expect(r.yield).toBe("2 servings");
    expect(r.ingredients[0]!.label).toBe("OATMEAL (serves 2)");
    expect(items(r.ingredients)).toEqual(["1 cup rolled oats", "2 cup milk", "Pinch of salt"]);
    expect(items(r.steps)).toHaveLength(2);
  });

  it("drops a repeated title line from the description", () => {
    const r = parseRecipe("<h1>Pea Beans</h1><div>Pea Beans</div><div>So green.</div><ul><li>1 cup peas</li></ul>");
    expect(r.description.map((d) => d.text)).toEqual(["So green."]);
  });

  it("treats a note with no lists as a plain note", () => {
    const r = parseRecipe("<div>Shopping ideas</div><div>Try the new bakery on Main St.</div>");
    expect(isRecipe(r)).toBe(false);
    expect(r.description).toHaveLength(1);
  });

  it("escapes HTML inside note text", () => {
    const r = parseRecipe("<div>T</div><ul><li>&lt;script&gt;alert(1)&lt;/script&gt;</li></ul>");
    expect(r.ingredients[0]!.items[0]!.html).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("helpers", () => {
  it.each([
    ["Serves 4", "4 servings"],
    ["SERVES 4-6", "4-6 servings"],
    ["Makes ~8 cookies.", "8 cookies"],
    ["Makes 8 small cookies", "8 small cookies"],
    ["Serves 4 as a side", "4 servings"],
    ["Servings: 2", "2 servings"],
  ])("parseYield(%s)", (input, expected) => {
    expect(parseYield(input)).toBe(expected);
  });

  it.each([
    ["15 minutes", "PT15M"],
    ["1 hr 20 min", "PT1H20M"],
    ["2 hours", "PT2H"],
    ["10-15 min", "PT15M"],
    ["soon", undefined],
  ])("parseDuration(%s)", (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });
});

describe("buildRecipeJsonLd", () => {
  it("produces a schema.org Recipe", () => {
    const r = parseRecipe(headingsAndLists);
    const ld = buildRecipeJsonLd(r, { url: "http://x/r/a", imageUrls: [] });
    expect(ld).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: "Lemon Garlic Pasta",
      recipeYield: "2 servings",
      recipeIngredient: ["200 g spaghetti", "2 tbsp olive oil", "3 garlic cloves, sliced"],
    });
    expect((ld.recipeInstructions as unknown[])[0]).toEqual({
      "@type": "HowToStep",
      text: "Boil the pasta for 9 minutes.",
    });
  });

  it("can't break out of its script tag", () => {
    expect(jsonForScript({ a: "</script><b>" })).not.toContain("</script>");
  });
});
