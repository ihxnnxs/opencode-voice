# Publishing

## npm name

The package publishes as `@hxnnxs/opencode-voice`.

The unscoped npm name `opencode-voice` is already published by another author, so do not publish this project under the unscoped name.

Before publishing:

1. Confirm `package.json#name` is `@hxnnxs/opencode-voice`.
2. Keep the OpenCode plugin id as `opencode-voice` unless you want users to see a different plugin id.
3. Confirm published install examples in all `README*.md` files use `@hxnnxs/opencode-voice`.
4. Create the GitHub repository `ihxnnxs/opencode-voice` and push `main`.
5. Run the **Engine Release** GitHub Actions workflow first. It must publish:

```txt
https://github.com/ihxnnxs/opencode-voice/releases/download/v0.1.0/registry.json
```

6. Confirm the registry contains assets for the target release platforms.
7. Run:

```bash
npm run check
npm pack --dry-run --json
npm publish --dry-run
```

## Release checklist

- Confirm `bin/opencode-voice.js` is executable in `npm pack --dry-run --json` (`mode: 493`).
- Confirm `opencode-voice engine install whisper.cpp` downloads and probes the managed engine from the release registry.
- Confirm `opencode-voice doctor` reports a working managed engine probe.
- Confirm model downloads write `.sha256` verification markers.
- Tag the release after the GitHub Actions release check passes.
