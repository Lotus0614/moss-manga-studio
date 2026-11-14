// 角色表：项目级人物设定 = 基础外貌 + 任意多个变种（服装 / 裸体 / 年龄阶段）。
// 独立入口，和「项目设置」分开；页面上的角色项只存 ref + variant，外貌从这里取。
// id 一律自动生成，不给手填——它只是存档里的键，用户看的是名字和备注。

import { html, api, apiPut, useState, useEffect, toast } from '../lib.mjs';

function nextId(list, prefix) {
  const used = new Set(list.map((char) => char.id));
  let n = 1;
  while (used.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

const cleanId = (raw) =>
  String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '');

export default function CharactersModal({ slug, open, onClose, onSaved }) {
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !slug) return;
    setList(null);
    api(`/api/projects/${slug}`)
      .then((project) => {
        setList(
          (project.characters || []).map((char) => ({
            ...char,
            variants: (char.variants || []).map((variant) => ({ ...variant })),
          })),
        );
      })
      .catch((err) => toast(err.message, 'bad'));
  }, [open, slug]);

  if (!open) return null;

  const rows = list || [];

  const patch = (index, next) =>
    setList((prev) => prev.map((char, i) => (i === index ? { ...char, ...next } : char)));

  const patchVariant = (index, vIndex, next) =>
    setList((prev) =>
      prev.map((char, i) =>
        i === index
          ? { ...char, variants: char.variants.map((v, j) => (j === vIndex ? { ...v, ...next } : v)) }
          : char,
      ),
    );

  const add = () =>
    setList((prev) => [...prev, { id: nextId(prev, 'char'), name: '', look: '', variants: [] }]);
  const remove = (index) => setList((prev) => prev.filter((_, i) => i !== index));

  const addVariant = (index) =>
    setList((prev) =>
      prev.map((char, i) =>
        i === index
          ? {
              ...char,
              variants: [
                ...(char.variants || []),
                { id: nextId(char.variants || [], 'v'), name: '', look: '', note: '' },
              ],
            }
          : char,
      ),
    );

  const removeVariant = (index, vIndex) =>
    setList((prev) =>
      prev.map((char, i) =>
        i === index ? { ...char, variants: char.variants.filter((_, j) => j !== vIndex) } : char,
      ),
    );

  async function save() {
    const cleaned = [];
    const seen = new Set();
    for (const char of rows) {
      const id = cleanId(char.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const entry = {
        id,
        name: String(char.name || '').trim() || id,
        look: String(char.look || '').trim(),
      };
      const note = String(char.note || '').trim();
      if (note) entry.note = note;
      const variants = [];
      const vSeen = new Set();
      for (const variant of char.variants || []) {
        const vId = cleanId(variant.id);
        const look = String(variant.look || '').trim();
        if (!vId || vSeen.has(vId) || !look) continue;
        vSeen.add(vId);
        const vNote = String(variant.note || '').trim();
        variants.push({
          id: vId,
          name: String(variant.name || '').trim() || vId,
          look,
          ...(vNote ? { note: vNote } : {}),
        });
      }
      if (variants.length) entry.variants = variants;
      cleaned.push(entry);
    }
    setBusy(true);
    try {
      const saved = await apiPut(`/api/projects/${slug}`, { characters: cleaned });
      onSaved?.(saved);
      toast('角色表已保存');
      onClose?.();
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return html`<div class="modal-mask" onClick=${(e) => e.target === e.currentTarget && onClose?.()}>
    <div class="modal wide">
      <header>
        角色表
        <div class="spacer" style="flex:1"></div>
        <button class="btn sm ghost" onClick=${onClose}>关闭</button>
      </header>
      <div class="body">
        <div class="modal-tip">
          基础外貌写永远不变的东西（脸、眼、发、肤色、体型基准）；变种写会变的东西（年龄阶段、服装、裸体、道具），角色框里选完人再选变种。名字用罗马音，提示词里的汉字会被画到画面上。
        </div>

        ${list === null
          ? html`<div class="hint">读取中…</div>`
          : rows.length
            ? html`<div class="cast-list">
                ${rows.map(
                  (char, i) => html`<section class="cast-card" key=${char.id + i}>
                    <header class="cast-head">
                      <span class="cast-id">${char.id}</span>
                      <input
                        class="input"
                        style="flex:1;min-width:0"
                        placeholder="CHARACTER ONE - SHION"
                        value=${char.name}
                        onInput=${(e) => patch(i, { name: e.currentTarget.value })}
                      />
                      <input
                        class="input"
                        style="max-width:190px"
                        placeholder="备注（中文，只给自己看）"
                        value=${char.note || ''}
                        onInput=${(e) => patch(i, { note: e.currentTarget.value })}
                      />
                      <button class="btn sm ghost" title="删除角色" onClick=${() => remove(i)}>删除</button>
                    </header>

                    <div class="cast-body">
                      <div class="cast-block base">
                        <span class="cast-label">基础外貌 · 永远不变</span>
                        <textarea
                          class="textarea"
                          style="min-height:56px"
                          placeholder="英文：发型、五官、肤色、体型"
                          value=${char.look}
                          onInput=${(e) => patch(i, { look: e.currentTarget.value })}
                        ></textarea>
                      </div>

                      <div class="cast-block variants">
                        <span class="cast-label">
                          变种 <span class="cast-id">${(char.variants || []).length}</span>
                        </span>
                        ${(char.variants || []).map(
                          (variant, j) => html`<div class="cast-variant" key=${variant.id + j}>
                            <div class="row" style="gap:6px;align-items:center">
                              <span class="cast-id">${variant.id}</span>
                              <input
                                class="input"
                                style="flex:1;min-width:0"
                                placeholder="NUDE 15"
                                value=${variant.name}
                                onInput=${(e) => patchVariant(i, j, { name: e.currentTarget.value })}
                              />
                              <input
                                class="input"
                                style="max-width:190px"
                                placeholder="备注（中文，只给自己看）"
                                value=${variant.note || ''}
                                onInput=${(e) => patchVariant(i, j, { note: e.currentTarget.value })}
                              />
                              <button class="btn sm ghost" title="删除变种" onClick=${() => removeVariant(i, j)}>×</button>
                            </div>
                            <textarea
                              class="textarea"
                              style="min-height:44px"
                              placeholder="英文：15 years old, slim, medium breasts, completely naked"
                              value=${variant.look}
                              onInput=${(e) => patchVariant(i, j, { look: e.currentTarget.value })}
                            ></textarea>
                          </div>`,
                        )}
                        <div class="row">
                          <button class="btn sm ghost" onClick=${() => addVariant(i)}>＋ 变种</button>
                        </div>
                      </div>
                    </div>
                  </section>`,
                )}
              </div>`
            : html`<div class="hint">还没有角色。先在这里定义主角，页面上才能选。</div>`}

        <div class="row">
          <button class="btn ghost" onClick=${add}>＋ 角色</button>
        </div>
      </div>
      <footer>
        <button class="btn ghost" onClick=${onClose}>取消</button>
        <button class="btn inv" disabled=${busy || list === null} onClick=${save}>${busy ? '保存中…' : '保存'}</button>
      </footer>
    </div>
  </div>`;
}
