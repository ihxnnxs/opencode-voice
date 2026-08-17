# Changelog

## 0.2.3 - 2026-08-17

### Fixed

- Repaired unfinalized WAV headers before transcription so recordings interrupted by forced recorder termination remain usable.

## 0.2.2 - 2026-08-16

### Fixed

- Restored the TUI-only plugin export required by OpenCode 1.18.

## 0.2.1 - 2026-08-16

### Fixed

- Added the required no-op server export so the TUI plugin loads in OpenCode 1.18 and later.

## 0.2.0 - 2026-08-10

### Added

- Added the managed Rust `transcribe-cpp` sidecar and 68 verified GGUF ASR models from Handy's catalog, including GigaAM, Parakeet, Moonshine, Canary, SenseVoice, Qwen, Voxtral, and Granite families.
- Added managed engine install, status, import, remove, and diagnostics support for both `whisper.cpp` and `transcribe-cpp`.
- Added `opencode-voice update` to update an installed plugin.

### Changed

- Reorganized voice settings around one recording key and grouped transcription and system settings.
- Hold-to-talk is now shown as unavailable until OpenCode exposes reliable terminal key-release events to TUI plugins.

### Fixed

- Fixed Windows recorder startup to try DirectShow's enumerated microphone names when no microphone is configured. DirectShow's `audio=default` alias is retained only as a final fallback because it is not reliably supported.
- Expanded recorder startup errors with the exact `ffmpeg` command and captured `ffmpeg` stderr to make Windows microphone failures actionable.
- Added standard Handy-equivalent Whisper variants plus verified Tiny, Base, Small, Medium, and Turbo GGML quantizations to the local Whisper model picker.

All notable changes to this project are documented here.

## 0.1.9 - 2026-06-21

### Fixed

- Rebuilt the managed Windows `whisper-cli.exe` engine asset as a static MinGW binary so clean Windows installs do not need the Visual C++ runtime DLLs.
- Fixed managed engine path handling so explicit `downloadDir` and Windows platform overrides are honored consistently.
- Added streaming timeout protection and clearer VC++ runtime diagnostics to managed engine downloads and probes.

## 0.1.8 - 2026-06-21

### Fixed

- Added a managed Windows recorder install: the plugin can now download, unpack, cache, and probe `ffmpeg.exe` itself before recording, so Windows voice input no longer depends on `ffmpeg-static` lifecycle scripts, npm recovery installs, or a user-installed recorder on `PATH`.
- Extended `opencode-voice doctor` diagnostics to prepare and report the managed Windows recorder path, manifest, install error, and probe result.
- Made managed native binary replacement retry-safe on Windows for both recorder and `whisper-cli` engine installs.

## 0.1.7 - 2026-06-17

### Fixed

- Hardened Windows ffmpeg resolution to handle executable-resolution edge cases (extensionless bundled binary paths and local module fallback), so recorder startup can use the actual resolved binary path.
- Improved diagnostics to print exact recorder command paths and quick per-command probe results in `opencode-voice doctor` output.

## 0.1.6 - 2026-06-17

### Fixed

- Fixed Windows recorder startup to use resolved recorder command paths (including bundled ffmpeg) directly when spawning, preventing startup failures when ffmpeg is present only by absolute path.

## 0.1.5 - 2026-06-17

### Fixed

- Recovered missing `ffmpeg-static` at runtime on Windows by installing it locally when not present, preventing `No recorder found` failures after fresh plugin installs.

## 0.1.4 - 2026-06-16

### Added

- Added bundled `ffmpeg` fallback for Windows recorder flow via `ffmpeg-static` so voice input no longer depends on user-installed `ffmpeg`.
- Added Windows DirectShow microphone discovery and input handling in the recorder layer.

## 0.1.3 - 2026-06-15

### Fixed

- Made Windows engine and model downloads more reliable with five install attempts, longer transfer stall timeouts, safer resume validation, and retrying final file replacement.
- Added HuggingFace fallback mirrors for Whisper models that have upstream mirror assets.

## 0.1.2 - 2026-06-15

### Fixed

- Pinned npm package README metadata to the primary English `README.md`.
- Moved localized READMEs under `docs/` so npm does not select them as the package README.

## 0.1.1 - 2026-06-15

### Fixed

- Fixed Windows managed engine install/import probing by keeping temporary `whisper-cli` binaries executable as `.exe` files.

### Changed

- Ignored local CodeGraph index files.

## 0.1.0 - 2026-06-12

### Added

- Initial OpenCode TUI voice input plugin.
- Local `whisper.cpp` transcription flow with model selection and verified downloads.
- Helper CLI for install guidance and local diagnostics.
- Managed engine status/import/remove commands for local `whisper-cli`.
- Managed engine auto-install from the opencode-voice GitHub Release registry.
- GitHub Actions workflow for building and publishing `whisper-cli` engine assets.
- Model verification markers so existing model files must pass SHA256 before activation.
- GitHub Actions release check workflow.
- npm packaging metadata and release checks.
