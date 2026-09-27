# Polish

Procedures for pass 3 of [tidy](SKILL.md). The gate table in SKILL.md says what passes; this says how to find out.

## Cold clone

The only gate that tests what a stranger actually meets. The working tree lies: it holds a built `node_modules`, a warm cache, an `.env` nobody committed, and a global tool you installed months ago.

```sh
d=$(mktemp -d) && git clone --depth 1 "file://$PWD" "$d/repo" && cd "$d/repo"
```

The `file://` prefix is load-bearing: given a plain path, git hardlinks the object store and prints `--depth is ignored in local clones`, so you get the whole history and a clone that shares objects with the original.

Then follow the README's quickstart **verbatim**, in order, pasting each command as written. Three rules make this a real test:

- **Do not fix as you go.** A command that fails is the finding. Note it, run the next one, and keep going to the end.
- **Do not supply what the README omits.** A missing env var, an unstated runtime version, an undocumented install step: each one is a gate failure, and each one is what a stranger hits.
- **Reach the promised result.** "It installed" is not passing. If the README says a server starts on a port, curl the port.

Clean up the temp dir when done.

## Secrets in history

`HEAD` is not the repo. Every clone carries every commit, so a key deleted last month is still one `git log -p` away.

Use a tool if one is installed or runs from a throwaway cache — `gitleaks detect`, or `trufflehog git file://.` — because both know entropy and provider formats. The fallback, noisier and worth running anyway:

```sh
git log -p --all | grep -nE '(-----BEGIN [A-Z ]*PRIVATE KEY|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-)'
git log --all --diff-filter=A --name-only --format='%h' | grep -E '\.(env|pem|key|p12|keystore)$|credentials|id_rsa'
```

Two false-positive classes cover most hits. A test for a secret scanner plants secrets on purpose, so a repo that scans for credentials will match its own fixtures. And a docs example shows the shape of a key without being one. Read the surrounding line before reporting; a fixture reported as a leak spends the user's attention and teaches them to skip the gate.

Name the commit for anything real. Do not rewrite history, and do not stop at the history question: a committed credential is compromised the moment it is pushed, so it needs rotating whether or not the history changes. Say that in the report.

## Required files, by kind

Presence is the check; content is a judgment. A `CONTRIBUTING.md` that says "contributions welcome" passes presence and fails the read.

| Kind | Needs | Also, if it is going public |
|---|---|---|
| Any repo | `README`, `LICENSE` | `SECURITY.md` |
| Library or package | Install line, API entry point documented, changelog | `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` |
| Application or service | Run instructions, configuration and its defaults documented | Deployment notes |
| CLI | `--help` that matches the README | Install per platform |

A repo that stays private needs the first column and nothing else. Do not add a code of conduct to a one-person private repo; that is checklist theatre, and it is the failure mode of every open-source-readiness tool.

## What this pass deliberately omits

A readiness score. Scoring averages a leaked credential against a thin README and reports a number that is neither. Every gate is pass or fail, and a failed gate is named.
