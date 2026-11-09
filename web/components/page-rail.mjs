// 页面列表。桌面上是左侧第一栏，手机上是从左上角按钮滑出的抽屉，
// 同一个组件：`.rail` 的定位由 CSS 断点决定，`open` 只控制抽屉展开。

import { html, cls } from '../lib.mjs';

export default function PageRail({ pages, pageId, open = false, menu = [], onPick, onAdd, onRemove, onOpenExport, onClose }) {
  return html`<aside class=${cls('rail', open && 'open')}>
    <div class="rail-head">
      <span>页面</span>
      <div class="spacer"></div>
      <span class="rail-count mono">${pages.length}</span>
      ${onClose
        ? html`<button class="rail-close" title="关闭" onClick=${onClose}>✕</button>`
        : null}
    </div>

    <div class="rail-list">
      ${pages.map(
        (p) => html`<div class=${cls('pg', p.id === pageId && 'on')} key=${p.id} onClick=${() => onPick(p.id)}>
          <span class="n">${String(p.index).padStart(2, '0')}</span>
          <div class="thumb">
            ${p.cover ? html`<img src=${p.cover} alt="" loading="lazy" />` : html`<span class="ghost">${p.items}项</span>`}
          </div>
        </div>`
      )}
    </div>

    <div class="rail-foot">
      <button class="btn sm grow" onClick=${onAdd}>＋ 新页</button>
      <button class="btn sm ghost" onClick=${onRemove}>删</button>
      ${onOpenExport
        ? html`<button class="btn sm ghost rail-export" onClick=${onOpenExport}>导出</button>`
        : null}
    </div>

    ${menu.length
      ? html`<div class="rail-project">
          <div class="rail-project-head">项目</div>
          ${menu.map(
            (item) => html`<button class=${cls('rail-menu-item', item.on && 'on')} onClick=${item.onClick}>${item.label}</button>`
          )}
        </div>`
      : null}
  </aside>`;
}
