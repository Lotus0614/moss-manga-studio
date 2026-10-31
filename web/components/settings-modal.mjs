// 全局设置弹窗：ComfyUI + 工作流 + **由占位符生成**的参数表单。
// 代码不认识 steps/cfg/lora 这些名字——工作流里有什么占位符，就渲染什么输入框。

import { html, api, apiPut, useState, useEffect, toast } from '../lib.mjs';

/** 这几个永远由代码填，不进表单 */
const AUTO = ['prompt', 'width', 'height', 'seed', 'image'];

/** 修图工作流只认这三个占位符：参考图 + 指令 + 种子（种子写死会让连续修图发糊） */
const EDIT_NEEDS = ['prompt', 'image', 'seed'];

export default function SettingsModal({ open, config, onClose, onSaved }) {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState(null);
  const [workflows, setWorkflows] = useState([]);
  const [wf, setWf] = useState({ raw: '', params: [], ok: false, missing: [] });
  const [wfEdit, setWfEdit] = useState({ params: [], missing: [] });

  useEffect(() => {
    if (!open || !config) return;
    setForm(JSON.parse(JSON.stringify(config)));
    setStatus(null);
  }, [open, config]);

  useEffect(() => {
    if (!open) return;
    api('/api/workflows')
      .then((data) => setWorkflows(data.workflows || []))
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const name = form?.workflow?.name;
    if (!name) {
      setWf({ raw: '', params: [], ok: false, missing: [] });
      return;
    }
    api(`/api/workflows/${encodeURIComponent(name)}`)
      .then((data) => {
        const params = data.params || [];
        setWf({ raw: data.raw || '', params, ok: Boolean(data.ok), missing: data.missing || [] });
        setForm((prev) => {
          if (!prev) return prev;
          const next = { ...prev, params: { ...(prev.params || {}) } };
          for (const p of params) {
            if (p.hasDefault && next.params[p.name] === undefined) next.params[p.name] = p.defaultValue;
          }
          return next;
        });
      })
      .catch(() => setWf({ raw: '', params: [], ok: false, missing: [] }));
  }, [open, form?.workflow?.name]);

  // 修图工作流：只检查 {{prompt}} 和 {{image}}，参数表单不跟它走
  useEffect(() => {
    if (!open) return;
    const name = form?.edit?.name;
    if (!name) {
      setWfEdit({ params: [], missing: [] });
      return;
    }
    api(`/api/workflows/${encodeURIComponent(name)}`)
      .then((data) => {
        const names = new Set((data.params || []).map((p) => p.name));
        setWfEdit({ params: data.params || [], missing: EDIT_NEEDS.filter((key) => !names.has(key)) });
      })
      .catch(() => setWfEdit({ params: [], missing: EDIT_NEEDS, error: '读不到这个工作流' }));
  }, [open, form?.edit?.name]);

  if (!open || !form) return null;

  const patchComfy = (patch) => setForm({ ...form, comfy: { ...form.comfy, ...patch } });
  const setParam = (name, value) =>
    setForm((prev) => {
      const next = { ...prev, params: { ...prev.params } };
      if (value === undefined) delete next.params[name];
      else next.params[name] = value;
      return next;
    });

  const editable = (wf.params || []).filter((p) => !AUTO.includes(p.name));
  const autoParams = (wf.params || []).filter((p) => AUTO.includes(p.name));
  const valueOf = (p) => (form.params && form.params[p.name] !== undefined ? form.params[p.name] : '');

  async function testComfy() {
    setBusy('comfy');
    setStatus(null);
    try {
      const res = await api('/api/comfy/models');
      setStatus(res.ok ? { ok: true, message: '连接正常' } : { ok: false, message: res.message || '连不上' });
    } catch (err) {
      setStatus({ ok: false, message: err.message });
    } finally {
      setBusy('');
    }
  }

  async function save() {
    setBusy('save');
    try {
      const saved = await apiPut('/api/config', {
        comfy: form.comfy,
        workflow: form.workflow,
        edit: form.edit,
        params: form.params || {},
      });
      onSaved?.(saved);
      toast('已保存');
      onClose?.();
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy('');
    }
  }

  async function saveWorkflow() {
    setBusy('wf');
    try {
      const res = await apiPut(`/api/workflows/${encodeURIComponent(form.workflow.name || 'default.json')}`, { raw: wf.raw });
      setForm({ ...form, workflow: { ...form.workflow, name: res.name } });
      const savedCfg = await apiPut('/api/config', { workflow: { name: res.name } });
      onSaved?.(savedCfg);
      toast(`已保存 ${res.name}（${res.params?.length || 0} 个占位符）`);
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy('');
    }
  }

  return html`<div class="modal-mask" onClick=${(e) => e.target === e.currentTarget && onClose?.()}>
    <div class="modal wide">
      <header>
        设置
        <div class="spacer" style="flex:1"></div>
        <button class="btn sm ghost" onClick=${onClose}>关闭</button>
      </header>
      <div class="body">
        <section class="panel-box">
          <header>ComfyUI</header>
          <div class="body">
            <div class="row2">
              <div class="field">
                <label>服务地址</label>
                <input class="input" value=${form.comfy.url} placeholder="http://127.0.0.1:8188" onInput=${(e) => patchComfy({ url: e.currentTarget.value })} />
              </div>
              <div class="field">
                <label>单张超时（毫秒）</label>
                <input class="input" type="number" value=${form.comfy.timeoutMs} onInput=${(e) => patchComfy({ timeoutMs: Number(e.currentTarget.value) || 180000 })} />
              </div>
            </div>
            <div class="row">
              <button class="btn" disabled=${busy === 'comfy'} onClick=${testComfy}>${busy === 'comfy' ? '测试中…' : '测试连接'}</button>
              ${status ? html`<div class="status ${status.ok ? 'ok' : 'bad'}">${status.ok ? 'OK' : 'FAIL'} · ${status.message}</div>` : null}
            </div>
          </div>
        </section>

        <section class="panel-box">
          <header>
            生图工作流（MOSS）
            ${form.workflow.name ? html`<span class="tag">${form.workflow.name}</span>` : html`<span class="tag" style="background:var(--danger);color:#fff">未设置</span>`}
          </header>
          <div class="body">
            <div class="row">
              <select
                class="select grow"
                value=${form.workflow.name || ''}
                onChange=${(e) => setForm({ ...form, workflow: { ...form.workflow, name: e.currentTarget.value } })}
              >
                <option value="">（未选择）</option>
                ${workflows.map((w) => html`<option value=${w.name}>${w.name}${w.ok ? '' : '（缺占位符）'}</option>`)}
              </select>
            </div>
            ${wf.missing?.length ? html`<div class="status bad">缺占位符：${wf.missing.map((m) => `{{${m}}}`).join('、')}</div>` : null}
            <div class="row wrap">
              ${(wf.params || []).map((p) => html`<span class="chip ghost">{{${p.name}}}</span>`)}
              ${(wf.params || []).length ? null : html`<span class="hint">还没有占位符。</span>`}
            </div>
            <details>
              <summary class="hint" style="cursor:pointer">查看 / 替换工作流 JSON（一般由 Agent 改）</summary>
              <textarea
                class="textarea"
                style="min-height:140px;margin-top:8px;font-family:var(--mono);font-size:11px"
                value=${wf.raw}
                placeholder="粘贴 ComfyUI「导出 (API)」的 JSON；要暴露的参数写成 {{名字:默认值}}"
                onInput=${(e) => setWf({ ...wf, raw: e.currentTarget.value })}
              ></textarea>
              <div class="row">
                <div class="spacer"></div>
                <button class="btn" disabled=${busy === 'wf'} onClick=${saveWorkflow}>${busy === 'wf' ? '保存中…' : '保存工作流'}</button>
              </div>
            </details>
          </div>
        </section>

        <section class="panel-box">
          <header>
            修图工作流（图片编辑）
            ${form.edit?.name ? html`<span class="tag">${form.edit.name}</span>` : html`<span class="tag">不用修图</span>`}
          </header>
          <div class="body">
            <div class="row">
              <select
                class="select grow"
                value=${form.edit?.name || ''}
                onChange=${(e) => setForm({ ...form, edit: { ...(form.edit || {}), name: e.currentTarget.value } })}
              >
                <option value="">（不用修图）</option>
                ${workflows.map((w) => html`<option value=${w.name}>${w.name}</option>`)}
              </select>
            </div>
            ${wfEdit.missing?.length
              ? html`<div class="status bad">
                  缺占位符：${wfEdit.missing.map((m) => `{{${m}}}`).join('、')}。编辑工作流要替换三处：LoadImage 的 image 写成
                  {{image}}，提示词节点写成 {{prompt}}，KSampler 的 seed 写成 {{seed}}（种子写死会让连续修图发糊）。
                </div>`
              : null}
            <div class="row wrap">
              ${(wfEdit.params || []).map((p) => html`<span class="chip ghost">{{${p.name}}}</span>`)}
            </div>
            <div class="hint">修图拿这一页当前那一版当参考图，结果存成新版本；尺寸、步数、模型全部按工作流本身。</div>
          </div>
        </section>

        <section class="panel-box">
          <header>工作流参数</header>
          <div class="body">
            ${editable.length
              ? html`<div class="param-grid">
                  ${editable.map(
                    (p) => html`<div class="field" key=${p.name}>
                      <label>${p.name} <span class="mono">{{${p.name}}}</span></label>
                      <input
                        class="input"
                        type=${p.type === 'number' ? 'number' : 'text'}
                        value=${valueOf(p)}
                        placeholder=${p.hasDefault ? `默认：${p.defaultValue}` : '没有默认值，必填'}
                        onInput=${(e) => {
                          const raw = e.currentTarget.value;
                          if (raw === '') return setParam(p.name, undefined);
                          if (p.type === 'number') return setParam(p.name, Number(raw));
                          if (p.type === 'boolean') return setParam(p.name, raw === 'true');
                          return setParam(p.name, raw);
                        }}
                      />
                    </div>`
                  )}
                </div>`
              : html`<span class="hint">${form.workflow.name ? '这个工作流没有需要填的参数。' : '先选工作流。'}</span>`}
            ${autoParams.length
              ? html`<div class="row wrap">
                  <span class="hint">代码自动填：</span>
                  ${autoParams.map((p) => html`<span class="chip ghost">{{${p.name}}}</span>`)}
                </div>`
              : null}
          </div>
        </section>

        <div class="hint mono">存档：${config?.archive || ''}</div>
      </div>
      <footer>
        <button class="btn ghost" onClick=${onClose}>取消</button>
        <button class="btn inv" disabled=${busy === 'save'} onClick=${save}>${busy === 'save' ? '保存中…' : '保存'}</button>
      </footer>
    </div>
  </div>`;
}
