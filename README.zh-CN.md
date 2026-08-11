# OpusWeave

> 从构思，到乐谱，到演奏。

OpusWeave 是一个面向人与 AI 的开源可执行乐谱工作台。它将音乐构思、
谱面图片和实时 MIDI 演奏统一为结构化乐谱，并围绕乐谱完成编曲、播放、
练习、跟谱、合奏与录制。

在 OpusWeave 中，乐谱不只是静态文档：人可以阅读它，乐器可以执行它，
AI Agent 可以理解并修改它。

应用 ID：`io.github.liooil.opusweave` · 许可证：Apache-2.0

Web 应用：[liooil.github.io/opus-weave](https://liooil.github.io/opus-weave/)。每次推送到 `main` 都会通过 GitHub Pages 发布纯浏览器版本。
可直接从浏览器安装；首次加载完成后，完整工作站（包括合成器引擎和内置 SoundFont）无需网络也能运行。

---

## 第一阶段交付的纵向链路

OpusWeave 是 `.owt` 文本文件的编辑器和播放器：

```
MIDI / AI 提示词 / 谱面图片 / MP4 画面帧
       ↓  旋律提取或多模态生成
OWT 文本（主要可编辑源文件）
       ↓
MIDI 播放/导出  →  SoundFont 合成
```

| # | 能力 |
|---|---|
| 1 | 使用 Helix 模态快捷键按乐谱对象移动和编辑 `.owt`：CHAR 对应事件、WORD 对应小节、LINE 对应轨道；也可直接编辑原始文本或通过实时弹奏替换 |
| 2 | 通过有意的有损转换从 MIDI 提取旋律，支持轨道选择、声部简化和节奏量化 |
| 3 | 将 OWT 导出为 Standard MIDI，用于播放和交换 |
| 4 | 默认使用 FreePiano 风格 mda Piano 与 Micro GM，也可加载自定义 SoundFont |
| 5 | 通过 WebMIDI 连接实体键盘，用于实时演奏、引导演奏和 AI 即兴接奏 |
| 6 | 在多轨节拍时间轴查看和编辑 MIDI，然后提取旋律或导出 |
| 7 | 实时监视 Note On/Off、CC 和 Pitch Bend |
| 8 | 通过可选 FluidSynth 将 MIDI + SoundFont 渲染为 WAV |
| 9 | 通过 MCP 校验、播放、导入和导出 OWT |
| 10 | 在 OpusWeave 半音阶、英文单词、拼音声调和 FreePiano 经典实时演奏布局间切换 |
| 11 | 内置《欢乐颂》《致爱丽丝》《D 大调卡农》《G 大调小步舞曲》《月光奏鸣曲》等公版钢琴示例 |
| 12 | 通过统一“打开 / 导入”入口或拖放载入 OWT、转换 MIDI，或把谱面图片/MP4 交给兼容 OpenAI API 的多模态模型 |

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
bun run opusweave owt validate examples/twinkle.owt
bun run opusweave owt play examples/twinkle.owt
bun run opusweave owt to-midi examples/twinkle.owt -o tmp/twinkle.mid
bun run opusweave owt from-midi tmp/twinkle.mid --grid 1/16 --voice continuous -o tmp/melody.owt
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

OWT 主流程工具为 `validate_owt`、`play_owt`、`export_owt_to_midi` 和
`import_midi_to_owt`。底层 MIDI 与 CompositionSpec 工具仍然可用。详见
[docs/mcp.md](docs/mcp.md) 和 [docs/owt.md](docs/owt.md)。

## 音色库

OpusWeave 默认加载 **mda Piano**，即 FreePiano 1.8 默认使用的采样钢琴音源。
原版 MIT 许可的 PCM 采样与键区被封装为浏览器可用的 SoundFont；其他 127 个
旋律音色和鼓组继续由 **OpusWeave Micro GM** 回退补全。由于 OpusWeave 使用
SoundFont 合成模型而不是原 VST DSP，听感会贴近 FreePiano 默认音色，但不会逐采样
完全一致。你仍可随时加载自己的 `.sf2`、`.sf3` 或 `.sfogg` 音色库；请确保拥有
相应文件的合法使用权。

“音色库”面板可以将 Web Audio 明确输出到 USB-C/HDMI 显示器、扬声器或耳机。
如果设备名称不可见，请点击**显示设备**；Chromium 可能请求麦克风权限以获取设备
标签，OpusWeave 会立即停止临时音频流，不会录音。

## 格式模型


- **OWT（`.owt`）**是主要持久化格式：简单、稳定、适合人和 AI 编辑的旋律文本。
- **MIDI** 是导入、播放和导出格式。MIDI → OWT 有意采用有损转换，舍弃伴奏、
  演奏控制和微小时序。
- **CompositionSpec** 是 OWT 校验和 MIDI 导出共享的内部编译模型，不是用户文件格式。
- **谱面图片和 MP4 视频**可交给已配置的多模态模型，并简化为校验通过的 OWT；MP4 通过抽取画面帧识别。

完整的 `CompositionSpec` schema 与校验规则见
[docs/midi-model.md](docs/midi-model.md)。

## 目录结构

```
src/
├── main.ts                    # BunDesk 桌面应用、CLI actions、--smoke、MCP 路由
├── build.ts                   # 单文件二进制构建（bundesk）
├── domain/                    # 无框架核心：OWT、旋律提取、composition IR、
│   │                          #   MIDI 导入导出、设备与共享服务
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
