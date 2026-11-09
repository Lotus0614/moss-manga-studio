// 生成任务表 + 队列。
//
// 为什么单独一个文件：网页点生成、Agent 用 CLI 出图，两边最后都会变成「一页出了新版图」。
// 任务表要把这两条路收成同一种东西，网页才有一个统一的地方看「谁在跑、跑完没、出来什么」。
//
// 这里只管状态流转，不认识 ComfyUI：真正的执行通过 enqueue(task, runner) 传进来。
// 并发固定为 1 —— ComfyUI 本身是一条队列，同时塞两个任务只会两边都变慢。

const MAX_TASKS = 200;

export function createTasks({ emit = () => {}, limit = MAX_TASKS } = {}) {
  /** 老 → 新 */
  const items = [];
  /** 等待执行的任务（item 里的同一个对象） */
  const waiting = [];
  let running = null;
  let seq = 0;
  // 事件序号：客户端靠它发现「中间漏了事件」（自己的 id 计数器另有用途）
  let eventSeq = 0;

  const now = () => new Date().toISOString();

  /** 对外只给副本，免得调用方改到内部状态 */
  const clone = (task) => ({ ...task });

  function notify(task) {
    eventSeq += 1;
    try {
      emit('task', { ...clone(task), seq: eventSeq });
    } catch {
      /* 订阅方出错不该把任务带崩 */
    }
  }

  /** 超上限时先丢最早结束的，尽量不动排队中和在跑的 */
  function trim() {
    while (items.length > limit) {
      const index = items.findIndex((t) => t.status === 'done' || t.status === 'error');
      if (index < 0) return;
      const [gone] = items.splice(index, 1);
      const w = waiting.findIndex((one) => one.task === gone);
      if (w >= 0) waiting.splice(w, 1);
    }
  }

  /**
   * 建任务。meta 可带 status / source / kind / versionId…（外部任务直接建成 done）
   * 返回的是内部对象，enqueue 要用同一个。
   */
  function add(meta = {}) {
    seq += 1;
    const task = {
      id: `t_${Date.now().toString(36)}${seq.toString(36)}`,
      kind: 'render',
      source: 'web',
      status: 'queued',
      at: now(),
      ...meta,
    };
    items.push(task);
    trim();
    notify(task);
    return task;
  }

  /** 只写真的变了的字段，进度一类高频更新不会刷屏 */
  function update(id, patch = {}) {
    const task = items.find((one) => one.id === id);
    if (!task) return null;
    let changed = false;
    for (const [key, value] of Object.entries(patch)) {
      if (task[key] === value) continue;
      task[key] = value;
      changed = true;
    }
    if (changed) notify(task);
    return task;
  }

  /** 前面还有几个：在跑的算一个，排队的按入队顺序数 */
  function position(task) {
    if (!task || task.status !== 'queued') return 0;
    const at = waiting.findIndex((one) => one.task === task);
    if (at < 0) return 0;
    return at + (running ? 1 : 0);
  }

  async function pump() {
    if (running) return;
    const next = waiting.shift();
    if (!next) return;
    running = next;
    const startedAt = now();
    update(next.task.id, { status: 'running', startedAt });
    try {
      const result = await next.runner(next.task, {
        progress: (value) => update(next.task.id, { progress: value }),
      });
      update(next.task.id, {
        status: 'done',
        finishedAt: now(),
        ms: startedAt ? Date.now() - new Date(startedAt).getTime() : undefined,
        ...(result || {}),
      });
    } catch (err) {
      update(next.task.id, {
        status: 'error',
        finishedAt: now(),
        ms: startedAt ? Date.now() - new Date(startedAt).getTime() : undefined,
        error: err?.message || String(err),
      });
    } finally {
      running = null;
      // 递归出栈是安全的：pump 不 await 自己
      pump();
    }
  }

  function enqueue(task, runner) {
    waiting.push({ task, runner });
    pump();
    return task;
  }

  // ---------------------------------------------------------------- 外部任务
  // Agent / CLI 自己跑 ComfyUI，但它会「播报」：开始、心跳、结束。
  // 这样网页在渲染的 30-40 秒里就能看到「生成中…」，而不是等出图落地才补一条。
  // 播报是尽力而为：服务器没开，CLI 照样出图，这条路径靠文件系统兜底。

  const HEARTBEAT_TIMEOUT = 30000;

  /** 开始：同一个 externalId 重复调用只认一条（CLI 可能重试） */
  function announce(meta = {}) {
    if (meta.externalId) {
      const exists = items.find((one) => one.externalId === meta.externalId);
      if (exists) {
        update(exists.id, { lastSeen: now() });
        return clone(exists);
      }
    }
    const task = add({
      kind: 'render',
      source: 'agent',
      status: 'running',
      startedAt: now(),
      lastSeen: now(),
      ...meta,
    });
    return clone(task);
  }

  /** 心跳：只更新 lastSeen，不刷别的（进度不展示，留着给排查） */
  function beat(id, patch = {}) {
    return update(id, { lastSeen: now(), ...patch });
  }

  function finish(id, patch = {}) {
    const task = items.find((one) => one.id === id);
    if (!task) return null;
    const startedAt = task.startedAt ? new Date(task.startedAt).getTime() : Date.now();
    return update(id, {
      status: 'done',
      finishedAt: now(),
      lastSeen: now(),
      ms: Date.now() - startedAt,
      progress: 100,
      ...patch,
    });
  }

  function fail(id, error) {
    return update(id, { status: 'error', finishedAt: now(), lastSeen: now(), error: String(error || '失败') });
  }

  /** 外部任务失去联系（CLI 崩了 / 网络断了）→ 别让浮窗永远停在「生成中…」 */
  function sweep() {
    const edge = Date.now() - HEARTBEAT_TIMEOUT;
    let touched = 0;
    for (const task of items) {
      if (task.source !== 'agent' || task.status !== 'running') continue;
      const seen = task.lastSeen || task.startedAt;
      if (!seen) continue;
      if (new Date(seen).getTime() > edge) continue;
      update(task.id, {
        status: 'error',
        finishedAt: now(),
        error: '外部任务失去联系（CLI 可能中断了）',
      });
      touched += 1;
    }
    return touched;
  }

  return {
    add,
    update,
    enqueue,
    announce,
    beat,
    finish,
    fail,
    sweep,
    /** 最近一次事件序号（快照里带给客户端） */
    lastSeq: () => eventSeq,
    position,
    /** 按外部自己生成的 id 找回任务 */
    byExternalId: (externalId) => {
      if (!externalId) return null;
      const task = items.find((one) => one.externalId === externalId);
      return task ? clone(task) : null;
    },
    get: (id) => {
      const task = items.find((one) => one.id === id);
      return task ? clone(task) : null;
    },
    /** 新 → 旧 */
    list: (max = 50) => items.slice(-max).reverse().map(clone),
    active: () => items.filter((t) => t.status === 'queued' || t.status === 'running').length,
    /** 这一页有没有在排队 / 在跑的 */
    activeFor: (project, page) =>
      items.some((t) => t.project === project && t.page === page && (t.status === 'queued' || t.status === 'running')),
    /** 这个版本是不是某条任务产出的（用来给外部改动去重） */
    byVersion: (versionId) => {
      if (!versionId) return null;
      const task = items.find((t) => t.versionId === versionId);
      return task ? clone(task) : null;
    },
    /** 这一页最近 15 秒有没有任务动过（外部归属去重用） */
    recentlyTouched: (project, page, withinMs = 15000) => {
      const edge = Date.now() - withinMs;
      return items.some((t) => {
        if (t.project !== project || t.page !== page) return false;
        const at = t.finishedAt || t.startedAt || t.at;
        return at ? new Date(at).getTime() > edge : false;
      });
    },
  };
}
