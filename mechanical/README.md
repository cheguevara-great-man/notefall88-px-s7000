# 参数化机械模型

`generate.py` 读取 `config/system.json` 并用 CadQuery 生成 V0 的 STEP、STL、布局映射和固件布局头文件。所有源尺寸单位均为 mm。

## 坐标约定

- X：沿琴键横向，正方向朝高音端；原点是 C4–B4 八度的中心。
- Y：沿琴键前后，负方向朝演奏者；第 0 排（当前排）在最前。
- Z：离开琴体表面向上。
- MIDI 60（C4）左键缝位于 `-octave_span/2`，MIDI 72（C5）左键缝位于 `+octave_span/2`。

## 生成

```powershell
.\.venv\Scripts\python.exe mechanical\generate.py
.\.venv\Scripts\python.exe mechanical\render.py
```

修改参数后必须同时提交：

- `config/system.json`
- `mechanical/exports/*`
- `firmware/include/layout_generated.h`
- 自动测试结果

## 设计余量

模型允许 10–12 mm 宽 IP30 灯带，但购买批次的实际 PCB 宽度和封装高度必须在粘贴前用卡尺确认。V0 外形 180 × 70 mm，只是局部验证尺寸；琴体可用深度在 M03 完成前没有冻结。

