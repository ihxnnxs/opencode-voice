<p align="center">
  <a href="https://github.com/ihxnnxs/opencode-voice">
    <picture>
      <source srcset="assets/opencode-voice-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="assets/opencode-voice-light.svg" media="(prefers-color-scheme: light)">
      <img src="assets/opencode-voice-light.svg" alt="opencode voice logo">
    </picture>
  </a>
</p>
<p align="center">Local speech-to-text for the OpenCode TUI.</p>
<p align="center">
  <img alt="status" src="https://img.shields.io/badge/status-mvp-orange?style=flat-square" />
  <a href="https://www.npmjs.com/package/@hxnnxs/opencode-voice"><img alt="npm version" src="https://img.shields.io/npm/v/@hxnnxs/opencode-voice?style=flat-square" /></a>
  <a href="https://www.npmjs.com/package/@hxnnxs/opencode-voice"><img alt="npm downloads" src="https://img.shields.io/npm/dm/@hxnnxs/opencode-voice?style=flat-square" /></a>
  <img alt="license" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" />
  <img alt="opencode" src="https://img.shields.io/badge/opencode-%3E%3D1.17.4-black?style=flat-square" />
  <img alt="stt" src="https://img.shields.io/badge/STT-local_whisper.cpp-purple?style=flat-square" />
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.es.md">Español</a>
</p>

---

### Installation

One command through OpenCode:

```bash
opencode plugin @hxnnxs/opencode-voice
```

Restart OpenCode after installing. First launch downloads the managed `whisper.cpp` engine and then the selected model. The user does not install `whisper-cli` manually.

Optional CLI installer. It runs the same OpenCode plugin install command and pre-downloads the managed engine:

```bash
npx @hxnnxs/opencode-voice install
```

Do not clone the repo unless you want to develop the plugin.

> [!TIP]
> First launch opens a model picker. Choose a Whisper model, let it download, then use `ctrl+r` to dictate into the prompt.

### Requirements

The plugin manages the STT engine and models:

- downloads `whisper.cpp` from the opencode-voice GitHub Release registry
- stores it in `~/.cache/opencode-voice/engines/whisper.cpp/<platform>-<arch>/`
- downloads the selected Whisper model on first setup

Manual `whisper-cli` install is optional. If a local binary already exists, `opencode-voice` can still import or use it.

Check your machine:

```bash
npx @hxnnxs/opencode-voice doctor
```

Install the managed engine without opening OpenCode:

```bash
npx @hxnnxs/opencode-voice engine install whisper.cpp
```

### Usage

Commands:

- `/voice` - toggle recording and append transcription
- `/voice-submit` - toggle recording, append transcription, and submit
- `/voice-stop` - cancel active recording or transcription
- `/voice-settings` - open model, hotkey, microphone, and diagnostics settings

Default hotkey:

```txt
ctrl+r -> start recording
ctrl+r -> stop, transcribe, and append
```

Hold-to-talk is disabled by default because terminal release events vary by terminal. You can still configure a hold hotkey in `/voice-settings`.

### Models

Available now through `whisper.cpp`:

| Model                | Size   | Notes                         |
| -------------------- | ------ | ----------------------------- |
| Whisper Small        | 465 MB | default, multilingual         |
| Whisper Medium Q4_1  | 469 MB | better accuracy               |
| Whisper Turbo        | 1.5 GB | large, faster than full large |
| Whisper Large Q5_0   | 1.0 GB | accurate, slower              |

Model downloads support resume, retry, progress, and SHA256 verification.

Planned sidecar models:

- Parakeet V3
- GigaAM v3
- Moonshine V2 Small

### Platform Status

| Platform | Status |
| -------- | ------ |
| Linux    | one-command engine/model install; recording uses `arecord`, `ffmpeg`, or `sox` |
| macOS    | one-command engine/model install; recording uses `ffmpeg` AVFoundation until the native recorder sidecar ships |
| Windows  | engine download path ready; recording needs the native recorder sidecar |

### Architecture

The package follows the public OpenCode TUI plugin shape used by community plugins.

- npm package exports `./tui`
- local development can point `tui.json` at an absolute path
- published install uses `opencode plugin @hxnnxs/opencode-voice`
- runtime settings live in OpenCode TUI plugin storage

Files:

- `index.js` - TUI plugin entrypoint, commands, dialogs, keymap layer
- `lib/models.js` - model registry, cache paths, default settings
- `lib/download.js` - resumable model download and SHA256 verification
- `lib/engine.js` - recorder selection and `whisper-cli` transcription
- `lib/engines.js` - managed native engine download, status, import, and removal
- `bin/opencode-voice.js` - install wrapper and diagnostics CLI

Voice input needs native audio and STT binaries. The JS plugin manages OpenCode UI, settings, engine/model downloads, and prompt insertion. A future native sidecar should replace shell recorders and add fast VAD plus Handy-style models.

### Roadmap

- publish managed `whisper-cli` release assets before npm release
- Rust recorder sidecar with `cpal` and VAD
- Parakeet, GigaAM, SenseVoice, Canary, and Moonshine model support
- Windows recorder support
- faster streaming-style transcription

### Development

Run checks:

```bash
npm run check
npm pack --dry-run
```

This MVP has no build step.

Development install from a checkout:

```bash
git clone https://github.com/ihxnnxs/opencode-voice.git opencode-voice
cd opencode-voice
opencode plugin "$(pwd)"
```

### Project Status

This is an independent OpenCode plugin. It is not built by the OpenCode team and is not affiliated with OpenCode.

### Credits

- OpenCode wordmark SVG adapted from the public [OpenCode repository](https://github.com/anomalyco/opencode). The `voice` mark was added for this plugin.
- Local transcription uses [`whisper.cpp`](https://github.com/ggml-org/whisper.cpp).
- Model download metadata follows the local-first UX researched from [Handy](https://github.com/cjpais/Handy).

---

**OpenCode** [Website](https://opencode.ai) | [Docs](https://opencode.ai/docs) | [Discord](https://opencode.ai/discord)
