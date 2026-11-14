// 更新检查的自测：本机起一个假「远端」，全程离线，不碰 GitHub。
// 覆盖：同版本 / 有新版本 / 远端更旧 / 404 / 不是 JSON / 没有 version / 连不上 / 超时 / 缓存 / 跳过。
//   node tools/test-update.mjs

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkUpdate, describeUpdate, compareVersions, parseVersion } from '../scripts/lib/update.mjs';

// ---------------------------------------------------------------- 假远端
let hits = 0;
const server = createServer((req, res) => {
  hits += 1;
  const send = (code, body, type = 'application/json') => {
    res.writeHead(code, { 'content-type': type });
    res.end(body);
  };
  if (req.url === '/pkg-same') return send(200, JSON.stringify({ name: 'moss', version: '2.0.0' }));
  if (req.url === '/pkg-newer') return send(200, JSON.stringify({ name: 'moss', version: '2.1.0' }));
  if (req.url === '/pkg-patch') return send(200, JSON.stringify({ name: 'moss', version: '2.0.1' }));
  if (req.url === '/pkg-older') return send(200, JSON.stringify({ name: 'moss', version: '1.9.9' }));
  if (req.url === '/pkg-bad') return send(200, 'not json at all', 'text/plain');
  if (req.url === '/pkg-noversion') return send(200, JSON.stringify({ name: 'moss' }));
  if (req.url === '/slow') return; // 故意不回，测超时
  return send(404, '{"error":"Not Found"}');
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const tmp = await mkdtemp(join(tmpdir(), 'moss-update-test-'));
const url = (name) => `${base}/${name}`;
const cache = (name) => join(tmp, `cache-${name}`); // 每条用例独立缓存，免得互相覆盖

try {
  // ---------------------------------------------------------------- 版本号比较
  assert.deepEqual(parseVersion('2.1.0'), [2, 1, 0], '解析版本号');
  assert.deepEqual(parseVersion('v1.2.3'), [1, 2, 3], '允许 v 前缀');
  assert.equal(parseVersion('abc'), null, '不是版本号');
  assert.equal(compareVersions('2.1.0', '2.0.0'), 1, '2.1.0 > 2.0.0');
  assert.equal(compareVersions('2.0.0', '2.0.0'), 0, '相等');
  assert.equal(compareVersions('1.9.9', '2.0.0'), -1, '1.9.9 < 2.0.0');
  assert.equal(compareVersions('2.0.10', '2.0.9'), 1, '按数字比，不是按字符串比');

  // ---------------------------------------------------------------- 同版本
  const same = await checkUpdate({ url: url('pkg-same'), current: '2.0.0', cacheDir: cache('same'), fresh: true });
  assert.equal(same.state, 'ok');
  assert.equal(same.hasUpdate, false, '版本相同不该报更新');
  assert.equal(same.latest, '2.0.0');
  assert.equal(describeUpdate(same, { version: '2.0.0' }).join(''), '版本：2.0.0 · 已是最新');

  // ---------------------------------------------------------------- 有新版本
  const newer = await checkUpdate({ url: url('pkg-newer'), current: '2.0.0', cacheDir: cache('newer'), fresh: true });
  assert.equal(newer.state, 'ok');
  assert.equal(newer.hasUpdate, true, '2.1.0 比 2.0.0 新');
  assert.equal(newer.latest, '2.1.0');
  const line = describeUpdate(newer, { version: '2.0.0' }).join('');
  assert.match(line, /当前有新版本（2\.1\.0）/, '要报出远端版本');
  assert.match(line, /推荐先询问用户是否更新到最新/, '要提示去问用户');
  assert.equal(describeUpdate(newer).length, 1, '就一行，别啰嗦');

  const patch = await checkUpdate({ url: url('pkg-patch'), current: '2.0.0', cacheDir: cache('patch'), fresh: true });
  assert.equal(patch.hasUpdate, true, '补丁版本也算有新版本');

  // ---------------------------------------------------------------- 远端更旧
  const older = await checkUpdate({ url: url('pkg-older'), current: '2.0.0', cacheDir: cache('older'), fresh: true });
  assert.equal(older.hasUpdate, false, '远端比本地旧不算更新');

  // ---------------------------------------------------------------- 各种失败
  const missing = await checkUpdate({ url: `${base}/nope`, current: '2.0.0', cacheDir: cache('404'), fresh: true });
  assert.equal(missing.state, 'http');
  assert.equal(missing.status, 404);
  assert.match(describeUpdate(missing, { version: '2.0.0' }).join(''), /查不了（HTTP 404）/);

  const bad = await checkUpdate({ url: url('pkg-bad'), current: '2.0.0', cacheDir: cache('bad'), fresh: true });
  assert.equal(bad.state, 'http', '不是 JSON 不该抛');
  assert.match(describeUpdate(bad, { version: '2.0.0' }).join(''), /查不了/);

  const noVersion = await checkUpdate({ url: url('pkg-noversion'), current: '2.0.0', cacheDir: cache('nover'), fresh: true });
  assert.equal(noVersion.state, 'http');
  assert.match(describeUpdate(noVersion, { version: '2.0.0' }).join(''), /没有可用的 version/);

  const dead = await checkUpdate({ url: 'http://127.0.0.1:9/pkg.json', current: '2.0.0', cacheDir: cache('dead'), fresh: true });
  assert.equal(dead.state, 'offline', '连不上要降级，不是报错');
  assert.match(describeUpdate(dead, { version: '2.0.0' }).join(''), /更新：查不了/);

  const slow = await checkUpdate({ url: url('slow'), current: '2.0.0', cacheDir: cache('slow'), fresh: true, timeoutMs: 400 });
  assert.equal(slow.state, 'offline', '超时要降级');
  assert.match(describeUpdate(slow, { version: '2.0.0' }).join(''), /超时/);

  // ---------------------------------------------------------------- 多个候选地址
  const fallback = await checkUpdate({
    url: [`${base}/nope`, url('pkg-newer')],
    current: '2.0.0',
    cacheDir: cache('fallback'),
    fresh: true,
  });
  assert.equal(fallback.hasUpdate, true, '第一个地址 404 时要接着试下一个');
  assert.equal(fallback.via, url('pkg-newer'), '要记住是哪个地址成功的');

  const allDead = await checkUpdate({
    url: [`${base}/nope`, 'http://127.0.0.1:9/x.json'],
    current: '2.0.0',
    cacheDir: cache('alldead'),
    fresh: true,
  });
  assert.notEqual(allDead.state, 'ok', '全挂了也不能崩');

  // ---------------------------------------------------------------- 缓存
  const before = hits;
  const cached = await checkUpdate({ url: url('pkg-newer'), current: '2.0.0', cacheDir: cache('newer') });
  assert.equal(cached.cached, true, '第二次应该走缓存');
  assert.equal(hits, before, '缓存命中时不该再发请求');
  assert.equal(cached.hasUpdate, true, '缓存里的结论要一致');
  assert.match(describeUpdate(cached, { version: '2.0.0' }).join(''), /分钟前查过/);

  // ---------------------------------------------------------------- 跳过
  const skipped = await checkUpdate({ url: url('pkg-newer'), current: '2.0.0', skip: true });
  assert.equal(skipped.state, 'skipped');
  assert.equal(describeUpdate(skipped, { version: '2.0.0' }).join(''), '版本：2.0.0 · 更新：跳过（--no-update）');

  console.log(`更新检查自测通过：${hits} 次本地请求，全程离线`);
} finally {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  await rm(tmp, { recursive: true, force: true }).catch(() => {});
}
