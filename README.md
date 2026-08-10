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
  <a href="docs/README.ru.md">Русский</a> |
  <a href="docs/README.zh.md">简体中文</a> |
  <a href="docs/README.es.md">Español</a>
</p>

---

## Install

One command through OpenCode:

```bash
opencode plugin @hxnnxs/opencode-voice
```

Restart OpenCode after installing. On first launch, choose a model. The plugin downloads its required local runtime and model weights automatically. Audio and transcription stay on your machine.

Optional CLI installer. It runs the same OpenCode plugin install command and pre-downloads the managed engine:

```bash
npx @hxnnxs/opencode-voice install
```

Update an installed plugin to the latest published version, then restart OpenCode:

```bash
npx @hxnnxs/opencode-voice update
```

Add `--global` if the plugin was installed in OpenCode's global configuration.

Do not clone the repo unless you want to develop the plugin.

> [!TIP]
> First launch opens a model picker. Choose a local model, let it download, then use `ctrl+r` to dictate into the prompt.

## What It Installs

The plugin manages the STT engine and models:

- downloads `whisper.cpp` or the Rust `transcribe-cpp` sidecar from the opencode-voice GitHub Release registry
- stores each runtime in `~/.cache/opencode-voice/engines/<engine>/<platform>-<arch>/`
- downloads the selected model on first setup

Manual runtime installation is optional. Existing `whisper-cli` or `opencode-voice-transcribe` binaries can also be imported through the CLI.

Check your machine:

```bash
npx @hxnnxs/opencode-voice doctor
```

Install or inspect a managed runtime without opening OpenCode:

```bash
npx @hxnnxs/opencode-voice engine install transcribe-cpp
npx @hxnnxs/opencode-voice engine status transcribe-cpp
```

## Use It

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

In `/voice-settings` -> **Recording**, choose one **Record key**. Toggle recording starts on the first press and transcribes on the second. Hold-to-talk is shown as unavailable until OpenCode exposes terminal key-release events to TUI plugins.

Settings also let you select a microphone, language, model, download location, and whether `/voice` submits the prompt after transcription.

## Models

The picker includes 19 `whisper.cpp` GGML choices and 68 ASR GGUF models from Handy's `transcribe.cpp` catalog. Pick one model at a time; only that model is downloaded.

Useful `whisper.cpp` starting points:

| Model                | Size   | Notes                         |
| -------------------- | ------ | ----------------------------- |
| Whisper Tiny Q5_1    | 31 MB  | fastest, lowest accuracy      |
| Whisper Base Q5_1    | 57 MB  | small multilingual option     |
| Whisper Small Q5_1   | 181 MB | compact Small                 |
| Whisper Small        | 465 MB | default, multilingual         |
| Whisper Medium Q4_1  | 469 MB | Handy-compatible quantization |
| Whisper Medium Q5_0  | 514 MB | higher-quality multilingual   |
| Whisper Turbo Q5_0   | 547 MB | compact large-v3 Turbo        |
| Whisper Turbo        | 1.5 GB | large, faster than full large |
| Whisper Large Q5_0   | 1.0 GB | accurate, slower              |

The managed `transcribe-cpp` sidecar provides these Handy catalog families. Diarization and VAD assets are excluded because they do not produce text through the transcription runtime.

| Model | Size | Notes |
| --- | --- | --- |
| Parakeet, Nemotron, GigaAM | varies | English, multilingual, and Russian models |
| Moonshine | varies | English plus language-specific variants |
| Canary, Cohere, SenseVoice, Fun-ASR | varies | multilingual and specialized recognizers |
| Whisper, Breeze, Voxtral, Qwen, Granite | varies | general-purpose and language-specialized models |

Model downloads support resume, retry, progress, and SHA256 verification. Sidecar catalog URLs are pinned to an upstream Hugging Face revision and their LFS SHA-256 digest, so a model cannot be activated until its expected artifact verifies.

> [!NOTE]
> Large models can require multiple gigabytes of disk space and significant memory. Start with Whisper Small, GigaAM V3 for Russian, or Parakeet for a fast GGUF option.

## Troubleshooting

Run diagnostics first:

```bash
npx @hxnnxs/opencode-voice doctor
```

- `Engine not found in registry: transcribe-cpp`: the installed plugin expects a release registry that does not yet include the sidecar. Update the plugin after its matching Engine Release is published, or locally import a built sidecar with `opencode-voice engine import transcribe-cpp <path>`.
- `Could not start recorder` on Windows: open `/voice-settings` and select the enumerated microphone rather than relying on the system default. The error includes the exact `ffmpeg` command and stderr for diagnosis.
- Hold-to-talk is unavailable: current OpenCode releases do not expose terminal key-release events to TUI plugins. Use the default `ctrl+r` toggle mode instead.

## Platform Status

| Platform | Status |
| -------- | ------ |
| Linux    | one-command engine/model install; recording uses `arecord`, `ffmpeg`, or `sox` |
| macOS    | one-command engine/model install; recording uses `ffmpeg` AVFoundation until the native recorder sidecar ships |
| Windows  | one-command engine/model/recorder install; recording uses DirectShow through a managed cached `ffmpeg.exe`, with system/bundled ffmpeg fallback |

## Architecture

The package follows the public OpenCode TUI plugin shape used by community plugins.

- npm package exports `./tui`
- local development can point `tui.json` at an absolute path
- published install uses `opencode plugin @hxnnxs/opencode-voice`
- runtime settings live in OpenCode TUI plugin storage

Files:

- `index.js` - TUI plugin entrypoint, commands, dialogs, keymap layer
- `lib/models.js` - model registry, cache paths, default settings
- `lib/download.js` - resumable model download and SHA256 verification
- `lib/engine.js` - recorder selection, managed Windows recorder install, and runtime-routed transcription
- `lib/engines.js` - managed native engine download, status, import, and removal
- `lib/handy-model-catalog.js` - pinned Handy GGUF model metadata
- `bin/opencode-voice.js` - install wrapper and diagnostics CLI
- `sidecar/` - Rust `transcribe-cpp` command-line runtime for GGUF models

Voice input needs native audio and STT binaries. The JS plugin manages OpenCode UI, settings, model downloads, and prompt insertion. The managed Rust sidecar provides the `transcribe.cpp` runtime for supported GGUF model families.

## Roadmap

- Rust recorder sidecar with `cpal` and VAD
- streaming transcription for sidecar models
- Windows recorder stability and UX polish

## Development

Run checks:

```bash
npm run check
npm pack --dry-run
cargo check --manifest-path sidecar/Cargo.toml
```

The JavaScript plugin has no frontend build step. The optional GGUF runtime is a Rust sidecar built by the Engine Release workflow.

Use the current checkout in OpenCode:

```bash
git clone https://github.com/ihxnnxs/opencode-voice.git opencode-voice
cd opencode-voice
opencode plugin "$(pwd)"
```

## Project Status

This is an independent OpenCode plugin. It is not built by the OpenCode team and is not affiliated with OpenCode.

## Credits

- OpenCode wordmark SVG adapted from the public [OpenCode repository](https://github.com/anomalyco/opencode). The `voice` mark was added for this plugin.
- [Handy](https://github.com/cjpais/Handy) inspired the local-first model experience and supplies the curated `transcribe.cpp` model catalog this plugin pins and verifies.
- Local Whisper transcription uses [`whisper.cpp`](https://github.com/ggml-org/whisper.cpp).
- Handy GGUF transcription runs through the Rust [`transcribe-cpp`](https://crates.io/crates/transcribe-cpp) binding and its upstream `transcribe.cpp` runtime.
- Recording and conversion rely on [FFmpeg](https://ffmpeg.org/) where the platform recorder requires it; managed distribution uses [`ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static).
- Model artifacts are hosted by [Hugging Face](https://huggingface.co/). Individual model creators and licenses remain those declared by each upstream model repository; their pinned source URLs are retained in `lib/handy-model-catalog.js`.

---

**OpenCode** [Website](https://opencode.ai) | [Docs](https://opencode.ai/docs) | [Discord](https://opencode.ai/discord)
