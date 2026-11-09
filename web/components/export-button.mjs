// 「导出」按钮：桌面上在画布头，手机上在页面抽屉的页脚。
// 两处都渲染、由断点决定显示哪一个，省得把 openExport 的接线写两遍。

import { html, cls } from '../lib.mjs';

export default function ExportButton({ onOpen, className = '' }) {
  return html`<button class=${cls('btn ghost', className)} onClick=${onOpen}>导出</button>`;
}
