# ADR-001：原生 USB Host 与双供电支路

- 状态：已接受
- 适用硬件：乐鑫官方 ESP32-S3-DevKitC-1-N8R8
- 决策日期：2026-08-05

## 结论

PX-S7000 使用 ESP32-S3 的原生 USB OTG Host，不增加 MAX3421E。现有供电型 OTG Y 线保留，三个接头均有固定职责：

| Y 线接头 | 连接 | 职责 |
|---|---|---|
| Micro-USB 公头 | ESP32 的 `USB/OTG` 口 | D+/D- 数据；ESP32-S3 固件作为 Host |
| USB-A 母口 | USB-A 公转 USB-B 公打印机线，再到 PX-S7000 `USB TO HOST` | 钢琴 USB-MIDI 设备连接 |
| 第三个 Micro-USB 供电口 | H7：保险后的 5V/GND | 给钢琴设备侧提供 USB VBUS，不给 ESP32 反向供电 |

ESP32 本体由 H5 从同一保险后的 5V/GND 接入 `USB-to-UART` 口供电。H5 和 H7 必须共用同一 5V 电源与公共地，不能使用两只互不相关的适配器。

## 为什么需要两根供电支路

乐鑫官方 [ESP32-S3-DevKitC-1 V1.1 原理图](https://dl.espressif.com/dl/schematics/SCH_ESP32-S3-DevKitC-1_V1.1_20221130.pdf) 显示：

- `USB to UART` 的 VBUS 经 D1 进入板上 `VCC_5V`；
- `ESP USB` 的 VBUS 经 D7 进入板上 `VCC_5V`；
- 两只肖特基二极管允许任一 USB 口给开发板供电，但阻止板上 5V 从一个口反向输出到另一个口。

因此 H5 能给 ESP32 上电，却不能通过 `USB/OTG` 口给钢琴侧产生 Host VBUS。Y 线第三口的 H7 补上设备侧 VBUS。商品说明“不支持对手机供电”与此一致：第三口给 USB-A 外设侧供电，不会反向给 Micro-USB 公头一侧的 Host 供电。

## 为什么不使用 MAX3421E

ESP32-S3 芯片本身具备 USB OTG Host 控制器，固件直接使用 ESP-IDF USB Host API 和 USB-MIDI 类传输。Y 线只做插头转换和 VBUS 注入，不提供 Host 协议能力。MAX3421E 会额外增加 SPI Host 控制器、板卡、连线、驱动层和故障点；只有目标 MCU 没有原生 Host 时才需要。

## 禁止的接法

- 不得把 Y 线插到开发板 `UART/USB-to-UART` 口；
- 不得只给 Y 线第三口供电并假定它会给 ESP32 上电；
- 不得只给 ESP32 的 UART 口供电并把 Y 线第三口留空；
- 不得从 PX-S7000、WU-BT10 端口或开发板 3.3V 引脚给灯带供电；
- 不得同时接两只独立 5V 适配器形成未知回流路径。

## 验收证据

数字门禁检查 `harness.csv` 与线束图必须同时出现 H5、H7、`USB/OTG` 和 `USB-to-UART`。实物门禁还必须确认：

1. 拔掉 3A 总保险后 ESP32、Y 线 VBUS 和灯带全部断电；
2. H5、H7 空载电压均为 4.75-5.25V，极性正确；
3. 连接钢琴后 USB 枚举成功，网页显示 MIDI IN 端点；
4. 拔掉 H7 后 USB 应断开或不枚举，重新插回后可恢复；
5. 整机运行时不存在第二只外部 5V 适配器。

