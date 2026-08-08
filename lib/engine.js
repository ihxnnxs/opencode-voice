import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ensureDir, replaceFile, sha256 } from "./download.js";
import { getAudioDir, getCacheDir, getEnginesDir, getModelPath } from "./models.js";

const require = createRequire(import.meta.url);
const FFMPEG_STATIC_PACKAGE = "ffmpeg-static@^5.2.0";
const FFMPEG_STATIC_RELEASE = "b6.1.1";
const FFMPEG_STATIC_BASE_URL = "https://github.com/eugeneware/ffmpeg-static/releases/download";
const DEFAULT_RECORDER_DOWNLOAD_RETRIES = 5;
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let ffmpegStaticPathCache;
let ffmpegStaticInstallAttempted = false;

const RECORDING_MIN_BYTES = 44;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeArch(value) {
  if (value === "amd64") return "x64";
  if (value === "x86") return "ia32";
  if (value === "aarch64") return "arm64";
  return value;
}

function windowsFfmpegPlatform(options = {}) {
  const platform = options.platform || process.platform;
  const arch = normalizeArch(options.arch || process.arch);
  return { platform, arch, key: `${platform}-${arch}` };
}

function isWindows(options = {}) {
  return (options.platform || process.platform) === "win32";
}

function withDownloadDir(options = {}, settings = {}) {
  return { ...options, downloadDir: settings.downloadDir || options.downloadDir };
}

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function executableExtensions(options = {}) {
  if (!isWindows(options)) return [""];
  return (process.env.PATHEXT || ".EXE;.CMD;.BAT")
    .split(";")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .filter((entry) => entry.startsWith("."));
}

function resolveExecutable(file, options = {}) {
  const normalized = path.resolve(file);
  if (isExecutable(normalized)) return normalized;

  if (path.extname(normalized) || !isWindows(options)) {
    return "";
  }

  for (const ext of executableExtensions(options)) {
    const candidate = `${normalized}${ext}`;
    if (isExecutable(candidate)) return candidate;
  }

  return "";
}

function managedFfmpegDir(options = {}, settings = {}) {
  const platform = windowsFfmpegPlatform(options);
  return path.join(getCacheDir(options, settings), "recorders", "ffmpeg-static", platform.key);
}

export function getManagedRecorderBinary(options = {}, settings = {}) {
  const platform = windowsFfmpegPlatform(options);
  return path.join(managedFfmpegDir(options, settings), platform.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
}

export function getManagedRecorderManifestPath(options = {}, settings = {}) {
  return path.join(managedFfmpegDir(options, settings), "manifest.json");
}

export function readManagedRecorderManifest(options = {}, settings = {}) {
  const file = getManagedRecorderManifestPath(options, settings);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function temporaryBinaryPath(binaryPath) {
  const extension = path.extname(binaryPath);
  if (!extension) return `${binaryPath}.tmp-${process.pid}`;
  return path.join(path.dirname(binaryPath), `${path.basename(binaryPath, extension)}.tmp-${process.pid}${extension}`);
}

function selectManagedRecorderAsset(options = {}) {
  const platform = windowsFfmpegPlatform(options);
  if (platform.platform !== "win32") throw new Error(`Managed ffmpeg recorder is only available for Windows, got ${platform.key}`);

  const assetArch = platform.arch === "arm64" ? "x64" : platform.arch;
  if (!new Set(["x64", "ia32"]).has(assetArch)) throw new Error(`No managed ffmpeg recorder asset for ${platform.key}`);

  const assetKey = `${platform.platform}-${assetArch}`;
  return {
    platform,
    assetKey,
    emulated: assetArch !== platform.arch,
    url: `${FFMPEG_STATIC_BASE_URL}/${FFMPEG_STATIC_RELEASE}/ffmpeg-${assetKey}.gz`,
  };
}

function recorderSource(resolved, managedBinary) {
  if (!resolved) return "missing";
  if (path.resolve(resolved) === path.resolve(managedBinary)) return "managed";
  return "system-or-bundled";
}

function recorderDownloadTimeoutMs(options = {}, hooks = {}) {
  return Number(options.recorderDownloadTimeoutMs || options.downloadTimeoutMs || hooks.timeoutMs || 120000);
}

async function fetchRecorderWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const reset = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), timeoutMs);
  };
  const clear = () => clearTimeout(timer);
  reset();

  try {
    const response = await fetch(url, { signal: controller.signal });
    return { response, signal: controller.signal, reset, clear };
  } catch (error) {
    clear();
    if (error?.name === "AbortError") throw new Error(`Recorder download timed out after ${Math.round(timeoutMs / 1000)}s`);
    throw error;
  }
}

function recorderDownloadError(error, url, timeoutMs) {
  if (error?.name === "AbortError" || error?.code === "ABORT_ERR") {
    return new Error(`Recorder download timed out or stalled from ${url} after ${Math.round(timeoutMs / 1000)}s`);
  }
  return error;
}

async function downloadRecorderAsset(sourceUrl, compressedFile, hooks = {}, attempt = 1, attempts = 1, options = {}) {
  if (sourceUrl.startsWith("file://") || !/^https?:\/\//.test(sourceUrl)) {
    const source = sourceUrl.startsWith("file://") ? new URL(sourceUrl) : path.resolve(sourceUrl);
    const stat = await fs.promises.stat(source);
    let downloaded = 0;
    hooks.onProgress?.({ state: "downloading", downloaded, total: stat.size, percent: 0, attempt, attempts });
    const progress = new Transform({
      transform(chunk, _encoding, callback) {
        downloaded += chunk.length ?? chunk.byteLength ?? 0;
        hooks.onProgress?.({ state: "downloading", downloaded, total: stat.size, percent: stat.size ? (downloaded / stat.size) * 100 : 0, attempt, attempts });
        callback(null, chunk);
      },
    });
    await pipeline(fs.createReadStream(source), progress, fs.createWriteStream(compressedFile));
    return;
  }

  const timeoutMs = recorderDownloadTimeoutMs(options, hooks);
  const request = await fetchRecorderWithTimeout(sourceUrl, timeoutMs);
  const response = request.response;

  try {
    if (!response.ok) throw new Error(`Recorder download failed from ${sourceUrl}: HTTP ${response.status}`);
    const contentLength = Number(response.headers.get("content-length") || 0);
    let downloaded = 0;
    hooks.onProgress?.({ state: "downloading", downloaded, total: contentLength, percent: 0, attempt, attempts });

    const body = response.body?.getReader ? Readable.fromWeb(response.body) : response.body;
    if (!body) throw new Error("Recorder download failed: empty response body");

    const progress = new Transform({
      transform(chunk, _encoding, callback) {
        request.reset();
        downloaded += chunk.length ?? chunk.byteLength ?? 0;
        hooks.onProgress?.({ state: "downloading", downloaded, total: contentLength, percent: contentLength ? (downloaded / contentLength) * 100 : 0, attempt, attempts });
        callback(null, chunk);
      },
    });

    try {
      await pipeline(body, progress, fs.createWriteStream(compressedFile), { signal: request.signal });
    } catch (error) {
      throw recorderDownloadError(error, sourceUrl, timeoutMs);
    }
  } finally {
    request.clear();
  }
}

export async function probeRecorder(binaryPath, options = {}) {
  if (!binaryPath) return { ok: false, message: "missing binary" };

  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    let timer;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    let proc;
    try {
      proc = spawn(binaryPath, ["-version"], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PATH: [path.dirname(binaryPath), process.env.PATH].filter(Boolean).join(path.delimiter),
          ...options.env,
        },
      });
    } catch (error) {
      finish({ ok: false, message: error instanceof Error ? error.message : String(error) });
      return;
    }

    timer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {}
      finish({ ok: false, message: "probe timed out" });
    }, options.timeoutMs || 10000);

    proc.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    proc.on("error", (error) => finish({ ok: false, message: error.message }));
    proc.on("exit", (code) => {
      const versionLine = output.split(/\r?\n/).filter(Boolean)[0] || "";
      const ok = code === 0 && /ffmpeg version/i.test(output);
      finish({ ok, message: ok ? "ok" : `unexpected ffmpeg probe output${typeof code === "number" ? ` (exit ${code})` : ""}`, versionLine });
    });
  });
}

async function writeManagedRecorderManifest(managedBinary, source, options = {}, settings = {}) {
  const hash = await sha256(managedBinary);
  const stat = await fs.promises.stat(managedBinary);
  const manifest = {
    schema: "opencode-voice.recorder-install.v1",
    id: "ffmpeg",
    kind: "cli",
    command: "ffmpeg",
    platform: windowsFfmpegPlatform(options).key,
    version: FFMPEG_STATIC_RELEASE,
    source,
    files: [{ path: path.basename(managedBinary), sha256: hash, size: stat.size }],
    installedAt: new Date().toISOString(),
  };

  await fs.promises.writeFile(getManagedRecorderManifestPath(options, settings), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function getRecorderStatus(options = {}, settings = {}) {
  const commandOptions = withDownloadDir(options, settings);
  const managedDir = managedFfmpegDir(options, settings);
  const managedBinary = getManagedRecorderBinary(options, settings);
  const manifest = readManagedRecorderManifest(options, settings);
  const resolvedBinary = resolveCommand("ffmpeg", commandOptions);

  return {
    id: "ffmpeg",
    command: "ffmpeg",
    platform: windowsFfmpegPlatform(options).key,
    supported: isWindows(options),
    managedDir,
    managedBinary,
    managedInstalled: isExecutable(managedBinary),
    manifest,
    resolvedBinary,
    source: recorderSource(resolvedBinary, managedBinary),
  };
}

export async function installManagedRecorder(options = {}, settings = {}, hooks = {}) {
  const commandOptions = withDownloadDir(options, settings);
  const asset = selectManagedRecorderAsset(commandOptions);
  const managedDir = managedFfmpegDir(commandOptions, settings);
  const managedBinary = getManagedRecorderBinary(commandOptions, settings);
  if (!hooks.force && fs.existsSync(managedBinary)) {
    const probe = await probeRecorder(managedBinary);
    if (probe.ok) return { manifest: readManagedRecorderManifest(commandOptions, settings), managedBinary, probe, skipped: true };
  }

  await ensureDir(managedDir);
  const compressedFile = path.join(managedDir, `${path.basename(asset.url)}.download`);
  const tmpBinary = temporaryBinaryPath(managedBinary);
  const attempts = Number(options.recorderDownloadRetries || hooks.retries || DEFAULT_RECORDER_DOWNLOAD_RETRIES);
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await fs.promises.unlink(compressedFile).catch(() => {});
      await fs.promises.unlink(tmpBinary).catch(() => {});
      await downloadRecorderAsset(asset.url, compressedFile, hooks, attempt, attempts, commandOptions);

      const compressedSize = fs.existsSync(compressedFile) ? fs.statSync(compressedFile).size : 0;
      hooks.onProgress?.({ state: "decompressing", downloaded: compressedSize, total: compressedSize, percent: 100, attempt, attempts });
      await pipeline(fs.createReadStream(compressedFile), createGunzip(), fs.createWriteStream(tmpBinary));
      await fs.promises.chmod(tmpBinary, 0o755);

      hooks.onProgress?.({ state: "probing", downloaded: fs.statSync(tmpBinary).size, total: fs.statSync(tmpBinary).size, percent: 100, attempt, attempts });
      const probe = await probeRecorder(tmpBinary);
      if (!probe.ok) throw new Error(`Recorder probe failed: ${probe.message}`);

      await replaceFile(tmpBinary, managedBinary);
      await fs.promises.unlink(compressedFile).catch(() => {});
      const manifest = await writeManagedRecorderManifest(
        managedBinary,
        {
          type: "ffmpeg-static-release",
          release: FFMPEG_STATIC_RELEASE,
          url: asset.url,
          assetPlatform: asset.assetKey,
          emulated: asset.emulated,
        },
        commandOptions,
        settings,
      );
      const installedSize = fs.statSync(managedBinary).size;
      hooks.onProgress?.({ state: "done", downloaded: installedSize, total: installedSize, percent: 100, attempt, attempts });
      return { manifest, managedBinary, probe, skipped: false };
    } catch (error) {
      lastError = error;
      await fs.promises.unlink(tmpBinary).catch(() => {});
      if (attempt >= attempts) break;
      hooks.onRetry?.({ error, attempt, attempts, nextAttempt: attempt + 1 });
      await sleep(Math.min(1000 * attempt, 3000));
    }
  }

  throw lastError;
}

export async function ensureManagedRecorder(options = {}, settings = {}, hooks = {}) {
  const commandOptions = withDownloadDir(options, settings);
  if (!isWindows(commandOptions)) return { ...getRecorderStatus(commandOptions, settings), ok: true, skipped: true, unsupported: true };

  const existingOptions = { ...commandOptions, skipFfmpegStaticInstall: true };
  const current = getRecorderStatus(existingOptions, settings);
  if (current.resolvedBinary) {
    const probe = await probeRecorder(current.resolvedBinary);
    if (probe.ok) return { ...current, ok: true, probe, skipped: true };
  }

  try {
    const installed = await installManagedRecorder(commandOptions, settings, hooks);
    return { ...getRecorderStatus(commandOptions, settings), ...installed, ok: true };
  } catch (error) {
    const resolvedBinary = resolveRecorderFallback(existingOptions, settings);
    if (resolvedBinary) {
      const probe = await probeRecorder(resolvedBinary);
      if (probe.ok) {
        return {
          ...getRecorderStatus(commandOptions, settings),
          resolvedBinary,
          source: recorderSource(resolvedBinary, getManagedRecorderBinary(commandOptions, settings)),
          ok: true,
          fallback: true,
          managedError: error instanceof Error ? error.message : String(error),
          probe,
        };
      }
    }

    throw new Error(`Windows ffmpeg recorder install failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function executableNames(command, options = {}) {
  const names = [command];
  if (path.extname(command)) return names;

  if (isWindows(options)) {
    const extensions = (process.env.PATHEXT || ".EXE;.CMD;.BAT")
      .split(";")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    for (const extension of extensions) names.push(`${command}${extension}`);
  }

  return [...new Set(names)];
}

function bundledFfmpegPath(options = {}) {
  if (process.platform !== "win32") return "";
  if (ffmpegStaticPathCache !== undefined) return ffmpegStaticPathCache;

  const resolveFromDependency = () => {
    try {
      const candidate = require("ffmpeg-static");
      if (typeof candidate !== "string") return "";
      return resolveExecutable(candidate);
    } catch {
      return "";
    }
  };

  const resolveFromLocalModule = () => {
    const fallback = path.join(PLUGIN_ROOT, "node_modules", "ffmpeg-static", "ffmpeg");
    return resolveExecutable(fallback);
  };

  const installDependency = () => {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    try {
      const result = spawnSync(npm, ["install", "--no-save", "--no-audit", "--no-fund", FFMPEG_STATIC_PACKAGE], {
        cwd: PLUGIN_ROOT,
        stdio: "ignore",
      });
      return result.status === 0;
    } catch {
      return false;
    }
  };

  let candidate = resolveFromDependency();
  if (!candidate) candidate = resolveFromLocalModule();
  if (!candidate && !ffmpegStaticInstallAttempted && !options.skipFfmpegStaticInstall) {
    ffmpegStaticInstallAttempted = true;
    if (installDependency()) {
      candidate = resolveFromDependency();
    }
  }

  if (!candidate) candidate = resolveFromLocalModule();
  if (!candidate && options.skipFfmpegStaticInstall) return "";

  ffmpegStaticPathCache = candidate || "";
  return ffmpegStaticPathCache;
}

function platformKey(options = {}) {
  return `${options.platform || process.platform}-${options.arch || process.arch}`;
}

export function getBundledEngineDir(command, options = {}) {
  if (command !== "whisper-cli") return "";
  return path.join(getEnginesDir(options, options), "whisper.cpp", platformKey(options));
}

function looksLikePath(value) {
  return path.isAbsolute(value) || value.includes("/") || value.includes("\\");
}

function candidateCommands(command, options = {}) {
  const candidates = [];

  if (command === "whisper-cli") {
    if (options.whisperCli) candidates.push(options.whisperCli);
    if (process.env.OPENCODE_VOICE_WHISPER_CLI) candidates.push(process.env.OPENCODE_VOICE_WHISPER_CLI);
  }

  if (command === "ffmpeg") {
    if (options.ffmpeg) candidates.push(options.ffmpeg);
    if (process.env.OPENCODE_VOICE_FFMPEG) candidates.push(process.env.OPENCODE_VOICE_FFMPEG);
    if (isWindows(options)) candidates.push(getManagedRecorderBinary(options, options));
    const bundled = bundledFfmpegPath(options);
    if (bundled) candidates.push(bundled);
  }

  const bundledDir = getBundledEngineDir(command, options);
  if (bundledDir) {
    for (const name of executableNames(command, options)) candidates.push(path.join(bundledDir, name));
  }

  candidates.push(...executableNames(command, options));

  const fallbackDirs = [
    path.join(os.homedir(), ".local", "bin"),
    path.join(os.homedir(), ".opencode-voice", "bin"),
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/usr/bin",
    "/bin",
  ];

  if (isWindows(options)) {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    fallbackDirs.unshift(path.join(localAppData, "opencode-voice", "bin"));
  }

  for (const dir of fallbackDirs) {
    for (const name of executableNames(command, options)) candidates.push(path.join(dir, name));
  }

  return [...new Set(candidates.filter(Boolean))];
}

export function resolveCommand(command, options = {}) {
  for (const candidate of candidateCommands(command, options)) {
    if (looksLikePath(candidate)) {
      const resolved = resolveExecutable(candidate, options);
      if (resolved) return resolved;
      continue;
    }

    for (const dir of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
      const file = path.join(dir, candidate);
      const resolved = resolveExecutable(file, options);
      if (resolved) return resolved;
    }
  }

  return null;
}

function resolveRecorderFallback(options = {}, settings = {}) {
  const managedBinary = path.resolve(getManagedRecorderBinary(options, settings));
  for (const candidate of candidateCommands("ffmpeg", options)) {
    if (looksLikePath(candidate)) {
      const resolved = resolveExecutable(candidate, options);
      if (resolved && path.resolve(resolved) !== managedBinary) return resolved;
      continue;
    }

    for (const dir of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
      const file = path.join(dir, candidate);
      const resolved = resolveExecutable(file, options);
      if (resolved && path.resolve(resolved) !== managedBinary) return resolved;
    }
  }

  return null;
}

export function commandExists(command, options = {}) {
  return Boolean(resolveCommand(command, options));
}

function childEnv(options = {}) {
  const localLib = path.join(os.homedir(), ".local", "lib");
  const localBin = path.join(os.homedir(), ".local", "bin");
  const bundledDir = getBundledEngineDir("whisper-cli", options);
  const pathEntries = [bundledDir, localBin, localLib, process.env.PATH].filter(Boolean);
  return {
    ...process.env,
    PATH: pathEntries.join(path.delimiter),
    LD_LIBRARY_PATH: [localLib, process.env.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter),
    DYLD_LIBRARY_PATH: [localLib, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(path.delimiter),
  };
}

function normalizeWindowsAudioInput(device = "") {
  const value = String(device).trim();
  if (!value || value === "default") return "audio=default";
  if (value.startsWith("audio=") || value.startsWith("video=")) return value;
  return `audio=${value}`;
}

function formatCommand(command, args) {
  const quote = (value) => {
    const text = String(value);
    if (/^[^\s"\\]+$/.test(text)) return text;
    return `"${text.replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\*)$/g, "$1$1")}"`;
  };
  return [command, ...args].map(quote).join(" ");
}

function parseWindowsMicrophones(stderr) {
  const devices = new Set();
  for (const line of stderr.split(/\r?\n/)) {
    const match = line.match(/"([^"]+)"\s+\(audio\)/);
    if (match?.[1]) devices.add(match[1]);
  }

  return [...devices].filter(Boolean);
}

export function listMicrophones(options = {}) {
  const arecordCommand = resolveCommand("arecord", options);
  const ffmpegCommand = resolveCommand("ffmpeg", options);

  if (process.platform === "linux" && arecordCommand) {
    const result = spawnSync(arecordCommand, ["-L"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const devices = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !line.includes(" ") && line !== "null");
    return ["default", ...devices.filter((item) => item !== "default")];
  }

  if (process.platform === "darwin" && ffmpegCommand) {
    const result = spawnSync(ffmpegCommand, ["-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""], {
      encoding: "utf8",
      stdio: ["ignore", "ignore", "pipe"],
    });
    return result.stderr
      .split(/\r?\n/)
      .map((line) => line.match(/\[(\d+)\]\s+(.+)$/)?.[1])
      .filter(Boolean)
      .map((id) => `:${id}`);
  }

  if (process.platform === "win32" && ffmpegCommand) {
    const result = spawnSync(ffmpegCommand, ["-hide_banner", "-f", "dshow", "-list_devices", "true", "-i", "dummy"], {
      encoding: "utf8",
      stdio: ["ignore", "ignore", "pipe"],
    });
    const devices = parseWindowsMicrophones(result.stderr || "");
    return ["default", ...devices.filter((device) => device !== "default")];
  }

  return ["default"];
}

function buildRecorders(file, settings = {}) {
  const mic = settings.mic || "";
  const recorders = [];
  const arecordCommand = resolveCommand("arecord", settings);
  const ffmpegCommand = resolveCommand("ffmpeg", settings);
  const soxCommand = resolveCommand("sox", settings);

  if (process.platform === "linux" && arecordCommand) {
    recorders.push({
      label: mic ? `arecord (${mic})` : "arecord (default)",
      command: arecordCommand,
      args: ["-q", "-f", "S16_LE", "-r", "16000", "-c", "1", "-t", "wav", ...(mic ? ["-D", mic] : []), file],
    });
  }

  if (process.platform === "linux" && ffmpegCommand) {
    if (!mic) {
      recorders.push({
        label: "ffmpeg pulse (default)",
        command: ffmpegCommand,
        args: ["-hide_banner", "-loglevel", "error", "-y", "-f", "pulse", "-i", "default", "-ac", "1", "-ar", "16000", file],
      });
    }

    recorders.push({
      label: `ffmpeg alsa (${mic || "default"})`,
      command: ffmpegCommand,
      args: ["-hide_banner", "-loglevel", "error", "-y", "-f", "alsa", "-i", mic || "default", "-ac", "1", "-ar", "16000", file],
    });
  }

  if (process.platform === "darwin" && ffmpegCommand) {
    recorders.push({
      label: `ffmpeg avfoundation (${mic || ":0"})`,
      command: ffmpegCommand,
      args: ["-hide_banner", "-loglevel", "error", "-y", "-f", "avfoundation", "-i", mic || ":0", "-ac", "1", "-ar", "16000", file],
    });
  }

  if (process.platform === "win32" && ffmpegCommand) {
    const ffmpegCmd = ffmpegCommand;
    if (ffmpegCmd) {
      const configuredInput = mic && mic !== "default" ? normalizeWindowsAudioInput(mic) : "";
      // DirectShow does not provide a reliable "audio=default" alias. Try each
      // enumerated device before retaining it as a final fallback for custom setups.
      const detectedInputs = listMicrophones(settings)
        .filter((device) => device !== "default")
        .map(normalizeWindowsAudioInput);
      const inputs = [...new Set([configuredInput, ...detectedInputs, "audio=default"].filter(Boolean))];
      for (const input of inputs) {
        recorders.push({
          label: `ffmpeg dshow (${input.replace(/^audio=/, "")})`,
          command: ffmpegCmd,
          args: ["-hide_banner", "-loglevel", "error", "-y", "-f", "dshow", "-i", input, "-ac", "1", "-ar", "16000", file],
        });
      }
    }
  }

  if (soxCommand) {
    recorders.push({
      label: "sox default",
      command: soxCommand,
      args: ["-d", "-r", "16000", "-c", "1", "-b", "16", file],
    });
  }

  if (!recorders.length) throw new Error("No recorder found. Install ffmpeg, arecord, or sox.");
  return recorders;
}

function waitForExit(proc, timeoutMs = 3000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {}
      finish();
    }, timeoutMs);

    proc.once("exit", () => {
      clearTimeout(timer);
      finish();
    });
    proc.once("error", () => {
      clearTimeout(timer);
      finish();
    });
  });
}

function cleanTranscription(text) {
  return text
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lastLine(value) {
  return value.trim().split("\n").filter(Boolean).pop() || "";
}

function startRecorder(recorder, file) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    let exited = false;
    let exitCode = null;
    const commandLine = formatCommand(recorder.command, recorder.args);
    const failure = (detail) => new Error(`${recorder.label}: ${detail}\nCommand: ${commandLine}${stderr.trim() ? `\nffmpeg stderr:\n${stderr.trim()}` : ""}`);

    let proc;
    try {
      proc = spawn(recorder.command, recorder.args, { stdio: ["ignore", "ignore", "pipe"] });
    } catch (error) {
      reject(failure(error instanceof Error ? error.message : String(error)));
      return;
    }
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.once("error", (error) => {
      exited = true;
      reject(failure(error.message));
    });
    proc.once("exit", (code) => {
      exited = true;
      exitCode = code;
    });

    setTimeout(() => {
      if (exited) {
        reject(failure(lastLine(stderr) || `exited with code ${exitCode}`));
        return;
      }

      if (!fs.existsSync(file)) {
        try {
          proc.kill("SIGKILL");
        } catch {}
        reject(failure("did not create an audio file"));
        return;
      }

      resolve({ proc, file, recorder, stderr: () => stderr });
    }, 650);
  });
}

export class VoiceRuntime {
  constructor(options = {}) {
    this.options = options;
    this.recording = null;
    this.recordingError = "";
    this.transcription = null;
    this.pendingSubmit = false;
  }

  isRecording() {
    return Boolean(this.recording);
  }

  isTranscribing() {
    return Boolean(this.transcription);
  }

  async start(settings = {}) {
    if (this.recording) return this.recording.file;

    const dir = getAudioDir(this.options, settings);
    await ensureDir(dir);
    const recorderSettings = { ...this.options, ...settings, downloadDir: settings.downloadDir || this.options.downloadDir };
    const recorderReady = await ensureManagedRecorder(recorderSettings, settings).catch((error) => {
      if (isWindows(recorderSettings)) throw error;
      return null;
    });
    if (recorderReady?.resolvedBinary) recorderSettings.ffmpeg = recorderReady.resolvedBinary;

    const file = path.join(dir, `voice-${Date.now()}.wav`);
    const recorders = buildRecorders(file, recorderSettings);
    const errors = [];
    this.recordingError = "";

    for (const recorder of recorders) {
      await fs.promises.unlink(file).catch(() => {});
      try {
        const active = await startRecorder(recorder, file);
        active.proc.on("exit", () => {
          if (this.recording?.proc === active.proc) this.recording = null;
        });
        this.recording = active;
        return file;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    throw new Error(`Could not start recorder. Tried: ${errors.join("; ")}`);
  }

  async stop() {
    const active = this.recording;
    if (!active) return null;

    try {
      active.proc.kill("SIGINT");
    } catch {}

    await waitForExit(active.proc);
    this.recording = null;

    if (!fs.existsSync(active.file)) {
      const lastError = lastLine(active.stderr?.() || this.recordingError);
      throw new Error(lastError || `${active.recorder?.label || "Recorder"} did not create an audio file`);
    }

    if (fs.statSync(active.file).size <= RECORDING_MIN_BYTES) {
      throw new Error("Recording is empty. Check your microphone input.");
    }

    return active.file;
  }

  async cancel() {
    if (this.recording) {
      try {
        this.recording.proc.kill("SIGKILL");
      } catch {}
      this.recording = null;
    }

    if (this.transcription) {
      try {
        this.transcription.kill("SIGKILL");
      } catch {}
      this.transcription = null;
    }
  }

  async transcribe(audioFile, model, settings = {}) {
    const commandOptions = { ...this.options, downloadDir: settings.downloadDir };
    const whisperCli = resolveCommand("whisper-cli", commandOptions);
    if (!whisperCli) {
      throw new Error("whisper-cli not found. Install whisper.cpp or set OPENCODE_VOICE_WHISPER_CLI to the binary path.");
    }

    const modelFile = getModelPath(model, this.options, settings);
    if (!fs.existsSync(modelFile)) {
      throw new Error(`Model is not downloaded: ${model.name}`);
    }

    const args = ["-m", modelFile, "-f", audioFile, "-np", "-nt"];
    if (settings.language && settings.language !== "auto") args.push("-l", settings.language);

    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      const proc = spawn(whisperCli, args, { env: childEnv(commandOptions), stdio: ["ignore", "pipe", "pipe"] });
      this.transcription = proc;

      const timer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {}
        this.transcription = null;
        reject(new Error("Transcription timed out"));
      }, this.options.transcriptionTimeoutMs || 120000);

      proc.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      proc.on("error", (error) => {
        clearTimeout(timer);
        this.transcription = null;
        reject(error);
      });
      proc.on("exit", (code) => {
        clearTimeout(timer);
        this.transcription = null;
        if (code !== 0) {
          reject(new Error(stderr.trim().split("\n").pop() || `whisper-cli exited with code ${code}`));
          return;
        }

        const text = cleanTranscription(stdout);
        if (!text) {
          reject(new Error("Transcription returned empty text"));
          return;
        }
        resolve(text);
      });
    });
  }
}
