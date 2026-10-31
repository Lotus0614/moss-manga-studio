// Moss Layout JSON → 页面文档（尽力而为）。
// 用途：导入别人给的 JSON、从历史提示词还原成可编辑页面。
// label=text → bubble；label=object → panel；其它（character 等）→ native 原样保留。

import {
  createPage,
  createPanelItem,
  createBubbleItem,
  createNativeItem,
  fromMoss,
  normalizePage,
  DEFAULT_SIZE,
} from './manga-doc.mjs';

const SHAPE_HINTS = [
  [/full-bleed|covering the whole page/i, 'bleed-all'],
  [/bleeding off the (top)/i, 'bleed-top'],
  [/bleeding off the (bottom)/i, 'bleed-bottom'],
  [/bleeding off the (left)/i, 'bleed-left'],
  [/bleeding off the (right)/i, 'bleed-right'],
  [/circular/i, 'circle'],
  [/slanted top/i, 'slant-top'],
  [/slanted side|angled slanted/i, 'slant-side'],
];

const BUBBLE_HINTS = [
  [/jagged\s+explosive/i, 'shout'],
  [/cloud-shaped|scalloped/i, 'thought'],
  [/dashed/i, 'heart'],
  [/shaky\s+wavy/i, 'tremble'],
  [/three tiny circles/i, 'whisper'],
  [/sound effect/i, 'sfx'],
  [/narration|directly on the artwork/i, 'narration'],
];

export function decompile(input, size = DEFAULT_SIZE) {
  const doc = typeof input === 'string' ? JSON.parse(input) : input;
  const dims = Array.isArray(size) ? size : [size.width, size.height];
  const pageSizeValue = { width: dims[0] || DEFAULT_SIZE[0], height: dims[1] || DEFAULT_SIZE[1] };
  const page = createPage({ size: [pageSizeValue.width, pageSizeValue.height] });
  // 原产物里的整段 summary 走「整段覆盖」，重新编译时才不会被自动骨架改写；
  // page.note 只是给人看的备注，不进提示词，所以这里放一句导入提示。
  page.summaryCaption = doc.summary?.caption || '';

  page.items = (doc.items || []).map((item) => {
    const bbox = fromMoss(item.bbox, pageSizeValue);
    if (item.label === 'text') {
      return createBubbleItem({
        bbox,
        kind: guessBubbleType(item.caption),
        text: item.text || '',
      });
    }
    if (item.label === 'object') {
      return createPanelItem({
        bbox,
        shape: guessShape(item.caption),
        frame: /no border/i.test(item.caption || '') ? 'none' : 'border',
        desc: stripMeta(item.caption || ''),
      });
    }
    return createNativeItem({
      bbox,
      label: item.label || 'object',
      caption: item.caption || '',
      ...(item.text ? { text: item.text } : {}),
    });
  });

  page.note = '由 Moss JSON 导入，形状与气泡类型为自动推断，需要手动校正。';
  return normalizePage(page);
}

function guessShape(caption = '') {
  for (const [re, shape] of SHAPE_HINTS) if (re.test(caption)) return shape;
  return 'rect';
}

function guessBubbleType(caption = '') {
  for (const [re, type] of BUBBLE_HINTS) if (re.test(caption)) return type;
  return 'speech';
}

function stripMeta(caption) {
  // 老产物会带 `This box contains only:` 前缀，剥掉它留下的就是作者写的画面描述
  const m = caption.match(/This box contains only:\s*(.+)$/i);
  if (m) return m[1].replace(/\s*,\s*$/, '').trim();
  // 编译产物里若不是作者内容，就是「形状 + 边框 + 机位」这类套话，直接清空
  if (/rectangular panel|trapezoid panel|panel bleeding|circular panel|panel border|no border/i.test(caption)) return '';
  return caption.replace(/\s*,\s*$/, '').trim();
}
