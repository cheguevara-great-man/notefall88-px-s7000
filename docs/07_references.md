# 公开资料与事实边界

检索日期：2026-08-02。这里保留原始链接和本项目实际采用的结论，避免把搜索摘要当成机械图纸。

## 钢琴

- [Casio PX-S7000 官方产品规格](https://www.casio.com/us/electronic-musical-instruments/product.PX-S7000BK/)：本体 1340 × 242 × 102 mm；88 键；本体质量 14.8 kg。只用于整体包络、搬运和线缆方向。
- [Casio PX-S7000 官方支持页](https://support.casio.com/global/en/emi/manual/PX-S7000/)：用户指南、快速入门和 MIDI 实现的入口。
- [Casio PX-S7000 用户指南 PDF](https://www.casio.com/content/dam/casio/global/support/manuals/electronic-musical-instruments/pdf/008-en/p/PXS7000_usersguide_EN.pdf)：确认 USB、MIDI、原厂电源和功能接口；本项目不从琴内取电。

官方资料没有给出键后顶板局部截面、控制件横向坐标、琴键八度实测值或漆面材料相容性，因此这些内容不从网页推断，必须执行 M01–M08。

## 灯带与像素

- [SK9822 制造商数据表](https://www.normandled.com/upload/201909/SK9822%20LED%20Datasheet.pdf)：5 V、时钟/数据双线级联、32 位像素帧和封装边界的依据。
- [APA102C 数据表 PDF](https://www.lcd-module.de/eng/pdf/zubehoer/APA102C.pdf)：APA102C 帧结构、电气极限和封装信息的依据。
- [144 LED/m APA102/SK9822 灯带规格书](https://www.tme.eu/Document/8c49e28aa231371f6e177c61fa2afa59/S012144CA3SA2.pdf)：5 V、144 像素/米和 6.9 mm 级灯距的商品形态示例。不同卖家的 PCB 宽度、焊盘和切线可能不同，BOM 因而规定到货卡尺复核。

SK9822 与 APA102C 在本项目采用的低速、标准 32 位 RGB 帧下按接口兼容件处理，但不能假定所有克隆批次在极限时钟、全局亮度线性或末帧细节上完全相同。V0 固件使用 4 MHz、保守末帧和低亮度；更换批次必须重跑 T02/T05。

## 键盘几何

- [现代键盘尺寸概述](https://en.wikipedia.org/wiki/Musical_keyboard)：现代钢琴常见八度跨度约 164–165 mm，白键约 23.5 mm。
- [DS Standard Foundation 的跨八度测量说明](https://www.dsstandardfoundation.com/the_ds_standard)：跨多个完整八度/从 C 到 C 测量比逐键测量更稳定。

164.5 mm 只是 V0 的生成默认值。PX-S7000 本机最终模型使用 M01 和 M02，不以通用尺寸覆盖现场数据。

## 工程假设

- 单个 RGB 像素以 0.30 W 作为保守满白预算，兼容常见 60 mA 级估算；实际批次用电流表验证。
- APA102 全局亮度 4/31 用于平均功耗的初步预算，不视为精密线性调光参数。
- 琴体照片只用于结构方向和障碍识别，不从透视图提取毫米尺寸。

