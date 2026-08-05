# MusicXML、MXL 与五线谱边界

NoteFall 对一个乐谱保留两种互补表示：

- OSMD 读取原始 MusicXML，负责高质量五线谱排版与小节光标；
- NoteFall 自己的解析器生成统一秒时间线，供目标灯、瀑布流、左右手筛选、循环和判分使用。

两者共享同一份原始文件，但职责不同。不能从屏幕“看起来正确”推断目标时间线一定正确，因此解析器和真实曲目都需要单独测试。

## 当前支持

- `.xml`、`.musicxml` 和压缩 `.mxl`；根格式为 `score-partwise`；
- divisions、拍号、多个 part、多个 staff/voice、backup/forward、和弦、休止符和装饰音近似时值；
- 升降音、八度、chromatic transpose、速度变化；
- tie start/stop 合并，避免连音被当成重复目标；
- staff 2 默认左手，staff 1 默认右手；单谱表再结合声部名称和中央 C 做保守推断；
- MXL 读取 `META-INF/container.xml` 指定的根文件；
- 源文件与解压总量各限 32 MiB，并在解压前检查 ZIP 中央目录声明，拦截明显 zip bomb；
- OSMD 首次选择五线谱时才动态加载，手机瀑布流首屏不承担其解析成本。
- 用户移调时 NoteFall 时间线和 OSMD `TransposeCalculator` 同步更新，原始 MusicXML 与曲库哈希保持不变。

## 当前明确不支持

- `score-timewise`；
- 反复记号、D.C./D.S./Coda 的演奏顺序展开；当前时间线按文件中的书写小节顺序；
- 非十二平均律、微分音和超出 A0–C8 的目标灯；
- 仅靠复杂文字/图形语义表达的演奏技巧；
- MusicXML 音频播放。PX-S7000 继续负责发声。

遇到这些文件时，谱面仍可能由 OSMD 显示，但不得把尚未展开的时间线用于正式判分。后续重复展开应先建立包含嵌套反复、跳转和多结尾的固定测试集，再进入练习引擎。

## 实物/曲目验收集

数字测试使用 `web/test-fixtures/parser-etude.musicxml` 覆盖双谱表、和弦、backup、速度变化、升号和跨小节 tie。发布前还要用至少以下真实导出源各验证 3 首：MuseScore、Dorico/Finale 任一、以及常见网络 MXL。每首逐项比对：显示小节数、目标音高、首末时刻、速度变化、左右手和 tie，不只做“能打开”测试。

解析错误、缺少声部或超过安全上限时，导入失败但原曲库内容不变。OSMD 的可选光标若遇到不完整 staff/voice 数据会被关闭，谱面本身仍保留可读。
