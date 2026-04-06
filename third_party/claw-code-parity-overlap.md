# `claw-code-parity` Overlap Note

`third_party/claw-code-parity` is a temporary comparison source only.
It is not a NemoClaw dependency, not a sandbox workspace, and not a skill
source. The intended end state is to remove the submodule after we preserve the
few useful comparison notes we care about.

## Decision

- Do not integrate `claw-code-parity` into NemoClaw runtime behavior.
- Do not mirror its files into `.agents/skills/`.
- Do not point OpenClaw workspace files or `skills.load.extraDirs` at it.
- Do not treat its CLI or session model as something NemoClaw should emulate.

## Overlap Map

### CLI and operator workflow

Status: already covered by NemoClaw/OpenClaw

- `claw` exposes prompt, status, sandbox, agents, MCP, skills, and system-prompt
  flows.
- NemoClaw plus OpenClaw already cover the same operator surface through
  `nemoclaw`, `openclaw`, and `openshell`.
- The overlap is conceptual, not additive. Importing or emulating `claw` would
  duplicate an existing control plane rather than extend it.

Conclusion:
- Do not port or wrap `claw` commands into NemoClaw.
- Keep `claw-code-parity` as a reference point only while auditing ideas.

### Permission, sandbox, and workspace semantics

Status: mostly already covered by NemoClaw/OpenClaw

- `claw-code-parity` has permission modes such as `read-only`,
  `workspace-write`, and `danger-full-access`.
- NemoClaw/OpenShell already enforce sandbox policy, filesystem isolation,
  process restrictions, and routed inference.
- `claw-code-parity` persists sessions and workspace state in its own project
  layout, while OpenClaw uses `/sandbox/.openclaw/workspace/` and related state.

Useful idea to revisit later:
- Permission terminology and UX can still be compared for operator clarity, but
  not for direct implementation reuse.

Conclusion:
- Preserve only behavioral insights, not file layout or policy implementation.
- Do not reuse the `claw-code-parity` workspace/session model inside NemoClaw.

### Skills, prompts, and workspace context

Status: overlap exists, but integration is intentionally out of scope

- `claw-code-parity` includes concepts around skills, prompts, and current
  workspace state.
- NemoClaw already has repo skills in `.agents/skills/`.
- OpenClaw already has sandbox workspace files such as `SOUL.md`, `USER.md`,
  `IDENTITY.md`, `AGENTS.md`, and `MEMORY.md`.

Conclusion:
- Do not load `claw-code-parity` through `.agents/skills/`.
- Do not use `skills.load.extraDirs` for `third_party/claw-code-parity`.
- Do not copy `claw-code-parity` content into sandbox workspace files unless a
  future task explicitly extracts a small curated summary.

## What To Preserve

- High-level product ideas worth revisiting later:
  - operator-facing permission terminology
  - session and status UX comparisons
  - inventory/reporting ideas for skills and MCP visibility

## Removal Path

When the overlap captured here is enough for future Gemma and NemoClaw work:

1. Remove the `third_party/claw-code-parity` submodule.
2. Keep this note if it still provides useful audit context.
3. Continue Gemma and NemoClaw work directly on OpenClaw/NemoClaw primitives,
   without any parity-layer dependency.
