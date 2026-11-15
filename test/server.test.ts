import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeExport } from "../src/notes/exporter.js";
import { RecipeStore, slugify } from "../src/store.js";
import { createApp } from "../src/web/server.js";

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const note = (id: string, name: string, body: string, created = "2026-01-01T00:00:00.000Z") => ({
  id,
  name,
  folder: "Recipes",
  account: "iCloud",
  created,
  modified: created,
  body,
});

let dir: string;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "recipe-view-"));
  await writeExport(dir, "Recipes", [
    note(
      "a",
      "Chia Jam",
      `<h2>Chia Jam</h2><div><img src="data:image/png;base64,${PNG_1PX}"/></div><h2>Ingredients</h2><ul><li>2 cups berries</li><li>2 tbsp chia</li></ul><h2>Steps</h2><ol><li>Simmer the berries.</li><li>Stir in the chia.</li></ol>`,
    ),
    note("b", "Party ideas", "<div>Party ideas</div><div>Ask Sam about the date.</div>"),
    note("c", "Chia Jam", "<div>Chia Jam</div><ul><li>1 cup berries</li></ul>", "2026-02-01T00:00:00.000Z"),
  ]);
  app = createApp(new RecipeStore(dir, 0));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("server", () => {
  it("lists every note on the index page", async () => {
    const res = await app.request("http://kitchen.local/");
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain('href="/r/chia-jam"');
    expect(body).toContain('href="/r/chia-jam-2"');
    expect(body).toContain('href="/r/party-ideas"');
  });

  it("embeds schema.org Recipe JSON-LD on recipe pages", async () => {
    const res = await app.request("http://kitchen.local/r/chia-jam");
    const body = await res.text();
    const json = body.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)?.[1];
    expect(json).toBeDefined();
    const ld = JSON.parse(json!);
    expect(ld["@type"]).toBe("Recipe");
    expect(ld.name).toBe("Chia Jam");
    expect(ld.recipeIngredient).toEqual(["2 cups berries", "2 tbsp chia"]);
    expect(ld.recipeInstructions).toHaveLength(2);
    expect(ld.image).toEqual(["http://kitchen.local/images/chia-jam/0"]);
    expect(body).not.toContain("base64");
  });

  it("serves embedded images", async () => {
    const res = await app.request("http://kitchen.local/images/chia-jam/0");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("shows plain notes without recipe data", async () => {
    const body = await (await app.request("http://kitchen.local/r/party-ideas")).text();
    expect(body).toContain("Ask Sam about the date.");
    expect(body).not.toContain("application/ld+json");
  });

  it("returns 404 for unknown recipes", async () => {
    expect((await app.request("http://kitchen.local/r/nope")).status).toBe(404);
  });

  it("reports health", async () => {
    const res = await app.request("http://kitchen.local/healthz");
    expect(await res.json()).toMatchObject({ ok: true, recipes: 3 });
  });
});

describe("export folder", () => {
  it("removes notes that left the folder and keeps unchanged files", async () => {
    const result = await writeExport(dir, "Recipes", [note("a", "Chia Jam", "<div>Chia Jam</div>")]);
    expect(result).toMatchObject({ total: 1, removed: 2 });
  });
});

describe("slugify", () => {
  it.each([
    ["Crispy Butter Bean & Mushroom Skillet", "crispy-butter-bean-and-mushroom-skillet"],
    ["Crème Brûlée!", "creme-brulee"],
    ["🍳", "recipe"],
  ])("%s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});
