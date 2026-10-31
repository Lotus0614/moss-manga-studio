# 存档格式

**这份文档只讲「文件长什么样」**：目录、每个文件的字段、字段能填哪些值、坐标与尺寸规则。
「怎么写才画得对」不在这里——那是 `TECHNIQUES.md` 的事，成人向见 `R18-MANGA.md`。

配置和存档是两棵树：配置（含工作流）在配置根，存档只放项目数据。

```
config  默认 config/（MOSS_CONFIG 可覆盖）
├── config.json                 # ComfyUI 地址、当前工作流、出图参数
├── manga.mjs                   # 漫画方言：词表、字段、类型、句式
└── workflows/                  # ComfyUI 工作流（全局，跟存档无关）

data    默认 config/archive（config.archive 或 --dir 可改）
├── state.json  journal.jsonl
└── projects/<slug>/
    ├── project.json            # 项目 + 人物设定 + 页序
    ├── pages/p01.json          # 一页一个文件
    ├── versions.json           # 渲染历史
    ├── versions/<id>.json      # 该次渲染喂进去的 Moss JSON（只读）
    └── images/<sha256>.png
```

MOSS 原生格式的完整字段白名单、`canvas` / `tags` / `palette` 用法见 `references/MOSSS_LAYOUT.md`。

---

## 1. project.json

```jsonc
{
    "id": "proj-muct8m",
    "slug": "proj-muct8m",        // 目录名，ASCII
    "name": "推しが、家にいる",     // 只作显示
    "size": "page",               // 画布档位：page | page-hd | square | wide
    "canvas": [896, 1152],        // 实际像素，16 的倍数；新页继承它
    "defaults": { "style": "mono", "vertical": true },
    "characters": [               // 角色表，跨页一致的外貌只写这一次
        { "id": "mio", "name": "CHARACTER ONE - MIO", "look": "…" }
    ],
    "pages": ["p01", "p02"],      // 页序，决定 page list 的顺序
    "createdAt": "2026-10-24T20:18:24.646Z",
}
```

### characters[]（角色表）

| 字段 | 值 |
| --- | --- |
| `id` | ASCII，页面里用 `ref` 引用它 |
| `name` | **必须写成 `CHARACTER ONE - MIO`**：`角色 N - 名字`，编译器靠这个格式把它拼进 summary 的角色表 |
| `look` | 英文外貌（年龄、发型、五官、服装、体型）。**不要写汉字名**——汉字会被模型当成要渲染的字画到画面上 |

改角色表用 CLI 或网页顶栏「角色表」，别手改 `project.json`：

```bash
node manga.mjs character add --id mio --name "CHARACTER ONE - MIO" --look "24, long silver-grey hair, plain black dress"
node manga.mjs character set --id mio --look "…"
node manga.mjs character list
```

---

## 2. page.json

页面只有一个数组 `items`：所有元素放一起，用 `type` 区分。

```jsonc
{
    "id": "p01",
    "index": 1,
    "title": "车厢",
    "rev": 7,
    "version": 2,          // 存档格式版本，v2 起「画面描述」叫 desc
    "size": [768, 1280],   // 本页画布，16 的倍数
    "style": "mono",       // mono | color | sketch
    "vertical": true,      // 全局竖排；单条 bubble 可用自己的 vertical 覆盖
    "scene": "",           // 整页场景与版式，写法见 TECHNIQUES「页面提示词的结构」
    "note": "",            // 整页备注，只给人看，不进 summary（和 item 的 note 一个意思）
    "summaryMeta": [],     // summary.meta，留空 = 用画风自带的
    "summaryCaption": "",  // ⚠️ 整段覆盖，填了格数/文字锁/角色表全部失效。留空
    "items": [],
}
```

### 2.1 页面字段

| 字段 | 类型 | 值 / 说明 |
| --- | --- | --- |
| `style` | enum | `mono` 黑白网点、`color` 彩色、`sketch` 线稿。整页总基调，写在 summary 开头 |
| `vertical` | bool | 全局文字竖排，默认 `true` |
| `scene` | longtext | 整页场景 + 版式。**这是剧情和构图唯一的入口**，格式见 TECHNIQUES |
| `note` | longtext | 整页备注，**只给人看，不进提示词**（和 item 的 note 一样） |
| `summaryMeta` | tags | `summary.meta`，留空 = 用画风自带的 `meta` |
| `summaryCaption` | longtext | **整段覆盖**。填了它，`scene`、格数、文字锁、角色表全都不进提示词。**保持空** |

### 2.2 items 一览

| `type` | 是什么 | 专有字段 |
| --- | --- | --- |
| `panel` | 一个分格 | `bbox` `desc` `shape` `frame` `camera` |
| `character` | 一个指定位置的人物 | `bbox` `ref` `desc` |
| `bubble` | 一条文字 | `bbox` `text` `kind` `desc` `vertical` |
| `native` | 原生 Moss item，绕过语义层 | `bbox` `label` `text` `caption` |

四条共用的字段：

| 字段 | 作用 |
| --- | --- |
| `note` | 备注，**写中文**，只给人看，**不进提示词**（画布上优先显示它） |
| `caption` | **整段覆盖**：留空就按类型自动拼，填了就只用这段，其余字段不再进提示词 |
| `tags` | 透传进 Moss JSON，也当分类用 |
| `palette` | 透传进 Moss JSON，`#RRGGBB` 数组 |

`id` 稳定：改内容不要换 `id`，否则 journal 会记成「删了又加」。

### 2.3 一个最小的页面

```jsonc
{
    "type": "panel", "id": "pn_a", "bbox": [8, 8, 760, 424],
    "shape": "rect", "frame": "border", "camera": "wide",
    "desc": "PANEL ONE, top band across the full width — a crowded platform, grey silhouettes",
    "note": "第一格：交代站台和人群",
}
```

---

## 3. panel

| 字段 | 值 |
| --- | --- |
| `bbox` | `[x1,y1,x2,y2]`，左上原点、绝对像素、整数 |
| `shape` | `rect` 矩形 / `slant-top` 斜切上边 / `slant-side` 斜切侧边 / `bleed-top` `bleed-bottom` `bleed-left` `bleed-right` 出血 / `bleed-all` 满版 / `circle` 圆形 |
| `frame` | `border` 描边（默认）/ `none` 无边 / `thick` 粗边。**出血形状自动丢掉边框**，写了也没用 |
| `camera` | `eye` 平视 / `high` 俯视 / `low` 仰视 / `wide` 全景 / `medium` 中景 / `close` 特写 / `xclose` 大特写 / `ots` 过肩 / `dutch` 荷兰角 |
| `desc` | 必填。这一格**看得见什么**，开头自己写 `PANEL 编号` |

编译产物 = 形状 + 边框 + 机位 + `desc` + 收尾约束，用逗号连起来。`shape`/`frame`/`camera`
只是替你拼那句英文，具体措辞在 `config/manga.mjs`。

**`desc` 的推荐写法**：

```
PANEL ONE, the tall panel across the FULL WIDTH at the TOP — a dark study at night…
PANEL TWO, the RIGHT panel of the middle row, to the RIGHT of PANEL THREE — close up of her face…
```

- 编号写英文单词，**一页之内连续、不重复**
- 编号后面接方位与横竖，最后才写画面
- 编号怎么排、方位怎么描述、破框怎么写、两人同框怎么拆 → `TECHNIQUES.md`「编号与方位」
- 特写格、双人框、并排格的对齐 → `TECHNIQUES.md`「多格页面的硬规则」和「排查」

出血格（`bleed-*`）可以超出画布；其它形状超出只会被裁，并在 `compile` 时报警告。

---

## 4. character

| 字段 | 值 |
| --- | --- |
| `bbox` | 同上 |
| `ref` | 必填，项目 `characters[].id` |
| `desc` | 必填，这一格的完整画面：`编号 + 名字 + 位置 + 姿势`。开头写 `!` = 这格跟角色表不同（裸体、受伤、换装），该角色不进本页角色表 |

编译产物**就是 `desc` 原文**（去掉开头的 `!`、补一个句号），再加收尾的画风约束。
没有编号补全、没有位置推断、没有外貌注入。

```jsonc
{ "type": "character", "id": "c1", "ref": "shion", "bbox": [560, 900, 740, 1200],
  "desc": "CHARACTER ONE - SHION, inside PANEL ONE only, filling the CENTRE of PANEL ONE, kneeling, upper body turned to the side" }
```

- **外貌不写在格子里**，只在角色表里。summary 末尾的 `CHARACTERS IN THIS PAGE` 会自动带上（开头带 `!` 的格子不进）
- 名字用罗马音；台词里叫名字用中文
- 同一个角色一页出现两次 → 放两个 character 项，各自写 `inside PANEL ONE only`

---

## 5. bubble

| 字段 | 值 |
| --- | --- |
| `bbox` | 同上。气泡要做成**窄而高**，尺寸和字号见 `TECHNIQUES.md`「文字」 |
| `kind` | 见下表，默认 `speech` |
| `text` | 要渲染的字，原样。换行用 `\n` |
| `desc` | **位置 + 说话人**，自己写 |
| `vertical` | 不写就跟随页面 `vertical`；写 `true`/`false` 单独覆盖（不在表单里，手写页面才用） |

### kind 可用值

| 值 | 界面名 | 拼进去的措辞 | 什么时候用 |
| --- | --- | --- | --- |
| `speech` | 对话 | white oval speech bubble, thin black outline | 默认 |
| `speech-notail` | 对话·无指向 | …no tail, no point, round bubbles | **说话人不在画面里**（POV、画外音） |
| `shout` | 喊叫 | jagged spiky speech bubble | 2–6 字的短促喊叫 |
| `whisper` | 小声 | small round white speech bubble, tail of tiny circles | 耳语、不敢出声 |
| `tremble` | 颤抖 | white speech bubble with a shaky wavy outline | 哭腔、发抖 |
| `thought` | 内心 | white cloud-shaped thought bubble, scalloped edge | 内心独白（要有虚线小圆指向本人，见 TECHNIQUES） |
| `heart` | 心之声 | speech bubble with a dashed outline | 心动、撒娇的声音 |
| `narration` | 旁白·白框 | narration in a plain white rectangular box with a thin black border | 描述性旁白，压在复杂画面上也能读清 |
| `narration-bare` | 旁白·裸字 | narration printed directly on the artwork, no box, thin white outline | 无框旁白，靠白色描边浮起来 |
| `sfx` | 拟声词 | hand-lettered sound effect, bold brush strokes, no bubble | 拟声词，字号调大 |

**气泡没有「尾巴方向」字段**：形态只由 `kind` 决定，谁说的写进 `desc`。

### `desc` 的推荐写法

```
in the TOP LEFT of PANEL ONE, SPOKEN BY CHARACTER ONE - SHION
in the LOWER RIGHT of PANEL ONE, between PANEL ONE and PANEL THREE, SPOKEN BY CHARACTER TWO - TOUMA
in the LEFT EDGE of PANEL TWO. It is the narrator, not a character speaking.
laid over the CENTRE of PANEL ONE          ← 拟声词只写位置
```

不要重复气泡形状（`kind` 已经给了），`desc` 只回答两件事：**在哪**、**谁说的**。
尾巴指错人怎么救 → `TECHNIQUES.md`「文字」。

### 竖排的限制

- 竖排气泡和名牌里**数字写汉字**：`720日元` → `七百二十日元`。阿拉伯数字在竖排里会叠成乱码
- 人名中间**不留半角空格**：`白石 凛` 的空格会被画成圆圈 `O`，写 `白石凛`
- 屏幕、书页等画面内的横排文字照常写阿拉伯数字

---

## 6. native

语义层覆盖不到时的逃生口，直接把字段写进 Moss JSON：

| 字段 | 值 |
| --- | --- |
| `label` | `object` / `text` / `character` |
| `text` | `label: text` 时必填 |
| `caption` | 原样拼进产物 |

`native` 没有 `desc`——要写的内容直接放 `caption`。编辑器里它显示为虚线框。

---

## 7. tags / palette

两个可选字段，原样透传进 Moss JSON 的同名位置。

**tags**：只在这个元素容易被画错时写，3–6 个全小写英文短词，多词用下划线。

```jsonc
"tags": ["convenience_store", "fluorescent_light"]
```

text 项可以用它标文字性质（`ui_text`、`calligraphy`）。只标「这是什么」，不重复 `desc`。

**palette**：只在颜色是硬要求时写，`#RRGGBB` 3–5 个，按面积从大到小；文字项固定两个（文字色 + 底色）。

```jsonc
"palette": ["#1F3D2B", "#F2E8DA"]
```

普通题材省略。写了 palette 也仍要在 `desc` 里描述色彩关系。

---

## 8. 坐标

只有一套：**左上原点、绝对像素 `[x1,y1,x2,y2]`**。

- 整数，`x1 < x2`、`y1 < y2`
- 四边留 8–16px 安全边
- 中心原点 `yxyx` 的换算由编译器做，**不要手算**；换算公式见 `MOSSS_LAYOUT.md`

## 9. 尺寸

`size` 是 `[宽, 高]`，**都必须是 16 的倍数**（要保证 `W/2`、`H/2` 是整数）。

项目档位 `size`：`page` 768×1280 / `page-hd` 1152×1920 / `square` 1024×1024 / `wide` 1536×1024。
新建项目用 `--canvas` 直接给像素。**尺寸怎么挑见 `TECHNIQUES.md`「尺寸」**。

## 10. 校验不变量

`compile` 会拦下这些（`error` 就不能渲染）：

1. `bbox` 四个整数，`x1<x2`、`y1<y2`
2. `size` 是 16 的倍数
3. 页面 id 形如 `p01`，项目 slug 是 ASCII
4. 图片只增不改，文件名是内容 sha256
5. item 的 `id` 稳定，改内容不换 id
6. 类型必须在 `config/manga.mjs` 的 `TYPES` 里；`required` 字段不能空
7. 非出血形状不能越界（越界是警告，出血形状除外）

## 11. 编译产物

发给 ComfyUI 的顶层只有四个字段：

```jsonc
{ "summary": {...}, "items": [...], "bbox_coord_space": "abs_centralized", "bbox_format": "yxyx" }
```

`summary` 有 `meta` / `canvas` / `caption` 三个键；`width` / `height` 不进产物（只用于换算）。
`canvas` 由格数和文字数决定：多格或多条文字是 `multi_panel`，否则 `single`。

---

## 12. versions.json

```jsonc
{
    "currentByPage": { "p01": "v003" },
    "items": [
        { "id": "v003", "page": "p01", "image": "/media/<slug>/<sha>.png",
          "kind": "render", "seed": 909507867, "width": 768, "height": 1280,
          "steps": 11, "cfg": 2, "sampler": "euler", "scheduler": "sgm_uniform",
          "workflow": "moss-user.json", "ms": 18183 },

        { "id": "v004", "page": "p01", "image": "/media/<slug>/<sha>.png",
          "kind": "edit", "base": "v003",
          "editPrompt": "把左上角气泡的尾巴删掉", "prompt": "包好的整句…",
          "workflow": "edit.json", "ms": 32400 },
    ],
}
```

- `kind`：`render` 渲染 / `edit` 修图
- `base`：修图出发的那一版，可能是 `render` 也可能是 `edit`（界面上会推荐从渲染版改，连续编辑容易偏移）
- `overlay` + `marks`：修图时圈过区域才有——画好标记的整页图（存在 `images/`）和标记清单（`[{tool,color}]`）
- 历史只读。切 `currentByPage` 只影响预览用哪一版，改不动已生成的图
- `versions/<id>.json` 存着当次完整提示词（渲染是 `promptJson`，修图是 `editPrompt` + 包好的 `prompt`）

## 13. journal.jsonl

每次写入一行，`rev` 单调递增；网页「变更」页签就是按页聚合这些操作。
`op` 取值：`create` `add` `remove` `bbox` `text` `field` `page`。

---

## 14. 扩展：config/manga.mjs

方言全在一个文件里：词表、页面字段、item 类型、句子模板、`buildSummary`。
编译、校验、右栏表单、画布标签都直接 import 它。

```js
export const PAGE = [ … ];      // 页面字段
export const TYPES = [ … ];     // item 类型
export const SNIPPETS = { … };  // 句子模板
export function buildSummary({ page, items }) { … }
```

少了字段、枚举没选项、`default` 越界，`node tools/check.mjs` 会报出来。

### 14.1 词表

每张词表是数组，一项是 `{ value, label, phrase }`：

| 键 | 是什么 |
| --- | --- |
| `value` | 存进 page.json 的值 |
| `label` | 右栏下拉、画布标签上显示的字 |
| `phrase` | 拼进提示词的英文 |

```js
export const CAMERAS = [
  { value: 'eye', label: '平视', phrase: 'eye-level shot' },
  { value: 'high', label: '俯视', phrase: 'high-angle shot looking down' },
];
```

有的项多带自己专用的键，就写在那一项里：

- `STYLES`：`meta`（进 `summary.meta`）、`phrase`（summary 开头那一句，整页只写一次）
- `SHAPES`：`bleed: true`（可以超出画布，校验时不再报越界，且不拼边框）
- `BUBBLES`：只有 `value` / `label` / `phrase`，形态由 `kind` 决定

改措辞就改 `phrase`；加一个机位就在数组里加一项，下拉和提示词同时就有了。

### 14.2 字段

页面字段和 item 字段是同一种格式：

```js
{ key: 'camera', type: 'enum', label: '机位', options: CAMERAS, default: 'medium', canvas: true }
```

- `type`：`text` / `longtext` / `number` / `enum` / `bool` / `tags` / `palette` / `characterRef`
- `enum` 的 `options` 直接是数组，可以引用常量，也可以就地写
- `default`：新建 item 时的初值，必须出现在 `options` 里
- `required`：右栏表单标星
- `canvas: true`：这一项的值会出现在画布左上角的标签里
- `advanced: true`：右栏默认收进「高级选项」折叠块，只显示一行摘要；
  这一项本来就有值时会自动展开，收起时摘要上会写「已填 n」。
  `summary.meta` / `summary.caption` / `caption` / `tags` / `palette` 就是这么收起来的

### 14.3 类型

```js
{
  key: 'panel',          // 存进 page.json 的 type
  label: '面板',          // 按钮与右栏标题
  role: 'panel',         // 算作面板格数（只用来数，不参与编号）
  fields: [ … ],         // 右栏表单按这个生成；note/caption/tags/palette 从 BASE_FIELDS 继承
  compile({ item, page }) { … },   // 返回 { label, caption, text?, tags?, palette? }，bbox 由核心补
}
```

`compile` 只拿到 `{ item, page }`；同文件里的辅助函数只有 `textLayoutOf`（竖排/横排）和
`panelsOf`（数格数）。**编号、定位、九宫格一概不计算**——版式由作者写在 `desc` 里。

### 14.4 句子模板

`SNIPPETS` 里是整句模板，`{xxx}` 是占位符（`{n}` 面板数、`{panels}` / `{texts}` 数量、`{order}` 阅读顺序那句）。
改句子时保留占位符。改完这些句子，所有页面的 summary 都跟着变。

### 14.5 buildSummary

`items` 已经是编译后的 Moss item，返回 `{ meta, canvas, caption }`。`caption` 的拼装顺序：

1. **前半段**：填了 `page.summaryCaption` 就整段用它；没填就用自动骨架
   （画风 → 格数 → 文字锁 → `page.scene`；`page.note` 是备注，不进这里）
2. **后半段**：`<|character_list|>` 角色表，从本页 character 项按 `ref` 去重自动生成。
   手写 `summaryCaption` 时**整段覆盖，连角色表也不追加**

### 14.6 画布标签

画布左上角那行字由字段声明上的 `canvas: true` 决定，不写死在画布代码里：

```
面板3 · 中景 / 矩形
气泡 · 对话
```

规则：类型名开头（`panel` 带序号），只列 `canvas: true` 的字段，空值跳过，枚举取 `label`，
用 `·` 连类型和值、`/` 连多个值。
