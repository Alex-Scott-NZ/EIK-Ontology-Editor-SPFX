# Live testing — see UI changes in real time

Run the web part on the real test page from a local dev server, so every
source edit shows up in the browser ~15 seconds after saving. No packaging,
no app-catalog deploy.

Generic driver docs: [`tools/browser-harness/README.md`](../tools/browser-harness/README.md).
This page is the project-specific quickstart.

## One-time setup

1. **Trust the dev certificate** (kills the "Error loading debug manifests"
   dialog forever on this machine):

   ```powershell
   npx gulp trust-dev-cert
   ```

2. Node 22 is needed for `tools/browser-harness/cdp.mjs` (built-in
   WebSocket). The project itself builds on Node 20; call the 22 binary
   explicitly, e.g. `%LOCALAPPDATA%\nvm\v22.23.1\node.exe`.

## Every session

1. **Start the dev server** — the bigger heap is required; the inlined
   sql.js wasm makes webpack run out of memory on the default 4 GB:

   ```powershell
   $env:NODE_OPTIONS = "--max-old-space-size=8192"
   npx gulp serve --nobrowser
   ```

   Wait for `Finished subtask 'reload'` / `Running server`.

2. **Launch Chrome on the test page** (separate profile; stays signed in
   between sessions):

   ```powershell
   & "C:\Program Files\Google\Chrome\Application\chrome.exe" `
     --remote-debugging-port=9222 `
     --user-data-dir=$env:LOCALAPPDATA\spfx-test-chrome `
     --no-first-run --no-default-browser-check `
     "https://5pbdxb.sharepoint.com/sites/dpex-testing/SitePages/Ontology-Editor.aspx?debug=true&noredir=true&debugManifestsFile=https%3A%2F%2Flocalhost%3A4321%2Ftemp%2Fbuild%2Fmanifests.js"
   ```

   (The same URL is in `config/serve.json` → `initialPage`. The
   `--remote-debugging-port` flag is only needed when Claude drives the
   browser; launching Chrome normally with that URL works too.)

3. **Click "Load debug scripts"** in the yellow consent dialog. This is
   asked once per browser session (it's sessionStorage), every time you
   open a fresh window.

4. Work normally. Saving any `.ts`/`.tsx`/`.scss` file recompiles and the
   page auto-refreshes via LiveReload.

## When it goes wrong

| Symptom | Cause | Fix |
| --- | --- | --- |
| **"Error loading debug manifests … Script error for https://localhost:4321/…"** | Dev server not running (check the terminal — see OOM below), or the dev cert isn't trusted | Start the server / run `npx gulp trust-dev-cert`, then Dismiss + F5 |
| Dev server dies with **"JavaScript heap out of memory"** during webpack | Default 4 GB Node heap; the base64-inlined wasm blows past it | Restart with `NODE_OPTIONS=--max-old-space-size=8192` (step 1) |
| Page loads but changes don't appear | Page is running the **app-catalog** bundle, not localhost — happens when local `package.json` version ≠ deployed version | Match the versions, restart the server. Verify with the recipe below |
| Consent dialog never appeared and the web part won't load | It appeared and was dismissed with "Don't load" | F5 and click "Load debug scripts" |

Verify which bundle the page is actually running:

```js
// paste in DevTools console — localhost:4321 = debug, sharepoint.com = catalog
performance.getEntriesByType('resource')
  .filter(r => /ontology-editor-web-part/.test(r.name)).map(r => r.name)
```
