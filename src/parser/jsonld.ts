import type { Recipe } from "./recipe.js";

export interface JsonLdOptions {
  url: string;
  imageUrls: string[];
  created?: string;
  modified?: string;
}

/**
 * Builds the schema.org Recipe object that Safari reads to offer its
 * "Start Cooking" view. Steps are flattened to HowToStep, the shape shown in
 * WebKit's HomeView guidance, and ingredients to a flat list of strings
 * (group labels such as "For the marinade" only appear on the page itself).
 */
export function buildRecipeJsonLd(recipe: Recipe, opts: JsonLdOptions): Record<string, unknown> {
  const description = recipe.description.map((d) => d.text).join(" ").trim();
  const ingredients = recipe.ingredients.flatMap((g) => g.items.map((i) => i.text));
  const steps = recipe.steps.flatMap((g) =>
    g.items.map((i) => ({ "@type": "HowToStep", text: i.text })),
  );

  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: recipe.title,
    url: opts.url,
  };
  if (description) data.description = description;
  if (opts.imageUrls.length) data.image = opts.imageUrls;
  if (recipe.prepTime) data.prepTime = recipe.prepTime;
  if (recipe.cookTime) data.cookTime = recipe.cookTime;
  if (recipe.totalTime) data.totalTime = recipe.totalTime;
  if (recipe.yield) data.recipeYield = recipe.yield;
  if (recipe.tags.length) data.keywords = recipe.tags.join(", ");
  if (opts.created) data.datePublished = opts.created;
  if (opts.modified) data.dateModified = opts.modified;
  data.recipeIngredient = ingredients;
  data.recipeInstructions = steps;
  return data;
}

/** Serializes JSON for a <script> tag without letting "</script>" end it early. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replaceAll(String.fromCharCode(0x2028), "\\u2028")
    .replaceAll(String.fromCharCode(0x2029), "\\u2029");
}
