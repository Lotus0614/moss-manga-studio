// 页面动作：修图 / 生成。
//
// 桌面挂在画布头右侧，手机挂在下方格子头的右侧——同一份实现两处挂载，
// 哪一处可见由 CSS 断点决定，不复制逻辑。

import { html } from '../lib.mjs';

export default function PageActions({
  canEdit,
  editing,
  generating,
  queuedHere,
  disabledEdit,
  disabledGenerate,
  editTitle,
  onEdit,
  onGenerate,
}) {
  return html`<div class="page-actions">
    ${canEdit
      ? html`<button
          class="btn accent"
          disabled=${disabledEdit}
          title=${editTitle}
          onClick=${onEdit}
        >
          ${editing ? '修图中…' : '修图'}
        </button>`
      : null}
    <button class="btn inv" disabled=${disabledGenerate} onClick=${onGenerate}>
      ${generating && !editing ? (queuedHere ? '排队中' : '生成中…') : '生成'}
    </button>
  </div>`;
}
