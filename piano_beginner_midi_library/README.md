# Verified human-performance piano MIDI library

本目录只收录可核验的真人演奏 MIDI。文件均为原始 performance MIDI 的字节复制：没有由乐谱/MusicXML 转换、量化、重定时或 AI 转录。

## 使用方式

将需要的 `performance.mid` 导入 NoteFall Studio。不要把本目录中的元数据当成乐谱；它只记录演奏来源和审计结果。

## 结果

| 曲名 | 来源 | 真人确认 | velocity | pedal | 难度 |
| --- | --- | --- | --- | --- | --- |
| 01. River Flows in You | not_found_in_verified_performance_dataset | 否（未收录） | — | — | 入门 |
| 02. Comptine d'un autre été | not_found_in_verified_performance_dataset | 否（未收录） | — | — | 入门 |
| 03. Kiss The Rain | not_found_in_verified_performance_dataset | 否（未收录） | — | — | 入门 |
| 04. Merry Christmas Mr. Lawrence | not_found_in_verified_performance_dataset | 否（未收录） | — | — | 入门 |
| 05. Gymnopédie No. 1 | not_found_in_verified_performance_dataset | 否（未收录） | — | — | 入门 |
| 06. Canon in D | not_found_in_verified_performance_dataset | 否（未收录） | — | — | 初级进阶 |
| 07. Always With Me (千与千寻) | not_found_in_verified_performance_dataset | 否（未收录） | — | — | 初级进阶 |
| 08. Castle in the Sky (天空之城) | not_found_in_verified_performance_dataset | 否（未收录） | — | — | 初级进阶 |
| 09. Summer | not_found_in_verified_performance_dataset | 否（未收录） | — | — | 初级进阶 |
| 10. Merry Go Round of Life | not_found_in_verified_performance_dataset | 否（未收录） | — | — | 初级进阶 |
| 11. Prelude in C Major, BWV 846 | ASAP performance MIDI | 是 | 是 | 是 | 古典入门 |
| 12. Für Elise | not_found_in_verified_performance_dataset | 否（未收录） | — | — | 古典入门 |
| 13. Moonlight Sonata, 1st Movement | not_found_in_verified_performance_dataset | 否（未收录） | — | — | 古典入门 |
| 14. Prelude Op. 28 No. 4 | not_found_in_verified_performance_dataset | 否（未收录） | — | — | 古典入门 |
| 15. Waltz Op. 69 No. 2 | not_found_in_verified_performance_dataset | 否（未收录） | — | — | 古典入门 |
| 16. Clair de Lune | not_found_in_verified_performance_dataset | 否（未收录） | — | — | 展示型 / 高级 |
| 17. Nuvole Bianche | not_found_in_verified_performance_dataset | 否（未收录） | — | — | 展示型 / 高级 |
| 18. Experience | not_found_in_verified_performance_dataset | 否（未收录） | — | — | 展示型 / 高级 |
| 19. Nocturne Op. 9 No. 2 | MAESTRO v3 performance MIDI | 是 | 是 | 是 | 展示型 / 高级 |
| 20. La Campanella | MAESTRO v3 performance MIDI | 是 | 是 | 是 | 展示型 / 高级 |

## 严格筛选规则

- **MAESTRO v3**：Yamaha Disklavier 对真人钢琴家演奏的高精度 MIDI 记录，优先使用。
- **ASAP**：只允许其 `metadata.csv` 中 `midi_performance` 字段指定的文件；绝不使用同目录的 `midi_score.mid` 或 MusicXML。
- **PianoCoRe**：已核查，但其当前公开页说明材料仅限审稿过程、不得分发/使用；因此本库不采用其 demo。
- 未明确存在于上述可用且可验证来源的曲目统一标记为 `not_found_in_verified_performance_dataset`，不以任何其他 MIDI 替代。

## 文件与可复核性

每个收录曲目目录含 `performance.mid` 和 `metadata.json`。`metadata.json` 给出数据集、原始成员路径、下载链接、SHA-256，以及对音符力度和 CC64 延音踏板的实际审计。

## 许可与归属

收录 MIDI 保留上游的 **CC BY-NC-SA 4.0** 许可：仅限非商业使用；若再分发，必须保留归属、许可和相同方式共享。MAESTRO 归属 Google LLC / International Piano-e-Competition；ASAP 归属其数据集作者。详见各 `metadata.json` 和官方数据集页面。

生成器：[`tools/build_verified_performance_midi_library.py`](../tools/build_verified_performance_midi_library.py)。
