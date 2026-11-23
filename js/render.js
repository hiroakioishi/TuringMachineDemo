// Canvas への描画（テープとヘッド、時空間図）

const STATE_HUES = [212, 24, 150, 282, 46, 338, 186, 100];
const SYMBOL_HUES = [24, 150, 282, 46, 338, 186];

/** 状態名 → 色 の関数を作る。停止状態はグレー */
export function makeStateColors(states, haltStates) {
  const map = new Map();
  let i = 0;
  for (const s of states) {
    if (map.has(s)) continue;
    if (haltStates.includes(s)) map.set(s, [220, 8, 46]);
    else map.set(s, [STATE_HUES[i++ % STATE_HUES.length], 62, 48]);
  }
  return (state, alpha = 1) => {
    const [h, s, l] = map.get(state) ?? [0, 0, 50];
    return `hsl(${h} ${s}% ${l}% / ${alpha})`;
  };
}

/** 記号 → 時空間図の色 の関数を作る。最初の記号はインク色 */
export function makeSymbolColors(symbols, theme) {
  const map = new Map();
  symbols.forEach((s, i) => {
    map.set(s, i === 0 ? theme.ink : `hsl(${SYMBOL_HUES[(i - 1) % SYMBOL_HUES.length]} 60% 55%)`);
  });
  return (sym) => map.get(sym) ?? theme.ink;
}

export function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const g = (name) => cs.getPropertyValue(name).trim();
  return {
    surface: g('--surface'),
    cell: g('--cell'),
    ink: g('--ink'),
    muted: g('--muted'),
    line: g('--line'),
    flash: g('--flash'),
    accent: g('--accent'),
    tapeWell: g('--tape-well'),
    tapeBg: g('--tape-bg'),
    tapeLine: g('--tape-line'),
    tapeEdge: g('--tape-edge'),
    tapeInk: g('--tape-ink'),
    tapeShadow: g('--tape-shadow'),
  };
}

const FONT = 'system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic UI", sans-serif';
const MONO = 'ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace';

function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/** "#rrggbb" を同じ色の完全な透明にする（グラデーションが黒ずまないように） */
function transparentOf(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return 'rgba(0,0,0,0)';
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, 0)`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class TapeRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.camera = 0;
    this.lastTime = 0;
  }

  /** カメラ位置を即座に合わせる */
  snap(x) {
    this.camera = x;
  }

  cellSize(w) {
    return w < 520 ? 44 : 56;
  }

  /**
   * tm: TuringMachine, headX: 表示上のヘッド位置（補間済み）
   * flash: { pos, alpha } | null
   * spot: { kind: 'tape' | 'head' | 'state', phase } | null — 解説カードから強調するとき
   */
  draw({ tm, headX, colorOf, flash, theme, now, spot }) {
    const { ctx, w, h } = fitCanvas(this.canvas);
    const s = this.cellSize(w);
    const tapeY = Math.round(h - s - 26);
    const cx = w / 2;

    // ヘッドが端に近づいたときだけテープをスクロールする
    const dt = this.lastTime ? Math.min(0.1, (now - this.lastTime) / 1000) : 0;
    this.lastTime = now;
    const half = w / s / 2;
    const margin = Math.min(3, Math.max(0.5, half - 1.5));
    let target = this.camera;
    if (headX > this.camera + half - margin) target = headX - (half - margin);
    if (headX < this.camera - half + margin) target = headX + (half - margin);
    this.camera += (target - this.camera) * Math.min(1, dt * 10);

    const toX = (pos) => cx + (pos - this.camera) * s;
    ctx.clearRect(0, 0, w, h);

    const first = Math.floor(this.camera - half) - 1;
    const last = Math.ceil(this.camera + half) + 1;

    // テープを「紙の帯」として、影を付けて浮かせる
    ctx.save();
    ctx.shadowColor = theme.tapeShadow;
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = theme.tapeBg;
    ctx.fillRect(-10, tapeY, w + 20, s);
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let p = first; p <= last; p++) {
      const x = toX(p) - s / 2;
      if (p === tm.head) {
        ctx.fillStyle = colorOf(tm.state, 0.16);
        ctx.fillRect(x, tapeY, s, s);
      }
      if (flash && flash.pos === p && flash.alpha > 0) {
        ctx.globalAlpha = flash.alpha;
        ctx.fillStyle = theme.flash;
        ctx.fillRect(x, tapeY, s, s);
        ctx.globalAlpha = 1;
      }
      // マス目の仕切り
      ctx.strokeStyle = theme.tapeLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, tapeY + 4);
      ctx.lineTo(Math.round(x) + 0.5, tapeY + s - 4);
      ctx.stroke();

      const sym = tm.read(p);
      const isBlank = sym === tm.def.blank;
      ctx.globalAlpha = isBlank ? 0.28 : 1;
      ctx.fillStyle = theme.tapeInk;
      ctx.font = `700 ${Math.round(s * 0.48)}px ${MONO}`;
      ctx.fillText(sym, toX(p), tapeY + s / 2 + 1);
      ctx.globalAlpha = 1;

      ctx.fillStyle = theme.muted;
      ctx.font = `11px ${FONT}`;
      ctx.fillText(String(p), toX(p), tapeY + s + 14);
    }

    // テープの上下の縁
    ctx.strokeStyle = theme.tapeEdge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, tapeY + 1);
    ctx.lineTo(w, tapeY + 1);
    ctx.moveTo(0, tapeY + s - 1);
    ctx.lineTo(w, tapeY + s - 1);
    ctx.stroke();

    // ヘッド
    const hx = toX(headX);
    const col = colorOf(tm.state);
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    roundRect(ctx, hx - s / 2 - 1.5, tapeY - 1.5, s + 3, s + 3, 4);
    ctx.stroke();

    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(hx, tapeY - 5);
    ctx.lineTo(hx - 8, tapeY - 16);
    ctx.lineTo(hx + 8, tapeY - 16);
    ctx.closePath();
    ctx.fill();

    ctx.font = `600 14px ${FONT}`;
    const label = tm.state || '（なし）';
    const tw = ctx.measureText(label).width;
    const pw = tw + 22;
    const ph = 26;
    const py = tapeY - 16 - ph;
    const px = Math.max(4, Math.min(w - pw - 4, hx - pw / 2));
    roundRect(ctx, px, py, pw, ph, ph / 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(label, px + pw / 2, py + ph / 2 + 1);

    // 解説カードから強調された部品を、脈打つ枠で示す
    if (spot) {
      const pulse = (Math.sin(spot.phase * Math.PI * 2 * 0.8) + 1) / 2; // 0〜1
      const grow = 3 + pulse * 6;
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 3;
      ctx.setLineDash([]);
      if (spot.kind === 'head') {
        roundRect(ctx, hx - s / 2 - 4 - grow, tapeY - 20 - grow, s + 8 + grow * 2, s + 24 + grow * 2, 8);
        ctx.stroke();
      } else if (spot.kind === 'tape') {
        ctx.strokeRect(4 - grow / 3, tapeY - grow, w - 8 + (grow * 2) / 3, s + grow * 2);
      } else if (spot.kind === 'state') {
        roundRect(ctx, px - grow, py - grow, pw + grow * 2, ph + grow * 2, ph / 2 + grow);
        ctx.stroke();
      }
    }

    // 左右の端をぼかして「テープは続いている」ことを示す
    const fade = Math.min(60, w * 0.12);
    for (const [x0, x1] of [
      [0, fade],
      [w, w - fade],
    ]) {
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0, theme.tapeWell);
      g.addColorStop(1, transparentOf(theme.tapeWell)); // 黒を経由せずに透明へ
      ctx.fillStyle = g;
      ctx.fillRect(Math.min(x0, x1), tapeY - 22, fade, s + 50);
    }
  }
}

export class SpacetimeRenderer {
  constructor(canvas) {
    this.canvas = canvas;
  }

  /** rows: [{ cells: [[pos, sym]], head, state }] */
  draw({ rows, min, max, colorOf, symColor, theme }) {
    const { ctx, w, h } = fitCanvas(this.canvas);
    ctx.clearRect(0, 0, w, h);
    const cols = max - min + 3;
    // 行数が増えたら行を低くして、なるべく全体が収まるようにする
    const cwMax = Math.max(1, Math.min(20, (w - 8) / cols));
    const rh = Math.max(3, Math.min(cwMax, 14, h / rows.length));
    const cw = Math.min(cwMax, rh * 2.5);
    const visible = Math.floor(h / rh);
    const start = Math.max(0, rows.length - visible);
    const ox = (w - cols * cw) / 2 + cw;
    const gap = cw >= 5 && rh >= 5 ? 1 : 0;

    ctx.fillStyle = theme.cell;
    ctx.fillRect(ox - cw, 0, cols * cw, Math.min(h, (rows.length - start) * rh));

    for (let i = start; i < rows.length; i++) {
      const row = rows[i];
      const y = (i - start) * rh;
      for (const [pos, sym] of row.cells) {
        ctx.fillStyle = symColor(sym);
        ctx.fillRect(ox + (pos - min) * cw, y, cw - gap, rh - gap);
      }
      const hx = ox + (row.head - min) * cw;
      ctx.fillStyle = colorOf(row.state);
      if (cw >= 6 && rh >= 6) {
        ctx.strokeStyle = colorOf(row.state);
        ctx.lineWidth = 2;
        ctx.strokeRect(hx + 1, y + 1, cw - gap - 2, rh - gap - 2);
      } else {
        ctx.fillRect(hx, y, Math.max(1, cw - gap), rh - gap);
      }
    }
  }
}
