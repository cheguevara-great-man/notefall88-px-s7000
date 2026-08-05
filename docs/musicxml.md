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

发布前仍要用至少以下应用导出源各验证 3 首：MuseScore、Dorico/Finale 任一、以及常见网络 MXL。每首逐项比对显示小节数、目标音高、首末时刻、速度变化、左右手和 tie，不只做“能打开”测试。W3C 标准语料不能替代这些厂商实际导出门禁。

解析错误、缺少声部或超过安全上限时，导入失败但原曲库内容不变。OSMD 的可选光标若遇到不完整 staff/voice 数据会被关闭，谱面本身仍保留可读。

## 标准依据

解析规则以 W3C MusicXML 4.0 的 [`metronome`](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/metronome/)、[`time`](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/time/)、[`cue`](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/cue/)、[`sound`](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/sound/) 和 [`direction`](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/direction/) 元素定义为准。固定样例验证的不只是 XML 能否打开，而是标准语义是否进入同一目标灯、判分和节拍时间线。
