// 画布左上（桌面右上）的浮层：撤销 / 布局信息开关 / 视图。
//
// 撤销放在画布上，不放在页面按钮栏里——它改的是画布上的东西。
// 「视图」桌面用鼠标悬停展开，触屏没有悬停，所以点击也能切换。

import { html, cls, useEffect, useRef, useState } from '../lib.mjs';

export default function CanvasTools({
  canUndo,
  onUndo,
  showBoxes,
  onToggleBoxes,
  zoom,
  onZoom,
  fillAlpha,
  onFillAlpha,
  grid,
  onGrid,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const timer = useRef(null);
  // 有鼠标才用悬停；手指上没有「移开」这回事，靠点击。
  // 之前两边都挂，结果点一下触发词刚好是「已经悬停展开 → 再点就收」，看着像点了就消失。
  const [hoverable] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches
  );

  function clearTimer() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  function hoverOpen() {
    clearTimer();
    setOpen(true);
  }

  // 移开稍等再收，免得从触发词挪到面板的路上穿过缝隙时闪一下
  function hoverClose() {
    clearTimer();
    timer.current = setTimeout(() => setOpen(false), 180);
  }

  useEffect(() => () => clearTimer(), []);

  // 点面板外面就收；触屏没有 hover，靠这个和点击触发词一起工作
  useEffect(() => {
    if (!open) return;
    const onDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  return html`<div class="canvas-tools" ref=${rootRef}>
    <button
      class="canvas-undo"
      title="撤销（Ctrl+Z）"
      disabled=${!canUndo}
      onClick=${onUndo}
    >
      <span class="undo-mark" aria-hidden="true">↶</span><span class="lbl">撤销</span>
    </button>
    <span class="tools-sep"></span>
    <button
      class=${cls('canvas-toggle', !showBoxes && 'off')}
      title="画布上的格子框、序号和标签要不要显示"
      onClick=${onToggleBoxes}
    >${showBoxes ? '隐藏布局信息' : '展示布局信息'}</button>
    <span class="tools-sep"></span>
    <div class="view-menu" onPointerEnter=${hoverable ? hoverOpen : undefined} onPointerLeave=${hoverable ? hoverClose : undefined}>
      <button class="view-trigger" onClick=${hoverable ? undefined : () => setOpen((v) => !v)}>
        视图<span class="caret">▾</span>
      </button>
      ${open
        ? html`<div class="head-pop">
            <label class="pop-row">
              <span>缩放</span>
              <input type="range" min="0.5" max="3" step="0.05" value=${zoom} onInput=${(e) => onZoom(Number(e.currentTarget.value))} />
              <span class="mono small">${Math.round(zoom * 100)}%</span>
              <button class="btn sm ghost" onClick=${() => onZoom(1)} title="适应画布">适应</button>
            </label>
            <label class="pop-row">
              <span>底色</span>
              <input type="range" min="0" max="1" step="0.05" value=${fillAlpha} onInput=${(e) => onFillAlpha(Number(e.currentTarget.value))} />
              <span class="mono small">${Math.round(fillAlpha * 100)}%</span>
            </label>
            <label class="pop-row">
              <span>网格</span>
              <select class="select" style="width:76px;padding:2px 18px 2px 6px;font-size:11px" value=${grid} onChange=${(e) => onGrid(Number(e.currentTarget.value))}>
                ${[1, 2, 4, 8, 16].map((n) => html`<option value=${n}>${n}px</option>`)}
              </select>
            </label>
          </div>`
        : null}
    </div>
  </div>`;
}
