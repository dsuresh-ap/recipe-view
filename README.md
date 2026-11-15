# recipe-view

Show your **Apple Notes recipes on Apple HomeView**, or any browser on your home network.

HomeView has Safari but no Notes app. However, Safari on HomeView has a cooking mode: when a web page contains a recipe in [schema.org `Recipe`](https://schema.org/Recipe) format, Safari offers **Start Cooking**, a step-by-step view with tap-to-start timers and Siri step navigation ([WebKit: Safari on Apple HomeView](https://webkit.org/blog/18608/safari-on-apple-homeview/)).

recipe-view turns a folder in Apple Notes into a small local website where every note is a recipe page in that format.

```
Apple Notes "Recipes" folder ──► exporter (macOS) ──► export folder ──► web server ──► HomeView Safari
                                                     ~/.recipe-view    :4242          http://your-mac.local:4242
```

- **Reads the notes you already have.** No special format is needed: it understands headings, bullet and numbered lists, `•`/`-`/`1.` typed as text, Markdown-style `## Ingredients`, ingredient groups ("For the marinade"), and serving sizes.
- **Built for a 7" kitchen screen.** Large text, light and dark mode, tick off ingredients and steps as you go.
- **Runs on your network only.** Nothing is uploaded anywhere.
- **Runs directly or in Docker.**

## Requirements

- A Mac that is signed in to the iCloud account that has your notes, with Notes syncing. An always-on Mac mini is ideal.
- Node.js 20 or newer (`brew install node`), or Docker for the server part.
- Your recipes in one Notes folder. The default folder name is `Recipes`.

## Quick start (run directly)

```bash
git clone https://github.com/dsuresh-ap/recipe-view.git
cd recipe-view
npm install
npm run build
node dist/cli.js
```

The first time it reads Notes, macOS asks whether to allow the app to control **Notes**. Click **Allow**. If you miss the prompt, go to **System Settings → Privacy & Security → Automation**.

The terminal prints the address to open, for example:

```
Open on your HomeView: http://Mac-mini.local:4242
```

Open that address in Safari on HomeView. Then open any recipe and tap **Start Cooking**.

### Keep it running in the background

```bash
node dist/cli.js install-agent
```

This installs a launchd agent that starts recipe-view at login and restarts it if it stops. Logs go to `~/Library/Logs/recipe-view.log`. To remove it, run `node dist/cli.js uninstall-agent`.

## Run with Docker

Docker on macOS runs containers in a Linux virtual machine, and a container **cannot read Apple Notes**. So the work is split:

1. The **exporter** runs natively on the Mac and writes your notes to `~/.recipe-view` every 5 minutes.
2. The **server** runs in Docker and serves that folder (mounted read-only).

```bash
# 1. On the Mac: build once, then install the exporter as a background agent
npm install && npm run build
node dist/cli.js export            # run once in Terminal to grant Notes access
node dist/cli.js install-agent export

# 2. Start the server
docker compose up -d
```

`docker-compose.yml` uses the published image `ghcr.io/dsuresh-ap/recipe-view`, or builds it locally with `docker compose up -d --build`. To change the port or the export folder, set `RECIPE_VIEW_PORT` or `RECIPE_VIEW_DATA` in a `.env` file next to the compose file.

## Options

| Flag | Environment variable | Default | |
|---|---|---|---|
| `--folder` | `RECIPE_VIEW_FOLDER` | `Recipes` | Notes folder to read (in any account) |
| `--data` | `RECIPE_VIEW_DATA` | `~/.recipe-view` | Export folder |
| `--port` | `RECIPE_VIEW_PORT` | `4242` | |
| `--host` | `RECIPE_VIEW_HOST` | `0.0.0.0` | |
| `--interval` | `RECIPE_VIEW_INTERVAL` | `300` | Seconds between Notes syncs |
| `--no-export` | `RECIPE_VIEW_NO_EXPORT=1` | off | Only serve the export folder |

Commands: `serve` (default), `export [--watch]`, `install-agent [serve|export]`, `uninstall-agent`. Run `node dist/cli.js --help` for details.

## Writing notes that convert well

Any of these layouts works:

```
Lemon Garlic Pasta              ← the first line is always the title
Serves 2                        ← "Serves 4", "Makes 12 cookies" become the yield
A quick weeknight pasta.        ← text before the ingredients is the description

Ingredients                     ← or "What you'll need"; a bulleted list also works without it
• 200 g spaghetti
• 2 tbsp olive oil

Steps                           ← or Method, Instructions, Directions
1. Boil the pasta for 9 minutes.
2. Toss with the oil.

Notes                           ← or Tips, Storage, Variations
Add chilli flakes for heat.
```

- Group ingredients with a short label line such as `For the sauce:` or a bold `Dry`.
- `Prep time: 10 min` and `Cook time: 1 hr` become recipe times.
- Photos in the note appear on the recipe page.
- `#tags` at the end of a note become keywords.
- Notes with no ingredient or step lists are still shown, as plain notes without recipe data.

## How it works

| Piece | Tech | File |
|---|---|---|
| Notes exporter | JXA (`osascript -l JavaScript`), Apple's supported scripting interface to Notes | `src/notes/` |
| Note → recipe parser | cheerio and a line-based state machine | `src/parser/recipe.ts` |
| schema.org JSON-LD | `Recipe` with `HowToStep` instructions | `src/parser/jsonld.ts` |
| Web server | Hono with server-rendered HTML and no client framework | `src/web/` |
| Background service | launchd LaunchAgent | `src/cli.ts` |
| Container | `node:24-alpine`, multi-arch image on GHCR | `Dockerfile` |

The export folder (`index.json` plus one HTML file per note) is the contract between the exporter and the server. The server re-reads it when it changes, so there's no restart after a sync.

## Development

```bash
npm install
npm run dev        # run from source with tsx
npm test           # vitest
npm run typecheck
```

When the parser gets a note wrong, the fix usually belongs in `src/parser/recipe.ts`. Add a test to `test/parser.test.ts` with a minimal version of that note's HTML. To see a note's HTML, open `~/.recipe-view/notes/` after a sync.

## Limitations

- The Mac must be on and logged in, because Notes only runs inside a user session.
- Locked notes can't be read.
- Apple hasn't published which recipe fields HomeView requires. This project follows WebKit's example markup.

## License

MIT
