// 任务队列自测：不依赖 ComfyUI（runner 全用假的）。
//   node scripts/dev/test-tasks.mjs

import assert from 'node:assert/strict';

import { createTasks } from '../lib/tasks.mjs';

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await test('按入队顺序执行，并发始终是 1', async () => {
  const seen = [];
  let live = 0;
  let peak = 0;
  const tasks = createTasks();
  const mk = (name) =>
    tasks.enqueue(
      tasks.add({ page: name, project: 'p' }),
      async () => {
        live += 1;
        peak = Math.max(peak, live);
        seen.push(name);
        await sleep(5);
        live -= 1;
        return { image: `/m/${name}.png`, versionId: `v_${name}` };
      }
    );
  mk('a');
  mk('b');
  mk('c');
  await sleep(60);
  assert.deepEqual(seen, ['a', 'b', 'c'], '执行顺序必须和入队一致');
  assert.equal(peak, 1, '同一时刻只能有一个任务在跑');
  assert.equal(tasks.active(), 0);
  assert.ok(tasks.list().every((t) => t.status === 'done'));
});

await test('失败不阻塞后面，错误原因带在任务上', async () => {
  const tasks = createTasks();
  tasks.enqueue(tasks.add({ page: 'bad' }), async () => {
    throw new Error('工作流没配');
  });
  tasks.enqueue(tasks.add({ page: 'good' }), async () => ({ versionId: 'v002' }));
  await sleep(40);
  const [good, bad] = tasks.list();
  assert.equal(good.status, 'done');
  assert.equal(bad.status, 'error');
  assert.match(bad.error, /工作流没配/);
  assert.equal(tasks.active(), 0, '失败之后队列要能继续');
});

await test('排队位置：在跑的那个也算前面一个', async () => {
  const tasks = createTasks();
  const a = tasks.add({ page: 'a' });
  const b = tasks.add({ page: 'b' });
  const c = tasks.add({ page: 'c' });
  tasks.enqueue(a, () => sleep(30));
  tasks.enqueue(b, () => sleep(5));
  tasks.enqueue(c, () => sleep(5));
  await sleep(5);
  assert.equal(tasks.position(a), 0, '在跑的不排队');
  assert.equal(tasks.position(b), 1);
  assert.equal(tasks.position(c), 2);
  await sleep(60);
});

await test('进度只写变了的字段，重复更新不重复发事件', async () => {
  const events = [];
  const tasks = createTasks({ emit: (type, task) => events.push({ type, task: { ...task } }) });
  const a = tasks.add({ page: 'a' });
  const before = events.length;
  tasks.update(a.id, { progress: 40 });
  tasks.update(a.id, { progress: 40 });
  tasks.update(a.id, { progress: 41 });
  assert.equal(events.length - before, 2, '40 只发一次，41 再发一次');
  tasks.update(a.id, { progress: 41, status: 'running' });
  assert.equal(events.at(-1).task.status, 'running');
});

await test('进度回调把值写到任务上（UI 不展示，但数据要在）', async () => {
  const tasks = createTasks();
  let task;
  tasks.enqueue((task = tasks.add({ page: 'a' })), async (_task, ctx) => {
    ctx.progress(30);
    ctx.progress(70);
    return { versionId: 'v003' };
  });
  await sleep(30);
  assert.equal(tasks.get(task.id).progress, 70);
});

await test('外部任务可以建成已完成，并且能按版本号查回来', async () => {
  const tasks = createTasks();
  tasks.add({
    page: 'p03',
    project: 'proj-x',
    source: 'agent',
    kind: 'render',
    status: 'done',
    versionId: 'v031',
    image: '/media/proj-x/v031.png',
  });
  const hit = tasks.byVersion('v031');
  assert.equal(hit.source, 'agent');
  assert.equal(hit.status, 'done');
  assert.equal(tasks.byVersion('nope'), null);
});

await test('recentlyTouched 用来给外部版本去重', async () => {
  const tasks = createTasks();
  const t = tasks.add({ page: 'p01', project: 'proj-x' });
  tasks.update(t.id, { status: 'done', finishedAt: new Date().toISOString() });
  assert.equal(tasks.recentlyTouched('proj-x', 'p01'), true);
  assert.equal(tasks.recentlyTouched('proj-x', 'p02'), false);
  assert.equal(tasks.recentlyTouched('other', 'p01'), false);
  assert.equal(tasks.recentlyTouched('proj-x', 'p01', 0), false, '时间窗为 0 时不该命中');
});

await test('activeFor 只管排队中和在跑的', async () => {
  const tasks = createTasks();
  const t = tasks.add({ page: 'p01', project: 'proj-x' });
  assert.equal(tasks.activeFor('proj-x', 'p01'), true);
  tasks.update(t.id, { status: 'done' });
  assert.equal(tasks.activeFor('proj-x', 'p01'), false);
});

await test('列表按新到旧，超出上限先丢结束的', async () => {
  const tasks = createTasks({ limit: 3 });
  tasks.add({ page: 'a' });
  const b = tasks.add({ page: 'b' });
  tasks.update(b.id, { status: 'done' });
  tasks.add({ page: 'c' });
  tasks.add({ page: 'd' });
  const list = tasks.list();
  assert.ok(list.length <= 3, `超过上限要裁掉，实际 ${list.length}`);
  assert.equal(list[0].page, 'd');
  assert.ok(!list.some((t) => t.page === 'b'), '裁掉的是最早结束的那条');
});

await test('外部任务：announce → beat → finish 一条线走完', async () => {
  const events = [];
  const tasks = createTasks({ emit: (type, task) => events.push(task) });
  const task = tasks.announce({
    externalId: 'cli-1',
    project: 'proj-x',
    page: 'p02',
    index: 2,
    title: '第二页',
    kind: 'render',
  });
  assert.equal(task.source, 'agent');
  assert.equal(task.status, 'running');
  assert.equal(tasks.active(), 1, '跑的时候要算进活动任务');

  tasks.beat(task.id);
  tasks.finish(task.id, { versionId: 'v010', image: '/media/proj-x/x.png' });
  const done = tasks.get(task.id);
  assert.equal(done.status, 'done');
  assert.equal(done.versionId, 'v010');
  assert.equal(tasks.active(), 0);

  // 播报过的版本能被 byVersion 认领，fs 兜底就不会再记一条
  assert.equal(tasks.byVersion('v010').id, task.id);
  assert.ok(events.some((e) => e.status === 'running'));
  assert.ok(events.some((e) => e.status === 'done'));
});

await test('外部任务：同一个 externalId 只建一条（CLI 重试不会刷两条）', async () => {
  const tasks = createTasks();
  const a = tasks.announce({ externalId: 'same', project: 'p', page: 'p01' });
  const b = tasks.announce({ externalId: 'same', project: 'p', page: 'p01' });
  assert.equal(a.id, b.id);
  assert.equal(tasks.list().length, 1);
});

await test('外部任务失败要带原因', async () => {
  const tasks = createTasks();
  const task = tasks.announce({ externalId: 'cli-2', project: 'p', page: 'p01' });
  tasks.fail(task.id, '连不上 ComfyUI');
  const after = tasks.get(task.id);
  assert.equal(after.status, 'error');
  assert.match(after.error, /ComfyUI/);
});

await test('sweep：心跳超时的外部任务标红，网页任务不受影响', async () => {
  const tasks = createTasks();
  const dead = tasks.announce({ externalId: 'dead', project: 'p', page: 'p01' });
  const web = tasks.add({ project: 'p', page: 'p02' }); // 排队中的网页任务
  // 把 lastSeen 拨回 60 秒前
  tasks.update(dead.id, { lastSeen: new Date(Date.now() - 60000).toISOString() });
  const touched = tasks.sweep();
  assert.equal(touched, 1);
  assert.equal(tasks.get(dead.id).status, 'error');
  assert.match(tasks.get(dead.id).error, /失去联系/);
  assert.equal(tasks.get(web.id).status, 'queued', '网页任务不该被扫到');
});

await test('sweep：还在心跳的任务不动', async () => {
  const tasks = createTasks();
  const task = tasks.announce({ externalId: 'alive', project: 'p', page: 'p01' });
  tasks.beat(task.id);
  assert.equal(tasks.sweep(), 0);
  assert.equal(tasks.get(task.id).status, 'running');
});

await test('事件带自增 seq，客户端能发现漏事件', async () => {
  const seen = [];
  const tasks = createTasks({ emit: (type, task) => seen.push(task.seq) });
  tasks.add({ page: 'a' });
  tasks.add({ page: 'b' });
  const c = tasks.add({ page: 'c' });
  tasks.update(c.id, { status: 'done' });
  assert.deepEqual(seen, [1, 2, 3, 4]);
  assert.equal(tasks.lastSeq(), 4);
});

console.log(`\n${passed} 通过，${failures.length} 失败`);
if (failures.length) process.exitCode = 1;
