# OpusWeave

> 从构思，到乐谱，到演奏。

OpusWeave 是一个面向人与 AI 的开源可执行乐谱工作台。它将音乐构思、
谱面图片和实时 MIDI 演奏统一为结构化乐谱，并围绕乐谱完成编曲、播放、
练习、跟谱、合奏与录制。

在 OpusWeave 中，乐谱不只是静态文档：人可以阅读它，乐器可以执行它，
AI Agent 可以理解并修改它。

应用 ID：`io.github.liooil.opusweave` · 许可证：Apache-2.0

---

## 第一阶段交付的纵向链路

```
AI / JSON / CLI / MCP  →  创建 MIDI
       ↓
Standard MIDI File  (导入 / 导出，SMF Type 1)
       ↓
GUI 播放  (spessasynth_lib + Web Audio API)
       ↓
WebMIDI  (实体键盘输入，热插拔，自动重连)
       ↓
SoundFont 合成  (.sf2 / .sf3 / .sfogg)
       ↓
录制演奏  →  导出 .mid（可再次导入）
```

| # | 能力 |
|---|---|
| 1 | 导入并播放 `.mid` 文件 |
| 2 | 使用内置轻量 Micro GM SoundFont 直接演奏，或加载自定义 `.sf2` / `.sf3` / `.sfogg` 音色库 |
| 3 | 通过 WebMIDI 连接实体 MIDI 键盘（权限按钮、端口选择、热插拔、id 变化后按厂商/名称回退匹配） |
| 4 | 实时监视 Note On/Off、CC、Pitch Bend（含音名显示） |
| 5 | 录制实时演奏（实体键盘或电脑键盘），导出可再次导入的 Standard MIDI File |
| 6 | 通过 CLI 或 MCP 用结构化 `CompositionSpec` 创建多轨 MIDI |
| 7 | 通过可选的系统 FluidSynth 将 MIDI + SoundFont 渲染为 WAV（`render-midi`） |
| 8 | 通过 MCP 服务器（5 个工具）让 AI Agent 驱动全部功能 |
| 9 | 用电脑键盘演奏（Z–M / S–L / Q–U，八度升降，固定力度），并支持 MIDI Learn |
| 10 | 内置可编辑的 MIDIPLUS TINY+ 32 键键盘设备配置 |

## 快速开始

前置条件：[Bun](https://bun.sh) ≥ 1.3.14，Chromium 系浏览器（Chrome、Edge、
Brave…，WebMIDI 需要），可选安装 `fluidsynth` 用于离线渲染。

```bash
bun install
bun run dev            # 桌面窗口（Linux/Windows 使用 Chromium 应用模式）
```

无头服务器（用 Firefox 或 Chromium 打开打印出的地址）：

```bash
bun run dev --no-browser
```

服务器只绑定 `127.0.0.1`，默认不暴露到局域网。

### CLI

```bash
bun run opusweave create-midi --spec examples/minimal-composition.json --output tmp/example.mid
bun run opusweave inspect-midi --file tmp/example.mid
bun run opusweave render-midi --midi tmp/example.mid --soundfont /path/to/bank.sf2 --output tmp/example.wav
bun run opusweave doctor [--soundfont /path/to/bank.sf2]
bun run opusweave mcp   # stdio MCP 服务器
```

### MCP

在 MCP 客户端配置中添加：

```json
{ "command": "bun", "args": ["<仓库路径>/src/main.ts", "mcp"] }
```

工具同时覆盖 CompositionSpec 与 OWT：`create_midi`、`validate_score_text`、
`compile_score_text_to_midi`、`play_score_text`、`get_take_text`、
`quantize_take`、`compare_take_with_score`。详见 [docs/mcp.md](docs/mcp.md)
和 [docs/owt.md](docs/owt.md)。

## 音色库

OpusWeave 内置 **OpusWeave Micro GM** 轻量合成音色库，覆盖全部 128 个 GM
旋律音色和一套标准鼓组，启动后会自动加载，因此无需额外文件即可演奏。你仍可随时
加载自己的 `.sf2`、`.sf3` 或 `.sfogg` 音色库；请确保拥有相应文件的合法使用权。

“音色库”面板可以将 Web Audio 明确输出到 USB-C/HDMI 显示器、扬声器或耳机。
如果设备名称不可见，请点击**显示设备**；Chromium 可能请求麦克风权限以获取设备
标签，OpusWeave 会立即停止临时音频流，不会录音。

## 格式模型


- **MIDI** 是演奏/播放格式（Standard MIDI File，默认 Type 1）。
- **MusicXML / MXL** 是计划中的未来记谱格式（见 [docs/roadmap.md](docs/roadmap.md)）。
- **OWT Score / Take** 是面向用户和 LLM 的稳定文本表层，用于编写音乐和阅读
  精确演奏数据。详见 [docs/owt.md](docs/owt.md)。
- **CompositionSpec** 是 OpusWeave 的 AI/API 输入模型，是 Agent 描述音乐的
  结构化方式。它**不是**新的音乐文件标准；最终持久化输出仍是标准 MIDI。
- **图片 / PDF（OMR）** 是计划中的未来入口。

完整的 `CompositionSpec` schema 与校验规则见
[docs/midi-model.md](docs/midi-model.md)。

## 目录结构

```
src/
├── main.ts                    # BunDesk 桌面应用、CLI actions、--smoke、MCP 路由
├── build.ts                   # 单文件二进制构建（bundesk）
├── domain/                    # 无框架核心：composition、OWT Score/Take、校验、
│   │                          #   tempo map、MIDI 导入导出、量化、设备与共享服务
│   │                          #   MIDI Learn、OpusWeaveService
├── audio/                     # SynthEngine 接口、spessasynth 引擎、mock、
│   │                          #   FluidSynth 渲染器
├── midi/                      # WebMIDI 管理器、端口选择
├── mcp/                       # MCP 服务器与工具定义
├── cli/                       # CLI 参数辅助
├── web/                       # GUI：HTML/CSS/TS，无框架
└── tests/                     # 确定性的 Bun 测试套件
```

GUI、CLI 与 MCP 都调用同一个 `OpusWeaveService` —— 领域逻辑只实现一次，
不为各层分别重写。

## 平台说明

- 桌面窗口在 Linux 与 Windows 上都使用 **Chromium 系浏览器 provider**，
  因为产品依赖 WebMIDI；WebKitGTK 与未打补丁的 WebView2 不支持 Web MIDI。
- `FluidSynth` 是可选的外部工具，仅用于离线 WAV 渲染。GUI 通过浏览器内
  音源播放。OpusWeave 不会自动安装 FluidSynth；缺失时 `doctor` 会打印
  安装指引。

## 文档

- [docs/architecture.md](docs/architecture.md) — 模块边界与关键决策
- [docs/midi-model.md](docs/midi-model.md) — CompositionSpec schema、校验、SMF 映射
- [docs/mcp.md](docs/mcp.md) — MCP 服务器用法与工具
- [docs/roadmap.md](docs/roadmap.md) — 未来里程碑（MusicXML、合奏、OMR、简谱、FreePiano）

## 许可证

Apache-2.0。第三方声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

OpusWeave 是独立项目，与 FreePiano、MIDIPLUS、MIDI Association 及任何
SoundFont 商标持有者无隶属或背书关系。
