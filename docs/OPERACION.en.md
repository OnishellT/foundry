# Operation

[English](OPERACION.en.md) | [Español](OPERACION.md)

## States and expectations

Capture detects completion signals and proposes tasks against a complete conversation revision. **It does not confirm that they are finished.** There are three independent human decisions:

1. Confirm completion: `episode.complete` with `id` and `completed: true`. The task becomes completed and remains unrated.
2. Assess the outcome: `episode.label` with `label: correct` or `incorrect`, after confirmation. The second option learns what to avoid; both paths require evaluation. `pending` retains completion but withdraws the assessment.
3. Approve adoption: after an eligible experiment, `candidate.promote` with `id` and `experiment_id`. No setting enables automatic promotion.

The system preserves revisions, confirmations and labels. Reopening with `completed: false` resets the assessment to pending and invalidates derived jobs/evidence. A correct label does not prove every step was useful. Extraction produces a hypothesis with positive and preventive formulations and evidence references.

Jobs are queued and can be cancelled. A process interruption preserves history; interrupted jobs are shown for explicit retry. Retrying an inference operation may consume quota again. The dashboard displays errors and decision reasons without treating infrastructure errors as evidence of improvement.

Promotion checks the experiment's evidence and configuration against the current state. If you change labels, cases, policy or harness, evaluate again. Synthetic proposals do not satisfy the real-inference requirement. General improvements need domain variety; repeating a single task does not establish generalization.

## Configure providers

The extraction provider reads evidence and returns a structured proposal. The replay provider modifies a disposable workspace to solve a task. You can configure each independently in Settings.

**Pi:** uses an authenticated Pi installation, normally with command `["pi"]`, model provider `openai-codex`, model `gpt-6.1-sol` and reasoning `medium`. Analysis runs in an empty temporary directory without tools, extensions, MCP, skills, context files or persistent sessions. Foundry requests JSON and validates the response locally; it does not claim that Pi enforces a schema during generation. Replay retains built-in tools and operates within the case workspace, while keeping extensions and inherited sessions disabled.

The CLI configures analysis and replay independently, without running inference:

```bash
conversation-foundry configure --provider pi --provider-id openai-codex \
  --model gpt-6.1-sol --reasoning medium --target analysis
```

`--target analysis` is the default and preserves replay settings. Use `--target replay` to change only the evaluation agent or `--target both` to explicitly apply the changes to both. Switching between Pi and Codex selects the corresponding executable unless you specify `--agent-command`. Pi requires a single executable in that array; switching to the `command` adapter requires you to provide its argument array explicitly.

**Codex:** install and authenticate the CLI using the agent's own mechanisms. Foundry does not store API keys. Configure the command as a list, normally `["codex"]`, and optionally select a model. Diagnostics check the executable; authentication is confirmed when making a call.

**Command:** supports adapters for other agents. It runs without a shell, with the workspace as its current directory and this JSON object on stdin:

```json
{"schema_version":1,"prompt":"...","workspace":"...","output_schema":null}
```

It must return exactly one JSON object on stdout:

```json
{"text":"final response","usage":{"input_tokens":120,"output_tokens":80},"turns":1,"tool_calls":3,"model":"model-identifier","real_inference":true}
```

For extraction, `text` contains JSON conforming to `output_schema`. Adapter logs go to stderr. For replay, the adapter must perform the work in `workspace`. Merely describing a solution in its response is insufficient.

`turns` and `tool_calls` are optional nonnegative integer metrics. Turns are completed provider turns, not tool calls or internal reasoning steps. Omitted metrics are shown as unavailable; zeros are not invented. The Codex adapter sums usage from `turn.completed` events and counts observed tools separately.

Enable **Adaptador command con inferencia real** (Command adapter with real inference) only when that adapter actually calls the model. The gate requires both this setting and `real_inference: true` in its response. This declaration is part of the adapter contract, not independent provider attestation. Monetary costs are not invented when the adapter does not report them.

Commands are argument arrays. Shell strings, pipes and variable expansion are not interpreted automatically. If you need a workflow with multiple commands, create a versioned script and execute it.

## Verifiers

Create verifiers in a directory outside the initial project. Foundry freezes a copy and records its hashes. Use commands such as:

```json
["{python}", "{verifier}/verify.py", "{workspace}"]
```

The positive control prepares a known solution. The verifier must return 0. The negative control introduces a defect and returns 0 if preparation succeeded; the same verifier must then return a nonzero exit code. Execution problems are distinguished from functional failures.

Design real domain controls: HTTP interfaces, persistence after restart, transactions, CLI output, exported files or browser behavior. The verifier must measure the observable result and remain independent of the agent proposing the improvement.

Processes run with the local user's permissions. Separate directories and hash checks protect against accidental changes; they are not a security boundary against hostile code. External services used by a case need an explicit test environment. Nix can pin a case's tools and services when installed.

## Access and diagnostics

The server listens on loopback and API calls require `X-Foundry-Token`. Open the link from `start` or `open`; `status` reports service state without displaying the token. When the dashboard opens, the token moves from the URL fragment to `sessionStorage` and is removed from the visible address. Do not share that private link.

- If the UI does not appear, run `conversation-foundry status` and `doctor`; check the port.
- If there are no conversations, confirm the source is enabled and click **Escanear ahora** (Scan now). Inspect its error and the session's coverage.
- If extraction fails, check the provider executable, authentication, model and timeout.
- If case creation fails, review positive and negative controls. Do not disable the verifier to make it pass.
- If promotion is blocked, read the experiment's reasons and check that the evidence remains current.
- After moving a package, reconfigure source paths and any commands using absolute locations from the previous machine.

## Connect the active harness to an agent or RLM

The accepted registry is queried by domain and project. In an RLM loop, run this at the start of a task and after promotion:

```bash
conversation-foundry context --domain python-http --project /path/to/project
```

The agent adapter must incorporate the returned context into its working instructions and load relevant skills. Only capabilities from the active version are queried; pending proposals remain outside the context. When working directly in a project, you can materialize the integration with:

```bash
conversation-foundry sync --project /path/to/project --domain python-http
```

The integration skill distributed with Foundry instructs the agent to query the active context. The RLM remains responsible for calling the provider and executing tools; Foundry retains evidence, evaluates comparisons and determines the active version. The domain is an operational identifier, such as `python-http`: it must be consistent across cases, candidates and context queries.

In **Aprendizajes** (Learnings), you can adjust the domain and scope of a proposed candidate or one whose evidence is stale. This invalidates previous results; evaluate again before promotion. A general label does not replace evidence of transfer across domains.

## Long conversations and limits

Extraction processes every normalized character of the selected episode, including metadata, in chunks when it exceeds `max_input_chars`. Each observation cites its chunk and retains original indices. A second call synthesizes all observations. Checkpoints and their hashes support resuming without repeating completed chunks. If observations exceed context capacity or the budget runs out, the job fails explicitly and retains evidence; it never truncates silently. Input coverage does not guarantee semantic understanding. Partially normalized sources are ineligible for extraction until coverage is resolved. Attachments are inert references; their binary contents are neither executed nor read automatically.

## Persistent client and live work

`conversation-foundry catalog --project /path/project` presents a compact index without loading all bodies. `context --domain DOMAIN --project /path/project` resolves only accepted, current capabilities. `conversation-foundry repl` opens Python with the `foundry` client ready. Methods include `state()`, `context(domain, project)`, `call(action, **kwargs)`, `wait(job_id)`, `acall` and `await_job`. `conversation-foundry run --project /path/project --domain python-http --prompt "request"` performs a real task with active capabilities and ingests the result for review. It does not reconstruct the initial state of historical conversations: cases must be captured before work or prepared as new scenarios.

## Nix environment

`nix develop` provides Python and Git; `nix run .# -- doctor` runs the package. `flake.lock` pins nixpkgs. For verification with specific dependencies, use an argv such as `["nix", "develop", "/path/environment#", "--command", "python", "{verifier}/verify.py", "{workspace}"]`, with your own flake and a versioned lock. Positive/negative controls run with the same command. The package includes a real HTTP/SQLite example without external dependencies. Nix pins software; it does not itself reproduce external services, production data or isolation against hostile code. Define those resources in each domain's case.
