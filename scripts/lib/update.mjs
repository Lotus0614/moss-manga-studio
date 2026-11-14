// 看远端仓库的 package.json 有没有更高的版本号。
//
// 只回答一个问题：有没有新版本。
// 不跑 git、不比对提交、不碰工作区——更新本身交给人和 agent（AGENTS.md「8. 更新」）。
//
// 地址默认走 gh-proxy 再兜底直连：raw.githubusercontent.com 在某些网络下会 404/超时，
// 代理前缀只是先把请求转发一次，内容还是 GitHub 上那份 package.json（仓库是公开的）。

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const RAW = 'https://raw.githubusercontent.com/Lotus0614/moss-manga-studio/main/package.json';
const DEFAULT_URLS = [`https://gh-proxy.com/${RAW}`, RAW];
const TTL_MS = 30 * 60 * 1000; // 查过一次，半小时内不重复联网
const OFFLINE_TTL_MS = 5 * 60 * 1000; // 查不了只记 5 分钟，免得次次卡住
const TIMEOUT_MS = 6000; // 所有候选 URL 加起来的总预算

/** "2.1.0" → [2, 1, 0]；不像版本号就返回 null */
export function parseVersion(text) {
  const match = String(text || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** a > b 返回 1，相等 0，a < b 返回 -1；任一方不是版本号返回 null */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

async function readCache(file) {
  try {
    const raw = JSON.parse(await readFile(file, 'utf8'));
    if (!raw || typeof raw !== 'object' || !raw.data || typeof raw.at !== 'number') return null;
    return raw;
  } catch {
    return null;
  }
}

/** 拉一个地址上的 package.json；失败不抛，返回 { ok:false, state, error } 好继续试下一个 */
async function fetchPackage(url, timeoutMs) {
  let res;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json', 'user-agent': 'moss-manga' },
    });
  } catch (err) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return { ok: false, state: 'offline', error: timeout ? '超时' : err?.message || '连不上', url };
  }
  if (!res.ok) return { ok: false, state: 'http', status: res.status, error: `HTTP ${res.status}`, url };
  try {
    return { ok: true, data: await res.json(), url };
  } catch {
    return { ok: false, state: 'http', status: res.status, error: '返回的不是 JSON', url };
  }
}

/**
 * 挨个试候选地址，谁先拿到可用的 version 就用谁的结论。
 *
 * @param {object} opts
 * @param {string|string[]} [opts.url]  远端 package.json 地址（一个或一组，按顺序试）
 * @param {string} [opts.current]       本地版本号
 * @param {boolean} [opts.skip]         true = 不查（--no-update）
 * @param {boolean} [opts.fresh]        true = 忽略缓存（--fresh）
 * @param {number} [opts.ttlMs]         缓存有效期
 * @param {number} [opts.timeoutMs]     所有候选地址的总预算
 * @param {string} [opts.root]          仓库根（缓存放 <root>/.cache）
 * @param {string} [opts.cacheDir]      缓存目录
 */
export async function checkUpdate({
  url,
  current = '',
  skip = false,
  fresh = false,
  ttlMs = TTL_MS,
  timeoutMs = TIMEOUT_MS,
  root,
  cacheDir,
} = {}) {
  const targets = (Array.isArray(url) ? url : url ? [url] : []).filter(Boolean);
  const list = targets.length ? targets : DEFAULT_URLS;
  const key = list.join('|');

  if (skip) return { state: 'skipped', current, url: list[0] };

  const cacheFile = root || cacheDir ? join(cacheDir || join(root, '.cache'), 'update-check.json') : '';

  if (cacheFile && !fresh) {
    const cached = await readCache(cacheFile);
    const ttl = cached?.data?.state === 'offline' ? OFFLINE_TTL_MS : ttlMs;
    if (cached && cached.key === key && Date.now() - cached.at < ttl) {
      return { ...cached.data, cached: true, checkedAt: cached.at };
    }
  }

  const remember = async (data) => {
    const payload = { ...data, current };
    if (cacheFile) {
      try {
        await mkdir(dirname(cacheFile), { recursive: true });
        await writeFile(
          cacheFile,
          `${JSON.stringify({ at: Date.now(), key, data: payload }, null, 2)}\n`,
          'utf8'
        );
      } catch {
        /* 缓存写不进去不影响结果 */
      }
    }
    return payload;
  };

  const deadline = Date.now() + timeoutMs;
  let last = { state: 'offline', error: '没有可用的地址', url: list[0] };

  for (const target of list) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    const attempt = await fetchPackage(target, Math.max(300, left));
    if (!attempt.ok) {
      last = attempt;
      continue; // 这个地址不行，换下一个（代理挂了还有直连）
    }
    const latest = typeof attempt.data?.version === 'string' ? attempt.data.version : '';
    if (!parseVersion(latest)) {
      last = { state: 'http', status: 200, error: '远端 package.json 没有可用的 version', url: target };
      continue;
    }
    const cmp = compareVersions(latest, current);
    return remember({
      state: 'ok',
      latest,
      hasUpdate: cmp === 1,
      via: target,
      ...(cmp === null ? { error: `本地版本号读不出来（${current || '空'}）` } : {}),
    });
  }

  return remember({ state: last.state, status: last.status, error: last.error, via: last.url });
}

/** 给 `doctor` 用的人话：一行「版本 + 更新状态」。 */
export function describeUpdate(update, { version = '' } = {}) {
  const current = update?.current || version || '?';
  const line = `版本：${current}`;
  const cached =
    update?.cached && update.checkedAt
      ? `（${Math.max(1, Math.round((Date.now() - update.checkedAt) / 60000))} 分钟前查过）`
      : '';

  if (!update || update.state === 'skipped') return [`${line} · 更新：跳过（--no-update）`];
  if (update.state === 'offline' || update.state === 'http') {
    return [`${line} · 更新：查不了（${update.error || '连不上'}）`];
  }
  if (update.hasUpdate) {
    return [`${line} · ⚠ 当前有新版本（${update.latest}）！推荐先询问用户是否更新到最新${cached}`];
  }
  if (update.error) return [`${line} · 更新：跳过（${update.error}）`];
  return [`${line} · 已是最新${cached}`];
}
