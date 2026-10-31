// 修图弹窗：上面工具栏（方框 / 圆圈 / 画笔 + 粗细 + 颜色 + 撤回），中间原图，下面提示词。
//
// 涂鸦是画在参考图上的：合成成一张整页 PNG 交给服务器，当 `{{image}}` 喂给编辑模型，
// 标记本身进画面，靠提示词里的「只改标出来的地方」约束模型。
// 坐标全部存图片像素（不是屏幕像素），窗口缩放不会把画歪。

import { html, cls, useState, useEffect, useRef } from '../lib.mjs';
import { EDIT } from '../../config/manga.mjs';

const firstSwatch = (EDIT.swatches || [])[0] || { value: 'red', hex: '#e11d48' };

export default function EditModal({ open, base, busy, progress, onClose, onStart }) {
  const [tool, setTool] = useState(EDIT.tools[0]?.value || 'rect');
  const [paint, setPaint] = useState({ value: firstSwatch.value, hex: firstSwatch.hex });
  const [size, setSize] = useState(6);
  const [shapes, setShapes] = useState([]);
  const [draft, setDraft] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [starting, setStarting] = useState(false);

  const svgRef = useRef(null);
  const imgRef = useRef(null);

  // 换一页 / 重新打开：清空涂鸦和输入
  useEffect(() => {
    if (!open) return;
    setShapes([]);
    setDraft(null);
    setPrompt('');
    setStarting(false);
  }, [open, base?.id]);

  // Esc 关闭、Ctrl+Z 撤回：capture 阶段拦下，别让编辑器把整页撤销掉
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'z') {
        e.preventDefault();
        e.stopPropagation();
        setShapes((list) => list.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const hex = paint.hex;
  const rendering = Boolean(busy);

  /**
   * 屏幕坐标 → 图片像素坐标。
   * 量的是 <img> 的盒子而不是 <svg> 的：SVG 是绝对定位铺满容器的，
   * 容器哪怕比图宽一点，按 SVG 量就会把笔迹横向拉伸/偏移（左边画跑右边）。
   */
  function toImage(event) {
    const box = imgRef.current?.getBoundingClientRect();
    if (!box || !box.width || !natural.w) return null;
    const x = ((event.clientX - box.left) / box.width) * natural.w;
    const y = ((event.clientY - box.top) / box.height) * natural.h;
    return [Math.round(Math.max(0, Math.min(natural.w, x))), Math.round(Math.max(0, Math.min(natural.h, y)))];
  }

  function begin(event) {
    if (rendering) return;
    const point = toImage(event);
    if (!point) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const [x, y] = point;
    if (tool === 'brush') setDraft({ tool, color: paint.value, hex: paint.hex, size, points: [[x, y]] });
    else setDraft({ tool, color: paint.value, hex: paint.hex, size, x1: x, y1: y, x2: x, y2: y });
  }

  function move(event) {
    if (!draft) return;
    const point = toImage(event);
    if (!point) return;
    const [x, y] = point;
    setDraft((shape) => {
      if (!shape) return shape;
      if (shape.tool === 'brush') return { ...shape, points: [...shape.points, point] };
      return { ...shape, x2: x, y2: y };
    });
  }

  function end() {
    if (!draft) return;
    const isLine = draft.tool === 'brush' ? draft.points.length > 1 : Math.abs(draft.x2 - draft.x1) > 3 && Math.abs(draft.y2 - draft.y1) > 3;
    if (isLine) setShapes((list) => [...list, draft]);
    setDraft(null);
  }

  /** 把原图和涂鸦合成一张整页 PNG（图片原始分辨率） */
  async function compose() {
    const img = imgRef.current;
    if (!img || !natural.w) return '';
    const canvas = document.createElement('canvas');
    canvas.width = natural.w;
    canvas.height = natural.h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, natural.w, natural.h);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const shape of shapes) {
      ctx.strokeStyle = shape.hex;
      ctx.lineWidth = shape.size;
      if (shape.tool === 'rect') {
        ctx.strokeRect(
          Math.min(shape.x1, shape.x2),
          Math.min(shape.y1, shape.y2),
          Math.abs(shape.x2 - shape.x1),
          Math.abs(shape.y2 - shape.y1)
        );
      } else if (shape.tool === 'ellipse') {
        const cx = (shape.x1 + shape.x2) / 2;
        const cy = (shape.y1 + shape.y2) / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.abs(shape.x2 - shape.x1) / 2, Math.abs(shape.y2 - shape.y1) / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.beginPath();
        shape.points.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      }
    }
    return canvas.toDataURL('image/png');
  }

  async function start() {
    const text = prompt.trim();
    if (!text || rendering || starting) return;
    setStarting(true);
    try {
      const overlay = await compose();
      await onStart?.({ prompt: text, overlay, marks: shapes.map(({ tool: kind, color: value }) => ({ tool: kind, color: value })) });
    } finally {
      setStarting(false);
    }
  }

  function renderShape(shape, key) {
    const common = { stroke: shape.hex, 'stroke-width': shape.size, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
    if (shape.tool === 'rect') {
      return html`<rect
        key=${key}
        x=${Math.min(shape.x1, shape.x2)}
        y=${Math.min(shape.y1, shape.y2)}
        width=${Math.abs(shape.x2 - shape.x1)}
        height=${Math.abs(shape.y2 - shape.y1)}
        ...${common}
      />`;
    }
    if (shape.tool === 'ellipse') {
      return html`<ellipse
        key=${key}
        cx=${(shape.x1 + shape.x2) / 2}
        cy=${(shape.y1 + shape.y2) / 2}
        rx=${Math.abs(shape.x2 - shape.x1) / 2}
        ry=${Math.abs(shape.y2 - shape.y1) / 2}
        ...${common}
      />`;
    }
    return html`<polyline key=${key} points=${shape.points.map(([x, y]) => `${x},${y}`).join(' ')} ...${common} />`;
  }

  return html`<div class="modal-mask" onClick=${(e) => e.target === e.currentTarget && !rendering && onClose?.()}>
    <div class="modal wide edit-modal">
      <header>
        修图
        ${base?.id ? html`<span class="tag">基于 ${base.id}</span>` : null}
        <div class="spacer" style="flex:1"></div>
        ${rendering ? html`<span class="tag">修图中 ${progress || 0}%</span>` : null}
        <button class="btn sm ghost" disabled=${rendering} onClick=${onClose}>关闭</button>
      </header>

      <div class="body">
        <div class="edit-tip">
          在图中框选需要修改的位置，然后写上具体的修改内容；如果需要改多个元素，可以使用不同颜色的框。
        </div>
        <div class="edit-tools">
          <div class="row" style="gap:4px">
            ${(EDIT.tools || []).map(
              (item) => html`<button class=${cls('btn sm', tool === item.value && 'inv')} onClick=${() => setTool(item.value)}>
                ${item.label}
              </button>`
            )}
          </div>
          <label class="meta" style="display:flex;align-items:center;gap:6px">
            粗细
            <input type="range" min="2" max="28" step="1" value=${size} style="width:80px" onInput=${(e) => setSize(Number(e.currentTarget.value))} />
          </label>
          <div class="edit-swatches">
            ${(EDIT.swatches || []).map(
              (item) => html`<button
                class=${cls('sw', paint.value === item.value && 'on')}
                style=${`background:${item.hex}`}
                title=${item.label}
                onClick=${() => setPaint({ value: item.value, hex: item.hex })}
              ></button>`
            )}
            <input
              class="sw-pick"
              type="color"
              value=${paint.hex}
              title="自定义颜色"
              onInput=${(e) => setPaint({ value: 'custom', hex: e.currentTarget.value })}
            />
          </div>
          <div class="spacer" style="flex:1"></div>
          <button class="btn sm ghost" disabled=${rendering || !shapes.length} onClick=${() => setShapes((list) => list.slice(0, -1))}>撤回</button>
          <button class="btn sm ghost" disabled=${rendering || !shapes.length} onClick=${() => setShapes([])}>清空</button>
        </div>

        <div class="edit-canvas">
          <img
            ref=${imgRef}
            src=${base?.image || ''}
            alt=""
            onLoad=${(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          />
          <svg
            ref=${svgRef}
            class="edit-draw"
            viewBox=${`0 0 ${natural.w || 1} ${natural.h || 1}`}
            onPointerDown=${begin}
            onPointerMove=${move}
            onPointerUp=${end}
            onPointerCancel=${end}
            onPointerLeave=${end}
          >
            ${shapes.map((shape, index) => renderShape(shape, `s${index}`))}
            ${draft ? renderShape(draft, 'draft') : null}
          </svg>
        </div>

      </div>

      <footer class="edit-foot">
        <textarea
          class="textarea"
          style="min-height:58px"
          value=${prompt}
          placeholder="写上具体要改什么，例如：把框里气泡的尾巴删掉"
          onInput=${(e) => setPrompt(e.currentTarget.value)}
        ></textarea>
        <button class="btn inv" disabled=${rendering || starting || !prompt.trim()} onClick=${start}>
          ${rendering ? `修图中 ${progress || 0}%` : starting ? '合成中…' : '开始修'}
        </button>
      </footer>
    </div>
  </div>`;
}
