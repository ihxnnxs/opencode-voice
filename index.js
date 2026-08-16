import { MODELS, DEFAULT_SETTINGS, PLUGIN_ID, formatSize, getCacheDir, getModel, getModelPath, isModelDownloaded, isModelFilePresent } from "./lib/models.js";
import { downloadModel } from "./lib/download.js";
import { VoiceRuntime, ensureManagedRecorder, getRecorderStatus, listMicrophones, probeRecorder, resolveCommand } from "./lib/engine.js";
import { getEngineStatus, importManagedEngine, installManagedEngine, probeEngine, removeManagedEngine } from "./lib/engines.js";

const KV = {
  // Legacy keys are read once by migrateSettings so existing installations keep
  // their configured recording key after upgrading to the unified setting.
  hotkey: "voice.hotkey",
  recordingHotkey: "voice.recordingHotkey",
  toggleHotkey: "voice.toggleHotkey",
  submitHotkey: "voice.submitHotkey",
  model: "voice.model",
  language: "voice.language",
  mic: "voice.mic",
  autoSubmit: "voice.autoSubmit",
  downloadDir: "voice.downloadDir",
  onboardingDone: "voice.onboardingDone",
  setupSkipped: "voice.setupSkipped",
};

function readSettings(kv) {
  const settings = { ...DEFAULT_SETTINGS };
  for (const [name, key] of Object.entries(KV)) settings[name] = kv.get(key, settings[name]);

  if (!getModel(settings.model)?.implemented) settings.model = DEFAULT_SETTINGS.model;
  settings.recordingHotkey = String(settings.recordingHotkey || settings.toggleHotkey || "ctrl+r").trim();
  settings.submitHotkey = String(settings.submitHotkey || "").trim();
  settings.language = String(settings.language || "auto").trim() || "auto";
  settings.mic = String(settings.mic || "").trim();
  settings.downloadDir = String(settings.downloadDir || "").trim();
  settings.autoSubmit = Boolean(settings.autoSubmit);
  settings.onboardingDone = Boolean(settings.onboardingDone);
  settings.setupSkipped = Boolean(settings.setupSkipped);
  return settings;
}

function writeSetting(kv, name, value) {
  kv.set(KV[name], value);
}

function migrateSettings(kv) {
  // Early builds stored separate hold and toggle keys. Preserve the user's
  // explicit hold key first, otherwise retain the old toggle binding.
  const holdHotkey = kv.get(KV.hotkey, undefined);
  if (!kv.get(KV.recordingHotkey, undefined)) {
    const configuredHotkey = String(kv.get(KV.hotkey, "")).trim();
    kv.set(KV.recordingHotkey, configuredHotkey || kv.get(KV.toggleHotkey, DEFAULT_SETTINGS.recordingHotkey));
  }
}

function toast(api, message, variant = "info") {
  api.ui.toast({ title: "Voice", message, variant });
}

function setDialog(ctx, size, render) {
  ctx.api.ui.dialog.setSize(size);
  ctx.api.ui.dialog.replace(render);
}

function formatBytes(value) {
  if (!value || value < 0) return "0 MB";
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(value / 1024 / 1024))} MB`;
}

function formatRate(bytesPerSecond) {
  if (!bytesPerSecond || bytesPerSecond < 1) return "warming up";
  if (bytesPerSecond >= 1024 * 1024) return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`;
  return `${Math.max(1, Math.round(bytesPerSecond / 1024))} KB/s`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 1) return "calculating";
  const total = Math.ceil(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (!minutes) return `${rest}s`;
  return `${minutes}m ${String(rest).padStart(2, "0")}s`;
}

function progressBar(percent) {
  const total = 34;
  const filled = Math.max(0, Math.min(total, Math.round((percent / 100) * total)));
  return `${"█".repeat(filled)}${"░".repeat(total - filled)}`;
}

function progressLine(percent) {
  return `${progressBar(percent)}  ${String(Math.round(percent)).padStart(3, " ")}%`;
}

function renderDownloadStatus(ctx, model, progress = {}) {
  const percent = Math.max(0, Math.min(100, progress.percent || 0));
  const state = progress.state === "verifying" ? "Verifying checksum" : progress.state === "done" ? "Ready" : "Downloading model";
  const downloaded = progress.downloaded || 0;
  const total = progress.total || (model.sizeMB ? model.sizeMB * 1024 * 1024 : 0);
  const remaining = total && progress.speedBps ? (total - downloaded) / progress.speedBps : Number.NaN;
  const attempt = progress.attempts > 1 ? `${progress.attempt} of ${progress.attempts}` : "single pass";

  setDialog(ctx, "xlarge", () =>
    ctx.api.ui.DialogAlert({
      title: "Downloading voice model",
      message: [
        model.name,
        "",
        state,
        progressLine(percent),
        "",
        `${formatBytes(downloaded)} of ${formatBytes(total)}`,
        `${formatRate(progress.speedBps)} · ETA ${formatDuration(remaining)}`,
        `Attempt ${attempt}`,
        progress.state === "verifying" ? "Verifying SHA256 before activating the model." : "Interrupted downloads resume automatically.",
      ].join("\n"),
    }),
  );
}

function renderEngineInstallStatus(ctx, engineId, progress = {}) {
  const percent = Math.max(0, Math.min(100, progress.percent || 0));
  const state = {
    registry: "Loading engine registry",
    downloading: "Downloading whisper.cpp engine",
    verifying: "Verifying engine archive",
    decompressing: "Unpacking engine",
    "verifying-binary": "Verifying engine binary",
    probing: "Checking native binary",
    done: "Native engine ready",
  }[progress.state] || "Preparing native engine";
  const attempt = progress.attempts > 1 ? `${progress.attempt} of ${progress.attempts}` : "single pass";

  setDialog(ctx, "xlarge", () =>
    ctx.api.ui.DialogAlert({
      title: "Installing voice engine",
      message: [
        engineId,
        "",
        state,
        progressLine(percent),
        "",
        progress.total ? `${formatBytes(progress.downloaded || 0)} of ${formatBytes(progress.total)}` : "Fetching release metadata",
        `Attempt ${attempt}`,
        "This is downloaded once into the managed opencode-voice cache.",
      ].join("\n"),
    }),
  );
}

function renderRecorderInstallStatus(ctx, progress = {}) {
  const percent = Math.max(0, Math.min(100, progress.percent || 0));
  const state = {
    downloading: "Downloading Windows recorder",
    decompressing: "Unpacking ffmpeg",
    probing: "Checking ffmpeg",
    done: "Windows recorder ready",
  }[progress.state] || "Preparing Windows recorder";
  const attempt = progress.attempts > 1 ? `${progress.attempt} of ${progress.attempts}` : "single pass";

  setDialog(ctx, "xlarge", () =>
    ctx.api.ui.DialogAlert({
      title: "Installing Windows recorder",
      message: [
        "ffmpeg DirectShow",
        "",
        state,
        progressLine(percent),
        "",
        progress.total ? `${formatBytes(progress.downloaded || 0)} of ${formatBytes(progress.total)}` : "Fetching recorder binary",
        `Attempt ${attempt}`,
        "This is downloaded once into the managed opencode-voice cache.",
      ].join("\n"),
    }),
  );
}

function modelStatus(model, options, settings) {
  if (!model.implemented) return "planned";
  if (isModelFilePresent(model, options, settings) && !isModelDownloaded(model, options, settings)) return "needs verification";
  return isModelDownloaded(model, options, settings) ? "downloaded" : "not downloaded";
}

function modelOptions(options, settings) {
  return MODELS.map((model) => ({
    title: `${model.implemented && isModelDownloaded(model, options, settings) ? "[downloaded]" : model.implemented ? "[download]" : "[planned]"} ${model.name} - ${formatSize(model)}`,
    value: model.id,
    category: model.implemented ? "Available now" : "Planned sidecar models",
    disabled: !model.implemented,
    truncateTitle: false,
    details: [`${model.engine} - ${model.languages} - ${modelStatus(model, options, settings)}`, model.description],
  }));
}

async function ensureDownloaded(ctx, model, settings) {
  if (isModelDownloaded(model, ctx.options, settings)) return true;

  const startedAt = Date.now();
  let lastRender = 0;
  let speedBps = 0;
  renderDownloadStatus(ctx, model, { state: "starting", downloaded: 0, total: model.sizeMB ? model.sizeMB * 1024 * 1024 : 0, percent: 0, attempt: 1, attempts: 5, speedBps });

  toast(ctx.api, `Downloading ${model.name}...`);
  await downloadModel(model, ctx.options, settings, {
    retries: 5,
    onProgress: (progress) => {
      const now = Date.now();
      const elapsed = Math.max(1, (now - startedAt) / 1000);
      speedBps = progress.downloaded ? progress.downloaded / elapsed : speedBps;
      if (progress.state !== "done" && progress.state !== "verifying" && now - lastRender < 350) return;
      lastRender = now;
      renderDownloadStatus(ctx, model, { ...progress, speedBps });
    },
    onRetry: ({ error, nextAttempt, attempts }) => {
      renderDownloadStatus(ctx, model, {
        state: "downloading",
        downloaded: 0,
        total: model.sizeMB ? model.sizeMB * 1024 * 1024 : 0,
        percent: 0,
        attempt: nextAttempt,
        attempts,
        speedBps: 0,
      });
      toast(ctx.api, `Download retry ${nextAttempt}/${attempts}: ${error instanceof Error ? error.message : String(error)}`, "warning");
    },
  });
  toast(ctx.api, `${model.name} downloaded`, "success");
  return true;
}

async function ensureEngineReady(ctx, settings, model = getModel(settings.model)) {
  const engineId = model.engine;
  const commandOptions = { ...ctx.options, downloadDir: settings.downloadDir };
  const current = getEngineStatus(engineId, ctx.options, settings);
  if (current.resolvedBinary) {
    const probe = await probeEngine(engineId, current.resolvedBinary);
    if (probe.ok) return true;
  }

  renderEngineInstallStatus(ctx, engineId, { state: "registry", downloaded: 0, total: 0, percent: 0, attempt: 1, attempts: 5 });
  toast(ctx.api, `Installing ${engineId}...`);
  await installManagedEngine(engineId, commandOptions, settings, {
    retries: 5,
    onProgress: (progress) => renderEngineInstallStatus(ctx, engineId, progress),
    onRetry: ({ error, nextAttempt, attempts }) => {
      renderEngineInstallStatus(ctx, engineId, { state: "downloading", downloaded: 0, total: 0, percent: 0, attempt: nextAttempt, attempts });
      toast(ctx.api, `Engine install retry ${nextAttempt}/${attempts}: ${error instanceof Error ? error.message : String(error)}`, "warning");
    },
  });
  toast(ctx.api, `${engineId} installed`, "success");
  return true;
}

async function ensureRecorderReady(ctx, settings) {
  if (process.platform !== "win32") return true;

  const commandOptions = { ...ctx.options, downloadDir: settings.downloadDir, skipFfmpegStaticInstall: true };
  const current = getRecorderStatus(commandOptions, settings);
  if (current.resolvedBinary) {
    const probe = await probeRecorder(current.resolvedBinary);
    if (probe.ok) return true;
  }

  renderRecorderInstallStatus(ctx, { state: "downloading", downloaded: 0, total: 0, percent: 0, attempt: 1, attempts: 5 });
  toast(ctx.api, "Installing local Windows recorder...");
  await ensureManagedRecorder(commandOptions, settings, {
    retries: 5,
    onProgress: (progress) => renderRecorderInstallStatus(ctx, progress),
    onRetry: ({ error, nextAttempt, attempts }) => {
      renderRecorderInstallStatus(ctx, { state: "downloading", downloaded: 0, total: 0, percent: 0, attempt: nextAttempt, attempts });
      toast(ctx.api, `Recorder install retry ${nextAttempt}/${attempts}: ${error instanceof Error ? error.message : String(error)}`, "warning");
    },
  });
  toast(ctx.api, "Windows recorder installed", "success");
  return true;
}

function showModelPicker(ctx, firstRun = false) {
  const settings = readSettings(ctx.api.kv);
  setDialog(ctx, "large", () =>
    ctx.api.ui.DialogSelect({
      title: firstRun ? "Set up voice input: choose a local model" : "Voice model",
      placeholder: "Search voice models...",
      current: settings.model,
      options: [
        ...modelOptions(ctx.options, settings),
        ...(firstRun
          ? [
              {
                title: "Skip setup for now",
                value: "__skip",
                category: "Setup",
                description: "You can open this again with /voice-settings.",
              },
            ]
          : []),
      ],
      onSelect: async (option) => {
        if (option.value === "__skip") {
          writeSetting(ctx.api.kv, "onboardingDone", true);
          writeSetting(ctx.api.kv, "setupSkipped", true);
          ctx.api.ui.dialog.clear();
          toast(ctx.api, "Voice setup skipped. Use /voice-settings when ready.");
          return;
        }

        const model = getModel(option.value);
        if (!model?.implemented) return;

        const nextSettings = { ...readSettings(ctx.api.kv), model: model.id };
        writeSetting(ctx.api.kv, "model", model.id);
        writeSetting(ctx.api.kv, "onboardingDone", true);
        writeSetting(ctx.api.kv, "setupSkipped", false);

        try {
          await ensureEngineReady(ctx, nextSettings, model);
          await ensureDownloaded(ctx, model, nextSettings);
          ctx.api.ui.dialog.clear();
        } catch (error) {
          showError(ctx, "Voice setup failed", error);
        }
      },
    }),
  );
}

function shouldShowStartupModelPicker(ctx) {
  const settings = readSettings(ctx.api.kv);
  const model = getModel(settings.model);
  return !settings.onboardingDone || (!settings.setupSkipped && !isModelDownloaded(model, ctx.options, settings));
}

function showPrompt(ctx, input) {
  setDialog(ctx, "medium", () =>
    ctx.api.ui.DialogPrompt({
      title: input.title,
      placeholder: input.placeholder,
      value: input.value,
      onConfirm: (value) => {
        input.onConfirm(value);
      },
      onCancel: () => showSettings(ctx),
    }),
  );
}

const WHISPER_LANGUAGES = [
    ["Afrikaans", "af"],
    ["Amharic", "am"],
    ["Arabic", "ar"],
    ["Assamese", "as"],
    ["Azerbaijani", "az"],
    ["Bashkir", "ba"],
    ["Belarusian", "be"],
    ["Bulgarian", "bg"],
    ["Bengali", "bn"],
    ["Tibetan", "bo"],
    ["Breton", "br"],
    ["Bosnian", "bs"],
    ["Catalan", "ca"],
    ["Czech", "cs"],
    ["Welsh", "cy"],
    ["Danish", "da"],
    ["German", "de"],
    ["Greek", "el"],
    ["English", "en"],
    ["Spanish", "es"],
    ["Estonian", "et"],
    ["Basque", "eu"],
    ["Persian", "fa"],
    ["Finnish", "fi"],
    ["Faroese", "fo"],
    ["French", "fr"],
    ["Galician", "gl"],
    ["Gujarati", "gu"],
    ["Hausa", "ha"],
    ["Hawaiian", "haw"],
    ["Hebrew", "he"],
    ["Hindi", "hi"],
    ["Croatian", "hr"],
    ["Haitian Creole", "ht"],
    ["Hungarian", "hu"],
    ["Armenian", "hy"],
    ["Indonesian", "id"],
    ["Icelandic", "is"],
    ["Italian", "it"],
    ["Japanese", "ja"],
    ["Javanese", "jw"],
    ["Georgian", "ka"],
    ["Kazakh", "kk"],
    ["Khmer", "km"],
    ["Kannada", "kn"],
    ["Korean", "ko"],
    ["Latin", "la"],
    ["Luxembourgish", "lb"],
    ["Lingala", "ln"],
    ["Lao", "lo"],
    ["Lithuanian", "lt"],
    ["Latvian", "lv"],
    ["Malagasy", "mg"],
    ["Maori", "mi"],
    ["Macedonian", "mk"],
    ["Malayalam", "ml"],
    ["Mongolian", "mn"],
    ["Marathi", "mr"],
    ["Malay", "ms"],
    ["Maltese", "mt"],
    ["Myanmar", "my"],
    ["Nepali", "ne"],
    ["Dutch", "nl"],
    ["Norwegian Nynorsk", "nn"],
    ["Norwegian", "no"],
    ["Occitan", "oc"],
    ["Punjabi", "pa"],
    ["Pashto", "ps"],
    ["Portuguese", "pt"],
    ["Romanian", "ro"],
    ["Russian", "ru"],
    ["Sanskrit", "sa"],
    ["Sindhi", "sd"],
    ["Sinhala", "si"],
    ["Slovak", "sk"],
    ["Slovenian", "sl"],
    ["Shona", "sn"],
    ["Somali", "so"],
    ["Albanian", "sq"],
    ["Serbian", "sr"],
    ["Sundanese", "su"],
    ["Swedish", "sv"],
    ["Swahili", "sw"],
    ["Tamil", "ta"],
    ["Telugu", "te"],
    ["Tajik", "tg"],
    ["Thai", "th"],
    ["Turkmen", "tk"],
    ["Tagalog", "tl"],
    ["Turkish", "tr"],
    ["Tatar", "tt"],
    ["Ukrainian", "uk"],
    ["Urdu", "ur"],
    ["Uzbek", "uz"],
    ["Vietnamese", "vi"],
    ["Yiddish", "yi"],
    ["Yoruba", "yo"],
    ["Chinese", "zh"],
    ["Cantonese", "yue"],
    ["Zulu", "zu"],
];

function showLanguagePicker(ctx) {
  const settings = readSettings(ctx.api.kv);
  const options = [
    { title: "Auto detect", value: "auto", description: "Let Whisper detect the language." },
    ...WHISPER_LANGUAGES.map(([name, code]) => ({ title: name, value: code })),
    { title: "Custom code", value: "__custom", description: "Enter a Whisper language code manually." },
  ];

  setDialog(ctx, "medium", () =>
    ctx.api.ui.DialogSelect({
      title: "Voice language",
      current: settings.language,
      options,
      onSelect: (option) => {
        if (option.value === "__custom") {
          showPrompt(ctx, {
            title: "Custom language code",
            placeholder: "ru, en, de, ...",
            value: settings.language === "auto" ? "" : settings.language,
            onConfirm: (value) => {
              writeSetting(ctx.api.kv, "language", value.trim() || "auto");
              showSettings(ctx);
            },
          });
          return;
        }

        writeSetting(ctx.api.kv, "language", option.value);
        showSettings(ctx);
      },
    }),
  );
}

function showMicrophonePicker(ctx) {
  const settings = readSettings(ctx.api.kv);
  const commandOptions = { ...ctx.options, downloadDir: settings.downloadDir, skipFfmpegStaticInstall: true };
  const placeholder = process.platform === "win32" ? "default, audio=default, \"Microphone (Name)\"" : "default, hw:0,0, pulse, :0, ...";
  const devices = listMicrophones(commandOptions);
  setDialog(ctx, "large", () =>
    ctx.api.ui.DialogSelect({
      title: "Voice microphone",
      current: settings.mic || "",
      options: [
        { title: "System default", value: "", description: "Use the default input device." },
        ...devices.map((device) => ({ title: device, value: device })),
        { title: "Custom device", value: "__custom", description: "Enter ffmpeg/arecord device manually." },
      ],
      onSelect: (option) => {
        if (option.value === "__custom") {
          showPrompt(ctx, {
            title: "Custom microphone device",
            placeholder,
            value: settings.mic,
            onConfirm: (value) => {
              writeSetting(ctx.api.kv, "mic", value.trim());
              showSettings(ctx);
            },
          });
          return;
        }

        writeSetting(ctx.api.kv, "mic", option.value);
        showSettings(ctx);
      },
    }),
  );
}

function showRecordingHotkeyPicker(ctx) {
  const settings = readSettings(ctx.api.kv);
  const presets = [
    { title: "Ctrl + R", value: "ctrl+r", description: "Start and stop recording." },
    { title: "Ctrl + Space", value: "ctrl+space", description: "Start and stop recording." },
    { title: "Alt + R", value: "alt+r", description: "Start and stop recording." },
    { title: "Custom hotkey", value: "__custom", description: "Enter another OpenCode keybinding." },
  ];

  setDialog(ctx, "medium", () =>
    ctx.api.ui.DialogSelect({
      title: "Record key",
      current: presets.some((preset) => preset.value === settings.recordingHotkey) ? settings.recordingHotkey : "__custom",
      options: presets,
      onSelect: (option) => {
        if (option.value === "__custom") {
          showPrompt(ctx, {
            title: "Custom recording key",
            placeholder: "alt+shift+r",
            value: settings.recordingHotkey,
            onConfirm: (value) => {
              writeSetting(ctx.api.kv, "recordingHotkey", value.trim());
              ctx.registerCommands();
              showRecordingSettings(ctx);
            },
          });
          return;
        }

        writeSetting(ctx.api.kv, "recordingHotkey", option.value);
        ctx.registerCommands();
        showRecordingSettings(ctx);
      },
    }),
  );
}

function showDiagnostics(ctx) {
  const settings = readSettings(ctx.api.kv);
  const model = getModel(settings.model);
  const commandOptions = { ...ctx.options, downloadDir: settings.downloadDir, skipFfmpegStaticInstall: true };
  const whisperCli = resolveCommand("whisper-cli", commandOptions);
  const transcribeCpp = resolveCommand("opencode-voice-transcribe", commandOptions);
  const ffmpeg = resolveCommand("ffmpeg", commandOptions);
  const arecord = resolveCommand("arecord", commandOptions);
  const sox = resolveCommand("sox", commandOptions);
  const engine = getEngineStatus(model.engine, ctx.options, settings);
  const recorder = getRecorderStatus(commandOptions, settings);
  const lines = [
    `Platform: ${process.platform}-${process.arch}`,
    `Recorder: ffmpeg=${ffmpeg ? "yes" : "no"}${ffmpeg ? ` (${ffmpeg})` : ""}, arecord=${arecord ? "yes" : "no"}, sox=${sox ? "yes" : "no"}`,
    `Recorder source: ${recorder.source}`,
    `Managed recorder dir: ${recorder.managedDir}`,
    `Managed recorder installed: ${recorder.managedInstalled ? "yes" : "no"}`,
    `Managed recorder version: ${recorder.manifest?.version || "missing"}`,
    `Engine: ${engine.id}`,
    `Engine source: ${engine.source}`,
    `whisper-cli: ${whisperCli || "missing"}`,
    `opencode-voice-transcribe: ${transcribeCpp || "missing"}`,
    `Managed engine dir: ${engine.managedDir}`,
    `Managed installed: ${engine.managedInstalled ? "yes" : "no"}`,
    `Managed version: ${engine.manifest?.version || "missing"}`,
    `Active model: ${model.name}`,
    `Model downloaded: ${isModelDownloaded(model, ctx.options, settings) ? "yes" : "no"}`,
    `Model path: ${getModelPath(model, ctx.options, settings)}`,
    `Cache dir: ${getCacheDir(ctx.options, settings)}`,
  ];

  setDialog(ctx, "medium", () =>
    ctx.api.ui.DialogAlert({
      title: "Voice diagnostics",
      message: lines.join("\n"),
      onConfirm: () => showSettings(ctx),
    }),
  );
}

function showEngineManager(ctx, engineId = getModel(readSettings(ctx.api.kv).model).engine) {
  const settings = readSettings(ctx.api.kv);
  const status = getEngineStatus(engineId, ctx.options, settings);
  const canImport = Boolean(status.resolvedBinary && status.source !== "managed");
  const options = [
    {
      title: `Use detected ${status.command} as managed engine`,
      value: "import",
      description: canImport ? status.resolvedBinary : `No external ${status.command} detected`,
      disabled: !canImport,
    },
    {
      title: `Install managed ${engineId}`,
      value: "install",
      description: "Download the matching native engine from GitHub Releases.",
    },
    {
      title: "Remove managed engine",
      value: "remove",
      description: status.managedInstalled ? status.managedBinary : "No managed engine installed",
      disabled: !status.managedInstalled,
    },
    { title: "Diagnostics", value: "diagnostics", description: "Show recorder, model, and engine paths." },
    { title: "Back", value: "back" },
  ];

  setDialog(ctx, "large", () =>
    ctx.api.ui.DialogSelect({
      title: "Native engine",
      options,
      footer: [
        `Source: ${status.source}`,
        `Resolved: ${status.resolvedBinary || "missing"}`,
        `Managed: ${status.managedBinary}`,
      ].join("\n"),
      onSelect: async (option) => {
        if (option.value === "back") showSettings(ctx);
        if (option.value === "diagnostics") showDiagnostics(ctx);
        if (option.value === "import") {
          try {
            const result = await importManagedEngine(engineId, status.resolvedBinary, ctx.options, settings);
            toast(ctx.api, `Managed engine imported: ${result.managedBinary}`, "success");
            showEngineManager(ctx, engineId);
          } catch (error) {
            showError(ctx, "Engine import failed", error);
          }
        }
        if (option.value === "install") {
          try {
            await ensureEngineReady(ctx, settings, { engine: engineId });
            showEngineManager(ctx, engineId);
          } catch (error) {
            showError(ctx, "Engine install failed", error);
          }
        }
        if (option.value === "remove") {
          try {
            await removeManagedEngine(engineId, ctx.options, settings);
            toast(ctx.api, "Managed engine removed");
            showEngineManager(ctx, engineId);
          } catch (error) {
            showError(ctx, "Engine remove failed", error);
          }
        }
      },
    }),
  );
}

function showError(ctx, title, error) {
  setDialog(ctx, "medium", () =>
    ctx.api.ui.DialogAlert({
      title,
      message: error instanceof Error ? error.message : String(error),
      onConfirm: () => showSettings(ctx),
    }),
  );
}

async function downloadActiveModel(ctx) {
  const settings = readSettings(ctx.api.kv);
  const model = getModel(settings.model);
  try {
    await ensureEngineReady(ctx, settings, model);
    await ensureDownloaded(ctx, model, settings);
    showSettings(ctx);
  } catch (error) {
    showError(ctx, "Model download failed", error);
  }
}

function showRecordingSettings(ctx) {
  const settings = readSettings(ctx.api.kv);

  setDialog(ctx, "medium", () =>
    ctx.api.ui.DialogSelect({
      title: "Recording",
      options: [
        { title: "Record key", value: "key", description: settings.recordingHotkey || "not set" },
        { title: "Toggle recording", value: "toggle", description: "Press once to start and again to transcribe.", disabled: true },
        { title: "Hold to talk", value: "hold", description: "Unavailable until OpenCode provides key-release events.", disabled: true },
      ],
      onSelect: (option) => {
        if (option.value === "key") showRecordingHotkeyPicker(ctx);
      },
    }),
  );
}

function showTranscriptionSettings(ctx) {
  const settings = readSettings(ctx.api.kv);
  const model = getModel(settings.model);
  const downloaded = isModelDownloaded(model, ctx.options, settings);

  setDialog(ctx, "medium", () =>
    ctx.api.ui.DialogSelect({
      title: "Transcription",
      options: [
        { title: "Model", value: "model", description: `${model.name} · ${downloaded ? "ready" : "not downloaded"}` },
        { title: downloaded ? "Re-download model" : "Download model", value: "download", description: `${model.name} · ${formatSize(model)}` },
        { title: "Language", value: "language", description: settings.language === "auto" ? "auto detect" : settings.language },
        { title: "Auto-submit", value: "autoSubmit", description: settings.autoSubmit ? "enabled" : "disabled" },
        { title: "Submit key", value: "submitHotkey", description: settings.submitHotkey || "disabled" },
      ],
      onSelect: (option) => {
        if (option.value === "model") showModelPicker(ctx, false);
        if (option.value === "download") downloadActiveModel(ctx);
        if (option.value === "language") showLanguagePicker(ctx);
        if (option.value === "autoSubmit") {
          writeSetting(ctx.api.kv, "autoSubmit", !settings.autoSubmit);
          showTranscriptionSettings(ctx);
        }
        if (option.value === "submitHotkey") {
          showPrompt(ctx, {
            title: "Submit recording key",
            placeholder: "leader r or empty to disable",
            value: settings.submitHotkey,
            onConfirm: (value) => {
              writeSetting(ctx.api.kv, "submitHotkey", value.trim());
              ctx.registerCommands();
              showTranscriptionSettings(ctx);
            },
          });
        }
      },
    }),
  );
}

function showSystemSettings(ctx) {
  const settings = readSettings(ctx.api.kv);
  const model = getModel(settings.model);

  setDialog(ctx, "medium", () =>
    ctx.api.ui.DialogSelect({
      title: "Audio and system",
      options: [
        { title: "Microphone", value: "mic", description: settings.mic || "system default" },
        { title: "Download directory", value: "downloadDir", description: settings.downloadDir || getCacheDir(ctx.options, settings) },
        { title: "Native engine", value: "engine", description: `${getEngineStatus(model.engine, ctx.options, settings).source} · ${model.engine}` },
        { title: "Diagnostics", value: "diagnostics", description: "Check recorder, runtimes, and model paths." },
        { title: "Run setup again", value: "firstRun", description: "Open the first-run model picker." },
      ],
      onSelect: (option) => {
        if (option.value === "mic") showMicrophonePicker(ctx);
        if (option.value === "downloadDir") {
          showPrompt(ctx, {
            title: "Download directory",
            placeholder: "~/.cache/opencode-voice",
            value: settings.downloadDir,
            onConfirm: (value) => {
              writeSetting(ctx.api.kv, "downloadDir", value.trim());
              showSystemSettings(ctx);
            },
          });
        }
        if (option.value === "engine") showEngineManager(ctx);
        if (option.value === "diagnostics") showDiagnostics(ctx);
        if (option.value === "firstRun") showModelPicker(ctx, true);
      },
    }),
  );
}

function showSettings(ctx) {
  const settings = readSettings(ctx.api.kv);
  const model = getModel(settings.model);

  setDialog(ctx, "large", () =>
    ctx.api.ui.DialogSelect({
      title: "Voice settings",
      options: [
        { title: "Recording", value: "recording", description: `${settings.recordingHotkey} · toggle` },
        { title: "Transcription", value: "transcription", description: `${model.name} · ${settings.language === "auto" ? "auto language" : settings.language}` },
        { title: "Audio and system", value: "system", description: `${settings.mic || "default microphone"} · ${model.engine}` },
      ],
      onSelect: (option) => {
        if (option.value === "recording") showRecordingSettings(ctx);
        if (option.value === "transcription") showTranscriptionSettings(ctx);
        if (option.value === "system") showSystemSettings(ctx);
      },
    }),
  );
}

async function appendTranscription(ctx, text, submit) {
  const next = text.endsWith(" ") ? text : `${text} `;
  await ctx.api.client.tui.appendPrompt({ text: next });
  if (submit) await ctx.api.client.tui.submitPrompt();
}

async function stopAndTranscribe(ctx, submit) {
  if (ctx.runtime.isTranscribing()) {
    toast(ctx.api, "Transcription is already running", "warning");
    return;
  }

  try {
    const settings = readSettings(ctx.api.kv);
    const model = getModel(settings.model);
    const audioFile = await ctx.runtime.stop();
    if (!audioFile) return;

    toast(ctx.api, "Transcribing...");
    const text = await ctx.runtime.transcribe(audioFile, model, settings);
    await appendTranscription(ctx, text, submit || settings.autoSubmit);
    toast(ctx.api, submit || settings.autoSubmit ? "Transcribed and submitted" : "Transcribed", "success");
  } catch (error) {
    toast(ctx.api, error instanceof Error ? error.message : String(error), "error");
  }
}

async function startVoice(ctx, submit = false, hold = false) {
  if (ctx.runtime.isTranscribing()) {
    toast(ctx.api, "Transcription is already running", "warning");
    return;
  }

  if (ctx.runtime.isRecording()) return;

  const settings = readSettings(ctx.api.kv);
  const model = getModel(settings.model);
  if (!isModelDownloaded(model, ctx.options, settings)) {
    try {
      await ensureEngineReady(ctx, settings, model);
      await ensureDownloaded(ctx, model, settings);
      ctx.api.ui.dialog.clear();
    } catch (error) {
      showError(ctx, "Voice setup failed", error);
      return;
    }
  }

  try {
    await ensureEngineReady(ctx, settings, model);
    await ensureRecorderReady(ctx, settings);
  } catch (error) {
    showError(ctx, "Voice runtime setup failed", error);
    return;
  }

  try {
    ctx.runtime.pendingSubmit = submit || settings.autoSubmit;
    await ctx.runtime.start(settings);
    toast(ctx.api, hold ? `Recording. Release ${settings.recordingHotkey || "the recording key"} to stop.` : submit ? "Recording for submit. Run /voice-submit again to stop." : "Recording. Run /voice again to stop.");
  } catch (error) {
    toast(ctx.api, error instanceof Error ? error.message : String(error), "error");
  }
}

async function finishVoice(ctx, submit = false) {
  if (!ctx.runtime.isRecording()) return;
  await stopAndTranscribe(ctx, submit || ctx.runtime.pendingSubmit);
  ctx.runtime.pendingSubmit = false;
}

async function toggleVoice(ctx, submit = false) {
  if (ctx.runtime.isTranscribing()) {
    toast(ctx.api, "Transcription is already running", "warning");
    return;
  }

  if (ctx.runtime.isRecording()) {
    await finishVoice(ctx, submit);
    return;
  }

  await startVoice(ctx, submit, false);
}

function stopVoice(ctx) {
  ctx.runtime.cancel();
  toast(ctx.api, "Voice recording cancelled");
}

function buildBindings(settings) {
  const bindings = [];

  if (settings.recordingHotkey) {
    bindings.push({ key: settings.recordingHotkey, event: "press", preventDefault: true, cmd: "voice.record", desc: "Toggle voice recording" });
  }

  if (settings.submitHotkey) {
    bindings.push({ key: settings.submitHotkey, event: "press", preventDefault: true, cmd: "voice.submit", desc: "Voice input and submit" });
  }

  return bindings;
}

function buildCommands(ctx) {
  return [
    {
      name: "voice.hold.start",
      title: "Voice: hold start",
      desc: "Start hold-to-talk recording.",
      category: "Voice",
      namespace: "palette",
      hidden: true,
      run: () => startVoice(ctx, false, true),
    },
    {
      name: "voice.hold.finish",
      title: "Voice: hold finish",
      desc: "Stop hold-to-record and transcribe.",
      category: "Voice",
      namespace: "palette",
      hidden: true,
      run: () => finishVoice(ctx, false),
    },
    {
      name: "voice.record",
      title: "Voice: record",
      desc: "Toggle local voice recording and append transcription to the prompt.",
      category: "Voice",
      namespace: "palette",
      slashName: "voice",
      slashAliases: ["voice-record"],
      run: () => toggleVoice(ctx, false),
    },
    {
      name: "voice.submit",
      title: "Voice: submit",
      desc: "Toggle local voice recording and submit after transcription.",
      category: "Voice",
      namespace: "palette",
      slashName: "voice-submit",
      run: () => toggleVoice(ctx, true),
    },
    {
      name: "voice.stop",
      title: "Voice: stop",
      desc: "Cancel active voice recording or transcription.",
      category: "Voice",
      namespace: "palette",
      slashName: "voice-stop",
      run: () => stopVoice(ctx),
    },
    {
      name: "voice.settings",
      title: "Voice: settings",
      desc: "Open local voice input settings.",
      category: "Voice",
      namespace: "palette",
      slashName: "voice-settings",
      run: () => showSettings(ctx),
    },
  ];
}

const plugin = {
  id: PLUGIN_ID,
  tui: async (api, options = {}) => {
    const runtime = new VoiceRuntime(options || {});
    const ctx = {
      api,
      options: options || {},
      runtime,
      disposeCommands: undefined,
      registerCommands() {
        if (ctx.disposeCommands) ctx.disposeCommands();
        const settings = readSettings(api.kv);
        ctx.disposeCommands = api.keymap.registerLayer({
          priority: 100,
          commands: buildCommands(ctx),
          bindings: buildBindings(settings),
        });
      },
    };

    migrateSettings(api.kv);
    ctx.registerCommands();
    api.lifecycle.onDispose(() => {
      if (ctx.disposeCommands) ctx.disposeCommands();
      runtime.cancel();
    });

    setTimeout(() => {
      if (shouldShowStartupModelPicker(ctx)) showModelPicker(ctx, true);
    }, 250);
  },
};

export default plugin;

