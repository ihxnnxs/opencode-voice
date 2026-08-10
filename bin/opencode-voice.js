#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const [command, ...args] = process.argv.slice(2);

function hasFlag(flag) {
  return args.includes(flag);
}

function help() {
  console.log(`opencode-voice

Usage:
  opencode-voice install [--global] [--no-engine]
  opencode-voice update [--global]
  opencode-voice doctor [--json]
  opencode-voice engine status <whisper.cpp|transcribe-cpp> [--json]
  opencode-voice engine install <whisper.cpp|transcribe-cpp>
  opencode-voice engine import <whisper.cpp|transcribe-cpp> [path-to-binary]
  opencode-voice engine remove <whisper.cpp|transcribe-cpp>

Development install from this checkout:
  opencode plugin <path-to-this-checkout>
`);
}

function packageName() {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  return process.env.OPENCODE_VOICE_PACKAGE || manifest.name || "opencode-voice";
}

function probeCommand(command, args = ["-version"]) {
  if (!command) return { ok: false, message: "missing" };
  try {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 2000,
    });

    if (result.error) {
      return { ok: false, message: result.error.message };
    }

    if (typeof result.status === "number" && result.status !== 0) {
      return {
        ok: false,
        message: `exit ${result.status}`,
        stderr: (result.stderr || "").trim(),
      };
    }

    const output = `${result.stdout || ""}${result.stderr || ""}`;
    return { ok: true, versionLine: output.split("\n").filter(Boolean)[0] || "" };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

async function runtime() {
  const [engine, models, engines] = await Promise.all([import("../lib/engine.js"), import("../lib/models.js"), import("../lib/engines.js")]);
  return { ...engine, ...models, ...engines };
}

async function doctor() {
  const {
    ensureManagedRecorder,
    resolveCommand,
    getAudioDir,
    getCacheDir,
    getEngineStatus,
    getModelsDir,
    getRecorderStatus,
    listMicrophones,
    probeEngine,
  } = await runtime();

  const json = hasFlag("--json");
  let recorderInstall = null;
  let recorderInstallError = "";
  if (process.platform === "win32") {
    try {
      recorderInstall = await ensureManagedRecorder(
        {},
        {},
        json ? {} : { onProgress: printRecorderProgress, onRetry: printRecorderRetry },
      );
    } catch (error) {
      recorderInstallError = error instanceof Error ? error.message : String(error);
    }
  }

  const recorderOptions = process.platform === "win32" && recorderInstall?.resolvedBinary
    ? { ffmpeg: recorderInstall.resolvedBinary, skipFfmpegStaticInstall: true }
    : {};
  const engine = getEngineStatus("whisper.cpp");
  const probe = engine.resolvedBinary ? await probeEngine("whisper.cpp", engine.resolvedBinary) : { ok: false, message: "missing binary" };
  const sidecar = getEngineStatus("transcribe-cpp");
  const sidecarProbe = sidecar.resolvedBinary ? await probeEngine("transcribe-cpp", sidecar.resolvedBinary) : { ok: false, message: "missing binary" };
  const recorder = getRecorderStatus(recorderOptions);
  const ffmpeg = recorderInstall?.resolvedBinary || resolveCommand("ffmpeg", recorderOptions);
  const arecord = resolveCommand("arecord", recorderOptions);
  const sox = resolveCommand("sox", recorderOptions);
  const payload = {
    platform: `${process.platform}-${process.arch}`,
    cacheDir: getCacheDir(),
    modelsDir: getModelsDir(),
    recordingsDir: getAudioDir(),
    engine,
    probe,
    sidecar,
    sidecarProbe,
    recorder,
    recorders: {
      ffmpeg,
      arecord,
      sox,
      ffmpegPresent: Boolean(ffmpeg),
      arecordPresent: Boolean(arecord),
      soxPresent: Boolean(sox),
      ffmpegProbe: probeCommand(ffmpeg),
      arecordProbe: probeCommand(arecord, ["--help"]),
      soxProbe: probeCommand(sox, ["--help"]),
      managedInstall: recorderInstall,
      managedInstallError: recorderInstallError,
    },
    microphones: listMicrophones(recorderOptions),
  };

  if (json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(
      [
        "opencode-voice doctor",
        "",
        `Platform: ${payload.platform}`,
        `Cache dir: ${payload.cacheDir}`,
        `Models dir: ${payload.modelsDir}`,
        `Recordings dir: ${payload.recordingsDir}`,
        `Engine source: ${engine.source}`,
        `Managed engine dir: ${engine.managedDir}`,
        `whisper-cli: ${engine.resolvedBinary || "missing"}`,
        `Probe: ${probe.ok ? "ok" : probe.message}`,
        `Sidecar source: ${sidecar.source}`,
        `opencode-voice-transcribe: ${sidecar.resolvedBinary || "missing"}`,
        `Sidecar probe: ${sidecarProbe.ok ? "ok" : sidecarProbe.message}`,
        `Recorder source: ${recorder.source}`,
        `Managed recorder dir: ${recorder.managedDir}`,
        `Managed recorder installed: ${recorder.managedInstalled ? "yes" : "no"}`,
        `Managed recorder version: ${recorder.manifest?.version || "missing"}`,
        `Managed recorder probe: ${payload.recorders.ffmpegProbe.ok ? "ok" : payload.recorders.ffmpegProbe.message}`,
        ...(recorderInstallError ? [`Managed recorder error: ${recorderInstallError}`] : []),
        `Recorders: ffmpeg=${payload.recorders.ffmpegPresent ? "yes" : "no"}${payload.recorders.ffmpeg ? ` (${payload.recorders.ffmpeg})` : ""}, arecord=${payload.recorders.arecordPresent ? "yes" : "no"}${payload.recorders.arecord ? ` (${payload.recorders.arecord})` : ""}, sox=${payload.recorders.soxPresent ? "yes" : "no"}${payload.recorders.sox ? ` (${payload.recorders.sox})` : ""}`,
        `Microphones: ${payload.microphones.join(", ")}`,
      ].join("\n"),
    );
  }

  if (!engine.resolvedBinary || !probe.ok || (process.platform === "win32" && !payload.recorders.ffmpegProbe.ok)) process.exitCode = 1;
}

async function engineCommand() {
  const [action, engineId = "whisper.cpp", maybePath] = args;
  const { getEngineStatus, importManagedEngine, installManagedEngine, removeManagedEngine } = await runtime();

  if (!["whisper.cpp", "transcribe-cpp"].includes(engineId)) {
    console.error(`Unsupported engine: ${engineId}`);
    process.exit(1);
  }

  if (action === "status") {
    const status = getEngineStatus(engineId);
    if (hasFlag("--json")) console.log(JSON.stringify(status, null, 2));
    else {
      console.log(
        [
          `Engine: ${status.id}`,
          `Platform: ${status.platform}`,
          `Source: ${status.source}`,
          `Resolved binary: ${status.resolvedBinary || "missing"}`,
          `Managed binary: ${status.managedBinary}`,
          `Managed installed: ${status.managedInstalled ? "yes" : "no"}`,
          `Managed version: ${status.manifest?.version || "missing"}`,
        ].join("\n"),
      );
    }
    if (!status.resolvedBinary) process.exitCode = 1;
    return;
  }

  if (action === "import") {
    const status = getEngineStatus(engineId);
    const source = maybePath || (status.source !== "managed" ? status.resolvedBinary : "");
    const result = await importManagedEngine(engineId, source);
    console.log(`Imported ${engineId}: ${result.managedBinary}`);
    return;
  }

  if (action === "install") {
    const result = await installManagedEngine(engineId, {}, {}, { onProgress: printEngineProgress, onRetry: printEngineRetry });
    console.log(`Installed ${engineId}: ${result.managedBinary}`);
    return;
  }

  if (action === "remove") {
    const dir = await removeManagedEngine(engineId);
    console.log(`Removed managed ${engineId}: ${dir}`);
    return;
  }

  help();
  process.exitCode = 1;
}

function printEngineProgress(progress) {
  const label = {
    registry: "registry",
    downloading: "download",
    verifying: "verify archive",
    decompressing: "unpack",
    "verifying-binary": "verify binary",
    probing: "probe",
    done: "done",
  }[progress.state] || progress.state || "engine";
  const percent = Number.isFinite(progress.percent) ? `${Math.round(progress.percent)}%` : "";
  if (progress.state === "downloading" || progress.state === "done") console.log(`engine ${label} ${percent}`.trim());
}

function printEngineRetry({ error, nextAttempt, attempts }) {
  console.warn(`engine retry ${nextAttempt}/${attempts}: ${error instanceof Error ? error.message : String(error)}`);
}

function printRecorderProgress(progress) {
  const label = {
    downloading: "download",
    decompressing: "unpack",
    probing: "probe",
    done: "done",
  }[progress.state] || progress.state || "recorder";
  const percent = Number.isFinite(progress.percent) ? `${Math.round(progress.percent)}%` : "";
  if (progress.state === "downloading" || progress.state === "done") console.log(`recorder ${label} ${percent}`.trim());
}

function printRecorderRetry({ error, nextAttempt, attempts }) {
  console.warn(`recorder retry ${nextAttempt}/${attempts}: ${error instanceof Error ? error.message : String(error)}`);
}

async function installCommand() {
  const pluginArgs = args.filter((arg) => arg !== "--no-engine");
  const spawnOptions = { stdio: "inherit" };
  if (process.platform === "win32") spawnOptions.shell = true;
  const result = spawnSync("opencode", ["plugin", packageName(), ...pluginArgs], spawnOptions);
  if (result.error) {
    console.error(`Failed to run opencode: ${result.error.message}`);
    process.exit(1);
  }
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);

  if (!hasFlag("--no-engine")) {
    const { installManagedEngine } = await runtime();
    console.log("Installing managed voice engine...");
    const engine = await installManagedEngine("whisper.cpp", {}, {}, { onProgress: printEngineProgress, onRetry: printEngineRetry });
    console.log(`Managed voice engine ready: ${engine.managedBinary}`);
  }

  if (process.platform === "win32") {
    const { ensureManagedRecorder } = await runtime();
    console.log("Installing managed Windows recorder...");
    const recorder = await ensureManagedRecorder({}, {}, { onProgress: printRecorderProgress, onRetry: printRecorderRetry });
    console.log(`Managed Windows recorder ready: ${recorder.managedBinary || recorder.resolvedBinary}`);
  }
}

function updateCommand() {
  const pluginArgs = args.filter((arg) => arg === "--global");
  const spawnOptions = { stdio: "inherit" };
  if (process.platform === "win32") spawnOptions.shell = true;
  const result = spawnSync("opencode", ["plugin", packageName(), "--force", ...pluginArgs], spawnOptions);
  if (result.error) {
    console.error(`Failed to run opencode: ${result.error.message}`);
    process.exit(1);
  }
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
}

if (command === "install") await installCommand();
else if (command === "update") updateCommand();
else if (command === "doctor") await doctor();
else if (command === "engine") await engineCommand();
else help();
