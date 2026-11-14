// 元素属性表单：完全由 config/manga.mjs 的字段声明生成，代码里不出现任何具体字段名。
// 加一个新类型/新字段，这里自动多出对应控件。标了 advanced 的收进「高级选项」。

import { html, cls } from '../lib.mjs';
import { fieldsOf, itemType, optionsOf, fieldHint } from '../../config/manga.mjs';
import AdvancedBox, { splitFields } from './advanced.mjs';

const TYPE_LABEL = (key) => itemType(key)?.label || key;

/** 一个字段的控件：页面属性和格子属性共用这一份，type 决定长相 */
export function Field({ field, value, onChange, characters, item }) {
  const label = html`<label>${field.label}${field.required ? html`<span class="req">*</span>` : null}</label>`;
  // 动态选项（角色、变种）要拿到当前这一格和项目角色表
  const ctx = { item, characters: characters || [] };

  if (field.type === 'bool') {
    // 没写过的布尔值按字段的 default 算（横排默认开，solo 这类默认关）
    const on = value === undefined ? (field.default ?? true) : value !== false;
    return html`<div class="field">
      ${label}
      <label class="row" style="gap:6px;align-items:center">
        <input type="checkbox" checked=${on} onChange=${(e) => onChange(e.currentTarget.checked)} />
        <span class="hint">${on ? '开启' : '关闭'}</span>
      </label>
    </div>`;
  }

  if (field.type === 'enum') {
    const options = optionsOf(field, ctx);
    const hint = fieldHint(field, ctx);
    return html`<div class="field">
      ${label}
      <select
        class="select"
        value=${value ?? field.default ?? ''}
        onChange=${(e) => onChange(e.currentTarget.value === '' ? undefined : e.currentTarget.value)}
      >
        ${options.map((option) => html`<option value=${option.value}>${option.label}</option>`)}
        <option value="">✕ 清空</option>
      </select>
      ${hint ? html`<span class="hint">${hint}</span>` : null}
    </div>`;
  }

  if (field.type === 'number') {
    return html`<div class="field">
      ${label}
      <input class="input" type="number" value=${value ?? ''} onInput=${(e) => onChange(e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value))} />
    </div>`;
  }

  if (field.type === 'longtext') {
    return html`<div class="field">
      ${label}
      <textarea class="textarea" style="min-height:96px" value=${value ?? ''} onInput=${(e) => onChange(e.currentTarget.value)}></textarea>
    </div>`;
  }

  if (field.type === 'tags') {
    return html`<div class="field">
      ${label}
      <input
        class="input"
        value=${(value || []).join(' ')}
        placeholder="3–6 个英文短词"
        onInput=${(e) => onChange(e.currentTarget.value.split(/[\s,]+/).filter(Boolean))}
      />
    </div>`;
  }

  if (field.type === 'palette') {
    const list = value || [];
    return html`<div class="field">
      ${label}
      <div class="row wrap">
        ${list.map(
          (hex, i) => html`<span class="swatch" key=${hex + i}>
            <input
              type="color"
              value=${hex}
              onInput=${(e) => {
                const next = [...list];
                next[i] = e.currentTarget.value.toUpperCase();
                onChange(next);
              }}
            />
            <button class="swatch-x" onClick=${() => onChange(list.filter((_, j) => j !== i))}>×</button>
          </span>`
        )}
        ${list.length < 5 ? html`<button class="chip" onClick=${() => onChange([...list, '#000000'])}>＋ 颜色</button>` : null}
      </div>
    </div>`;
  }

  return html`<div class="field">
    ${label}
    <input class="input" value=${value ?? ''} onInput=${(e) => onChange(e.currentTarget.value)} />
  </div>`;
}

/** 单个元素：字段由注册表决定，全部展示（右栏不做可见性过滤），高级字段折叠 */
export default function ItemForm({ item, patchItem, removeItem, onBack, onCopy, characters }) {
  const [basicFields, advancedFields] = splitFields(fieldsOf(item.type));
  // 换角色时顺手切到它的第一个变种：不然会留下「有角色、没年龄没衣服」的空壳
  const changeField = (field, value) => {
    if (field.key !== 'ref') return patchItem(item.id, { [field.key]: value });
    const owner = (characters || []).find((char) => char.id === value);
    const first = Array.isArray(owner?.variants) ? owner.variants[0]?.id : '';
    return patchItem(item.id, { ref: value, variant: first || '' });
  };
  const renderField = (field) => html`<${Field}
    key=${field.key}
    field=${field}
    item=${item}
    value=${item[field.key]}
    characters=${characters}
    onChange=${(v) => changeField(field, v)}
  />`;

  return html`<div class="col">
    <div class="row">
      <button class="btn sm ghost" onClick=${onBack}>← 返回</button>
      <span class="tag">${TYPE_LABEL(item.type)}</span>
      <div class="spacer"></div>
      <button class="btn sm ghost" onClick=${onCopy}>复制</button>
      <button class="btn sm ghost" onClick=${() => removeItem(item.id)}>删除</button>
    </div>

    <div class="field">
      <label>坐标 x1 / y1 / x2 / y2</label>
      <div class="row">
        ${item.bbox.map(
          (v, i) => html`<input
            class="input"
            type="number"
            style="width:25%"
            value=${Math.round(v)}
            onInput=${(e) => {
              const bbox = [...item.bbox];
              bbox[i] = Number(e.currentTarget.value);
              patchItem(item.id, { bbox });
            }}
          />
        `)}
      </div>
    </div>

    ${basicFields.map(renderField)}

    ${advancedFields.length
      ? html`<${AdvancedBox} key=${item.id} fields=${advancedFields} source=${item}>
          ${advancedFields.map(renderField)}
        </${AdvancedBox}>`
      : null}
  </div>`;
}
