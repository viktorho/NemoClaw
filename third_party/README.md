# Third-Party Context

This directory holds external repositories and materials that we keep only for
NemoClaw reference and context.

## Boundaries

- Treat everything here as read-only context unless a separate task explicitly
  says otherwise.
- `claw-code-parity` is not authoritative NemoClaw code.
- `claw-code-parity` is a temporary audit source and is intended for removal
  after overlap notes are captured.
- Do not copy files from here into core NemoClaw paths such as `bin/`,
  `nemoclaw/`, `nemoclaw-blueprint/`, `scripts/`, or `test/` without an
  explicit follow-up change.
- Do not point sandbox workspace files, NemoClaw configs, or skill-loading
  paths at `third_party/` content.
- Prefer updating external materials through their upstream source or submodule
  revision instead of vendoring ad hoc snapshots into the main repo.

## Current Contents

- `claw-code-parity/`: temporary comparison submodule kept read-only during the
  audit period.
- `claw-code-parity-overlap.md`: overlap map and removal note for the parity
  submodule.
- `gemma4-nvfp4/`: local setup notes and helper scripts for serving the NVIDIA
  NVFP4 Gemma 4 checkpoint on the host before routing NemoClaw to it.
