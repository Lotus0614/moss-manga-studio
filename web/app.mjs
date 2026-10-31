// 应用根组件：顶栏 + 路由 + 设置弹窗 + 全局提示。

import { html, render, useEffect, useState, useRoute, useApp, setApp, useToasts, api, go, toast } from './lib.mjs';
import ProjectsPage from './pages/projects.mjs';
import EditorPage from './pages/editor.mjs';
import SettingsModal from './components/settings-modal.mjs';
import ProjectSettings from './components/project-settings.mjs';
import CharactersModal from './components/characters-modal.mjs';

function Toasts() {
  const items = useToasts();
  return html`<div class="toasts">
    ${items.map((t) => html`<div class="toast ${t.kind === 'bad' ? 'bad' : ''}" key=${t.id}>${t.message}</div>`)}
  </div>`;
}

// 浅色 / 夜间：只切 <html data-theme>，配色全在 CSS 变量里
const THEME_KEY = 'moss.theme';

function readTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    /* 隐私模式读不了就按默认来 */
  }
  return 'light';
}

function ThemeToggle() {
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* 存不了就只在本次会话里生效 */
    }
  }, [theme]);
  const dark = theme === 'dark';
  return html`<button
    class="icon-btn theme-toggle"
    title=${dark ? '切到浅色' : '切到夜间模式'}
    onClick=${() => setTheme(dark ? 'light' : 'dark')}
  >${dark ? '☀' : '☾'}</button>`;
}

function Topbar({ route, onOpenSettings, onOpenProjectSettings, onOpenCharacters }) {
  const app = useApp();
  const project = app.project;
  const page = app.page;
  return html`<div class="topbar">
    <div class="brand" onClick=${() => go('/projects')}>MOSS MANGA STUDIO</div>
    <span class="tag">PREVIEW</span>
    ${route.name === 'editor' && project
      ? html`<div class="crumb"><b>${project.name}</b>${page ? ` / 第 ${page.index} 页${page.title ? ` · ${page.title}` : ''}` : ''}</div>`
      : html`<div class="crumb">项目</div>`}
    <div class="spacer"></div>
    ${route.name === 'editor' ? html`<button class="btn ghost" onClick=${() => go('/projects')}>项目列表</button>` : null}
    ${route.name === 'editor' ? html`<button class="btn ghost" onClick=${onOpenCharacters}>角色表</button>` : null}
    ${route.name === 'editor' ? html`<button class="btn ghost" onClick=${onOpenProjectSettings}>项目设置</button>` : null}
    <${ThemeToggle} />
    <button class="btn" onClick=${onOpenSettings}>设置</button>
  </div>`;
}

function App() {
  const route = useRoute();
  const [config, setConfig] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [charactersOpen, setCharactersOpen] = useState(false);

  useEffect(() => {
    Promise.all([api('/api/config'), api('/api/health')])
      .then(([cfg, health]) => {
        setConfig({ ...cfg, archive: health.archive });
        setApp({ settings: cfg });
      })
      .catch((err) => toast(err.message, 'bad'));
  }, []);

  useEffect(() => {
    if (route.name !== 'editor') setApp({ project: null, page: null });
  }, [route.name]);

  const applyConfig = (next) => {
    setConfig((prev) => ({ ...prev, ...next }));
    setApp({ settings: next });
  };

  let body;
  if (route.name === 'editor' && route.params.projectId) {
    body = html`<${EditorPage}
      projectId=${route.params.projectId}
      pageId=${route.params.pageId}
      config=${config}
      onOpenSettings=${() => setSettingsOpen(true)}
    />`;
  } else {
    body = html`<${ProjectsPage} />`;
  }

  return html`<div>
    <${Topbar}
      route=${route}
      onOpenSettings=${() => setSettingsOpen(true)}
      onOpenProjectSettings=${() => setProjectSettingsOpen(true)}
      onOpenCharacters=${() => setCharactersOpen(true)}
    />
    ${body}
    <${ProjectSettings}
      slug=${route.params.projectId}
      open=${projectSettingsOpen}
      onClose=${() => setProjectSettingsOpen(false)}
      onSaved=${(p) => setApp({ project: p })}
      onOpenGlobal=${() => { setProjectSettingsOpen(false); setSettingsOpen(true); }}
    />
    <${CharactersModal}
      slug=${route.params.projectId}
      open=${charactersOpen}
      onClose=${() => setCharactersOpen(false)}
      onSaved=${(p) => setApp({ project: p })}
    />
    <${SettingsModal} open=${settingsOpen} config=${config} onClose=${() => setSettingsOpen(false)} onSaved=${applyConfig} />
    <${Toasts} />
  </div>`;
}

render(html`<${App} />`, document.getElementById('app'));
