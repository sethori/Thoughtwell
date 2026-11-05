/**
 * Spreadsheet-style formulas for table cells.
 *
 * A cell whose text starts with "=" is a formula. Cells are addressed like a
 * spreadsheet: columns A, B, C… from the left, rows 1, 2, 3… from the top of
 * the table (a header row is row 1). Supported:
 *
 *   numbers           =2.5
 *   cell references   =A1   =b3
 *   arithmetic        =A1 + B1 * 2   =(A2 - A3) / 4   =-A1
 *   functions         =SUM(A2:A9)  =AVERAGE(B2:B5, 10)  =MIN  =MAX  =COUNT  =ROUND(A1, 2)
 *
 * New functions are added to FUNCTIONS below; the parser does not change.
 * Text and blank cells inside a range are skipped, like a spreadsheet.
 */

export type FormulaError = '#ERROR!' | '#REF!' | '#NAME?' | '#VALUE!' | '#DIV/0!' | '#CYCLE!';

export type FormulaResult = { ok: true; value: number } | { ok: false; error: FormulaError };

export function isFormula(text: string): boolean {
  const t = text.trim();
  return t.length > 1 && t.startsWith('=');
}

// ---------- addresses

/** "A" → 0, "Z" → 25, "AA" → 26. */
export function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** 0 → "A", 26 → "AA". */
export function columnLetters(index: number): string {
  let s = '';
  let n = index + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Zero-based row and column to "B3". */
export function cellAddress(row: number, col: number): string {
  return `${columnLetters(col)}${row + 1}`;
}

// ---------- parsing

type Node =
  | { t: 'num'; v: number }
  | { t: 'ref'; r: number; c: number }
  | { t: 'range'; r1: number; c1: number; r2: number; c2: number }
  | { t: 'neg'; a: Node }
  | { t: 'bin'; op: '+' | '-' | '*' | '/'; a: Node; b: Node }
  | { t: 'call'; name: string; args: Node[] };

type Token = { k: 'num'; v: number } | { k: 'ref'; r: number; c: number } | { k: 'name'; v: string } | { k: 'op'; v: string };

class FormulaSyntaxError extends Error {}

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  const re = /\s*(?:(\d+(?:\.\d*)?|\.\d+)|([A-Za-z]{1,3})(\d+)(?![A-Za-z0-9_])|([A-Za-z_][A-Za-z0-9_.]*)|([-+*/(),:]))/y;
  let i = 0;
  while (i < src.length) {
    if (/^\s*$/.test(src.slice(i))) break;
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw new FormulaSyntaxError(`Unexpected "${src[i]}"`);
    i = re.lastIndex;
    if (m[1] !== undefined) out.push({ k: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) {
      const row = Number(m[3]) - 1;
      if (row < 0) throw new FormulaSyntaxError('Rows start at 1');
      out.push({ k: 'ref', r: row, c: columnIndex(m[2]) });
    } else if (m[4] !== undefined) out.push({ k: 'name', v: m[4].toUpperCase() });
    else out.push({ k: 'op', v: m[5]! });
  }
  return out;
}

function parse(src: string): Node {
  const tokens = tokenize(src);
  let p = 0;
  const peek = () => tokens[p];
  const isOp = (v: string) => {
    const t = tokens[p];
    return t?.k === 'op' && t.v === v;
  };
  const expect = (v: string) => {
    if (!isOp(v)) throw new FormulaSyntaxError(`Expected "${v}"`);
    p++;
  };

  const expr = (): Node => {
    let a = term();
    while (isOp('+') || isOp('-')) {
      const op = (tokens[p++] as { v: '+' | '-' }).v;
      a = { t: 'bin', op, a, b: term() };
    }
    return a;
  };
  const term = (): Node => {
    let a = unary();
    while (isOp('*') || isOp('/')) {
      const op = (tokens[p++] as { v: '*' | '/' }).v;
      a = { t: 'bin', op, a, b: unary() };
    }
    return a;
  };
  const unary = (): Node => {
    if (isOp('-')) {
      p++;
      return { t: 'neg', a: unary() };
    }
    if (isOp('+')) {
      p++;
      return unary();
    }
    return primary();
  };
  const primary = (): Node => {
    const tok = peek();
    if (!tok) throw new FormulaSyntaxError('The formula ends too early');
    if (tok.k === 'num') {
      p++;
      return { t: 'num', v: tok.v };
    }
    if (tok.k === 'ref') {
      p++;
      if (isOp(':')) {
        p++;
        const end = peek();
        if (end?.k !== 'ref') throw new FormulaSyntaxError('A range needs a cell on both sides of ":"');
        p++;
        return {
          t: 'range',
          r1: Math.min(tok.r, end.r),
          c1: Math.min(tok.c, end.c),
          r2: Math.max(tok.r, end.r),
          c2: Math.max(tok.c, end.c),
        };
      }
      return { t: 'ref', r: tok.r, c: tok.c };
    }
    if (tok.k === 'name') {
      p++;
      expect('(');
      const args: Node[] = [];
      if (!isOp(')')) {
        args.push(expr());
        while (isOp(',')) {
          p++;
          args.push(expr());
        }
      }
      expect(')');
      return { t: 'call', name: tok.v, args };
    }
    if (isOp('(')) {
      p++;
      const inner = expr();
      expect(')');
      return inner;
    }
    throw new FormulaSyntaxError(`Unexpected "${tok.v}"`);
  };

  const node = expr();
  if (p < tokens.length) throw new FormulaSyntaxError('Unexpected text after the formula');
  return node;
}

// ---------- functions

class Fail extends Error {
  constructor(readonly code: FormulaError) {
    super(code);
  }
}

/** Each function gets its arguments as lists of numbers (a range gives many, a value gives one). */
type FormulaFn = (args: number[][]) => number;

const all = (args: number[][]) => args.flat();

export const FUNCTIONS: Record<string, FormulaFn> = {
  SUM: (args) => all(args).reduce((s, n) => s + n, 0),
  AVERAGE: (args) => {
    const xs = all(args);
    if (xs.length === 0) throw new Fail('#DIV/0!');
    return xs.reduce((s, n) => s + n, 0) / xs.length;
  },
  MIN: (args) => {
    const xs = all(args);
    return xs.length ? Math.min(...xs) : 0;
  },
  MAX: (args) => {
    const xs = all(args);
    return xs.length ? Math.max(...xs) : 0;
  },
  COUNT: (args) => all(args).length,
  ROUND: (args) => {
    const [x, digits] = [args[0]?.[0], args[1]?.[0] ?? 0];
    if (x === undefined || args.length > 2) throw new Fail('#VALUE!');
    const f = 10 ** Math.trunc(digits);
    return Math.round(x * f) / f;
  },
};
FUNCTIONS.AVG = FUNCTIONS.AVERAGE!;

// ---------- evaluation

/** Reads a plain (non-formula) cell as a number: "1,200", "$5", "12%", "-3.5". Blank is null. */
export function cellNumber(text: string): number | null | 'text' {
  const t = text.trim();
  if (t === '') return null;
  const m = /^([-+]?)\$?\s*([\d,]*\.?\d+)\s*(%?)$/.exec(t);
  if (!m) return 'text';
  const n = Number(m[2]!.replace(/,/g, ''));
  if (!Number.isFinite(n)) return 'text';
  const signed = m[1] === '-' ? -n : n;
  return m[3] ? signed / 100 : signed;
}

/**
 * Evaluates every formula in a grid of cell texts (rows of columns).
 * Returns a grid of the same shape: a result for formula cells, null elsewhere.
 */
export function evaluateGrid(grid: string[][]): (FormulaResult | null)[][] {
  const cache = new Map<string, FormulaResult>();
  const visiting = new Set<string>();
  const parsed = new Map<string, Node | FormulaSyntaxError>();

  const textAt = (r: number, c: number): string | undefined => grid[r]?.[c];

  // A cell's value inside arithmetic: number, or a failure.
  const valueOf = (r: number, c: number): number | null | 'text' => {
    const text = textAt(r, c);
    if (text === undefined) throw new Fail('#REF!');
    if (!isFormula(text)) return cellNumber(text);
    const res = evalCell(r, c);
    if (!res.ok) throw new Fail(res.error);
    return res.value;
  };

  const rangeValues = (n: Extract<Node, { t: 'range' }>): number[] => {
    const out: number[] = [];
    for (let r = n.r1; r <= n.r2; r++) {
      for (let c = n.c1; c <= n.c2; c++) {
        const v = valueOf(r, c);
        if (typeof v === 'number') out.push(v);
      }
    }
    return out;
  };

  const ev = (n: Node): number => {
    switch (n.t) {
      case 'num':
        return n.v;
      case 'ref': {
        const v = valueOf(n.r, n.c);
        if (v === 'text') throw new Fail('#VALUE!');
        return v ?? 0;
      }
      case 'range':
        // A range only makes sense as a function argument.
        throw new Fail('#VALUE!');
      case 'neg':
        return -ev(n.a);
      case 'bin': {
        const a = ev(n.a);
        const b = ev(n.b);
        if (n.op === '+') return a + b;
        if (n.op === '-') return a - b;
        if (n.op === '*') return a * b;
        if (b === 0) throw new Fail('#DIV/0!');
        return a / b;
      }
      case 'call': {
        const fn = FUNCTIONS[n.name];
        if (!fn) throw new Fail('#NAME?');
        return fn(n.args.map((a) => (a.t === 'range' ? rangeValues(a) : [ev(a)])));
      }
    }
  };

  const evalCell = (r: number, c: number): FormulaResult => {
    const key = `${r},${c}`;
    const hit = cache.get(key);
    if (hit) return hit;
    if (visiting.has(key)) throw new Fail('#CYCLE!');
    visiting.add(key);
    let result: FormulaResult;
    try {
      let node = parsed.get(key);
      if (!node) {
        try {
          node = parse(textAt(r, c)!.trim().slice(1));
        } catch (err) {
          node = err instanceof FormulaSyntaxError ? err : new FormulaSyntaxError(String(err));
        }
        parsed.set(key, node);
      }
      if (node instanceof FormulaSyntaxError) result = { ok: false, error: '#ERROR!' };
      else {
        const v = ev(node);
        result = Number.isFinite(v) ? { ok: true, value: v } : { ok: false, error: '#VALUE!' };
      }
    } catch (err) {
      if (!(err instanceof Fail)) throw err;
      result = { ok: false, error: err.code };
    } finally {
      visiting.delete(key);
    }
    cache.set(key, result);
    return result;
  };

  return grid.map((row, r) => row.map((text, c) => (isFormula(text) ? evalCell(r, c) : null)));
}

/** How a result shows in the cell. */
export function formatResult(res: FormulaResult): string {
  if (!res.ok) return res.error;
  const v = res.value;
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toPrecision(12)));
}

/** Plain-language explanation for an error, for tooltips. */
export const FORMULA_ERROR_HELP: Record<FormulaError, string> = {
  '#ERROR!': 'The formula could not be read. Check brackets, commas and cell names.',
  '#REF!': 'The formula points at a cell outside this table.',
  '#NAME?': `Unknown function. Available: ${Object.keys(FUNCTIONS).sort().join(', ')}.`,
  '#VALUE!': 'A cell used in arithmetic holds text, or a range was used outside a function.',
  '#DIV/0!': 'Division by zero, or an average of no numbers.',
  '#CYCLE!': 'The formula depends on itself, directly or through other cells.',
};
