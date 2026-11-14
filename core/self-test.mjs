// 自测：编译契约的黄金用例。
// 运行：node core/self-test.mjs
//
// 这些断言对应 Moss 模板文档里的硬性约定，任何一条挂了都说明产物会被模型拒绝或画歪。

import assert from 'node:assert/strict';
import { compilePage } from './compile.mjs';
import { createPage, createPanelItem, createBubbleItem, toMoss, fromMoss, normalizePage } from './manga-doc.mjs';
import { validatePage } from './validate.mjs';
import { decompile } from './decompile.mjs';
import { fillGraph, scanTokens, MissingParam, describeWorkflow } from './placeholders.mjs';
import { buildEditPrompt } from '../config/manga.mjs';

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
}

const SIZE = [768, 1280];
const SIZE_OBJ = { width: 768, height: 1280 };

// ---------------------------------------------------------------- 坐标

test('文档 §3.4 的换算示例（1536×1024）', () => {
  const got = toMoss([176, 224, 800, 864], { width: 1536, height: 1024 });
  assert.deepEqual(got, [-288, -592, 352, 32]);
});

test('输出顺序是 yxyx，不是 xyxy', () => {
  const got = toMoss([0, 0, 100, 200], { width: 1024, height: 1024 });
  assert.deepEqual(got, [-512, -512, -312, -412]);
});

test('toMoss / fromMoss 往返一致', () => {
  for (const bbox of [[8, 0, 536, 400], [0, 0, 768, 1280], [100, 200, 100, 300]]) {
    const back = fromMoss(toMoss(bbox, SIZE_OBJ), SIZE_OBJ);
    assert.deepEqual(back, [Math.min(bbox[0], bbox[2]), Math.min(bbox[1], bbox[3]), Math.max(bbox[0], bbox[2]), Math.max(bbox[1], bbox[3])]);
  }
});

test('左上向下取整、右下向上取整', () => {
  const got = toMoss([10.6, 20.2, 100.4, 200.9], SIZE_OBJ);
  // 草稿取整为 [10,20,101,201] → 减偏移
  assert.deepEqual(got, [20 - 640, 10 - 384, 201 - 640, 101 - 384]);
});

// ---------------------------------------------------------------- 编译

const DOC_PANELS = [
  [-640, -376, -240, 152],
  [-224, -376, 16, -4],
  [-224, 12, 16, 384],
  [32, -376, 640, 384],
];
const DOC_BUBBLES = [
  [-620, 300, -260, 430],
  [150, 216, 360, 366],
  [110, 116, 340, 316],
  [510, -184, 570, 86],
];

function buildDocPage() {
  const page = createPage({ size: SIZE });
  page.items = [
    ...DOC_PANELS.map((moss, i) =>
      createPanelItem({ bbox: fromMoss(moss, SIZE_OBJ), desc: `panel content ${i + 1}`, note: `第 ${i + 1} 格备注` })
    ),
    ...DOC_BUBBLES.map((moss, i) =>
      createBubbleItem({ bbox: fromMoss(moss, SIZE_OBJ), text: `测试台词${i + 1}`, kind: i === 1 ? 'thought' : 'speech' })
    ),
  ];
  return page;
}

const compiled = compilePage(buildDocPage());

test('四个面板的 bbox 与文档示例完全一致', () => {
  const got = compiled.doc.items.filter((i) => i.label === 'object').map((i) => JSON.stringify(i.bbox)).sort();
  const want = DOC_PANELS.map((b) => JSON.stringify(b)).sort();
  assert.deepEqual(got, want);
});

test('四条文字的 bbox 与文档示例完全一致', () => {
  const got = compiled.doc.items.filter((i) => i.label === 'text').map((i) => JSON.stringify(i.bbox)).sort();
  const want = DOC_BUBBLES.map((b) => JSON.stringify(b)).sort();
  assert.deepEqual(got, want);
});

test('产物顶层字段与模板规范一致', () => {
  assert.deepEqual(Object.keys(compiled.doc).sort(), ['bbox_coord_space', 'bbox_format', 'items', 'summary']);
  assert.equal(compiled.doc.bbox_coord_space, 'abs_centralized');
  assert.equal(compiled.doc.bbox_format, 'yxyx');
});

test('已经去掉 width / height', () => {
  const raw = compiled.json;
  for (const key of ['"width"', '"height"']) {
    assert.ok(!raw.includes(key), `产物里不该出现 ${key}`);
  }
});

test('输出是单行 JSON，且能原样解析回来', () => {
  assert.ok(!compiled.json.includes('\n'));
  const back = JSON.parse(compiled.json);
  assert.equal(back.items.length, 8);
});

test('summary.caption 非空且含黑白锁色句', () => {
  assert.ok(compiled.doc.summary.caption.length > 80);
  assert.ok(/zero colour/i.test(compiled.doc.summary.caption));
});

test('两种旁白：白框与裸字互不混淆', () => {
  const page = createPage({ size: SIZE });
  page.items = [
    createPanelItem({ bbox: [8, 8, 760, 400] }),
    createBubbleItem({ kind: 'narration', text: '白框旁白', bbox: [40, 40, 400, 120] }),
    createBubbleItem({ kind: 'narration-bare', text: '裸字旁白', bbox: [40, 140, 400, 220] }),
  ];
  const [boxed, bare] = compilePage(page).doc.items.filter((i) => i.label === 'text');
  assert.ok(/rectangular box/i.test(boxed.caption), boxed.caption);
  assert.ok(!/no box/i.test(boxed.caption), boxed.caption);
  assert.ok(/no box|printed directly/i.test(bare.caption), bare.caption);
  assert.ok(!/rectangular box/i.test(bare.caption), bare.caption);
});

test('character 类型：格子文案由作者写全，外貌只出现在 summary 角色表', () => {
  const project = { characters: [{ id: 'shion', name: 'CHARACTER ONE - SHION', look: 'long silver hair' }] };
  const page = createPage({ size: SIZE });
  page.items = [
    createPanelItem({ bbox: [8, 8, 760, 800], desc: 'room' }),
    { type: 'character', id: 'c1', ref: 'shion', bbox: [560, 900, 740, 1200], desc: 'CHARACTER ONE - SHION, inside PANEL ONE only, kneeling' },
  ];
  const out = compilePage(page, project);
  const item = out.doc.items.find((i) => i.label === 'character');

  // 格子里的文案就是作者写的那段，不再自动拼「character 名字: 外貌」
  assert.ok(item.caption.startsWith('CHARACTER ONE - SHION, inside PANEL ONE only, kneeling'), item.caption);
  assert.ok(!/^character CHARACTER/i.test(item.caption), '不该再自动加 character 前缀');
  assert.ok(!item.caption.includes('long silver hair'), '外貌不该进格子');

  // 外貌只在 summary 的角色表里出现一次
  assert.ok(/CHARACTERS IN THIS PAGE/.test(out.doc.summary.caption));
  assert.ok(out.doc.summary.caption.includes('CHARACTER ONE - SHION: long silver hair'));

  // 没写 desc 就不出图
  page.items[1] = { type: 'character', id: 'c2', ref: 'shion', bbox: [560, 900, 740, 1200] };
  assert.equal(compilePage(page, project).doc.items.filter((i) => i.label === 'character').length, 0);

  // 一次性外貌不靠角色项：拉 native + label:character，caption 自己写全，也不进本页角色表
  page.items[1] = {
    type: 'native',
    id: 'c3',
    label: 'character',
    bbox: [560, 900, 740, 1200],
    caption: 'CHARACTER ONE - SHION, completely naked, kneeling, blood on her cheek',
  };
  const solo = compilePage(page, project);
  const soloItem = solo.doc.items.find((i) => i.label === 'character');
  assert.equal(soloItem.caption, 'CHARACTER ONE - SHION, completely naked, kneeling, blood on her cheek');
  assert.ok(!/CHARACTERS IN THIS PAGE/.test(solo.doc.summary.caption), '原生角色框不进本页角色表');
});
test('变种：基础 + 差分拼成一份外貌，角色表按 ref|variant 去重', () => {
  const project = {
    characters: [
      {
        id: 'hikari',
        name: 'CHARACTER TWO - HIKARI',
        look: '1girl, long straight black hair',
        variants: [
          { id: '15_nude', name: 'NUDE 15', look: '15 years old, completely naked' },
          { id: '18_dress', name: 'DRESS 18', look: '18 years old, a white dress' },
        ],
      },
    ],
  };
  const page = createPage({ size: SIZE });
  page.items = [
    createPanelItem({ bbox: [8, 8, 760, 800], desc: 'room' }),
    {
      type: 'character',
      id: 'c1',
      ref: 'hikari',
      variant: '15_nude',
      bbox: [40, 40, 300, 700],
      desc: 'CHARACTER TWO - HIKARI (NUDE 15), inside PANEL ONE only, kneeling',
    },
    {
      type: 'character',
      id: 'c2',
      ref: 'hikari',
      variant: '18_dress',
      bbox: [400, 40, 700, 700],
      desc: 'CHARACTER TWO - HIKARI (DRESS 18), inside PANEL ONE only, standing',
    },
    {
      type: 'character',
      id: 'c3',
      ref: 'hikari',
      variant: '15_nude',
      bbox: [400, 800, 700, 1100],
      desc: 'CHARACTER TWO - HIKARI (NUDE 15), inside PANEL TWO only',
    },
  ];
  const out = compilePage(page, project);
  const cast = out.doc.summary.caption;

  // 基础 + 变种合并；名字带上变种标
  assert.ok(cast.includes('CHARACTER TWO - HIKARI (NUDE 15): 1girl, long straight black hair, 15 years old, completely naked'), cast);
  assert.ok(cast.includes('CHARACTER TWO - HIKARI (DRESS 18): 1girl, long straight black hair, 18 years old, a white dress'), cast);
  // 同一变种出现两次只占一行，不同变种各占一行
  assert.equal(cast.match(/CHARACTER TWO - HIKARI/g).length, 2, cast);

  // 变种 id 不存在 → 回退基础外貌，并给 warn
  page.items[1] = { ...page.items[1], variant: 'nope' };
  const stale = compilePage(page, project);
  assert.ok(
    stale.warnings.some((w) => w.code === 'character.variant' && w.level === 'warn'),
    '变种缺失要报 warn',
  );
  assert.ok(stale.doc.summary.caption.includes('CHARACTER TWO - HIKARI: 1girl'), '回退到基础外貌');

  // 不选变种 = 只用基础外貌，名字不带括号
  page.items[1] = { ...page.items[1], variant: '' };
  assert.ok(compilePage(page, project).doc.summary.caption.includes('CHARACTER TWO - HIKARI: 1girl'));
});

test('编译无 error 级告警', () => {
  const errs = compiled.warnings.filter((w) => w.level === 'error');
  assert.deepEqual(errs, []);
});

test('caption 填了就整段接管，note 不进产物', () => {
  const page = createPage({ size: SIZE });
  page.items = [
    createPanelItem({
      bbox: [8, 8, 760, 400],
      desc: 'a crowded platform',
      note: '第一格：交代场景',
      caption: 'my own caption, nothing else',
    }),
  ];
  const item = compilePage(page).doc.items[0];
  assert.equal(item.caption, 'my own caption, nothing else');
  assert.ok(!item.caption.includes('rectangular panel'), '形状短语应该让位');
  assert.equal(item.note, undefined, 'note 是给人看的，不进 Moss item');
});

test('旧数据迁移：caption（当时的画面描述）搬到 desc', () => {
  const migrated = normalizePage({
    size: SIZE,
    items: [{ type: 'panel', id: 'pn_a', bbox: [8, 8, 760, 400], caption: '旧的画面描述' }],
  });
  assert.equal(migrated.version, 2);
  assert.equal(migrated.items[0].desc, '旧的画面描述');
  assert.equal(migrated.items[0].caption, undefined);
});

test('页面的 summaryMeta / summaryCaption 能整段覆盖 summary', () => {
  const page = createPage({ size: SIZE, summaryMeta: ['custom meta'], summaryCaption: '整段自定义 summary' });
  page.items = [createPanelItem({ bbox: [8, 8, 760, 400], desc: 'x' })];
  const summary = compilePage(page).doc.summary;
  assert.deepEqual(summary.meta, ['custom meta']);
  assert.equal(summary.caption, '整段自定义 summary');
});

// ---------------------------------------------------------------- 编号与位置由作者写

test('面板不再自动编号：desc 没写 PANEL 就不会出现', () => {
  const page = createPage({ size: SIZE });
  page.items = [createPanelItem({ bbox: [8, 8, 760, 400], desc: 'a quiet room' })];
  const item = compilePage(page).doc.items.find((i) => i.label === 'object');
  assert.ok(!/PANEL \d/.test(item.caption), item.caption);
  assert.ok(item.caption.includes('a quiet room'), item.caption);
});

test('气泡不再自动定位：不出现 inside PANEL / 九宫格 / 尾巴方向', () => {
  const page = createPage({ size: SIZE });
  page.items = [
    createPanelItem({ bbox: [8, 8, 760, 800], desc: 'room' }),
    createBubbleItem({
      text: '台词',
      bbox: [40, 40, 200, 200],
      desc: 'in the TOP LEFT of PANEL ONE, SPOKEN BY CHARACTER ONE - SHION',
    }),
  ];
  const item = compilePage(page).doc.items.find((i) => i.label === 'text');
  assert.ok(!/inside PANEL|at the edge of PANEL/.test(item.caption), item.caption);
  assert.ok(!/area of the page/.test(item.caption), item.caption);
  assert.ok(!/tail pointing|NO tail because/.test(item.caption), item.caption);
  assert.ok(item.caption.includes('CHARACTER ONE - SHION'), item.caption);
});

test('角色表自动追加；手写 summary 则整段覆盖（连角色表也不追加）', () => {
  const project = { characters: [{ id: 'shion', name: 'CHARACTER ONE - SHION', look: 'long silver hair' }] };
  const items = () => [
    createPanelItem({ bbox: [8, 8, 760, 800], desc: 'room' }),
    { type: 'character', id: 'c1', ref: 'shion', bbox: [40, 40, 400, 700] },
  ];

  // 没手写：角色表由代码追加
  const auto = createPage({ size: SIZE });
  auto.items = items();
  const autoSummary = compilePage(auto, project).doc.summary;
  assert.ok(/CHARACTERS IN THIS PAGE/.test(autoSummary.caption), autoSummary.caption);
  assert.ok(autoSummary.caption.includes('long silver hair'), autoSummary.caption);

  // 手写了：整段覆盖，什么都不追加
  const page = createPage({ size: SIZE, summaryCaption: '手写的格数与剧情' });
  page.items = items();
  const summary = compilePage(page, project).doc.summary;
  assert.equal(summary.caption, '手写的格数与剧情');
});

test('本身已包含全部允许字段，没有多余键', () => {
  const allowed = new Set(['label', 'caption', 'bbox', 'text']);
  for (const item of compiled.doc.items) {
    for (const key of Object.keys(item)) assert.ok(allowed.has(key), `多出字段 ${key}`);
  }
});

// ---------------------------------------------------------------- 校验

test('越界面板会被警告', () => {
  const page = createPage({ size: SIZE });
  page.items = [createPanelItem({ bbox: [-40, 0, 400, 400] })];
  const warnings = validatePage(page, compilePage(page).doc);
  assert.ok(warnings.some((w) => w.code === 'panel.out'));
});

test('空页会被拦下', () => {
  const page = createPage({ size: SIZE });
  const warnings = validatePage(page, compilePage(page).doc);
  assert.ok(warnings.some((w) => w.level === 'error'));
});

test('编译产物能反编译回同一组坐标', () => {
  const page = decompile(compiled.json, SIZE);
  assert.equal(page.items.filter((it) => it.type === 'panel').length, 4);
  assert.equal(page.items.filter((it) => it.type === 'bubble').length, 4);
  const again = compilePage(page);
  const got = again.doc.items.map((i) => JSON.stringify(i.bbox)).sort();
  const want = [...DOC_PANELS, ...DOC_BUBBLES].map((b) => JSON.stringify(b)).sort();
  assert.deepEqual(got, want);
});

test('反编译能认出内心气泡与出血格', () => {
  const page = decompile(compiled.json, SIZE);
  assert.ok(page.items.some((it) => it.type === 'bubble' && it.kind === 'thought'));
});

// ---------------------------------------------------------------- 占位符

test('占位符被识别', () => {
  const tokens = scanTokens({ a: { inputs: { text: '{{prompt}}', seed: '{{seed}}' } } });
  assert.deepEqual(tokens.map((t) => t.name).sort(), ['prompt', 'seed']);
});

test('整串占位符保留原始类型', () => {
  const graph = { n: { class_type: 'KSampler', inputs: { seed: '{{seed}}', steps: '{{steps}}' } } };
  const filled = fillGraph(graph, { seed: 12345, steps: 28 });
  assert.equal(filled.n.inputs.seed, 12345);
  assert.equal(typeof filled.n.inputs.seed, 'number');
});

test('占位符嵌在文字里时转字符串', () => {
  const filled = fillGraph({ t: 'size={{width}}x{{height}}' }, { width: 768, height: 1280 });
  assert.equal(filled.t, 'size=768x1280');
});

test('缺参数时抛出带参数名的错误', () => {
  assert.throws(() => fillGraph({ t: '{{nope}}' }, {}), (err) => err instanceof MissingParam && err.param === 'nope');
});

test('原图不被修改（纯函数）', () => {
  const graph = { t: '{{x}}' };
  fillGraph(graph, { x: 1 });
  assert.equal(graph.t, '{{x}}');
});

test('describeWorkflow 拒绝非 API 格式', () => {
  assert.equal(describeWorkflow('{"nodes":[],"links":[]}').ok, false);
  assert.equal(describeWorkflow('not json').ok, false);
  assert.equal(describeWorkflow('{"1":{"class_type":"A","inputs":{}}}').ok, true);
});

// ---------------------------------------------------------------- 修图

test('修图提示词把「别动别处」说死，空请求不出句子', () => {
  const got = buildEditPrompt({ request: '把左上角气泡的尾巴删掉。' });
  assert.ok(got.startsWith('在这张漫画里把左上角气泡的尾巴删掉。'));
  assert.ok(got.includes('气泡里的文字一个字都不改'));
  assert.equal(buildEditPrompt({ request: '  ' }), '');
});

// ---------------------------------------------------------------- 汇总

console.log(`\n${passed} 通过，${failures.length} 失败`);
if (failures.length) {
  console.error('\n失败详情：');
  for (const { name, err } of failures) console.error(`- ${name}: ${err.stack || err.message}`);
  process.exitCode = 1;
} else {
  console.log('\n编译产物示例（前 400 字）：');
  console.log(compiled.json.slice(0, 400) + '…');
}
