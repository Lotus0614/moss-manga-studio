# AGENTS

在这个工作区干活的 AI 的**入口**。
这里只有导航：这个项目怎么运作、每份文档管什么、画一页走哪几步。
**怎么写提示词、字段怎么填，不在这里**——顺着下面的指路去对应文档。

---

## 1. 这个项目在做什么

一页漫画就是一份 JSON。你把分镜写成 `pages/p01.json`，`compile` 把它编译成 MOSS Layout
JSON，`render` 发给 ComfyUI 出图；出完可以在网页里拖、在历史里换版本、用编辑模型小修。

```
写 JSON ──→ compile（拼提示词、注入角色表、校验）
               │
               ├─→ render（ComfyUI 生图）──→ PNG ──→ 历史里一个新版本
               └─→ edit（编辑模型小修）───┘
```

## 2. 文档分工

| 文档 | 管什么 | 什么时候读 |
| --- | --- | --- |
| `references/FORMAT.md` | **格式**：存档目录、`project.json` / `page.json` 每个字段的可用值、坐标、尺寸、校验规则 | 写或改页面 JSON 之前 |
| `references/TECHNIQUES.md` | **生成经验**：`scene` 怎么搭、`desc` 怎么写、版式、语序、文字、画错了怎么调 | 想分镜、写提示词时（主力文档） |
| `references/HAIR.md` | **发型 tag 词库**：131 个发型词按用途分组 + A–Z + 别名对照 | 定角色 `look`、要「同一个人」跨页一致时 |
| `references/R18-MANGA.md` | 成人向专章：满版、嵌格、同格双视角、体位与 **tag 词库** | 画 R18 页面时先读这份 |
| `references/CLI.md` | 命令参数、返回结构、退出码 | 不确定命令怎么用时查 |
| `references/WORKFLOW.md` | 接入 / 更换 ComfyUI 工作流、占位符、报错对照 | 换工作流或出图报错时 |
| `INSTALL.md` | 从零安装，可整份交给 AI 执行 | 首次配置 |
| `references/MOSSS_LAYOUT.md` | MOSS 官方 Layout 规范 | **日常不读**，`compile` 已按它生成 |

一句话：**「格式对不对」查 FORMAT，「画得好不好」查 TECHNIQUES。**

## 3. 目录职责

| 路径 | 是什么 | 能不能改 |
| --- | --- | --- |
| `config/` | 配置：类型、词表、句式、工作流、出图参数 | ✅ 随便改 |
| `data/` | 作品：项目、页面、图片 | 走 CLI，别手改 |
| `references/` | 文档（见上一节），按需读 | 📖 只读 |
| `core/` | 引擎：坐标换算、编译、校验 | ⚠️ 只有修 bug 才动 |
| `web/`、`scripts/` | 网页编辑器、命令行 | ⚠️ 只有修 bug 才动 |

**所有提示词方言都在 `config/manga.mjs` 一个文件里**（形状、机位、画风、气泡措辞、句子模板、
`buildSummary`）。要调整内置措辞就改它，格式见 `FORMAT.md` 最后一节。

画漫画时**不要打开**：`core/` `scripts/` `web/` `tools/` `server.mjs` `references/MOSSS_LAYOUT.md`。

## 4. 画一页的流程

### 第 0 步：开工前——**先把网页跑起来**，再问两件事

开工前确认两样东西能跑：`node manga.mjs doctor`（ComfyUI 通不通，未配置就转 `INSTALL.md`）和网页。

**网页没起来就别开始构思。**启动命令是幂等的，已经在跑会直接告诉你地址：

```bash
node manga.mjs serve --port 5123
```

- 返回 `预览已启动：…` 或 `预览服务已经在跑：…` → 记下 `http://127.0.0.1:5123`
- 启动失败（端口被占、报错）→ 换端口 `--port 5124` 再试，仍不行就先修这个，别往下走

**拿到地址之后，一次性把两件事问掉：**

> 1. （新项目才问）这个项目想用什么画风：黑白网点 / 彩色 / 线稿？画布用 768×1280 还是别的（16 的倍数）？
> 2. 怎么开始：**我直接开始构思**，还是**你先在网页里看看、自己排**？

- 他选「我先看看」→ 跑 `node manga.mjs open` 把浏览器打开，然后**停在这里等他回话**，
  不要自己开始想分镜，也不要偷偷建项目
- 他选「直接构思」→ 进第 1 步

**没得到回答就停住——不要建项目、不要写页面、不要开始想分镜。**

画布尺寸怎么挑见 `TECHNIQUES.md`「尺寸」。

### 第 1 步：构思

定人物、场景、这页要推进什么。先把「分几格、每格画什么、谁说什么」写成一句话清单**给用户确认**，
别直接开画。分镜怎么排见 `TECHNIQUES.md`「版式」「节奏」。

### 第 2–3 步：建项目和页

```bash
node manga.mjs project new --name "项目名" --canvas 768x1280   # 本项目第一次画时
node manga.mjs page new --title "第 1 页"
```

画风是项目级默认值，建项目时带过去，之后每页仍可单独改。`page new` 默认给**一个占满整页的框**；
要重排就先清掉它，别在它上面叠。

### 第 4 步：写页面 JSON

直接改 `data/projects/<slug>/pages/pNN.json`。

- **字段、可用值、坐标** → `FORMAT.md`
- **`scene` / `desc` / 气泡怎么写、版式怎么排** → `TECHNIQUES.md`
- **成人向页面** → 再读 `R18-MANGA.md`
- 每个格子都写**中文 `note`**（一句话说明这格在干什么）。它不进提示词，只给人看，
  写法和理由见 `TECHNIQUES.md`「中文备注」

### 第 5 步：校验

```bash
node manga.mjs compile --page 1
```

有 `error` 就不能渲染（空描述、越界、类型不认识都会报）。规则见 `FORMAT.md`「校验不变量」。

### 第 6 步：出图

```bash
node manga.mjs render --page 1
```

### 第 7 步：让用户在网页里看

**优先说「网页里可以看了」**，把地址发给他：`http://127.0.0.1:5123`。不要只丢一个图片路径。

- 网页会自己跟上：你改完页面、出完图，页面内容、历史、左栏缩略图都会**自动刷新**，
  没有「刷新」按钮。用户手上正有未保存的改动时，会等他那次保存落盘后再刷新
- 网页里的「生成」是**排队**执行的（并发 1，按提交顺序跑）：点完提示已提交，右上角「任务」
  浮窗里能看到排队 / 进行中 / 结果 / 失败原因，切页继续点也不会丢
- **你用 CLI 出的图也会出现在这个浮窗里**（标「外部」），用户不用猜后台发生了什么
- 想帮他直接打开：`node manga.mjs open`
- 图片文件路径当备选提一句就够（`data/projects/<slug>/images/<sha>.png`）
- 他可以在网页里自己拖版面、改台词、切历史版本，改完存回页面 JSON，你再去读

出图一页 30–40 秒是正常的；同一页连续渲染各存一版历史、不覆盖。

## 5. 出图之后

### 用户提意见时

1. **先读页面文件**（`data/projects/<slug>/pages/pNN.json`），不要看 diff、不要用 `changes` / `ack`——那两个是给网页「变更」页签用的。
2. 想让用户看懂改了哪儿，先改中文 `note`，再改英文 `desc`。
3. 改完重新 `render --page 1`。用户开着网页不用管，服务器盯着存档目录会自动刷新。

### 修图还是重画

```bash
node manga.mjs edit --page 1 --prompt "把左上角气泡的尾巴删掉"
```

**编辑模型只做「不改大布局」的小修**（气泡尾巴、多一根手指、糊掉的台词、删掉画面里某个物体、
整页从彩色转黑白）。改机位、换人、改分镜一律重新 `render`。
**修图用当前采用的版本**：渲染版、修图版都能改，但尽量从渲染版改——连续在修图版上改，
版式和画质会慢慢偏移。一次要改好几处，就把要求全写进同一句。
完整判断表见 `TECHNIQUES.md`「修图还是重画」。
`doctor` 里「修图：」是空的 = 没配编辑工作流，直接说没这个能力，别假装能修。

## 6. 常用命令

```bash
node manga.mjs doctor                                # 检查配置与 ComfyUI 连通性
node manga.mjs project list
node manga.mjs page list
node manga.mjs page show --page 1 --summary          # 紧凑大纲，给 AI 看用这个
node manga.mjs compile --page 1                      # 只编译，不出图
node manga.mjs render --page 1 [--seed 42]
node manga.mjs edit --page 1 --prompt "…"            # 修图
node manga.mjs page set --page 1 --file patch.json   # 只改一条
node manga.mjs serve [--port 5123]                   # 幂等：在跑就只回报地址
node manga.mjs open  [--port 5123]                   # 在浏览器里打开预览
node manga.mjs stop
```

参数细节、`--json`、退出码：`CLI.md`。

## 7. 出问题去哪查

| 症状 | 去哪 |
| --- | --- |
| `compile` 报 `error` | 报错文字本身 + `FORMAT.md`「校验不变量」 |
| 画面不对：多一个人、格位错、尾巴指错人、人物跨格 | `TECHNIQUES.md`「排查」 |
| 字糊了、竖排乱码、气泡位置不对 | `TECHNIQUES.md`「文字」 |
| 版式没想法，或者画出来很平庸 | `TECHNIQUES.md`「版式」「节奏」 |
| 成人向画面怎么排、tag 怎么写 | `R18-MANGA.md` |
| 连不上 ComfyUI、渲染报错 | `CLI.md`「doctor」+ `WORKFLOW.md`「报错对照」 |
| 没装好 | `INSTALL.md` |
