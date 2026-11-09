# CLI 参考

入口：`node scripts/manga.mjs <命令> [参数]`。所有命令支持 `--json`，失败时退出码非零。

全局参数：

| 参数 | 作用 |
|---|---|
| `--config <路径>` | 配置根，默认 `config/`（或环境变量 `MOSS_CONFIG`）；只管 `config.json` 与工作流，方言固定是仓库里的 `config/manga.mjs` |
| `--dir <路径>` | 存档目录，默认 `config/archive`（或 `config.archive` / `MOSS_ARCHIVE`） |
| `--project <slug>` | 项目；只有一个项目时可省略 |
| `--json` | 输出结构化 JSON |

---

## doctor

```bash
manga doctor [--json]
```

```json
{
  "configured": true,
  "archive": "C:\\Users\\me\\.moss-manga",
  "comfy": { "url": "http://127.0.0.1:8188", "reachable": true, "version": "0.3.x", "checkpoints": 14, "loras": 30 },
  "workflow": { "name": "default.json", "ok": true, "params": ["prompt", "seed", "width", "height", "steps", "cfg", "ckpt"] },
  "edit": { "name": "edit.json", "ok": true, "params": ["image", "prompt"], "missing": [] },
  "ckpt": "moss_v1.safetensors",
  "projects": 2,
  "problems": []
}
```

`configured` 为 false 时看 `problems`，一条一条解决。`edit` 是修图工作流：没配就一直是 `{"name": ""}`，不算问题；配了但文件缺失或缺 `{{prompt}}`/`{{image}}` 才算问题。

---

## init / config / workflow

```bash
manga init [--comfy URL] [--ckpt 文件名] [--workflow 文件] [--archive 路径]
manga config get [点号路径]
manga config set 键=值 [键=值...]
manga workflow path                    # 打印配置根与工作流目录
manga workflow save <文件> [--name default.json] [--no-activate]
manga workflow check [--name default.json]
manga workflow list
manga workflow show [--name default.json]
```

`workflow save` 只做两件事：校验是 API 格式、复制到 `config/workflows/<name>`，然后报告占位符情况。**它不改你的文件**——`{{prompt}}` / `{{width}}` / `{{height}}` 这些由调用方（AI）读懂 JSON 后自己写进文件。保存后默认把它设为当前生图工作流；加 `--no-activate` 只存不切（导修图工作流时必须加）。

`workflow check` 的输出：

```json
{
  "ok": false,
  "nodeCount": 7,
  "params": [{ "name": "prompt", "count": 1, "type": "string" }, { "name": "width", "count": 1, "type": "number" }],
  "missing": ["height"],
  "warnings": ["没有 {{height}}：尺寸由工作流写死，改不了画布"]
}
```

`ok: false` 不阻止保存，但 `doctor` 会把它列为问题。带 `{{image}}` 的工作流会被认作**修图工作流**，只要求 `{{prompt}}` + `{{image}}`（尺寸、步数、模型都在工作流里），`missing` 也只列这两个。

`config set` 的值会先尝试当 JSON 解析，所以 `editable.layout=true` 是布尔、`defaults.steps=30` 是数字。

常用键：

| 键 | 含义 |
|---|---|
| `archive` | 存档路径（留空 = `config/archive`） |
| `comfy.url` | ComfyUI 地址 |
| `comfy.timeoutMs` | 单张超时 |
| `defaults.ckpt` | 检查点文件名（只有工作流里写了 `{{ckpt}}` 才需要） |
| `defaults.steps` `defaults.cfg` `defaults.sampler` `defaults.scheduler` | 出图参数 |
| `defaults.negative` | 负面提示词 |
| `defaults.lora` | 默认 LoRA，形如 `<lora:名字:0.7>` |
| `workflow.name` | 当前生图工作流文件名 |
| `edit.name` | 修图工作流文件名（留空 = 不修图，网页不显示修图按钮） |
| `editable.layout` `editable.text` `editable.bubbleType` `editable.style` | Agent 能不能改这些 |
| `editable.params.seed` 等 | Agent 能不能改这些参数 |

---

## project

```bash
manga project new --name "雨中的便利店" [--canvas 768x1280]
manga project list
manga project show [--project slug]
manga project delete [--project slug]
```

`project new` 返回 slug（ASCII，用于后续所有命令）。中文名只作显示。

---

## character

角色的外貌只写一次，存在 `project.json` 的 `characters` 里；页面上用 `{"type":"character","ref":"<id>"}` 引用。

```bash
manga character list [--project slug]
manga character add --id reina --name Reina --look "18, long straight black hair, red armband, NO glasses"
manga character set --id reina --look "18, long straight black hair, red armband, glasses"
manga character remove --id reina
```

- `--id` 只允许 ASCII，页面上用它
- `--look` 是英文外貌（发型、五官、服装、体型）；**不要写汉字名**，汉字会被模型画到画面上
- 角色格里的文案由你自己写在 `desc` 里；summary 末尾会自动追加 `CHARACTERS IN THIS PAGE:`，外貌只在那里面出现一次

页面上用 `page add-character` 加人（也可以走网页里的「本页角色」勾选）：

```bash
manga page add-character --page 12 --ref shion [--bbox 40,900,300,1240] [--desc "CHARACTER ONE - SHION, inside PANEL ONE only, kneeling"]
```

- 一次只加一个；同一角色同一页可以加多次（远景 + 特写）
- `--desc` 是这一格的完整画面（编号 + 名字 + 位置 + 姿势），不写就不出图；开头写 `!` = 这格跟角色表不同，该角色不进本页角色表

---

## page

```bash
manga page new [--title 标题] [--blank]   # 默认给一个整页框
manga page list
manga page show --page 3 [--summary]
manga page set  --page 3 --file patch.json
manga page set  --page 3 --patch '{"title":"车厢"}'
manga page set  --page 3 --file patch.json    # items 按 id 合并
manga page delete --page 3
```

`--page` 接受页码（`3`）或页面 id（`p03`）。

`--summary` 输出紧凑大纲（每格一行），不带 `--summary` 输出完整 JSON。**给 AI 看用 `--summary`**，省上下文。

补丁规则：

- `items` 里**带 `id` 的条目按 id 覆盖**，同 id 不会被复制；不带 `id` 的新增
- `removeItems: ["pn_a", …]` 按 id 删除
- 其余页面级字段直接覆盖（`id` 和 `rev` 不会变）
- 越权改动会报 `scope` 错误（能不能改由 `config.editable.*` 决定）：

```json
{ "ok": false, "code": "scope", "error": "这些改动超出了允许范围（版面）：~ 格 pn_a 位置 ..." }
```

---

## compile

```bash
manga compile --page 3 [--json]
```

输出 `json`（发给 ComfyUI 的单行 Moss JSON）、`warnings`、`stats`。不落盘。

---

## render

```bash
manga render --page 3 [--seed 123] [--steps 20] [--cfg 5] [--dry-run] [--json]
```

```json
{
  "ok": true,
  "image": "/media/rainy-konbini/<sha>.png",
  "file": "<sha>.png",
  "seed": 909507867,
  "ms": 16344,
  "warnings": []
}
```

- `--dry-run` 只返回「会发给 ComfyUI 的完整图」，不提交。
- 失败时 `{ "ok": false, "code": "render", "error": "..." }`。
- 同一页连续渲染会各存一版历史，不覆盖。
- 开着预览网页时，CLI 会**在开跑前先播报**（POST /api/tasks/external），所以网页浮窗里**一开始就能看到「生成中…」**（标「外部」），出完自动变「完成 · vXXX」并刷新对应页面。
  播报是尽力而为：服务器没开、端口不通都只是静默跳过，**不影响出图**。

---

## edit

用编辑模型改**已经出好的图**：拿这一页的渲染图当参考图，一句中文指令，结果存成新版本。

```bash
manga edit --page 5 --prompt "把左上角气泡的尾巴删掉" [--dry-run] [--json]
manga edit --page 5 --prompt "把框里的气泡改成浅蓝色" --overlay marks.png --marks @marks.json
```

网页里点「修图」会打开弹窗：上面选方框 / 圆圈 / 画笔，调粗细和颜色，在图上圈出要改的地方（可撤回），
下面写指令。不圈 = 整页都能改；圈了就把标记画进参考图，靠提示词约束模型只改那块。

```json
{
  "ok": true,
  "image": "/media/rainy-konbini/<sha>.png",
  "file": "<sha>.png",
  "base": "v024",
  "prompt": "在这张漫画里把左上角气泡的尾巴删掉。没提到的部分保持原样：…",
  "ms": 32400,
  "version": { "id": "v074", "kind": "edit", "base": "v024" }
}
```

- 前提：`config.edit.name` 指向一份编辑工作流（见 `WORKFLOW.md` 的「修图工作流」，占位符由 `workflow check` 检查）；缺占位符时 `edit` 会直接拒绝，不是提醒。
- 只做**不改大布局**的修改：气泡尾巴、多余的手指、糊掉的台词、删掉画面里某个物体、整页转黑白。改机位、换人、改分镜属于重新 `render`。
- **多个改动写进同一句**：分两次修等于第二次拿改过的图再改，版式和画质会越修越偏。
- **参考图是「当前采用的版本」**：渲染版、修图版都行。尽量从渲染版开始，连续在修图版上编辑会让版式和画质慢慢偏移。
- `--overlay <png>`：直接用一张画好标记的整页图当参考图（网页弹窗就是这么提交的），涂鸦图会一起存进存档。
- `--marks`：标记清单，如 `'[{"tool":"rect","color":"red"}]'`（`tool` = `rect`/`ellipse`/`brush`，`color` = `config/manga.mjs` 里 `EDIT.swatches` 的 `value`）。
  Windows 下引号容易被吃掉，写成 `--marks @marks.json` 从文件读。
- `--dry-run` 打印最终整句提示词和填好的图，不提交。
- 失败时 `{ "ok": false, "code": "edit", "error": "..." }`。

---

## changes / ack（人类用，Agent 不用）

```bash
manga changes [--since 12] [--json]
manga ack
```

```json
{
  "ok": true,
  "since": 12, "to": 15, "acked": 12,
  "pages": [
    {
      "project": "rainy-konbini", "page": "p01", "index": 1, "rev": 15, "warnings": 2,
      "ops": [
        { "op": "bbox", "target": "panel", "id": "pn_a", "from": [8,8,760,400], "to": [8,8,760,424] },
        { "op": "text", "target": "bubble", "id": "bb_c", "from": "旧台词", "to": "新台词" }
      ]
    }
  ]
}
```

**Agent 不要用这两个命令**：直接读 `data/projects/<slug>/pages/pNN.json` 即可，源文件信息量更大。这两个是给网页端「变更」页签用的。`--since` 不传就用上次 `ack` 的位置。`op` 取值：`create` `add` `remove` `bbox` `text` `field` `page`。

网页端看完「变更」页签会自己 ack；Agent 不需要这套流程。

---

## serve / stop / open

```bash
manga serve [--port 5123] [--open]
manga stop
manga open [--port 5123]
```

`serve` 是后台进程（pid 写在 `data/server.pid`），不占前台，**幂等**：已经在跑时不会再起一个，
只回报地址（`预览服务已经在跑：http://127.0.0.1:5123`）。所以「检查有没有启动」不需要别的命令，直接跑 `serve` 就行。

`open` 只是把浏览器打开到该地址，不启动服务。`stop` 按端口找进程，`start.bat`、`serve` 起的都能关。

服务器自己还会写 `data/server.json`（`{ url, port, pid }`）：CLI 出图时靠它找到预览服务并播报进度
（`MOSS_SERVER` 环境变量可以覆盖地址）。排查时可以 `MOSS_NO_WATCH=1 node server.mjs` 关掉文件监听——
此时网页只靠「任务事件 + 5 秒轮询」刷新。

默认端口 5123，占用时换 `--port`。地址固定是 `http://127.0.0.1:<port>`。

---

## 退出码

| 码 | 含义 |
|---|---|
| 0 | 成功 |
| 1 | 业务错误（看 `error`） |
| 2 | 命令不存在（打印帮助） |

## 自定义占位符（任意）

工作流里的 `{{名字}}` 是**任意**的，没有白名单。除了内置那批（prompt/width/height/seed/image/steps/cfg/sampler/scheduler/ckpt/negative/denoise/lora_name/lora_strength/batch_size），你自己加的键会从 `config.params` 取值：

```bash
manga config set 'params.lora_data=<lora:moss\xxx:0.8>'
```

渲染时把它填进工作流。没配值又用了占位符，才会报「未提供的占位符」。