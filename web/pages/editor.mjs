// 编辑页：页序 / 工作台 / 画布 / 属性。
//
// 桌面：四栏（页序 | 工作台 | 画布 | 属性）。
// 手机：上下两格（画布 | 下格），下格是「属性 / 提示词 / 历史 / 变更」四个 tab 加动作按钮，
//       可以整格收起；页序变成左上角按钮打开的抽屉。
// 两种形态是同一份 DOM：布局、抽屉、下格都由 CSS 断点控制（见 storyboard.css 末尾的移动段落），
// 这里只多两个状态（抽屉开关、下格开关），不写第二套界面。
//
// 页面是单层 items；快捷键 Delete 删除、Ctrl+C/V 复制粘贴、Ctrl+Z 撤销。

import {
  html,
  api,
  apiPost,
  apiPut,
  apiDelete,
  go,
  useState,
  useEffect,
  useRef,
  useMemo,
  toast,
  cls,
  setApp,
  useApp,
  useViewport,
  useTheme,
  toggleTheme,

} from '../lib.mjs';
import Canvas from '../components/canvas.mjs';
import PageRail from '../components/page-rail.mjs';
import PageActions from '../components/page-actions.mjs';
import CanvasTools from '../components/canvas-tools.mjs';
import ExportButton from '../components/export-button.mjs';
import AppMenu from '../components/app-menu.mjs';
import ItemForm from '../components/item-form.mjs';
import PagePanel from '../components/page-panel.mjs';
import { TYPES, itemType } from '../../config/manga.mjs';
import { PromptPanel, HistoryPanel, ChangesPanel } from '../components/workbench.mjs';
import EditModal from '../components/edit-modal.mjs';
import { exportLongImage, exportPdf, pagesInRange } from '../components/export.mjs';
import { compilePage } from '../../core/compile.mjs';
import { useLivePage } from '../realtime.mjs';
import { openDock, trackTask, useTaskForPage } from '../tasks.mjs';
import { createItem } from '../../core/manga-doc.mjs';

const STYLE_LABELS = [
  ['mono', '黑白网点'],
  ['color', '彩色'],
  ['sketch', '线稿'],
];

// 格子底色的不透明度：存在浏览器里，所有页面、下次打开都沿用
const FILL_ALPHA_KEY = 'moss.fillAlpha';
const DEFAULT_FILL_ALPHA = 0.5;
// 左侧工作台的收起状态也记在浏览器里
const WB_COLLAPSED_KEY = 'moss.wbCollapsed';
// 手机下格：开着还是收着 + 上次看的是哪个 tab
const PANEL_KEY = 'moss.panel';
const PANEL_TAB_KEY = 'moss.panelTab';

function readWbCollapsed() {
  try {
    return localStorage.getItem(WB_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function readPanelOpen() {
  try {
    return localStorage.getItem(PANEL_KEY) === '1';
  } catch {
    return false;
  }
}

function writePanelOpen(value) {
  try {
    localStorage.setItem(PANEL_KEY, value ? '1' : '0');
  } catch {
    /* 存不了就只在本次会话里生效 */
  }
}

function readPanelTab() {
  try {
    const saved = localStorage.getItem(PANEL_TAB_KEY);
    if (saved === 'props' || saved === 'prompt' || saved === 'history' || saved === 'changes') return saved;
  } catch {
    /* 同上 */
  }
  return 'props';
}

function readFillAlpha() {
  try {
    const raw = localStorage.getItem(FILL_ALPHA_KEY);
    const value = Number(raw);
    if (raw !== null && Number.isFinite(value) && value >= 0 && value <= 1) return value;
  } catch {
    /* 隐私模式读不了就用默认值 */
  }
  return DEFAULT_FILL_ALPHA;
}

export default function EditorPage({
  projectId,
  pageId,
  config,
  onOpenSettings,
  onOpenCharacters,
  onOpenProjectSettings,
}) {
  const [project, setProject] = useState(null);
  // 角色表由「角色表」弹窗维护，存完走 app.project；这里以最新的那份为准
  const liveProject = useApp().project;
  const currentProject = liveProject && liveProject.slug === projectId ? liveProject : project;
  const characters = currentProject?.characters || [];
  const [pages, setPages] = useState([]);
  const [pagesLoaded, setPagesLoaded] = useState(false);
  const [page, setPage] = useState(null);
  const [versions, setVersions] = useState([]);
  // 修图真正会拿来当参考的那一版（永远是渲染版，由服务端算好）
  const [editBase, setEditBase] = useState(null);
  // 推荐从哪一版改（渲染版），只是提示
  const [current, setCurrent] = useState('');
  const [selection, setSelection] = useState(null);
  // 桌面：工作台三个页签；手机：下格四个 tab（多一个「属性」）
  const [tab, setTabState] = useState(readPanelTab);
  const [fitScale, setFitScale] = useState(0.55);
  const [zoom, setZoom] = useState(1);
  const [showBoxes, setShowBoxes] = useState(true);
  const [dockCollapsed, setDockCollapsedState] = useState(readWbCollapsed);
  const [grid, setGrid] = useState(4);
  const [fillAlpha, setFillAlphaState] = useState(readFillAlpha);
  // 手机：下格展开 / 页面抽屉展开
  const [panelOpen, setPanelOpenState] = useState(readPanelOpen);
  const [railOpen, setRailOpen] = useState(false);
  const [changes, setChanges] = useState(null);
  const [showExport, setShowExport] = useState(false);
  // 导出范围：页码，两端都含
  const [exportRange, setExportRange] = useState({ from: 1, to: 1 });
  const [exporting, setExporting] = useState('');
  // 修图：点按钮开弹窗，弹窗里画框/涂鸦 + 写指令
  const [editOpen, setEditOpen] = useState(false);

  const viewport = useViewport();
  const theme = useTheme();
  const stageRef = useRef(null);
  const pageRef = useRef(null);
  const saveTimer = useRef(null);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  // 页面文件的 mtime：直接改 JSON 时 rev 不变，靠它判断「是不是新的」
  const pageMtimeRef = useRef(0);
  const createdFirst = useRef(false);
  const history = useRef([]);
  const clipboard = useRef(null);
  // 画布手势：按住的触点数 + 双指缩放基准
  const pointers = useRef(new Map());
  const pinch = useRef(null);
  const pinchGuard = useRef(false);

  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  // Agent / CLI 改完存档后自动跟上：先比 rev，本地有未保存改动就等保存完再拉
  const flushLive = useLivePage({
    projectId,
    pageId,
    pageRef,
    dirtyRef,
    savingRef,
    mtimeRef: pageMtimeRef,
    reloadPage: (id) => reloadPage(id),
    reloadVersions: (id) => reloadVersions(id),
    refreshProject: () => loadProject(),
    refreshPages: () => refreshPages(),
  });

  function setFillAlpha(value) {
    setFillAlphaState(value);
    try {
      localStorage.setItem(FILL_ALPHA_KEY, String(value));
    } catch {
      /* 存不了就只在本次会话里生效 */
    }
  }

  function setDockCollapsed(value) {
    setDockCollapsedState(value);
    try {
      localStorage.setItem(WB_COLLAPSED_KEY, value ? '1' : '0');
    } catch {
      /* 同上 */
    }
  }

  function setPanelOpen(value) {
    setPanelOpenState(value);
    writePanelOpen(value);
  }

  function setTab(next) {
    setTabState(next);
    try {
      localStorage.setItem(PANEL_TAB_KEY, next);
    } catch {
      /* 同上 */
    }
  }

  // 页面抽屉开着时按 Esc 关掉（别让弹窗那层收到）
  useEffect(() => {
    if (!railOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setRailOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [railOpen]);

  /** 项目变了（Agent 改角色表、项目设置）时也要跟上 */
  function loadProject() {
    return api(`/api/projects/${projectId}`)
      .then((proj) => {
        setProject(proj);
        setApp({ project: proj });
        return proj;
      })
      .catch(() => null);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const proj = await api(`/api/projects/${projectId}`);
        if (!alive) return;
        setProject(proj);
        setApp({ project: proj });
        const data = await api(`/api/projects/${projectId}/pages`);
        if (!alive) return;
        setPages(data.pages || []);
        setPagesLoaded(true);
      } catch (err) {
        toast(err.message, 'bad');
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (!pageId) return;
    let alive = true;
    api(`/api/projects/${projectId}/pages/${pageId}`)
      .then((data) => {
        if (!alive) return;
        setPage(data.page);
        pageRef.current = data.page;
        setVersions(data.versions || []);
        setCurrent(data.current || '');
        setEditBase(data.editBase || null);
        pageMtimeRef.current = Number(data.mtime || 0);
        setApp({ page: data.page });
        setSelection(null);
        history.current = [];
        dirtyRef.current = false;
        savingRef.current = false;
      })
      .catch((err) => toast(err.message, 'bad'));
    return () => {
      alive = false;
    };
  }, [projectId, pageId]);

  useEffect(() => {
    if (!pagesLoaded || pageId || !project || createdFirst.current) return;
    if (!pages.length) {
      createdFirst.current = true;
      apiPost(`/api/projects/${projectId}/pages`, {})
        .then((doc) => go(`/p/${projectId}/p/${doc.id}`))
        .catch((err) => toast(err.message, 'bad'));
    } else {
      go(`/p/${projectId}/p/${pages[0].id}`);
    }
  }, [project, pages, pagesLoaded, pageId, projectId]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el || !page) return;
    // 手机上画布留白小一些，多留点地方给纸面
    const pad = viewport.phone ? 24 : 48;
    const fit = () => {
      const w = el.clientWidth - pad;
      const h = el.clientHeight - pad;
      setFitScale(Math.max(0.16, Math.min(w / page.size[0], h / page.size[1])));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [page?.size?.[0], page?.size?.[1], page, viewport.phone]);

  // ---- 快捷键
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || e.target?.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
        return;
      }
      if (typing) return;
      if (mod && e.key.toLowerCase() === 'c') {
        copySelected();
        return;
      }
      if (mod && e.key.toLowerCase() === 'v') {
        paste();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const ids = idsOfSelection();
        if (ids.length) {
          e.preventDefault();
          removeItems(ids);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection]);

  function refreshPages() {
    api(`/api/projects/${projectId}/pages`)
      .then((data) => {
        setPages(data.pages || []);
        setPagesLoaded(true);
      })
      .catch(() => {});
  }

  /** 只刷新版本相关状态（不动页面内容，免得冲掉没保存的编辑） */
  function reloadVersions(id) {
    return api(`/api/projects/${projectId}/pages/${id}`)
      .then((data) => {
        setVersions(data.versions || []);
        setCurrent(data.current || '');
        setEditBase(data.editBase || null);
      })
      .catch(() => {});
  }

  /** 打开修图弹窗前先确认基准版本：换过历史版本时，弹窗里的图必须跟着换 */
  async function openEdit() {
    if (!page || generating) return;
    await reloadVersions(page.id);
    setEditOpen(true);
  }

  function reloadPage(id) {
    api(`/api/projects/${projectId}/pages/${id}`)
      .then((data) => {
        setPage(data.page);
        pageRef.current = data.page;
        setVersions(data.versions || []);
        setCurrent(data.current || '');
        setEditBase(data.editBase || null);
        pageMtimeRef.current = Number(data.mtime || 0);
      })
      .catch(() => {});
  }

  /** selection 统一形状：{ kind, id, ids }，id 是主选中项，ids 是全部选中 */
  function select(next) {
    if (!next) return setSelection(null);
    const ids = Array.isArray(next.ids) && next.ids.length ? next.ids : [next.id];
    setSelection({ kind: next.kind, id: next.id || ids[ids.length - 1], ids });
  }

  // ---- 修改与历史
  // 注意：入历史栈 ≠ 有未保存的改动。只是点一下框（没拖动）也会走 onBegin，
  // 这里要是把 dirty 置上，外部改动就会被「等保存」挡住，直到超时都刷不出来。
  function snapshot() {
    const cur = pageRef.current;
    if (!cur) return;
    const json = JSON.stringify(cur);
    if (history.current[history.current.length - 1] === json) return;
    history.current.push(json);
    if (history.current.length > 80) history.current.shift();
  }

  function mutate(updater) {
    const cur = pageRef.current;
    if (!cur) return;
    snapshot();
    const next = typeof updater === 'function' ? updater(cur) : { ...cur, ...updater };
    pageRef.current = next;
    setPage(next);
    scheduleSave();
  }

  /** 拖拽过程中只更新视图，不进历史；list 是 [{ id, bbox }] */
  function updateBbox(list) {
    // 双指缩放期间手也在画布上：别把缩放的位移当成拖动
    if (pinchGuard.current) return;
    const cur = pageRef.current;
    if (!cur || !list?.length) return;
    // 真的动了才算有未保存的改动（拖动结束会立刻保存）
    dirtyRef.current = true;
    const map = new Map(list.map((one) => [one.id, one.bbox]));
    const next = { ...cur, items: cur.items.map((it) => (map.has(it.id) ? { ...it, bbox: map.get(it.id) } : it)) };
    pageRef.current = next;
    setPage(next);
  }

  function undo() {
    const snap = history.current.pop();
    if (!snap) {
      toast('没有可撤销的操作');
      return;
    }
    const prev = JSON.parse(snap);
    pageRef.current = prev;
    setPage(prev);
    setSelection(null);
    saveNow();
  }

  function copySelected() {
    const cur = pageRef.current;
    const items = idsOfSelection()
      .map((id) => cur?.items.find((it) => it.id === id))
      .filter(Boolean)
      .map((it) => JSON.parse(JSON.stringify(it)));
    if (!items.length) return;
    clipboard.current = items;
    toast(items.length > 1 ? `已复制 ${items.length} 项` : `已复制${itemType(items[0].type)?.label || '项'}`);
  }

  function paste() {
    const src = clipboard.current;
    if (!src?.length) return;
    const created = src.map((one) => {
      const { id, ...rest } = one;
      return createItem(one.type, {
        ...rest,
        bbox: [one.bbox[0] + 24, one.bbox[1] + 24, one.bbox[2] + 24, one.bbox[3] + 24],
      });
    });
    mutate((cur) => ({ ...cur, items: [...cur.items, ...created] }));
    select({ kind: created[0].type, id: created[created.length - 1].id, ids: created.map((it) => it.id) });
    setTimeout(saveNow, 60);
  }

  /** 当前选中的 id 列表（单选也返回单元素数组） */
  function idsOfSelection() {
    if (!selection) return [];
    if (Array.isArray(selection.ids) && selection.ids.length) return selection.ids;
    return selection.id ? [selection.id] : [];
  }

  function scheduleSave() {
    dirtyRef.current = true;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(saveNow, 600);
  }

  async function saveNow() {
    const cur = pageRef.current;
    if (!cur) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    savingRef.current = true;
    try {
      const saved = await apiPut(`/api/projects/${projectId}/pages/${cur.id}`, { ...cur, replaceItems: true });
      pageRef.current = saved;
      pageMtimeRef.current = Number(saved.mtime || pageMtimeRef.current || 0);
      dirtyRef.current = false;
      setPage((prev) => (prev && prev.id === saved.id ? { ...prev, rev: saved.rev } : prev));
      refreshPages();
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      savingRef.current = false;
      // 保存期间攒下的外部更新，现在可以取了
      flushLive();
    }
  }

  const compiled = useMemo(() => {
    if (!page) return null;
    try {
      return compilePage(page, currentProject);
    } catch (err) {
      return { json: '', warnings: [{ level: 'error', code: 'compile', message: err.message }], stats: {} };
    }
  }, [page, currentProject]);

  async function generate() {
    if (!page || generating) return;
    if (!config?.workflow?.name) {
      toast('还没有工作流：在设置里粘贴 ComfyUI「导出 (API)」的 JSON，或让 Agent 用 workflow save 导入', 'bad');
      onOpenSettings?.();
      return;
    }
    try {
      const res = await apiPost(`/api/projects/${projectId}/pages/${page.id}/render`, {});
      trackTask(res.task);
      openDock();
      toast(`已提交生成任务 · 第 ${page.index} 页`);
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  /** 修图：弹窗里框好区域、写好指令，交给编辑模型，改完存新版本 */
  async function startEdit({ prompt: request, overlay, marks }) {
    if (!page || !request || generating) return;
    try {
      const res = await apiPost(`/api/projects/${projectId}/pages/${page.id}/edit`, {
        prompt: request,
        ...(overlay ? { overlay, marks } : {}),
      });
      trackTask(res.task);
      openDock();
      setEditOpen(false);
      toast(`已提交修图任务 · 第 ${page.index} 页`);
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  async function addPage() {
    try {
      const doc = await apiPost(`/api/projects/${projectId}/pages`, {});
      refreshPages();
      go(`/p/${projectId}/p/${doc.id}`);
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  async function removePage() {
    if (!page) return;
    if (!confirm(`删除第 ${page.index} 页？这一页的历史图会一起删掉。`)) return;
    try {
      await apiDelete(`/api/projects/${projectId}/pages/${page.id}`);
      const rest = pages.filter((p) => p.id !== page.id);
      setPages(rest);
      go(rest.length ? `/p/${projectId}/p/${rest[0].id}` : `/p/${projectId}`);
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  async function loadChanges() {
    try {
      setChanges(await api('/api/changes'));
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  async function confirmChanges() {
    try {
      await apiPost('/api/ack', {});
      toast('已确认');
      loadChanges();
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  async function pickVersion(id) {
    setCurrent(id);
    try {
      await apiPost(`/api/projects/${projectId}/versions/current`, { id, pageId: page.id });
      // 换版本要顺带刷新 editBase，否则打开修图弹窗还是拿旧的那张图
      await reloadVersions(page.id);
      refreshPages();
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  async function collectExportItems(from, to) {
    const items = [];
    for (const p of pagesInRange(pages, from, to)) {
      const data = await api(`/api/projects/${projectId}/pages/${p.id}`);
      const list = (data.versions || []).filter((v) => v.page === p.id);
      const picked = list.find((v) => v.id === data.current) || list.slice(-1)[0];
      if (picked) items.push({ image: picked.image, index: p.index, title: p.title });
    }
    return items;
  }

  /** 打开导出弹窗：范围默认整本 */
  function openExport() {
    const indexes = pages.map((p) => Number(p.index)).filter(Number.isFinite);
    setExportRange({
      from: indexes.length ? Math.min(...indexes) : 1,
      to: indexes.length ? Math.max(...indexes) : 1,
    });
    setRailOpen(false);
    setShowExport(true);
  }

  /** 导出文件名：项目名 + 页码范围，避免不同区间导出互相覆盖 */
  function exportName(from, to) {
    const base = project?.name || 'chapter';
    if (from === to) return `${base} p${String(from).padStart(2, '0')}`;
    return `${base} p${String(from).padStart(2, '0')}-p${String(to).padStart(2, '0')}`;
  }

  async function doExport(kind) {
    const from = Math.min(exportRange.from, exportRange.to);
    const to = Math.max(exportRange.from, exportRange.to);
    setExporting(kind);
    try {
      const items = await collectExportItems(from, to);
      if (kind === 'long') await exportLongImage(items, exportName(from, to));
      else await exportPdf(items, exportName(from, to));
      setShowExport(false);
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setExporting('');
    }
  }

  // ---- 画布手势：双指张合缩放；单指在空白处拖动画面
  function pointerDistance() {
    const points = [...pointers.current.values()];
    if (points.length < 2) return 0;
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  }

  function onStagePointerDown(e) {
    if (e.pointerType === 'touch') {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size >= 2 && !pinch.current) {
        pinchGuard.current = true;
        pinch.current = { distance: Math.max(1, pointerDistance()), zoom };
        return;
      }
    }
    if (pointers.current.size > 1) return;
    if (e.target !== e.currentTarget) return;
    const el = e.currentTarget;
    const start = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    const move = (ev) => {
      el.scrollLeft = start.left - (ev.clientX - start.x);
      el.scrollTop = start.top - (ev.clientY - start.y);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function onStagePointerMove(e) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const base = pinch.current;
    if (!base) return;
    const distance = pointerDistance();
    if (!distance) return;
    const next = base.zoom * (distance / base.distance);
    setZoom(Math.min(3, Math.max(0.5, Number(next.toFixed(3)))));
  }

  function onStagePointerUp(e) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    // 等所有手指都离开再解除保护，否则剩下的那根手指会按旧基准继续拖
    if (!pointers.current.size) pinchGuard.current = false;
  }

  useEffect(
    () => () => {
      pointers.current.clear();
      pinch.current = null;
      pinchGuard.current = false;
    },
    []
  );

  if (!page) return html`<div class="page-scroll"><div class="container">载入中…</div></div>`;

  const warnings = compiled?.warnings || [];
  const errors = warnings.filter((w) => w.level === 'error');
  const warns = warnings.filter((w) => w.level === 'warn');
  const selectedIds = idsOfSelection();
  const multi = selectedIds.length > 1;
  const selected = selection ? page.items.find((it) => it.id === selection.id) : null;
  const version = versions.find((v) => v.id === current) || versions.slice(-1)[0];
  const image = version?.image || '';
  // 本页的生成状态由任务队列决定（store 里是服务器镜像）
  const pageTask = useTaskForPage(page?.id);
  const generating = Boolean(pageTask && (pageTask.status === 'queued' || pageTask.status === 'running'));
  const editing = Boolean(generating && pageTask.kind === 'edit');
  const queuedHere = Boolean(generating && pageTask.status === 'queued');
  const canEdit = Boolean(config?.edit?.name);
  const scale = fitScale * zoom;
  // 手机上的手柄要按屏幕像素补偿，不然缩到 0.47 倍时只剩 5px，手指按不住
  const handleSize = viewport.coarse ? Math.min(44, Math.max(12, Math.round(24 / Math.max(scale, 0.2)))) : 12;

  function addItem(type) {
    if (type === 'character' && !characters.length) {
      toast('项目还没有角色：点顶栏「角色表」先添加', 'bad');
      return;
    }
    const def = itemType(type);
    const patch = {};
    for (const f of def?.fields || []) {
      if (f.default !== undefined) patch[f.key] = f.default;
      else if (f.type === 'tags' || f.type === 'palette') patch[f.key] = [];
    }
    const bbox = type === 'bubble' ? [400, 140, 680, 320] : type === 'native' ? [40, 40, 400, 160] : type === 'character' ? [40, 900, 300, 1240] : [40, 420, 728, 780];
    const item = createItem(type, { bbox, ...(type === 'bubble' ? { text: '新台词' } : {}), ...patch });
    mutate((cur) => ({ ...cur, items: [...cur.items, item] }));
    select({ kind: item.type, id: item.id });
    if (type === 'character') toast('在右栏选一下这是谁');
    setTimeout(saveNow, 60);
  }

  function removeItems(ids) {
    const drop = new Set(ids);
    if (!drop.size) return;
    mutate((cur) => ({ ...cur, items: cur.items.filter((it) => !drop.has(it.id)) }));
    setSelection(null);
    setTimeout(saveNow, 60);
  }

  function removeItem(id) {
    removeItems([id]);
  }

  function patchItem(id, patch) {
    mutate((cur) => ({ ...cur, items: cur.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) }));
  }

  /**
   * 往下穿一层：Alt + 点击 的替代（触屏按不出 Alt）。
   * 以选中项中心为准，按绘制顺序（越靠后越在上）找压在下面的那个。
   */
  function cycleSelection() {
    if (!selected) return;
    const cx = (selected.bbox[0] + selected.bbox[2]) / 2;
    const cy = (selected.bbox[1] + selected.bbox[3]) / 2;
    const hits = page.items.filter((it) => cx >= it.bbox[0] && cx <= it.bbox[2] && cy >= it.bbox[1] && cy <= it.bbox[3]);
    if (hits.length < 2) return;
    const at = hits.findIndex((it) => it.id === selected.id);
    const next = hits[(at + 1) % hits.length];
    select({ kind: next.type, id: next.id, ids: [next.id] });
  }

  const canCycle = (() => {
    if (!selected) return false;
    const cx = (selected.bbox[0] + selected.bbox[2]) / 2;
    const cy = (selected.bbox[1] + selected.bbox[3]) / 2;
    return page.items.filter((it) => cx >= it.bbox[0] && cx <= it.bbox[2] && cy >= it.bbox[1] && cy <= it.bbox[3]).length > 1;
  })();

  // ------------------------------------------------ 工作台（提示词 / 历史 / 变更）
  // 桌面上是左侧一栏，手机上变成下格的 tab；「属性」只有手机下格有。
  const TABS = [
    ['prompt', '提示词'],
    ['history', '历史'],
    ['changes', '变更'],
  ];
  const PANEL_TABS = [['props', '属性'], ...TABS];
  // 桌面工作台不认「属性」：万一从手机切过来停在 props，就退回提示词
  const wbTab = tab === 'props' ? 'prompt' : tab;

  function tabBadge(key) {
    if (key === 'prompt') {
      if (errors.length) return html`<span class="badge">${errors.length}</span>`;
      if (warns.length) return html`<span class="badge warn">${warns.length}</span>`;
      return null;
    }
    if (key === 'history') return html`<span class="badge warn">${versions.length}</span>`;
    return null;
  }

  function openTab(key) {
    setTab(key);
    if (key === 'changes') loadChanges();
    setDockCollapsed(false);
  }

  /** 手机下格：点哪个 tab 就展开并切过去 */
  function openPanelTab(key) {
    setTab(key);
    setPanelOpen(true);
    if (key === 'changes') loadChanges();
  }

  const workbenchBody =
    wbTab === 'prompt'
      ? html`<${PromptPanel} compiled=${compiled} warnings=${warnings} />`
      : wbTab === 'history'
        ? html`<${HistoryPanel} versions=${versions} current=${current} onPick=${pickVersion} />`
        : html`<${ChangesPanel} changes=${changes} onReload=${loadChanges} onAck=${confirmChanges} />`;

  // 手机右上角「⋯」里的项目级动作（桌面顶栏有同样的按钮，不显示这一组）
  const menuItems = [
    { label: '角色表', onClick: () => onOpenCharacters?.() },
    { label: '项目设置', onClick: () => onOpenProjectSettings?.() },
    { label: '项目列表', onClick: () => go('/projects') },
    { sep: true },
    { label: theme === 'dark' ? '切到浅色' : '切到夜间模式', onClick: () => toggleTheme() },
    { label: '设置', onClick: () => onOpenSettings?.() },
  ];

  // 同一个动作条要挂两处（画布头 / 下格头），所以用函数生成，别复用同一个 vnode 实例
  const actions = () =>
    html`<${PageActions}
      canEdit=${canEdit}
      editing=${editing}
      generating=${generating}
      queuedHere=${queuedHere}
      disabledEdit=${generating || !editBase}
      disabledGenerate=${errors.length > 0 || generating}
      editTitle=${editBase ? `修 v${String(editBase.id).replace(/^v/, '')} 这一版（弹出涂鸦框选）` : '这一页还没有渲染图'}
      onEdit=${openEdit}
      onGenerate=${generate}
    />`;

  return html`<div class="editor" data-panel=${panelOpen ? tab : 'closed'}>
    <${PageRail}
      pages=${pages}
      pageId=${page.id}
      open=${railOpen}
      onPick=${(id) => {
        setRailOpen(false);
        go(`/p/${projectId}/p/${id}`);
      }}
      onAdd=${addPage}
      onRemove=${removePage}
      onOpenExport=${openExport}
      onClose=${() => setRailOpen(false)}
    />

    ${railOpen ? html`<div class="rail-mask" onClick=${() => setRailOpen(false)}></div>` : null}

    ${dockCollapsed && !viewport.phone
      ? html`<aside class="wb collapsed">
          <button class="wb-expand" title="展开工作台" onClick=${() => setDockCollapsed(false)}>›</button>
          ${TABS.map(
            ([key, label]) => html`<div
              class=${cls('wb-vtab', tab === key && 'on')}
              key=${key}
              title=${`展开并切到${label}`}
              onClick=${() => openTab(key)}
            >
              <span class="vt">${label}</span>
              ${tabBadge(key)}
            </div>`
          )}
        </aside>`
      : html`<aside class="wb">
          <div class="wb-head">
            ${TABS.map(
              ([key, label]) => html`<div class=${cls('tab', wbTab === key && 'on')} key=${key} onClick=${() => openTab(key)}>
                ${label}${tabBadge(key)}
              </div>`
            )}
            <div class="spacer"></div>
            <button class="wb-fold" title="收起工作台" onClick=${() => setDockCollapsed(true)}>‹</button>
          </div>
          <div class="wb-body">${workbenchBody}</div>
          <div class="wb-foot" title=${version ? `${version.id} · seed ${version.seed}` : '还没有生成过'}>
            ${version ? `${version.id} · seed ${version.seed}` : '还没有生成过'}
          </div>
        </aside>`}

    <section class="work">
      <div class="work-head">
        <button class="pg-entry" title="页面列表" onClick=${() => setRailOpen(true)}>
          <span class="pg-entry-n">第 ${page.index} 页</span>
          <span class="caret">▾</span>
        </button>
        <input
          class="input page-title"
          value=${page.title || ''}
          placeholder=${`第 ${page.index} 页`}
          onInput=${(e) => mutate({ title: e.currentTarget.value })}
        />
        <${AppMenu} items=${menuItems} />
        <span class="meta">${page.size[0]}×${page.size[1]} · ${page.items.length} 项 · rev ${page.rev}</span>
        ${errors.length
          ? html`<span class="tag" style="background:var(--danger);color:#fff">${errors.length} 个错误</span>`
          : warns.length
            ? html`<span class="tag">${warns.length} 个提醒</span>`
            : null}
        <div class="spacer"></div>
        <div class="head-group actions">
          <${ExportButton} onOpen=${openExport} className="head-export" />
          ${actions()}
        </div>
      </div>

      <div class="stage-wrap">
        <div
          class="stage"
          ref=${stageRef}
          onWheel=${(e) => {
            if (!e.ctrlKey && !e.metaKey) return;
            e.preventDefault();
            setZoom((z) => Math.min(3, Math.max(0.5, Number((z - Math.sign(e.deltaY) * 0.1).toFixed(2)))));
          }}
          onPointerDown=${onStagePointerDown}
          onPointerMove=${onStagePointerMove}
          onPointerUp=${onStagePointerUp}
          onPointerCancel=${onStagePointerUp}
        >
          <${Canvas}
            page=${page}
            image=${image}
            fillAlpha=${fillAlpha}
            showBoxes=${showBoxes}
            grid=${grid}
            scale=${scale}
            handleSize=${handleSize}
            selection=${selection}
            characters=${characters}
            onSelect=${select}
            onBegin=${snapshot}
            onChange=${updateBbox}
            onCommit=${saveNow}
          />
        </div>

        <${CanvasTools}
          canUndo=${history.current.length > 0}
          onUndo=${undo}
          showBoxes=${showBoxes}
          onToggleBoxes=${() => setShowBoxes((v) => !v)}
          zoom=${zoom}
          onZoom=${setZoom}
          fillAlpha=${fillAlpha}
          onFillAlpha=${setFillAlpha}
          grid=${grid}
          onGrid=${setGrid}
        />

        <div class="canvas-ctrl bottom">
          ${TYPES.map(
            (t) => html`<button class="btn" onClick=${() => addItem(t.key)}>
              <svg class="plus" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" aria-hidden="true"><path d="M5 1v8M1 5h8" /></svg>
              ${t.label}
            </button>`
          )}
        </div>

        <div class="canvas-hint">
          <span><span class="k">Ctrl</span>滚轮 缩放</span>
          <span><span class="k">Shift</span>点击 多选</span>
          <span><span class="k">Alt</span>点击 穿透</span>
          <span><span class="k">Ctrl</span><span class="k">Z</span>撤销</span>
          <span><span class="k">Del</span>删除</span>
        </div>
      </div>
    </section>

    <aside class="inspect">
      <div class="inspect-head">${multi ? `已选 ${selectedIds.length} 项` : selected ? `${itemType(selected.type)?.label || selected.type}属性` : '页面属性'}</div>
      <div class="inspect-body">${multi
        ? html`<div class="col">
            <div class="hint">多选：可以直接在画布上整体拖动，右侧不提供逐项编辑。Shift + 点击可加减选。</div>
            <div class="col" style="gap:3px">
              ${selectedIds.map((id) => {
                const it = page.items.find((one) => one.id === id);
                if (!it) return null;
                return html`<div class="rowitem" onClick=${() => select({ kind: it.type, id })}>
                  <span class="mono small">${itemType(it.type)?.label || it.type}</span>
                  <span class="grow ellipsis">${(it.note || it.text || it.desc || it.caption || '（空）').slice(0, 40)}</span>
                </div>`;
              })}
            </div>
            <div class="row">
              <button class="btn sm ghost grow" onClick=${() => setSelection(null)}>取消选择</button>
              <button class="btn sm ghost" onClick=${() => removeItems(selectedIds)}>删除</button>
            </div>
          </div>`
        : selected
          ? html`<${ItemForm}
              item=${selected}
              characters=${characters}
              patchItem=${patchItem}
              removeItem=${removeItem}
              onBack=${() => setSelection(null)}
              onCopy=${copySelected}
              canCycle=${canCycle}
              onCycle=${cycleSelection}
            />`
          : html`<${PagePanel} page=${page} mutate=${mutate} setSelection=${select} characters=${characters} />`}</div>
    </aside>

    <div class="panel-head">
      <div class="panel-tabs">
        ${PANEL_TABS.map(
          ([key, label]) => html`<button class=${cls('panel-tab', tab === key && 'on')} key=${key} onClick=${() => openPanelTab(key)}>
            ${key === 'props' && selected ? itemType(selected.type)?.label || label : label}${tabBadge(key)}
          </button>`
        )}
      </div>
      <div class="panel-actions">
        ${actions()}
        <button
          class="panel-fold"
          title=${panelOpen ? '收起下格' : '展开下格'}
          onClick=${() => setPanelOpen(!panelOpen)}
        >${panelOpen ? '▾' : '▴'}</button>
      </div>
    </div>

    ${showExport
      ? html`<div class="modal-mask" onClick=${(e) => e.target === e.currentTarget && setShowExport(false)}>
          <div class="modal">
            <header>导出</header>
            <div class="body">
              ${(() => {
                const sorted = [...pages].sort((a, b) => a.index - b.index);
                const picked = pagesInRange(sorted, exportRange.from, exportRange.to);
                const withImage = picked.filter((p) => p.cover).length;
                const missing = picked.length - withImage;
                const optionOf = (p) => `第 ${p.index} 页${p.title ? ` · ${p.title}` : ''}`;
                const sentence = withImage
                  ? `将导出 ${withImage} 页${missing ? `（另外 ${missing} 页还没有图，会跳过）` : ''} · 每页取当前采用的版本`
                  : picked.length
                    ? '这段页码里的页面还没有图，先生成再导出'
                    : '这个范围里没有页面';
                return html`<div class="export-range">
                  <div class="field">
                    <label>起始页</label>
                    <select
                      class="select"
                      value=${exportRange.from}
                      onChange=${(e) => {
                        const from = Number(e.currentTarget.value);
                        setExportRange({ from, to: Math.max(from, exportRange.to) });
                      }}
                    >
                      ${sorted.map((p) => html`<option value=${p.index}>${optionOf(p)}</option>`)}
                    </select>
                  </div>
                  <div class="field">
                    <label>结束页</label>
                    <select
                      class="select"
                      value=${exportRange.to}
                      onChange=${(e) => {
                        const to = Number(e.currentTarget.value);
                        setExportRange({ from: Math.min(exportRange.from, to), to });
                      }}
                    >
                      ${sorted.map((p) => html`<option value=${p.index}>${optionOf(p)}</option>`)}
                    </select>
                  </div>
                </div>
                <div class="hint">${sentence}</div>`;
              })()}
              <button class="btn wide" disabled=${exporting === 'long'} onClick=${() => doExport('long')}>
                ${exporting === 'long' ? '拼接中…' : '单张长图（PNG）'}
              </button>
              <button class="btn wide" disabled=${exporting === 'pdf'} onClick=${() => doExport('pdf')}>
                ${exporting === 'pdf' ? '生成中…' : 'PDF（每页一张）'}
              </button>
            </div>
            <footer><button class="btn ghost" onClick=${() => setShowExport(false)}>关闭</button></footer>
          </div>
        </div>`
      : null}

    <${EditModal}
      open=${editOpen}
      base=${editBase}
      onClose=${() => setEditOpen(false)}
      onStart=${startEdit}
    />
  </div>`;
}
