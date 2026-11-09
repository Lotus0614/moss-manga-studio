#!/usr/bin/env node
// moss-manga CLI —— Agent 操作漫画存档的唯一入口。
//
//   node scripts/manga.mjs doctor
//   node scripts/manga.mjs page show --page 1 --summary
//
// 所有命令都支持 --json，输出稳定的结构化结果；默认输出给人看的紧凑文本。

import { spawn } from 'node:child_process';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  resolveConfigDir,
  resolveArchiveDir,
  ensureConfig,
  readConfig,
  writeConfig,
  getPath,
  setPath,
} from './lib/config.mjs';
import {
  ensureArchive,
  readState,
  listProjects,
  getProject,
  createProject,
  saveProject,
  removeProject,
  listPages,
  getPage,
  savePage,
  createPage,
  removePage,
  changes,
  ack,
  currentRev,
  readJournal,
} from './lib/archive.mjs';
import { listWorkflows, readWorkflow, saveWorkflow, checkWorkflow } from './lib/workflow.mjs';
import { ComfyClient } from './lib/comfy.mjs';
import { prepareRender, renderPage } from './lib/render.mjs';
import { prepareEdit, fillEdit, editPage } from './lib/edit.mjs';
import { createReporter } from './lib/reporter.mjs';
import { compilePage } from '../core/compile.mjs';
import { diffPage, describeOp } from './lib/diff.mjs';
import { createItem } from '../core/manga-doc.mjs';
import { normalizeCharacters } from '../core/characters.mjs';
import { pageOutline, projectOutline, warningsText, table, diffText } from './lib/format.mjs';

const HERE = import.meta.dirname;
const SERVER = resolve(HERE, '..', 'server.mjs');
const VERSION = '2.0.0';

// ---------------------------------------------------------------- 参数解析

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq >= 0) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      flags[body] = argv[i + 1];
      i += 1;
    } else {
      flags[body] = true;
    }
  }
  return { positional, flags };
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const command = positional[0] || 'help';
const JSON_MODE = Boolean(flags.json);
const CONFIG_DIR = resolveConfigDir(flags.config);
const CONFIG = await readConfig(CONFIG_DIR);
const DIR = resolveArchiveDir(CONFIG, flags.dir || flags.archive);

function out(payload, human) {
  if (JSON_MODE) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`${human ?? ''}\n`);
  }
}

function fail(message, code = 'error') {
  if (JSON_MODE) process.stdout.write(`${JSON.stringify({ ok: false, code, error: message }, null, 2)}\n`);
  else process.stderr.write(`错误：${message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------- 通用解析

async function needProject() {
  if (flags.project) {
    const project = await getProject(DIR, String(flags.project));
    if (!project) fail(`项目不存在：${flags.project}`);
    return project;
  }
  const projects = await listProjects(DIR);
  if (projects.length === 1) return projects[0];
  if (!projects.length) fail('还没有任何项目，先用 `manga project new --name "名字"` 建一个');
  fail(`有多个项目，请用 --project 指定：${projects.map((p) => p.slug).join(', ')}`);
}

async function needPage(project) {
  const ref = flags.page;
  if (ref === undefined) fail('缺少 --page（页码，从 1 开始）');
  const page = await getPage(DIR, project.slug, ref);
  if (!page) {
    const pages = await listPages(DIR, project.slug);
    fail(`找不到第 ${ref} 页（现有：${pages.map((p) => p.index).join(', ') || '无'}）`);
  }
  return page;
}

// ---------------------------------------------------------------- 命令

async function cmdDoctor() {
  const configExists = existsSync(join(CONFIG_DIR, 'config.json'));
  const archiveExists = existsSync(join(DIR, 'state.json'));
  const result = {
    ok: true,
    configured: false,
    configDir: CONFIG_DIR,
    archive: DIR,
    archiveExists,
    version: VERSION,
    comfy: { url: '', reachable: false, version: '', checkpoints: 0, loras: 0 },
    workflow: { name: '', ok: false, params: [], error: '' },
    edit: { name: '', ok: false, params: [], missing: [] },
    ckpt: '',
    projects: 0,
    problems: [],
  };

  if (!configExists) {
    result.problems.push('还没有初始化：先运行 `manga init`');
    out(
      result,
      ['未初始化', `配置根：${CONFIG_DIR}`, `存档：${DIR}`, '下一步：manga init --comfy http://127.0.0.1:8188'].join('\n')
    );
    return;
  }

  const config = await readConfig(CONFIG_DIR);
  result.comfy.url = config.comfy.url;
  result.ckpt = (config.params && config.params.ckpt) || '';
  result.workflow.name = config.workflow.name;

  const client = new ComfyClient({ url: config.comfy.url });
  let checkpoints = [];
  try {
    const stats = await client.stats();
    const info = await client.objectInfo();
    result.comfy.reachable = true;
    result.comfy.version = stats.system?.comfyui_version || '';
    checkpoints = info.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
    result.comfy.checkpoints = checkpoints.length;
    result.comfy.loras = info.LoraLoader?.input?.required?.lora_name?.[0]?.length || 0;
  } catch (err) {
    result.comfy.error = err.message;
    result.problems.push(`连不上 ComfyUI：${err.message}`);
  }

  let checked = null;
  try {
    const workflows = await listWorkflows(CONFIG_DIR);
    if (!config.workflow.name) {
      result.problems.push('还没有工作流：把你的「导出 (API)」JSON 发我，改好后用 `manga workflow save` 存进去');
    } else {
      const wf = await readWorkflow(CONFIG_DIR, config.workflow.name).catch((err) => {
        result.problems.push(err.message);
        return null;
      });
      if (wf) {
        checked = checkWorkflow(wf.raw);
        result.workflow = {
          name: wf.name,
          ok: checked.ok,
          params: checked.params.map((p) => p.name),
          error: checked.error || '',
        };
        if (checked.error) result.problems.push(`工作流解析失败：${checked.error}`);
        else if (!checked.ok) result.problems.push(`工作流缺占位符：${checked.missing.map((m) => `{{${m}}}`).join('、')}（manga workflow check）`);
      }
    }
    // 只在工作流真的用到 ckpt 时才要求
    if (checked?.params?.some((p) => p.name === 'ckpt')) {
    if (!result.ckpt) result.problems.push('这个工作流用了 {{ckpt}}，但还没填：manga config set params.ckpt=<文件名>');
      else if (checkpoints.length && !checkpoints.includes(result.ckpt)) result.problems.push(`ckpt「${result.ckpt}」在 ComfyUI 里找不到`);
    }
  } catch (err) {
    result.problems.push(`读取工作流失败：${err.message}`);
  }

  // 修图工作流是可选的：没配就不查；配了但缺文件 / 缺占位符才算问题
  if (config.edit?.name) {
    try {
      const wf = await readWorkflow(CONFIG_DIR, config.edit.name);
      const checkedEdit = checkWorkflow(wf.raw);
      const names = new Set(checkedEdit.params.map((p) => p.name));
      const missing = ['prompt', 'image', 'seed'].filter((key) => !names.has(key));
      result.edit = { name: wf.name, ok: !checkedEdit.error && !missing.length, params: checkedEdit.params.map((p) => p.name), missing };
      if (checkedEdit.error) result.problems.push(`修图工作流解析失败：${checkedEdit.error}`);
      else if (missing.length) {
        result.problems.push(
          `修图工作流缺占位符：${missing.map((m) => `{{${m}}}`).join('、')}（三处：LoadImage 的 image、提示词节点、KSampler 的 seed）`
        );
      }
    } catch (err) {
      result.problems.push(`修图工作流：${err.message}`);
    }
  }

  const projects = await listProjects(DIR).catch(() => []);
  result.projects = projects.length;
  if (!archiveExists) result.problems.push(`存档还没建立：${DIR}（运行 manga init 会自动建）`);
  result.configured = result.comfy.reachable && Boolean(result.workflow.name) && result.workflow.ok && result.problems.length === 0;

  out(
    result,
    [
      `配置根：${CONFIG_DIR}`,
      `存档：${DIR}`,
      `ComfyUI：${config.comfy.url} ${result.comfy.reachable ? `✓ ${result.comfy.version}` : '✗ 连不上'}`,
      `工作流：${result.workflow.name || '（未设置）'} ${result.workflow.ok ? `✓ ${result.workflow.params.length} 个参数` : '✗'}`,
      `修图：${config.edit?.name ? `${result.edit.name} ${result.edit.ok ? '✓' : '✗ 缺占位符'}` : '（未配置，网页不显示修图按钮）'}`,
      `检查点：${result.ckpt || '（不需要）'}`,
      `项目：${projects.length} 个`,
      result.configured ? '状态：已配置，可以直接开始画' : `状况：${result.problems.length} 个问题`,
      ...result.problems.map((p) => `  - ${p}`),
    ].join('\n')
  );
}

async function cmdInit() {
  await ensureConfig(CONFIG_DIR);
  await ensureArchive(DIR);
  const patch = {};
  if (flags.archive) patch.archive = resolve(String(flags.archive));
  if (flags.comfy) patch.comfy = { url: String(flags.comfy) };
  if (flags.ckpt) patch.defaults = { ckpt: String(flags.ckpt) };
  if (flags.workflow) {
    const saved = await saveWorkflow(CONFIG_DIR, String(flags.workflow), 'default.json');
    patch.workflow = { name: saved.name };
  }
  const config = Object.keys(patch).length ? await writeConfig(CONFIG_DIR, patch) : await readConfig(CONFIG_DIR);
  out(
    { ok: true, configDir: CONFIG_DIR, archive: DIR, config },
    [
      `配置：${CONFIG_DIR}`,
      `存档：${DIR}`,
      `ComfyUI：${config.comfy.url}`,
      `工作流：${config.workflow.name}`,
      config.params && Object.keys(config.params).length ? `工作流参数：${Object.keys(config.params).join(', ')}` : '工作流参数：还没填（manga config set params.名字=值）',
    ].join('\n')
  );
}

async function cmdConfig() {
  const action = positional[1] || 'get';
  if (action === 'get') {
    const config = await readConfig(CONFIG_DIR);
    const key = positional[2];
    if (key) {
      const value = getPath(config, key);
      return out({ ok: true, key, value }, `${key} = ${JSON.stringify(value)}`);
    }
    return out({ ok: true, config }, JSON.stringify(config, null, 2));
  }
  if (action !== 'set') fail('用法：manga config get [键] | manga config set 键=值 [键=值...]');

  let config = await readConfig(CONFIG_DIR);
  const pairs = positional.slice(2);
  if (!pairs.length) fail('至少给一个 键=值');
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq < 0) fail(`不是 键=值 形式：${pair}`);
    const key = pair.slice(0, eq);
    const raw = pair.slice(eq + 1);
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      value = raw;
    }
    config = setPath(config, key, value);
  }
  await writeConfig(CONFIG_DIR, config);
  out({ ok: true, config }, `已更新：${pairs.join('，')}`);
}

async function cmdWorkflow() {
  const action = positional[1] || 'list';
  if (action === 'list') {
    const workflows = await listWorkflows(CONFIG_DIR);
    return out(
      { ok: true, workflows },
      table(
        workflows.map((w) => [w.name, w.source, w.ok ? `${w.params.length} 参数` : '解析失败', w.params.map((p) => p.name).join(',')]),
        ['文件', '来源', '状态', '参数']
      )
    );
  }
  if (action === 'path') {
    return out(
      { ok: true, configDir: CONFIG_DIR, workflowsDir: join(CONFIG_DIR, 'workflows'), current: CONFIG.workflow.name, archive: DIR },
      [
        `配置根：${CONFIG_DIR}`,
        `工作流目录：${join(CONFIG_DIR, 'workflows')}`,
        `当前工作流：${CONFIG.workflow.name}`,
        '把改好的工作流 JSON 写到上面目录里的同名文件，或运行 manga workflow save <文件>。',
      ].join('\n')
    );
  }
  if (action === 'save' || action === 'import') {
    const file = positional[2] || flags.file;
    if (!file) fail('用法：manga workflow save <API JSON 文件> [--name default.json]');
    const name = String(flags.name || 'default.json');
    const saved = await saveWorkflow(CONFIG_DIR, String(file), name);
    if (!flags['no-activate']) await writeConfig(CONFIG_DIR, { workflow: { name: saved.name } });
    const lines = [
      `已保存 ${saved.name}（${saved.nodeCount} 个节点，${saved.params.length} 个占位符）`,
      `参数：${saved.params.map((p) => `{{${p.name}}}`).join(' ') || '（没有占位符）'}`,
      flags['no-activate'] ? '没有切换当前生图工作流（--no-activate）。' : '已设为当前生图工作流。',
      saved.ok
        ? saved.kind === 'edit'
          ? '占位符齐全（{{prompt}} {{image}} {{seed}}）。'
          : '三项关键占位符齐全（prompt / width / height）。'
        : `缺：${saved.missing.map((m) => `{{${m}}}`).join('、')}`,
    ];
    for (const w of saved.warnings) lines.push(`  提醒：${w}`);
    return out({ ok: saved.ok, workflow: { name: saved.name, params: saved.params, missing: saved.missing, warnings: saved.warnings } }, lines.join('\n'));
  }
  if (action === 'check') {
    const name = String(flags.name || CONFIG.workflow.name);
    const wf = await readWorkflow(CONFIG_DIR, name);
    const result = checkWorkflow(wf.raw);
    if (!result.error) result.file = wf.file;
    return out(
      { ok: result.ok, ...result, name: wf.name },
      result.error
        ? `解析失败：${result.error}`
        : [
            `${wf.name}：${result.nodeCount} 个节点${result.kind === 'edit' ? '（修图）' : ''}`,
            `占位符：${result.params.map((p) => `{{${p.name}}}`).join(' ') || '（没有）'}`,
            result.ok ? (result.kind === 'edit' ? '可以修图。' : '可以直接生成。') : `缺：${result.missing.map((m) => `{{${m}}}`).join('、')}`,
            ...result.warnings.map((w) => `  提醒：${w}`),
          ].join('\n')
    );
  }
  if (action === 'show') {
    const name = String(flags.name || (await readConfig(CONFIG_DIR)).workflow.name);
    const wf = await readWorkflow(CONFIG_DIR, name);
    return out({ ok: true, ...wf }, wf.raw);
  }
  fail('用法：manga workflow list | import <文件> | show');
}

async function cmdProject() {
  const action = positional[1] || 'list';
  if (action === 'new') {
    const name = String(flags.name || '').trim();
    if (!name) fail('用法：manga project new --name "项目名" [--size page|page-hd|square|wide]');
  const cfgNow = await readConfig(CONFIG_DIR);
  const canvas = String(flags.canvas || '').match(/^(\d+)x(\d+)$/i);
  const project = await createProject(DIR, {
    name,
    size: String(flags.size || 'page'),
    canvas: canvas ? [Number(canvas[1]), Number(canvas[2])] : cfgNow.defaults.canvas,
    defaults: { style: cfgNow.defaults.style, vertical: cfgNow.defaults.vertical },
  });
    return out({ ok: true, project }, `已创建项目「${project.name}」，slug=${project.slug}`);
  }
  if (action === 'list') {
    const projects = await listProjects(DIR);
    const rows = [];
    for (const p of projects) rows.push([p.slug, p.name, p.size, (await listPages(DIR, p.slug)).length]);
    return out({ ok: true, projects }, table(rows, ['slug', '名称', '画布', '页数']));
  }
  if (action === 'show') {
    const project = await needProject();
    const pages = await listPages(DIR, project.slug);
    return out({ ok: true, project, pages }, projectOutline(project, pages));
  }
  if (action === 'delete') {
    const project = await needProject();
    await removeProject(DIR, project.slug);
    return out({ ok: true }, `已删除项目「${project.name}」`);
  }
  fail('用法：manga project new|list|show|delete');
}

async function cmdCharacter() {
  const project = await needProject();
  const action = positional[1] || 'list';
  // 跟 normalizeCharacters 对齐：id 一律小写，页面里的 ref 也永远是小写
  project.characters = normalizeCharacters(project.characters);

  if (action === 'list') {
    const rows = project.characters.map((char) => [char.id, char.name, char.look]);
    return out(
      { ok: true, characters: project.characters },
      rows.length ? table(rows, ['id', '名字', '外貌（英文）']) : '这个项目还没有角色，用 `manga character add --id reina --name Reina --look "..."` 加一个',
    );
  }

  const id = normalizeCharacters([{ id: flags.id }])[0]?.id || '';

  if (action === 'add' || action === 'set') {
    if (!id) fail('需要 --id，只允许 ASCII（例如 reina）');
    const name = String(flags.name || id).trim();
    const look = String(flags.look || '').trim();
    if (!look) fail('需要 --look：英文外貌描述（发型、五官、服装、体型），不要写汉字名');

    const existing = project.characters.find((char) => char.id === id);
    if (existing) {
      existing.name = name;
      existing.look = look;
    } else {
      project.characters.push({ id, name, look });
    }
    await saveProject(DIR, project);
    // 名字里的编号是 summary 自动解析角色表的依据，写错不拦，只提醒
    const named = /^CHARACTER\s+\w+\s*-\s*\S+/i.test(name)
      ? ''
      : `\n提示：名字建议写成「CHARACTER ONE - ${name}」，summary 会自动带上这个编号`;
    return out(
      { ok: true, character: { id, name, look } },
      `已${existing ? '更新' : '添加'}角色 ${name}（${id}）${named}`,
    );
  }

  if (action === 'remove') {
    const before = project.characters.length;
    project.characters = project.characters.filter((char) => char.id !== id);
    if (project.characters.length === before) fail(`没有这个角色：${id}`);
    await saveProject(DIR, project);
    return out({ ok: true }, `已删除角色 ${id}`);
  }

  fail('用法：manga character list|add|set|remove [--id ID --name 名字 --look "英文外貌"]');
}

async function cmdPage() {
  const action = positional[1] || 'list';
  const project = await needProject();

  if (action === 'new') {
    const created = await createPage(DIR, project.slug, {
      title: String(flags.title || ''),
      items: flags.blank ? [] : undefined,
    });
    return out({ ok: true, page: created.page }, `已新建第 ${created.page.index} 页（${created.page.id}），${created.page.items.length} 项`);
  }

  if (action === 'list') {
    const pages = await listPages(DIR, project.slug);
    return out(
      { ok: true, pages },
      table(
        pages.map((p) => [p.index, p.id, p.title || '—', p.items, p.rev]),
        ['页', 'id', '标题', '项', 'rev']
      )
    );
  }

  if (action === 'show') {
    const page = await needPage(project);
    if (JSON_MODE) return out({ ok: true, page }, '');
    return out({ ok: true, page }, flags.summary === false ? JSON.stringify(page, null, 2) : pageOutline(page));
  }

  if (action === 'set') {
    const page = await needPage(project);
    let patch = null;
    if (flags.file) patch = JSON.parse(await readFile(resolve(String(flags.file)), 'utf8'));
    else if (flags.patch) patch = JSON.parse(String(flags.patch));
    if (!patch) fail('需要 --file <patch.json> 或 --patch \'{"title":"..."}\'');

    const next = applyPatch(page, patch, { replace: Boolean(flags.replace) });
    const ops = diffPage(page, next);
    const refused = checkScope(await readConfig(CONFIG_DIR), ops);
    if (refused.length) {
      fail(`这些改动超出了允许范围（${refused.join('、')}）：${ops.map(describeOp).join('；')}`, 'scope');
    }
    const saved = await savePage(DIR, project.slug, next, { actor: 'cli' });
    return out(
      { ok: true, page: saved.page, rev: saved.rev, ops: saved.ops },
      saved.ops.length ? `已保存第 ${page.index} 页（rev ${saved.rev}）\n${saved.ops.map((o) => `  ${describeOp(o)}`).join('\n')}` : '没有变化'
    );
  }


  if (action === 'add-character') {
    const page = await needPage(project);
    const ref = String(flags.ref || '').trim().toLowerCase();
    if (!ref) fail('需要 --ref（项目角色表里的 id），先用 `manga character list` 看有哪些');
    const chars = Array.isArray(project.characters) ? project.characters : [];
    if (!chars.some((char) => char.id === ref)) {
      fail(`项目里没有这个角色：${ref}（现有：${chars.map((c) => c.id).join(', ') || '无'}）`);
    }

    let bbox = null;
    const raw = String(flags.bbox || '').trim();
    if (raw) {
      const nums = raw.split(/[,\s]+/).filter(Boolean).map(Number);
      if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) fail('--bbox 要四个数：x1,y1,x2,y2');
      bbox = nums;
    }

    const existing = page.items.filter((it) => it.type === 'character').length;
    const item = createItem('character', {
      ref,
      bbox:
        bbox ||
        [40 + (existing % 4) * 36, 900 + (existing % 3) * 28, 300 + (existing % 4) * 36, 1240 + (existing % 3) * 28],
      ...(flags.desc ? { desc: String(flags.desc) } : {}),
    });

    const next = { ...page, items: [...page.items, item] };
    const saved = await savePage(DIR, project.slug, next, { actor: 'cli' });
    const hint = flags.desc
      ? ''
      : '\n还没有 desc：这一格不会出图，补上「CHARACTER ONE - 名字, inside PANEL ONE only, 姿势」才会进提示词';
    return out(
      { ok: true, item, page: saved.page, rev: saved.rev },
      `已把「${ref}」加到第 ${page.index} 页（${item.id}，rev ${saved.rev}），拖到想要的位置即可${hint}`,
    );
  }

  if (action === 'delete') {
    const page = await needPage(project);
    await removePage(DIR, project.slug, page.id);
    return out({ ok: true }, `已删除第 ${page.index} 页`);
  }

  fail('用法：manga page new|list|show|set|add-character|apply|delete');
}

/**
 * 应用补丁：数组默认按 id 合并（只改你写的那几条），--replace 才是整体替换。
 * 删除用 patch.removePanels / patch.removeBubbles 显式列出 id。
 */
function applyPatch(page, patch, { replace = false } = {}) {
  const next = { ...page };
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'items' || key === 'removeItems') continue;
    if (key === 'id') continue;
    next[key] = value;
  }

  const mergeItems = (existing, incoming, factory) => {
    if (replace) return incoming.map((item) => (item.id ? item : factory(item)));
    const out = existing.map((item) => ({ ...item }));
    for (const item of incoming || []) {
      if (item?.id) {
        const index = out.findIndex((x) => x.id === item.id);
        if (index >= 0) out[index] = { ...out[index], ...item, id: item.id };
        else out.push(factory(item));
      } else {
        out.push(factory(item));
      }
    }
    return out;
  };

  let items = mergeItems(page.items, patch.items, (item) => createItem(item.type || 'panel', item));
  if (Array.isArray(patch.removeItems)) items = items.filter((it) => !patch.removeItems.includes(it.id));

  return { ...next, items, id: page.id };
}

function checkScope(config, ops) {
  const editable = config.editable || {};
  const refused = new Set();
  for (const op of ops) {
    if (op.op === 'page' && op.field === 'style' && editable.style === false) refused.add('画风');
    if (op.target === 'panel' && editable.layout === false) refused.add('版面');
    if (op.target === 'bubble') {
      if (op.op === 'bbox' && editable.layout === false) refused.add('版面');
      if (op.op === 'text' && editable.text === false) refused.add('台词');
      if (op.op === 'field' && op.field === 'type' && editable.bubbleType === false) refused.add('气泡类型');
      if (op.op === 'add' && editable.text === false) refused.add('台词');
    }
  }
  return [...refused];
}

async function cmdCompile() {
  const project = await needProject();
  const page = await needPage(project);
  const compiled = compilePage(page, project);
  const warnings = compiled.warnings;
  if (JSON_MODE) return out({ ok: true, json: compiled.json, doc: compiled.doc, warnings, stats: compiled.stats }, '');
  return out(
    { ok: true, json: compiled.json, warnings },
    `第 ${page.index} 页编译结果（${compiled.stats.bytes} 字节，${compiled.stats.items} 项）\n${warningsText(warnings)}\n\n${compiled.json}`
  );
}

async function cmdRender() {
  const project = await needProject();
  const page = await needPage(project);
  const config = await readConfig(CONFIG_DIR);

  if (flags['dry-run']) {
    const prepared = await prepareRender({ dir: DIR, configDir: CONFIG_DIR, project, page, config, opts: flags });
    if (!prepared.ok) return fail(prepared.error, 'render');
    return out(
      { ok: true, dryRun: true, workflow: prepared.workflow, values: prepared.values, graph: prepared.graph },
      `会使用工作流 ${prepared.workflow}，seed=${prepared.values.seed}\n${warningsText(prepared.warnings)}`
    );
  }

  const started = Date.now();
  // 预览服务器开着的话，播报一声：网页那边立刻能看到「生成中…」，而不是等出图落地
  const reporter = await createReporter({ dir: DIR });
  await reporter.start({ project: project.slug, page: page.id, index: page.index, title: page.title || '', kind: 'render' });
  try {
    const result = await renderPage({
      dir: DIR,
      configDir: CONFIG_DIR,
      slug: project.slug,
      project,
      page,
      config,
      opts: flags,
      onProgress: (p) => {
        if (!JSON_MODE && p?.max) process.stderr.write(`\r生成中 ${Math.round((p.value / p.max) * 100)}%   `);
        reporter.tick(p?.max ? Math.round((p.value / p.max) * 100) : undefined);
      },
    });
    if (!JSON_MODE) process.stderr.write('\r');
    await reporter.done({
      versionId: result.version?.id,
      image: result.image,
      ...(Number.isFinite(result.seed) ? { seed: result.seed } : {}),
    });
    const human = [
      `第 ${page.index} 页已生成（${Date.now() - started}ms）`,
      `图片：${result.image}`,
      `seed：${result.seed}`,
      warningsText(result.warnings),
    ].join('\n');
    out({ ok: true, ...result }, human);
  } catch (err) {
    await reporter.fail(err);
    return fail(err.message, 'render');
  }
}

async function cmdEdit() {
  const project = await needProject();
  const page = await needPage(project);
  const config = await readConfig(CONFIG_DIR);

  const opts = { ...flags };
  // 涂鸦图：网页里画好的那张整页图，直接当参考图喂进去
  if (flags.overlay) {
    try {
      opts.overlay = await readFile(resolve(String(flags.overlay)));
      opts.overlayExt = (String(flags.overlay).split('.').pop() || 'png').toLowerCase();
    } catch (err) {
      return fail(`读不到涂鸦图 ${flags.overlay}：${err.message}`, 'edit');
    }
  }
  if (flags.marks) {
    // 标记是一段 JSON，Windows 下直接写在命令行里引号很容易被吃掉：支持 --marks @文件
    try {
      const raw = String(flags.marks).startsWith('@')
        ? await readFile(resolve(String(flags.marks).slice(1)), 'utf8')
        : String(flags.marks);
      opts.marks = JSON.parse(raw);
    } catch {
      return fail('--marks 要写成 JSON，例如 \'[{"tool":"rect","color":"red"}]\'，或 --marks @marks.json', 'edit');
    }
  }

  if (flags['dry-run']) {
    const prepared = await prepareEdit({ dir: DIR, configDir: CONFIG_DIR, project, page, config, opts });
    if (!prepared.ok) return fail(prepared.error, 'edit');
    const graph = fillEdit(prepared, '<上传后的参考图>');
    return out(
      { ok: true, dryRun: true, workflow: prepared.workflow, base: prepared.base.id, prompt: prepared.prompt, marks: prepared.marks, values: prepared.values, graph },
      [`会基于 ${prepared.base.id} 修图，工作流 ${prepared.workflow}`, `提示词：${prepared.prompt}`].join('\n')
    );
  }

  const started = Date.now();
  // 修图同样播报：网页浮窗里能看到「修图中…」，完成后结果直接落进列表
  const reporter = await createReporter({ dir: DIR });
  await reporter.start({
    project: project.slug,
    page: page.id,
    index: page.index,
    title: page.title || '',
    kind: 'edit',
    prompt: String(flags.prompt || '').slice(0, 200),
  });
  try {
    const result = await editPage({
      dir: DIR,
      configDir: CONFIG_DIR,
      slug: project.slug,
      project,
      page,
      config,
      opts,
      onProgress: (p) => {
        if (!JSON_MODE && p?.max) process.stderr.write(`\r修图中 ${Math.round((p.value / p.max) * 100)}%   `);
        reporter.tick(p?.max ? Math.round((p.value / p.max) * 100) : undefined);
      },
    });
    if (!JSON_MODE) process.stderr.write('\r');
    await reporter.done({ versionId: result.version?.id, image: result.image });
    const human = [
      `第 ${page.index} 页已修好（${Date.now() - started}ms，基于 ${result.base}）`,
      `图片：${result.image}`,
      `版本：${result.version.id}`,
      `提示词：${result.prompt}`,
    ].join('\n');
    out({ ok: true, ...result }, human);
  } catch (err) {
    await reporter.fail(err);
    return fail(err.message, err.code || 'edit');
  }
}

async function cmdChanges() {
  const since = flags.since !== undefined ? Number(flags.since) : undefined;
  const result = await changes(DIR, since);
  // 给每页补上当前校验提醒数，省得 Agent 再跑一次 compile
  for (const group of result.pages) {
    const project = await getProject(DIR, group.project);
    const page = await getPage(DIR, group.project, group.page);
    if (project && page) {
      const compiled = compilePage(page, project);
      group.warnings = compiled.warnings.length;
      group.title = page.title;
      group.index = page.index;
    }
  }
  out({ ok: true, ...result }, diffText(result));
}

async function cmdAck() {
  const result = await ack(DIR);
  out({ ok: true, ...result }, `已确认，ackedRev = ${result.ackedRev}`);
}

async function cmdServe() {
  const port = Number(flags.port || 5123);
  const pidFile = join(DIR, 'server.pid');
  if (existsSync(pidFile)) {
    const pid = Number((await readFile(pidFile, 'utf8')).trim());
    try {
      process.kill(pid, 0);
      return out({ ok: true, running: true, url: `http://127.0.0.1:${port}` }, `预览服务已经在跑：http://127.0.0.1:${port}`);
    } catch {
      await rm(pidFile, { force: true });
    }
  }

  const child = spawn(process.execPath, [SERVER], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, MOSS_ARCHIVE: DIR, PORT: String(port) },
  });
  child.unref();
  await writeFile(pidFile, String(child.pid), 'utf8');

  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) break;
    } catch {
      /* 还没起来 */
    }
  }
  if (flags.open) openBrowser(url);
  out({ ok: true, running: true, url, pid: child.pid }, `预览已启动：${url}\n改完页面保存后刷新即可；关闭用 manga stop`);
}

async function cmdStop() {
  // 按端口找进程：不依赖 pid 文件，start.bat / serve / node server.mjs 都能关
  const port = Number(flags.port || 5123);
  const pids = await pidsOnPort(port);
  if (!pids.length) {
    await rm(join(DIR, 'server.pid'), { force: true });
    return out({ ok: true, running: false }, '预览服务没有在跑');
  }
  for (const pid of pids) {
    try {
      process.kill(pid);
    } catch {
      /* 已经没了 */
    }
  }
  await rm(join(DIR, 'server.pid'), { force: true });
  out({ ok: true, running: false, port }, `预览服务已关闭（端口 ${port}）`);
}

/** 查某个端口上的监听进程（Windows / *nix） */
async function pidsOnPort(port) {
  try {
    if (process.platform === 'win32') {
      const { execSync } = await import('node:child_process');
      const text = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return [...new Set(text.split('\n').map((l) => l.trim().split(/\s+/).pop()).filter((v) => /^\d+$/.test(v)))].map(Number);
    }
    const { execSync } = await import('node:child_process');
    const text = execSync(`lsof -ti :${port}`, { encoding: 'utf8' });
    return text.split('\n').map((v) => Number(v.trim())).filter(Boolean);
  } catch {
    return [];
  }
}

async function cmdOpen() {
  const port = Number(flags.port || 5123);
  const url = `http://127.0.0.1:${port}`;
  openBrowser(url);
  out({ ok: true, url }, url);
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* 打不开就算了，URL 已经打印 */
  }
}

function cmdHelp() {
  process.stdout.write(`moss-manga CLI v${VERSION}

  配置
    manga doctor                          检查配置、ComfyUI、工作流
    manga init [--comfy URL] [--ckpt NAME] [--workflow FILE] [--archive DIR]
    manga config get [键] | config set 键=值 ...
    manga workflow path                   打印工作流该放哪（配置根）
    manga workflow save <文件> [--name default.json] [--no-activate]
    manga workflow check [--name default.json]
    manga workflow list | show

  项目与页面
    manga project new --name "名字" [--size page]
    manga project list | show | delete
    manga character list                         项目角色表（外貌只写一次）
    manga character add --id shion --name "CHARACTER ONE - SHION" --look "18, long straight black hair, ..."
    manga character set --id shion --look "..."  改某个角色
    manga character remove --id shion
    manga page new [--title 标题] [--blank]     默认给一个整页框，排版自己定
    manga page list
    manga page show --page N [--summary]
    manga page set  --page N --file patch.json   items 按 id 合并
    manga page delete --page N

  出图
    manga compile --page N                       打印 Moss JSON 与校验
    manga render  --page N [--seed S] [--steps N] [--dry-run]
    manga edit    --page N --prompt "把左上角气泡的尾巴删掉" [--seed S] [--dry-run]
    manga changes [--since N] | manga ack

  预览
    manga serve [--port 5123] [--open] | manga stop | manga open

 全局：--dir <存档目录>  --project <slug>  --json
`);
}

// ---------------------------------------------------------------- 分发

const COMMANDS = {
  doctor: cmdDoctor,
  init: cmdInit,
  config: cmdConfig,
  workflow: cmdWorkflow,
  project: cmdProject,
  character: cmdCharacter,
  page: cmdPage,
  compile: cmdCompile,
  render: cmdRender,
  edit: cmdEdit,
  changes: cmdChanges,
  ack: cmdAck,
  serve: cmdServe,
  stop: cmdStop,
  open: cmdOpen,
  help: async () => cmdHelp(),
};

const handler = COMMANDS[command];
if (!handler) {
  cmdHelp();
  process.exitCode = 2;
} else {
  try {
    await handler();
  } catch (err) {
    fail(err.message, err.code || 'error');
  }
}

