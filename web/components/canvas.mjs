// 画布：把每个 item 画成「带标签的框」。
import { canvasLabel } from '../../config/manga.mjs';
//
// 不渲染真实气泡形状——标注清楚比画得像更重要：
//   分格：标签写「格 · 全景/矩形」，里面是画面描述
//   文字：标签写【旁白】【对话】…，里面是台词
// 框半透明，方便看清和底下生成图的区别。

import { html, useRef, useState, useEffect } from '../lib.mjs';

const MIN_SIZE = 40;
const SNAP = 6;

/** 类型颜色：按名字确定性推导。描边固定要实；底色透明度由右上的「底色」滑杆给 */
function typeColor(name, alpha = 0.5) {
  let hash = 0;
  for (const ch of String(name || '')) hash = (hash * 31 + ch.codePointAt(0)) % 997;
  const hue = Math.round((hash * 137.508) % 360);
  return {
    fill: `hsla(${hue}, 50%, 88%, ${alpha})`,
    stroke: `hsla(${hue}, 62%, 34%, 0.95)`,
  };
}

function isVertical(page, item) {
  if (typeof item.vertical === 'boolean') return item.vertical;
  return page.vertical !== false;
}

/** 竖排：每列若干字，从右往左，整体居中 */
function verticalColumns(text, bbox, fs) {
  const [x1, y1, x2, y2] = bbox;
  const perCol = Math.max(1, Math.floor((y2 - y1 - fs) / (fs * 1.1)));
  const chars = [...String(text || '')];
  const cols = [];
  for (let i = 0; i < chars.length; i += perCol) cols.push(chars.slice(i, i + perCol));
  const step = fs * 1.1;
  const total = Math.max(1, cols.length) * step;
  const startX = (x1 + x2) / 2 + total / 2 - step / 2;
  const rows = Math.min(perCol, cols[0]?.length || 1);
  const startY = (y1 + y2) / 2 - (rows * step) / 2 + fs * 0.4;
  return cols.map((col, i) => ({ x: startX - i * step, y: startY, chars: col }));
}

/** 横排：按宽度折行，整体居中 */
function horizontalLines(text, bbox, fs) {
  const [x1, y1, x2, y2] = bbox;
  const perLine = Math.max(1, Math.floor((x2 - x1 - 12) / (fs * 1.02)));
  const lines = [];
  for (const raw of String(text || '').split('\n')) {
    const chars = [...raw];
    for (let i = 0; i < chars.length; i += perLine) lines.push(chars.slice(i, i + perLine).join(''));
    if (!chars.length) lines.push('');
  }
  const maxLines = Math.max(1, Math.floor((y2 - y1 - 24) / (fs * 1.35)));
  const shown = lines.slice(0, maxLines);
  const startY = (y1 + y2) / 2 - (shown.length * fs * 1.35) / 2 + fs;
  return shown.map((line, i) => ({ x: (x1 + x2) / 2, y: startY + i * fs * 1.35, text: line }));
}



function ItemBox({ item, page, index, selected, primary, fillAlpha, characters }) {
  const [x1, y1, x2, y2] = item.bbox;
  const w = Math.max(0, x2 - x1);
  const h = Math.max(0, y2 - y1);
  const isBubble = item.type === 'bubble';
  const isNative = item.type === 'native';
  const character =
    item.type === 'character' ? (characters || []).find((c) => c.id === item.ref) : null;
  const variant =
    character && item.variant
      ? (character.variants || []).find((v) => v.id === item.variant)
      : null;
  const color = typeColor(item.type, fillAlpha);

  const label =
    item.type === 'character'
      ? `角色 · ${character?.name || item.ref || '未选'}${variant ? ` · ${variant.name}` : ''}`
      : canvasLabel(item, index, { page, characters });

  const fs = Math.max(17, Math.min(w / 13, h / 4.5, 30));
  // 画布优先显示中文备注：英文提示词是给模型看的，不是给人看的
  const look = [character?.look, variant?.look].filter(Boolean).join(', ');
  const body =
    item.note ||
    (item.type === 'character'
      ? item.desc || look || ''
      : isBubble
        ? item.text || item.desc
        : isNative
          ? item.text || item.caption
          : item.desc || item.caption);

  // 画布只做排版预览：文字一律横排显示，竖排设置只影响生成的提示词
  const vertical = false;
  const cols = vertical ? verticalColumns(body, item.bbox, fs) : [];
  const rows = !vertical ? horizontalLines(body, item.bbox, fs) : [];

  return html`<g>
    <rect
      style=${'fill:' + color.fill + ';stroke:' + color.stroke}
      class=${`item-box ${item.type}${selected ? ' sel' : ''}${selected && !primary ? ' sel-multi' : ''}`}
      x=${x1}
      y=${y1}
      width=${w}
      height=${h}
      rx=${0}
    />
        <text class="item-tag" x=${x1 + 5} y=${y1 + 13}>${label}</text>
    ${vertical
      ? cols.map((col) => html`<text class="item-text" x=${col.x} y=${col.y} font-size=${fs} text-anchor="middle">
          ${col.chars.map((ch, i) => html`<tspan x=${col.x} dy=${i === 0 ? 0 : fs * 1.1}>${ch}</tspan>`)}
        </text>`)
      : rows.map((row) => html`<text class="item-text" x=${row.x} y=${row.y} font-size=${fs} text-anchor="middle">${row.text}</text>`)}

  </g>`;
}

export default function Canvas({ page, image, showBoxes = true, grid = 4, scale, selection, fillAlpha = 0.5, characters = [], onSelect, onBegin, onChange, onCommit }) {
  const [W, H] = page.size;
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const [guides, setGuides] = useState([]);

  function pointOf(event) {
    const rect = svgRef.current.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * W, y: ((event.clientY - rect.top) / rect.height) * H };
  }

  function edges() {
    const xs = [0, W / 2, W];
    const ys = [0, H / 2, H];
    for (const item of page.items) {
      xs.push(item.bbox[0], item.bbox[2]);
      ys.push(item.bbox[1], item.bbox[3]);
    }
    return { xs, ys };
  }

  function snap(value, candidates) {
    let best = value;
    let dist = SNAP + 1;
    for (const c of candidates) {
      const d = Math.abs(value - c);
      if (d < dist) {
        dist = d;
        best = c;
      }
    }
    return dist <= SNAP ? best : value;
  }

  function idsOf(sel) {
    if (!sel) return [];
    if (Array.isArray(sel.ids) && sel.ids.length) return sel.ids;
    return sel.id ? [sel.id] : [];
  }

  /** 指针压着的所有元素，上面的排前面（items 里越靠后画得越上） */
  function stackAt(pt) {
    return [...page.items]
      .reverse()
      .filter((it) => pt.x >= it.bbox[0] && pt.x <= it.bbox[2] && pt.y >= it.bbox[1] && pt.y <= it.bbox[3]);
  }

  /**
   * 命中规则：
   *   Alt + 点击  → 在被压住的一摞里往下穿一层（选到下面的格子）
   *   Shift + 点击 → 加选 / 减选
   *   普通点击     → 选中最上面那个；如果点的是已选中的，就保持整组不动
   */
  function onCanvasDown(event) {
    if (event.button !== 0) return;
    if (!showBoxes) {
      onSelect?.(null);
      return;
    }
    const hits = stackAt(pointOf(event));
    const held = idsOf(selection);

    if (!hits.length) {
      if (!event.shiftKey) onSelect?.(null);
      return;
    }

    let target;
    if (event.altKey) {
      const index = hits.findIndex((it) => it.id === selection?.id);
      target = hits[(index + 1) % hits.length];
    } else {
      target = hits.find((it) => held.includes(it.id)) || hits[0];
    }

    let ids;
    if (event.shiftKey) {
      ids = held.includes(target.id) ? held.filter((id) => id !== target.id) : [...held, target.id];
      if (!ids.length) {
        onSelect?.(null);
        return;
      }
    } else if (held.includes(target.id)) {
      ids = held;
    } else {
      ids = [target.id];
    }

    const primary = ids.includes(selection?.id) ? selection.id : target.id;
    // 多选状态下单击（没有拖动）收敛成单个
    const collapse = !event.shiftKey && !event.altKey && ids.length > 1 ? target.id : null;
    onSelect?.({ kind: target.type, id: primary, ids });
    onBegin?.();
    startDrag(event, ids, 'move', primary, collapse);
  }

  function startDrag(event, ids, mode, primary, collapse = null) {
    const origin = {};
    for (const id of ids) {
      const item = page.items.find((it) => it.id === id);
      if (item) origin[id] = [...item.bbox];
    }
    if (!origin[primary]) return;
    dragRef.current = { ids: Object.keys(origin), primary, mode, start: pointOf(event), origin, moved: false, collapse };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }

  function onMove(event) {
    const drag = dragRef.current;
    if (!drag) return;
    const base = drag.origin[drag.primary];
    if (!base) return;
    const pt = pointOf(event);
    const dx = pt.x - drag.start.x;
    const dy = pt.y - drag.start.y;
    const step = Math.max(1, Number(grid) || 4);
    const round = (v) => Math.round(v / step) * step;

    if (drag.mode === 'move') {
      const moved = [base[0] + dx, base[1] + dy, base[2] + dx, base[3] + dy];
      const { xs, ys } = edges();
      const ox = snap(moved[0], xs) - moved[0];
      const oy = snap(moved[1], ys) - moved[1];
      setGuides(
        Math.abs(ox) > 0.5 || Math.abs(oy) > 0.5
          ? [
              ...(Math.abs(ox) > 0.5 ? [{ x: moved[0] + ox, y1: 0, y2: H }] : []),
              ...(Math.abs(oy) > 0.5 ? [{ y: moved[1] + oy, x1: 0, x2: W }] : []),
            ]
          : []
      );
      drag.moved = true;
      onChange?.(
        drag.ids.map((id) => {
          const b = drag.origin[id];
          return { id, bbox: [b[0] + dx + ox, b[1] + dy + oy, b[2] + dx + ox, b[3] + dy + oy].map(round) };
        })
      );
      return;
    }

    // 手柄：只改一个
    const [x1, y1, x2, y2] = base;
    const bbox = [x1, y1, x2, y2];
    if (drag.mode.includes('w')) bbox[0] = x1 + dx;
    if (drag.mode.includes('e')) bbox[2] = x2 + dx;
    if (drag.mode.includes('n')) bbox[1] = y1 + dy;
    if (drag.mode.includes('s')) bbox[3] = y2 + dy;
    if (bbox[2] - bbox[0] < MIN_SIZE) {
      if (drag.mode.includes('w')) bbox[0] = bbox[2] - MIN_SIZE;
      else bbox[2] = bbox[0] + MIN_SIZE;
    }
    if (bbox[3] - bbox[1] < MIN_SIZE) {
      if (drag.mode.includes('n')) bbox[1] = bbox[3] - MIN_SIZE;
      else bbox[3] = bbox[1] + MIN_SIZE;
    }

    drag.moved = true;
    onChange?.([{ id: drag.primary, bbox: bbox.map(round) }]);
  }


  function onUp() {
    const drag = dragRef.current;
    window.removeEventListener('pointermove', onMove);
    setGuides([]);
    dragRef.current = null;
    if (!drag) return;
    if (drag.moved) return onCommit?.();
    if (drag.collapse) {
      const item = page.items.find((it) => it.id === drag.collapse);
      if (item) onSelect?.({ kind: item.type, id: item.id, ids: [item.id] });
    }
  }

  useEffect(() => () => window.removeEventListener('pointermove', onMove), []);

  const handles = (bbox) => {
    const [x1, y1, x2, y2] = bbox;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    return [
      ['nw', x1, y1],
      ['n', mx, y1],
      ['ne', x2, y1],
      ['e', x2, my],
      ['se', x2, y2],
      ['s', mx, y2],
      ['sw', x1, y2],
      ['w', x1, my],
    ];
  };

  const selIds = idsOf(selection);
  const primaryId = selection?.id || selIds[selIds.length - 1] || null;
  const selectedItem = primaryId ? page.items.find((it) => it.id === primaryId) : null;
  const panelIndex = (item) => page.items.filter((it) => it.type === 'panel').findIndex((it) => it.id === item.id);

  return html`<div class="page-frame">
    <div class="paper" style=${`width:${W * scale}px;height:${H * scale}px`}>
      <svg
        ref=${svgRef}
        viewBox=${`0 0 ${W} ${H}`}
        width=${W * scale}
        height=${H * scale}
        onPointerDown=${onCanvasDown}
      >
        <rect x="0" y="0" width=${W} height=${H} fill="#ffffff" />
        ${image ? html`<image href=${image} x="0" y="0" width=${W} height=${H} preserveAspectRatio="xMidYMid slice" opacity="1" />` : null}

        ${showBoxes ? page.items.map((item, i) => html`<${ItemBox}
          key=${item.id}
          item=${item}
          page=${page}
          index=${item.type === 'panel' ? panelIndex(item) : i}
          selected=${selIds.includes(item.id)}
          primary=${item.id === primaryId}
          fillAlpha=${fillAlpha}
          characters=${characters}
        />`) : null}

        ${guides.map((g) =>
          g.x !== undefined
            ? html`<line class="guide" x1=${g.x} y1=${g.y1} x2=${g.x} y2=${g.y2} />`
            : html`<line class="guide" x1=${g.x1} y1=${g.y} x2=${g.x2} y2=${g.y} />`
        )}

        ${showBoxes && selectedItem && selIds.length === 1
          ? handles(selectedItem.bbox).map(
              ([mode, x, y]) =>
                html`<rect
                  class=${`handle ${mode}`}
                  x=${x - 6}
                  y=${y - 6}
                  width="12"
                  height="12"
                  onPointerDown=${(e) => {
                    e.stopPropagation();
                    startDrag(e, [selectedItem.id], mode, selectedItem.id);
                  }}
                />`
            )
          : null}
      </svg>
    </div>
  </div>`;
}
