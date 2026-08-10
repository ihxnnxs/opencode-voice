<p align="center">
  <a href="https://github.com/ihxnnxs/opencode-voice">
    <picture>
      <source srcset="../assets/opencode-voice-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="../assets/opencode-voice-light.svg" media="(prefers-color-scheme: light)">
      <img src="../assets/opencode-voice-light.svg" alt="opencode voice logo">
    </picture>
  </a>
</p>
<p align="center">OpenCode TUI 的本地语音转文字插件。</p>
<p align="center">
  <img alt="status" src="https://img.shields.io/badge/status-mvp-orange?style=flat-square" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" />
  <img alt="opencode" src="https://img.shields.io/badge/opencode-%3E%3D1.17.4-black?style=flat-square" />
  <img alt="stt" src="https://img.shields.io/badge/STT-local_whisper.cpp-purple?style=flat-square" />
</p>

<p align="center">
  <a href="../README.md">English</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.es.md">Español</a>
</p>

---

### 安装

通过 OpenCode 一条命令安装：

```bash
opencode plugin @hxnnxs/opencode-voice
```

安装后重启 OpenCode。首次启动会自动下载 managed `whisper.cpp` engine 和你选择的模型。用户不需要手动安装 `whisper-cli`。

可选 CLI 安装器。它会运行相同的 OpenCode plugin install 命令，并预下载 managed engine：

```bash
npx @hxnnxs/opencode-voice install
```

除非你要开发插件，否则不需要 clone 仓库。

> [!TIP]
> 首次启动会打开模型选择器。选择 Whisper 模型，等待下载完成，然后用 `ctrl+r` 向 prompt 听写。

### 要求

插件会管理 STT engine 和模型：

- 从 opencode-voice GitHub Release registry 下载 `whisper.cpp`
- 存到 `~/.cache/opencode-voice/engines/whisper.cpp/<platform>-<arch>/`
- 首次 setup 时下载你选择的 Whisper 模型

手动安装 `whisper-cli` 是可选项。如果本机已有 binary，`opencode-voice` 仍然可以导入或使用它。

检查本机环境：

```bash
npx @hxnnxs/opencode-voice doctor
```

不打开 OpenCode 也可以安装 managed engine：

```bash
npx @hxnnxs/opencode-voice engine install whisper.cpp
```

### 使用

命令：

- `/voice` - 切换录音并插入转写文本
- `/voice-submit` - 切换录音，插入转写文本并提交
- `/voice-stop` - 取消当前录音或转写
- `/voice-settings` - 打开模型、快捷键、麦克风和诊断设置

默认快捷键：

```txt
ctrl+r -> 开始录音
ctrl+r -> 停止、转写并插入文本
```

使用 `/voice-settings` -> **Recording** 配置一个录音快捷键。当前使用 toggle 模式：第一次按下开始录音，第二次按下停止、转写并插入文本。Hold-to-talk 需要 OpenCode 向 TUI 插件提供按键释放事件，因此目前不可用。

### 模型

当前通过 `whisper.cpp` 可用：

| 模型                 | 大小   | 说明                    |
| -------------------- | ------ | ----------------------- |
| Whisper Small        | 465 MB | 默认，多语言            |
| Whisper Medium Q4_1  | 469 MB | 更高准确率              |
| Whisper Turbo        | 1.5 GB | 大模型，比 full large 快 |
| Whisper Large Q5_0   | 1.0 GB | 准确，但更慢            |

模型下载支持断点续传、重试、进度显示和 SHA256 校验。

通过 `transcribe-cpp` sidecar 可用的 Handy 模型系列：

- Parakeet、Nemotron、GigaAM
- Moonshine、Canary、Cohere、SenseVoice、Fun-ASR
- Whisper、Breeze、Voxtral、Qwen、Granite

### 平台状态

| 平台    | 状态 |
| ------- | ---- |
| Linux   | 一条命令安装 engine/model；录音使用 `arecord`、`ffmpeg` 或 `sox` |
| macOS   | 一条命令安装 engine/model；native recorder sidecar 发布前使用 `ffmpeg` AVFoundation |
| Windows | 一条命令安装 engine/model/recorder；通过 managed cached `ffmpeg.exe` + DirectShow 录音，并保留系统/内置 ffmpeg 备用 |

### 架构

该包采用 OpenCode community TUI 插件使用的公共结构。

- npm package 导出 `./tui`
- 本地开发可以在 `tui.json` 中使用绝对路径
- 发布后使用 `opencode plugin @hxnnxs/opencode-voice` 安装
- runtime settings 存储在 OpenCode TUI plugin storage 中

文件：

- `index.js` - TUI 插件入口、命令、dialogs、keymap layer
- `lib/models.js` - 模型 registry、cache paths、default settings
- `lib/download.js` - 可续传下载和 SHA256 校验
- `lib/engine.js` - recorder 选择、managed Windows recorder 安装和 `whisper-cli` 转写
- `lib/engines.js` - managed native engine 下载、状态、导入和移除
- `bin/opencode-voice.js` - install wrapper 和 diagnostics CLI

语音输入需要 native audio 和 STT binaries。JS 插件负责 OpenCode UI、settings、engine/model downloads 和 prompt insertion。未来的 native sidecar 应替换 shell recorders，并加入 fast VAD 和 Handy-style models。

### Roadmap

- npm release 前发布 managed `whisper-cli` release assets
- 使用 `cpal` 和 VAD 的 Rust recorder sidecar
- 支持 Parakeet、GigaAM、SenseVoice、Canary 和 Moonshine
- 更完善的 Windows 录音体验和稳定性
- 更快的 streaming-style transcription

### 开发

运行检查：

```bash
npm run check
npm pack --dry-run
```

此 MVP 没有 build step。

从 checkout 安装开发版本：

```bash
git clone https://github.com/ihxnnxs/opencode-voice.git opencode-voice
cd opencode-voice
opencode plugin "$(pwd)"
```

### 项目状态

这是独立的 OpenCode plugin。它不是 OpenCode 团队构建的项目，也不隶属于 OpenCode。

### 鸣谢

- OpenCode wordmark SVG 改编自公开的 [OpenCode repository](https://github.com/anomalyco/opencode)。`voice` 标记为本插件新增。
- [Handy](https://github.com/cjpais/Handy) 启发了 local-first 模型体验，并提供本插件固定版本并验证的 `transcribe.cpp` 模型目录。
- 本地 Whisper 转写使用 [`whisper.cpp`](https://github.com/ggml-org/whisper.cpp)。
- Handy GGUF 模型通过 Rust binding [`transcribe-cpp`](https://crates.io/crates/transcribe-cpp) 及其 upstream `transcribe.cpp` runtime 运行。
- 平台需要时，录音和转换使用 [FFmpeg](https://ffmpeg.org/)；managed 分发使用 [`ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static)。
- 模型文件由 [Hugging Face](https://huggingface.co/) 托管。每个模型的作者和许可证以其 upstream 仓库声明为准；固定的源 URL 保留在 `lib/handy-model-catalog.js` 中。

---

**OpenCode** [Website](https://opencode.ai) | [Docs](https://opencode.ai/docs) | [Discord](https://opencode.ai/discord)
