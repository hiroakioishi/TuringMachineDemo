// 状態遷移図（SVG）。状態は楕円、規則は矢印。状態はドラッグで動かせる。
//
// 配置の優先順: data.layout（例題で決めた位置・ドラッグで動かした位置）→ 自動配置。
// data.layout は { 状態名: [x, y] } で、ドラッグするとこのオブジェクトを直接書き換える。

const NS = 'http://www.w3.org/2000/svg';
const RY = 20;
const LINE_H = 16;
const MARGIN_X = 115;
const MARGIN_Y = 100;
const NODE_FONT = '600 14px system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic UI", sans-serif';

const measureCtx = document.createElement('canvas').getContext('2d');
function textWidth(text, font) {
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

function svgEl(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

const f = (n) => Math.round(n * 10) / 10;

/** 楕円の中心から点 p の方向に進んだときの、楕円の縁の点 */
function toward(node, p, pad = 0) {
  const dx = p.x - node.x;
  const dy = p.y - node.y;
  const rx = node.rx + pad;
  const ry = node.ry + pad;
  const t = 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) || 1);
  return { x: node.x + dx * t, y: node.y + dy * t };
}

const atAngle = (node, a, pad = 0) => toward(node, { x: node.x + Math.cos(a), y: node.y + Math.sin(a) }, pad);

const quad = (s, c, e, t) => ({
  x: (1 - t) * (1 - t) * s.x + 2 * (1 - t) * t * c.x + t * t * e.x,
  y: (1 - t) * (1 - t) * s.y + 2 * (1 - t) * t * c.y + t * t * e.y,
});

function marker(id, cls) {
  return svgEl(
    'marker',
    { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' },
    svgEl('path', { d: 'M0,0 L10,5 L0,10 z', class: `arrow-head ${cls}` }),
  );
}

/**
 * 自動配置: 開始状態からの距離（何回の遷移でたどり着くか）で列を分け、左から右へ並べる。
 * たどり着けない状態はいちばん右の列に置く。
 */
function autoLayout(states, rules, start) {
  const depth = new Map();
  if (states.includes(start)) {
    depth.set(start, 0);
    const queue = [start];
    while (queue.length) {
      const s = queue.shift();
      for (const r of rules) {
        if (r.state === s && !depth.has(r.next)) {
          depth.set(r.next, depth.get(s) + 1);
          queue.push(r.next);
        }
      }
    }
  }
  let maxDepth = Math.max(0, ...depth.values());
  const unreachable = states.filter((s) => !depth.has(s));
  if (unreachable.length) {
    maxDepth += 1;
    unreachable.forEach((s) => depth.set(s, maxDepth));
  }
  const columns = Array.from({ length: maxDepth + 1 }, () => []);
  states.forEach((s) => columns[depth.get(s)].push(s));

  const pos = {};
  columns.forEach((col, ci) => {
    col.forEach((state, i) => {
      pos[state] = [ci * 200, (i - (col.length - 1) / 2) * 120];
    });
  });
  return pos;
}

export class StateDiagram {
  constructor(svg) {
    this.svg = svg;
    this.data = null;
    this.nodes = new Map();
    this.drag = null;
    this.view = { x: 0, y: 0, w: 760, h: 400 };
    svg.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e));
  }

  /** data: { states, rules, start, halt, current, nextRow, lastRow, colorOf, layout } */
  update(data) {
    this.data = data;
    if (!this.drag) this.render();
  }

  toSvg(e) {
    const p = this.svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    return p.matrixTransform(this.svg.getScreenCTM().inverse());
  }

  onDown(e) {
    const g = e.target.closest('[data-state]');
    if (!g || !this.data) return;
    const node = this.nodes.get(g.dataset.state);
    if (!node) return;
    e.preventDefault();
    // 今の配置をすべて layout に書き出してから動かす（ほかの状態が動かないように）
    const layout = this.data.layout;
    for (const n of this.nodes.values()) layout[n.state] = [f(n.x), f(n.y)];
    const p = this.toSvg(e);
    this.drag = { state: node.state, dx: node.x - p.x, dy: node.y - p.y, id: e.pointerId };
    try {
      this.svg.setPointerCapture(e.pointerId);
    } catch {
      // キャプチャできなくても window で追跡するので問題ない
    }
    this.svg.classList.add('dragging');
  }

  onMove(e) {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    const node = this.nodes.get(this.drag.state);
    const p = this.toSvg(e);
    const v = this.view;
    const x = Math.min(v.x + v.w - node.rx - 4, Math.max(v.x + node.rx + 4, p.x + this.drag.dx));
    const y = Math.min(v.y + v.h - RY - 4, Math.max(v.y + RY + 4, p.y + this.drag.dy));
    this.data.layout[this.drag.state] = [f(x), f(y)];
    this.render();
  }

  onUp(e) {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    this.drag = null;
    this.svg.classList.remove('dragging');
    this.render();
  }

  layout(states, rules, start, layout) {
    const auto = autoLayout(states, rules, start);
    const nodes = new Map();
    const placed = states.filter((s) => layout[s]);
    const missing = states.filter((s) => !layout[s]);
    const size = (state) => Math.max(28, textWidth(state, NODE_FONT) / 2 + 15);

    if (placed.length === 0) {
      for (const s of states) nodes.set(s, { state: s, x: auto[s][0], y: auto[s][1], rx: size(s), ry: RY });
    } else {
      for (const s of placed) nodes.set(s, { state: s, x: layout[s][0], y: layout[s][1], rx: size(s), ry: RY });
      // 位置の決まっていない状態（新しく追加した状態など）は、図の下に並べる
      const xs = placed.map((s) => layout[s][0]);
      const ys = placed.map((s) => layout[s][1]);
      missing.forEach((s, i) => {
        nodes.set(s, { state: s, x: Math.min(...xs) + i * 170, y: Math.max(...ys) + 130, rx: size(s), ry: RY });
      });
    }
    return nodes;
  }

  updateView(nodes) {
    if (this.drag) return; // ドラッグ中は表示範囲を固定する
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const n of nodes.values()) {
      minX = Math.min(minX, n.x - n.rx);
      maxX = Math.max(maxX, n.x + n.rx);
      minY = Math.min(minY, n.y - n.ry);
      maxY = Math.max(maxY, n.y + n.ry);
    }
    if (!nodes.size) [minX, maxX, minY, maxY] = [0, 0, 0, 0];
    let w = maxX - minX + MARGIN_X * 2;
    let h = maxY - minY + MARGIN_Y * 2;
    let x = minX - MARGIN_X;
    let y = minY - MARGIN_Y;
    const minW = 560;
    const minH = 260;
    if (w < minW) {
      x -= (minW - w) / 2;
      w = minW;
    }
    if (h < minH) {
      y -= (minH - h) / 2;
      h = minH;
    }
    this.view = { x, y, w, h };
    this.svg.setAttribute('viewBox', `${f(x)} ${f(y)} ${f(w)} ${f(h)}`);
  }

  render() {
    const { states, rules, start, halt, current, nextRow, lastRow, colorOf, layout } = this.data;
    const nodes = this.layout(states, rules, start, layout);
    this.nodes = nodes;
    this.updateView(nodes);

    let cy = 0;
    for (const n of nodes.values()) cy += n.y / (nodes.size || 1);
    // 自己ループは上向き（図の下のほうにある状態は下向き）に描く
    const loopDir = (n) => ({ x: 0, y: n.y > cy + 10 ? 1 : -1 });

    // 同じ「状態 → 次の状態」の規則をまとめて 1 本の矢印にする
    const groups = new Map();
    for (const r of rules) {
      if (!nodes.has(r.state) || !nodes.has(r.next)) continue;
      const key = `${r.state}\u0000${r.next}`;
      if (!groups.has(key)) groups.set(key, { from: r.state, to: r.next, rules: [] });
      groups.get(key).rules.push(r);
    }

    const edgeLayer = svgEl('g');
    const labelLayer = svgEl('g');
    const nodeLayer = svgEl('g');
    const pad = (state) => (halt.includes(state) ? 4 : 0);

    /** 曲線がほかの状態に重なる度合い */
    const overlap = (s, c, e, A, B) => {
      let p = 0;
      for (let t = 0.12; t < 0.9; t += 0.08) {
        const q = quad(s, c, e, t);
        for (const n of nodes.values()) {
          if (n === A || n === B) continue;
          const dx = (q.x - n.x) / (n.rx + 22);
          const dy = (q.y - n.y) / (n.ry + 22);
          const d = Math.hypot(dx, dy);
          if (d < 1) p += 1.5 - d;
        }
      }
      return p;
    };

    for (const g of groups.values()) {
      const A = nodes.get(g.from);
      const B = nodes.get(g.to);
      const cls = g.rules.some((r) => r.row === nextRow) ? 'next' : g.rules.some((r) => r.row === lastRow) ? 'last' : '';
      let d;
      let label;
      let dir;

      if (A === B) {
        const u = loopDir(A);
        const a = Math.atan2(u.y, u.x);
        const p1 = atAngle(A, a - 0.45, pad(A.state));
        const p2 = atAngle(A, a + 0.45, pad(A.state));
        const r0 = Math.hypot(p1.x - A.x, p1.y - A.y);
        const reach = r0 + 58;
        const c1 = { x: A.x + Math.cos(a - 0.8) * reach, y: A.y + Math.sin(a - 0.8) * reach };
        const c2 = { x: A.x + Math.cos(a + 0.8) * reach, y: A.y + Math.sin(a + 0.8) * reach };
        d = `M${f(p1.x)},${f(p1.y)} C${f(c1.x)},${f(c1.y)} ${f(c2.x)},${f(c2.y)} ${f(p2.x)},${f(p2.y)}`;
        const apex = {
          x: 0.125 * p1.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * p2.x,
          y: 0.125 * p1.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * p2.y,
        };
        label = { x: apex.x, y: apex.y + u.y * 10 };
        dir = u;
      } else {
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const len = Math.hypot(dx, dy) || 1;
        const px = -dy / len;
        const py = dx / len;
        const k0 = Math.max(20, len * 0.14);
        // 逆向きの矢印もあるときは、2 本が重ならないよう常に同じ側へ曲げる
        const paired = groups.has(`${g.to}\u0000${g.from}`);
        const candidates = paired ? [k0, k0 * 1.8] : [k0, -k0, k0 * 2.2, -k0 * 2.2, k0 * 3.5, -k0 * 3.5];
        let best = null;
        for (const k of candidates) {
          const C = { x: (A.x + B.x) / 2 + px * k, y: (A.y + B.y) / 2 + py * k };
          const s = toward(A, C, pad(A.state));
          const e = toward(B, C, pad(B.state));
          const score = overlap(s, C, e, A, B) + Math.abs(k) / 400;
          if (!best || score < best.score) best = { score, k, C, s, e };
        }
        const { k, C, s, e } = best;
        d = `M${f(s.x)},${f(s.y)} Q${f(C.x)},${f(C.y)} ${f(e.x)},${f(e.y)}`;
        const m = quad(s, C, e, 0.5);
        const sign = Math.sign(k) || 1;
        dir = { x: px * sign, y: py * sign };
        label = { x: m.x + dir.x * 8, y: m.y + dir.y * 8 };
      }

      edgeLayer.append(svgEl('path', { d, class: `edge ${cls}`, 'marker-end': `url(#arrow${cls ? `-${cls}` : ''})` }));

      // ラベル：「読んだ記号→書く記号, 移動」を規則ごとに 1 行
      const anchor = dir.x > 0.35 ? 'start' : dir.x < -0.35 ? 'end' : 'middle';
      const n = g.rules.length;
      let y0;
      if (dir.y < -0.35) y0 = label.y - (n - 0.5) * LINE_H;
      else if (dir.y > 0.35) y0 = label.y + LINE_H * 0.5;
      else y0 = label.y - ((n - 1) * LINE_H) / 2;
      g.rules.forEach((r, i) => {
        const lc = r.row === nextRow ? 'next' : r.row === lastRow ? 'last' : '';
        labelLayer.append(
          svgEl(
            'text',
            { x: f(label.x), y: f(y0 + i * LINE_H), 'text-anchor': anchor, 'dominant-baseline': 'middle', class: `elabel ${lc}` },
            `${r.read}→${r.write}, ${r.move}`,
          ),
        );
      });
    }

    for (const state of states) {
      const N = nodes.get(state);
      const isHalt = halt.includes(state);
      const g = svgEl('g', {
        class: `node${state === current ? ' current' : ''}`,
        'data-state': state,
        style: `--c:${colorOf(state)}`,
        transform: `translate(${f(N.x)},${f(N.y)})`,
      });
      if (isHalt) g.append(svgEl('ellipse', { rx: N.rx + 4, ry: N.ry + 4, class: 'ring' }));
      g.append(svgEl('ellipse', { rx: N.rx, ry: N.ry, class: 'body' }));
      g.append(svgEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'nlabel' }, state));
      g.append(svgEl('title', {}, isHalt ? `${state}（停止状態）` : state === start ? `${state}（開始状態）` : state));
      nodeLayer.append(g);
    }

    // 開始状態への矢印（左から入る）
    const S = nodes.get(start);
    if (S) {
      const tip = { x: S.x - S.rx - 2 - pad(start), y: S.y };
      const tail = { x: tip.x - 40, y: tip.y };
      edgeLayer.append(svgEl('path', { d: `M${f(tail.x)},${f(tail.y)} L${f(tip.x)},${f(tip.y)}`, class: 'start-arrow', 'marker-end': 'url(#arrow-start)' }));
      labelLayer.append(
        svgEl('text', { x: f(tail.x - 6), y: f(tail.y), 'text-anchor': 'end', 'dominant-baseline': 'middle', class: 'start-label' }, '開始'),
      );
    }

    const defs = svgEl('defs', {}, marker('arrow', ''), marker('arrow-next', 'next'), marker('arrow-last', 'last'), marker('arrow-start', 'start'));
    this.svg.replaceChildren(defs, edgeLayer, nodeLayer, labelLayer);
  }
}
