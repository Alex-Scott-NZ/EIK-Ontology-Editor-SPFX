// Type real (trusted) text into a focused element via CDP Input.insertText.
// Usage: node type.mjs "<css selector>" "<text>"
// Synthetic input events don't reach Fluent/React reliably; insertText does.
const PORT = 9222;
const [, , selector, text] = process.argv;

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page =
  list.find((t) => t.type === "page" && /Ontology-Editor/i.test(t.url)) ||
  list.find((t) => t.type === "page" && /sharepoint\.com/.test(t.url));
if (!page) { console.error("no page target"); process.exit(1); }

const ws = await new Promise((res, rej) => {
  const w = new WebSocket(page.webSocketDebuggerUrl);
  w.onopen = () => res(w);
  w.onerror = (e) => rej(new Error("ws error"));
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

// Clear + focus the target, then insert the text as trusted input.
const focusExpr = `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return 'not found';
  el.focus(); el.select && el.select();
  return 'focused';
})()`;
const f = await send("Runtime.evaluate", { expression: focusExpr, returnByValue: true });
if (f.result.value !== "focused") { console.error(f.result.value); process.exit(1); }
await send("Input.insertText", { text });
console.log("typed:", text);
ws.close();
