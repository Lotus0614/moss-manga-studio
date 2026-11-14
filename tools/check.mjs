// 自检：语法 + 方言配置。
//   node tools/check.mjs

import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { PAGE, TYPES, EDIT, buildEditPrompt } from '../config/manga.mjs';

const run = promisify(execFile);
const ROOT = resolve(process.cwd());
const SKIP = new Set(['node_modules', 'data', 'web/vendor', '.git']);

async function* walk(dir, rel = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (SKIP.has(entry.name) || SKIP.has(relPath)) continue;
    if (entry.isDirectory()) yield* walk(join(dir, entry.name), relPath);
    else if (entry.name.endsWith('.mjs')) yield join(dir, entry.name);
  }
}

let failed = 0;
let checked = 0;
for await (const file of walk(ROOT)) {
  checked += 1;
  try {
    await run(process.execPath, ['--check', file]);
  } catch (err) {
    failed += 1;
    console.error(`✗ ${file.replace(ROOT + '\\', '')}`);
    console.error(String(err.stderr || err.message).split('\n').slice(0, 4).join('\n'));
  }
}
console.log(failed ? `\n${failed} / ${checked} 个文件有语法错误` : `\n${checked} 个文件语法正常`);

// 方言配置：枚举必须有选项、value 不重复、default 落在选项里
const problems = [];
const FIELD_TYPES = new Set(['text', 'longtext', 'number', 'enum', 'bool', 'tags', 'palette']);

function checkFields(fields, where) {
  const keys = new Set();
  for (const field of fields || []) {
    const at = `${where} 字段 ${field.key || '?'}`;
    if (!field.key) problems.push(`${at}：没有 key`);
    else if (keys.has(field.key)) problems.push(`${at}：key 重复`);
    keys.add(field.key);
    if (!field.label) problems.push(`${at}：没有 label`);
    if (!FIELD_TYPES.has(field.type)) problems.push(`${at}：type "${field.type}" 不认识`);

    if (field.type !== 'enum') continue;
    // options 可以是数组，也可以是 (ctx) => 数组（角色、变种这种动态选项）
    if (typeof field.options === 'function') {
      try {
        const sample = field.options({});
        if (!Array.isArray(sample)) problems.push(`${at}：options() 必须返回数组`);
      } catch (err) {
        problems.push(`${at}：options() 报错 ${err.message}`);
      }
      continue;
    }
    if (!Array.isArray(field.options) || !field.options.length) {
      problems.push(`${at}：enum 必须给 options 数组`);
      continue;
    }
    const values = new Set();
    for (const option of field.options) {
      if (!option || option.value === undefined) problems.push(`${at}：选项缺 value`);
      else if (values.has(option.value)) problems.push(`${at}：选项 "${option.value}" 重复`);
      else values.add(option.value);
    }
    if (field.default !== undefined && !values.has(field.default)) {
      problems.push(`${at}：default "${field.default}" 不在 options 里`);
    }
  }
}

checkFields(PAGE, '页面');
const typeKeys = new Set();
for (const type of TYPES || []) {
  if (!type.key) problems.push(`类型 ${type.label || '?'}：没有 key`);
  else if (typeKeys.has(type.key)) problems.push(`类型 ${type.key}：key 重复`);
  typeKeys.add(type.key);
  if (typeof type.compile !== 'function') problems.push(`类型 ${type.key}：没有 compile()`);
  checkFields(type.fields, `类型 ${type.key}`);
}

// 修图方言：包装句必须留 {request}，否则所有人的指令都会被吞掉
if (!String(EDIT?.wrapper || '').includes('{request}')) problems.push('修图：EDIT.wrapper 里没有 {request}');
if (!buildEditPrompt({ request: '改一下' })) problems.push('修图：buildEditPrompt 返回空');

for (const problem of problems) console.error(`✗ ${problem}`);

const enumCount = [...PAGE, ...TYPES.flatMap((type) => type.fields || [])].filter((field) => field.type === 'enum').length;
if (!problems.length) {
  console.log(`配置：${PAGE.length} 个页面字段、${TYPES.length} 个类型、${enumCount} 个枚举字段`);
}
failed += problems.length;

process.exitCode = failed ? 1 : 0;
