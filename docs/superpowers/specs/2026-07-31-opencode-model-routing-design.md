# OpenCode Model Routing Design

**Date:** 2026-07-31
**Status:** Approved

## Purpose

Configure OpenCode so a capable OpenRouter model coordinates work while a free
DeepSeek model performs implementation tasks. The existing Superpowers plugin
must remain enabled, and the orchestration instructions must require the
brainstorming and planning workflow for new work.

## Current Context

- The active configuration is the global file at
  `C:\Users\Mumin\.config\opencode\opencode.jsonc`.
- The current configuration only declares the OpenCode schema and the
  `superpowers@git+https://github.com/obra/superpowers.git` plugin.
- The workspace at `D:\upstreamnotify` has no project-level OpenCode
  configuration or Git repository.
- OpenRouter identifies the free model as
  `deepseek/deepseek-v4-flash:free`.
- The orchestrator model is
  `openrouter/openai/gpt-5.6-luna-pro`.

## Goals

- Make `orchestrator` the default primary agent.
- Use `openrouter/openai/gpt-5.6-luna-pro` for orchestration, planning, and
  review.
- Provide a named `worker` subagent using
  `openrouter/deepseek/deepseek-v4-flash:free` for code changes and tests.
- Keep lightweight model work, such as title generation, on the free model.
- Preserve the existing Superpowers plugin.
- Require the orchestrator to use `/brainstorming` before new feature or
  behavior work and to create an implementation plan before delegation.
- Prevent the worker from creating additional subagents.

## Non-Goals

- Do not add API keys or other secrets to configuration files.
- Do not add an automatic paid fallback for worker tasks.
- Do not change the project's application code.
- Do not replace or fork the Superpowers plugin.

## Architecture

### Global Configuration

The global `opencode.jsonc` will define:

- `model` as `openrouter/openai/gpt-5.6-luna-pro`.
- `small_model` as `openrouter/deepseek/deepseek-v4-flash:free`.
- `default_agent` as `orchestrator`.
- `subagent_depth` as `1`, allowing the orchestrator to delegate to the worker
  while preventing nested worker delegation.
- The existing Superpowers plugin unchanged.

### Orchestrator Agent

The `orchestrator` agent will be a primary agent using Luna Pro. Its prompt
will establish these responsibilities:

- Understand requirements and inspect the repository before making changes.
- Invoke `/brainstorming` for new features or behavior changes.
- Use systematic debugging for bugs and failures.
- Create or follow an implementation plan before delegating implementation.
- Delegate code edits and test execution to `worker` when a worker task is
  appropriate.
- Review the worker's changes and verification evidence before reporting
  completion.

### Worker Agent

The `worker` agent will be a subagent using DeepSeek V4 Flash Free. Its prompt
will establish these responsibilities:

- Implement the assigned task in the active repository.
- Follow the orchestrator's requirements and plan exactly.
- Inspect existing code before editing and preserve unrelated user changes.
- Run relevant tests, linters, or build checks.
- Return a concise report containing changed files, checks run, and any
  remaining risks.
- Do not delegate to other agents.

## Request Flow

1. The user starts a session and OpenCode selects `orchestrator`.
2. Luna Pro applies the Superpowers workflow and clarifies or designs the
   requested change when needed.
3. Luna Pro delegates implementation work to `worker`.
4. DeepSeek V4 Flash Free edits the repository and runs relevant checks.
5. Luna Pro reviews the worker report and changes, then performs or requests
   any remaining verification.
6. The orchestrator reports the final result and explicit verification status.

## Failure Handling

- If the free worker model is unavailable, rate-limited, or unable to complete
  a tool call, the worker task should fail visibly.
- The orchestrator may split or retry the task, but it must not silently switch
  the worker to a paid model.
- If OpenRouter authentication is missing, the user must configure OpenCode
  authentication or `OPENROUTER_API_KEY`; no credential is persisted in this
  design.
- If OpenCode has already been started, the user must restart it after the
  configuration or agent files change because those files are loaded at
  startup.

## Verification Plan

- Validate `opencode.jsonc` against `https://opencode.ai/config.json`.
- Confirm OpenCode discovers `orchestrator` as a primary agent and `worker` as
  a subagent.
- Confirm each agent reports the intended model identifier.
- Confirm both model identifiers are available through the OpenRouter account.
- Run a small delegated task that does not modify application behavior and
  verify the request flow and worker report.
- Restart OpenCode and confirm the routing remains active in a new session.

## Security and Cost Boundaries

- API keys remain outside tracked files.
- The worker is pinned to the `:free` DeepSeek model identifier.
- No paid fallback is configured for worker execution.
- The orchestrator intentionally uses the specified paid Luna Pro model for
  planning and review.
