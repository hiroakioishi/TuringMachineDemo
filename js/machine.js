// チューリングマシンのコアロジック（DOM に依存しない）

export const MOVES = { L: -1, R: 1, N: 0 };
export const MOVE_LABELS = { L: '左へ', R: '右へ', N: 'その場に' };

const MAX_UNDO = 100000;

const charLen = (s) => Array.from(s ?? '').length;

/** 「受理, 拒否」のような文字列を配列にする */
export function parseList(value) {
  if (Array.isArray(value)) return value.map((s) => String(s).trim()).filter(Boolean);
  return String(value ?? '')
    .split(/[,、\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 編集中の定義（def）を検証し、実行用の定義に変換する。
 * def: { blank, tape, head, start, halt: string[], rules: [{state, read, write, move, next}] }
 * 戻り値: { machine, errors } — errors は { row?, field, msg } の配列
 */
export function compile(def) {
  const errors = [];

  let blank = def.blank ?? '_';
  if (charLen(blank) !== 1) {
    errors.push({ field: 'blank', msg: '空白記号は 1 文字で入力してください。' });
    blank = '_';
  }

  const start = String(def.start ?? '').trim();
  if (!start) errors.push({ field: 'start', msg: '開始状態を入力してください。' });

  const halt = parseList(def.halt);

  let headStart = Number(def.head ?? 0);
  if (!Number.isInteger(headStart)) {
    errors.push({ field: 'head', msg: 'ヘッドの開始位置は整数で入力してください。' });
    headStart = 0;
  }

  const rules = [];
  const seen = new Map();
  (def.rules ?? []).forEach((r, row) => {
    const n = row + 1;
    const state = String(r.state ?? '').trim();
    const next = String(r.next ?? '').trim();
    const rowErrors = [];
    if (!state) rowErrors.push({ row, field: 'state', msg: `#${n}: 「現在の状態」が空です。` });
    if (charLen(r.read) !== 1) rowErrors.push({ row, field: 'read', msg: `#${n}: 「読んだ記号」は 1 文字で入力してください。` });
    if (charLen(r.write) !== 1) rowErrors.push({ row, field: 'write', msg: `#${n}: 「書く記号」は 1 文字で入力してください。` });
    if (!(r.move in MOVES)) rowErrors.push({ row, field: 'move', msg: `#${n}: 「移動」は L・R・N のどれかです。` });
    if (!next) rowErrors.push({ row, field: 'next', msg: `#${n}: 「次の状態」が空です。` });

    if (rowErrors.length === 0) {
      const key = `${state}\u0000${r.read}`;
      if (seen.has(key)) {
        rowErrors.push({
          row,
          field: 'read',
          msg: `#${n}: #${seen.get(key) + 1} と「現在の状態・読んだ記号」が同じです（上の行が使われます）。`,
        });
      } else {
        seen.set(key, row);
        rules.push({ state, read: r.read, write: r.write, move: r.move, next, row });
      }
    }
    errors.push(...rowErrors);
  });

  const tape = Array.from(String(def.tape ?? '')).map((c) => (c === ' ' ? blank : c));

  return { machine: { blank, start, halt, tape, headStart, rules }, errors };
}

export class TuringMachine {
  constructor(machine) {
    this.load(machine);
  }

  load(machine) {
    this.def = machine;
    this.reset();
  }

  reset() {
    const d = this.def;
    this.tape = new Map();
    d.tape.forEach((c, i) => {
      if (c !== d.blank) this.tape.set(i, c);
    });
    this.head = d.headStart;
    this.state = d.start;
    this.steps = 0;
    this.undo = [];
    this.lastRule = null;
    this.updateHalt();
  }

  /** 遷移表だけを差し替える（テープと状態はそのまま） */
  setRules(rules) {
    this.def = { ...this.def, rules };
    this.lastRule = null;
    this.updateHalt();
  }

  read(pos = this.head) {
    return this.tape.get(pos) ?? this.def.blank;
  }

  write(pos, sym) {
    if (sym === this.def.blank) this.tape.delete(pos);
    else this.tape.set(pos, sym);
  }

  /** 現在の状態とヘッド下の記号に合う規則（なければ null） */
  findRule(state = this.state, sym = this.read()) {
    return this.def.rules.find((r) => r.state === state && r.read === sym) ?? null;
  }

  isHaltState(state = this.state) {
    return this.def.halt.includes(state);
  }

  updateHalt() {
    if (this.isHaltState()) this.haltReason = 'halt-state';
    else if (!this.findRule()) this.haltReason = 'no-rule';
    else this.haltReason = null;
  }

  get halted() {
    return this.haltReason !== null;
  }

  /** 1 ステップ進める。実行した内容を返す（停止中なら null） */
  step() {
    if (this.halted) return null;
    const rule = this.findRule();
    const record = {
      head: this.head,
      state: this.state,
      read: this.read(),
      rule,
      prevLastRule: this.lastRule,
    };
    this.write(this.head, rule.write);
    this.head += MOVES[rule.move];
    this.state = rule.next;
    this.steps += 1;
    this.lastRule = rule;
    this.undo.push(record);
    if (this.undo.length > MAX_UNDO) this.undo.shift();
    this.updateHalt();
    return record;
  }

  /** 1 ステップ戻す。戻した記録を返す（戻せなければ null） */
  stepBack() {
    const record = this.undo.pop();
    if (!record) return null;
    this.write(record.head, record.read);
    this.head = record.head;
    this.state = record.state;
    this.steps -= 1;
    this.lastRule = record.prevLastRule;
    this.updateHalt();
    return record;
  }

  get canStepBack() {
    return this.undo.length > 0;
  }

  /** 空白以外の記号がある範囲（ヘッド位置も含む） */
  bounds() {
    let min = this.head;
    let max = this.head;
    for (const pos of this.tape.keys()) {
      if (pos < min) min = pos;
      if (pos > max) max = pos;
    }
    return { min, max };
  }

  /** テープの内容を文字列で返す（両端の空白は除く） */
  tapeString() {
    if (this.tape.size === 0) return '';
    const keys = [...this.tape.keys()];
    const min = Math.min(...keys);
    const max = Math.max(...keys);
    let s = '';
    for (let i = min; i <= max; i++) s += this.read(i);
    return s;
  }

  countNonBlank() {
    return this.tape.size;
  }
}
