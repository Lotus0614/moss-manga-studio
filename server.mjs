#!/usr/bin/env node
// 预览服务器：给人和 Agent 看/改漫画存档用。
//   node server.mjs                 → http://127.0.0.1:5123
//   MOSS_ARCHIVE=/path node server.mjs
//
// 不做 Agent、不做对话：改内容由用户点，或由外部 Agent 走 CLI。

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, watch } from 'node:fs';
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { EventEmitter } from 'node:events';

import { resolveConfigDir, resolveArchiveDir, ensureConfig, readConfig, writeConfig } from './scripts/lib/config.mjs';
import { ensureArchive, readState } from './scripts/lib/archive.mjs';
import {
  listProjects,
  getProject,
  createProject,
  saveProject,
  removeProject,
  listPages,
  getPage,
  savePage,
  createPage,
  removePage,
  saveImage,
  getVersions,
  currentOf,
  setCurrentVersion,
  changes,
  ack,
} from './scripts/lib/archive.mjs';
import { listWorkflows, readWorkflow, saveWorkflow, checkWorkflow } from './scripts/lib/workflow.mjs';
import { renderPage } from './scripts/lib/render.mjs';
import { editPage, sourceVersion } from './scripts/lib/edit.mjs';
import { createTasks } from './scripts/lib/tasks.mjs';
import { compilePage } from './core/compile.mjs';
import { normalizeCharacters } from './core/characters.mjs';
import { createPanelItem } from './core/manga-doc.mjs';
import { ComfyClient } from './scripts/lib/comfy.mjs';

const PORT = Number(process.env.PORT || 5123);
const HOST = process.env.HOST || '127.0.0.1';
const CONFIG_DIR = resolveConfigDir();
const CONFIG = await readConfig(CONFIG_DIR);
const ARCHIVE = resolveArchiveDir(CONFIG, process.env.MOSS_ARCHIVE);
const WEB = resolve(import.meta.dirname, 'web');
const CORE = resolve(import.meta.dirname, 'core');

const bus = new EventEmitter();
bus.setMaxListeners(32);
// 生成任务表 + 队列：网页点生成、Agent 用 CLI 出图，最后都记到这里
const tasks = createTasks({ emit: (type, task) => bus.emit(type, task) });

// ---------------------------------------------------------------- 存档监听
// CLI / Agent 直接改存档（写页面 JSON、出图）不会经过服务器，这里盯着目录，
// 变了就通过 SSE 推给网页，省得手动刷新。
//
// 判断「要不要刷新」靠 rev / 版本号比较，不靠时间窗：
// 时间窗会漏事件（网页刚存完、Agent 紧接着改，那次改动就永久丢了）。

const WATCH_DEBOUNCE = 300;
let pendingChanges = new Map();
let watchTimer = null;

/** 只关心页面、版本、图片、项目文件；日志/pid/日志滚动一律忽略 */
function classifyPath(rel) {
  const parts = String(rel).split(/[\\/]/).filter(Boolean);
  if (parts[0] !== 'projects' || parts.length < 3) return null;
  const project = parts[1];
  const rest = parts[2];
  if (rest === 'pages' && parts[3]) return { project, page: parts[3].replace(/\.json$/i, ''), kind: 'page' };
  if (rest === 'versions.json') return { project, kind: 'versions' };
  if (rest === 'versions' && parts[3]) return { project, kind: 'versions' };
  if (rest === 'images' && parts[3]) return { project, kind: 'image' };
  if (rest === 'project.json') return { project, kind: 'project' };
  return null;
}

/** 每个项目已经见过的版本号：用来认出「谁出了新版图」 */
const knownVersions = new Map();

async function rememberVersions(slug) {
  const store = await getVersions(ARCHIVE, slug).catch(() => ({ items: [] }));
  const ids = (store.items || []).map((v) => v.id);
  knownVersions.set(slug, new Set(ids));
  return store;
}

async function seedVersions() {
  const projects = await listProjects(ARCHIVE).catch(() => []);
  for (const project of projects) await rememberVersions(project.slug);
}

/**
 * 新出现的版本 = 外面出的图（CLI / Agent）。
 * 网页自己点生成的那条已经有任务了，用 byVersion / recentlyTouched 排掉，避免一条结果两条任务。
 */
async function attributeVersions(slug) {
  const store = await getVersions(ARCHIVE, slug).catch(() => ({ items: [] }));
  const seen = knownVersions.get(slug) || new Set();
  const all = store.items || [];
  const fresh = all.filter((v) => !seen.has(v.id));
  knownVersions.set(slug, new Set(all.map((v) => v.id)));

  for (const version of fresh) {
    if (tasks.byVersion(version.id)) continue;
    if (tasks.recentlyTouched(slug, version.page)) continue;
    const page = await getPage(ARCHIVE, slug, version.page).catch(() => null);
    tasks.add({
      project: slug,
      page: version.page,
      index: version.pageIndex ?? page?.index,
      title: page?.title || '',
      kind: version.kind || 'render',
      source: 'agent',
      status: 'done',
      versionId: version.id,
      image: version.image,
      seed: version.seed,
      at: version.at || new Date().toISOString(),
      finishedAt: version.at || new Date().toISOString(),
    });
  }
}
async function flushChanges() {
  watchTimer = null;
  const items = [...pendingChanges.values()];
  pendingChanges = new Map();
  if (!items.length) return;

  // 页面事件带上 rev：客户端拿它和手上的 page.rev 比，比自己新才刷新
  for (const item of items) {
    if (item.kind !== 'page') continue;
    const page = await getPage(ARCHIVE, item.project, item.page).catch(() => null);
    if (!page) continue;
    item.rev = page.rev;
    item.index = page.index;
    item.title = page.title;
    item.mtime = await pageMtime(item.project, item.page);
  }

  const state = await readState(ARCHIVE).catch(() => ({}));
  bus.emit('archive', { at: new Date().toISOString(), rev: state.rev ?? 0, items });

  for (const slug of new Set(items.filter((one) => one.kind === 'versions').map((one) => one.project))) {
    await attributeVersions(slug);
  }
}

// 监听器本身可能中途失效（Windows 递归监听缓冲区溢出会抛 error 然后静默停摆），
// 所以：挂 error → 记日志 → 隔一会儿重建 → 重建成功让客户端整体重拉一次。
// MOSS_NO_WATCH=1 可以彻底关掉监听（排查用；关掉后网页只能靠任务事件 + 轮询）。
const NO_WATCH = process.env.MOSS_NO_WATCH === '1';
let watcher = null;
let watchRetry = null;

function startArchiveWatch() {
  if (NO_WATCH) {
    console.error('[watch] 已按 MOSS_NO_WATCH=1 关闭文件监听');
    return false;
  }
  try {
    watcher = watch(ARCHIVE, { recursive: true }, (_event, filename) => {
      const hit = classifyPath(filename);
      if (!hit) return;
      pendingChanges.set(`${hit.project}|${hit.page || ''}|${hit.kind}`, hit);
      if (watchTimer) clearTimeout(watchTimer);
      watchTimer = setTimeout(flushChanges, WATCH_DEBOUNCE);
    });
    watcher.on('error', (err) => {
      console.error(`[watch] 监听出错，准备重建：${err.message}`);
      try {
        watcher?.close();
      } catch {
        /* 已经废了 */
      }
      watcher = null;
      if (watchRetry) return;
      watchRetry = setTimeout(() => {
        watchRetry = null;
        if (startArchiveWatch()) bus.emit('resync', { reason: 'watch-restarted', at: new Date().toISOString() });
      }, 3000);
    });
    return true;
  } catch (err) {
    console.error(`[watch] 监听存档失败（外部改动不会自动刷新）：${err.message}`);
    return false;
  }
}

// ---------------------------------------------------------------- 小工具

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

const fail = (res, status, message) => json(res, status, { error: message });

async function body(req, limit = 8 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('请求体过大'), { status: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw Object.assign(new Error(`JSON 解析失败：${err.message}`), { status: 400 });
  }
}

/** data:image/png;base64,… → { buffer, ext }；不是图片就返回 null */
function decodeDataUrl(raw) {
  const text = String(raw || '').trim();
  const hit = text.match(/^data:image\/(png|jpeg|jpg|webp);base64,([\s\S]+)$/i);
  if (!hit) return null;
  const buffer = Buffer.from(hit[2], 'base64');
  if (!buffer.length) return null;
  const kind = hit[1].toLowerCase();
  return { buffer, ext: kind === 'jpeg' || kind === 'jpg' ? 'jpg' : kind };
}

async function sendFile(res, file, type) {
  try {
    const info = await stat(file);
    res.writeHead(200, {
      'content-type': type || MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': info.size,
      'cache-control': 'no-cache',
    });
    createReadStream(file).pipe(res);
  } catch {
    fail(res, 404, '文件不存在');
  }
}

function sse(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });
  res.write(':ok\n\n');
  return {
    send(event, data) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    close() {
      res.end();
    },
  };
}

const safe = (name) => String(name).replace(/[^a-zA-Z0-9._-]/g, '');

/**
 * 存档指纹：只读 stat（不读内容），文件一变指纹就变。
 * 客户端每几秒比对一次，万一 fs.watch 漏事件也能自己发现该刷新了。
 */
async function statLine(file) {
  try {
    const info = await stat(file);
    return `${info.size}:${Math.round(info.mtimeMs)}`;
  } catch {
    return '-';
  }
}

/** 页面文件的修改时间：直接改 JSON（不经过 savePage）时 rev 不变，得靠它认出来 */
async function pageMtime(slug, pageId) {
  try {
    const info = await stat(join(ARCHIVE, 'projects', slug, 'pages', `${pageId}.json`));
    return Math.round(info.mtimeMs);
  } catch {
    return 0;
  }
}

async function revisionStamp(slug) {
  const slugs = slug ? [slug] : (await listProjects(ARCHIVE).catch(() => [])).map((p) => p.slug);
  const parts = [];
  for (const one of slugs) {
    const base = join(ARCHIVE, 'projects', one);
    parts.push(await statLine(join(base, 'versions.json')));
    const files = await readdir(join(base, 'pages')).catch(() => []);
    for (const file of files.sort()) parts.push(await statLine(join(base, 'pages', file)));
  }
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);
}

// ---------------------------------------------------------------- 路由

async function route(req, res, url) {
  const path = decodeURIComponent(url.pathname);
  const method = req.method;

  if (path === '/api/health') return json(res, 200, { ok: true, archive: ARCHIVE, version: '2.0.0' });

  if (path === '/api/config') {
    if (method === 'GET') return json(res, 200, await readConfig(CONFIG_DIR));
    if (method === 'PUT') {
      const patch = await body(req);
      return json(res, 200, await writeConfig(CONFIG_DIR, { ...patch, params: patch.params }));
    }
  }

  if (path === '/api/comfy/models' && method === 'GET') {
    const config = await readConfig(CONFIG_DIR);
    const client = new ComfyClient({ url: config.comfy.url });
    try {
      const info = await client.objectInfo();
      return json(res, 200, {
        ok: true,
        checkpoints: info.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [],
        loras: info.LoraLoader?.input?.required?.lora_name?.[0] || [],
        samplers: info.KSampler?.input?.required?.sampler_name?.[0] || [],
      });
    } catch (err) {
      return json(res, 200, { ok: false, message: err.message, checkpoints: [], loras: [], samplers: [] });
    }
  }

  if (path === '/api/workflows' && method === 'GET') return json(res, 200, { workflows: await listWorkflows(CONFIG_DIR) });

  const wfMatch = path.match(/^\/api\/workflows\/([^/]+)$/);
  if (wfMatch) {
    const name = safe(wfMatch[1]);
    if (method === 'GET') {
      const wf = await readWorkflow(CONFIG_DIR, name);
      // 带上占位符清单：设置弹窗要按它决定显示哪些参数
      return json(res, 200, { ...wf, ...checkWorkflow(wf.raw) });
    }
    if (method === 'PUT') {
      const payload = await body(req);
      const raw = typeof payload.raw === 'string' ? payload.raw : JSON.stringify(payload.raw, null, 2);
      const imported = await saveWorkflow(CONFIG_DIR, raw, name);
      return json(res, 200, imported);
    }
  }

  if (path === '/api/changes' && method === 'GET') {
    const since = url.searchParams.get('since');
    const result = await changes(ARCHIVE, since === null ? undefined : Number(since));
    for (const group of result.pages) {
      const project = await getProject(ARCHIVE, group.project);
      const page = await getPage(ARCHIVE, group.project, group.page);
      if (project && page) {
        group.index = page.index;
        group.title = page.title;
        group.warnings = compilePage(page, project).warnings.length;
      }
    }
    return json(res, 200, result);
  }

  if (path === '/api/ack' && method === 'POST') return json(res, 200, await ack(ARCHIVE));

  // 任务列表：网页只读，队列由服务器内部推进
  if ((path === '/api/tasks' || path === '/api/jobs') && method === 'GET') {
    const project = url.searchParams.get('project') || '';
    const limit = Math.min(200, Number(url.searchParams.get('limit')) || 50);
    const list = tasks.list(limit).filter((task) => !project || task.project === project);
    const out = { tasks: list, active: tasks.active(), seq: tasks.lastSeq() };
    return json(res, 200, path === '/api/jobs' ? { ...out, jobs: out.tasks } : out);
  }

  // CLI 播报：出图开始 / 心跳 / 结束。这是「渲染中也能看到任务」的来源。
  if (path === '/api/tasks/external' && method === 'POST') {
    const payload = await body(req);
    const op = String(payload.op || '');
    const slug = safe(payload.project || '');
    const pageId = safe(payload.page || '');

    if (op === 'start') {
      if (!slug || !pageId) return fail(res, 400, '缺少 project / page');
      const page = await getPage(ARCHIVE, slug, pageId).catch(() => null);
      const task = tasks.announce({
        externalId: String(payload.externalId || ''),
        project: slug,
        page: pageId,
        index: page?.index,
        title: page?.title || '',
        kind: payload.kind === 'edit' ? 'edit' : 'render',
        prompt: payload.prompt ? String(payload.prompt).slice(0, 200) : undefined,
      });
      return json(res, 201, { id: task.id });
    }

    if (op === 'beat') {
      const id = String(payload.id || '');
      if (!id || !tasks.get(id)) return fail(res, 404, '任务不存在');
      tasks.beat(id, Number.isFinite(payload.progress) ? { progress: Number(payload.progress) } : {});
      return json(res, 200, { ok: true });
    }

    if (op === 'done') {
      const id = String(payload.id || '');
      if (!id || !tasks.get(id)) return fail(res, 404, '任务不存在');
      tasks.finish(id, {
        ...(payload.versionId ? { versionId: String(payload.versionId) } : {}),
        ...(payload.image ? { image: String(payload.image) } : {}),
        ...(Number.isFinite(payload.seed) ? { seed: Number(payload.seed) } : {}),
      });
      return json(res, 200, { ok: true });
    }

    if (op === 'fail') {
      const id = String(payload.id || '');
      if (!id || !tasks.get(id)) return fail(res, 404, '任务不存在');
      tasks.fail(id, payload.error || '出图失败');
      return json(res, 200, { ok: true });
    }

    return fail(res, 400, `不认识的 op：${op || '（空）'}`);
  }

  // 存档指纹：SSE 万一把事件漏了，客户端靠它发现「该刷新了」
  if (path === '/api/revision' && method === 'GET') {
    const project = safe(url.searchParams.get('project') || '');
    return json(res, 200, { stamp: await revisionStamp(project), active: tasks.active() });
  }

  if ((path === '/api/stream' || path === '/api/jobs/stream') && method === 'GET') {
    const stream = sse(res);
    const onTask = (task) => stream.send('task', task);
    const onArchive = (change) => stream.send('archive', change);
    // 监听器重建之类的事会让客户端整体重拉一次
    const onResync = (info) => stream.send('resync', info);
    bus.on('task', onTask);
    bus.on('archive', onArchive);
    bus.on('resync', onResync);
    stream.send('snapshot', { tasks: tasks.list(50), active: tasks.active(), seq: tasks.lastSeq() });
    // 长连接别被中间层掐掉
    const ping = setInterval(() => res.write(':ping\n\n'), 15000);
    req.on('close', () => {
      clearInterval(ping);
      bus.off('task', onTask);
      bus.off('archive', onArchive);
      bus.off('resync', onResync);
    });
    return;
  }

  if (path === '/api/projects') {
    if (method === 'GET') {
      const projects = await listProjects(ARCHIVE);
      const withCover = [];
      for (const project of projects) {
        const store = await getVersions(ARCHIVE, project.slug);
        const pages = await listPages(ARCHIVE, project.slug);
        const latest = store.items.slice(-1)[0];
        // 按页序的「当前采用」版本图片（空串 = 这页还没出图）
        const currentImages = pages
          .map((p) => {
            const id = currentOf(store, p.id);
            return store.items.find((v) => v.id === id)?.image || '';
          })
          .filter(Boolean);
        // 封面固定用第一页的当前版；第一页还没出图时往后顺延，卡片不至于空着
        // 胶片条只放封面之后的页，避免和封面重复
        const covers = currentImages.slice(1, 4);
        withCover.push({
          slug: project.slug,
          name: project.name,
          size: project.size,
          pages: pages.length,
          images: store.items.length,
          covers,
          cover: currentImages[0] || '',
          updatedAt: latest?.at || project.createdAt,
        });
      }
      return json(res, 200, { projects: withCover });
    }
    if (method === 'POST') {
      const payload = await body(req);
      const cfg = await readConfig(CONFIG_DIR);
      const project = await createProject(ARCHIVE, {
        name: payload.name,
        size: payload.size,
        canvas: payload.canvas || cfg.defaults.canvas,
        defaults: { style: cfg.defaults.style, vertical: cfg.defaults.vertical },
      });
      if (payload.withSamplePage) {
        await createPage(ARCHIVE, project.slug, {});
      }
      return json(res, 201, project);
    }
  }

  const projMatch = path.match(/^\/api\/projects\/([^/]+)(?:\/(.*))?$/);
  if (projMatch) {
    const slug = safe(projMatch[1]);
    const rest = projMatch[2] || '';
    const project = await getProject(ARCHIVE, slug);
    if (!project && rest !== '') return fail(res, 404, '项目不存在');

    if (rest === '') {
      if (method === 'GET') return json(res, 200, project);
      if (method === 'PUT') {
        const payload = await body(req);
        if (payload.name) project.name = String(payload.name);
        if (payload.defaults) project.defaults = { ...(project.defaults || {}), ...payload.defaults };
        if (payload.generation) project.generation = { ...(project.generation || {}), ...payload.generation };
        if (Array.isArray(payload.canvas)) project.canvas = payload.canvas;
        if (payload.params) project.params = { ...(project.params || {}), ...payload.params };
        if (Array.isArray(payload.characters)) project.characters = normalizeCharacters(payload.characters);
        await saveProject(ARCHIVE, project);
        return json(res, 200, project);
      }
      if (method === 'DELETE') {
        await removeProject(ARCHIVE, slug);
        return json(res, 200, { ok: true });
      }
    }

    if (rest === 'pages') {
      if (method === 'GET') {
        const pages = await listPages(ARCHIVE, slug);
        const versions = await getVersions(ARCHIVE, slug);
        // 左页序列显示这一页**当前采用**的那版，不是最新那版
        const coverOf = (pageId) => {
          const current = currentOf(versions, pageId);
          const picked = versions.items.find((v) => v.id === current);
          return picked?.image || versions.items.filter((v) => v.page === pageId).slice(-1)[0]?.image || '';
        };
        return json(res, 200, { pages: pages.map((p) => ({ ...p, cover: coverOf(p.id) })) });
      }
      if (method === 'POST') {
        const payload = await body(req);
        const created = await createPage(ARCHIVE, slug, { title: payload.title || '' });
        return json(res, 201, created.page);
      }
    }

    if (rest === 'versions/current' && method === 'POST') {
      const payload = await body(req);
      const store = await setCurrentVersion(ARCHIVE, slug, String(payload.pageId || ''), String(payload.id || ''));
      return json(res, 200, store);
    }

    const pageMatch = rest.match(/^pages\/([^/]+)(?:\/(compile|render|edit))?$/);
    if (pageMatch) {
      const pageId = safe(pageMatch[1]);
      const action = pageMatch[2];
      const page = await getPage(ARCHIVE, slug, pageId);
      if (!page) return fail(res, 404, '页面不存在');

      if (action === 'compile' && method === 'POST') {
        const compiled = compilePage(page, await getProject(ARCHIVE, slug));
        return json(res, 200, { json: compiled.json, doc: compiled.doc, warnings: compiled.warnings, stats: compiled.stats });
      }

      if (action === 'render' && method === 'POST') {
        const payload = await body(req);
        const config = await readConfig(CONFIG_DIR);
        if (tasks.activeFor(slug, page.id)) return fail(res, 409, '这一页已经有一个生成任务在排队或正在跑了');
        const task = tasks.add({
          project: slug,
          page: page.id,
          index: page.index,
          title: page.title || '',
          kind: 'render',
          source: 'web',
        });
        tasks.enqueue(task, async (_task, ctx) => {
          const result = await renderPage({
            dir: ARCHIVE,
            configDir: CONFIG_DIR,
            slug,
            project,
            page,
            config,
            opts: payload,
            onProgress: (p) => ctx.progress(p?.max ? Math.round((p.value / p.max) * 100) : 0),
          });
          return { image: result.image, seed: result.seed, versionId: result.version?.id };
        });
        return json(res, 202, { task: tasks.get(task.id) });
      }

      if (action === 'edit' && method === 'POST') {
        // 涂鸦图是整页 PNG 的 data URL，比普通请求大得多
        const payload = await body(req, 32 * 1024 * 1024);
        const config = await readConfig(CONFIG_DIR);
        const overlay = decodeDataUrl(payload.overlay);
        if (payload.overlay && !overlay) return fail(res, 400, '涂鸦图格式不对：要 data:image/png;base64,…');
        if (tasks.activeFor(slug, page.id)) return fail(res, 409, '这一页已经有一个任务在排队或正在跑了');
        const task = tasks.add({
          project: slug,
          page: page.id,
          index: page.index,
          title: page.title || '',
          kind: 'edit',
          source: 'web',
          prompt: String(payload.prompt || ''),
          marks: Array.isArray(payload.marks) ? payload.marks.length : 0,
        });
        tasks.enqueue(task, async (_task, ctx) => {
          const result = await editPage({
            dir: ARCHIVE,
            configDir: CONFIG_DIR,
            slug,
            project,
            page,
            config,
            opts: {
              prompt: payload.prompt,
              seed: payload.seed,
              marks: payload.marks,
              ...(overlay ? { overlay: overlay.buffer, overlayExt: overlay.ext } : {}),
            },
            onProgress: (p) => ctx.progress(p?.max ? Math.round((p.value / p.max) * 100) : 0),
          });
          return { image: result.image, base: result.base, versionId: result.version?.id };
        });
        return json(res, 202, { task: tasks.get(task.id) });
      }

      if (method === 'GET') {
        const store = await getVersions(ARCHIVE, slug);
        const items = store.items.filter((v) => v.page === page.id);
        // 修图用「当前采用的那一版」
        const base = sourceVersion(store, page.id);
        return json(res, 200, {
          page,
          versions: items,
          current: currentOf(store, page.id),
          editBase: base ? { id: base.id, image: base.image, kind: base.kind || 'render' } : null,
          mtime: await pageMtime(slug, page.id),
        });
      }
      if (method === 'PUT') {
        const payload = await body(req);
        const next = { ...page, ...payload, id: page.id };
        if (!payload.replaceItems) {
          // 局部更新：按 id 合并，避免把没提到的 item 删掉
          const map = new Map(page.items.map((it) => [it.id, it]));
          for (const item of payload.items || []) {
            if (item?.id && map.has(item.id)) map.set(item.id, { ...map.get(item.id), ...item });
            else map.set(item?.id || `tmp_${Math.random().toString(36).slice(2, 8)}`, item);
          }
          for (const id of payload.removeItems || []) map.delete(id);
          next.items = [...map.values()];
        }
        const saved = await savePage(ARCHIVE, slug, next, { actor: 'web' });
        return json(res, 200, { ...saved.page, mtime: await pageMtime(slug, page.id) });
      }
      if (method === 'DELETE') {
        await removePage(ARCHIVE, slug, page.id);
        return json(res, 200, { ok: true });
      }
    }
  }

  if (path.startsWith('/media/')) {
    const parts = path.split('/').filter(Boolean);
    const slug = safe(parts[1]);
    const file = safe(parts[2]);
    return sendFile(res, join(ARCHIVE, 'projects', slug, 'images', file));
  }

  if (path.startsWith('/config/')) {
    return sendFile(res, resolve(join(WEB, '..', 'config', safe(path.slice(8)))), 'text/javascript; charset=utf-8');
  }

  if (path.startsWith('/core/')) {
    return sendFile(res, join(CORE, safe(path.slice(6))), 'text/javascript; charset=utf-8');
  }

  return false;
}

// ---------------------------------------------------------------- 静态

async function serveStatic(req, res, path) {
  const rel = path === '/' ? 'index.html' : path.replace(/^\/+/, '');
  const file = resolve(join(WEB, rel));
  if (!file.startsWith(WEB + sep) && file !== WEB) return fail(res, 403, '越界访问');
  if (!existsSync(file)) return fail(res, 404, '未找到');
  if (rel === 'index.html') {
    let html = await readFile(file, 'utf8');
    const vendored = existsSync(join(WEB, 'vendor', 'preact.mjs'));
    html = html.replace('<!--IMPORTMAP-->', importmap(vendored));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    return res.end(html);
  }
  return sendFile(res, file);
}

function importmap(vendored) {
  const map = vendored
    ? { preact: '/vendor/preact.mjs', 'preact/hooks': '/vendor/preact-hooks.mjs', htm: '/vendor/htm.mjs' }
    : {
        preact: 'https://esm.sh/preact@10.25.4',
        'preact/hooks': 'https://esm.sh/preact@10.25.4/hooks',
        htm: 'https://esm.sh/htm@3.1.1',
      };
  return `<script type="importmap">${JSON.stringify({ imports: map })}</script>`;
}

// ---------------------------------------------------------------- 启动

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  try {
    const handled = await route(req, res, url);
    if (handled !== false) return;
    if (req.method === 'GET') return await serveStatic(req, res, url.pathname);
    return fail(res, 404, '未找到');
  } catch (err) {
    if (res.headersSent) return res.end();
    const status = err.status || 500;
    if (status >= 500) console.error('[error]', err);
    fail(res, status, err.message || '服务器内部错误');
  }
});

await ensureConfig(CONFIG_DIR);
await ensureArchive(ARCHIVE);
// 先记下现有版本号，之后新增的才算「外部出的图」
await seedVersions();
startArchiveWatch();

// 外部任务的心跳看门狗：CLI 崩了别让浮窗永远停在「生成中…」
setInterval(() => {
  if (tasks.sweep()) bus.emit('task-dirty');
}, 5000).unref();

// CLI 靠这个文件找到预览服务器（播报出图进度用）。
// 地址永远写 127.0.0.1：哪怕监听 0.0.0.0（--lan），本机自己也是走回环更稳。
const SERVER_INFO = join(ARCHIVE, 'server.json');
async function writeServerInfo() {
  try {
    const info = { url: `http://127.0.0.1:${PORT}`, port: PORT, host: HOST, pid: process.pid, at: new Date().toISOString() };
    await writeFile(SERVER_INFO, `${JSON.stringify(info, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.error(`[server] 写 server.json 失败（CLI 播报会退化）：${err.message}`);
  }
}
async function clearServerInfo() {
  try {
    const info = JSON.parse(await readFile(SERVER_INFO, 'utf8'));
    if (info?.pid === process.pid) await rm(SERVER_INFO, { force: true });
  } catch {
    /* 没有就算了 */
  }
}

server.listen(PORT, HOST, async () => {
  const config = await readConfig(CONFIG_DIR);
  const state = await readState(ARCHIVE);
  await writeServerInfo();
  console.log('');
  console.log(`  MOSS 漫画预览  http://127.0.0.1:${PORT}`);
  if (HOST === '0.0.0.0') console.log(`  监听 0.0.0.0：手机用本机局域网 IP 打开（manga serve --lan 会打印出来）`);
  console.log(`  配置 ${CONFIG_DIR}`);
  console.log(`  存档 ${ARCHIVE}（rev ${state.rev}）`);
  console.log(`  ComfyUI ${config.comfy.url} · 工作流 ${config.workflow.name || '（未设置）'} · 参数 ${Object.keys(config.params || {}).length} 个`);
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 被占用：PORT=5124 node server.mjs`);
    process.exit(1);
  }
  throw err;
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    void clearServerInfo().finally(() => server.close(() => process.exit(0)));
  });
}

