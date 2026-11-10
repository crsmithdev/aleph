# Polish

Runs after [SWEEP.md](SWEEP.md). The question is not "is this good code" but "does a stranger get anywhere with
it in ten minutes". Run a `retro` first when there is time: dead code and slop are things a visitor sees too.

## Gate

Each row passes or fails. Nothing here is scored: a number averages a leaked credential against a thin README,
and the two are not commensurable.

| Gate | How it passes |
|---|---|
| **Cold clone** | Clone to a temp dir, follow the README's quickstart verbatim, and reach the result it promises. |
| **Secrets in history** | No credential in `git log -p`, not merely none in `HEAD` |
| **Personal artifacts** | No absolute path carrying a username, no machine-local config, no `.env`, no editor or agent directory the repo does not mean to ship |
| **License** | A `LICENSE` file exists, the manifest's license field agrees with it, and no vendored file carries an incompatible one |
| **Required files** | The ones this repo's kind implies are present and say something. |
| **CI** | Green on the current commit, and running the same commands the README tells a human to run |

## Act, or stop

Fix what a check settles: add the missing `LICENSE`, correct the quickstart command that fails, delete the
`.env`, point CI at the real test command. Flag what needs judgment, and leave it: whether the README leads with
what the project does, whether the file tree reads to someone who has never seen it, whether an error message
tells the reader what to do next.

**One gate never auto-fixes. A secret in history is a stop.** Report it, name the commits, and leave the
decision to the user: rewriting history breaks every clone and fork, and the credential has to be rotated
whether or not the history changes. Removing it from `HEAD` and calling the gate passed is worse than failing
it, because it reads as fixed.

Report in the terminal: each gate row pass or fail, the cold clone's actual outcome, and every judgment call
left open.

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

Two false-positive classes cover most hits. A test for a secret scanner plants secrets on purpose, so a repo that scans for credentials will match its own fixtures. And a docs example shows the shape of a key without being one. Read the surrounding line before reporting; a fixture reported as a leak spends the user's time and teaches them to skip the gate.

Name the commit for anything real, then follow the stop rule in "Act, or stop" above.

## Required files, by kind

Presence is the check; content is a judgment. A `CONTRIBUTING.md` that says "contributions welcome" passes presence and fails the read.

| Kind | Needs | Also, if it is going public |
|---|---|---|
| Any repo | `README`, `LICENSE` | `SECURITY.md` |
| Library or package | Install line, API entry point documented, changelog | `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` |
| Application or service | Run instructions, configuration and its defaults documented | Deployment notes |
| CLI | `--help` that matches the README | Install per platform |

A repo that stays private needs the first column and nothing else. Do not add a code of conduct to a one-person private repo; that is checklist theatre, and it is the failure mode of every open-source-readiness tool.
