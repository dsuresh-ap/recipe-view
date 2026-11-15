import { Hono } from "hono";
import { buildRecipeJsonLd } from "../parser/jsonld.js";
import type { RecipeStore } from "../store.js";
import { indexPage, notFoundPage, recipePage } from "./views.js";

export function createApp(store: RecipeStore): Hono {
  const app = new Hono();

  app.use(async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
  });

  app.get("/", async (c) => {
    const recipes = await store.list();
    c.header("Cache-Control", "no-cache");
    return c.html(indexPage(recipes, store.exportedAt, store.folder));
  });

  app.get("/r/:slug", async (c) => {
    const r = await store.get(c.req.param("slug"));
    if (!r) return c.html(notFoundPage(), 404);
    const origin = new URL(c.req.url).origin;
    const jsonLd = r.isRecipe
      ? buildRecipeJsonLd(r.recipe, {
          url: `${origin}/r/${r.slug}`,
          imageUrls: r.imagePaths.map((p) => new URL(p, origin).href),
          created: r.meta.created,
          modified: r.meta.modified,
        })
      : undefined;
    c.header("Cache-Control", "no-cache");
    return c.html(recipePage(r, jsonLd, store.exportedAt));
  });

  app.get("/images/:slug/:n", async (c) => {
    const r = await store.get(c.req.param("slug"));
    const image = r?.images[Number(c.req.param("n"))];
    if (!image) return c.notFound();
    c.header("Content-Type", image.type);
    c.header("Cache-Control", "public, max-age=86400");
    return c.body(new Uint8Array(image.data));
  });

  app.get("/healthz", async (c) => {
    const recipes = await store.list();
    return c.json({ ok: true, recipes: recipes.length, exportedAt: store.exportedAt ?? null });
  });

  app.notFound((c) => c.html(notFoundPage(), 404));
  return app;
}
