// 角色表：项目里的人物设定只在这里解释。
//
// 约定（唯一出处）：
//   project.characters = [{
//     id: 'hikari', name: 'CHARACTER TWO - HIKARI', look: '1girl, long straight hair, …',
//     note: '光莉，主角（只给人看）',
//     variants: [{ id: '15_nude', name: 'NUDE 15', look: '15 years old, completely naked', note: '15 岁、裸体' }],
//   }]
//   page.items[] 里 type = 'character' 的项只存 ref + variant + caption（+ bbox），不存外貌。
//
// 基础 look 只放「永不变」的东西（脸、眼、发、肤色、体型基准）；
// 年龄、服装、裸体、道具这些会变的全塞进 variants。一个角色 → 任意多个变种。
// 角色项不给 variant 就只用基础 look（老数据、没差分的角色照旧能跑）。
//
// config/manga.mjs 不认识这个结构：它只拿到一个 resolveCharacter(ref, variant) 回调，
// 提示词怎么拼是 config 的事，数据从哪来是这里的事。

/** 项目角色表（永远返回数组） */
export function projectCharacters(project) {
  return Array.isArray(project?.characters) ? project.characters : [];
}

/** id 清洗：小写 ASCII，页面里的 ref / variant 永远是这个形状 */
function cleanId(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '');
}

/** 一个角色的变种数组（永远返回数组） */
export function variantsOf(character) {
  return Array.isArray(character?.variants) ? character.variants : [];
}

/** 按 id 找变种，找不到返回 null */
export function variantOf(character, variantId) {
  if (!variantId) return null;
  return variantsOf(character).find((variant) => variant.id === variantId) || null;
}

/**
 * 按 id 找角色，找不到返回 null。
 * 给了变种就用「基础 + 变种」拼出来的影子角色（name 带变种标、look 是合并后的），
 * 这样 config 里的 castLine 只读 name / look，不用知道变种的存在。
 *
 * 变种 id 给了但不存在 → 返回基础角色，并挂一个 missingVariant，让编译器报 warn。
 */
export function characterById(project, id, variantId) {
  if (!id) return null;
  const char = projectCharacters(project).find((item) => item.id === id) || null;
  if (!char) return null;
  if (!variantId) return char;

  const variant = variantOf(char, variantId);
  if (!variant) return { ...char, missingVariant: String(variantId) };

  const base = String(char.look || '').trim();
  const extra = String(variant.look || '').trim();
  return {
    ...char,
    variant: variant.id,
    name: `${char.name} (${variant.name || variant.id})`,
    look: [base, extra].filter(Boolean).join(', '),
  };
}

/** 本页用到的角色 id（去重，按出场顺序）——给 UI 做"本页角色"勾选用 */
export function characterRefsOfPage(page) {
  const seen = new Set();
  const ids = [];
  for (const item of page?.items || []) {
    if (item.type !== 'character' || !item.ref || seen.has(item.ref)) continue;
    seen.add(item.ref);
    ids.push(item.ref);
  }
  return ids;
}

/** 存盘前的清洗：id 转小写 ASCII、去重、只保留 id/name/look/note/variants */
export function normalizeCharacters(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const id = cleanId(raw?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = String(raw?.name || '').trim() || id;
    const look = String(raw?.look || '').trim();
    const note = String(raw?.note || '').trim();
    const entry = { id, name, look };
    if (note) entry.note = note;
    const variants = normalizeVariants(raw?.variants);
    if (variants.length) entry.variants = variants;
    out.push(entry);
  }
  return out;
}

/** 变种的清洗：同角色内 id 去重、没有 look 的丢掉 */
export function normalizeVariants(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const id = cleanId(raw?.id);
    if (!id || seen.has(id)) continue;
    const look = String(raw?.look || '').trim();
    if (!look) continue;
    seen.add(id);
    const name = String(raw?.name || '').trim() || id;
    const note = String(raw?.note || '').trim();
    out.push({ id, name, look, ...(note ? { note } : {}) });
  }
  return out;
}
