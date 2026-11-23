import { TuringMachine, compile, parseList } from './machine.js?v=11';
import { PRESETS, clonePreset, cloneLayout, rowsToRules, rulesToRows } from './presets.js?v=11';
import { TapeRenderer, SpacetimeRenderer, makeStateColors, makeSymbolColors, readTheme } from './render.js?v=11';
import { StateDiagram } from './diagram.js?v=11';

const $ = (id) => document.getElementById(id);
const SPEEDS = [0.5, 1, 2, 4, 8, 16, 32, 64, 240];
const MAX_ROWS = 3000;
const FIELDS = ['state', 'read', 'write', 'move', 'next'];

let def; // 編集中の定義
let compiled;
let tm;
let colorOf = () => '#888';
let symColor = () => '#000';
let theme = readTheme();

let rows = [];
let range = { min: 0, max: 0 };
let running = false;
let acc = 0;
let speed = SPEEDS[3];
let anim = { from: 0, to: 0, t0: 0, dur: 0 };
let flash = null;
let uiDirty = true;
let stDirty = true;

const tapeR = new TapeRenderer($('tape'));
const stR = new SpacetimeRenderer($('spacetime'));
const diagram = new StateDiagram($('diagram'));

// ---------- 小さな DOM ヘルパー ----------
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style') node.style.cssText = v;
    else node[k] = v;
  }
  node.append(...children);
  return node;
}

const stateTag = (s) => el('span', { className: 'state-tag', style: `--c:${colorOf(s)}` }, s || '（なし）');
const symTag = (s) => el('span', { className: 'sym-tag' }, s);
const moveText = (m) => (m === 'N' ? 'その場にとどまり' : `${m === 'L' ? '左' : '右'}へ 1 マス動き`);

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- 定義の読み込み・検証 ----------
let baseLayout = {}; // 「配置を戻す」で戻す先

function loadDef(d) {
  def = d;
  def.layout ??= {};
  baseLayout = cloneLayout(def.layout);
  $('set-tape').value = def.tape;
  $('set-head').value = def.head;
  $('set-start').value = def.start;
  $('set-halt').value = def.halt.join(', ');
  $('set-blank').value = def.blank;
  renderTable();
  recompile();
  resetMachine();
}

function recompile() {
  compiled = compile(def);
  showErrors(compiled.errors);
  refreshColors();
}

function refreshColors() {
  const m = compiled.machine;
  const states = [m.start];
  for (const r of def.rules) states.push(String(r.state).trim(), String(r.next).trim());
  states.push(...m.halt);
  colorOf = makeStateColors(states.filter(Boolean), m.halt);

  const symbols = [];
  const add = (c) => {
    if (c && c !== m.blank && !symbols.includes(c)) symbols.push(c);
  };
  def.rules.forEach((r) => {
    add(r.read);
    add(r.write);
  });
  m.tape.forEach(add);
  symbols.sort((a, b) => (a === '1' ? -1 : b === '1' ? 1 : 0));
  symColor = makeSymbolColors(symbols, theme);
  uiDirty = stDirty = true;
}

function showErrors(errors) {
  document.querySelectorAll('.invalid').forEach((n) => {
    n.classList.remove('invalid');
    n.removeAttribute('title');
  });
  for (const e of errors) {
    const target =
      e.row !== undefined
        ? document.querySelector(`#rules-body [data-row="${e.row}"][data-field="${e.field}"]`)
        : $(`set-${e.field}`);
    if (target) {
      target.classList.add('invalid');
      target.title = e.msg;
    }
  }
  const box = $('errors');
  box.replaceChildren(...errors.map((e) => el('li', {}, e.msg)));
  box.hidden = errors.length === 0;
}

// ---------- 実行 ----------
function snapshot() {
  const b = tm.bounds();
  range.min = Math.min(range.min, b.min);
  range.max = Math.max(range.max, b.max);
  return { cells: [...tm.tape], head: tm.head, state: tm.state };
}

function resetMachine() {
  running = false;
  acc = 0;
  tm = new TuringMachine(compiled.machine);
  const b = tm.bounds();
  range = { min: b.min, max: b.max };
  rows = [snapshot()];
  anim = { from: tm.head, to: tm.head, t0: 0, dur: 0 };
  flash = null;
  tapeR.snap((b.min + b.max) / 2);
  uiDirty = stDirty = true;
}

function startAnim(from, to) {
  anim = { from, to, t0: performance.now(), dur: Math.min(260, (1000 / speed) * 0.75) };
}

function doStep() {
  const rec = tm.step();
  if (!rec) return false;
  startAnim(rec.head, tm.head);
  flash = { pos: rec.head, t0: performance.now(), dur: Math.min(650, (1000 / speed) * 1.2) };
  rows.push(snapshot());
  if (rows.length > MAX_ROWS) rows.shift();
  uiDirty = stDirty = true;
  return true;
}

function doStepBack() {
  const before = tm.head;
  const rec = tm.stepBack();
  if (!rec) return;
  startAnim(before, tm.head);
  flash = { pos: rec.head, t0: performance.now(), dur: 500 };
  if (rows.length > 1) rows.pop();
  else rows = [snapshot()];
  uiDirty = stDirty = true;
}

function setRunning(on) {
  if (on && tm.halted) return;
  running = on;
  acc = on ? 1 : 0; // 再生を押したらすぐ 1 ステップ進める
  uiDirty = true;
}

function headX(now) {
  if (!anim.dur) return anim.to;
  const t = Math.min(1, (now - anim.t0) / anim.dur);
  const e = 1 - (1 - t) ** 3;
  return anim.from + (anim.to - anim.from) * e;
}

let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;

  if (running) {
    acc += dt * speed;
    let n = 0;
    while (acc >= 1 && n < 2000) {
      acc -= 1;
      if (!doStep()) break;
      n++;
    }
    if (tm.halted) setRunning(false);
  }

  if (uiDirty) {
    updateUI();
    uiDirty = false;
  }

  let f = null;
  if (flash) {
    const a = 1 - (now - flash.t0) / flash.dur;
    if (a > 0) f = { pos: flash.pos, alpha: a * 0.8 };
    else flash = null;
  }
  const tapeSpot = spot?.canvas ? { kind: spot.canvas, phase: (now - spot.t0) / 1000 } : null;
  tapeR.draw({ tm, headX: headX(now), colorOf, flash: f, theme, now, spot: tapeSpot });
  if (spot) placeSpotLabels();

  if (stDirty) {
    stR.draw({ rows, min: range.min, max: range.max, colorOf, symColor, theme });
    stDirty = false;
  }
  requestAnimationFrame(frame);
}

// ---------- 表示の更新 ----------
function updateUI() {
  $('stat-steps').textContent = tm.steps.toLocaleString();
  $('stat-head').textContent = tm.head;
  $('stat-count').textContent = tm.countNonBlank();

  const run = $('btn-run');
  run.textContent = running ? '⏸ 一時停止' : '▶ 再生';
  run.disabled = !running && tm.halted;
  $('btn-step').disabled = tm.halted;
  $('btn-back').disabled = !tm.canStepBack;

  renderChips();
  renderExplain();
  const nextRow = tm.halted ? -1 : (tm.findRule()?.row ?? -1);
  const lastRow = tm.lastRule?.row ?? -1;
  highlightRows(nextRow, lastRow);
  const m = compiled.machine;
  diagram.update({
    states: allStates(),
    rules: m.rules,
    start: m.start,
    halt: m.halt,
    current: tm.state,
    nextRow,
    lastRow,
    colorOf,
    layout: def.layout,
  });
}

/** 開始状態 → 遷移表に出てくる順 → 停止状態 の順に、重複なしで状態を並べる */
function allStates() {
  const m = compiled.machine;
  const list = [m.start];
  def.rules.forEach((r) => list.push(String(r.state).trim(), String(r.next).trim()));
  list.push(...m.halt);
  if (tm) list.push(tm.state);
  return [...new Set(list.filter(Boolean))];
}

function renderChips() {
  const m = compiled.machine;
  const chips = allStates().map((s) => {
    const isHalt = m.halt.includes(s);
    const cls = ['chip'];
    if (s === tm.state) cls.push('is-current');
    if (isHalt) cls.push('is-halt');
    if (s === m.start) cls.push('is-start');
    return el(
      'span',
      { className: cls.join(' '), style: `--c:${colorOf(s)}`, title: isHalt ? '停止状態' : s === m.start ? '開始状態' : '' },
      s,
    );
  });
  $('state-chips').replaceChildren(...chips);
}

function renderExplain() {
  const box = $('explain');
  const last = tm.undo.at(-1);
  const lines = [];

  if (last) {
    const r = last.rule;
    // 遷移表を編集した後は行番号がずれている可能性があるので番号を出さない
    const ruleRef = tm.lastRule ? ['規則 ', el('b', {}, `#${r.row + 1}`), ' に従って '] : ['規則に従って '];
    lines.push(
      el(
        'p',
        { className: 'done' },
        el('strong', {}, `ステップ ${tm.steps}：`),
        '状態 ',
        stateTag(last.state),
        ' でヘッドの下の ',
        symTag(last.read),
        ' を読みました。',
        ...ruleRef,
        symTag(r.write),
        ' を書き、',
        moveText(r.move),
        '、状態 ',
        stateTag(r.next),
        ' になりました。',
      ),
    );
  } else {
    lines.push(el('p', { className: 'done' }, el('strong', {}, 'スタート：'), '開始状態 ', stateTag(tm.state), ' から始めます。'));
  }

  if (tm.haltReason === 'halt-state') {
    lines.push(
      el(
        'p',
        { className: 'next halted' },
        el('strong', {}, '停止しました。'),
        '状態 ',
        stateTag(tm.state),
        ` は停止状態です（${tm.steps.toLocaleString()} ステップ）。`,
      ),
    );
  } else if (tm.haltReason === 'no-rule') {
    lines.push(
      el(
        'p',
        { className: 'next halted' },
        el('strong', {}, '停止しました。'),
        '状態 ',
        stateTag(tm.state),
        ' で ',
        symTag(tm.read()),
        ' を読んだときの規則が遷移表にありません。',
      ),
    );
  } else {
    const r = tm.findRule();
    lines.push(
      el(
        'p',
        { className: 'next' },
        el('strong', {}, '次は：'),
        'ヘッドの下は ',
        symTag(tm.read()),
        '。規則 ',
        el('b', {}, `#${r.row + 1}`),
        ' を使います（',
        symTag(r.write),
        ' を書き、',
        moveText(r.move).replace('動き', '動いて').replace('とどまり', 'とどまって'),
        '、状態 ',
        stateTag(r.next),
        ' へ）。',
      ),
    );
  }
  box.replaceChildren(...lines);
}

function highlightRows(nextRow, lastRow) {
  document.querySelectorAll('#rules-body tr').forEach((tr) => {
    const i = Number(tr.dataset.row);
    tr.classList.toggle('is-next', i === nextRow);
    tr.classList.toggle('is-last', i === lastRow);
  });
}

// ---------- 遷移表エディタ ----------
function renderTable() {
  const body = $('rules-body');
  body.replaceChildren(
    ...def.rules.map((r, i) => {
      const cells = FIELDS.map((f) => {
        let input;
        if (f === 'move') {
          input = el(
            'select',
            { ariaLabel: `#${i + 1} 移動` },
            el('option', { value: 'L', title: '左へ 1 マス' }, '← L'),
            el('option', { value: 'R', title: '右へ 1 マス' }, '→ R'),
            el('option', { value: 'N', title: '動かない' }, '・ N'),
          );
          input.value = ['L', 'R', 'N'].includes(r.move) ? r.move : 'R';
        } else {
          input = el('input', {
            type: 'text',
            value: r[f],
            spellcheck: false,
            autocomplete: 'off',
            className: f === 'read' || f === 'write' ? 'sym' : '',
          });
          input.setAttribute('aria-label', `#${i + 1} ${{ state: '現在の状態', read: '読んだ記号', write: '書く記号', next: '次の状態' }[f]}`);
        }
        input.dataset.row = i;
        input.dataset.field = f;
        return el('td', {}, input);
      });
      const del = el('button', { type: 'button', className: 'icon-btn', title: 'この行を削除', textContent: '×' });
      del.dataset.del = i;
      del.setAttribute('aria-label', `#${i + 1} を削除`);
      const handle = el('button', {
        type: 'button',
        className: 'handle',
        title: 'ドラッグして並べ替え（↑↓ キーでも移動できます）',
        textContent: '⠿',
      });
      handle.dataset.handle = i;
      handle.setAttribute('aria-label', `#${i + 1} を移動（↑↓ キー）`);
      return el(
        'tr',
        { dataset: { row: i } },
        el('td', { className: 'handle-cell' }, handle),
        el('td', { className: 'num' }, `#${i + 1}`),
        ...cells,
        el('td', {}, del),
      );
    }),
  );
}

function onRulesChanged() {
  markCustom();
  recompile();
  tm.setRules(compiled.machine.rules);
  if (tm.halted) setRunning(false);
  uiDirty = true;
}

$('rules-body').addEventListener('input', (e) => {
  const { row, field } = e.target.dataset;
  if (row === undefined) return;
  def.rules[Number(row)][field] = e.target.value;
  onRulesChanged();
});

$('rules-body').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-del]');
  if (!btn) return;
  def.rules.splice(Number(btn.dataset.del), 1);
  renderTable();
  onRulesChanged();
});

// ---------- 行の並べ替え（ドラッグ＆ドロップ／↑↓ キー） ----------
/** from 行を、挿入位置 to（0〜行数）へ移す */
function moveRule(from, to) {
  const dest = to > from ? to - 1 : to;
  if (dest === from || dest < 0 || dest >= def.rules.length) return false;
  const [rule] = def.rules.splice(from, 1);
  def.rules.splice(dest, 0, rule);
  renderTable();
  onRulesChanged();
  return dest;
}

let rowDrag = null;

function clearDropMarks() {
  document.querySelectorAll('#rules-body .drop-above, #rules-body .drop-below').forEach((tr) => tr.classList.remove('drop-above', 'drop-below'));
}

$('rules-body').addEventListener('pointerdown', (e) => {
  // ⠿ ボタンだけでなく、そのセル全体をつかめるようにする
  const handle = e.target.closest('.handle-cell')?.querySelector('[data-handle]');
  if (!handle || e.button !== 0) return;
  e.preventDefault();
  window.getSelection()?.removeAllRanges();
  try {
    handle.setPointerCapture(e.pointerId);
  } catch {
    // キャプチャできなくても window で追跡するので問題ない
  }
  const from = Number(handle.dataset.handle);
  rowDrag = { from, to: from, id: e.pointerId, handle };
  handle.closest('tr').classList.add('dragging');
  document.body.classList.add('row-dragging');
});

/** ポインターの高さから挿入位置（0〜行数）を求める */
function dropIndex(clientY) {
  const trs = [...$('rules-body').rows];
  for (let i = 0; i < trs.length; i++) {
    const r = trs[i].getBoundingClientRect();
    if (clientY < r.top + r.height / 2) return i;
  }
  return trs.length;
}

window.addEventListener('pointermove', (e) => {
  if (!rowDrag || e.pointerId !== rowDrag.id) return;
  e.preventDefault();
  const trs = [...$('rules-body').rows];
  const to = dropIndex(e.clientY);
  rowDrag.to = to;
  clearDropMarks();
  if (to === rowDrag.from || to === rowDrag.from + 1) return;
  if (to < trs.length) trs[to].classList.add('drop-above');
  else trs[trs.length - 1].classList.add('drop-below');
});

function endRowDrag(e) {
  if (!rowDrag || e.pointerId !== rowDrag.id) return;
  const { from } = rowDrag;
  const to = dropIndex(e.clientY);
  rowDrag = null;
  clearDropMarks();
  document.body.classList.remove('row-dragging');
  document.querySelector('#rules-body tr.dragging')?.classList.remove('dragging');
  if (e.type === 'pointerup') moveRule(from, to);
}
window.addEventListener('pointerup', endRowDrag);
window.addEventListener('pointercancel', endRowDrag);

$('rules-body').addEventListener('keydown', (e) => {
  const handle = e.target.closest('[data-handle]');
  if (!handle || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
  e.preventDefault();
  const from = Number(handle.dataset.handle);
  const dest = moveRule(from, e.key === 'ArrowUp' ? from - 1 : from + 2);
  if (dest !== false) document.querySelector(`#rules-body [data-handle="${dest}"]`)?.focus();
});

$('add-rule').addEventListener('click', () => {
  const prev = def.rules.at(-1);
  const state = prev?.state ?? def.start;
  def.rules.push({ state, read: def.blank, write: def.blank, move: 'R', next: state });
  renderTable();
  onRulesChanged();
  document.querySelector(`#rules-body [data-row="${def.rules.length - 1}"][data-field="read"]`)?.focus();
});

// 設定欄：変更したらリセットして反映
const settingFields = {
  'set-tape': (v) => (def.tape = v),
  'set-head': (v) => (def.head = v.trim() === '' ? 0 : Number(v)),
  'set-start': (v) => (def.start = v),
  'set-halt': (v) => (def.halt = parseList(v)),
  'set-blank': (v) => (def.blank = v),
};
for (const [id, apply] of Object.entries(settingFields)) {
  $(id).addEventListener('input', (e) => {
    apply(e.target.value);
    markCustom();
    recompile();
    resetMachine();
  });
}

// ---------- 例題と共有 ----------
const presetSelect = $('preset');
const customOption = el('option', { value: 'custom', hidden: true }, 'カスタム（編集中）');
presetSelect.append(...PRESETS.map((p) => el('option', { value: p.id }, p.name)), customOption);

function selectPreset(id) {
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0];
  presetSelect.value = p.id;
  customOption.hidden = true;
  $('preset-desc').textContent = p.description;
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  loadDef(clonePreset(p.id));
}

function markCustom() {
  if (presetSelect.value === 'custom') return;
  customOption.hidden = false;
  presetSelect.value = 'custom';
  $('preset-desc').textContent =
    'カスタムのマシンです（例題を編集しました）。「共有リンクをコピー」で、この設定と遷移表を URL として保存・共有できます。';
}

presetSelect.addEventListener('change', () => {
  if (presetSelect.value !== 'custom') selectPreset(presetSelect.value);
});

function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function encodeDef(d) {
  const head = Number.isInteger(d.head) ? d.head : 0;
  return toBase64Url(
    JSON.stringify({ v: 1, blank: d.blank, tape: d.tape, head, start: d.start, halt: d.halt, rules: rulesToRows(d.rules), layout: d.layout }),
  );
}

function decodeDef(s) {
  const o = JSON.parse(fromBase64Url(s));
  if (!o || !Array.isArray(o.rules)) throw new Error('invalid');
  return {
    blank: String(o.blank ?? '_'),
    tape: String(o.tape ?? ''),
    head: Number.isInteger(o.head) ? o.head : 0,
    start: String(o.start ?? ''),
    halt: Array.isArray(o.halt) ? o.halt.map(String) : [],
    rules: rowsToRules(o.rules.filter(Array.isArray).map((r) => FIELDS.map((_, i) => String(r[i] ?? '')))),
    layout: Object.fromEntries(
      Object.entries(o.layout && typeof o.layout === 'object' ? o.layout : {}).filter(
        ([, v]) => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite),
      ),
    ),
  };
}

$('share').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}#m=${encodeDef(def)}`;
  history.replaceState(null, '', url);
  try {
    await navigator.clipboard.writeText(url);
    toast('共有リンクをコピーしました');
  } catch {
    toast('アドレスバーの URL をコピーして共有してください');
  }
});

// ---------- 解説カード → 部品の場所を示す（スポットライト） ----------
const SPOTS = {
  tape: {
    canvas: 'tape',
    targets: [['.tape-wrap', 'これがテープ：記号を書いたマス目が左右に続いています']],
  },
  head: {
    canvas: 'head',
    targets: [['.tape-wrap', 'これがヘッド：▼ の付いた枠のマスを読み書きします']],
  },
  state: {
    canvas: 'state',
    targets: [
      ['.states', 'これが状態：今の状態が塗りつぶされています（ヘッドの上にも表示）'],
      ['.tape-wrap', null],
      ['.diagram-wrap', '状態遷移図でも、今の状態が塗りつぶされます'],
    ],
  },
  rules: {
    targets: [['.table-wrap', 'これが遷移表：マシンのプログラムです（青い行が次に使う規則）']],
  },
};
const SPOT_MS = 6000;
let spot = null;

function showSpot(kind) {
  clearSpot();
  const conf = SPOTS[kind];
  const items = conf.targets.map(([sel, text]) => {
    const target = document.querySelector(sel);
    target.classList.add('spot');
    const label = text ? el('div', { className: 'spot-label' }, text) : null;
    if (label) $('spot-labels').append(label);
    return { target, label };
  });
  const overlay = $('spot-overlay');
  overlay.hidden = false;
  requestAnimationFrame(() => overlay.classList.add('show'));
  items[0].target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  spot = { kind, canvas: conf.canvas, items, t0: performance.now(), timer: setTimeout(clearSpot, SPOT_MS) };
  placeSpotLabels();
}

function clearSpot() {
  if (!spot) return;
  clearTimeout(spot.timer);
  spot.items.forEach(({ target }) => target.classList.remove('spot'));
  $('spot-labels').replaceChildren();
  const overlay = $('spot-overlay');
  overlay.classList.remove('show');
  overlay.hidden = true;
  spot = null;
}

/** ラベルを対象の左上（上に余白がなければ内側）に置く。スクロール中も毎フレーム追従する */
function placeSpotLabels() {
  for (const { target, label } of spot.items) {
    if (!label) continue;
    const r = target.getBoundingClientRect();
    const lh = label.offsetHeight;
    const top = r.top - lh - 16 > 4 ? r.top - lh - 16 : r.top + 8;
    const left = Math.max(8, Math.min(window.innerWidth - label.offsetWidth - 8, r.left + 4));
    label.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }
}

document.querySelector('.parts').addEventListener('click', (e) => {
  const card = e.target.closest('[data-spot]');
  if (card) showSpot(card.dataset.spot);
});
$('spot-overlay').addEventListener('click', clearSpot);

// ---------- 操作 ----------
$('btn-run').addEventListener('click', () => setRunning(!running));
$('btn-step').addEventListener('click', () => {
  setRunning(false);
  doStep();
});
$('btn-back').addEventListener('click', () => {
  setRunning(false);
  doStepBack();
});
$('btn-reset').addEventListener('click', resetMachine);
$('diagram-reset').addEventListener('click', () => {
  def.layout = cloneLayout(baseLayout);
  uiDirty = true;
});

const speedInput = $('speed');
function applySpeed() {
  const i = Number(speedInput.value);
  speed = SPEEDS[i];
  $('speed-label').textContent = speed >= 240 ? '最速' : `${speed} 回/秒`;
  $('speed-down').disabled = i <= 0;
  $('speed-up').disabled = i >= SPEEDS.length - 1;
}
/** 速さを 1 段階変える（delta = -1 で遅く、+1 で速く） */
function changeSpeed(delta) {
  const i = Math.max(0, Math.min(SPEEDS.length - 1, Number(speedInput.value) + delta));
  speedInput.value = i;
  applySpeed();
}
speedInput.addEventListener('input', applySpeed);
$('speed-down').addEventListener('click', () => changeSpeed(-1));
$('speed-up').addEventListener('click', () => changeSpeed(1));
applySpeed();

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && spot) {
    clearSpot();
    return;
  }
  if (e.target.closest('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
  const actions = {
    ' ': () => setRunning(!running),
    ArrowRight: () => (setRunning(false), doStep()),
    ArrowLeft: () => (setRunning(false), doStepBack()),
    r: resetMachine,
    R: resetMachine,
    '-': () => changeSpeed(-1),
    '+': () => changeSpeed(1),
    '=': () => changeSpeed(1), // Shift なしの「+」キー
  };
  const act = actions[e.key];
  if (act) {
    e.preventDefault();
    act();
  }
});

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  theme = readTheme();
  refreshColors();
});
new ResizeObserver(() => (stDirty = true)).observe($('spacetime'));

// ---------- 起動 ----------
const hash = location.hash.match(/^#m=([\w-]+)/);
let loaded = false;
if (hash) {
  try {
    const d = decodeDef(hash[1]);
    loadDef(d);
    markCustom();
    $('preset-desc').textContent = '共有リンクから読み込んだマシンです。';
    loaded = true;
  } catch {
    toast('共有リンクを読み込めませんでした');
  }
}
if (!loaded) selectPreset(PRESETS[0].id);
requestAnimationFrame(frame);
