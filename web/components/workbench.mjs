// 左侧工作台：提示词 / 历史 / 变更 三个页签。只负责展示，数据由编辑器传入。
// 版面是一条竖长的侧栏，所以这里一律竖排堆叠，不做左右分栏。

import { html, cls, formatTime, toast } from '../lib.mjs';

export function PromptPanel({ compiled, warnings }) {
  return html`<div class="col" style="gap:14px">
    <div class="col" style="gap:6px;min-width:0">
      <div class="row">
        <span class="mono small muted">${compiled?.stats?.items || 0} 项 · ${compiled?.stats?.bytes || 0} 字节</span>
        <div class="spacer"></div>
        <button class="btn sm ghost" onClick=${() => {
          navigator.clipboard?.writeText(compiled?.json || '');
          toast('已复制');
        }}>复制 JSON</button>
      </div>
      <div class="prompt-box">${compiled?.json || '（编译失败）'}</div>
    </div>
    <div class="col" style="gap:6px;min-width:0">
      <span class="mono small muted">校验</span>
      ${warnings.length
        ? html`<ul class="warn-list">
            ${warnings.map(
              (w) => html`<li class=${w.level}>
                <span class="code">${w.code}</span>
                <span>${w.message}</span>
              </li>`
            )}
          </ul>`
        : html`<span class="hint">没有发现问题。</span>`}
    </div>
  </div>`;
}

export function HistoryPanel({ versions, current, onPick }) {
  const list = [...versions].reverse();
  const activeId = current || list[0]?.id;
  if (!list.length) return html`<div class="hint">这一页还没有生成过图片。点右上角「生成」。</div>`;
  return html`<div class="col" style="gap:10px">
    <div class="history-strip">
      ${list.map((v) => {
        const on = v.id === activeId;
        return html`<div class=${cls('version', on && 'on')} key=${v.id}>
          <img src=${v.image} alt="" loading="lazy" title=${v.kind === 'edit' ? `修图版：${v.editPrompt || ''}` : '渲染版'} onClick=${() => onPick(v.id)} />
          <div class="vmeta">
            ${v.kind === 'edit' ? html`<span title=${`基于 ${v.base || '?'}：${v.editPrompt || ''}`}>✎</span>` : null}
            <b>${v.seed ?? '—'}</b>${formatTime(v.at).slice(5)}
          </div>
          <button class="vbtn" disabled=${on} onClick=${() => onPick(v.id)}>${on ? '当前' : '用这版'}</button>
        </div>`;
      })}
    </div>
    <span class="hint">点「用这版」把它设为当前采用的图；历史只读，不会改布局。带 ✎ 的是修图版。</span>
  </div>`;
}

export function ChangesPanel({ changes, onReload, onAck }) {
  if (!changes) return html`<div class="hint">读取中… <button class="btn sm ghost" onClick=${onReload}>刷新</button></div>`;
  if (!changes.pages.length) {
    return html`<div class="row">
      <span class="hint">自 rev ${changes.since} 以来没有改动（当前 rev ${changes.to}）。</span>
      <div class="spacer"></div>
      <button class="btn sm ghost" onClick=${onReload}>刷新</button>
    </div>`;
  }
  return html`<div class="col" style="gap:8px">
    <div class="row">
      <span class="mono small muted">rev ${changes.since} → ${changes.to}</span>
      <div class="spacer"></div>
      <button class="btn sm ghost" onClick=${onReload}>刷新</button>
      <button class="btn sm" onClick=${onAck}>确认已查看</button>
    </div>
    ${changes.pages.map(
      (group) => html`<div class="col" style="gap:2px">
        <span class="mono small">第 ${group.index ?? '?'} 页 · ${group.title || group.page}</span>
        ${group.ops.map((op) => html`<div class="small" style="border-left:2px solid var(--line);padding-left:8px">${describe(op)}</div>`)}
      </div>`
    )}
  </div>`;
}

function describe(op) {
  if (op.op === 'create') return '新建页面';
  if (op.op === 'add') return `+ ${op.target} ${op.id} [${(op.bbox || []).join(',')}]${op.text ? `「${op.text}」` : ''}`;
  if (op.op === 'remove') return `- ${op.target} ${op.id}`;
  if (op.op === 'bbox') return `~ ${op.target} ${op.id} [${op.from.join(',')}] → [${op.to.join(',')}]`;
  if (op.op === 'text') return `~ 文字 ${op.id}「${op.from}」→「${op.to}」`;
  if (op.op === 'page') return `~ 页.${op.field}：${op.from ?? '（空）'} → ${op.to ?? '（空）'}`;
  return `~ ${op.target} ${op.id} ${op.field}`;
}
