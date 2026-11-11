// PDF 组装的结构自测：不依赖浏览器，把 vendor 里的 jsPDF 在 Node 里跑起来，
// 检查页数、图片直嵌、加密字典和「图片字节确实被加密了」。
//   node tools/test-export.mjs

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildPdfJs, pagesInRange } from '../web/components/export.mjs';

// 一个 1×1 的 JPEG，够检查 DCTDecode 直嵌和加密是否生效
const jpegDataUrl =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const jpegBytes = Buffer.from(jpegDataUrl.split(',')[1], 'base64');
// 取图片本体中间一小段做指纹，加密后这段不应该原样出现
const jpegFingerprint = jpegBytes.subarray(20, 60);

/** 把 UMD 包在 Node 里当 CommonJS 跑一遍（浏览器里是 <script> 直接挂到 window.jspdf） */
async function loadJsPdf() {
  const code = await readFile(new URL('../web/vendor/jspdf.umd.min.js', import.meta.url), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', 'globalThis', code)(mod, mod.exports, globalThis);
  const ctor = mod.exports.jsPDF || globalThis.jspdf?.jsPDF;
  assert.equal(typeof ctor, 'function', 'jsPDF 应该能从 vendor 包里加载出来');
  return ctor;
}

const jsPDF = await loadJsPdf();
const images = [
  { data: jpegDataUrl, width: 768, height: 1280 },
  { data: jpegDataUrl, width: 768, height: 1280 },
];

// ---------------------------------------------------------------- 不加密
const plain = buildPdfJs(jsPDF, images, { title: '测试章节' });
const plainText = Buffer.from(plain).toString('latin1');

assert.ok(plainText.startsWith('%PDF-'), 'PDF 头');
assert.ok(plainText.trimEnd().endsWith('%%EOF'), 'PDF 尾');
assert.match(plainText, /\/Count\s+2/, '页数正确');
assert.match(plainText, /\/Filter\s*\/DCTDecode/, '图片是直嵌 JPEG，没重新编码');
assert.match(plainText, /\/MediaBox\s*\[\s*0\s+0\s+768\.?\s+1280\.?\s*\]/, '页面尺寸跟原图一致');
assert.ok(!plainText.includes('/Encrypt'), '没给密码就不该有 Encrypt 字典');
assert.ok(Buffer.from(plain).includes(jpegFingerprint), '图片字节原样在 PDF 里');

console.log(`PDF 自测通过：${images.length} 页，${plain.length} 字节，未加密`);

// ---------------------------------------------------------------- 加密
const locked = buildPdfJs(jsPDF, images, { title: '测试章节', password: 'hunter2' });
const lockedText = Buffer.from(locked).toString('latin1');

assert.match(lockedText, /\/Encrypt\s+\d+\s+0\s+R/, '有 Encrypt 字典引用');
assert.match(lockedText, /\/Filter\s*\/Standard/, '标准安全处理器');
assert.match(lockedText, /\/V\s+1/, 'V 1（RC4）');
assert.match(lockedText, /\/R\s+2/, 'R 2');
assert.match(lockedText, /\/Count\s+2/, '加密不影响页数');
assert.ok(!Buffer.from(locked).includes(jpegFingerprint), '图片字节已经被加密，不再是明文');

assert.throws(() => buildPdfJs(jsPDF, images, { password: '中文密码' }), /英文/, '非 ASCII 密码要早点拒绝');
assert.throws(() => buildPdfJs(jsPDF, [], {}), /没有可导出的页面/);

console.log(`PDF 加密自测通过：${locked.length} 字节，/Filter /Standard /V 1 /R 2`);

// ---------------------------------------------------------------- 导出范围
const bookPages = [1, 2, 3, 4, 5, 6, 7, 8].map((index) => ({ index, image: `/media/x/p${index}.png` }));
const pick = (from, to) => pagesInRange(bookPages, from, to).map((p) => p.index);

assert.deepEqual(pick(1, 8), [1, 2, 3, 4, 5, 6, 7, 8], '整本');
assert.deepEqual(pick(3, 5), [3, 4, 5], '中间一段（两端都含）');
assert.deepEqual(pick(5, 3), [3, 4, 5], '范围反了自动换正');
assert.deepEqual(pick(7, 7), [7], '单页');
assert.deepEqual(pick(4, 99), [4, 5, 6, 7, 8], '结束页超出就截到最后一页');
assert.deepEqual(pick(0, 2), [1, 2], '起始页超出就从前一页开始');
assert.deepEqual(pagesInRange([], 1, 3), [], '空列表');

const withHoles = [{ index: 1, image: 'a' }, { index: 2 }, { index: 3, image: 'c' }];
assert.deepEqual(
  pagesInRange(withHoles, 1, 3).map((p) => p.index),
  [1, 2, 3],
  '没图的页也在范围内，交给下游跳过'
);

console.log(`导出范围自测通过：${bookPages.length} 页的书，取 3–5 得到 3 页`);
