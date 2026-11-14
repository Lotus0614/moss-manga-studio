# 漫画技巧

**「怎么画才对」的全集**：分镜、版式、提示词写法、出错怎么救。
格式与字段值查 `FORMAT.md`，命令查 `CLI.md`，成人向另读 `R18-MANGA.md`。

整理自 MOSS 官方《漫画生成技巧》，按本项目的能力做了调整，并补进了实画踩过的坑。

---

## 0. 一页的思考顺序

按这个顺序想，别跳步。跳步的典型后果是「格子排好了但没剧情」或「剧情想清楚了但画不出来」。

1. **这页推进什么**：一句剧情，必须有信息增量
2. **分几格**：一大配两三小，别铺满方块（见 §7）
3. **`scene` 写什么**：`<|background_setting|>` + `<|layout|>`（见 §3）
4. **每格 `desc` 写什么**：三段分工，一格一件事（见 §4）
5. **画出来不对**：先想「能不能加个格子钉住」，再想改词（见 §6、§14）

---

## 1. 尺寸

画布尺寸不固定，按用途挑；宽高都必须是 16 的倍数，换尺寸后坐标范围随之变化。

| 用途               | 尺寸                        | 面积           | 说明                       |
| ------------------ | --------------------------- | -------------- | -------------------------- |
| 快速试稿、单格少字 | 768 × 1280                  | 约 1.0MP       | 出图快，小字容易糊         |
| 常规连载页         | 1024 × 1536                 | 约 1.5MP       | 密排中文台词的起点         |
| 文字密集页         | 1152 × 1920                 | 约 2.2MP       | 一页十几条对白、要小字清晰 |
| 方图 / 横版        | 1024 × 1024 / 1536 × 1024 | 约 1.0 / 1.6MP | 单页插图、跨页             |

**字越多、字号越小，越要往上加分辨率**——低分辨率下 `text` 那层会被 VAE 解码糊掉。
四边留 8–16px 安全边，只有出血格向外越界。跨页时另开一页，不建议加长画布。

---

## 2. 阅读顺序与视线

固定 **右 → 左、上 → 下**：同一横带内先右后左，再往下。这句话 summary 会自动写入，不用手写。

排版时按这个顺序安排视线落点：右上第一格 → 同一横带往左 → 下一带。

**连续的两格优先上下排。**左右并排时模型有很高概率把先后画反，能用上下解决就别用左右。

---

## 3. 页面提示词的结构（`scene`）

`scene` 不是随手一段散文，而是**带结构标签的两段**。模型按标签读，缺一段等于没写。

```
<|background_setting|>
没有背景就直说：the whole page is plain white paper, no scenery, no walls, no floor.
有背景就写地点、时间、光。
<|/background_setting|>
<|layout|>
LAYOUT AND STORY: 每格一句话，只写「第几格、在页面什么位置、这一格是什么」。
<|/layout|>
```

角色表由编译器自动追加，**不要手写**：

```
<|character_list|>
CHARACTERS IN THIS PAGE (each one appears only inside its own box):
- CHARACTER ONE - RIN: …
- CHARACTER TWO - SOUTA: …
<|/character_list|>
```

要点：

- `layout` **只写位置和内容**，一句话一格：`PANEL ONE is the large panel across the TOP of the page which showing multiple views of CHARACTER ONE.`
  人物的姿势、衣服、表情**不在这里写**——那是 character 格子的事
- 不写 `SETTING:` / `LAYOUT:` / `STORY:` 三段式前缀（旧写法，已弃用），也不写阅读顺序、不写「谁是谁」的备注
- `summaryCaption` 留空。填了它，`layout`、角色表、text lock 全部失效

### 示例：一页两格，同格双视角

`proj-m45jin` 第 3 页。整页没有背景，上面一格放两个视角，下面一格是侧视，男人的上半身破格压到上一格。

```jsonc
// scene：两段标签，layout 里一格一句话
"scene": "<|background_setting|>no background at all — the whole page is plain
          white paper, no scenery, no walls, no floor.\n<|/background_setting|>\n
          <|layout|>\nLAYOUT AND STORY: PANEL ONE is the large panel across the TOP
          of the page which showing multiple views of CHARACTER ONE. PANEL TWO is
          the large panel across the BOTTOM of the page which showing a sex by
          CHARACTER ONE AND CHARACTER TWO.\n<|/layout|>"

// 面板：只写位置 + 是什么，短、上 tag
{ "type": "panel", "id": "pn_split", "bbox": [8, 8, 888, 748],
  "desc": "PANEL ONE, top large panel, 1girl, multiple views, showing two states
           of CHARACTER - RIN" }

{ "type": "panel", "id": "pn_act", "bbox": [8, 764, 884, 1128],
  "desc": "PANEL TWO, bottom large panel, sex, sex from behind, doggy style,
           side view, full body, 1girl 1boy, nude, motion lines,
           plain white background. the character breaks out of the PANEL TWO." }

// 人物：一个位置一个框。上一格的两个视角 = 两个框，不写 left / right
{ "type": "character", "id": "ch_face", "ref": "rin", "bbox": [472, 84, 872, 624],
  "desc": "close-up shot, focus on her face, ahegao, sweat, heavy breathing" }

{ "type": "character", "id": "ch_lower", "ref": "rin", "bbox": [68, 52, 636, 676],
  "desc": "close-up shot, focus on her pussy, cum in pussy, sweat, lower body" }

{ "type": "character", "id": "ch_act", "ref": "rin", "bbox": [24, 636, 736, 1128],
  "desc": "in the PANEL TWO" }

{ "type": "character", "id": "ch_souta", "ref": "souta", "bbox": [412, 548, 880, 1120],
  "desc": "in the PANEL TWO and broken out to the PANEL ONE" }
```

编译后的 summary 长这样——角色表是编译器加的，自动带着 `<|character_list|>`：

```
<|background_setting|>no background at all — …<|/background_setting|>
<|layout|>LAYOUT AND STORY: PANEL ONE is the large panel…<|/layout|>

<|character_list|>
CHARACTERS IN THIS PAGE (each one appears only inside its own box):
- CHARACTER ONE - RIN: …
- CHARACTER TWO - SOUTA: …
<|/character_list|>
```

注意三件事：

1. 两个视角靠 `bbox` 分左右，desc 里**不写 left / right**
2. 人物的 desc 可以短到 `in the PANEL TWO`——外貌在角色表里，姿势前面那个框已经给过
3. 破格只写 `broken out to the PANEL ONE`，越界多少由 `bbox` 决定

---

## 4. `desc` 三段分工

一页出问题，九成是这三段写重了。

| 写在 | 写什么 | 不要写 |
| --- | --- | --- |
| `panel.desc` | `PANEL n` + 方位 + **房间、道具、光、机位、danbooru tag** | 人物长相、衣服、表情（**特写格除外**：手、腕、皮肤这种没有 character 项的格子才写） |
| `character.desc` | 一句：`CHARACTER ONE - SHION, inside PANEL ONE only, 姿势` | 外貌（在角色表里）、解释句（「这是她唯一一次出现」会被画出来） |
| `bubble.desc` | 位置 + 谁说的：`in the TOP LEFT of PANEL ONE, SPOKEN BY CHARACTER TWO - TOUMA` | 不要重复气泡形状，`kind` 已经给了 |

三条硬规矩：

1. **同一个人只能在一处描述。**`panel.desc` 和 `character.desc` 各写一遍 → 模型画两份。
   （实画里出现过「一格画成三个人」「画出两个灰西装男」，都是这个原因。）
2. **文字里的方位必须和 `bbox` 一致。**desc 说 `at the LEFT`，bbox 就得在左半边。
3. **人物 `bbox` 收紧到 150–300px 宽**，别占满整格。占太宽，模型会往空处再塞一个人。

---

## 5. 编号与方位

编译器**不算版式**：不排面板名次、不判断文字落在哪一格、不描述九宫格方位。全写在 `desc` 里。

### 编号

- 编号必须有，写英文单词：`PANEL ONE`、`PANEL TWO`
- 一页之内**连续、不重复**；增删格子后自己重排
- 编号后面接方位与横竖，最后才写画面

```
PANEL ONE, the tall panel across the FULL WIDTH at the TOP of the page — a dark study at night…
PANEL TWO, the RIGHT panel of the middle row, to the RIGHT of PANEL THREE — close up of her face…
PANEL THREE, a small inset stuck onto the BOTTOM LEFT corner of PANEL ONE — the corridor outside…
```

### 方位

位置不套固定格式，`the tall panel across the full width`、`the RIGHT panel of the middle row`、
`a small inset stuck onto the TOP LEFT corner of PANEL ONE` 都行。但**第几格、在哪、和别的格什么关系**
要一眼读得出来。

左右并排的两格一定要写出「右格是谁、左格是谁」，只说内容模型很容易把先后画反。

### 多视角不要写 left / right

- 同一格里要放两个视角，不靠文字说左右，靠**两个 character 格子各自的位置**：一个框放左半边、一个框放右半边
- 写 `left` / `right` 反而容易和「并排两格的左右」「破格方向」打架，模型分不清你说的是格子里的左右还是页面上的左右
- 位置永远由 `bbox` 决定，文字只描述框里是什么

---

## 6. 先加格子，再改词

一页画不对，九成不是词不够，是**格子不够**。

- **人物一多就拆框**：画面里有两个以上的人、位置又固定，就给每个人一个 `character` 格子。
  加了之后 `panel` 的 desc 只写背景和大意，人物细节全部交给 character 格
- **`panel.desc` 尽量短**，能上 danbooru tag 就上 tag：`1girl 1boy, nude, doggy style, side view, motion lines`
- **画出来一直不对，先想「能不能加一个格子把它钉住」**，而不是把提示词写得更长更绕。
  长句里的从属关系模型读不懂，只会抓几个词乱放
- 同一个位置反复画错，就是少了格子，不是词不够

这条规律的另一面：**提示词写长 ≠ 画得准**。要控制的东西多到一个阈值以上，就该拆成第二个 `character` 项。

---

## 7. 版式

### 格子形态与用途

| 形态 | 值 | 用途 |
| --- | --- | --- |
| 矩形 | `rect` | 叙事主力 |
| 出血 | `bleed-*` | 冲击、满版。**人物顶到纸边**，自动没有边框 |
| 斜切 | `slant-top` `slant-side` | 速度、错落，一页一两处 |
| 圆形 | `circle` | 回忆、聚光、特写框 |
| 无边框 | `frame: none` | 画面自己分割，靠内容和留白分格 |

**不要铺满方块格子。**一页全是等大的矩形方块是最典型的平庸版式；要么大格子，要么小格子，
大小差要拉开，中间穿插一两条横带或斜切。

### 出血

出血格可以超出画布，人物顶满三边，是「一页一张大图」的主要手段。满版页用 `bleed-all`。

### 破框

**破框不是让人物冲到空白纸上**——那块白纸本来就没内容，冲上去等于白扔版面。

破框 = **人物压到相邻那一格**：把他的 `bbox` 越过自己格的格线 100–220px，伸进旁边那格的画面里，
`desc` 写 `broken out to the PANEL ONE` 之类的短语，模型就会把他的身体画在邻格之上、格线从他身后过。

前提：相邻那格是**同一个场景**。头发、腿、手臂、肩背都行。

```jsonc
// 上格 8–748，人物从 548 起 → 越过格线 216px，压进上一格
{ "type": "character", "id": "ch_souta", "ref": "souta", "bbox": [412, 548, 880, 1120],
  "desc": "in the PANEL TWO and broken out to the PANEL ONE" }
```

### 留白放标题

页面顶部或斜角留白处放一个 `native` 写标题字（`Ornate stylized manga title logo in bold typography`），
比让模型自己找地方塞字稳。

### 多格页面的硬规则

违反这几条时最典型的失败是「多画一颗头」和「人物跨格」：

1. **局部特写用原生项**：眼睛、嘴唇、手、衣褶、招牌这类放大格写成 `native`（`label: text` 或 `label: object`），
   `caption` 开头写 `Extreme close-up inset showing ONLY the …`。任何 `label: character` 的格子都会被当成
   「这里要画一个人」，特写格里就会长出多余的头
2. **两个人就两个框**：同格双人拆成两个 `character` 项，两个 `bbox` 的 X 之间留 30–140px 空档，
   `desc` 写 `standing far apart on opposite ends of the panel`；写进同一个框会画成肩贴肩
3. **并排小格对齐上边界**：左右并列的两格，`bbox` 的 `y1` 取同一个值，否则其中一格的人会半截身子跨进旁边那格
4. **小格用半身景别**：一页 6–7 格时，小格的 `desc` 写 `waist-up medium shot` 或 `thigh-up medium shot`，
   不要写 `full body`，否则人物被压成四头身
5. **人物占比要够**：主格人物顶满 70–90%，镜头贴在脸/上半身/局部。中远景全身只留给「交代地点」那一格

---

## 8. 节奏

1. **先排节奏再排内容**：格密节奏快，格疏节奏慢，一页留一两处停顿
2. **动线**靠人物视线、气泡位置、身体朝向牵引
3. **右侧写「发生」、左侧写「反应」**，符合日漫阅读习惯
4. **斜切与梯形只做点缀**，一页一两处
5. **不要惜字如金、不要打哑谜、不要文青病。**剧情必须靠旁白、对话、分镜交代清楚——
   要让第一次看这部漫画的人能读懂。「暗示」和「留白」在单页漫画里读不出来，那是连载长篇的特权
6. **每页必须有信息增量**：一页结束后，读者要知道的新事实至少一件。连续多页只重复同一个状态＝灌水

---

## 9. 语序：先光后物

文本编码器是单向的：**写在后面的词影响不到前面的词**。

同一段 `desc` 里，前面把光影和色温定死，后面的衣物、皮肤才会跟着变色。反过来先写
`white shirt`、末尾才补 `lit only by a green neon tube`，只有灯管会变绿，衬衫和脸还是暖白平光。

所以按这个顺序写：

1. **镜头与光**：`low-angle shot in a dim corridor, lit only by one cool green fluorescent tube`
2. **人物与环境**：谁、穿什么、房间长什么样
3. **动态与表情**：这一格在做什么
4. **收尾约束**：`no text other than the given lettering` 之类的否定句放最后

多角色同页还有一条连带效应：**第一段描述的角色会给后面所有人定调**（人种骨相、年龄感、整体色调）。
所以主角写第一段，第二个角色开头写反特征切断它：

```
In sharp contrast, the girl on the right has NO glasses and spotless skin with zero freckles.
```

页面的 `summary` 同理：画风 → 格数 → 文字锁 → `scene` → 角色表，顺序不要打乱。

---

## 10. 中文备注（`note`）

- 每个 item 的 `note` 写**中文**，一句话说清「这一格在干什么」：谁在做什么、这格的作用、关键道具
- `note` **不进提示词**，只给人看；画布上优先显示它。没有备注的格子会把英文提示词铺满，用户看不懂
- 用户提意见时，**先改 `note` 让人看懂，再改 `desc` 里的具体画面**
- 只有需要完全接管某一格的提示词时才填 `caption`（填了其他字段全部让位，边框和画风也得自己写清，见 `FORMAT.md`）

---

## 11. 人物一致性

只有主角需要跨页一致，所以**只给主角建角色表**（`manga character add`）；路人和背景人物
直接写在各自格子的 `desc` 里，不必建角色。

### 铁律：没写死的属性，每次都会被重掷

留自由度就是留不一致。查「同一个人画得不一样」，**第一步是把可变量列出来逐条写死，不是加形容词**。

- 没写瞳色 → 这次灰、下次蓝
- 只写 `long` 不写多长 → 一会儿齐肩一会儿及腰
- 衣服只写「灰色外套」不写开合与长度 → 版型每次不同

### 同一属性，tag 比长句可靠

模型是按 booru 词条聚权重的，长句里的度量它不读：

| 想表达 | 别写 | 写 |
| --- | --- | --- |
| 头发到腰 | `hair reaching the middle of her back` | `long hair` / `very long hair` |
| 齐肩短发 | `hair cut just below her ears` | `bob cut` |
| 眼睛颜色 | `her eyes were a cool grey` | `grey eyes` |
| 磨边裤脚 | `the hem was frayed and uneven` | `frayed hem` |

### 推荐写法：槽位 + tag 钉死

角色表（`look`）按身体部位分段，**每段一句定性 + 该部位的 tag**，只写看得见的东西：

```text
[age]-year-old woman.
Hair: long hair, straight hair, silver hair, blunt bangs - centre part, past the waist.
Eyes: narrow eyes, grey eyes, thin eyebrows.
Skin: pale skin, mole under eye.
Body: slim waist, large breasts, long legs.
Clothes: grey zip hoodie worn open (open hoodie), white ribbed camisole (white camisole),
         short denim shorts with a frayed hem (denim shorts, frayed hem). barefoot.
```

- **必写死**：头发长度与刘海（`long hair` / `very long hair` / `bob cut` / `blunt bangs`）、
  瞳色（`grey eyes`）、体型（`slim waist` / `large breasts` / `long legs`）、
  每件衣服的单品名与状态（`open hoodie` / `denim shorts` / `frayed hem` / `barefoot`）
- **加 1–2 个辨识标记**：痣（`mole under eye`）、`ahoge`、固定发饰、眼镜、耳环、疤痕。
  这是唯一能一眼认出「同一个人」的东西——**脸换个种子就变，痣和发饰不变**
- **纯 tag 最稳**，代价是体型会往词条的平均值靠（更 pin-up、更像设定图）。
  所以用上面的形式：tag 负责准，句子只做黏合
- **不写**：性格、气质、气味、他人评价（`her smile is professional and empty`、
  `she smells like cigarettes`）。它们占权重但不产生像素，还会把写死的细节挤淡。
  想表达性格就放进台词

**`Clothes` 这一行不进基础 `look`，写进变种。** 基础外貌只留 `Hair` / `Eyes` / `Skin` / 体型基准，
每套衣服（含裸体、制服、睡衣、小时候的衣服）建一个变种，角色框里选。
这样同一个人只有一份头发和五官，换装不会漂移。

分格复述：角色格子里的 `desc` 只写位置和姿势（`inside PANEL ONE only, kneeling`），
外貌不要重复——已经由角色表自动带进 summary 了。

### 发型：最稳的锚点（附词库）

衣服会换、表情会变、机位会换，**只有发型不变**——它是模型判断「这是同一个人」最稳的依据。所以：

1. `look` 里固定写 **2–3 个 tag**：长度 + 造型 + 一个癖性（刘海 / 呆毛 / 发饰），之后每页都用**同一串字面**。
   `ponytail` 写成 `side ponytail`、`twin braids` 写成 `braid`，在模型眼里就是换了个人。
2. 不在 `character.desc` 里重写发型（外貌只写一次）。这一格确实变了（湿发、被风吹乱、扎起来）才写；
   经常出现的发型变化（马尾/披发）就建一个变种，一次性特例用 `native` + `label: "character"` 的框自己写全。
3. 长发容易糊住画面：`hair behind ear`、`hair over shoulder`、`hair pulled back` 能保住脸又不挡动作。
   `hair up` 是**换发型**，不是「把头发撩起来」。
4. 遮脸 tag（`hair over eyes`、`hair over face`、`bangs pinned back`）只在特写里用，正脸格用了就认不出人。
5. 凌乱/汗湿用 `disheveled hair`、`hair undone`；一扎起来（`hair up`、`ponytail`）就是另一个角色了。

常用组合，照抄（除了词序不要改字面）：

| 人设 | `look` 里的发型串 |
| --- | --- |
| 黑长直 | `long straight hair, side blunt bangs, hair behind ear` |
| 高马尾、运动系 | `high ponytail, side swept bangs, sidelocks` |
| 双马尾 | `high twintails, air bangs, hair between eyes` |
| 披发 | `hair down, centre parting bangs, hair over shoulder` |
| 盘发 | `chignon, swept bangs, hair behind ear` |

#### 发型词库

完整的 131 个 tag（按用途分组 + A–Z 索引 + 别名对照）在 **`references/HAIR.md`**——要挑发型就去那儿翻，
常用的几组直接抄：

| 用途 | tag |
| --- | --- |
| 长度与基本形态 | `long hair` `medium hair` `short hair` `hair down` `hair up` `hair pulled back` `hime cut` |
| 马尾 / 双马尾 | `ponytail` `high ponytail` `side ponytail` `twintails` `high twintails` `pigtails` |
| 辫子 / 盘发 | `braid` `twin braids` `french braid` `hair bun` `double buns` `topknot` `chignon` `updo` |
| 刘海 | `bangs` `blunt bangs` `side swept bangs` `asymmetric bangs` `centre parting bangs` `air bangs` |
| 质感 | `straight hair` `wavy hair` `curly hair` `fluffy hair` `drill hair` `perm` `disheveled hair` |
| 鬓角与细节 | `sidelocks` `hair behind ear` `hair over shoulder` `ahoge` `hair between eyes` `stray hair` |

同一个造型在库里常有别名（`ponytail` / `pony tail`、`twin braids` / `twin drills`），
**一个人只准用一个写法**——别名混用是「同一个人画成两个」最常见的原因。

### 三条反直觉的经验

1. **否定服装描述会反效果。**写 `NO white collar`，模型会画出一个白领子。
   要排除某样东西，就**正面写它该是什么**（`plain black high-necked dress`），
   或者把区分特征塞进 character 格子正面描述。
2. **角色表的顺序会串味。**第一个被描述的角色给全场定调，后面的角色容易被画成它
   （实画里出现过「女仆装串到主角身上」）。把主角放第一段，其他人用 `In sharp contrast, …` 开头切断。
3. **名字只写罗马音。**提示词里的汉字会被模型当成「要画在画面上的字」（袖章、箱子上冒出来的那种）。
   但**对话台词里叫名字要用中文**——那是给人读的字。

### 控制不住的

| 想控制 | 结果 |
| --- | --- |
| 袖子挽到肘上（`sleeves rolled up`） | 无效，一律画成长袖 |
| 用 `oversized` 这类程度词控制版型 | 不稳，时准时不准 |
| 靠脸型或画风区分角色 | 无效，必须靠痣、发饰这类硬标记 |

同一张图反复不对，先怀疑「这个属性漏写了」，再去加形容词。见 §14「排查」。

---

## 12. 文字

### 台词

- 口语，允许省略号、心号、断句：「不行了……别再顶那里了……」
- 一句话交代信息，别怕长：「毛巾给我吧，头发这么湿，明天又要感冒了。」
- 情绪靠**标点**给，不靠形容词
- 一页 3–5 条，单条 15–25 字为宜

### 气泡的形状与大小

| 项 | 值 |
| --- | --- |
| 气泡 `bbox` | 宽 80–100、高 150–300，**窄而高**；横着铺会压到画面主体 |
| 对话框字号 | 14–16 |
| 旁白字号 | 13 |
| 拟声词字号 | 34–52 |

竖排是默认（页面 `vertical: true`），只有画面内的手机屏幕、书页才横排。
竖排里数字要写成汉字，见 `FORMAT.md`「竖排的限制」。

### 气泡位置与尾巴

**尾巴指错人是最高频的失败**，几乎都是这两件事之一：

1. **说话人不在画面里，却用了带尾巴的气泡。**模型会把尾巴连到最近的头上。
   → 画外音一律 `kind: speech-notail`（措辞里自带 `no tail, no point`），再在 `desc` 写清是谁在说
2. **气泡贴着别人的头。**气泡 `bbox` 离**其他人的头**至少 80px，自己的头 20–40px；
   贴太近等于给了模型一个假目标

心理活动还有第三条：**想事情的人必须在这一格里**。`thought` 气泡靠一串小圆点指向本人，
人不在画面里就没有目标，那串点是会连到别人的太阳穴上的。

### 拟声词是图形

`sfx` 不要当小字处理：字号 34–52，`bbox` 直接压在动作部位上，可以跨格、可以出血。
它是画面的一部分，不是文字排版的一部分。

### 画面里的文字

- 手机屏幕、书页 → 用 `native` 并写明 `HORIZONTAL lettering`
- 海报、招牌、传单 → 一律描述成 **blurred and unreadable, with NO text or lettering**。
  只要允许它「有字」，模型就会往上面糊一堆假字
- 海报上如果该有人物，写清 **EVERY photograph shows only her and nobody else**，
  否则会把主角旁边的角色甚至男主的脸混进去

---

## 13. 修图还是重画

配了编辑模型（`config.edit.name`）时，页面上的小毛病用 `manga edit` 解决，别整页重出。
**编辑模型是照着原图重画，只做「不改大布局」的修改**——动到构图就会把格线、气泡、台词一起带偏。

| 该修 | 不该修（重新 `render`） |
| --- | --- |
| 气泡尾巴指错人、多了条尾巴 | 改机位 / 视角 / 景别 |
| 手上多一根手指、多一只手 | 换人、换脸、换装成另一个人 |
| 台词糊了、写错了字 | 改分镜格数、挪格子、改构图 |
| 删除画面里某个物体 | 大改姿势、加一个角色 |
| 从彩色改成黑白 | 整页重画 |

```bash
node manga.mjs edit --page 1 --prompt "把左上角气泡的尾巴删掉"
```

- **一次把要改的都写进同一句**：多个毛病合在一次修图里说清（「删掉左上角气泡的尾巴，再把第三格那只多余的手去掉」）
- **能框就框**：网页点「修图」后用方框 / 圆圈 / 画笔在图上圈出要改的地方（可撤回），模型只改圈内；
  不圈等于整页都能动，容易顺手把别处也改了
- **尽量从渲染版改**：修图会把「当前采用的版本」当参考图（修图版也行），但在改过的图上接着改，
  格子线和画质会一点点漂；弹窗里会写「推荐使用 vXXX 进行编辑，多次编辑可能导致图像偏移」，照它选就对了
- 位置说准：「左上角的气泡」「第三格右边那只手」「第二格她的外套」
- 改歪了别硬修：历史里换回上一版，或者重新 `render`

---

## 14. 排查

画出来不对，按这张表倒着找原因。

| 症状 | 原因 | 怎么改 |
| --- | --- | --- |
| 一格画成三个人 / 多出一个人 | 同一个人写在 `panel.desc` 和 `character.desc` 两处 | 人物只留 character 框，panel 只写房间 |
| 人物半截身子跨进隔壁格 | 并排两格的 `y1` 不一样，或 bbox 超出自己的格 | 对齐 `y1`，收紧 bbox |
| 特写格里长出多余的头 | 放大格用了 `character` | 换成 `native` + `Extreme close-up inset showing ONLY …` |
| 气泡尾巴连到别人的头 | 气泡贴着别人头 / 说话人不在画面却用了带尾气泡 | 拉开 80px；画外音换 `speech-notail` |
| 内心气泡连到别人身上 | 想事情的人不在这一格 | 把本人的头放进这一格 |
| 服装串到别的角色身上 | 负面描述（`NO …`）反向生效，或角色表顺序串味 | 改成正面描述；区分特征写进 character 框 |
| 同一个人每次画出来都不一样（头发长短、瞳色变） | 角色表里没把该属性写死，或只用了模糊自然语言 | 按 §11 用 tag 写死，并加一个辨识标记 |
| 人物变四头身 | 小格写了 `full body` | 改 `waist-up medium shot` |
| 破框冲到空白纸上，版面浪费 | 破框方向没有邻格 | 改成压进相邻那一格（同场景） |
| 画面里冒出莫名其妙的英文/汉字 | `desc` 里有 meta 句子（「这是她的角色框」），或海报允许有字 | 删掉解释性文字；海报写 NO text or lettering |
| 提示词越写越长还是画不对 | 格子不够 | 加一个 character 框把位置钉住（§6） |
| 一张图反复出同一种错 | 种子／提示词里的从属关系被误读 | 先换 `--seed` 排除偶然，再按上表定位 |
| 文字糊、竖排乱码 | 分辨率不够，或竖排里写了阿拉伯数字 | 提高画布尺寸；数字改汉字 |

仍然找不到原因的，把 `node manga.mjs compile --page N` 的输出读一遍——实际发给模型的那段话
经常和你以为的完全不一样。
