// 把前端依赖抓到本地，之后断网也能跑。
//   node tools/vendor.mjs
// preact / preact-hooks / htm 抓的是 unpkg 上的纯 ESM 构建，并把 hooks 里对裸模块名
// "preact" 的引用改成同目录相对路径，保证共用同一个 preact 实例。
// jsPDF 抓的是自包含的 UMD 包（它的 ESM 构建会 import @babel/runtime / fflate / fast-png，
// 没有打包器接不住），页面里按需用 <script> 懒加载。

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const OUT = resolve(process.cwd(), 'web', 'vendor');

const FILES = [
  {
    url: 'https://unpkg.com/preact@10.25.4/dist/preact.module.js',
    out: 'preact.mjs',
    rewrite: [],
  },
  {
    url: 'https://unpkg.com/preact@10.25.4/hooks/dist/hooks.module.js',
    out: 'preact-hooks.mjs',
    rewrite: [[/from\s*["']preact["']/g, 'from "./preact.mjs"']],
  },
  {
    url: 'https://unpkg.com/htm@3.1.1/dist/htm.module.js',
    out: 'htm.mjs',
    rewrite: [],
  },
  {
    // 只有导出 PDF 时才加载，410KB 不影响首屏
    url: 'https://unpkg.com/jspdf@4.2.1/dist/jspdf.umd.min.js',
    out: 'jspdf.umd.min.js',
    // .map 没跟着 vendor，留着只会在控制台报 404
    rewrite: [[/^\/\/# sourceMappingURL=.*$/gm, '']],
  },
];

async function main() {
  await mkdir(OUT, { recursive: true });
  for (const file of FILES) {
    const res = await fetch(file.url);
    if (!res.ok) throw new Error(`${file.url} 返回 ${res.status}`);
    let code = await res.text();
    for (const [pattern, replacement] of file.rewrite) code = code.replace(pattern, replacement);
    await writeFile(join(OUT, file.out), code, 'utf8');
    console.log(`✓ ${file.out}  ${(code.length / 1024).toFixed(1)} KB`);
  }
  console.log(`\n已写入 ${OUT}`);
  console.log('重启服务后会自动改用本地依赖（index.html 的 importmap 由服务端注入）。');
}

main().catch((err) => {
  console.error('抓取失败：', err.message);
  process.exit(1);
});
