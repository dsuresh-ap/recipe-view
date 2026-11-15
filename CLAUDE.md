Support for viewing Apple Notes recipes on Apple HomeView (Safari's "Start Cooking" view reads schema.org Recipe JSON-LD).

- Two halves joined by the export folder (`index.json` + `notes/*.html`): the exporter (`src/notes/`, macOS only, JXA via osascript) and the server (`src/web/`, runs anywhere incl. Docker).
- Docker can't reach Apple Notes; never try to read Notes from inside the container.
- Parser changes go in `src/parser/recipe.ts` with a minimal HTML fixture test in `test/parser.test.ts`. Never commit real notes as fixtures.
- Check: `npm run typecheck && npm test`. Docker: `docker compose build`.
