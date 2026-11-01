// 任务 store（全局单例）：一条 SSE 连到 /api/stream，全站共享。
//
// 为什么单独抽出来：生成状态以前塞在编辑器里（gen / busyGen / jobsRef），
// 换个页面就丢、也没法在别处显示。现在服务器是唯一真相，这里只做镜像：
//   - 打开页面先 GET /api/tasks 拿一次快照
//   - 之后靠 SSE 的 task 事件增量更新
//   - 断线重连成功后再拉一次，防止漏事件
//
// archive 事件（磁盘文件更动）不在这里处理，原样转发给订阅者：
// 「要不要刷新这一页」得看编辑器手上的 rev，不该由 store 猜。

import { api, useEffect, useState } from './lib.mjs';

const MAX_TASKS = 80;
const DOCK_KEY = 'moss.taskDock';

const state = {
  tasks: [],
  active: 0,
  open: false,
  collapsed: readCollapsed(),
  connected: false,
  hidden: new Set(),
};

const listeners = new Set();
const archiveListeners = new Set();

function readCollapsed() {
  try {
    return localStorage.getItem(DOCK_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(value) {
  try {
    localStorage.setItem(DOCK_KEY, value ? '1' : '0');
  } catch {
    /* 存不了就只在本次会话里生效 */
  }
}

function snapshot() {
  return {
    tasks: state.tasks.filter((task) => !state.hidden.has(task.id)),
    active: state.active,
    open: state.open,
    collapsed: state.collapsed,
    connected: state.connected,
  };
}

function publish() {
  const next = snapshot();
  for (const fn of listeners) fn(next);
}

function recount() {
  state.active = state.tasks.filter((t) => t.status === 'queued' || t.status === 'running').length;
}

function parse(event) {
  try {
    return JSON.parse(event.data);
  } catch {
    return null;
  }
}

/** 同 id 合并，新任务插到最前 */
function merge(task) {
  if (!task?.id) return;
  const index = state.tasks.findIndex((one) => one.id === task.id);
  if (index >= 0) state.tasks[index] = { ...state.tasks[index], ...task };
  else state.tasks.unshift(task);
  if (state.tasks.length > MAX_TASKS) state.tasks.length = MAX_TASKS;
  recount();
}

let source = null;
let started = false;

export async function refreshTasks() {
  const data = await api('/api/tasks?limit=80').catch(() => null);
  if (!data?.tasks) return;
  state.tasks = data.tasks;
  recount();
  publish();
}

/** 幂等：重复调用只连一条 */
export function connectTasks() {
  if (started) return;
  started = true;
  refreshTasks();
  openSource();
  // 心跳：SSE 断着的时候也不至于一直显示旧状态
  setInterval(() => {
    if (!state.connected) refreshTasks();
  }, 10000);
}

let reconnectTimer = null;

function openSource() {
  source = new EventSource('/api/stream');
  source.addEventListener('snapshot', (event) => {
    const data = parse(event);
    if (!data?.tasks) return;
    state.tasks = data.tasks;
    recount();
    publish();
  });
  source.addEventListener('task', (event) => {
    const task = parse(event);
    if (!task) return;
    merge(task);
    publish();
  });
  source.addEventListener('archive', (event) => {
    const change = parse(event);
    if (!change) return;
    for (const fn of archiveListeners) fn(change);
  });
  source.onopen = () => {
    const reconnected = !state.connected;
    state.connected = true;
    publish();
    // 连上（含重连）后补一次快照：断线期间完成的任务不至于漏掉
    if (reconnected) refreshTasks();
  };
  source.onerror = () => {
    if (state.connected) {
      state.connected = false;
      publish();
    }
    // 服务器重启后 EventSource 有时会停在 CLOSED，不会自己再连：重建一条
    if (source && source.readyState === EventSource.CLOSED) {
      if (reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        openSource();
      }, 2000);
    }
  };
}

/** 提交任务后不等 SSE，先本地插一条 */
export function trackTask(task) {
  if (!task?.id) return;
  merge(task);
  publish();
}

export function setDockOpen(open) {
  state.open = Boolean(open);
  if (state.open) state.collapsed = false;
  publish();
}

export function openDock() {
  state.open = true;
  state.collapsed = false;
  publish();
}

export function toggleDock() {
  state.open = !state.open;
  if (state.open) state.collapsed = false;
  publish();
}

export function setDockCollapsed(collapsed) {
  state.collapsed = Boolean(collapsed);
  state.open = !state.collapsed;
  writeCollapsed(state.collapsed);
  publish();
}

/** 清空已完成：只从界面上抹掉，不动存档 */
export function clearFinished() {
  for (const task of state.tasks) {
    if (task.status === 'done' || task.status === 'error') state.hidden.add(task.id);
  }
  publish();
}

/** 订阅磁盘变动（archive 事件），返回取消函数 */
export function onArchive(fn) {
  archiveListeners.add(fn);
  return () => archiveListeners.delete(fn);
}

export function useTasks() {
  const [snap, setSnap] = useState(snapshot);
  useEffect(() => {
    const fn = (next) => setSnap(next);
    listeners.add(fn);
    fn(snapshot());
    return () => listeners.delete(fn);
  }, []);
  return snap;
}

/** 这一页最新的任务：活动中的优先，否则最近一条 */
export function useTaskForPage(pageId) {
  const { tasks } = useTasks();
  if (!pageId) return null;
  const mine = tasks.filter((task) => task.page === pageId);
  return mine.find((t) => t.status === 'queued' || t.status === 'running') || mine[0] || null;
}

/** 排在这条任务前面的还有几个（在跑的算一个） */
export function queueAhead(tasks, task) {
  if (!task || task.status !== 'queued') return 0;
  const queued = tasks
    .filter((one) => one.status === 'queued')
    .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
  const at = queued.findIndex((one) => one.id === task.id);
  const running = tasks.some((one) => one.status === 'running') ? 1 : 0;
  return Math.max(0, at) + running;
}
