# Multiplayer Game Engine Constitution

## Core Principles

### I. Server Authority and Session Isolation
The server MUST validate identity, membership, settings, inputs, movement, combat,
respawn timing, scores, and progression. Clients express intent and render results.
Each session MUST own separate mutable simulation state; session caps and admissions
MUST be enforced atomically. This prevents cheating and cross-session interference.

### II. Game Themes Through Public Contracts
Users select Game Themes. A theme MUST bundle a versioned game module and skin.
The core MUST own identity, transport, session lifecycle, authoritative execution,
and metrics; gameplay and presentation MUST use documented extension contracts.
The default dots-and-squares theme MUST use those same contracts. Contract changes
MUST declare compatibility and migration behavior. Trusted developer modules may
extend behavior; cosmetic uploads MUST NOT become executable code.

### III. Focused Verification
Changes MUST include evidence appropriate to their risk. Authority, admission races,
session isolation, respawn, reconnect, theme compatibility, and finalization MUST
have automated coverage. Browser flows MUST be checked before calling them verified.
Documentation changes require consistency checks, not artificial runtime tests.
No test or capacity result may be claimed without execution and recorded conditions.

### IV. Measured Capacity and Bounded Work
The engine MUST measure simulation duration, event-loop delay, connections, entity
counts, traffic, and latency without logging secrets. Load reports MUST identify
hardware, configuration, workload, duration, and limits. Entity counts, message
sizes, queues, and per-tick work MUST have explicit bounds. Limits may be raised
intentionally for testing; no fixed player capacity is promised before measurement.

### V. Simple Defaults and Secure Identity
The default theme MUST favor clear shapes and functional controls over artwork.
Accounts MUST store salted password hashes and use revocable authenticated sessions.
Secrets MUST remain outside version control and public output. Public mutations and
WebSocket connections MUST validate authorization and origin. Persistent records
MUST distinguish finished, abandoned, and interrupted games.

## Product Boundaries
The initial target is a browser game on one AWS Lightsail host, supporting at most
five waiting/running sessions. Confirmed requirements take precedence over suggested
defaults. Respawn delay defaults to five seconds, uses a random safe location, and
MUST NOT grant damage immunity. Game modules remain server-authoritative even when
skins or interface implementations are replaced. Infrastructure spending and live
AWS changes require an explicit deployment instruction and available access.

## Development Workflow
Use the installed Spec Kit constitution, specification, plan, tasks, implementation,
and convergence workflow. Read the active feature artifacts before edits. Keep one
feature branch with sequential handoffs and no worktrees unless requested. Mark
assumptions and new defaults explicitly. Record meaningful agent mistakes and actual
verification evidence; the student's personal reflection log remains their own work.
Implementation MUST trace to tasks and acceptance criteria. Do not mark unchecked
work complete or replace a measured result with an estimate.

## Governance
This is the initial constitution, version 1.0.0. Amendments MUST identify the changed
principle, reason, affected contracts/specifications, and migration or validation work.
Use major versions for incompatible principle changes, minor for added governance,
and patch for wording clarification. Review each implementation slice against these
principles. Exceptions MUST be documented with scope and rationale before use.

**Version**: 1.0.0 | **Ratified**: 2026-11-06 | **Last Amended**: 2026-11-06
