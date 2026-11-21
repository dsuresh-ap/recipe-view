import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { readNotesFolder, type RawNote } from "./jxa.js";

/**
 * The export folder is the contract between the exporter (which must run on
 * macOS) and the server (which can run anywhere, including Docker):
 *
 *   <data>/index.json        list of NoteMeta, newest first
 *   <data>/notes/<file>.html the HTML body of each note, exactly as Notes stores it
 */
export interface NoteMeta {
  id: string;
  name: string;
  /**
   * Sub-folder path below the exported folder (see RawNote.folder); empty for
   * notes directly in it. Missing in exports made before sub-folder support.
   */
  folder?: string;
  account: string;
  created: string;
  modified: string;
  file: string;
}

export interface ExportIndex {
  version: 1;
  folder: string;
  exportedAt: string;
  notes: NoteMeta[];
}

export interface ExportResult {
  total: number;
  written: number;
  removed: number;
}

export function noteFileName(id: string): string {
  return `${createHash("sha256").update(id).digest("hex").slice(0, 16)}.html`;
}

export async function readIndex(dataDir: string): Promise<ExportIndex | undefined> {
  try {
    return JSON.parse(await readFile(path.join(dataDir, "index.json"), "utf8")) as ExportIndex;
  } catch {
    return undefined;
  }
}

/** Writes via a temp file + rename so the server never reads a half-written file. */
async function writeAtomic(file: string, contents: string): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, contents);
  await rename(tmp, file);
}

export async function writeExport(
  dataDir: string,
  folder: string,
  notes: RawNote[],
): Promise<ExportResult> {
  const notesDir = path.join(dataDir, "notes");
  await mkdir(notesDir, { recursive: true });

  const previous = await readIndex(dataDir);
  const previousModified = new Map(previous?.notes.map((n) => [n.id, n.modified]));
  const existingFiles = new Set(await readdir(notesDir));

  const metas: NoteMeta[] = [];
  let written = 0;
  for (const note of notes) {
    const file = noteFileName(note.id);
    const unchanged = previousModified.get(note.id) === note.modified && existingFiles.has(file);
    if (!unchanged) {
      await writeAtomic(path.join(notesDir, file), note.body);
      written++;
    }
    existingFiles.delete(file);
    metas.push({
      id: note.id,
      name: note.name,
      folder: note.folder,
      account: note.account,
      created: note.created,
      modified: note.modified,
      file,
    });
  }

  // Anything left over belongs to a note that was deleted or moved out of the folder.
  let removed = 0;
  for (const stale of existingFiles) {
    if (!stale.endsWith(".html")) continue;
    await rm(path.join(notesDir, stale), { force: true });
    removed++;
  }

  metas.sort((a, b) => b.modified.localeCompare(a.modified));
  const index: ExportIndex = {
    version: 1,
    folder,
    exportedAt: new Date().toISOString(),
    notes: metas,
  };
  await writeAtomic(path.join(dataDir, "index.json"), JSON.stringify(index, null, 2));
  return { total: metas.length, written, removed };
}

export async function exportNotes(dataDir: string, folder: string): Promise<ExportResult> {
  const notes = await readNotesFolder(folder);
  return writeExport(dataDir, folder, notes);
}
