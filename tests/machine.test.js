import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TuringMachine, compile } from '../js/machine.js';
import { PRESETS, clonePreset } from '../js/presets.js';

function run(def, limit = 100000) {
  const { machine, errors } = compile(def);
  assert.deepEqual(errors, []);
  const tm = new TuringMachine(machine);
  while (!tm.halted && tm.steps < limit) tm.step();
  return tm;
}

const withTape = (id, tape) => ({ ...clonePreset(id), tape });

test('すべての例題がエラーなくコンパイルできる', () => {
  for (const p of PRESETS) assert.deepEqual(compile(clonePreset(p.id)).errors, [], p.id);
});

test('ビット反転', () => {
  const tm = run(clonePreset('invert'));
  assert.equal(tm.tapeString(), '01001');
  assert.equal(tm.state, '停止');
});

test('2 進数に 1 を足す', () => {
  assert.equal(run(clonePreset('increment')).tapeString(), '1100');
  assert.equal(run(withTape('increment', '111')).tapeString(), '1000');
  assert.equal(run(withTape('increment', '0')).tapeString(), '1');
});

test('1 進数の足し算', () => {
  assert.equal(run(clonePreset('unary-add')).tapeString(), '11111');
});

test('回文の判定', () => {
  const cases = { abba: '受理', aba: '受理', '': '受理', a: '受理', abab: '拒否', ab: '拒否', aabba: '拒否' };
  for (const [tape, expected] of Object.entries(cases)) {
    assert.equal(run(withTape('palindrome', tape)).state, expected, tape);
  }
});

test('ビジービーバー', () => {
  const expected = { bb2: [6, 4], bb3: [14, 6], bb4: [107, 13] };
  for (const [id, [steps, ones]] of Object.entries(expected)) {
    const tm = run(clonePreset(id));
    assert.equal(tm.steps, steps, id);
    assert.equal(tm.countNonBlank(), ones, id);
    assert.equal(tm.haltReason, 'halt-state', id);
  }
});

test('1 ステップ戻すと元に戻る', () => {
  const { machine } = compile(clonePreset('bb4'));
  const tm = new TuringMachine(machine);
  const snapshots = [];
  while (!tm.halted) {
    snapshots.push([tm.head, tm.state, tm.tapeString()]);
    tm.step();
  }
  while (tm.canStepBack) {
    tm.stepBack();
    assert.deepEqual([tm.head, tm.state, tm.tapeString()], snapshots.pop());
  }
  assert.equal(tm.steps, 0);
});

test('規則がないと停止する', () => {
  const tm = run({ blank: '_', tape: '1x', head: 0, start: 'A', halt: [], rules: [{ state: 'A', read: '1', write: '1', move: 'R', next: 'A' }] });
  assert.equal(tm.haltReason, 'no-rule');
  assert.equal(tm.head, 1);
});

test('入力エラーを検出する', () => {
  const { errors, machine } = compile({
    blank: '__',
    tape: '',
    head: 0,
    start: '',
    halt: [],
    rules: [
      { state: 'A', read: '0', write: '1', move: 'R', next: 'B' },
      { state: 'A', read: '0', write: '0', move: 'L', next: 'A' },
      { state: '', read: '', write: '1', move: 'X', next: '' },
    ],
  });
  const fields = errors.map((e) => `${e.row ?? '-'}:${e.field}`);
  assert.deepEqual(fields, ['-:blank', '-:start', '1:read', '2:state', '2:read', '2:move', '2:next']);
  assert.equal(machine.rules.length, 1);
});
