// 前端公共层：Preact + htm + 一个极简 fetch 封装和 SSE 客户端。
// 刻意不做状态管理库：跨组件共享的数据都由页面根组件持有，往下传 props。

import { h, render } from 'preact';
import { useState, useEffect, useRef, useCallback, useMemo } from 'preact/hooks';
import htm from 'htm';

export const html = htm.bind(h);
export { h, render, useState, useEffect, useRef, useCallback, useMemo };

export const cls = (...parts) => parts.filter(Boolean).join(' ');

/** 统一 API 调用：非 2xx 抛出带 message 的错误 */
export async function api(path, { method = 'GET', body, headers } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json', ...headers } : headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = new Error(data?.error || `请求失败（${res.status}）`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const apiGet = (path) => api(path);
export const apiPost = (path, body) => api(path, { method: 'POST', body });
export const apiPut = (path, body) => api(path, { method: 'PUT', body });
export const apiDelete = (path) => api(path, { method: 'DELETE' });

/**
 * POST 一条消息并按 SSE 格式逐条回调。
 * 用 fetch 而不是 EventSource，因为需要 POST + 请求体。
 */
export async function streamPost(path, body, onEvent, signal) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    let message = `请求失败（${res.status}）`;
    try {
      message = JSON.parse(text).error || message;
    } catch {
      /* 非 JSON 响应 */
    }
    throw new Error(message);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf('\n\n');
    while (idx >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const event = { type: 'message', data: null };
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event.type = line.slice(6).trim();
        else if (line.startsWith('data:')) {
          const raw = line.slice(5).trim();
          try {
            event.data = JSON.parse(raw);
          } catch {
            event.data = raw;
          }
        }
      }
      if (event.type !== 'message' || event.data !== null) onEvent(event);
      idx = buffer.indexOf('\n\n');
    }
  }
}

/** 哈希路由：#/projects、#/p/<projectId>/p/<pageId>、#/settings */export function parseRoute(hash = window.location.hash) {
  const path = (hash || '').replace(/^#/, '') || '/';
  const parts = path.split('/').filter(Boolean);
  if (!parts.length) return { name: 'projects', params: {} };
  if (parts[0] === 'settings') return { name: 'settings', params: {} };
  if (parts[0] === 'projects') return { name: 'projects', params: {} };
  if (parts[0] === 'p' && parts[1]) {
    return { name: 'editor', params: { projectId: parts[1], pageId: parts[3] || '' } };
  }
  return { name: 'projects', params: {} };
}

export function go(path) {
  window.location.hash = path.startsWith('#') ? path : `#${path}`;
}

export function useRoute() {
  const [route, setRoute] = useState(() => parseRoute());
  useEffect(() => {
    const onChange = () => setRoute(parseRoute());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

// ---------------------------------------------------------------- 视口
// 只回答「现在是不是手机宽度 / 是不是手指」。布局本身交给 CSS 断点，
// 这里只给那些必须由 JS 决定的（画布手柄大小、画布留白）。

const PHONE_QUERY = '(max-width: 720px)';
const COARSE_QUERY = '(pointer: coarse)';

function readViewport() {
  if (typeof window === 'undefined') return { phone: false, coarse: false, width: 1280, mode: 'desktop' };
  const phone = window.matchMedia(PHONE_QUERY).matches;
  const coarse = window.matchMedia(COARSE_QUERY).matches;
  const width = window.innerWidth;
  return { phone, coarse, width, mode: phone ? 'phone' : width <= 1024 ? 'tablet' : 'desktop' };
}

export function useViewport() {
  const [viewport, setViewport] = useState(readViewport);
  useEffect(() => {
    const lists = [window.matchMedia(PHONE_QUERY), window.matchMedia(COARSE_QUERY)];
    const onChange = () => setViewport(readViewport());
    for (const list of lists) list.addEventListener('change', onChange);
    return () => {
      for (const list of lists) list.removeEventListener('change', onChange);
    };
  }, []);
  return viewport;
}

export function useLoad(loader, deps = []) {
  const [state, setState] = useState({ data: null, error: '', loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    loader()
      .then((data) => alive && setState({ data, error: '', loading: false }))
      .catch((err) => alive && setState({ data: null, error: err.message, loading: false }));
    return () => {
      alive = false;
    };
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

/** 输入防抖 */
export function useDebounced(value, delay = 400) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------- 极简全局状态
// 只放「顶栏要显示什么」这类跨页面的少量数据，业务数据仍然由各页面自己持有。

export const app = { settings: null, project: null, page: null };
const appListeners = new Set();

export function setApp(patch) {
  Object.assign(app, patch);
  for (const fn of appListeners) fn(app);
}

export function useApp() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    appListeners.add(fn);
    return () => appListeners.delete(fn);
  }, []);
  return app;
}

// ---------------------------------------------------------------- 主题
// 浅色 / 夜间只在 <html data-theme> 上换一组 CSS 变量。放在这里是为了让顶栏和
// 手机「页面»项目」里都能切，而不是只有一个按钮能改。

const THEME_KEY = 'moss.theme';

function readStoredTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    /* 隐私模式读不了就按默认来 */
  }
  return 'light';
}

export const themeState = { value: typeof document === 'undefined' ? 'light' : readStoredTheme() };
const themeListeners = new Set();

function applyTheme(value) {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = value;
}

applyTheme(themeState.value);

export function setTheme(next) {
  const value = next === 'dark' ? 'dark' : 'light';
  themeState.value = value;
  applyTheme(value);
  try {
    localStorage.setItem(THEME_KEY, value);
  } catch {
    /* 存不了就只在本次会话里生效 */
  }
  for (const fn of themeListeners) fn(value);
}

export function toggleTheme() {
  setTheme(themeState.value === 'dark' ? 'light' : 'dark');
}

export function useTheme() {
  const [value, setValue] = useState(themeState.value);
  useEffect(() => {
    const fn = (next) => setValue(next);
    themeListeners.add(fn);
    fn(themeState.value);
    return () => themeListeners.delete(fn);
  }, []);
  return value;
}

// ---------------------------------------------------------------- 全局提示

const toastItems = [];
const toastListeners = new Set();

export function toast(message, kind = '') {
  const item = { id: `${Date.now()}${Math.random()}`, message, kind };
  toastItems.push(item);
  for (const fn of toastListeners) fn([...toastItems]);
  setTimeout(
    () => {
      const idx = toastItems.indexOf(item);
      if (idx >= 0) toastItems.splice(idx, 1);
      for (const fn of toastListeners) fn([...toastItems]);
    },
    kind === 'bad' ? 6000 : 3500
  );
  return item.id;
}

export function useToasts() {
  const [items, setItems] = useState([...toastItems]);
  useEffect(() => {
    toastListeners.add(setItems);
    return () => toastListeners.delete(setItems);
  }, []);
  return items;
}
