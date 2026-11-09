// CLI → 预览服务器的「播报器」。
//
// 为什么需要它：Agent 用 CLI 出图时，网页原本只能等 versions.json 落地才看到一条
// 「已完成」任务，中间那 30-40 秒一无所知。这里让 CLI 主动说一声：
//   开始 → 心跳 → 成功/失败
//
// 三条铁律：
//   1. 尽力而为：服务器没开、端口不通、超时——全部静默跳过，**绝不拖慢或搞挂出图**
//   2. 不写 stdout：`--json` 的输出必须保持干净
//   3. 每个请求 400ms 上限，串行不堆积（心跳丢了不影响正确性）

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const TIMEOUT_MS = 400;
const BEAT_MS = 3000;

/** 找预览服务器：data/server.json → 默认端口 → 环境变量 */
async function discover(dir) {
  const fromEnv = String(process.env.MOSS_SERVER || '').trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  try {
    const file = join(dir, 'server.json');
    if (existsSync(file)) {
      const info = JSON.parse(await readFile(file, 'utf8'));
      if (info?.url) return String(info.url).replace(/\/+$/, '');
      if (info?.port) return `http://127.0.0.1:${info.port}`;
    }
  } catch {
    /* 读不到就当没有 */
  }
  return 'http://127.0.0.1:5123';
}

async function post(base, path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json().catch(() => ({}));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {object} options
 * @param {string} options.dir 存档目录（用来找 server.json）
 * @returns reporter：start / tick / done / fail / stop
 */
export async function createReporter({ dir, enabled = true } = {}) {
  if (!enabled) return noopReporter();

  const base = await discover(dir);
  // 先探一下：服务器没开就直接退化成 noop，别让每次出图都白等超时
  const reachable = await (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${base}/api/health`, { signal: controller.signal });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  })();
  if (!reachable) return noopReporter();

  let id = null;
  let beatTimer = null;
  let lastBeat = 0;

  async function send(body) {
    const data = await post(base, '/api/tasks/external', body);
    return data;
  }

  function startBeating() {
    if (beatTimer) return;
    beatTimer = setInterval(() => {
      if (!id) return;
      void send({ op: 'beat', id });
    }, BEAT_MS);
    // 别让这个定时器拖住进程退出
    beatTimer.unref?.();
  }

  function stopBeating() {
    if (!beatTimer) return;
    clearInterval(beatTimer);
    beatTimer = null;
  }

  return {
    /** 开始：拿到服务器分配的任务 id（失败也不影响出图） */
    async start(meta = {}) {
      try {
        const data = await send({ op: 'start', ...meta });
        id = data?.id || null;
        if (id) startBeating();
      } catch {
        id = null;
      }
      return id;
    },

    /** 心跳：顺手把 progress 带上（UI 不展示，方便排查） */
    tick(progress) {
      if (!id) return;
      const at = Date.now();
      if (at - lastBeat < BEAT_MS) return;
      lastBeat = at;
      void send({ op: 'beat', id, ...(Number.isFinite(progress) ? { progress } : {}) });
    },

    async done(patch = {}) {
      stopBeating();
      if (!id) return;
      await send({ op: 'done', id, ...patch });
      id = null;
    },

    async fail(error) {
      stopBeating();
      if (!id) return;
      await send({ op: 'fail', id, error: String(error?.message || error || '失败') });
      id = null;
    },

    stop: stopBeating,
  };
}

function noopReporter() {
  return {
    async start() {
      return null;
    },
    tick() {},
    async done() {},
    async fail() {},
    stop() {},
  };
}
