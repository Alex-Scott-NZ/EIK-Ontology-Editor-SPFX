/**
 * Minimal Turtle reader for Semaphore/Jena exports.
 *
 * Framework-free on purpose: string in, plain objects out, no Node or DOM APIs,
 * so the same file runs in the import tool and in the web part.
 *
 * It is not a general-purpose RDF parser. It handles exactly the constructs
 * Jena emits in this export, which was verified against the full 21 MB
 * InlandRevenueModel.ttl with zero unparsed statements:
 *
 *   - @prefix declarations, and prefixed-name expansion
 *   - <full-iri> subjects, predicates and objects
 *   - "literals", """triple-quoted""", @lang tags and ^^datatypes
 *   - `;` predicate lists and `,` object lists
 *   - `a` as shorthand for rdf:type
 *
 * Blank nodes and collections are not decomposed. A statement containing them
 * is still captured, with its raw source text preserved on the subject, so the
 * importer can round-trip it through passthrough_triples verbatim.
 */

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

export interface ITurtleTerm {
  kind: 'iri' | 'literal';
  /** Expanded IRI, or the literal's lexical value. */
  value: string;
  lang?: string;
  datatype?: string;
}

export interface ITurtleSubject {
  /** Expanded IRI of the subject. */
  uri: string;
  /** Expanded predicate IRI -> objects asserted with it. */
  predicates: { [predicateUri: string]: ITurtleTerm[] };
  /** Verbatim source text of the block, for passthrough fidelity. */
  raw: string;
  /** True when the block contained a blank node or collection we did not decompose. */
  hasUnparsedNodes: boolean;
}

export interface IParsedTurtle {
  /** prefix (without colon) -> namespace IRI */
  prefixes: { [prefix: string]: string };
  /** Expanded subject IRI -> its block. Blocks repeated in the file are merged. */
  subjects: { [subjectUri: string]: ITurtleSubject };
  /** Count of statements the parser could not attribute to a subject. */
  anomalies: number;
}

interface IToken {
  t: 'iri' | 'literal' | 'name' | ';' | ',' | '[' | ']' | '(' | ')';
  v?: string;
  lang?: string;
  datatype?: string;
}

const WS = /[\s]/;
const TOKEN_BREAK = /[\s;,\])]/;

/** Resolve escape sequences inside a Turtle literal. */
function unescapeLiteral(s: string): string {
  if (s.indexOf('\\') === -1) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\') { out += s[i]; continue; }
    const c = s[++i];
    switch (c) {
      case 'n': out += '\n'; break;
      case 'r': out += '\r'; break;
      case 't': out += '\t'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case '"': out += '"'; break;
      case "'": out += "'"; break;
      case '\\': out += '\\'; break;
      case 'u': out += String.fromCharCode(parseInt(s.substr(i + 1, 4), 16)); i += 4; break;
      case 'U': out += String.fromCodePoint(parseInt(s.substr(i + 1, 8), 16)); i += 8; break;
      default: out += c;
    }
  }
  return out;
}

/**
 * Split the document into subject blocks on top-level `.` terminators,
 * ignoring dots inside IRIs, literals, and bracketed groups.
 */
function splitStatements(text: string): string[] {
  const statements: string[] = [];
  let i = 0;
  let start = 0;
  let depth = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i];

    if (c === '"' || c === "'") {
      const q = c;
      if (text[i + 1] === q && text[i + 2] === q) {
        i += 3;
        while (i < n && !(text[i] === q && text[i + 1] === q && text[i + 2] === q)) {
          if (text[i] === '\\') i++;
          i++;
        }
        i += 3;
      } else {
        i++;
        while (i < n && text[i] !== q) {
          if (text[i] === '\\') i++;
          i++;
        }
        i++;
      }
      continue;
    }

    if (c === '<') {                       // IRI: dots and # inside are not delimiters
      while (i < n && text[i] !== '>') i++;
      i++;
      continue;
    }

    if (c === '#') {                       // comment to end of line
      while (i < n && text[i] !== '\n') i++;
      continue;
    }

    if (c === '[' || c === '(') { depth++; i++; continue; }
    if (c === ']' || c === ')') { depth--; i++; continue; }

    if (c === '.' && depth === 0) {
      const prev = text[i - 1];
      const next = text[i + 1];
      const prevOk = prev === undefined || WS.test(prev) || prev === '>' || prev === '"';
      const nextOk = next === undefined || WS.test(next);
      if (prevOk && nextOk) {
        statements.push(text.slice(start, i));
        start = i + 1;
      }
    }

    i++;
  }

  const tail = text.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

/** Tokenise one statement. */
function tokenize(s: string): IToken[] {
  const toks: IToken[] = [];
  let j = 0;
  const m = s.length;

  while (j < m) {
    const c = s[j];

    if (WS.test(c)) { j++; continue; }

    if (c === '#') { while (j < m && s[j] !== '\n') j++; continue; }

    if (c === '<') {
      let k = j + 1;
      while (k < m && s[k] !== '>') k++;
      toks.push({ t: 'iri', v: s.slice(j + 1, k) });
      j = k + 1;
      continue;
    }

    if (c === '"' || c === "'") {
      const q = c;
      let lit: string;
      if (s[j + 1] === q && s[j + 2] === q) {
        let k = j + 3;
        while (k < m && !(s[k] === q && s[k + 1] === q && s[k + 2] === q)) {
          if (s[k] === '\\') k++;
          k++;
        }
        lit = s.slice(j + 3, k);
        j = k + 3;
      } else {
        let k = j + 1;
        while (k < m && s[k] !== q) {
          if (s[k] === '\\') k++;
          k++;
        }
        lit = s.slice(j + 1, k);
        j = k + 1;
      }

      const tok: IToken = { t: 'literal', v: unescapeLiteral(lit) };

      if (s[j] === '@') {
        let k = j + 1;
        while (k < m && /[A-Za-z0-9-]/.test(s[k])) k++;
        tok.lang = s.slice(j + 1, k);
        j = k;
      } else if (s[j] === '^' && s[j + 1] === '^') {
        j += 2;
        if (s[j] === '<') {
          let k = j + 1;
          while (k < m && s[k] !== '>') k++;
          tok.datatype = s.slice(j + 1, k);
          j = k + 1;
        } else {
          let k = j;
          while (k < m && !TOKEN_BREAK.test(s[k])) k++;
          tok.datatype = s.slice(j, k);
          j = k;
        }
      }

      toks.push(tok);
      continue;
    }

    if (c === ';' || c === ',') { toks.push({ t: c }); j++; continue; }
    if (c === '[' || c === ']' || c === '(' || c === ')') { toks.push({ t: c as IToken['t'] }); j++; continue; }

    let k = j;
    while (k < m && !TOKEN_BREAK.test(s[k])) k++;
    toks.push({ t: 'name', v: s.slice(j, k) });
    j = k;
  }

  return toks;
}

/** Expand `prefix:local` against the prefix table; pass through anything else. */
export function expandPrefixed(name: string, prefixes: { [p: string]: string }): string {
  if (name === 'a') return RDF_TYPE;
  const colon = name.indexOf(':');
  if (colon === -1) return name;
  const prefix = name.slice(0, colon);
  const local = name.slice(colon + 1);
  const ns = prefixes[prefix];
  return ns ? ns + local : name;
}

function termFromToken(tok: IToken, prefixes: { [p: string]: string }): ITurtleTerm | undefined {
  if (tok.t === 'iri') return { kind: 'iri', value: tok.v as string };
  if (tok.t === 'literal') {
    const term: ITurtleTerm = { kind: 'literal', value: tok.v as string };
    if (tok.lang) term.lang = tok.lang;
    if (tok.datatype) term.datatype = expandPrefixed(tok.datatype, prefixes);
    return term;
  }
  if (tok.t === 'name') {
    // Bare names are prefixed IRIs, or the literals true/false/numbers.
    if (tok.v === 'true' || tok.v === 'false') {
      return { kind: 'literal', value: tok.v, datatype: 'http://www.w3.org/2001/XMLSchema#boolean' };
    }
    if (/^[+-]?[0-9]/.test(tok.v as string)) {
      return { kind: 'literal', value: tok.v as string, datatype: 'http://www.w3.org/2001/XMLSchema#decimal' };
    }
    return { kind: 'iri', value: expandPrefixed(tok.v as string, prefixes) };
  }
  return undefined;
}

export function parseTurtle(text: string): IParsedTurtle {
  const prefixes: { [p: string]: string } = {};
  const subjects: { [uri: string]: ITurtleSubject } = {};
  let anomalies = 0;

  // Prefix declarations first — objects reference them.
  const prefixRe = /@prefix\s+([A-Za-z0-9_-]*):\s*<([^>]*)>\s*\./g;
  let pm: RegExpExecArray | null;
  while ((pm = prefixRe.exec(text)) !== null) {
    prefixes[pm[1]] = pm[2];
  }

  const statements = splitStatements(text);

  for (let si = 0; si < statements.length; si++) {
    const raw = statements[si];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.indexOf('@prefix') === 0 || trimmed.indexOf('@base') === 0) continue;

    const toks = tokenize(raw);
    if (toks.length < 3) continue;

    const subjTok = toks[0];
    if (subjTok.t !== 'iri' && subjTok.t !== 'name') { anomalies++; continue; }

    const subjectUri = subjTok.t === 'iri'
      ? (subjTok.v as string)
      : expandPrefixed(subjTok.v as string, prefixes);

    let entry = subjects[subjectUri];
    if (!entry) {
      entry = { uri: subjectUri, predicates: {}, raw: trimmed, hasUnparsedNodes: false };
      subjects[subjectUri] = entry;
    } else {
      entry.raw += '\n' + trimmed;   // same subject declared twice; keep both blocks
    }

    let idx = 1;
    let depth = 0;
    let currentPredicate: string | undefined;
    let expectPredicate = true;

    while (idx < toks.length) {
      const tk = toks[idx];

      if (tk.t === '[' || tk.t === '(') { depth++; entry.hasUnparsedNodes = true; idx++; continue; }
      if (tk.t === ']' || tk.t === ')') { depth--; idx++; continue; }
      if (depth > 0) { idx++; continue; }

      if (tk.t === ';') { currentPredicate = undefined; expectPredicate = true; idx++; continue; }
      if (tk.t === ',') { idx++; continue; }

      if (expectPredicate) {
        if (tk.t === 'iri') currentPredicate = tk.v as string;
        else if (tk.t === 'name') currentPredicate = expandPrefixed(tk.v as string, prefixes);
        else { anomalies++; idx++; continue; }
        expectPredicate = false;
        idx++;
        continue;
      }

      if (currentPredicate) {
        const term = termFromToken(tk, prefixes);
        if (term) {
          const list = entry.predicates[currentPredicate] || (entry.predicates[currentPredicate] = []);
          list.push(term);
        }
      }
      idx++;
    }
  }

  return { prefixes, subjects, anomalies };
}

/** First object asserted for a predicate, or undefined. */
export function firstObject(subject: ITurtleSubject, predicateUri: string): ITurtleTerm | undefined {
  const list = subject.predicates[predicateUri];
  return list && list.length ? list[0] : undefined;
}

/** All objects asserted for a predicate. */
export function objects(subject: ITurtleSubject, predicateUri: string): ITurtleTerm[] {
  return subject.predicates[predicateUri] || [];
}
