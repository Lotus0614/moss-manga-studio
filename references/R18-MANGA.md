# R18 漫画：分镜与提示词手册

这份是**成人向**页面的做法。通用格式看 `FORMAT.md`，通用版式看 `TECHNIQUES.md`。
这里只讲三件事：**一页怎么排、人物怎么摆、提示词怎么写**。

---

## 2. 格子形态：六种，各有各的用途

| 形态                 | 作用                                     | 提示词                                                                          |
| -------------------- | ---------------------------------------- | ------------------------------------------------------------------------------- |
| 普通矩形             | 叙事主力                                 | `rectangular panel with straight edges`                                         |
| 出血 `bleed-*`       | 冲击、满版                               | `panel bleeding off the edge of the page, no border`                            |
| 破框（人物越界）     | 突出人物                                 | 见下                                                                            |
| 无边框 `frame: none` | 画面自己分割                             | `no border, artwork fills the panel edge to edge`                               |
| 斜切 `slant-*`       | 速度、错落                               | `panel with a slanted top edge cutting diagonally`                              |
| 人物overlay          | 人物不在任何格子中直接压在所有格子最上面 | One LARGE figure of S is drawn ON TOP of the panels, overlapping their borders. |

### 破框怎么写

破框 = **人物压到相邻那一格**，不是格子出血，也不是冲到空白纸上（那块纸本来就没内容）。
写成独立的 character 项，`bbox` 故意越过格线 100–220px：

```jsonc
{
    "type": "character",
    "ref": "rin",
    "bbox": [300, 176, 700, 812], // 上格 176 起，这里的框压进上面那一格
    "desc": "CHARACTER ONE - RIN, inside PANEL TWO and broken out to the PANEL ONE, her hair and shoulder painted on top of the panel above",
}
```

一页 1–2 处就够，多了画面散。通用规则见 `TECHNIQUES.md`「破框」。

---

## 3. 嵌格

### 可以用来干什么

- 作用一：**第二个时空的窗口**，不是放大镜。大图里已经有的东西（器官、乳沟、手、大腿）**不要再开嵌格去特写**——那一格等于白占地方。示例：1.大图里是做爱场景马上要射了，嵌格里可以是已经射完，pussy 的特写。2.大图是一个女孩的背后视角，嵌格可以给正面视角
- 页面可以不用常规布局，而是有一个大图占满作为背景图，这个时候嵌格可以作为普通格子进行剧情的描述。可以有一连串的两到四格嵌格来讲故事的情况。
- 不要吝啬嵌格的大小，如果太小反而没什么意思，可以有一个或者两个嵌格配合占满大图水平或者垂直的情况，并且通过 "break OUT past the panel border and overlap the upper right inset" 来让大图的角色破框到嵌格中，避免大格人物被遮挡

### 怎么写

```jsonc
{
    "type": "panel",
    "bbox": [624, 120, 880, 520],
    "frame": "thick",
    "desc": "PANEL TWO, a small inset panel lying on top of PANEL ONE at its upper right, framed by a thin black border. ",
}
```

三个要点：

2. **尺寸别小气**：256×350 起，可以更大；一格能放台词气泡，跟普通格一样

## 4. 同格双视角：一格里两个机位

在做爱里这种可以常用，一格里同时给「身体」和「脸」或者「插入特写」，信息量翻倍，还省一格。

```
shown in TWO views that share one single frame, no dividing line between them: the FIRST view is a close-up on her ahegao face; the SECOND view is a close-up on her crotch with the penis inserted, wet, dripping, no face in it. PLAIN DARK BACKGROUND with no background detail at all.
```

---

## 5. 构图：人物大、背景空

### 人物占比

- 主格：人物顶满，**70–90%**
- 镜头贴在脸/上半身/局部，不要中景全身
- 全身远景只出现在“交代地点”那一格
- 聚焦于观众想看什么，如果这是一部色情漫画，那观众想看的一定是女主角的内容！所有尽量多安排女主角的镜头，男主角可以多用越肩视角，画外音这些来略过，合理利用 大图、人物overlay、破框等格子提高女主角在画面中的占比！

### 背景留白

人物格一律写：

```
PLAIN WHITE BACKGROUND with no background detail at all
```

一页只留**一格**画完整环境（房间、走廊、雨街），其余全空。这一格通常放在页顶，当锚点。

### 镜头

| 情形     | 写法                                                                |
| -------- | ------------------------------------------------------------------- |
| 双人动作 | `camera: medium` + desc 里 `side view, full body`（两人都完整入画） |
| 单人表情 | `camera: close` + desc 里 `upper body`                              |
| 器官特写 | `camera: xclose` + desc 里 `no faces`                               |
| **不要** | 小格里用 `xclose`（376px 以下必糊成一团）                           |

一页最多一个 `xclose`。

**再加的 tag 和构图怎么对应**（词义见 §9.4）：

| 想要的效果   | 加什么 tag                               |
| ------------ | ---------------------------------------- |
| 更近、更压人 | `upper body`、`feet out of frame`        |
| 七分身       | `cowboy shot`                            |
| 低角度压迫感 | `from below`                             |
| 摇晃、不稳   | `dutch angle`                            |
| 逆光剪影     | `backlighting`、`see-through silhouette` |

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

`sfx` bbox 直接压在动作部位上，允许跨格。

---

## 7. 人物：外貌写一次，格子只写这一格

1. 角色写进项目（`name` 必须是 `角色 N - 名字` 格式，summary 角色表靠它解析）：

```bash
manga character add --id rin --name "CHARACTER ONE - RIN" --look "18, long straight black hair, large bust"
```

2. 页面上放一个 character 项，`desc` **自己写全**（编号 + 名字 + 位置 + 姿势），不写就不出图：

```jsonc
{
    "type": "character",
    "ref": "rin",
    "bbox": [180, 160, 780, 1130],
    "desc": "CHARACTER ONE - RIN, inside PANEL ONE only, kneeling on the bed, back to the camera",
}
```

3. **分工**：
    - `panel.desc` 只写场景、光、构图、机位、tag——**不写人物长相、衣服、表情**
    - `character.desc` 写位置 + 这一格的姿势与状态：背身、被遮挡、表情、动作
    - 整页裸体、受伤、换装：**优先建变种**（`manga character variant set --id rin --variant nude --look "completely naked"`），角色框选上它，外貌就由角色表带出来；只影响一个镜头的一次性特例，取消勾选角色框的「写进本页角色表」，外貌会自动拼进这一格，`desc` 只写姿势和这份特例

4. 名字**只写罗马音**。提示词里的汉字会被模型当成「要画在画面上的字」（袖章、箱子上冒出来的那种）。
   台词里叫名字仍用中文。

---

## 8. 性爱场景的动作编排

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

### 9.2 一条提示词的骨架

46 条的 tag 顺序大体就走这一条线（少数几条会从 `breasts` 或 `penis` 开头，但走向一样）：

| #   | 放什么 | 例子                                                     |
| --- | ------ | -------------------------------------------------------- |
| 1   | 人数   | `1girl` `1boy` `2girls` `multiple boys`                  |
| 2   | 关系   | `hetero` `yuri` `solo` `solo focus` `faceless male`      |
| 3   | 动作   | `sex` `oral` `fellatio` `paizuri` `masturbation`         |
| 4   | 裸露   | `nude` `completely nude` `bottomless` `clothed sex`      |
| 5   | 身体   | `breasts` `large breasts` `navel` `stomach` `collarbone` |
| 6   | 表情   | `blush` `open mouth` `half-closed eyes` `tongue out`     |
| 7   | 体液   | `sweat` `saliva` `cum` `cum in pussy`                    |
| 8   | 机位   | `pov` `from below` `cowboy shot` `upper body`            |
| 9   | 背景   | `white background` `indoors` `on bed`                    |

拼起来就是一条能出图的完整提示词：

```text
1girl, 1boy, hetero, sex, vaginal, completely nude,
large breasts, navel, stomach, collarbone,
blush, half-closed eyes, open mouth, tongue out,
sweat, saliva, pussy juice, cum in pussy,
pov, from below, cowboy shot,
white background, simple background
```

### 9.4 词库（按用途）

#### 正戏

| tag                                                  | 中文     | 搭配                                          |
| ---------------------------------------------------- | -------- | --------------------------------------------- |
| `sex` + `vaginal`                                    | 本番插入 | 必须成对出现                                  |
| `sex from behind` + `doggystyle`                     | 后入     | 加 `all fours` `bent over` `looking back`     |
| `cowgirl position` + `girl on top` + `straddling`    | 女上     | 三个一起打才稳                                |
| `standing sex`                                       | 站立     | 加 `standing` `leg up`                        |
| `oral` + `fellatio`                                  | 口交     | 加 `licking penis` `testicles` `cum in mouth` |
| `paizuri`                                            | 乳交     | 加 `breasts squeezed together`                |
| `handjob` `double handjob`                           | 手交     |                                               |
| `masturbation` + `female masturbation` + `fingering` | 自慰     |                                               |
| `missionary` ※                                       | 正常位   |                                               |
| `cunnilingus` ※                                      | 舔       |                                               |
| `gangbang` `group sex` `multiple penises`            | 多人     | 配 `3boys` `4boys`                            |

#### 身体

| tag                                                                                                | 中文 / 备注                              |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `breasts` + `small breasts` / `medium breasts` / `large breasts` / `huge breasts`                  | 先打 `breasts` 再打尺寸                  |
| `navel` `stomach` `collarbone` `thighs`                                                            | **有躯干的格子必打**，不然会画成一整块板 |
| `cleavage` `underboob` `breasts out` `covered nipples` `bouncing breasts` `nipple tweak` `armpits` | 胸部状态                                 |
| `pussy` `anus` `puckered anus` `cleft of venus` `spread pussy` `presenting`                        | 局部                                     |
| `penis` `testicles` `erection` `veiny penis` `large penis`                                         | 局部                                     |
| `flat chest` `curvy` ※ `plump` ※ `wide hips` ※ `thick thighs`                                      | 体型                                     |
| `mole` `mole under eye` `mole on breast`                                                           | 痣——当固定人物特征用                     |

#### 表情

| tag                                                                                | 中文 / 备注                                     |
| ---------------------------------------------------------------------------------- | ----------------------------------------------- |
| `blush` `nose blush`                                                               | 脸红                                            |
| `open mouth` `closed mouth` `parted lips`                                          | 嘴                                              |
| `tongue` `tongue out` `:o` `:d` `@_@`                                              | 舌 / 表情符号，`:o` `:d` 高频有效，别怕         |
| `half-closed eyes` `closed eyes` `rolling eyes` `white pupils` ※ `hollow eyes` ※   | 眼神失焦                                        |
| `ahegao`                                                                           | 阿黑颜（本来=翻眼+张嘴+伸舌，可以顶掉上面三个） |
| `heart-shaped pupils` ※ `heart in eye` ※ `symbol-shaped pupils`                    | 心形瞳——眼睛里的心号                            |
| `heavy breathing` `moaning`                                                        | 喘息 / 呻吟                                     |
| `clenched teeth` `biting own lip` ※ `wince` `trembling` ※                          | 忍着                                            |
| `looking at viewer` `looking down` `looking back` `looking at penis` `eye contact` | 视线                                            |

#### 体液

| tag                                                       | 中文 / 备注                           |
| --------------------------------------------------------- | ------------------------------------- |
| `sweat` `shiny skin` ※ `sweaty clothes` ※ `sweat stain` ※ | 汗；`shiny skin` 是那层油光，一定要配 |
| `saliva` `wet` `drooling`                                 | 口水                                  |
| `pussy juice`                                             | 爱液                                  |
| `cum`                                                     | 精液（父 tag）                        |
| `cum in pussy` `cum overflow` ※ `creampie`                | 内射 / 溢出                           |
| `cum in mouth` `cum on tongue` ※ `facial` ※               | 口内 / 舌上 / 颜射                    |
| `cum on body` `cum on breasts` `cum string`               | 身上                                  |
| `internal cumshot` ※ + `x-ray` / `cross-section`          | 透视剖面                              |
| `ejaculation` `ejaculating while penetrated` ※            | 射精瞬间                              |
| `female ejaculation` ※                                    | 潮吹                                  |
| `after sex` ※ `morning after` ※                           | 事后状态                              |

#### 机位与姿势

| tag                                                                                     | 中文 / 备注                        |
| --------------------------------------------------------------------------------------- | ---------------------------------- |
| `pov` `pov hands` `pov crotch` `character pov` ※                                        | 第一人称；`pov` 时男方只出手和下身 |
| `from below` `from behind` `dutch angle` `backlighting`                                 | 低角 / 背后 / 斜角 / 逆光          |
| `cowboy shot` `upper body` `full body` `feet out of frame`                              | 取景                               |
| `motion lines` `blurry foreground` `see-through silhouette`                             | 动感 / 前景虚 / 逆光剪影           |
| `spread legs` `leg up` `bent over` `all fours` `on back` `lying` `kneeling` `squatting` | 姿势                               |
| `arm grab` `arm held back` `arms behind back` `pinned` ※                                | 压制                               |
| `bound wrists` ※                                                                        | 捆绑——**没这剧情别打**             |

#### 场景 / 背景

`white background` `simple background` `gradient background` `indoors` `on bed` `bed sheet`
`pillow` `pillow hug` `window` `curtains` `classroom` `school desk` `tile wall` `night` `day`

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

### character

```
CHARACTER ONE - RIN, inside PANEL TWO, {位置}，{姿势/朝向}，{这一格的特殊状态}
```
