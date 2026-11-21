import { execFile } from "node:child_process";

/** A note as read from the Notes app. `body` is the HTML Notes stores for it. */
export interface RawNote {
  id: string;
  name: string;
  /**
   * Sub-folder path below the folder that was asked for, joined with " / "
   * (for example "Desserts" or "Desserts / Cakes"). Empty for notes directly
   * in that folder.
   */
  folder: string;
  account: string;
  created: string;
  modified: string;
  body: string;
}

/** Separator between sub-folder names in RawNote.folder and NoteMeta.folder. */
export const FOLDER_SEPARATOR = " / ";

/**
 * JXA script run by `osascript -l JavaScript`. It reads every note in every
 * folder with the given name (across all accounts), including the notes in
 * all of its sub-folders, using bulk property reads, which are much faster
 * than reading notes one at a time.
 *
 * `account.folders` lists every folder in the account, nested ones included,
 * but `folder.notes` only holds a folder's direct notes, so sub-folders are
 * walked through `folder.folders`.
 */
const SCRIPT = String.raw`
function run(argv) {
  const folderName = argv[0];
  const separator = argv[1];
  const Notes = Application("Notes");
  const out = [];
  const seenFolders = {};

  function readFolder(folder, path, accountName) {
    const folderId = folder.id();
    if (seenFolders[folderId]) return;
    seenFolders[folderId] = true;

    const notes = folder.notes;
    const ids = notes.id();
    if (ids.length > 0) {
      const names = notes.name();
      const bodies = notes.body();
      const created = notes.creationDate();
      const modified = notes.modificationDate();
      for (let i = 0; i < ids.length; i++) {
        out.push({
          id: ids[i],
          name: names[i],
          folder: path.join(separator),
          account: accountName,
          created: created[i].toISOString(),
          modified: modified[i].toISOString(),
          body: bodies[i],
        });
      }
    }
    for (const child of folder.folders()) {
      readFolder(child, path.concat([child.name()]), accountName);
    }
  }

  for (const account of Notes.accounts()) {
    const accountName = account.name();
    for (const folder of account.folders.whose({ name: folderName })()) {
      readFolder(folder, [], accountName);
    }
  }
  return JSON.stringify(out);
}
`;

export class NotesAccessError extends Error {}

/** Reads all notes in the named Notes folder and its sub-folders. macOS only. */
export function readNotesFolder(folderName: string): Promise<RawNote[]> {
  if (process.platform !== "darwin") {
    return Promise.reject(
      new NotesAccessError(
        "Reading Apple Notes only works on macOS. In Docker, run the exporter on the Mac host and mount its data folder (see README).",
      ),
    );
  }
  return new Promise((resolve, reject) => {
    execFile(
      "osascript",
      ["-l", "JavaScript", "-e", SCRIPT, folderName, FOLDER_SEPARATOR],
      // Notes with photos embed them as base64, so output can be large.
      { maxBuffer: 512 * 1024 * 1024, timeout: 5 * 60 * 1000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(explainError(stderr || error.message));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as RawNote[]);
        } catch {
          reject(new Error(`Could not read the output from Notes: ${stdout.slice(0, 200)}`));
        }
      },
    );
  });
}

function explainError(message: string): Error {
  if (/-1743|not authori[sz]ed/i.test(message)) {
    return new NotesAccessError(
      "macOS blocked access to Notes. Open System Settings → Privacy & Security → Automation and allow this app (Terminal, or node) to control Notes, then try again.",
    );
  }
  if (/-1712|timed out/i.test(message)) {
    return new NotesAccessError(
      "Notes didn't answer in time. macOS may be waiting for you to allow access to Notes in a permission prompt; click Allow and the next sync will work.",
    );
  }
  if (/-1728|can.t get/i.test(message)) {
    return new NotesAccessError(`Notes returned an error: ${message.trim()}`);
  }
  return new Error(`osascript failed: ${message.trim()}`);
}
