// items → Moss Layout JSON 的通用 walker。
//
// 内核不认识任何漫画概念：类型、写法、summary 全从配置管理器取。
//   类型与 buildSummary 来自 config/manga.mjs。

import { pageSize, toMoss } from './manga-doc.mjs';
import { itemType, buildSummary } from '../config/manga.mjs';
import { characterById } from './characters.mjs';
import { validatePage } from './validate.mjs';

export function compilePage(page, project = null) {
  const size = pageSize(page);
  const items = [];
  // config 只拿到这个回调，不认识 project 结构；变种合并在 characters.mjs 里做完
  const resolveCharacter = (ref, variant) => characterById(project, ref, variant);

  for (const item of page.items || []) {
    const type = itemType(item.type);
    if (!type) continue;
    const compiled = type.compile({ item, page, resolveCharacter });
    // compile 返回空值 = 这一项还不完整（例如角色项没选人），跳过
    if (!compiled) continue;

    // native 的字段优先：label 显式给了就用，caption 非空就整段接管（其余拼出来的全让位）
    const override = String(item.caption || '').trim();
    const out = {
      label: item.label || compiled.label,
      caption: override || compiled.caption,
      bbox: toMoss(item.bbox, size),
    };
    if (compiled.text) out.text = compiled.text;
    if (Array.isArray(item.tags) && item.tags.length) out.tags = item.tags;
    if (Array.isArray(item.palette) && item.palette.length) out.palette = item.palette;
    items.push(out);
  }

  const doc = {
    summary: buildSummary({ page, items, resolveCharacter }),
    items,
    bbox_coord_space: 'abs_centralized',
    bbox_format: 'yxyx',
  };

  const json = JSON.stringify(doc);
  const warnings = validatePage(page, doc);
  // 角色/变种对不上只提醒，不拦渲染：角色项自身没有外貌，回退到基础 look 照样能出图
  for (const item of page.items || []) {
    if (item.type !== 'character' || !item.ref) continue;
    const char = characterById(project, item.ref, item.variant);
    if (!char) {
      if (project) {
        warnings.push({
          level: 'warn',
          code: 'character.ref',
          message: `角色「${item.ref}」不在角色表里，这一格只能靠 desc 自己描述`,
          target: item.id,
        });
      }
      continue;
    }
    if (char.missingVariant) {
      warnings.push({
        level: 'warn',
        code: 'character.variant',
        message: `角色「${item.ref}」没有变种「${char.missingVariant}」，已回退到基础外貌`,
        target: item.id,
      });
    }
  }
  return {
    doc,
    json,
    warnings,
    stats: {
      items: items.length,
      chars: doc.summary.caption.length,
      bytes: new TextEncoder().encode(json).length,
    },
  };
}
