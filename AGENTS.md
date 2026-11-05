# Bridge

Bridge is a Tauri 2 desktop app with a React/TypeScript frontend under `app/`
and a Rust shell under `app/src-tauri/`.

## Scope

Keep changes focused. The app has Overview, Agents, Activity, Models and
Environments, backed by a simulated preview engine (`app/src/agents/previewEngine.ts`)
behind the `AgentEngine` interface. Do not imply setup, isolation, testing or
deployment works on the host until a real engine implements and verifies it; keep
the "Preview data" label while the preview engine is active. Agent definitions use
kmx's `NAME.agent.md` format; Bridge-only settings stay under the `bridge:` key.
User-facing text must not mention Kubernetes concepts (clusters, pods, namespaces).

Preserve the Microsoft project files and all third-party notices. Do not edit
generated lockfiles by hand. Keep application code, tests and docs portable.

## Checks

From `app/`, use the pinned Node/npm versions in CONTRIBUTING.md:

```sh
npm ci
npm run lint
npm test
npm run build
cargo +1.98.1 fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo +1.98.1 test --release --manifest-path src-tauri/Cargo.toml --locked --features custom-protocol
cargo +1.98.1 clippy --release --manifest-path src-tauri/Cargo.toml --locked --all-targets --features custom-protocol -- -D warnings
```

Build frontend assets before Rust checks: Tauri embeds them.
Run `actionlint .github/workflows/checks.yml` after workflow changes.
CI builds Windows x64 and Apple silicon Mac. Walk visible changes in a native
build; a browser preview alone is not native verification.
