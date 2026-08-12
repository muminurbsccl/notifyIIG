# OpenCode Model Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan one task at a time. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure global OpenCode routing so Luna Pro orchestrates and plans while the free DeepSeek V4 Flash model implements code changes as a dedicated worker.

**Architecture:** Keep the existing global Superpowers plugin and add global defaults plus two file-based agents. `orchestrator` is the default primary agent using Luna Pro; it applies the Superpowers workflow and delegates implementation to `worker`, which uses the free DeepSeek model and cannot create nested subagents.

**Tech Stack:** OpenCode JSONC configuration, OpenCode Markdown agent definitions, OpenRouter model IDs, and the existing Superpowers plugin.

## Global Constraints

- The global configuration file is `C:\Users\Mumin\.config\opencode\opencode.jsonc`.
- The default model is `openrouter/openai/gpt-5.6-luna-pro`.
- The worker model is `openrouter/deepseek/deepseek-v4-flash:free`.
- The `small_model` is the free DeepSeek model.
- The existing `superpowers@git+https://github.com/obra/superpowers.git` plugin remains enabled.
- No API keys or other secrets are written to configuration or agent files.
- No automatic paid fallback is configured for worker tasks.
- `subagent_depth` is `1` so the orchestrator can delegate once and the worker cannot delegate again.
- The active workspace is not a Git repository, so no commit step is applicable.

---

## File Map

- Modify: `C:\Users\Mumin\.config\opencode\opencode.jsonc` for global defaults and the preserved plugin.
- Create: `C:\Users\Mumin\.config\opencode\agent\orchestrator.md` for Luna Pro's primary-agent workflow.
- Create: `C:\Users\Mumin\.config\opencode\agent\worker.md` for DeepSeek's implementation workflow.
- Reference: `D:\upstreamnotify\docs\superpowers\specs\2026-07-31-opencode-model-routing-design.md` for the approved design.

### Task 1: Configure Global Model Defaults

**Files:**
- Modify: `C:\Users\Mumin\.config\opencode\opencode.jsonc`

**Interfaces:**
- Produces the global `model`, `small_model`, `default_agent`, and `subagent_depth` values consumed by all sessions and agent definitions.

- [ ] **Step 1: Replace only the global configuration body with the approved settings**

Preserve every existing field and plugin entry, add the supported OpenRouter
model override, and use this complete JSONC content:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "openrouter/openai/gpt-5.6-luna-pro",
  "small_model": "openrouter/deepseek/deepseek-v4-flash:free",
  "default_agent": "orchestrator",
  "subagent_depth": 1,
  "plugin": ["superpowers@git+https://github.com/obra/superpowers.git"],
  "provider": {
    "openrouter": {
      "models": {
        "deepseek/deepseek-v4-flash:free": {}
      }
    }
  }
}
```

- [ ] **Step 2: Resolve the configuration through OpenCode**

Run from `D:\upstreamnotify`:

```powershell
opencode debug config
```

Expected result: the command exits successfully and the resolved configuration contains `model`, `small_model`, `default_agent`, `subagent_depth`, the existing Superpowers plugin, and the OpenRouter model override without a `ConfigInvalidError`.

### Task 2: Add Orchestrator and Worker Agents

**Files:**
- Create: `C:\Users\Mumin\.config\opencode\agent\orchestrator.md`
- Create: `C:\Users\Mumin\.config\opencode\agent\worker.md`

**Interfaces:**
- Produces a primary agent named `orchestrator` using Luna Pro.
- Produces a subagent named `worker` using DeepSeek V4 Flash Free.
- The orchestrator delegates implementation work to the `worker` agent by name.

- [ ] **Step 1: Create the orchestrator agent definition**

Create `C:\Users\Mumin\.config\opencode\agent\orchestrator.md` with:

```markdown
---
description: Coordinates requirements, Superpowers planning, worker delegation, and final review.
mode: primary
model: openrouter/openai/gpt-5.6-luna-pro
color: primary
---

You are the primary OpenCode orchestrator and planner.

Workflow:

1. Inspect the active repository, current instructions, and existing changes before proposing edits.
2. For new features or behavior changes, invoke the `/brainstorming` skill before implementation. Ask focused questions, present the design, and obtain approval when the workflow requires it.
3. For bugs, test failures, or unexpected behavior, invoke systematic debugging before proposing a fix.
4. For multi-step implementation, create or follow an implementation plan before delegation.
5. Delegate repository edits and test execution to the `worker` subagent whenever the task is suitable for an implementation worker.
6. Review the worker's changed files and verification evidence. Do not claim completion without concrete test or validation results.

Delegation rules:

- Give the worker a self-contained task with the relevant requirements, files, constraints, and verification commands.
- Keep planning, architecture decisions, user communication, and final review in this agent.
- Do not silently change the worker model to a paid model when the free worker is unavailable. Report the failure or split the task instead.
- Preserve unrelated user changes and do not use destructive Git commands.
- Use the available Superpowers skills, including `/brainstorming`, writing plans, executing plans, systematic debugging, and verification before completion.

Final response requirements:

- Summarize the implemented result.
- List the files changed by the worker.
- State the exact verification commands run and whether they passed.
- Identify any remaining risks, unavailable services, or restart requirements.
```

- [ ] **Step 2: Create the worker agent definition**

Create `C:\Users\Mumin\.config\opencode\agent\worker.md` with:

```markdown
---
description: Implements assigned repository changes and reports concrete verification evidence.
mode: subagent
model: openrouter/deepseek/deepseek-v4-flash:free
color: secondary
---

You are the implementation worker for the OpenCode orchestrator.

Execution rules:

1. Read the assigned requirements and inspect the relevant repository files before editing.
2. Follow the orchestrator's plan and constraints exactly. If the task is ambiguous or the plan conflicts with the repository, report the issue instead of guessing.
3. Make the smallest correct changes and preserve unrelated user modifications.
4. Use the applicable Superpowers skill when the task requires debugging, planning, testing, or verification.
5. Run the exact tests, linters, build checks, or configuration checks that apply to the assigned change.
6. Do not create or invoke additional subagents.
7. Do not claim a check passed unless its command completed successfully.

Return a concise worker report containing:

- The implementation performed.
- The files changed.
- The verification commands run and their results.
- Any blockers, assumptions, or remaining risks.
```

- [ ] **Step 3: Confirm both definitions are syntactically discoverable**

Run from `D:\upstreamnotify`:

```powershell
opencode agent list
opencode debug agent orchestrator
opencode debug agent worker
```

Expected result: `orchestrator` is listed as a primary agent with model `openrouter/openai/gpt-5.6-luna-pro`, and `worker` is listed as a subagent with model `openrouter/deepseek/deepseek-v4-flash:free`.

### Task 3: Verify Provider Availability and Delegated Routing

**Files:**
- Read: `C:\Users\Mumin\.config\opencode\opencode.jsonc`
- Read: `C:\Users\Mumin\.config\opencode\agent\orchestrator.md`
- Read: `C:\Users\Mumin\.config\opencode\agent\worker.md`

**Interfaces:**
- Validates the resolved model identifiers, agent discovery, Superpowers skill discovery, and a read-only worker request.

- [ ] **Step 1: Refresh and inspect OpenRouter's model catalog**

Run:

```powershell
opencode models openrouter --refresh
```

Expected result: the catalog includes `openai/gpt-5.6-luna-pro` and the explicitly configured `deepseek/deepseek-v4-flash:free` override, or the live request reports the precise external provider availability/authentication issue. The worker model remains pinned to the `:free` slug; do not replace it or add a paid fallback.

- [ ] **Step 2: Confirm the configured Superpowers skills are visible**

Run:

```powershell
opencode debug skill
```

Expected result: the available skills include the brainstorming workflow or the configured Superpowers skill source is shown. The existing plugin entry must remain present in `opencode debug config`.

- [ ] **Step 3: Run a read-only worker smoke test**

Run from `D:\upstreamnotify`:

```powershell
opencode run --agent orchestrator "Delegate exactly one task to the worker agent. The delegated task must be read-only and use this exact instruction: 'Inspect the workspace and report the files present. Do not edit any files, create files, run destructive commands, or delegate to another agent.' Do not delegate any other task. Do not edit files, create files, or run destructive commands yourself. Return the worker report and identify the agent and model used."
```

The installed OpenCode CLI accepts the request as a positional message, and a
`subagent` cannot be selected as the primary CLI agent. The primary
`orchestrator` must therefore perform exactly one delegation to `worker`.
Expected result: the request completes through the orchestrator, exactly one
worker task is observed, the worker returns a report using
`openrouter/deepseek/deepseek-v4-flash:free`, and the workspace is unchanged.
If OpenRouter rejects the free model, record the exact provider response and do
not claim successful worker execution or runtime readiness.

- [ ] **Step 4: Confirm restart behavior**

The user may quit the running OpenCode TUI and start a new OpenCode session in `D:\upstreamnotify`; do not terminate the controller's active process from the verification command. The new session must resolve `orchestrator` as the default primary agent, Luna Pro as the primary model, and `worker` for delegation.

- [ ] **Step 5: Confirm the cost boundary**

Inspect the resolved configuration and agent details. Expected result: only the orchestrator uses `openrouter/openai/gpt-5.6-luna-pro`; the worker and `small_model` use the exact `openrouter/deepseek/deepseek-v4-flash:free` model, and no fallback model or API key is configured.

## Plan Self-Review

- **Spec coverage:** Global model defaults and plugin preservation are implemented in Task 1; agent responsibilities and routing are implemented in Task 2; failure visibility, provider checks, skill discovery, restart behavior, and cost boundaries are verified in Task 3.
- **Placeholder scan:** The plan contains no `TBD`, `TODO`, or deferred implementation steps.
- **Consistency check:** The model identifiers, agent names, modes, and `subagent_depth` value are identical in the configuration, agent definitions, and verification commands.
- **Scope check:** The plan changes only global OpenCode configuration and agent definitions; it does not alter application code or add unrelated tooling.
