// 右上角「⋯」菜单（只有手机形态显示）。
//
// 手机上没有顶栏，项目级动作（角色表 / 项目设置 / 项目列表 / 夜间 / 设置）
// 集中挂到这里；导出仍然在页面抽屉里，那是页面级动作。

import { html, cls, useEffect, useRef, useState } from '../lib.mjs';

export default function AppMenu({ items = [] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  // 点外面 / Esc 收起
  useEffect(() => {
    if (!open) return;
    const onDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return html`<div class="app-menu" ref=${rootRef}>
    <button class="app-menu-btn" title="更多" onClick=${() => setOpen((value) => !value)}>⋯</button>
    ${open
      ? html`<div class="app-menu-pop">
          ${items.map((item) =>
            item.sep
              ? html`<div class="app-menu-sep" key="sep"></div>`
              : html`<button
                  class=${cls('app-menu-item', item.on && 'on')}
                  key=${item.label}
                  onClick=${() => {
                    setOpen(false);
                    item.onClick?.();
                  }}
                >
                  <span>${item.label}</span>
                </button>`
          )}
        </div>`
      : null}
  </div>`;
}
