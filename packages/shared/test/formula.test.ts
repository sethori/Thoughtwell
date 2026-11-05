import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cellAddress, cellNumber, columnIndex, columnLetters, evaluateGrid, formatResult, isFormula } from '../src/index.js';

const show = (grid: string[][]) => evaluateGrid(grid).map((row) => row.map((r) => (r ? formatResult(r) : null)));
const one = (formula: string, grid: string[][] = []) => {
  const g = grid.map((r) => [...r]);
  g.push([formula]);
  return show(g).at(-1)![0];
};

test('addresses', () => {
  assert.equal(columnIndex('A'), 0);
  assert.equal(columnIndex('z'), 25);
  assert.equal(columnIndex('AA'), 26);
  assert.equal(columnLetters(0), 'A');
  assert.equal(columnLetters(27), 'AB');
  assert.equal(cellAddress(2, 1), 'B3');
  assert.ok(isFormula('=1'));
  assert.ok(!isFormula('='));
  assert.ok(!isFormula('total'));
});

test('plain cells read as numbers', () => {
  assert.equal(cellNumber('1,200'), 1200);
  assert.equal(cellNumber('$5.50'), 5.5);
  assert.equal(cellNumber('-3'), -3);
  assert.equal(cellNumber('12%'), 0.12);
  assert.equal(cellNumber(''), null);
  assert.equal(cellNumber('apples'), 'text');
});

test('sum and average over a column, skipping the header and text', () => {
  const grid = [
    ['Item', 'Cost'],
    ['Paper', '10'],
    ['Ink', '$20'],
    ['Notes', 'n/a'],
    ['Pens', ''],
    ['Total', '=SUM(B2:B5)'],
    ['Average', '=average(B2:B5)'],
  ];
  const out = show(grid);
  assert.equal(out[5]![1], '30');
  assert.equal(out[6]![1], '15');
  assert.equal(out[0]![0], null);
});

test('arithmetic, precedence and functions', () => {
  const grid = [['2', '3', '4']];
  assert.equal(one('=A1 + B1 * C1', grid), '14');
  assert.equal(one('=(A1 + B1) * C1', grid), '20');
  assert.equal(one('=-A1 + 1', grid), '-1');
  assert.equal(one('=C1 / A1', grid), '2');
  assert.equal(one('=MIN(A1:C1)', grid), '2');
  assert.equal(one('=MAX(A1:C1, 10)', grid), '10');
  assert.equal(one('=COUNT(A1:C1)', grid), '3');
  assert.equal(one('=ROUND(10 / 3, 2)', grid), '3.33');
  assert.equal(one('=AVG(A1:C1)', grid), '3');
  assert.equal(one('=0.1 + 0.2'), '0.3');
  assert.equal(one('=SUM(A1:C1) / 3', grid), '3');
});

test('formulas can use other formulas', () => {
  const out = show([['1', '=A1 * 2', '=B1 + A1']]);
  assert.deepEqual(out[0], [null, '2', '3']);
});

test('errors', () => {
  const grid = [['5', 'text', '0']];
  assert.equal(one('=A1 / C1', grid), '#DIV/0!');
  assert.equal(one('=AVERAGE(B1:B1)', grid), '#DIV/0!');
  assert.equal(one('=A1 + B1', grid), '#VALUE!');
  assert.equal(one('=A1:C1', grid), '#VALUE!');
  assert.equal(one('=Z9', grid), '#REF!');
  assert.equal(one('=NOPE(A1)', grid), '#NAME?');
  assert.equal(one('=SUM(A1', grid), '#ERROR!');
  assert.equal(one('=1 +', grid), '#ERROR!');
  assert.equal(one('=A1 $ 2', grid), '#ERROR!');
});

test('cycles are reported, and errors flow to cells that use them', () => {
  const out = show([['=B1', '=A1', '=A1 + 1'], ['=A2']]);
  assert.deepEqual(out[0], ['#CYCLE!', '#CYCLE!', '#CYCLE!']);
  assert.equal(out[1]![0], '#CYCLE!');
});

test('ranges work in either direction', () => {
  const grid = [['1'], ['2'], ['3']];
  assert.equal(one('=SUM(A3:A1)', grid), '6');
});
