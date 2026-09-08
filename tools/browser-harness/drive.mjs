// Execute a sequence of UI actions against the SP page over one CDP connection.
// Usage: node drive.mjs actions.json
// Actions: {type:"eval", expr} | {type:"fill", selector, text} | {type:"click", text|title|selector}
//        | {type:"wait", ms} | {type:"log", msg}
// "fill" focuses the element and sends trusted Input.insertText (React-safe).
import { readFileSync } from "node:fs";

const PORT = 9222;
const actions = JSON.parse(readFileSync(process.argv[2], "utf8"));

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
const evalJs = async (expr) => {
  const r = await send("Runtime.evaluate", {
    expression: expr, returnByValue: true, awaitPromise: true
  });
  if (r.exceptionDetails) throw new Error("EXCEPTION: " + (r.result && r.result.description || r.exceptionDetails.text));
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const a of actions) {
  try {
    if (a.type === "wait") { await sleep(a.ms); continue; }
    if (a.type === "log") { console.log("--", a.msg); continue; }
    if (a.type === "eval") { console.log(JSON.stringify(await evalJs(a.expr))); continue; }
    if (a.type === "fill") {
      const f = await evalJs(`(() => {
        const el = document.querySelector(${JSON.stringify(a.selector)});
        if (!el) return 'not found';
        el.focus(); el.select && el.select();
        return 'focused';
      })()`);
      if (f !== "focused") throw new Error(`fill ${a.selector}: ${f}`);
      await send("Input.insertText", { text: a.text });
      await sleep(150);
      continue;
    }
    if (a.type === "click") {
      const finder = a.selector
        ? `document.querySelector(${JSON.stringify(a.selector)})`
        : a.title
          ? `[...document.querySelectorAll('button')].find(b => b.title === ${JSON.stringify(a.title)})`
          : `[...document.querySelectorAll('button')].find(b => b.textContent.indexOf(${JSON.stringify(a.text)}) !== -1)`;
      const r = await evalJs(`(() => { const el = ${finder}; if (!el) return 'not found'; el.click(); return 'clicked'; })()`);
      if (r !== "clicked") throw new Error(`click ${a.selector || a.title || a.text}: ${r}`);
      await sleep(a.settle || 400);
      continue;
    }
    throw new Error("unknown action " + a.type);
  } catch (e) {
    console.error(`FAILED at action ${actions.indexOf(a)} (${a.type} ${a.selector || a.title || a.text || ""}): ${e.message}`);
    process.exit(1);
  }
}
console.log("ALL ACTIONS DONE");
ws.close();
