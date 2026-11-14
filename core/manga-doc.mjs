// 漫画页面文档（v3）：单层 items。
//
// 页面只有一串 items，每个 item 用 type 区分：
//   panel  —— 一个分格：坐标、形状、边框、机位、画面描述
//   bubble —— 一条文字：坐标、气泡类型、原文、排版
//   native —— 原生 Moss item：直接给 label/caption/text，绕过语义层（逃生口）
//
// 坐标一律「左上原点、绝对像素 [x1,y1,x2,y2]」；只有 toMoss() 做中心原点 yxyx 转换。
// 尺寸必须是 16 的倍数，W/2 与 H/2 才是整数。

export const GRID = 16;
export const DEFAULT_SIZE = [768, 1280];

export const SIZE_PRESETS = {
  page: { name: '分镜页 768×1280', size: [768, 1280], manga: true },
  'page-hd': { name: '分镜页高清 1152×1920', size: [1152, 1920], manga: true },
  square: { name: '方图 1024×1024', size: [1024, 1024], manga: false },
  wide: { name: '横版 1536×1024', size: [1536, 1024], manga: false },
};

// ---------------------------------------------------------------- 基础工具

import { pageField, itemType, optionsOf, fieldsOf } from '../config/manga.mjs';

/** 画风取值校验：以注册的页面字段为准，认不出就退回默认 */
function isValidStyle(value) {
  return optionsOf(pageField('style')).some((option) => option.value === value);
}

let seq = 0;
export function uid(prefix = 'id') {
  seq = (seq + 1) % 100000;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function now() {
  return new Date().toISOString();
}

export function isGrid(value, grid = GRID) {
  return Number.isInteger(value) && value % grid === 0;
}

export function pageSize(page) {
  const raw = page?.size;
  if (Array.isArray(raw)) {
    const [w, h] = raw;
    if (isGrid(w) && isGrid(h)) return { width: w, height: h };
  } else if (raw && typeof raw === 'object') {
    if (isGrid(raw.width) && isGrid(raw.height)) return { width: raw.width, height: raw.height };
  }
  return { width: DEFAULT_SIZE[0], height: DEFAULT_SIZE[1] };
}

/** 全局竖排开关（页面级），单个 item 可用自己的 vertical 覆盖 */
export function isVertical(page, item) {
  if (typeof item?.vertical === 'boolean') return item.vertical;
  return page?.vertical !== false;
}

// ---------------------------------------------------------------- 坐标

export function toMoss(bbox, size) {
  const [x1, y1, x2, y2] = bbox;
  const dx = size.width / 2;
  const dy = size.height / 2;
  const l = Math.floor(Math.min(x1, x2));
  const t = Math.floor(Math.min(y1, y2));
  const r = Math.ceil(Math.max(x1, x2));
  const b = Math.ceil(Math.max(y1, y2));
  return [t - dy, l - dx, b - dy, r - dx];
}

export function fromMoss(mossBbox, size) {
  const [a, c, d, e] = mossBbox;
  const dx = size.width / 2;
  const dy = size.height / 2;
  return [c + dx, a + dy, e + dx, d + dy];
}

export function normalizeBbox(bbox, size = { width: DEFAULT_SIZE[0], height: DEFAULT_SIZE[1] }) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return [0, 0, size.width, size.height];
  const nums = bbox.map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0));
  const [x1, y1, x2, y2] = nums;
  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
}

export function bboxArea(bbox) {
  const [x1, y1, x2, y2] = bbox;
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

export function bboxCenter(bbox) {
  const [x1, y1, x2, y2] = bbox;
  return [(x1 + x2) / 2, (y1 + y2) / 2];
}

// ---------------------------------------------------------------- item 工厂

export function createPanelItem(patch = {}) {
  return {
    type: 'panel',
    id: uid('pn'),
    bbox: [8, 8, 760, 420],
    shape: 'rect',
    frame: 'border',
    camera: 'medium',
    desc: '',
    ...patch,
  };
}

export function createBubbleItem(patch = {}) {
  return {
    type: 'bubble',
    id: uid('bb'),
    bbox: [40, 40, 240, 140],
    kind: 'speech',
    text: '',
    size: 22,
    // vertical 不写 = 跟随页面全局
    ...patch,
  };
}

export function createNativeItem(patch = {}) {
  return {
    type: 'native',
    id: uid('nt'),
    bbox: [0, 0, 768, 1280],
    label: 'object',
    caption: '',
    ...patch,
  };
}

export function createCharacterItem(patch = {}) {
  return {
    type: 'character',
    id: uid('ch'),
    bbox: [40, 900, 300, 1240],
    ref: '',
    variant: '',
    ...patch,
  };
}

export function createItem(type = 'panel', patch = {}) {
  if (type && typeof type === 'object') {
    patch = type;
    type = patch.type || 'panel';
  }
  if (type === 'bubble') return createBubbleItem(patch);
  if (type === 'native') return createNativeItem(patch);
  if (type === 'character') return createCharacterItem(patch);
  return createPanelItem(patch);
}

export function createPage(patch = {}) {
  const size = Array.isArray(patch.size) ? patch.size : DEFAULT_SIZE;
  return {
    id: uid('pg'),
    index: 1,
    title: '',
    rev: 0,
    version: SCHEMA_VERSION,
    size,
    style: 'mono',
    vertical: true,
    scene: '',
    note: '',
    summaryMeta: [],
    summaryCaption: '',
    items: [],
    ...patch,
  };
}

// ---------------------------------------------------------------- 归一化

/** 页面格式版本：v2 起「画面描述」叫 desc，caption 变成整段覆盖 */
export const SCHEMA_VERSION = 2;

/** v1 → v2：把旧的 caption（当时是画面描述）搬到 desc，caption 留空 */
function migrateItems(items) {
  return items.map((item) => {
    if (!item || item.type === 'native' || item.desc !== undefined || !item.caption) return item;
    const { caption, ...rest } = item;
    return { ...rest, desc: caption };
  });
}

function normalizeBubbleItem(b) {
  return {
    type: 'bubble',
    id: b.id || uid('bb'),
    bbox: b.bbox,
    kind: b.kind || b.bubbleType || 'speech',
    text: String(b.text || ''),
    size: Number(b.size || b.fontSize) || 22,
    ...(typeof b.vertical === 'boolean' ? { vertical: b.vertical } : {}),
    ...(b.desc ? { desc: String(b.desc) } : {}),
    ...common(b),
  };
}

/** 兼容 v1/v2：panels + bubbles 两套数组会被合并进 items */
export function normalizePage(raw = {}) {
  const size = pageSize(raw);
  const style = typeof raw.style === 'string' ? raw.style : raw.style?.preset;
  const version = Number(raw.version) || 1;

  let items = [];
  if (Array.isArray(raw.items)) {
    items = (version >= SCHEMA_VERSION ? raw.items : migrateItems(raw.items)).map((it) => normalizeItem(it, size));
  } else {
    // v2 存档迁移
    for (const p of raw.panels || []) {
      items.push(
        normalizeItem(
          {
            type: 'panel',
            id: p.id,
            bbox: p.bbox,
            shape: p.shape,
            frame: p.frame,
            camera: p.camera,
            caption: p.caption,
          },
          size
        )
      );
    }
    for (const b of raw.bubbles || []) {
      items.push(
        normalizeItem(
          {
            type: 'bubble',
            id: b.id,
            bbox: b.bbox,
            kind: b.type || b.kind,
            text: b.text,
            size: b.size || b.fontSize,
            vertical: b.vertical,
          },
          size
        )
      );
    }
  }

  const page = {
    id: raw.id || uid('pg'),
    index: Number(raw.index) || 1,
    title: String(raw.title || ''),
    rev: Number(raw.rev) || 0,
    version: SCHEMA_VERSION,
    size: [size.width, size.height],
    style: isValidStyle(style) ? style : 'mono',
    vertical: raw.vertical !== false,
    scene: String(raw.scene || ''),
    note: String(raw.note || ''),
    summaryMeta: Array.isArray(raw.summaryMeta) ? raw.summaryMeta.map(String) : [],
    summaryCaption: String(raw.summaryCaption || ''),
    items,
  };
  return page;
}

/** 所有格子共用的可选字段：备注、整段覆盖、tags / palette */
function common(raw) {
  const out = {};
  if (raw?.note) out.note = String(raw.note);
  if (raw?.caption) out.caption = String(raw.caption);
  if (Array.isArray(raw?.tags) && raw.tags.length) out.tags = raw.tags.map(String);
  if (Array.isArray(raw?.palette) && raw.palette.length) out.palette = raw.palette.map(String);
  return out;
}

function normalizeItem(raw = {}, size) {
  const bbox = normalizeBbox(raw.bbox, size);
  // 注册表里新增的类型：不认识也原样保留，别改写成 panel
  if (!itemType(raw.type)) {
    if (typeof raw.type === 'string' && raw.type) {
      return { ...raw, id: raw.id || uid('it'), bbox };
    }
  }
  const type = raw.type;
  if (type === 'bubble') return normalizeBubbleItem({ ...raw, bbox });
  if (type === 'native') {
    return {
      type: 'native',
      id: raw.id || uid('nt'),
      bbox,
      label: ['object', 'text', 'character'].includes(raw.label) ? raw.label : 'object',
      ...(raw.text ? { text: String(raw.text) } : {}),
      ...common(raw),
    };
  }
  if (type && type !== 'panel') {
    // 配置里注册的非 panel 类型（如 character）：按字段表保留，别退化成面板
    const kept = { type, id: raw.id || uid(type.slice(0, 2)), bbox };
    for (const field of fieldsOf(type)) {
      const value = raw[field.key];
      if (value === undefined || value === null || value === '') continue;
      kept[field.key] = typeof value === 'string' ? String(value) : value;
    }
    return { ...kept, ...common(raw) };
  }
  return {
    type: 'panel',
    id: raw.id || uid('pn'),
    bbox,
    shape: raw.shape || 'rect',
    frame: raw.frame || 'border',
    camera: raw.camera || 'medium',
    ...(raw.desc ? { desc: String(raw.desc) } : {}),
    ...common(raw),
  };
}

export function panelsOf(page) {
  return (page.items || []).filter((it) => it.type === 'panel');
}

export function bubblesOf(page) {
  return (page.items || []).filter((it) => it.type === 'bubble');
}
