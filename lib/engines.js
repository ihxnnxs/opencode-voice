import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGunzip } from "node:zlib";
import { spawn } from "node:child_process";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { sha256, ensureDir } from "./download.js";
import { getCacheDir } from "./models.js";
import { getBundledEngineDir, resolveCommand } from "./engine.js";

export const DEFAULT_ENGINE_REGISTRY_URL = "https://github.com/ihxnnxs/opencode-voice/releases/download/v0.1.0/registry.json";

const ENGINE = {
  id: "whisper.cpp",
  command: "whisper-cli",
  probeArgs: ["--help"],
  probeContains: ["--model", "--file"],
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function executableName() {
  return process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
}

function normalizePlatform(value) {
  if (value === "x64" || value === "arm64") return value;
  if (value === "amd64") return "x64";
  if (value === "aarch64") return "arm64";
  return value;
}

export function getEnginePlatformKey(options = {}) {
  return `${options.platform || process.platform}-${normalizePlatform(options.arch || process.arch)}`;
}

export function getManagedEngineDir(engineId = ENGINE.id, options = {}, settings = {}) {
  if (engineId !== ENGINE.id) throw new Error(`Unsupported engine: ${engineId}`);
  return getBundledEngineDir(ENGINE.command, { ...options, downloadDir: settings.downloadDir });
}

export function getManagedEngineBinary(engineId = ENGINE.id, options = {}, settings = {}) {
  return path.join(getManagedEngineDir(engineId, options, settings), executableName());
}

export function getEngineManifestPath(engineId = ENGINE.id, options = {}, settings = {}) {
  return path.join(getManagedEngineDir(engineId, options, settings), "manifest.json");
}

export function readEngineManifest(engineId = ENGINE.id, options = {}, settings = {}) {
  const file = getEngineManifestPath(engineId, options, settings);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function engineSource(resolved, managedBinary, options = {}) {
  if (!resolved) return "missing";
  if (path.resolve(resolved) === path.resolve(managedBinary)) return "managed";
  if (options.whisperCli && path.resolve(resolved) === path.resolve(options.whisperCli)) return "option";
  if (process.env.OPENCODE_VOICE_WHISPER_CLI && path.resolve(resolved) === path.resolve(process.env.OPENCODE_VOICE_WHISPER_CLI)) return "env";
  return "system";
}

export function getEngineStatus(engineId = ENGINE.id, options = {}, settings = {}) {
  const commandOptions = { ...options, downloadDir: settings.downloadDir };
  const managedDir = getManagedEngineDir(engineId, options, settings);
  const managedBinary = getManagedEngineBinary(engineId, options, settings);
  const manifest = readEngineManifest(engineId, options, settings);
  const resolvedBinary = resolveCommand(ENGINE.command, commandOptions);

  return {
    id: engineId,
    command: ENGINE.command,
    platform: getEnginePlatformKey(options),
    cacheDir: getCacheDir(options, settings),
    managedDir,
    managedBinary,
    managedInstalled: fs.existsSync(managedBinary),
    manifest,
    resolvedBinary,
    source: engineSource(resolvedBinary, managedBinary, options),
  };
}

export async function probeEngine(engineId = ENGINE.id, binaryPath, options = {}) {
  if (engineId !== ENGINE.id) throw new Error(`Unsupported engine: ${engineId}`);
  if (!binaryPath) return { ok: false, message: "missing binary" };

  return new Promise((resolve) => {
    let output = "";
    const localLib = path.join(os.homedir(), ".local", "lib");
    const env = {
      ...process.env,
      PATH: [path.dirname(binaryPath), path.join(os.homedir(), ".local", "bin"), process.env.PATH].filter(Boolean).join(path.delimiter),
      LD_LIBRARY_PATH: [localLib, process.env.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter),
      DYLD_LIBRARY_PATH: [localLib, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(path.delimiter),
      ...options.env,
    };
    const proc = spawn(binaryPath, ENGINE.probeArgs, { stdio: ["ignore", "pipe", "pipe"], env });
    const timer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {}
      resolve({ ok: false, message: "probe timed out" });
    }, options.timeoutMs || 10000);

    proc.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    proc.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, message: error.message });
    });
    proc.on("exit", () => {
      clearTimeout(timer);
      const ok = ENGINE.probeContains.every((item) => output.includes(item));
      resolve({ ok, message: ok ? "ok" : "unexpected whisper-cli help output" });
    });
  });
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`Engine download timed out after ${Math.round(timeoutMs / 1000)}s`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readJsonUrl(url, options = {}) {
  if (url.startsWith("file://")) return JSON.parse(await fs.promises.readFile(new URL(url), "utf8"));
  if (!/^https?:\/\//.test(url)) return JSON.parse(await fs.promises.readFile(path.resolve(url), "utf8"));

  const response = await fetchWithTimeout(url, {}, Number(options.timeoutMs || 60000));
  if (!response.ok) throw new Error(`Engine registry failed: HTTP ${response.status}`);
  return response.json();
}

export function getEngineRegistryUrl(options = {}) {
  return options.engineRegistry || process.env.OPENCODE_VOICE_ENGINE_REGISTRY || DEFAULT_ENGINE_REGISTRY_URL;
}

export async function loadEngineRegistry(options = {}) {
  const url = getEngineRegistryUrl(options);
  const registry = await readJsonUrl(url, options);
  if (registry?.schema !== "opencode-voice.engines.v1") throw new Error("Unsupported engine registry schema");
  return { url, registry };
}

function engineDefinition(registry, engineId) {
  if (Array.isArray(registry.engines)) return registry.engines.find((engine) => engine.id === engineId);
  return registry.engines?.[engineId];
}

function selectEngineAsset(registry, engineId, platform) {
  const engine = engineDefinition(registry, engineId);
  if (!engine) throw new Error(`Engine not found in registry: ${engineId}`);
  const asset = engine.assets?.[platform];
  if (!asset) throw new Error(`No managed ${engineId} engine asset for ${platform}`);
  if (asset.kind !== "single-binary-gzip") throw new Error(`Unsupported engine asset kind: ${asset.kind}`);
  return { engine, asset };
}

async function downloadAsset(asset, compressedFile, hooks = {}, attempt = 1, attempts = 1, options = {}) {
  if (asset.url.startsWith("file://") || !/^https?:\/\//.test(asset.url)) {
    const source = asset.url.startsWith("file://") ? new URL(asset.url) : path.resolve(asset.url);
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

  const response = await fetchWithTimeout(asset.url, {}, Number(options.downloadTimeoutMs || hooks.timeoutMs || 120000));
  if (!response.ok) throw new Error(`Engine download failed: HTTP ${response.status}`);

  const contentLength = Number(response.headers.get("content-length") || asset.size || 0);
  let downloaded = 0;
  hooks.onProgress?.({ state: "downloading", downloaded, total: contentLength, percent: 0, attempt, attempts });

  const body = response.body?.getReader ? Readable.fromWeb(response.body) : response.body;
  if (!body) throw new Error("Engine download failed: empty response body");

  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      downloaded += chunk.length ?? chunk.byteLength ?? 0;
      hooks.onProgress?.({ state: "downloading", downloaded, total: contentLength, percent: contentLength ? (downloaded / contentLength) * 100 : 0, attempt, attempts });
      callback(null, chunk);
    },
  });

  await pipeline(body, progress, fs.createWriteStream(compressedFile));
}

async function writeManifest(engineId, managedBinary, source, options = {}) {
  const hash = await sha256(managedBinary);
  const stat = await fs.promises.stat(managedBinary);
  const manifest = {
    schema: "opencode-voice.engine-install.v1",
    id: engineId,
    kind: "cli",
    command: ENGINE.command,
    platform: getEnginePlatformKey(options),
    version: source.version || "local-import",
    source,
    files: [{ path: path.basename(managedBinary), sha256: hash, size: stat.size }],
    installedAt: new Date().toISOString(),
  };

  await fs.promises.writeFile(path.join(path.dirname(managedBinary), "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function installManagedEngine(engineId = ENGINE.id, options = {}, settings = {}, hooks = {}) {
  if (engineId !== ENGINE.id) throw new Error(`Unsupported engine: ${engineId}`);

  const managedDir = getManagedEngineDir(engineId, options, settings);
  const managedBinary = getManagedEngineBinary(engineId, options, settings);
  if (!hooks.force && fs.existsSync(managedBinary)) {
    const probe = await probeEngine(engineId, managedBinary);
    if (probe.ok) return { manifest: readEngineManifest(engineId, options, settings), managedBinary, skipped: true };
  }

  hooks.onProgress?.({ state: "registry", downloaded: 0, total: 0, percent: 0, attempt: 1, attempts: 1 });
  const { url: registryUrl, registry } = await loadEngineRegistry(options);
  const platform = getEnginePlatformKey(options);
  const { engine, asset } = selectEngineAsset(registry, engineId, platform);

  await ensureDir(managedDir);
  const compressedFile = path.join(managedDir, `${path.basename(asset.url || `${platform}.gz`)}.download`);
  const tmpBinary = `${managedBinary}.tmp-${process.pid}`;
  const attempts = Number(options.engineDownloadRetries || hooks.retries || 3);
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await fs.promises.unlink(compressedFile).catch(() => {});
      await fs.promises.unlink(tmpBinary).catch(() => {});
      await downloadAsset(asset, compressedFile, hooks, attempt, attempts, options);

      hooks.onProgress?.({ state: "verifying", downloaded: asset.size || 0, total: asset.size || 0, percent: 100, attempt, attempts });
      if (asset.sha256 && (await sha256(compressedFile)) !== asset.sha256) throw new Error("Engine archive SHA256 mismatch");

      hooks.onProgress?.({ state: "decompressing", downloaded: asset.size || 0, total: asset.size || 0, percent: 100, attempt, attempts });
      await pipeline(fs.createReadStream(compressedFile), createGunzip(), fs.createWriteStream(tmpBinary));
      await fs.promises.chmod(tmpBinary, Number.parseInt(asset.binary?.mode || "755", 8));

      hooks.onProgress?.({ state: "verifying-binary", downloaded: asset.binary?.size || 0, total: asset.binary?.size || 0, percent: 100, attempt, attempts });
      if (asset.binary?.sha256 && (await sha256(tmpBinary)) !== asset.binary.sha256) throw new Error("Engine binary SHA256 mismatch");

      hooks.onProgress?.({ state: "probing", downloaded: asset.binary?.size || 0, total: asset.binary?.size || 0, percent: 100, attempt, attempts });
      const probe = await probeEngine(engineId, tmpBinary);
      if (!probe.ok) throw new Error(`Engine probe failed: ${probe.message}`);

      await fs.promises.unlink(managedBinary).catch(() => {});
      await fs.promises.rename(tmpBinary, managedBinary);
      await fs.promises.unlink(compressedFile).catch(() => {});
      const manifest = await writeManifest(
        engineId,
        managedBinary,
        {
          type: "registry",
          registry: registryUrl,
          url: asset.url,
          version: engine.version || registry.version || "registry",
          upstream: engine.upstream,
        },
        options,
      );
      hooks.onProgress?.({ state: "done", downloaded: asset.binary?.size || asset.size || 0, total: asset.binary?.size || asset.size || 0, percent: 100, attempt, attempts });
      return { manifest, managedBinary, skipped: false };
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

export async function importManagedEngine(engineId = ENGINE.id, sourcePath, options = {}, settings = {}) {
  if (!sourcePath) throw new Error("Pass a whisper-cli path to import");
  if (engineId !== ENGINE.id) throw new Error(`Unsupported engine: ${engineId}`);

  const source = path.resolve(sourcePath.replace(/^~(?=$|\/)/, os.homedir()));
  const stat = await fs.promises.stat(source).catch(() => null);
  if (!stat?.isFile()) throw new Error(`Engine binary not found: ${source}`);

  const managedDir = getManagedEngineDir(engineId, options, settings);
  const managedBinary = getManagedEngineBinary(engineId, options, settings);
  const tmp = `${managedBinary}.tmp-${process.pid}`;
  await ensureDir(managedDir);
  await fs.promises.copyFile(source, tmp);
  await fs.promises.chmod(tmp, 0o755);

  const probe = await probeEngine(engineId, tmp);
  if (!probe.ok) {
    await fs.promises.unlink(tmp).catch(() => {});
    throw new Error(`Imported binary failed probe: ${probe.message}`);
  }

  await fs.promises.unlink(managedBinary).catch(() => {});
  await fs.promises.rename(tmp, managedBinary);
  const manifest = await writeManifest(engineId, managedBinary, { type: "local-file", path: source }, options);
  return { manifest, managedBinary };
}

export async function removeManagedEngine(engineId = ENGINE.id, options = {}, settings = {}) {
  const dir = getManagedEngineDir(engineId, options, settings);
  await fs.promises.rm(dir, { recursive: true, force: true });
  return dir;
}
