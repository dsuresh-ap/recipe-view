import { execFile } from "node:child_process";

/** A note as read from the Notes app. `body` is the HTML Notes stores for it. */
export interface RawNote {
  id: string;
  name: string;
  folder: string;
  account: string;
  created: string;
  modified: string;
  body: string;
}

/**
 * JXA script run by `osascript -l JavaScript`. It reads every note in every
 * folder with the given name (across all accounts) using bulk property reads,
 * which are much faster than reading notes one at a time.
 */
const SCRIPT = String.raw`
function run(argv) {
  const folderName = argv[0];
  const Notes = Application("Notes");
  const out = [];
  const accounts = Notes.accounts();
  for (const account of accounts) {
    const accountName = account.name();
    const folders = account.folders.whose({ name: folderName })();
    for (const folder of folders) {
      const notes = folder.notes;
      const ids = notes.id();
      if (ids.length === 0) continue;
      const names = notes.name();
      const bodies = notes.body();
      const created = notes.creationDate();
      const modified = notes.modificationDate();
      for (let i = 0; i < ids.length; i++) {
        out.push({
          id: ids[i],
          name: names[i],
          folder: folderName,
          account: accountName,
          created: created[i].toISOString(),
          modified: modified[i].toISOString(),
          body: bodies[i],
        });
      }
    }
  }
  return JSON.stringify(out);
}
`;

export class NotesAccessError extends Error {}

/** Reads all notes in the named Notes folder. macOS only. */
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
      ["-l", "JavaScript", "-e", SCRIPT, folderName],
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
