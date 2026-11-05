# gpt-oss-20b on llama-server under systemd

`jobs/systemd/aleph-gpt-oss.service` serves gpt-oss-20b on `127.0.0.1:8012`.

## Base URL

`ANTHROPIC_BASE_URL=http://127.0.0.1:8012`. The llama-server build (llama.cpp commit 3de52ac, CUDA, in `~/.local/src/llama.cpp`) serves `POST /v1/messages` itself, so no LiteLLM unit exists.

## Setup

- The model is the Ollama blob `~/.ollama/models/blobs/sha256-8ecb5d4a...`. The unit reads it through the symlink `~/.local/share/gpt-oss-20b.gguf`. The blob stays in place.
- The blob carries a ChatML template, not the gpt-oss one. With it, the model prints raw harmony text and the `Read` tool call fails. The unit passes `--chat-template-file models/templates/openai-gpt-oss-120b.jinja` from the llama.cpp clone. With that file, `claude -p` with `--allowedTools Read` prints `# aleph`.
- Flags: `--jinja --ctx-size 32768 --n-gpu-layers 99 --n-cpu-moe 12 --reasoning-budget 0`.
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

The 9,479 MiB includes the desktop's share (about 1 GB). The value 12 was not tuned lower, so a smaller `--n-cpu-moe` may be faster.

## Stop first

The server needs about 8.5 GB beyond the desktop. Stop these before `enable --now`:

- The hand-started Ollama serve (`pkill -f 'ollama serve'`). It loads models into the GPU on demand.
- `sidetone.service` (`systemctl --user stop sidetone.service`). It holds about 6 GB when active.
