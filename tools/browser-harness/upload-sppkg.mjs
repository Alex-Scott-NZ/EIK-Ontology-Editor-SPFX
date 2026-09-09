// Upload + deploy an .sppkg to a SharePoint app catalog via the ALM REST API,
// executed inside the signed-in SharePoint page (user's own session/cookies).
//
// Usage:
//   node upload-sppkg.mjs <sppkg> <catalog site url> [--skip-feature-deploy] [--site-collection]
//
// --site-collection targets that site's OWN app catalog
// (/_api/web/sitecollectionappcatalog) instead of the tenant-wide one. Which
// you need depends on where the solution already lives — check first, or you
// will deploy a second copy into the wrong scope.
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const PORT = 9222;
const [, , sppkgPath, catalogUrl] = process.argv;
const skipFeature = process.argv.includes("--skip-feature-deploy");
const siteCollection = process.argv.includes("--site-collection");
// Solution name as it appears in AvailableApps (package-solution.json solution.name).
const nameIdx = process.argv.indexOf("--name");
const solutionName = nameIdx > -1 ? process.argv[nameIdx + 1] : "";
const CATALOG = siteCollection ? "sitecollectionappcatalog" : "tenantappcatalog";
if (!sppkgPath || !catalogUrl) { console.error("usage: node upload-sppkg.mjs <sppkg> <catalogUrl> [--skip-feature-deploy] [--site-collection]"); process.exit(1); }

const bytes = readFileSync(sppkgPath);
const b64 = bytes.toString("base64");
const fileName = basename(sppkgPath);

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page" && /sharepoint\.com/.test(t.url));
if (!page) { console.error("no signed-in SharePoint page target"); process.exit(1); }

const ws = await new Promise((res, rej) => {
  const w = new WebSocket(page.webSocketDebuggerUrl);
  w.onopen = () => res(w);
  w.onerror = () => rej(new Error("ws error"));
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

const expr = `
(async () => {
  const catalog = ${JSON.stringify(catalogUrl)};
  const b64 = ${JSON.stringify(b64)};
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);

  const digest = await fetch(catalog + '/_api/contextinfo', {
    method: 'POST', headers: { accept: 'application/json;odata=verbose' }
  }).then(r => r.json()).then(j => j.d.GetContextWebInformation.FormDigestValue);

  const up = await fetch(
    catalog + "/_api/web/" + ${JSON.stringify(CATALOG)} + "/Add(overwrite=true, url='" + ${JSON.stringify(fileName)} + "')",
    { method: 'POST', headers: { accept: 'application/json', 'X-RequestDigest': digest }, body: buf }
  );
  const upJson = await up.json().catch(() => ({}));
  if (!up.ok) return { step: 'upload', status: up.status, detail: JSON.stringify(upJson).slice(0, 400) };
  const productId = (upJson.UniqueId || (upJson.d && upJson.d.UniqueId)) || null;

  // Deploy by list-item lookup of the app's product id via AvailableApps.
  const apps = await fetch(catalog + '/_api/web/' + ${JSON.stringify(CATALOG)} + '/AvailableApps', {
    headers: { accept: 'application/json' }
  }).then(r => r.json());
  const app = (apps.value || []).find(a => (a.Title || '').toLowerCase().includes('ontology') && a.ProductId);
  const wanted = ${JSON.stringify(solutionName.toLowerCase())};
  const target = (wanted && (apps.value || []).find(a => (a.Title || '').toLowerCase() === wanted)) || app;
  if (!target) return { step: 'find', status: 'app not found in AvailableApps' };

  const dep = await fetch(
    catalog + "/_api/web/" + ${JSON.stringify(CATALOG)} + "/AvailableApps/GetById('" + target.ID + "')/Deploy",
    {
      method: 'POST',
      headers: {
        accept: 'application/json', 'X-RequestDigest': digest,
        'content-type': 'application/json;odata=nometadata'
      },
      body: JSON.stringify({ skipFeatureDeployment: ${skipFeature} })
    }
  );
  const depText = await dep.text();
  return {
    step: 'done', uploadedUniqueId: productId,
    app: { ID: target.ID, Title: target.Title, AppCatalogVersion: target.AppCatalogVersion, Deployed: target.Deployed },
    deployStatus: dep.status, deployDetail: depText.slice(0, 300)
  };
})()`;

const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, timeout: 60000 });
if (r.exceptionDetails) { console.error("EXCEPTION:", r.result && r.result.description); process.exit(1); }
console.log(JSON.stringify(r.result.value, null, 2));
ws.close();
