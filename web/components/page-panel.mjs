// 右栏：页面属性。字段来自 config/manga.mjs 的 PAGE，加字段不用改这里。
// 「本页角色」勾选直接增删 character 项——一页有谁是单一真相，不再存第二套列表。
// 标了 advanced 的字段（summary.meta / summary.caption）收在「高级选项」里。
// 控件和格子表单共用 item-form 的 Field：tags / palette 这类才不会被当成文本框。

import { html, toast } from '../lib.mjs';
import { PAGE, itemType } from '../../config/manga.mjs';
import { createItem } from '../../core/manga-doc.mjs';
import { Field } from './item-form.mjs';
import AdvancedBox, { splitFields } from './advanced.mjs';

export default function PagePanel({ page, mutate, setSelection, characters = [] }) {
  const countOf = (id) => page.items.filter((it) => it.type === 'character' && it.ref === id).length;
  const [basicFields, advancedFields] = splitFields(PAGE);
  const renderField = (field) => html`<${Field}
    key=${field.key}
    field=${field}
    value=${page[field.key]}
    onChange=${(v) => mutate({ [field.key]: v })}
  />`;

  function toggleCharacter(id, on) {
    const before = countOf(id);
    mutate((cur) => {
      const items = cur.items || [];
      if (on) {
        const n = items.filter((it) => it.type === 'character').length;
        const bbox = [40 + (n % 4) * 36, 900 + (n % 3) * 28, 300 + (n % 4) * 36, 1240 + (n % 3) * 28];
        return { ...cur, items: [...items, createItem('character', { ref: id, bbox })] };
      }
      return {
        ...cur,
        items: items.filter((it) => !(it.type === 'character' && it.ref === id)),
      };
    });
    // 一页摆了好几处时，取消勾选会把它们一起撤掉——说清楚删了几个
    if (!on && before > 1) {
      const name = characters.find((char) => char.id === id)?.name || id;
      toast(`「${name}」在本页的 ${before} 处都撤掉了，Ctrl+Z 可撤回`);
    }
  }

  return html`<div class="col">
    ${basicFields.map(renderField)}

    ${advancedFields.length
      ? html`<${AdvancedBox} key=${page.id} fields=${advancedFields} source=${page}>
          ${advancedFields.map(renderField)}
        </${AdvancedBox}>`
      : null}

    <div class="divider"></div>
    <span class="label">本页角色</span>
    ${characters.length
      ? html`<div class="col" style="gap:3px">
          ${characters.map((char) => {
            const n = countOf(char.id);
            return html`<label class="rowitem" key=${char.id} style="cursor:pointer">
              <input
                type="checkbox"
                checked=${n > 0}
                onChange=${(e) => toggleCharacter(char.id, e.currentTarget.checked)}
              />
              <span class="grow ellipsis">${char.name}</span>
              <span class="mono small">${n > 1 ? `×${n}` : char.id}</span>
            </label>`;
          })}
        </div>`
      : html`<span class="hint">项目还没有角色，点顶栏「角色表」添加。</span>`}

    <div class="divider"></div>
    <span class="label">本页内容（点选编辑）</span>
    <div class="col" style="gap:3px">
      ${page.items.length
        ? page.items.map(
            (it, i) => html`<div class="rowitem" onClick=${() => setSelection({ kind: it.type, id: it.id })}>
              <span class="mono small">${itemType(it.type)?.label || it.type}${it.type === 'panel' ? i + 1 : ''}</span>
              <span class="grow ellipsis">${(it.text || it.caption || it.ref || '（空）').slice(0, 40)}</span>
            </div>`
          )
        : html`<span class="hint">还没有内容，用画布右下角的按钮加一个。</span>`}
    </div>
  </div>`;
}
