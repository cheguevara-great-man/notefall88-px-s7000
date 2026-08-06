# 发布候选门禁

NoteFall 88 只有在数字门禁全部自动通过后才能生成候选包；只有实物门禁通过后才能把候选版本改称硬件验证版。

## G0：数字工程（自动）

| 门禁 | 执行方式 | 当前状态 |
|---|---|---|
| 单一参数源与 88 键映射 | `python scripts/generate.py --check` | 通过 |
| CAD 有效、尺寸与哈希一致 | Python 测试 + STL/STEP manifest | 通过 |
| 供电/保险/压降预算 | `generated/power_budget.json` + Python 测试 | 通过 |
| 线束防呆与 SVG 可解析 | `tests/test_hardware_package.py` | 通过 |
| Web 练习/和弦持键与事务记分语义、25%–200% 速度规范化、手机后台暂停、设备 WebSocket 握手/重连/STA 再认证/分批、节拍器音频生命周期、UTF-8 Wi-Fi 凭据边界、自建 + W3C 固定 MusicXML 语料、数据/长录制资源边界与入站协议边界 | Vitest + V8 coverage | 123 项通过；显式纳入除 DOM 主入口和两个浏览器渲染适配器外的全部产品模块，Statements 91.25%、Branches 80.37%、Functions 90.72%、Lines 95.25%，CI 最低门限 85/75/85/90%；排除项由 Playwright 回归 |
| W3C MusicXML 官方完整语料 | 固定提交 `b2e6a162` + `npm run audit:musicxml` | 150/150 分类完成：149 解析，1 个非法反复文件按预期安全拒绝，0 意外异常 |
| 厂商 MusicXML 功能语料 | MuseScore 官方提交 `d6f84b78` + eNote CC-BY-4.0 提交 `03896bf8` | 447/447 MuseScore 仓库文件无异常；100/100 跨厂商文件分类完成（97 解析、3 预期拒绝），0 意外异常 |
| 谱面引擎互操作语料与示例总谱 | OSMD BSD-3-Clause 提交 `c663e0d3` | 317/317 测试文件 + 2/2 Finale 示例总谱解析，0 意外异常；示例音符数/小节数/时长固定断言 |
| 真实曲目内容级交叉验证 | `music21 9.9.1` + OSMD 固定提交 + `scripts/crosscheck_musicxml.py` | 6 首、2638 个音符：数量与逐音音高序列完全一致；最大起音差 0.109 ms，小于 2 ms 门限 |
| NVS 校准、复位原因与灯先于网络的实时顺序 | Python 源码门禁 + 固件诊断 | 通过 |
| USB-MIDI 包、描述符、CC88 与真实灯位核心 | 固件共用 C++ 头文件由主机 `g++` 编译执行，再由 Xtensa 工具链编入固件 | 全 16 通道与 0x8–0xE 消息往返、CIN/status/data 故障、合法系统消息忽略、CC88 通道隔离/一次消费、`millis()` 回绕、176 像素正反 88 键唯一映射，以及 MIDIStreaming 双向/仅输入/多接口/截断/畸形端点选择通过 |
| 390×844 手机 + 1280×900 桌面布局、STA 控制解锁表单、MusicXML 文件选择器与 OSMD 谱面 | 固定 `@playwright/cli 0.1.17`，Chromium + WebKit 双引擎 `smoke:browser`，GitHub CI 上传截图/快照 | 两个引擎、两个视口均无横向溢出；手机练习抽屉和关闭按钮完整位于视口内；设置页真实填写短密码并显示 8–63 字节边界；真实导入 Parser Etude 后显示 4 音符、4 秒与非空五线谱；不把桌面 WebKit 冒充真 iOS 实机 |
| README/装机/制造文档本地链接 | Python 文档门禁 | 全部可解析 |
| 嵌入资源可解析且 `<500 KiB` | Python 资源测试 + `buildfs` 反向列表 | 通过 |
| ESP32 固件链接 | 仓库内固定 N8R8 板型清单 + PlatformIO；项目源码启用 `-Wall -Wextra -Werror` | 精确识别 8 MB Flash + 8 MB Octal PSRAM；RAM 17.2%，Flash 34.8%，零编译警告 |
| OTA、单文件首刷与制造包可重复且许可证随包分发 | 双次打包 SHA-256 相同；factory 镜像组件偏移/分区上限/篡改拒绝、标签与固件版本一致性、LICENSE/THIRD_PARTY_NOTICES 逐文件哈希 | 通过 |
| 私密现场照片不进入发布包 | 制造清单显式为 false + Git 路径审计 | 通过 |

GitHub Actions 在每次 push/PR 重跑 G0，并产出 `notefall88-manufacturing` 工件；合法 `vMAJOR.MINOR.PATCH[-rc.N]` 标签另外产出带 SHA-256 清单的 OTA 包、单文件 N8R8 首刷包与制造包。`-rc.N` 标签强制标为 GitHub Pre-release，且版本号必须与固件一致。

工作流使用 Node 24 运行时的 `checkout@v6`、`setup-node@v6`、`setup-python@v6` 和 `upload-artifact@v6`；GitHub 托管 runner 满足其最低版本，不保留已弃用的 Node 20 Action 运行时警告。

## G1：台架（需要现有 ESP32 与最终线束）

- 断电逐线蜂鸣、5V-GND 无短路、连接器极性与供电侧凹端子；
- 无负载 4.75–5.25 V，3 A 保险拔除后全部下游断电；
- 176 灯在 10% → 固件上限分级点亮，无闪烁、复位或接头发热；
- 5 次 USB 枚举，IN/OUT 端点与诊断计数正确，队列丢包/错误为零；
- 浏览器关闭、Wi-Fi 关闭、USB 拔出、急停、OTA 进入时均熄灯且伴奏不挂音。

## G2：装琴（需要 PX-S7000）

- 12 mm 纸条在 C4 附近全行程不触键、不盖红毡；
- A0/C4/C8 三点后完成 88 键半音阶与必要的逐键校准；
- 全键强奏、轻拉线束、移动谱架均不位移、不异响；
- 固件亮度上限运行 30 分钟，任一点 `<55°C`，灯带两端相对电源入口压降 `≤0.25 V`；
- 120 fps 视频抽查 20 次，按键反馈中位数 `<25 ms`、P95 `<40 ms`；
- 全部 13 项安装向导证据完成并导出报告，其中包含“默认热点密码已修改”的设备自动证据。

## G3：发布判定

- G0 通过：允许创建带 `-rc` 的候选标签；
- G0+G1 通过：允许称“台架验证候选”；
- G0+G1+G2 通过：允许称“PX-S7000 硬件验证版”；
- 未经至少三套独立装机长期回归，不使用“量产验证”字样。

这套命名防止把自动测试、照片估算或单次点亮误写成已经完成的物理可靠性证明。
