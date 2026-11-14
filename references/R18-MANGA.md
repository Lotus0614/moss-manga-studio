# R18 漫画：分镜与提示词手册

这份是**成人向**页面的做法。通用格式看 `FORMAT.md`，通用版式看 `TECHNIQUES.md`。
这里只讲三件事：**一页怎么排、人物怎么摆、提示词怎么写**。

---

## 0. 三条总纲

1. **一页只说一件事。** 叙事页讲推进，高潮页讲状态。别在一页里又交代剧情、又换场景、又做两次。
2. **人物占画面。** 人物 70–90%，背景让位。只有「交代地点」的那一格画完整环境。
3. **先给脸，再给身体，最后给细节。** 读者视线是这么走的，格子顺序也按这个来。

---

## 1. 整页结构：三种页型

| 页型           | 结构                       | 用途                     |
| -------------- | -------------------------- | ------------------------ |
| **叙事页**     | 3–5 格横带式，一大配两三小 | 推进剧情、铺垫           |
| **高潮页**     | 1 满版 + 2–4 嵌格          | 正戏，最常用             |
| **满版单人页** | 1 张铺满 + 3–4 个剧情嵌格  | 人物海报式，信息靠嵌格给 |

**比例**：主格 50–65% 页高；注脚格 200–300px；一页最多一个大格。

**阅读顺序**：右 → 左、上 → 下。

- 同一行**先右格、后左格**
- **连续的两格优先上下排**——左右并排时模型有很高概率把先后画反

```jsonc
// 正确：横带，右格先
pn_a [8,8,888,380]      // 第一带
pn_b [460,396,888,700]  // 第二带右（先读）
pn_c [8,396,444,700]    // 第二带左（后读）
```

---

## 2. 格子形态：五种，各有各的用途

| 形态                 | 作用         | 提示词                                               |
| -------------------- | ------------ | ---------------------------------------------------- |
| 普通矩形             | 叙事主力     | `rectangular panel with straight edges`              |
| 出血 `bleed-*`       | 冲击、满版   | `panel bleeding off the edge of the page, no border` |
| 破框（人物越界）     | 情绪顶出来   | 见下                                                 |
| 无边框 `frame: none` | 画面自己分割 | `no border, artwork fills the panel edge to edge`    |
| 斜切 `slant-*`       | 速度、错落   | `panel with a slanted top edge cutting diagonally`   |

### 破框怎么写

破框 = **人物压到相邻那一格**，不是格子出血，也不是冲到空白纸上（那块纸本来就没内容）。
写成独立的 character 项，`bbox` 故意越过格线 100–220px：

```jsonc
{
    "type": "character",
    "ref": "rin",
    "bbox": [300, 176, 700, 812],   // 上格 176 起，这里的框压进上面那一格
    "desc": "CHARACTER ONE - RIN, inside PANEL TWO and broken out to the PANEL ONE, her hair and shoulder painted on top of the panel above",
}
```

一页 1–2 处就够，多了画面散。通用规则见 `TECHNIQUES.md`「破框」。

---

## 3. 嵌格：只用来讲**别的时空**

### 铁律

嵌格是**第二个时空的窗口**，不是放大镜。
大图里已经有的东西（器官、乳沟、手、大腿）**不要再开嵌格去特写**——那一格等于白占地方。

### 能放什么

| 类型      | 例子                                 | 剧情作用             |
| --------- | ------------------------------------ | -------------------- |
| 手机/屏幕 | 聊天记录、相册、新闻                 | 谁约的谁、外面的世界 |
| 别的房间  | 走廊里的他、门口的鞋                 | 时间差、偷窥感       |
| 事发前/后 | 白天她说「只看一眼」、事后留下的痕迹 | 对照、回味           |
| 旁观者    | 门缝里的眼睛、楼下的车               | 紧张感               |
| 地点全景  | 整栋公寓、雨夜街道                   | 交代环境             |

### 怎么写

```jsonc
{
    "type": "panel",
    "bbox": [624, 120, 880, 520],
    "frame": "thick",
    "desc": "a panel laid over the full-page artwork, with a thick white border and a soft drop shadow, its own scene: a dim apartment corridor at night, one door at the end with a thin strip of light under it, the boy standing in front of it, seen from down the corridor",
}
```

三个要点：

1. **`its own scene`** —— 明确「这是另一个画面」，否则模型会画成主图的局部
2. **`thick white border and a soft drop shadow`** —— 白边 + 投影，像贴纸，和主图分离
   （写进 `desc`；`frame: thick` 拼的是黑粗边，白边要自己描述）
3. **尺寸别小气**：256×350 起，可以更大；一格能放台词气泡，跟普通格一样

### 摆放

不要四个角各来一个。大小、高度、位置都要错开：

- 一个大（256×400）压在上半，一个窄长条挂在侧边
- 两个连续格**上下排**，构成“门把手 → 门开了”
- 一页 2–4 个，别超过 4 个

---

## 4. 同格双视角：一格里两个机位

一格里同时给「身体」和「脸」，信息量翻倍，还省一格。

```
shown in TWO views that share one single frame, no dividing line between them: the FIRST view is a close-up on her ahegao face; the SECOND view is a close-up on her crotch with the penis inserted, wet, dripping, no face in it. PLAIN DARK BACKGROUND with no background detail at all.
```

---

## 5. 构图：人物大、背景空

### 人物占比

- 主格：人物顶满，**70–90%**
- 镜头贴在脸/上半身/局部，不要中景全身
- 全身远景只出现在“交代地点”那一格

### 背景留白

人物格一律写：

```
PLAIN WHITE BACKGROUND with no background detail at all
```

一页只留**一格**画完整环境（房间、走廊、雨街），其余全空。这一格通常放在页顶，当锚点。

### 镜头

| 情形     | 写法                                                         |
| -------- | ------------------------------------------------------------ |
| 双人动作 | `camera: medium` + desc 里 `side view, full body`（两人都完整入画） |
| 单人表情 | `camera: close` + desc 里 `upper body`                        |
| 器官特写 | `camera: xclose` + desc 里 `no faces`                          |
| **不要** | 小格里用 `xclose`（376px 以下必糊成一团）                      |

一页最多一个 `xclose`。

**再加的 tag 和构图怎么对应**（词义见 §9.4）：

| 想要的效果   | 加什么 tag                                |
| ------------ | ----------------------------------------- |
| 更近、更压人 | `upper body`、`feet out of frame`         |
| 七分身       | `cowboy shot`（约等于我们的 `medium`）    |
| 低角度压迫感 | `from below`                              |
| 摇晃、不稳   | `dutch angle`                             |
| 逆光剪影     | `backlighting`、`see-through silhouette`  |

构图要更近，**直接用 `camera: xclose`**，别指望加个 `close-up` 的 tag 就能收到位。

---

## 6. 文字：竖排、小字、写满

| 项         | 值                                                                    |
| ---------- | --------------------------------------------------------------------- |
| 排版       | **全部竖排**（对话、旁白都是），只有画面里的手机/书页才横排           |
| 旁白       | 白底细框，竖排，贴画面边                                              |
| 字号       | 对话 14–16，旁白 13                                                   |
| 气泡       | 宽 80–100、高 150–300，**窄而高**，不要横着铺                         |
| 台词长度   | **15–25 字**，一页 3–5 条                                             |
| 拟声词     | 34–52 号，手写体，压在身体上，可出血                                  |
| 画面内文字 | 手机屏幕、书页 → 横排，用 `native text` 并写明 `HORIZONTAL lettering` |

### 台词怎么写

- 口语，允许省略号、心号、断句：「不行了……别再顶那里了……」
- 一句话交代信息，别怕长：「毛巾给我吧，头发这么湿，明天又要感冒了。」
- 情绪靠**标点**给，不靠形容词

### 拟声词是图形

`sfx` 不要当小字处理：`size: 40–52`，bbox 直接压在动作部位上，允许跨格。

---

## 7. 人物：外貌写一次，格子只写这一格

1. 角色写进项目（`name` 必须是 `角色 N - 名字` 格式，summary 角色表靠它解析）：

```bash
manga character add --id rin --name "CHARACTER ONE - RIN" --look "18, long straight black hair, large bust"
```

2. 页面上放一个 character 项，`desc` **自己写全**（编号 + 名字 + 位置 + 姿势），不写就不出图：

```jsonc
{ "type": "character", "ref": "rin", "bbox": [180, 160, 780, 1130],
  "desc": "CHARACTER ONE - RIN, inside PANEL ONE only, kneeling on the bed, back to the camera" }
```

3. **分工**：
    - `panel.desc` 只写场景、光、构图、机位、tag——**不写人物长相、衣服、表情**
    - `character.desc` 写位置 + 这一格的姿势与状态：背身、被遮挡、表情、动作
    - 整页裸体、受伤、换装：**优先建变种**（`manga character variant set --id rin --variant nude --look "completely naked"`），角色框选上它，外貌就由角色表带出来；只影响一个镜头的一次性特例，直接拉一个 `native` + `label: "character"` 的框，caption 里外貌自己写全

4. 名字**只写罗马音**。提示词里的汉字会被模型当成「要画在画面上的字」（袖章、箱子上冒出来的那种）。
   台词里叫名字仍用中文。

---

## 8. 性爱场景的动作编排

### 一页三个动作，别一页一个

前戏 → 正戏 → 变化（换体位/换地方）→ 反应特写。

### 体位词汇（直接写 tag，完整词库见 §9.4）

| 体位     | 打这些 tag                                        |
| -------- | ------------------------------------------------- |
| 正常位   | `missionary` ※                                    |
| 骑乘     | `cowgirl position` + `girl on top` + `straddling` |
| 反向骑乘 | `reverse cowgirl position` ※                      |
| 后入     | `sex from behind` + `doggystyle`                  |
| 站立     | `standing sex` + `leg up`                         |
| 压在床上 | `prone bone` ※ / `mating press` ※                 |
| 乳交     | `paizuri` + `breasts squeezed together`           |
| 口交     | `oral` + `fellatio`                               |
| 手 / 指  | `handjob` / `fingering`                           |
| 潮吹     | `female ejaculation` ※                            |
| 中出     | `creampie` + `cum in pussy` + `cum overflow` ※    |

再配 `uncensored` ※ `nude` `completely nude` 一起写。

### 每场戏要不一样

别让每场的流程重复（先口交后本番 ×4 最雷同）：换主导的人、换节奏、换事后反应，怎么排由剧情决定，不套固定模板。

### 体液与情绪

`sweat` `shiny skin` `saliva` `drooling` `tears` `blush` `heavy breathing` — 该加就加，
表情那层用 `ahegao` `tongue out` `half-closed eyes` `rolling eyes`，心号用 `heart-shaped pupils` ※。
但**一页只让一种情绪当主角**。

---

## 9. 词库：色情画面怎么打 tag

### 9.1 这批词哪来的

| 来源                          | 抽了 | 用途                   |
| ----------------------------- | ---- | ---------------------- |
| 随机提示词 · `category=一键模式` | 46 条 | 正戏 tag 的主词库      |
| 随机提示词 · `category=clothes`  | 8 条  | 服装 tag               |
| Danbooru Smart Tag Search      | 15 个概念 | 反查拿不准的 tag       |

下文每条都标了出处：

- **没标记** = 池子里真抽到过，可以直接用
- **`※`** = 检索器确认存在、词义也正确，但池子里没抽到 —— 第一次用先单独渲一张验一下

### 9.2 一条提示词的骨架

46 条的 tag 顺序大体就走这一条线（少数几条会从 `breasts` 或 `penis` 开头，但走向一样）：

| # | 放什么 | 例子                                                   |
| - | ------ | ------------------------------------------------------ |
| 1 | 人数   | `1girl` `1boy` `2girls` `multiple boys`                |
| 2 | 关系   | `hetero` `yuri` `solo` `solo focus` `faceless male`    |
| 3 | 动作   | `sex` `oral` `fellatio` `paizuri` `masturbation`       |
| 4 | 裸露   | `nude` `completely nude` `bottomless` `clothed sex`    |
| 5 | 身体   | `breasts` `large breasts` `navel` `stomach` `collarbone` |
| 6 | 表情   | `blush` `open mouth` `half-closed eyes` `tongue out`   |
| 7 | 体液   | `sweat` `saliva` `cum` `cum in pussy`                  |
| 8 | 机位   | `pov` `from below` `cowboy shot` `upper body`          |
| 9 | 背景   | `white background` `indoors` `on bed`                  |

拼起来就是一条能出图的完整提示词：

```text
1girl, 1boy, hetero, sex, vaginal, completely nude,
large breasts, navel, stomach, collarbone,
blush, half-closed eyes, open mouth, tongue out,
sweat, saliva, pussy juice, cum in pussy,
pov, from below, cowboy shot,
white background, simple background
```

**骨架上不要加别的东西。** 46 条里没有一条写「两个人在床上激烈地做爱」这种句子，也没有一条是纯自然语言。
色情画面用 tag 打；只有「谁对谁、因为什么」这类剧情信息才写成话——那是 `scene` 的活，不是格子的活。

### 9.3 四条容易踩的规则

**① 父子 tag 一起打。**
池子里 `vaginal` 从没单独出现过，永远是 `sex, vaginal`；口交永远是 `oral, fellatio`；
自慰是 `masturbation, female masturbation, fingering`。
父 tag 负责让模型进入「正在做这件事」的状态，子 tag 负责画对动作。只打子 tag 会画出像但不是的构图。

**② `solo` 和 `solo focus` 不是一回事，搞错了男主就没了。**

- `solo` = 画面里只有一个人
- `solo focus` = 画面里有两个人，但镜头只认女生

异性场景里几乎每条都带 `solo focus`，还常配 `faceless male`（男的露身体不露脸）。
这正是「男主在场但不抢戏」的标准解。**想拍他反应特写时才去掉。**

**③ `nsfw` 一次都没出现。**
46 条里既没有 `nsfw`，也没有 `masterpiece` / `best quality` / `absurdres`。
booru 系模型不吃这套，`sex` `pussy` `penis` 本身就是开关，别浪费字数。

**④ 一页只用一种写法。**
池子是空格 `large breasts`，Danbooru 原生是下划线 `large_breasts`，两种都能出图，
但**同一条提示词里只准用一种**，混着写模型会当成两个不同的词。

### 9.4 词库（按用途）

#### 正戏

| tag | 中文 | 搭配 |
| --- | --- | --- |
| `sex` + `vaginal` | 本番插入 | 必须成对出现 |
| `sex from behind` + `doggystyle` | 后入 | 加 `all fours` `bent over` `looking back` |
| `cowgirl position` + `girl on top` + `straddling` | 女上 | 三个一起打才稳 |
| `standing sex` | 站立 | 加 `standing` `leg up` |
| `oral` + `fellatio` | 口交 | 加 `licking penis` `testicles` `cum in mouth` |
| `paizuri` | 乳交 | 加 `breasts squeezed together` |
| `handjob` `double handjob` | 手交 | |
| `masturbation` + `female masturbation` + `fingering` | 自慰 | |
| `missionary` ※ | 正常位 | 池子里没抽到 |
| `cunnilingus` ※ | 舔 | 池子里没抽到 |
| `gangbang` `group sex` `multiple penises` | 多人 | 配 `3boys` `4boys` |

#### 身体

| tag | 中文 / 备注 |
| --- | --- |
| `breasts` + `small breasts` / `medium breasts` / `large breasts` / `huge breasts` | 先打 `breasts` 再打尺寸 |
| `navel` `stomach` `collarbone` `thighs` | **有躯干的格子必打**，不然会画成一整块板 |
| `cleavage` `underboob` `breasts out` `covered nipples` `bouncing breasts` `nipple tweak` `armpits` | 胸部状态 |
| `pussy` `anus` `puckered anus` `cleft of venus` `spread pussy` `presenting` | 局部 |
| `penis` `testicles` `erection` `veiny penis` `large penis` | 局部 |
| `flat chest` `curvy` ※ `plump` ※ `wide hips` ※ `thick thighs` | 体型 |
| `mole` `mole under eye` `mole on breast` | 痣——当固定人物特征用 |

#### 表情

| tag | 中文 / 备注 |
| --- | --- |
| `blush` `nose blush` | 脸红 |
| `open mouth` `closed mouth` `parted lips` | 嘴 |
| `tongue` `tongue out` `:o` `:d` `@_@` | 舌 / 表情符号，`:o` `:d` 高频有效，别怕 |
| `half-closed eyes` `closed eyes` `rolling eyes` `white pupils` ※ `hollow eyes` ※ | 眼神失焦 |
| `ahegao` | 阿黑颜（本来=翻眼+张嘴+伸舌，可以顶掉上面三个） |
| `heart-shaped pupils` ※ `heart in eye` ※ `symbol-shaped pupils` | 心形瞳——眼睛里的心号 |
| `heavy breathing` `moaning` | 喘息 / 呻吟 |
| `clenched teeth` `biting own lip` ※ `wince` `trembling` ※ | 忍着 |
| `looking at viewer` `looking down` `looking back` `looking at penis` `eye contact` | 视线 |

#### 体液

| tag | 中文 / 备注 |
| --- | --- |
| `sweat` `shiny skin` ※ `sweaty clothes` ※ `sweat stain` ※ | 汗；`shiny skin` 是那层油光，一定要配 |
| `saliva` `wet` `drooling` | 口水 |
| `pussy juice` | 爱液 |
| `cum` | 精液（父 tag） |
| `cum in pussy` `cum overflow` ※ `creampie` | 内射 / 溢出 |
| `cum in mouth` `cum on tongue` ※ `facial` ※ | 口内 / 舌上 / 颜射 |
| `cum on body` `cum on breasts` `cum string` | 身上 |
| `internal cumshot` ※ + `x-ray` / `cross-section` | 透视剖面 |
| `ejaculation` `ejaculating while penetrated` ※ | 射精瞬间 |
| `female ejaculation` ※ | 潮吹 |
| `after sex` ※ `morning after` ※ | 事后状态 |

#### 机位与姿势

| tag | 中文 / 备注 |
| --- | --- |
| `pov` `pov hands` `pov crotch` `character pov` ※ | 第一人称；`pov` 时男方只出手和下身 |
| `from below` `from behind` `dutch angle` `backlighting` | 低角 / 背后 / 斜角 / 逆光 |
| `cowboy shot` `upper body` `full body` `feet out of frame` | 取景 |
| `motion lines` `blurry foreground` `see-through silhouette` | 动感 / 前景虚 / 逆光剪影 |
| `spread legs` `leg up` `bent over` `all fours` `on back` `lying` `kneeling` `squatting` | 姿势 |
| `arm grab` `arm held back` `arms behind back` `pinned` ※ | 压制 |
| `bound wrists` ※ | 捆绑——**没这剧情别打** |

#### 场景 / 背景

`white background` `simple background` `gradient background` `indoors` `on bed` `bed sheet`
`pillow` `pillow hug` `window` `curtains` `classroom` `school desk` `tile wall` `night` `day`

### 9.5 男主怎么打 tag

池子里的男人清一色是 `dark-skinned male` + `faceless male`——成人图里的男性默认是个没有脸的深色影子。
我们要的不是影子，是能被看见的中年男人，那就得把「丑」明写出来：

```text
1boy, hetero, fat man, old man, bald, thick chest hair, thick neck, ugly bastard, sweat, shiny skin
```

| tag | 说明 |
| --- | --- |
| `ugly bastard` ※ | 检索器给「中年肥胖光头油腻男人」的第一名，3186 例，wiki 写着「丑陋秃顶的中老年男性」 |
| `fat man` ※ | 13234 例 |
| `old man` ※ | 14062 例，50–60 岁以上 |
| `bald` ※ / `balding` ※ | 全秃 / 地中海 |
| `thick chest hair` ※ `thick neck` ※ `broad shoulders` ※ | 胸毛、粗脖子、宽肩 |
| `sweaty clothes` ※ | 汗湿的背心 |

**一个框里只选一种：**

- 要「他在场但不抢戏」→ `solo focus` + `faceless male`，**不打** `ugly bastard`
- 要「观众看清这张脸」→ 去掉 `faceless male`，丑化 tag 全套上

### 9.6 这些词别用

| 词 | 原因 |
| --- | --- |
| `loli` `shota` `child` | 池子里混了，抽到要剔。我们的角色是成年人，带上会把人画小一圈 |
| `pregnant` | 池子第 2 条就混进来一个 |
| `out-of-frame censoring` `convenient censoring` `mosaic censoring` `bar censor` | 带 `censoring` 的全是打码 |
| `some_tag1.2` 这种带权重的 | SD 老语法，池子的服装列表里混了，这里不要 |
| 双空格 | 池子里到处都是，复制过来顺手清掉 |

---

## 10. 提示词模板

### 整页 summary

`scene` 用两个标签包住（完整格式见 `TECHNIQUES.md`「页面提示词的结构」）：

```text
<|background_setting|>{地点、时间、光，一句话}<|/background_setting|>
<|layout|>
LAYOUT AND STORY: PANEL ONE is … PANEL TWO is …
<|/layout|>
```

- 角色表由编译器自动追加成 `<|character_list|>` 块，**不要手写**
- `summaryCaption` 留空，填了上面这些全部失效

### panel（场景格）

位置 + tag + 背景，**不写人**（人在 character 框里）：

```text
PANEL ONE, top band across the full width, wide shot, a run-down one-room
apartment at night, one bare bulb, PLAIN WHITE BACKGROUND with no background
detail at all
```

### panel（性爱格）

按 §9.2 的骨架来，一格就是一条 tag 串：

```text
PANEL TWO, the large panel across the BOTTOM,
{人数 + 关系：1boy, 1girl, hetero, solo focus},
{动作父子对：sex, vaginal},
{裸露状态：completely nude},
{身体：large breasts, navel, stomach, collarbone},
{表情：blush, half-closed eyes, tongue out},
{体液：sweat, shiny skin, saliva, cum in pussy},
{机位：pov, from below},
PLAIN WHITE BACKGROUND with no background detail at all
```

注意：

- **不写 `nsfw`**，也不要把姿势写成句子
- 结尾那句 `PLAIN WHITE BACKGROUND` 是 `desc` 里唯一必须保留的自然语言
- 一格里最多一个 `solo focus` 和一次 `pov`，两个都堆上去镜头会打架

### character

```
CHARACTER ONE - RIN, inside PANEL TWO only, {位置}，{姿势/朝向}，{这一格的特殊状态}
```

编号和名字必须写全，外貌不写（在角色表里）。

### bubble

- 对话：`in the TOP LEFT of PANEL ONE, SPOKEN BY CHARACTER ONE - RIN` —— 位置 + 谁说的，**不写尾巴方向**
- 说话人不在画面里：`kind` 换成 `speech-notail`，`desc` 仍要写清是谁在说
- 旁白：`in the LEFT EDGE of PANEL TWO. It is the narrator, not a character speaking.`
- 拟声词：只写位置（`laid over the CENTRE of PANEL TWO`），字号调到 34–52

---

## 11. 一句话记住

> **一页一个事件，一个事件一张大图；**
> **人物顶满、背景留白；**
> **嵌格讲别的时空，双视角讲同一个瞬间；**
> **字小、话多、竖排；拟声词当图形使；**
> **色情画面打 tag，剧情才写成话。**
