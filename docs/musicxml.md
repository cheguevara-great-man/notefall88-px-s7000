# MusicXML、MXL 与五线谱边界

NoteFall 对一个乐谱保留两种互补表示：

- OSMD 读取原始 MusicXML，负责高质量五线谱排版与小节光标；
- NoteFall 自己的解析器生成统一秒时间线，供目标灯、瀑布流、左右手筛选、循环和判分使用。

两者共享同一份原始文件，但职责不同。不能从屏幕“看起来正确”推断目标时间线一定正确，因此解析器和真实曲目都需要单独测试。

## 当前支持

- `.xml`、`.musicxml` 和压缩 `.mxl`；根格式为 `score-partwise`；
- divisions、普通/加法/复合拍号、自由节拍、多个 part、多个 staff/voice、backup/forward、和弦、休止符、静默 cue 和装饰音近似时值；
- 升降音、八度、chromatic + octave-change transpose、速度变化；`metronome` 的 beat-unit、附点和 per-minute 会换算为四分音符 BPM；两个普通/附点 beat-unit 的 metric modulation 会按当时速度精确换算，并在反复后重新执行；
- `sound dynamics` 百分比和常见动态记号会换算为 MIDI 力度；可按 staff 保留左右手不同力度；
- tie start/stop 合并，避免连音被当成重复目标；
- 前向/后向反复、`times` 次数、第一/第二等多结尾，以及标准 `sound` 属性表达的 D.C./D.S./Fine/To Coda/Coda；统一时间线按真实演奏顺序展开；
- 展开后的每个播放小节保留原书写小节索引，OSMD 光标在反复和跳转时回到正确的谱面位置；
- staff 2 默认左手，staff 1 默认右手；单谱表再结合声部名称和中央 C 做保守推断；
- MXL 读取 `META-INF/container.xml` 指定的根文件；
- 源文件与解压总量各限 32 MiB，并在解压前检查 ZIP 中央目录声明，拦截明显 zip bomb；
- OSMD 首次选择五线谱时才动态加载，手机瀑布流首屏不承担其解析成本。
- 用户移调时 NoteFall 时间线和 OSMD `TransposeCalculator` 同步更新，原始 MusicXML 与曲库哈希保持不变。
- 展开后的每个播放小节按当时的普通、`3+2/8` 加法或多组复合拍号生成强弱拍标记，再通过同一速度转换器变成秒；`senza-misura` 不虚构点击。节拍器因此能随反复回到正确拍号/速度，而不是用固定 BPM 覆盖乐谱。

## 当前明确不支持

- `score-timewise`；
- 只用自由文字、图片或厂商私有扩展表达、且没有标准 MusicXML `repeat`/`ending`/`sound` 属性的跳转；
- 超过 8 次反复、无法终止的跳转或超过 10000 个播放小节的异常结构；这类文件会明确拒绝而不是生成错误判分时间线；
- 非十二平均律、微分音和超出 A0–C8 的目标灯；
- 含 tuplet 的复杂 metric modulation（`metronome-note`/`metronome-relation`）、只有自由文字而无机器速度端点的 rit./accel.、渐变速度曲线和力度发卡连续插值；其离散 `sound tempo` 仍会执行，但不猜测连续曲线；
- 仅靠复杂文字/图形语义表达的演奏技巧；
- MusicXML 音频播放。PX-S7000 继续负责发声。

标准反复和跳转已经有固定单元测试；真实曲目仍必须检查导出软件是否同时写入机器可读的 `sound` 属性。只有视觉文字而无标准导航属性的文件，OSMD 可能显示记号，但 NoteFall 不会猜测自由文本含义。

## 自动化标准语料与应用导出验收

自建数字样例使用 `parser-etude.musicxml` 覆盖双谱表、和弦、backup、速度变化、升号和跨小节 tie；`meter-tempo-dynamics.musicxml` 覆盖加法/复合拍号、附点速度、力度和静默 cue；固定内联总谱覆盖两声部重复写入 `quarter = dotted-quarter` 而不重复加速。

此外，仓库固定了 W3C Music Notation Community Group 的 MIT `musicxmlTestSuite` 提交 `b2e6a162` 中三个未经修改的互操作样例：`43a-PianoStaff.xml`、`45b-RepeatWithAlternatives.xml` 和 `31c-MetronomeMarks.xml`。测试先核对每个文件 SHA-256，再断言钢琴双谱表、反复结尾播放顺序、节拍标记和音符时值；来源与许可证保存在样例目录。这一层证明标准语料的稳定语义，不把自写 XML 当作全部兼容性证据。

完整语料审计可通过 `npm run audit:musicxml -- <xmlFiles目录>` 重复运行。对上述固定提交的全部 150 个 `.xml`/`.musicxml`/`.mxl` 文件，当前结果为 149 个正常解析、0 个意外异常、1 个预期安全拒绝。预期拒绝的是测试套件刻意构造的 `45f-Repeats-InvalidEndings.xml`：它的结尾编号互相重叠矛盾，NoteFall 不猜测错误播放顺序。审计同时检查负数/非有限时长，并单列没有目标音符的纯休止、版式和结构测试文件。此次批量审计发现并固定了“连续第 1～第 5 结尾共享隐式反复轮次”的语义，以及“跳过的结尾不得触发其反复线或导航”的规则。

可重复审计命令（语料不纳入产品发布包）：

```powershell
git clone https://github.com/w3c-cg/musicxmlTestSuite tmp/musicxmlTestSuite
git -C tmp/musicxmlTestSuite checkout b2e6a1627b8574c9714e1fd0a8a5b1921e10f8f3
cd web
npm.cmd ci
npm.cmd run audit:musicxml -- ..\tmp\musicxmlTestSuite\xmlFiles
```

同一工具还审计了两个固定版本的真实应用语料：

- MuseScore Studio 官方 GPL-3.0 仓库提交 `d6f84b78601e13055f1c3be97561f84f0e21650f` 的 `src/importexport/musicxml/tests/data`：447/447 文件解析，0 意外异常；按 `<software>` 元数据统计包含 412 份 MuseScore、18 份 Sibelius、6 份 Finale、2 份 Dolet，以及少量 Noteflight/Audiveris 等输入样例。
- eNote GmbH 的 CC-BY-4.0 [`scorewriter-comparison`](https://github.com/eNote-GmbH/scorewriter-comparison) 提交 `03896bf8202ebb5cca3ba60992a8bb9cdb2f354c`：100/100 文件完成分类，覆盖 MuseScore 31、Dorico 28、Sibelius 26、Dolet 13、Finale 12 份导出；97 份解析，3 份预期拒绝，0 意外异常。两个 Dorico 文件只有元数据、没有任何声部；一个 Finale 文件引用 D.S. 编号 16，却没有机器可读的 segno 16，NoteFall 不根据可见文字猜判分时间线。
- 当前谱面引擎 OpenSheetMusicDisplay 的 BSD-3-Clause 官方仓库提交 `c663e0d3f61aa2ee1b6ca4d0f360a60e42cc8b28`：`test/data` 317/317 文件解析、0 意外异常，其中 288 份含目标音、16 份为真实 MXL，并覆盖带 UTF-16 内部 XML 的 MXL；`demo` 中两份 Finale 示例总谱也通过固定语义统计，分别为 172 音/13 小节/32.5 秒和 299 音/17 小节/48.5714 秒。

厂商语料审计直接促成并固定了两类兼容性修复：带 BOM 或 XML 字节特征的 UTF-16LE/UTF-16BE 解码，以及相邻多组 volta、较晚隐式反复跨越较早反复段时的独立轮次/终点管理。审计器会递归扫描目录、报告导出器分布、零目标音文件、非有限时长、预期拒绝和意外异常。

```powershell
git clone --filter=blob:none --sparse --no-checkout https://github.com/musescore/MuseScore.git tmp/MuseScore
git -C tmp/MuseScore sparse-checkout set src/importexport/musicxml/tests/data
git -C tmp/MuseScore checkout d6f84b78601e13055f1c3be97561f84f0e21650f
git clone https://github.com/eNote-GmbH/scorewriter-comparison.git tmp/scorewriter-comparison
git -C tmp/scorewriter-comparison checkout 03896bf8202ebb5cca3ba60992a8bb9cdb2f354c
git clone --filter=blob:none --sparse --no-checkout https://github.com/opensheetmusicdisplay/opensheetmusicdisplay.git tmp/opensheetmusicdisplay
git -C tmp/opensheetmusicdisplay sparse-checkout set test/data demo
git -C tmp/opensheetmusicdisplay checkout c663e0d3f61aa2ee1b6ca4d0f360a60e42cc8b28
cd web
npm.cmd run audit:musicxml -- ..\tmp\MuseScore\src\importexport\musicxml\tests\data
npm.cmd run audit:musicxml -- ..\tmp\scorewriter-comparison
npm.cmd run audit:musicxml -- ..\tmp\opensheetmusicdisplay\test\data
npm.cmd run audit:musicxml -- ..\tmp\opensheetmusicdisplay\demo --details
```

这些外部语料只用于本地审计，不复制进产品、固件或发布包；测试结果绑定上游提交和许可证，不把不同版本的结果混写。

“解析成功”表示目标音符时间线能够安全生成，不代表 NoteFall 实现了测试文件中的全部雕版、歌词、吉他谱、打击乐或微分音视觉语义；这些仍交给 OSMD 显示或明确处于练习引擎范围之外。

四套外部固定语料加 OSMD 两份示例共 1016 个文件，当前为 1012 个解析、4 个预期安全拒绝、0 个意外异常，其中 813 个含 A0–C8 目标音。它们已经覆盖“能否安全导入”和大量结构边界，但多数仍是功能测试而不是完整双手钢琴曲。

为了进一步检查“生成的音高与时间是否正确”，仓库另提供独立的内容级交叉验证器。它不复用 NoteFall 的解析逻辑，而以 `music21 9.9.1` 作为参考实现，对 OSMD 固定提交 `c663e0d3f61aa2ee1b6ca4d0f360a60e42cc8b28` 中 6 首真实曲目进行比较：Clementi Op.36 No.1/No.3 各两个乐章、Debussy《Mandoline》和 Gretchaninov《A Boring Story》。当前共比较 2638 个 A0–C8 音符，数量与逐音音高序列完全一致，最大起音差为 `0.000109168 s`（约 0.109 ms，门限 2 ms）。这是独立解析器之间的内容证据，不把仅仅“能打开”算作通过。

```powershell
python -m venv tmp/music21-venv
.\tmp\music21-venv\Scripts\python.exe -m pip install -r requirements-audit.txt
.\tmp\music21-venv\Scripts\python.exe scripts\crosscheck_musicxml.py
```

`music21` 只属于可选审计环境，不进入网页、固件、常规开发依赖或发布包。上述六曲也不复制进仓库，脚本要求先按前文步骤检出固定版本 OSMD 语料。由于不同参考实现对显示节拍标记与 `<sound tempo>`、反复展开的取舍可能不同，未满足可比前提的曲目不会被硬算成通过。发布前仍要用 MuseScore、Dorico/Finale 任一和常见网络 MXL 各至少 3 首真实钢琴曲，逐项人工比对显示小节数、目标音高、首末时刻、速度变化、左右手和 tie。自动交叉验证不能替代显示与演奏的人工内容门禁。

解析错误、缺少声部或超过安全上限时，导入失败但原曲库内容不变。OSMD 的可选光标若遇到不完整 staff/voice 数据会被关闭，谱面本身仍保留可读。

## 标准依据

解析规则以 W3C MusicXML 4.0 的 [`metronome`](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/metronome/)、[`time`](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/time/)、[`cue`](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/cue/)、[`sound`](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/sound/) 和 [`direction`](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/direction/) 元素定义为准。固定样例验证的不只是 XML 能否打开，而是标准语义是否进入同一目标灯、判分和节拍时间线。
