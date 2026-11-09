// 生成队列：桌面是顶栏「任务」按钮 + 右上角浮层；手机上进下格「更多」里的任务页签。
// 只负责展示，状态全在 web/tasks.mjs（服务器是唯一真相）。
//
// 刻意不显示百分比：那个数字本来就不可信，显示状态文字更实在。

import { html, api, cls, go } from '../lib.mjs';
import {
  clearFinished,
  queueAhead,
  setDockCollapsed,
  setDockOpen,
  useTasks,
} from '../tasks.mjs';

const KIND_LABEL = { render: '生成', edit: '修图' };

function pageLabel(task) {
  const index = task.index ? `第 ${task.index} 页` : task.page;
  return task.title ? `${index} · ${task.title}` : index;
}

function statusText(task, ahead) {
  if (task.status === 'queued') return ahead > 0 ? `排队中 · 前面还有 ${ahead} 个` : '排队中 · 下一个就是它';
  if (task.status === 'running') return task.kind === 'edit' ? '修图中…' : '生成中…';
  if (task.status === 'done') {
    const seconds = task.ms ? ` · ${(task.ms / 1000).toFixed(1)}s` : '';
    const version = task.versionId ? ` · ${task.versionId}` : '';
    return `完成${seconds}${version}`;
  }
  return task.error ? `失败：${task.error}` : '失败';
}

/** 点结果缩略图：先把这一版设为当前，再跳到那一页（顺序反了会看到旧图） */
async function openResult(task) {
  if (task.versionId) {
    await api(`/api/projects/${task.project}/versions/current`, {
      method: 'POST',
      body: { id: task.versionId, pageId: task.page },
    }).catch(() => {});
  }
  go(`/p/${task.project}/p/${task.page}`);
}

function row(task, tasks) {
  const ahead = queueAhead(tasks, task);
  const done = task.status === 'done';
  return html`<div class=${cls('task-row', task.status)} key=${task.id}>
    <div
      class="task-thumb"
      title=${done && task.image ? '点一下：跳到这一页并采用这个版本' : ''}
      onClick=${() => (done && task.image ? openResult(task) : go(`/p/${task.project}/p/${task.page}`))}
    >
      ${done && task.image
        ? html`<img src=${task.image} alt="" loading="lazy" />`
        : html`<span class="task-dot"></span>`}
    </div>
    <div class="task-main">
      <div class="task-line">
        <span class="task-title">${pageLabel(task)}</span>
        <span class=${cls('task-badge', task.source === 'agent' ? 'agent' : 'web')}>
          ${task.source === 'agent' ? '外部' : KIND_LABEL[task.kind] || '生成'}
        </span>
      </div>
      <div class=${cls('task-status', task.status)}>${statusText(task, ahead)}</div>
    </div>
  </div>`;
}

/** 队列本体：桌面浮层和手机下格共用这一份 */
export function TaskBody() {
  const { tasks, connected } = useTasks();
  return html`<div class="task-body">
    ${connected ? null : html`<div class="task-offline">连接中断，重连中…</div>`}
    <div class="task-list">
      ${tasks.length
        ? tasks.map((task) => row(task, tasks))
        : html`<div class="task-empty">还没有任务。点「生成」，或让 Agent 出一页试试。</div>`}
    </div>
  </div>`;
}

export default function TaskDock() {
  const { tasks, active, open, collapsed } = useTasks();

  if (collapsed) {
    return html`<button
      class="task-chip collapsed"
      title="展开任务队列"
      onClick=${() => setDockCollapsed(false)}
    >${active ? html`<span class="task-spin"></span>` : '⇱'}</button>`;
  }

  return html`<div class="task-dock">
    <button class=${cls('task-chip', active > 0 && 'busy')} onClick=${() => setDockOpen(!open)}>
      <span class="task-chip-label">任务</span>
      ${active > 0 ? html`<span class="task-count">${active}</span>` : null}
      <span class="task-caret">${open ? '▾' : '▸'}</span>
    </button>

    ${open
      ? html`<div class="task-panel">
          <div class="task-head">
            <span>生成队列</span>
            ${active ? html`<span class="task-count">${active} 个在跑</span>` : null}
            <div class="spacer"></div>
            <button class="task-link" onClick=${() => clearFinished()}>清空已完成</button>
            <button class="task-link" title="收起" onClick=${() => setDockCollapsed(true)}>✕</button>
          </div>
          <${TaskBody} />
        </div>`
      : null}
  </div>`;
}
