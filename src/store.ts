import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { readIndex, type NoteMeta } from "./notes/exporter.js";
import { isRecipe, parseRecipe, type Recipe } from "./parser/recipe.js";

export interface StoredImage {
  type: string;
  data: Buffer;
}

export interface StoredRecipe {
  slug: string;
  meta: NoteMeta;
  recipe: Recipe;
  /** False for notes with no ingredients or steps; they render as plain notes. */
  isRecipe: boolean;
  /** Embedded images, served at /images/<slug>/<index>. */
  images: StoredImage[];
  /** Image paths or URLs, in the same order as recipe.images. */
  imagePaths: string[];
}

export function slugify(text: string): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
  return slug || "recipe";
}

const DATA_URI_RE = /^data:([\w/+.-]+);base64,(.*)$/s;

/**
 * Loads and parses the export folder written by the exporter. It re-reads the
 * folder when index.json changes, so the server picks up new exports without a
 * restart (including when the folder is a Docker bind mount).
 */
export class RecipeStore {
  private recipes: StoredRecipe[] = [];
  private bySlug = new Map<string, StoredRecipe>();
  private cache = new Map<string, { modified: string; stored: Omit<StoredRecipe, "slug"> }>();
  private indexMtime = -1;
  private lastCheck = 0;
  private loading: Promise<void> | undefined;
  exportedAt: string | undefined;
  folder: string | undefined;

  constructor(
    readonly dataDir: string,
    private readonly checkEveryMs = 2000,
  ) {}

  async list(): Promise<StoredRecipe[]> {
    await this.ensureFresh();
    return this.recipes;
  }

  async get(slug: string): Promise<StoredRecipe | undefined> {
    await this.ensureFresh();
    return this.bySlug.get(slug);
  }

  private async ensureFresh(): Promise<void> {
    const now = Date.now();
    if (now - this.lastCheck < this.checkEveryMs && this.indexMtime !== -1) return;
    this.lastCheck = now;
    this.loading ??= this.reloadIfChanged().finally(() => (this.loading = undefined));
    await this.loading;
  }

  private async reloadIfChanged(): Promise<void> {
    let mtime: number;
    try {
      mtime = (await stat(path.join(this.dataDir, "index.json"))).mtimeMs;
    } catch {
      this.recipes = [];
      this.bySlug.clear();
      this.indexMtime = 0;
      return;
    }
    if (mtime === this.indexMtime) return;

    const index = await readIndex(this.dataDir);
    if (!index) return;
    this.exportedAt = index.exportedAt;
    this.folder = index.folder;

    const loaded: Omit<StoredRecipe, "slug">[] = [];
    for (const meta of index.notes) {
      const cached = this.cache.get(meta.id);
      if (cached && cached.modified === meta.modified) {
        loaded.push({ ...cached.stored, meta });
        continue;
      }
      let html: string;
      try {
        html = await readFile(path.join(this.dataDir, "notes", meta.file), "utf8");
      } catch {
        continue; // The exporter may be mid-write; it'll be there next time.
      }
      const stored = load(meta, html);
      this.cache.set(meta.id, { modified: meta.modified, stored });
      loaded.push(stored);
    }

    // Stable slugs: when two notes share a title, the older one keeps the plain slug.
    const byAge = [...loaded].sort((a, b) => a.meta.created.localeCompare(b.meta.created));
    const used = new Set<string>();
    const slugs = new Map<string, string>();
    for (const item of byAge) {
      const base = slugify(item.recipe.title);
      let slug = base;
      for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
      used.add(slug);
      slugs.set(item.meta.id, slug);
    }

    this.recipes = loaded
      .map((item) => {
        const slug = slugs.get(item.meta.id)!;
        return { ...item, slug, imagePaths: item.imagePaths.map((p) => p.replace("{slug}", slug)) };
      })
      .sort((a, b) => b.meta.modified.localeCompare(a.meta.modified));
    this.bySlug = new Map(this.recipes.map((r) => [r.slug, r]));
    const live = new Set(index.notes.map((n) => n.id));
    for (const id of this.cache.keys()) if (!live.has(id)) this.cache.delete(id);
    this.indexMtime = mtime;
  }
}

function load(meta: NoteMeta, html: string): Omit<StoredRecipe, "slug"> {
  const recipe = parseRecipe(html, meta.name);
  const images: StoredImage[] = [];
  const imagePaths: string[] = [];
  for (const src of recipe.images) {
    const m = src.match(DATA_URI_RE);
    if (m) {
      imagePaths.push(`/images/{slug}/${images.length}`);
      images.push({ type: m[1]!, data: Buffer.from(m[2]!, "base64") });
    } else if (/^https?:\/\//i.test(src)) {
      imagePaths.push(src);
    }
  }
  // Drop the base64 copies now that they're decoded; they can be megabytes each.
  recipe.images = [];
  return { meta, recipe, isRecipe: isRecipe(recipe), images, imagePaths };
}
