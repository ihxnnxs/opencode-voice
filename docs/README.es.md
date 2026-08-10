<p align="center">
  <a href="https://github.com/ihxnnxs/opencode-voice">
    <picture>
      <source srcset="../assets/opencode-voice-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="../assets/opencode-voice-light.svg" media="(prefers-color-scheme: light)">
      <img src="../assets/opencode-voice-light.svg" alt="opencode voice logo">
    </picture>
  </a>
</p>
<p align="center">Speech-to-text local para OpenCode TUI.</p>
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

### Instalación

Una sola orden mediante OpenCode:

```bash
opencode plugin @hxnnxs/opencode-voice
```

Reinicia OpenCode después de instalar. En el primer inicio, el plugin descarga el managed `whisper.cpp` engine y el modelo elegido. El usuario no instala `whisper-cli` manualmente.

Instalador CLI opcional. Ejecuta el mismo comando de instalación de OpenCode y predescarga el managed engine:

```bash
npx @hxnnxs/opencode-voice install
```

No clones el repositorio salvo que quieras desarrollar el plugin.

> [!TIP]
> El primer inicio abre un selector de modelo. Elige un modelo Whisper, espera la descarga y usa `ctrl+r` para dictar en el prompt.

### Requisitos

El plugin gestiona el STT engine y los modelos:

- descarga `whisper.cpp` desde el GitHub Release registry de opencode-voice
- lo guarda en `~/.cache/opencode-voice/engines/whisper.cpp/<platform>-<arch>/`
- descarga el modelo Whisper elegido durante el primer setup

Instalar `whisper-cli` manualmente es opcional. Si ya existe un binary local, `opencode-voice` puede importarlo o usarlo.

Comprueba tu máquina:

```bash
npx @hxnnxs/opencode-voice doctor
```

Instala el managed engine sin abrir OpenCode:

```bash
npx @hxnnxs/opencode-voice engine install whisper.cpp
```

### Uso

Comandos:

- `/voice` - alterna la grabación e inserta la transcripción
- `/voice-submit` - alterna la grabación, inserta la transcripción y envía
- `/voice-stop` - cancela la grabación o transcripción activa
- `/voice-settings` - abre ajustes de modelo, hotkeys, micrófono y diagnóstico

Hotkey por defecto:

```txt
ctrl+r -> iniciar grabación
ctrl+r -> detener, transcribir e insertar texto
```

Hold-to-talk está desactivado por defecto porque los terminal release events cambian entre terminales. Puedes configurar un hotkey hold en `/voice-settings`.

### Modelos

Disponibles ahora mediante `whisper.cpp`:

| Modelo               | Tamaño | Notas                         |
| -------------------- | ------ | ----------------------------- |
| Whisper Small        | 465 MB | por defecto, multilingue      |
| Whisper Medium Q4_1  | 469 MB | mejor precisión               |
| Whisper Turbo        | 1.5 GB | grande, más rápido que large completo |
| Whisper Large Q5_0   | 1.0 GB | preciso, más lento            |

Las descargas de modelos soportan resume, retry, progreso y verificación SHA256.

Modelos sidecar planeados:

- Parakeet V3
- GigaAM v3
- Moonshine V2 Small

### Estado Por Plataforma

| Plataforma | Estado |
| ---------- | ------ |
| Linux      | instalación engine/model en una orden; la grabación usa `arecord`, `ffmpeg` o `sox` |
| macOS      | instalación engine/model en una orden; la grabación usa `ffmpeg` AVFoundation hasta el native recorder sidecar |
| Windows    | instalación one-command de engine/model/recorder; grabación con DirectShow mediante `ffmpeg.exe` managed en caché, con fallback a ffmpeg del sistema/incluido |

### Arquitectura

El paquete sigue la forma pública de plugin TUI que usan los plugins de la comunidad de OpenCode.

- npm package exporta `./tui`
- el desarrollo local puede apuntar `tui.json` a una ruta absoluta
- la instalación publicada usa `opencode plugin @hxnnxs/opencode-voice`
- runtime settings viven en OpenCode TUI plugin storage

Archivos:

- `index.js` - entrada TUI, comandos, dialogs, keymap layer
- `lib/models.js` - registry de modelos, cache paths, default settings
- `lib/download.js` - descarga resumible y verificación SHA256
- `lib/engine.js` - selección de recorder, instalación managed del recorder Windows y transcripción con `whisper-cli`
- `lib/engines.js` - descarga, estado, importación y eliminación de managed native engine
- `bin/opencode-voice.js` - install wrapper y diagnostics CLI

La entrada por voz necesita native audio y STT binaries. El plugin JS gestiona OpenCode UI, settings, engine/model downloads y prompt insertion. Un native sidecar futuro debe reemplazar shell recorders y añadir fast VAD más Handy-style models.

### Roadmap

- publicar managed `whisper-cli` release assets antes del npm release
- Rust recorder sidecar con `cpal` y VAD
- soporte para Parakeet, GigaAM, SenseVoice, Canary y Moonshine
- Mejorar estabilidad y UX del recorder en Windows
- streaming-style transcription más rápida

### Desarrollo

Ejecuta las comprobaciones:

```bash
npm run check
npm pack --dry-run
```

Este MVP no tiene build step.

Instalación de desarrollo desde un checkout:

```bash
git clone https://github.com/ihxnnxs/opencode-voice.git opencode-voice
cd opencode-voice
opencode plugin "$(pwd)"
```

### Estado Del Proyecto

Este es un OpenCode plugin independiente. No está construido por el equipo de OpenCode y no está afiliado con OpenCode.

### Créditos

- OpenCode wordmark SVG adaptado del [OpenCode repository](https://github.com/anomalyco/opencode). La marca `voice` se añadió para este plugin.
- [Handy](https://github.com/cjpais/Handy) inspiró la experiencia local-first y aporta el catálogo de modelos `transcribe.cpp` que este plugin fija y verifica.
- La transcripción local de Whisper usa [`whisper.cpp`](https://github.com/ggml-org/whisper.cpp).
- Los modelos GGUF de Handy se ejecutan mediante el binding Rust [`transcribe-cpp`](https://crates.io/crates/transcribe-cpp) y su runtime upstream `transcribe.cpp`.
- La grabación y conversión usan [FFmpeg](https://ffmpeg.org/) cuando la plataforma lo necesita; la distribución managed usa [`ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static).
- Los artefactos de modelos están alojados en [Hugging Face](https://huggingface.co/). Los autores y licencias de cada modelo son los declarados en su repositorio upstream; las URL de origen fijadas se conservan en `lib/handy-model-catalog.js`.

---

**OpenCode** [Website](https://opencode.ai) | [Docs](https://opencode.ai/docs) | [Discord](https://opencode.ai/discord)
