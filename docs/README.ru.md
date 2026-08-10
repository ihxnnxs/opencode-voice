<p align="center">
  <a href="https://github.com/ihxnnxs/opencode-voice">
    <picture>
      <source srcset="../assets/opencode-voice-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="../assets/opencode-voice-light.svg" media="(prefers-color-scheme: light)">
      <img src="../assets/opencode-voice-light.svg" alt="opencode voice logo">
    </picture>
  </a>
</p>
<p align="center">Локальный speech-to-text для OpenCode TUI.</p>
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

### Установка

Одна команда через OpenCode:

```bash
opencode plugin @hxnnxs/opencode-voice
```

Перезапустите OpenCode после установки. При первом запуске плагин сам скачает managed `whisper.cpp` engine и выбранную модель. Пользователь не ставит `whisper-cli` руками.

Опциональный CLI-установщик. Он запускает ту же установку через OpenCode и заранее скачивает managed engine:

```bash
npx @hxnnxs/opencode-voice install
```

Не клонируйте репозиторий, если не собираетесь разрабатывать плагин.

> [!TIP]
> При первом запуске откроется выбор модели. Выберите Whisper-модель, дождитесь загрузки и используйте `ctrl+r`, чтобы диктовать в prompt.

### Требования

Плагин сам управляет STT engine и моделями:

- скачивает `whisper.cpp` из GitHub Release registry проекта
- кладет его в `~/.cache/opencode-voice/engines/whisper.cpp/<platform>-<arch>/`
- скачивает выбранную Whisper-модель при первом setup

Ручная установка `whisper-cli` не нужна. Если локальный binary уже есть, `opencode-voice` всё ещё может импортировать или использовать его.

Проверить машину:

```bash
npx @hxnnxs/opencode-voice doctor
```

Установить managed engine без открытия OpenCode:

```bash
npx @hxnnxs/opencode-voice engine install whisper.cpp
```

### Использование

Команды:

- `/voice` - переключить запись и вставить транскрипцию
- `/voice-submit` - переключить запись, вставить транскрипцию и отправить
- `/voice-stop` - отменить активную запись или транскрибацию
- `/voice-settings` - открыть настройки модели, хоткеев, микрофона и диагностики

Хоткей по умолчанию:

```txt
ctrl+r -> начать запись
ctrl+r -> остановить, распознать и вставить текст
```

Hold-to-talk отключен по умолчанию, потому что terminal release events зависят от терминала. Его можно включить в `/voice-settings`.

### Модели

Доступно сейчас через `whisper.cpp`:

| Модель              | Размер | Примечание                    |
| ------------------- | ------ | ----------------------------- |
| Whisper Small       | 465 MB | дефолт, multilingual          |
| Whisper Medium Q4_1 | 469 MB | выше точность                 |
| Whisper Turbo       | 1.5 GB | крупная, быстрее full large   |
| Whisper Large Q5_0  | 1.0 GB | точная, медленнее             |

Загрузка моделей поддерживает resume, retry, progress и SHA256 verification.

Запланированные sidecar-модели:

- Parakeet V3
- GigaAM v3
- Moonshine V2 Small

### Статус платформ

| Платформа | Статус |
| --------- | ------ |
| Linux     | one-command engine/model install; запись использует `arecord`, `ffmpeg` или `sox` |
| macOS     | one-command engine/model install; запись использует `ffmpeg` AVFoundation до native recorder sidecar |
| Windows   | one-command engine/model/recorder install; запись через DirectShow и managed cached `ffmpeg.exe`, с fallback на системный/встроенный ffmpeg |

### Архитектура

Пакет повторяет публичную форму OpenCode TUI-плагинов, которую используют community-плагины.

- npm package экспортирует `./tui`
- локальная разработка может указать абсолютный путь в `tui.json`
- published install использует `opencode plugin @hxnnxs/opencode-voice`
- runtime settings хранятся в OpenCode TUI plugin storage

Файлы:

- `index.js` - TUI entrypoint, команды, dialogs, keymap layer
- `lib/models.js` - registry моделей, cache paths, default settings
- `lib/download.js` - resumable download и SHA256 verification
- `lib/engine.js` - выбор recorder, managed Windows recorder install и transcription через `whisper-cli`
- `lib/engines.js` - managed native engine download, status, import и removal
- `bin/opencode-voice.js` - install wrapper и diagnostics CLI

Voice input требует native audio и STT binaries. JS-плагин управляет OpenCode UI, settings, engine/model downloads и prompt insertion. Будущий native sidecar должен заменить shell recorders и добавить fast VAD плюс Handy-style models.

### Roadmap

- опубликовать managed `whisper-cli` release assets перед npm release
- Rust recorder sidecar с `cpal` и VAD
- поддержка Parakeet, GigaAM, SenseVoice, Canary и Moonshine
- Улучшение устойчивости и UX Windows recorder
- более быстрая streaming-style transcription

### Разработка

Запустить проверки:

```bash
npm run check
npm pack --dry-run
```

У этого MVP нет build step.

Установка из checkout для разработки:

```bash
git clone https://github.com/ihxnnxs/opencode-voice.git opencode-voice
cd opencode-voice
opencode plugin "$(pwd)"
```

### Статус проекта

Это независимый OpenCode plugin. Его не разрабатывает команда OpenCode, и он не связан с OpenCode официально.

### Кредиты

- OpenCode wordmark SVG адаптирован из публичного [OpenCode repository](https://github.com/anomalyco/opencode). Метка `voice` добавлена для этого плагина.
- [Handy](https://github.com/cjpais/Handy) вдохновил local-first UX и предоставляет каталог моделей `transcribe.cpp`, который плагин закрепляет по ревизии и проверяет.
- Локальная транскрибация Whisper использует [`whisper.cpp`](https://github.com/ggml-org/whisper.cpp).
- GGUF-модели Handy работают через Rust binding [`transcribe-cpp`](https://crates.io/crates/transcribe-cpp) и его upstream runtime `transcribe.cpp`.
- Для записи и конвертации там, где это требуется платформе, используется [FFmpeg](https://ffmpeg.org/); managed-дистрибуция использует [`ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static).
- Артефакты моделей размещены на [Hugging Face](https://huggingface.co/). Авторы и лицензии каждой модели определяются её upstream-репозиторием; закреплённые URL источников сохранены в `lib/handy-model-catalog.js`.

---

**OpenCode** [Website](https://opencode.ai) | [Docs](https://opencode.ai/docs) | [Discord](https://opencode.ai/discord)
