// 一次性恢复脚本：从 versions/<id>.json 的 prompt 快照反编译回页面。
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { decompile } from '../core/decompile.mjs';
import { savePage } from '../scripts/lib/archive.mjs';

const ARCHIVE = process.argv[2];
const SLUG = process.argv[3];
const PAGE = process.argv[4] || 'p01';

const SAFE_SEGMENT = /^[a-zA-Z0-9_-]+$/;
if (!SAFE_SEGMENT.test(SLUG || '') || !SAFE_SEGMENT.test(PAGE || '')) {
  console.error('SLUG/PAGE 只能包含字母、数字、下划线、短横线');
  process.exit(1);
}

const dir = join(ARCHIVE, 'projects', SLUG);
const store = JSON.parse(await readFile(join(dir, 'versions.json'), 'utf8'));
const candidates = store.items.filter((v) => v.page === PAGE && v.promptJson);
if (!candidates.length) {
  console.error('没有可用的 prompt 快照');
  process.exit(1);
}
const latest = candidates[candidates.length - 1];
const page = decompile(latest.promptJson, latest.width ? [latest.width, latest.height] : undefined);
page.id = PAGE;
page.index = Number(PAGE.replace(/\D/g, '')) || 1;
page.title = '';
const saved = await savePage(ARCHIVE, SLUG, page, { actor: 'cli' });
console.log(`已从 ${latest.id} 恢复：${saved.page.items.length} 项`);
