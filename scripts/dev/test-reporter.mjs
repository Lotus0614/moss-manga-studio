// 播报器自测：用进程内假服务器，验证「报文对不对、服务器不在会不会拖后腿」。
//   node scripts/dev/test-reporter.mjs

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createReporter } from '../lib/reporter.mjs';

let passed = 0;
const failures = [];
const test = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
};

/** 假服务器：记下收到的报文，start 返回固定 id */
async function fakeServer() {
  const calls = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      if (req.url === '/api/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
        return;
      }
      if (req.url === '/api/tasks/external') {
        const body = JSON.parse(raw || '{}');
        calls.push(body);
        res.writeHead(body.op === 'start' ? 201 : 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body.op === 'start' ? { id: 't_fake_1' } : { ok: true }));
        return;
      }
      res.writeHead(404).end('{}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return { server, port, calls, url: `http://127.0.0.1:${port}` };
}

await test('start / beat / done 的报文形状对', async () => {
  const fake = await fakeServer();
  try {
    const reporter = await createReporter({ dir: '/nonexistent', enabled: true });
    // 直接指定地址，跳过 server.json 发现
    const reporter2 = await createReporter({ dir: '/nonexistent' });
    // 用环境变量指到假服务器
    process.env.MOSS_SERVER = fake.url;
    const r = await createReporter({ dir: '/nonexistent' });
    const id = await r.start({ project: 'proj-x', page: 'p01', index: 1, title: '首页', kind: 'render' });
    assert.equal(id, 't_fake_1');
    r.tick(42);
    await r.done({ versionId: 'v009', image: '/media/proj-x/x.png', seed: 123 });

    const start = fake.calls.find((c) => c.op === 'start');
    assert.equal(start.project, 'proj-x');
    assert.equal(start.page, 'p01');
    assert.equal(start.kind, 'render');
    const done = fake.calls.find((c) => c.op === 'done');
    assert.equal(done.id, 't_fake_1');
    assert.equal(done.versionId, 'v009');
    assert.equal(done.seed, 123);
    void reporter;
    void reporter2;
  } finally {
    delete process.env.MOSS_SERVER;
    await new Promise((resolve) => fake.server.close(resolve));
  }
});

await test('fail 会把原因带上', async () => {
  const fake = await fakeServer();
  process.env.MOSS_SERVER = fake.url;
  try {
    const r = await createReporter({ dir: '/nonexistent' });
    await r.start({ project: 'p', page: 'p01', kind: 'edit' });
    await r.fail(new Error('连不上 ComfyUI'));
    const failed = fake.calls.find((c) => c.op === 'fail');
    assert.equal(failed.id, 't_fake_1');
    assert.match(failed.error, /ComfyUI/);
  } finally {
    delete process.env.MOSS_SERVER;
    await new Promise((resolve) => fake.server.close(resolve));
  }
});

await test('服务器不在：立刻退化成 noop，不抛错、不拖时间', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moss-reporter-'));
  // 指向一个肯定没监听的端口
  await writeFile(join(dir, 'server.json'), JSON.stringify({ url: 'http://127.0.0.1:9', port: 9 }), 'utf8');
  try {
    const started = Date.now();
    const r = await createReporter({ dir });
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 1200, `探活不该超过 1.2 秒，实际 ${elapsed}ms`);
    const id = await r.start({ project: 'p', page: 'p01' });
    assert.equal(id, null);
    r.tick(10);
    await r.done({ versionId: 'v001' }); // 不该抛
    await r.fail(new Error('x')); // 不该抛
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await test('读 data/server.json 找地址', async () => {
  const fake = await fakeServer();
  const dir = await mkdtemp(join(tmpdir(), 'moss-reporter-'));
  await writeFile(join(dir, 'server.json'), JSON.stringify({ url: fake.url, port: fake.port }), 'utf8');
  try {
    const r = await createReporter({ dir });
    const id = await r.start({ project: 'p', page: 'p02' });
    assert.equal(id, 't_fake_1');
  } finally {
    await rm(dir, { recursive: true, force: true });
    await new Promise((resolve) => fake.server.close(resolve));
  }
});

await test('目录不存在也不炸（读不到 server.json 就退到默认地址）', async () => {
  // 本机可能真的开着预览服务器，所以这里只断言「不抛错」，不断言一定拿不到 id
  const r = await createReporter({ dir: '/definitely/not/here' });
  let id = 'unset';
  await r.start({ project: 'p', page: 'p01' }).then((value) => {
    id = value;
  });
  assert.ok(id === null || typeof id === 'string', '要么 null 要么任务 id，不能抛错');
  await r.done({});
  await r.fail(new Error('x'));
});

console.log(`\n${passed} 通过，${failures.length} 失败`);
if (failures.length) process.exitCode = 1;
