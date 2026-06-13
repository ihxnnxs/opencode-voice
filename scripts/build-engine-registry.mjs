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
const assets = {};

for (const entry of fs.readdirSync(dir)) {
  if (!entry.endsWith(".json") || entry === "registry.json") continue;
  const metadata = JSON.parse(fs.readFileSync(path.join(dir, entry), "utf8"));
  assets[metadata.platform] = {
    kind: metadata.kind,
    url: `https://github.com/${repo}/releases/download/${tag}/${metadata.assetName}`,
    size: metadata.size,
    sha256: metadata.sha256,
    binary: metadata.binary,
  };
}

const registry = {
  schema: "opencode-voice.engines.v1",
  generatedAt: new Date().toISOString(),
  version,
  engines: {
    "whisper.cpp": {
      id: "whisper.cpp",
      kind: "cli",
      displayName: "whisper.cpp whisper-cli",
      command: "whisper-cli",
      version,
      upstream: {
        repo: "ggml-org/whisper.cpp",
        ref: version,
      },
      assets,
    },
  },
};

await fs.promises.mkdir(dir, { recursive: true });
await fs.promises.writeFile(path.join(dir, "registry.json"), `${JSON.stringify(registry, null, 2)}\n`);
console.log(`registry.json with ${Object.keys(assets).length} assets`);
