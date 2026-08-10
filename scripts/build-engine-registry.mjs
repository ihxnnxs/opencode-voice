import fs from "node:fs";
import path from "node:path";

function parseArgs() {
  const out = {};
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) out[args[index].replace(/^--/, "")] = args[index + 1];
  return out;
}

const args = parseArgs();
const dir = path.resolve(args.dir || "dist/engines");
const repo = args.repo || process.env.GITHUB_REPOSITORY || "ihxnnxs/opencode-voice";
const tag = args.tag || process.env.ENGINE_RELEASE_TAG || "v0.1.0";
const version = args.version || process.env.WHISPER_CPP_REF || tag;
const assetBase = args.assetBase || process.env.ENGINE_ASSET_BASE || `https://github.com/${repo}/releases/download/${tag}`;
const engines = {};

for (const entry of fs.readdirSync(dir)) {
  if (!entry.endsWith(".json") || entry === "registry.json") continue;
  const metadata = JSON.parse(fs.readFileSync(path.join(dir, entry), "utf8"));
  const engine = engines[metadata.engineId || "whisper.cpp"] ||= {
    id: metadata.engineId || "whisper.cpp",
    kind: "cli",
    displayName: metadata.command || "whisper-cli",
    command: metadata.command || "whisper-cli",
    version: metadata.version || version,
    assets: {},
  };
  engine.assets[metadata.platform] = {
    kind: metadata.kind,
    url: `${assetBase.replace(/\/$/, "")}/${metadata.assetName}`,
    size: metadata.size,
    sha256: metadata.sha256,
    binary: metadata.binary,
  };
}

const registry = {
  schema: "opencode-voice.engines.v1",
  generatedAt: new Date().toISOString(),
  version,
  engines,
};

await fs.promises.mkdir(dir, { recursive: true });
await fs.promises.writeFile(path.join(dir, "registry.json"), `${JSON.stringify(registry, null, 2)}\n`);
console.log(`registry.json with ${Object.keys(engines).length} engines`);
