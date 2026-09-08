// Attach a local file to an <input type=file> via CDP DOM.setFileInputFiles.
// Usage: node setfile.mjs "<css selector>" "<absolute file path>"
const PORT = 9222;
const [, , selector, filePath] = process.argv;

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page =
  list.find((t) => t.type === "page" && /Ontology-Editor/i.test(t.url)) ||
  list.find((t) => t.type === "page" && /sharepoint\.com/.test(t.url));
if (!page) { console.error("no page target"); process.exit(1); }

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

const doc = await send("DOM.getDocument");
const node = await send("DOM.querySelector", { nodeId: doc.root.nodeId, selector });
if (!node.nodeId) { console.error("selector matched nothing:", selector); process.exit(1); }
await send("DOM.setFileInputFiles", { nodeId: node.nodeId, files: [filePath] });
console.log("file set:", filePath);
ws.close();
