// Capture a structured + visual snapshot of the Ontology Viewer for a list of
// search terms, so the same run can be repeated after a data-layer change and
// diffed. Usage:
//   node capture-viewer-baseline.mjs <outDir> <label> [term1] [term2] ...
// Writes <outDir>/<label>.json and <outDir>/<label>-<term>.png per term.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const PORT = 9222;
const [, , outDir, label, ...terms] = process.argv;
const TERMS = terms.length ? terms : ["DPEx"];
mkdirSync(outDir, { recursive: true });

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page =
  list.find((t) => t.type === "page" && /Ontology-Viewer/i.test(t.url)) ||
  list.find((t) => t.type === "page" && /sharepoint\.com/.test(t.url));
if (!page) { console.error("no viewer page target"); process.exit(1); }

const ws = await new Promise((res, rej) => {
  const w = new WebSocket(page.webSocketDebuggerUrl);
  w.onopen = () => res(w); w.onerror = () => rej(new Error("ws error"));
});
let msgId = 0;
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++msgId;
  const onMsg = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id === id) {
      ws.removeEventListener("message", onMsg);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    }
  };
  ws.addEventListener("message", onMsg);
  ws.send(JSON.stringify({ id, method, params }));
});
const evalJs = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.result?.description || "eval failed");
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SEARCH = "input[placeholder*=ontology]";

// Structured read of whatever the viewer is currently showing.
const READ_STATE = `(() => {
  const items = [...document.querySelectorAll('[class*=searchResultItem]')];
  const countEl = [...document.querySelectorAll('*')].find(e =>
    e.children.length === 0 && /results? for/i.test(e.textContent));
  const panel = document.querySelector('[class*=detailPanel], [class*=termDetails], [class*=ontologyBrowser]');
  const bodyText = document.body.innerText;
  const vi = bodyText.indexOf('Ontology viewer');
  const region = vi >= 0 ? bodyText.slice(vi, vi + 2500) : bodyText.slice(0, 2500);
  // Scope to the graph section: the page is full of 0x0 SharePoint chrome SVGs.
  const section = document.querySelector('[class*=graphSection]');
  const svg = section ? section.querySelector('svg') : null;
  const svgLabels = svg ? [...svg.querySelectorAll('text')].map(t => t.textContent.trim()).filter(Boolean) : [];
  return {
    resultCountText: countEl ? countEl.textContent.trim() : null,
    topResults: items.slice(0, 5).map(e => e.innerText.replace(/\\n+/g, ' | ').trim()),
    graphNodeCount: svg ? svg.querySelectorAll('circle').length : 0,
    graphEdgeLabels: svgLabels.filter(t => !/\\(L\\d+\\)$/.test(t)).slice(0, 15),
    graphNodeLabels: svgLabels.filter(t => /\\(L\\d+\\)$/.test(t)).slice(0, 20),
    regionText: region.replace(/\\n{2,}/g, '\\n').slice(0, 1200)
  };
})()`;

const results = {};
for (const term of TERMS) {
  // Clear then type via trusted input so React sees it.
  await evalJs(`(() => { const el = document.querySelector(${JSON.stringify(SEARCH)}); el.focus(); el.select(); return 1; })()`);
  await send("Input.insertText", { text: term });
  await sleep(2500);
  const afterSearch = await evalJs(READ_STATE);

  // Click the first result to open detail + graph.
  const clicked = await evalJs(`(() => {
    const first = document.querySelector('[class*=searchResultItem]');
    if (!first) return 'no results';
    first.click();
    return 'clicked';
  })()`);
  await sleep(3500);

  // The graph is behind a "Show Graph" toggle — open it so the snapshot
  // covers the visualisation, not just the detail panel.
  await evalJs(`(() => {
    const g = [...document.querySelectorAll('button')].find(b => /show graph/i.test(b.textContent));
    if (g) { g.click(); return 'graph shown'; }
    return 'no graph button (may already be open)';
  })()`);
  await sleep(3500);

  const afterSelect = await evalJs(READ_STATE);

  const shot = await send("Page.captureScreenshot", { format: "png" });
  const file = join(outDir, `${label}-${term.replace(/[^A-Za-z0-9]+/g, "_")}.png`);
  writeFileSync(file, Buffer.from(shot.data, "base64"));

  results[term] = {
    searchResultCount: afterSearch.resultCountText,
    topResults: afterSearch.topResults,
    selected: clicked,
    afterSelect: {
      graphNodeCount: afterSelect.graphNodeCount,
      graphLabels: afterSelect.graphLabels,
      detail: afterSelect.regionText
    },
    screenshot: file
  };
  console.log(`${term}: ${afterSearch.resultCountText || "(no count)"} | graph nodes ${afterSelect.graphNodeCount} | ${file}`);
}

const jsonPath = join(outDir, `${label}.json`);
writeFileSync(jsonPath, JSON.stringify(results, null, 2));
console.log("\nwrote", jsonPath);
ws.close();
