// 刷新的唯一协调者：所有「该不该重新拉」的判断只在这里。
//
// 四个来源，一个 pending，一个 flush：
//   1. task 事件（权威）   —— 出图完成带 versionId，不依赖文件系统，最快也最可靠
//   2. archive 事件        —— Agent 直接改页面 JSON（rev/mtime 比较）
//   3. resync / 重连       —— 服务器文件监听器重建、SSE 断过，整体重拉
//   4. /api/revision 轮询  —— 兜底，防 fs.watch 漏事件
//
// 为什么之前会「有时候不刷新」：pending 一旦被 dirty/saving 挡住，只等下一次保存来冲；
// 用户不再编辑就永远挂着。现在除了保存后冲一次，还挂 1 秒的重试定时器。

import { api, useEffect, useRef } from './lib.mjs';
import { onArchive, onResync, onTask, useTasks } from './tasks.mjs';

const POLL_MS = 5000;
const RETRY_MS = 1000;
const RETRY_MAX = 30;
const DEBOUNCE_MS = 120;

/**
 * @param {object} options
 * @param {string} options.projectId
 * @param {string} options.pageId
 * @param {{current: any}} options.pageRef
 * @param {{current: boolean}} options.dirtyRef
 * @param {{current: boolean}} options.savingRef
 * @param {{current: number}} [options.mtimeRef]
 * @param {(id: string) => void} options.reloadPage
 * @param {(id: string) => void} options.reloadVersions
 * @param {() => void} [options.refreshProject]
 * @param {() => void} [options.refreshPages]
 * @returns {() => void} flushPending：保存完成后调用
 */
export function useLivePage(options) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const pending = useRef({ page: false, versions: false, project: false });
  const retry = useRef({ timer: null, left: 0 });
  const debounce = useRef(null);
  const { epoch } = useTasks();

  /** 真的去拉。返回是否拉成功（被 dirty/saving 挡住时返回 false） */
  const flushNow = useRef(() => {
    const now = optionsRef.current;
    if (!now.pageId) return true;
    if (now.dirtyRef?.current || now.savingRef?.current) return false;

    const todo = pending.current;
    pending.current = { page: false, versions: false, project: false };
    if (todo.page) now.reloadPage?.(now.pageId);
    if (todo.versions) now.reloadVersions?.(now.pageId);
    if (todo.project) now.refreshProject?.();
    return true;
  }).current;

  const hasPending = () => pending.current.page || pending.current.versions || pending.current.project;

  /** 排队一次刷新：被挡住就挂重试，不会永远卡住 */
  const flushPending = useRef(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      debounce.current = null;
      if (flushNow()) {
        retry.current.left = 0;
        if (retry.current.timer) {
          clearInterval(retry.current.timer);
          retry.current.timer = null;
        }
        return;
      }
      if (retry.current.timer) return;
      retry.current.timer = setInterval(() => {
        retry.current.left += 1;
        if (flushNow() || !hasPending() || retry.current.left >= RETRY_MAX) {
          clearInterval(retry.current.timer);
          retry.current.timer = null;
          retry.current.left = 0;
        }
      }, RETRY_MS);
    }, DEBOUNCE_MS);
  }).current;

  // ---- 1. 任务事件：出图完成 → 直接拉版本，不等文件系统
  useEffect(() => {
    return onTask((task) => {
      if (task.project !== optionsRef.current.projectId) return;
      if (task.status === 'done' || task.status === 'error') {
        if (task.page === optionsRef.current.pageId) pending.current.versions = true;
        optionsRef.current.refreshPages?.();
        flushPending();
      }
    });
  }, [flushPending]);

  // ---- 2. 磁盘事件
  useEffect(() => {
    return onArchive((change) => {
      const items = (change?.items || []).filter((item) => item.project === optionsRef.current.projectId);
      if (!items.length) return;

      const current = optionsRef.current.pageRef?.current;
      const pageHit = items.find((item) => item.kind === 'page' && item.page === current?.id);
      if (pageHit) {
        // rev 覆盖「走 savePage 的写」；mtime 覆盖「直接改 JSON」（rev 不变）
        const newerRev = Number(pageHit.rev || 0) > Number(current?.rev || 0);
        const newerMtime = Number(pageHit.mtime || 0) > Number(optionsRef.current.mtimeRef?.current || 0);
        if (newerRev || newerMtime) pending.current.page = true;
      }
      if (items.some((item) => item.kind === 'versions' || item.kind === 'image')) pending.current.versions = true;
      if (items.some((item) => item.kind === 'project')) pending.current.project = true;

      optionsRef.current.refreshPages?.();
      flushPending();
    });
  }, [flushPending]);

  // ---- 3. 服务器要求整体重拉
  useEffect(() => {
    return onResync(() => {
      pending.current = { page: true, versions: true, project: true };
      flushPending();
    });
  }, [flushPending]);

  // ---- SSE 重连（epoch 变）：断线期间可能什么都错过，整体重拉
  const seenEpoch = useRef(epoch);
  useEffect(() => {
    if (epoch === seenEpoch.current) return;
    seenEpoch.current = epoch;
    pending.current = { page: true, versions: true, project: true };
    optionsRef.current.refreshPages?.();
    flushPending();
  }, [epoch, flushPending]);

  // ---- 4. 指纹轮询兜底
  useEffect(() => {
    let last = '';
    const check = async () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const data = await api(`/api/revision?project=${encodeURIComponent(optionsRef.current.projectId)}`).catch(() => null);
      if (!data?.stamp) return;
      if (!last) {
        last = data.stamp;
        return;
      }
      if (data.stamp === last) return;
      last = data.stamp;
      pending.current.page = true;
      pending.current.versions = true;
      flushPending();
    };
    const timer = setInterval(check, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    check();
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [flushPending]);

  // 卸载时把定时器收干净
  useEffect(() => {
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
      if (retry.current.timer) clearInterval(retry.current.timer);
    };
  }, []);

  return flushPending;
}
