// 跟随磁盘的实时刷新：Agent / CLI 改完存档，页面自己跟上。
//
// 判定只看版本号，不看时间窗：
//   服务端把每条页面事件都带上 page.rev，客户端拿它和手上的比，比自己新才拉。
//   （旧写法用「服务器写盘后 1.2 秒内不发事件」来去重，结果是网页刚存完、Agent 紧接着改
//     的那次改动被永久丢掉——「明明改完了还是没更新」就是它。）
//
// 手上还有没保存的改动时不能直接覆盖，先记成待办，编辑器保存落盘后调 flushPending()。
// 另外每 5 秒对一次 /api/revision 指纹，万一 fs.watch 漏事件也能自己发现。

import { api, useEffect, useRef } from './lib.mjs';
import { onArchive } from './tasks.mjs';

const POLL_MS = 5000;

/**
 * @param {object} options
 * @param {string} options.projectId
 * @param {string} options.pageId
 * @param {{current: any}} options.pageRef      当前页面（含 rev）
 * @param {{current: number}} [options.mtimeRef] 当前页面文件的 mtime
 * @param {{current: boolean}} options.dirtyRef 有未保存改动
 * @param {{current: boolean}} options.savingRef 正在保存
 * @param {(id: string) => void} options.reloadPage
 * @param {(id: string) => void} options.reloadVersions
 * @param {() => void} [options.refreshProject]
 * @param {() => void} [options.refreshPages]
 * @returns {() => void} flushPending：保存完成后调用，把攒下的刷新补上
 */
export function useLivePage(options) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const pending = useRef({ page: false, versions: false, project: false });

  const flushPending = useRef(() => {
    const now = optionsRef.current;
    if (now.dirtyRef?.current || now.savingRef?.current) return;
    if (pending.current.page) {
      pending.current.page = false;
      now.reloadPage?.(now.pageId);
    }
    if (pending.current.versions) {
      pending.current.versions = false;
      now.reloadVersions?.(now.pageId);
    }
    if (pending.current.project) {
      pending.current.project = false;
      now.refreshProject?.();
    }
  }).current;

  useEffect(() => {
    const off = onArchive((change) => {
      const items = (change?.items || []).filter((item) => item.project === optionsRef.current.projectId);
      if (!items.length) return;

      const current = optionsRef.current.pageRef?.current;
      const pageHit = items.find((item) => item.kind === 'page' && item.page === current?.id);
      // 两条判据：rev（走 savePage 的写）和 mtime（直接改 JSON 的写，rev 不会变）。
      // 自己刚保存的那次，rev 和 mtime 都已经从响应里更新过，所以会被自动忽略。
      if (pageHit) {
        const newerRev = Number(pageHit.rev || 0) > Number(current?.rev || 0);
        const newerMtime = Number(pageHit.mtime || 0) > Number(optionsRef.current.mtimeRef?.current || 0);
        if (newerRev || newerMtime) pending.current.page = true;
      }
      if (items.some((item) => item.kind === 'versions' || item.kind === 'image')) pending.current.versions = true;
      if (items.some((item) => item.kind === 'project')) pending.current.project = true;

      // 左栏缩略图总是跟着刷
      optionsRef.current.refreshPages?.();
      flushPending();
    });
    return off;
  }, [flushPending]);

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
      // 指纹变了说明有人动过文件：当成本页和版本都可能变，交给 flushPending 决定什么时候拉
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

  return flushPending;
}
