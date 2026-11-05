# gpt-oss-20b on llama-server under systemd

`jobs/systemd/aleph-gpt-oss.service` serves gpt-oss-20b on `127.0.0.1:8012`.

## Base URL

`ANTHROPIC_BASE_URL=http://127.0.0.1:8012`. The llama-server build (llama.cpp commit 3de52ac, CUDA, in `~/.local/src/llama.cpp`) serves `POST /v1/messages` itself, so no LiteLLM unit exists.

## Setup

- The model is the Ollama blob `~/.ollama/models/blobs/sha256-8ecb5d4a...`. The unit reads it through the symlink `~/.local/share/gpt-oss-20b.gguf`. The blob stays in place.
- The blob carries a ChatML template, not the gpt-oss one. With it, the model prints raw harmony text and the `Read` tool call fails. The unit passes `--chat-template-file models/templates/openai-gpt-oss-120b.jinja` from the llama.cpp clone. With that file, `claude -p` with `--allowedTools Read` prints `# aleph`.
- Flags: `--jinja --ctx-size 40960 --n-gpu-layers 99 --n-cpu-moe N --reasoning-budget 0`. The unit picks N at each start, as described under "Choice at start".
- The Anthropic API treats a request without `thinking` as thinking off. llama-server defaults to an unlimited reasoning budget, so a `max_tokens: 16` request spent all 16 tokens on reasoning and returned only a `thinking` block. `--reasoning-budget 0` makes the default match the API: such a request returns a `text` block. A request with `thinking.budget_tokens` gets that budget and returns a `thinking` block and a `text` block.
- `claude -p --allowedTools Read "<prompt>"` reads the prompt as a second tool name and exits with `Input must be provided`. Put the prompt before the flag, or write `--allowedTools=Read`.

## Measured

| Item | Value |
|---|---|
| `--n-cpu-moe` | 12 (of 24 layers) |
| VRAM used (whole GPU, idle after load) | 9,479 MiB of 12,227 MiB |
| VRAM used after a 12,000-token prompt | 9,482 MiB |
| Prompt processing | about 1,150 tokens/s (2,897 and 8,412 token Claude Code prompts) |
| Generation | about 36 tokens/s |

The 9,479 MiB includes the desktop's share (about 1 GB). The table above is the value-12 baseline from before the tune; the tune below replaces its speed figures.

## Tuned `--n-cpu-moe`

Goal: the smallest value that leaves at least 1,536 MiB of the 12,227 MiB card free (used at most 10,691 MiB), whole-card `nvidia-smi` figure, with the desktop at its idle use.

Method: with the unit stopped, `nvidia-smi` shows the idle desktop use. Then start llama-server with the unit's flags at each value, read `nvidia-smi` after load, and send three `/completion` requests of 12,390 prompt tokens (`cache_prompt` off, `n_predict` 256, `ignore_eos` on, so each run generates 256 tokens). Read `nvidia-smi` after each request. Speeds come from the server's `timings`.

The desktop's idle use was 1,619 to 1,625 MiB during these runs. An earlier run of this tune saw about 1,086 MiB and chose 9. At 1,625 MiB, 9 would use about 11,200 MiB (estimate from the 400 MiB step, not measured), so the chosen value depends on the desktop's idle use. That run's requests also stopped after 3 generated tokens, so its generation speeds are not used here.

| `--n-cpu-moe` | MiB used after load | MiB used after 12,390-token prompt | MiB free after prompt | Result |
|---|---|---|---|---|
| 12 | 10,018 | 10,118 | 2,109 | pass |
| 11 | 10,422 | 10,516 | 1,711 | **chosen** |
| 10 | 10,820 | 10,920 | 1,307 | fail: below 1,536 MiB free |

Each value moved to the card costs about 400 MiB. After `systemctl --user restart` of the unit at 11, `nvidia-smi` shows 10,416 MiB after load and 10,516 MiB after a 12,390-token prompt.

Speed, tokens per second, one entry per run:

| `--n-cpu-moe` | Prompt processing | Generation |
|---|---|---|
| 12 | 1,408, 1,455, 1,163 (median 1,408) | 37.1, 29.6, 37.9 (median 37.1) |
| 11 | 1,233, 1,556, 1,296, 1,492 (median 1,394) | 41.1, 21.9, 39.5, 40.4 (median 40.0) |
| 10 | 1,579, 1,711, 1,551 (median 1,579) | 42.3, 43.0, 43.7 (median 43.0) |

The fourth run at 11 is the one through the restarted unit. Value 10 is the lower value tried and failed the margin. Speeds vary by up to 2x between identical runs, so the gain from 12 to 11 (about 8 percent in generation) is within the noise of three runs.

## Choice at start

The unit runs `jobs/lib/gpt-oss-start.ts`, which reads the free VRAM with `nvidia-smi --query-gpu=memory.free` and runs llama-server with the smallest `--n-cpu-moe` from 0 to 24 that fits. The GPU share of llama-server is modelled as 3,750 MiB plus 400 MiB per layer on the GPU (fitted to the table above), and the start keeps 1,536 MiB free after the load. So N = 24 - floor((free - 1,536 - 3,750) / 400), limited to 0..24. A larger free amount never gives a larger N. At 10,600 MiB free the value is 11. When the `nvidia-smi` read fails or is unparsable, N is 12. The other flags are as listed under Setup.

## Stop first

The server needs about 8.5 GB beyond the desktop. Stop these before `enable --now`:

- The hand-started Ollama serve (`pkill -f 'ollama serve'`). It loads models into the GPU on demand.
- `sidetone.service` (`systemctl --user stop sidetone.service`). It holds about 6 GB when active.

## Context size 40960

Goal: a local run compacts before it passes the context size of llama-server.

Claude Code compacts at window - min(max output, 20,000) - 13,000. With `--ctx-size 32768` no output cap gives a threshold of 20,000 tokens or more, so `--ctx-size` rose to 40960.

Settings:

- `--ctx-size 40960` in `serverArgs()` of `jobs/lib/gpt-oss-start.ts`.
- `LOCAL_ENV` in `jobs/lib/models.ts`: `CLAUDE_CODE_AUTO_COMPACT_WINDOW=40960`, `CLAUDE_CODE_MAX_OUTPUT_TOKENS=4096`. The compact threshold is 40,960 - 4,096 - 13,000 = 23,864 tokens.

VRAM (whole card, desktop idle at 1,634 MiB), with `--n-cpu-moe 24` (every expert layer on the CPU):

| Point | MiB used |
|---|---|
| After load | 5,375 |
| After a 16,501-token prompt | 5,470 |

The server's share after load is 3,741 MiB, so `BASE_MIB` is 3,750 (was 3,600). With the unit's own choice (`--n-cpu-moe 12`, 10,315 MiB free at start), `nvidia-smi` showed 10,417 MiB used during the run below. A prompt near 40,960 tokens was not measured.

Real run, from a server started by `bun jobs/lib/gpt-oss-start.ts` in the worktree:

```
env -u CLAUDECODE bun -e 'import { LOCAL_ENV } from "./jobs/lib/models.ts"; const p = Bun.spawnSync(["claude", "-p", "Read jobs/lib/unit.ts, jobs/lib/models.ts, jobs/lib/title.ts, hooks/lib/judge.ts and hooks/lib/context.ts in full, then summarize each file in two sentences", "--model", "gpt-oss-20b", "--output-format", "json", "--allowedTools=Read"], { env: { ...process.env, ...LOCAL_ENV } }); console.log(p.exitCode, p.stdout.toString(), p.stderr.toString())'
```

- Token totals: 21,897 input, 140,768 cache read, 4,730 output (167,395 in all), 7 turns, 2 m 46 s.
- Compacted: yes, once (one `compact_boundary` in the session transcript). The server's largest slot was 29,381 tokens.
- Result: exit code 0, `is_error` false, `terminal_reason` completed, a summary of all five files, and no "exceed" or context-length error in the server log.
