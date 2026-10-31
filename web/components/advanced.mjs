// 右栏「高级选项」折叠块。
// 哪些字段算高级由 config/manga.mjs 的字段声明决定（advanced: true），这里不认识具体字段名：
// meta / caption / tags / palette 收进来，是为了让右栏默认只剩「这一格画什么」那几项。

import { html, useState } from '../lib.mjs';

/** 拆成 [常用字段, 高级字段]，保持原来的先后顺序 */
export function splitFields(fields = []) {
  return [fields.filter((field) => !field.advanced), fields.filter((field) => field.advanced)];
}

/** 有值就算「填过」：数组看长度，字符串看是否只剩空白 */
function hasValue(value) {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}

/** 高级字段里已经填了几项——收起来时靠这个数字提示「下面还有东西」 */
export function countFilled(fields, source) {
  return fields.filter((field) => hasValue(source?.[field.key])).length;
}

/**
 * 折叠容器：默认收起；当前这页/这格本来就有高级字段值时默认展开，避免藏起来看不见。
 * 用 state 控制 open，所以用户手动收起后不会因为改字又被弹开。
 * 记得传 key（页面 id / item id）：换一个对象时重新按它自己的值决定展开还是收起。
 */
export default function AdvancedBox({ fields = [], source, children }) {
  const filled = countFilled(fields, source);
  const [open, setOpen] = useState(filled > 0);

  return html`<details
    class="adv"
    open=${open}
    onToggle=${(e) => {
      const next = e.currentTarget.open;
      if (next !== open) setOpen(next);
    }}
  >
    <summary>
      <span class="tri"></span>
      <span>高级选项</span>
      <span class="adv-note">MOSS Layout JSON 原生参数</span>
      ${filled ? html`<span class="adv-badge">已填 ${filled}</span>` : null}
    </summary>
    <div class="adv-body">${children}</div>
  </details>`;
}
