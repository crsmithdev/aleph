# Runbook — the Phase 1 slice, as actually run

This file contains **observed output**, not a summary of it. It is the evidence
for the claims in `README.md`; if a claim is not here, treat it as unproven.

Recorded 2026-08-20 on the machine this was built on: Bun 1.3.11, Linux,
`runner = "sdk"` (the real Claude Agent SDK, model `claude-haiku-4-5-20251001`),
OTLP pointed at a local sink (`bun scripts/otlp-sink.ts 4319`) because that host
has no Docker daemon and therefore no Langfuse. Every path below is a temp
workspace.

## What this proves, and what it does not

| Claim | Proven here | How |
|---|---|---|
| daemon boots, serves the CLI, shuts down cleanly | yes | `os status`, `daemon.stopped` last in the JSONL |
| one turn → a fully caused event chain | yes | `os events` below |
| the real Agent SDK answers, and resume carries context | yes | "noted" then "36" across two turns |
| one message → one joined trace tree | yes | `os trace`, plus the sink's span dump |
| the event log's `trace_id` IS the exported trace | yes | same id in both |
| the SQLite index is rebuildable from JSONL | yes | `os events reindex` |
| the window meter moves on real usage | yes | `os meter` |
| join audit reports delta from a classified baseline | yes | `os obs join-audit` |
| Telegram end to end | **no** | no bot/group on this host — covered by `tests/integration/telegram.test.ts` against a real fake Bot API server, and by `tests/live/telegram.test.ts` which needs a real bot |
| Langfuse ingests these traces | **no** | no Docker daemon on this host — covered by `tests/live/langfuse.test.ts` |
| survives days of operation | **no** | not attempted |

## Reproducing

```bash
bun scripts/otlp-sink.ts 4319 /tmp/spans.jsonl &     # stand-in for Langfuse
export ALEPH_CONFIG=/path/to/aleph.toml              # runner = "sdk"
bun src/daemon.ts &
bun src/cli/os.ts status
```

## Transcript

```console
$ bun src/cli/os.ts doctor
ok    config           ~/ws/config/aleph.toml (e5ebf27d79bfbd60)
ok    database         ~/ws/data/aleph.db journal_mode=wal
FAIL  vault            ~/ws/vault (run: os vault init)
FAIL  socket           ~/ws/data/aleph.sock (daemon not running)
ok    otlp             http://127.0.0.1:4319/v1/traces
ok    langfuse-link    http://127.0.0.1:3010/project/cmxlocal/traces/00000000000000000000000000000000
ok    telegram-config  disabled
ok    clock            2026-08-20T23:55:37.295Z

$ bun src/daemon.ts &
aleph-next daemon up (pid 4983) — socket ~/ws/data/aleph.sock

$ os status
daemon   pid 4983  up 3s  runner=sdk  config e5ebf27d79bfbd60
windows  5h 0.0% of capacity (reserve 30.0%)  weekly 0.0%
lanes    interactive:0/0  control:0/0  librarian:0/0  heartbeat:0/0  research:0/0  synthesis:0/0  backlog:0/0
sessions 0 active   in-flight 0
events   ~/ws/data/events/2026-08-20.jsonl
otel     http://127.0.0.1:4319/v1/traces (0 export errors)

$ os send --topic phase-1-slice 'Remember: this daemon writes 36 event kinds. Reply with just: noted'
noted

$ os send --topic phase-1-slice 'How many event kinds? Reply with just the number.'
36

$ os send --topic phase-1-slice "Remember: this daemon writes 36 event kinds. Reply with just: noted"
noted

$ os send --topic phase-1-slice "How many event kinds? Reply with just the number."
36

$ os sessions
active   phase-1-slice                    turns=4    last=2026-08-20T23:56:32.447Z

$ os events --since 10m          # oldest first
2026-08-20T23:55:43.044Z  session.resumed              ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSM723SYA0Y92HHZQTZD0D <- evt_01M0GSM71YBGK0YEQ0FT0Q0P64
2026-08-20T23:55:43.045Z  routing.decided              ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSM7258P7XDFCD3DREC1K2 <- evt_01M0GSM723SYA0Y92HHZQTZD0D
2026-08-20T23:55:43.046Z  session.turn_started         ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSM72688KK1536Z1HYDP6J <- evt_01M0GSM723SYA0Y92HHZQTZD0D
2026-08-20T23:55:45.588Z  meter.usage_recorded         ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSM9HK2GG2803B95YNDA8Y <- evt_01M0GSM72688KK1536Z1HYDP6J
2026-08-20T23:55:45.589Z  vault.written                ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSM9HNSRMBV5BGMH84VBWB <- evt_01M0GSM9HK2GG2803B95YNDA8Y
2026-08-20T23:55:45.590Z  session.turn_completed       ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSM9HP567VD7TD499VGBMM <- evt_01M0GSM72688KK1536Z1HYDP6J
2026-08-20T23:55:45.591Z  channel.message_sent         ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSM9HQ6DSEFE80A1B6G43H <- evt_01M0GSM9HP567VD7TD499VGBMM
2026-08-20T23:55:45.592Z  bus.finished                 ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSM9HRNBEYPZ2C8VGRFCVS <- evt_01M0GSM721H4Q4NXPJMDCNHTB6
2026-08-20T23:56:00.748Z  vault.written                ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSMRBC8JSJ2EVQ3N7CZK0M
2026-08-20T23:56:00.839Z  vault.commit                 ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSMRE6WJNFZGX6VS48WTAC <- evt_01M0GSMRBC8JSJ2EVQ3N7CZK0M
2026-08-20T23:56:00.840Z  session.checkpointed         ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSMRE8EXTR062NTBA1FW4Y
2026-08-20T23:56:00.842Z  daemon.stopped               -                              evt_01M0GSMRE9CHP90V3W7Q9M61VP
2026-08-20T23:56:02.198Z  daemon.config_loaded         -                              evt_01M0GSMSRNQBJF5EZ44SE2V2MJ
2026-08-20T23:56:02.203Z  daemon.boot_step             -                              evt_01M0GSMSRTH0FQDBZ2BV5EXJ7Q
2026-08-20T23:56:02.208Z  daemon.boot_step             -                              evt_01M0GSMSS0GFH06H3JDFDZMMSV
2026-08-20T23:56:02.211Z  daemon.boot_step             -                              evt_01M0GSMSS3PYGT47B6WJKFXFP4
2026-08-20T23:56:02.213Z  daemon.started               -                              evt_01M0GSMSS472FE0F3Y9VHG71GA
2026-08-20T23:56:02.219Z  daemon.boot_step             -                              evt_01M0GSMSS84HG62672AVNRC66X
2026-08-20T23:56:28.033Z  channel.message_received     ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNK007KCMTMNZ8TS4XEC3
2026-08-20T23:56:28.035Z  bus.submitted                ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNK03T394PK4QWZ30JWR1 <- evt_01M0GSNK007KCMTMNZ8TS4XEC3
2026-08-20T23:56:28.039Z  bus.started                  ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNK06W8V5YMANR3AV9NCJ <- evt_01M0GSNK007KCMTMNZ8TS4XEC3
2026-08-20T23:56:28.043Z  session.resumed              ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNK0AZP1TVQTJ8QGHCQ1Q <- evt_01M0GSNK007KCMTMNZ8TS4XEC3
2026-08-20T23:56:28.044Z  routing.decided              ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNK0CRKRT67VF4D8JR1BP <- evt_01M0GSNK0AZP1TVQTJ8QGHCQ1Q
2026-08-20T23:56:28.046Z  session.turn_started         ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNK0E7RGDHBZ63M5PEZC1 <- evt_01M0GSNK0AZP1TVQTJ8QGHCQ1Q
2026-08-20T23:56:30.151Z  meter.usage_recorded         ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNN26MAHXECGA7D3J6JBN <- evt_01M0GSNK0E7RGDHBZ63M5PEZC1
2026-08-20T23:56:30.154Z  vault.written                ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNN29K2PV2TZ3CD15MSET <- evt_01M0GSNN26MAHXECGA7D3J6JBN
2026-08-20T23:56:30.155Z  session.turn_completed       ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNN2BGA604Y0RA4V3WCZB <- evt_01M0GSNK0E7RGDHBZ63M5PEZC1
2026-08-20T23:56:30.157Z  channel.message_sent         ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNN2CYS2Z9NJN3P0V0HST <- evt_01M0GSNN2BGA604Y0RA4V3WCZB
2026-08-20T23:56:30.158Z  bus.finished                 ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNN2E5Q0HNPN81PMG07QP <- evt_01M0GSNK06W8V5YMANR3AV9NCJ
2026-08-20T23:56:30.261Z  channel.message_received     ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNN5N1EVEEHME5JXYF8TM
2026-08-20T23:56:30.263Z  bus.submitted                ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNN5Q2GS48K289ENHQBA5 <- evt_01M0GSNN5N1EVEEHME5JXYF8TM
2026-08-20T23:56:30.264Z  bus.started                  ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNN5RGMBRGA736C8WCEHZ <- evt_01M0GSNN5N1EVEEHME5JXYF8TM
2026-08-20T23:56:30.265Z  session.resumed              ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNN5SPD0VXBSGJT45JTQW <- evt_01M0GSNN5N1EVEEHME5JXYF8TM
2026-08-20T23:56:30.266Z  routing.decided              ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNN5T9TTE83BC3NP7JQT3 <- evt_01M0GSNN5SPD0VXBSGJT45JTQW
2026-08-20T23:56:30.267Z  session.turn_started         ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNN5VW3XEBGPMAD9J64KZ <- evt_01M0GSNN5SPD0VXBSGJT45JTQW
2026-08-20T23:56:32.449Z  meter.usage_recorded         ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNQA1Q8FHESYC0HHV3JMG <- evt_01M0GSNN5VW3XEBGPMAD9J64KZ
2026-08-20T23:56:32.450Z  vault.written                ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNQA2XFV0PC13T3TN6WF4 <- evt_01M0GSNQA1Q8FHESYC0HHV3JMG
2026-08-20T23:56:32.451Z  session.turn_completed       ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNQA3EHS5HYB8VPS51G9X <- evt_01M0GSNN5VW3XEBGPMAD9J64KZ
2026-08-20T23:56:32.452Z  channel.message_sent         ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNQA4E1H03A424TBXBACT <- evt_01M0GSNQA3EHS5HYB8VPS51G9X
2026-08-20T23:56:32.453Z  bus.finished                 ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNQA5GXGBSSK3JB5V7P49 <- evt_01M0GSNN5RGMBRGA736C8WCEHZ

$ os trace <trace_id of the last turn>
http://127.0.0.1:3010/project/cmxlocal/traces/c48e60fda7033cd5a0a695807f78f5f7
  2026-08-20T23:56:30.261Z  channel.message_received
  2026-08-20T23:56:30.263Z  bus.submitted
  2026-08-20T23:56:30.264Z  bus.started
  2026-08-20T23:56:30.265Z  session.resumed
  2026-08-20T23:56:30.266Z  routing.decided
  2026-08-20T23:56:30.267Z  session.turn_started
  2026-08-20T23:56:32.449Z  meter.usage_recorded
  2026-08-20T23:56:32.450Z  vault.written
  2026-08-20T23:56:32.451Z  session.turn_completed
  2026-08-20T23:56:32.452Z  channel.message_sent
  2026-08-20T23:56:32.453Z  bus.finished

$ os meter
5h      0.4% of 4000000 weighted   reserve 30.0%   ok
weekly  0.0% of 40000000 weighted   reserve 25.0%   ok

$ os obs join-audit --since 10m
traces 18  orphans 14  baseline 13  delta 1
  unclassified: vault.written+vault.commit+session.checkpointed

$ os events reindex              # rebuild the SQLite index from JSONL
{
  "files": 1,
  "events": 62
}

$ os vault check
vault ok (~/ws/vault, MEMORY.md 30 lines)

$ cat vault/log/2026-08-20.md
# 2026-08-20

## 2026-08-20T23:55:42.918Z — Remember: this daemon writes 36 event kinds. Reply with just: noted (cli)

**Chris:** Remember: this daemon writes 36 event kinds. Reply with just: noted

**Aleph:** noted

## 2026-08-20T23:55:45.589Z — Remember: this daemon writes 36 event kinds. Reply with just: noted (cli)

**Chris:** How many event kinds? Reply with just the number.

**Aleph:** 36

## 2026-08-20T23:56:30.152Z — Remember: this daemon writes 36 event kinds. Reply with just: noted (cli)

**Chris:** Remember: this daemon writes 36 event kinds. Reply with just: noted

**Aleph:** noted

## 2026-08-20T23:56:32.450Z — Remember: this daemon writes 36 event kinds. Reply with just: noted (cli)

**Chris:** How many event kinds? Reply with just the number.

**Aleph:** 36

$ os obs join-audit --since 20m     # after classifying the shutdown checkpoint
traces 27  orphans 23  baseline 23  delta 0
```


## The span tree at the OTLP sink

The sink decodes OTLP/JSON and prints one line per span. For one turn:

```console
$ bun scripts/otlp-sink.ts 4318 /tmp/spans.jsonl
otlp sink listening on http://127.0.0.1:4318/v1/traces
[span] sdk.query      trace=0ecabb024e54 parent=44452004 events=0
[span] turn           trace=0ecabb024e54 parent=0ecabb02 events=5

$ # decoded attributes on the root span:
turn | trace 0ecabb024e54 | parent -
     aleph.lane = interactive
     aleph.origin = channel
     aleph.session_id = ses_01M0GRTVXQ8T9FK81YVKRDJC2A
     langfuse.session.id = ses_01M0GRTVXQ8T9FK81YVKRDJC2A
     langfuse.trace.name = turn
     langfuse.trace.tags = ['origin:channel', 'lane:interactive', 'session:ses_01M0GRTVXQ8T9FK81YVKRDJC2A']
     langfuse.user.id = chris
     event: routing.decided
     event: session.turn_started
     event: meter.usage_recorded
     event: vault.written
     event: session.turn_completed
```

Nine spans in that trace, one trace id, and the event log's `trace_id` for the
same turn is `0ecabb024e54c7465bfed79d148dedcf` — the same trace. That equality
is the join invariant, and it did not hold on the first attempt: the daemon
minted the trace id before any span existed, so OTel generated its own and the
deep link pointed at a trace that did not exist. Spans now open under a
synthetic remote parent carrying the minted id (`src/core/tracectx.ts`).

## Test suite, same session

```console
$ bun test
 67 pass
 6 skip          # tests/live, opt in with ALEPH_LIVE=1
 0 fail
 318 expect() calls

$ ALEPH_LIVE=1 bun test tests/live/sdk.test.ts
 4 pass
 0 fail
```

## Defects this exercise found

Each was found by running the system, not by reading it:

1. **Trace ids diverged** between the event log and the exported spans (above).
2. **`os send --topic X` forked a second session** instead of routing to topic X:
   the CLI's container key is the topic slug and nothing resolved it.
3. **`../escape.md` was silently sanitized** into a vault-internal path and
   written, instead of being refused. A path check that rewrites an escape into
   a successful write to a different file is worse than no check.
4. **A disabled tier fell forward exactly one step**, landing on `T0g`, which is
   also disabled in Phase 1. It now walks to the next *enabled* tier.
5. **`backlog` defaulted to enabled** for any config that omitted the section —
   "default OFF" held only in the shipped file, which is not a default.
6. **The shutdown checkpoint was an unclassified join-audit orphan.** It is
   legitimate (it runs after the bus drains), so it is now in the baseline
   rather than a permanent amber the reader learns to ignore.

---

# Langfuse ingestion — recorded 2026-08-21

The gap the section above left open ("Langfuse ingests these traces: **no**") is
now closed. Recorded on the WSL2 host, Bun 1.3.3, `docker-ce 29.7.2` running
inside the distro under systemd (Docker Desktop was not used), Langfuse
`3.225.4`, `runner = "sdk"`, `obs.otlp_endpoint` pointed at Langfuse itself
rather than at the local sink.

```console
$ sudo systemctl enable --now docker && docker run --rm hello-world | tail -3
Hello from Docker!

$ docker compose --env-file ../.env -f langfuse.yml up -d
 Container aleph-langfuse-langfuse-web-1  Started

$ curl -sS http://127.0.0.1:3010/api/public/health
{"status":"OK","version":"3.225.4"}

$ curl -sS -u "$PK:$SK" http://127.0.0.1:3010/api/public/projects
{"data":[{"id":"aleph-next-local","name":"aleph-next","organization":{"id":"aleph","name":"Aleph"},"metadata":{}}]}
```

The org, project and key pair above were created by the `LANGFUSE_INIT_*`
variables at boot — no UI step, and the project id in the deep link is known
before the first span exists.

## The live gate

```console
$ ALEPH_LIVE=1 LANGFUSE_BASE_URL=http://127.0.0.1:3010 \
  LANGFUSE_PUBLIC_KEY=$PK LANGFUSE_SECRET_KEY=$SK \
  bun test tests/live/langfuse.test.ts
 1 pass
 0 fail
 1 expect() calls
Ran 1 test across 1 file. [2.00s]
```

## A real turn, joined end to end

```console
$ os doctor | tail -4
ok    otlp             http://127.0.0.1:3010/api/public/otel/v1/traces
ok    langfuse-link    http://127.0.0.1:3010/project/aleph-next-local/traces/00000000000000000000000000000000
ok    telegram-config  disabled
ok    clock            2026-08-21T16:11:29.982Z

$ os send --topic langfuse-gate 'Reply with just: ingested-2'
ingested-2

$ os trace 98b9a71c1414ac4a8623cd12dcf5f3f5
http://127.0.0.1:3010/project/aleph-next-local/traces/98b9a71c1414ac4a8623cd12dcf5f3f5
  2026-08-21T16:12:52.014Z  channel.message_received
  2026-08-21T16:12:52.030Z  bus.submitted
  2026-08-21T16:12:52.035Z  bus.started
  2026-08-21T16:12:52.043Z  session.resumed
  2026-08-21T16:12:52.047Z  routing.decided
  2026-08-21T16:12:52.055Z  session.turn_started
  2026-08-21T16:12:54.598Z  meter.usage_recorded
  2026-08-21T16:12:54.608Z  vault.written
  2026-08-21T16:12:54.612Z  session.turn_completed
  2026-08-21T16:12:54.616Z  channel.message_sent
  2026-08-21T16:12:54.624Z  bus.finished
```

The same id, fetched back out of Langfuse rather than out of our own event log:

```console
$ curl -sS -u "$PK:$SK" http://127.0.0.1:3010/api/public/traces/98b9a71c1414ac4a8623cd12dcf5f3f5
trace id : 98b9a71c1414ac4a8623cd12dcf5f3f5
name     : turn
session  : ses_01M0JHFPBQTM2SM0JEN3TDQQ04
user     : chris
tags     : ['lane:interactive', 'origin:channel', 'session:ses_01M0JHFPBQTM2SM0JEN3TDQQ04']
obs      : 7 ['channel.message_sent', 'bus.finished', 'turn', 'channel.message_received', 'sdk.query', 'bus.started', 'bus.submitted']

$ os status | tail -2
events   ~/ws/data/events/2026-08-21.jsonl
otel     http://127.0.0.1:3010/api/public/otel/v1/traces (0 export errors)

$ os obs join-audit --since 30m
traces 18  orphans 16  baseline 16  delta 0
```

Shutdown was clean: `daemon.stopped` is the last line in the JSONL.

## Defects this exercise found

Two in `compose/langfuse.yml`, one in `.env`, all three found by running it and
none visible from reading it. They are written up in `compose/README.md`; the
one worth repeating here is the failure *shape*:

> `LANGFUSE_S3_EVENT_UPLOAD_REGION` was missing on the worker. The worker died
> on every ingestion job with `Region is missing` — and the OTLP POST kept
> returning **200**. A 200 from the collector is not evidence of ingestion. The
> only honest check is to fetch the trace back by id, which is exactly what
> `tests/live/langfuse.test.ts` does and what the local sink cannot do.

The `.env` defect has the same shape: an unquoted `LANGFUSE_OTLP_AUTH=Basic
<b64>` truncates to `Basic`, and the daemon reports it once as
`obs.export_failed{error:"Unauthorized"}` and then serves turns perfectly while
exporting nothing.

## Still not verified

- The real Telegram bot and group (`tests/live/telegram.test.ts`).
- `compose/daemon.yml` — the daemon has still only been run directly.
- Operation over days.

---

# Telegram, against the real bot and group — recorded 2026-08-21

`tests/live/telegram.test.ts` had never run: it needs a real bot and a real
forum group, and the build host had neither. Both now exist (a scratch group,
per the warning in that file's header). Bot `@aleph_cs_bot`, chat
`-1004445805540` (`is_forum: true`), owner `6973977956`.

```console
$ ALEPH_LIVE=1 bun test tests/live/telegram.test.ts
 2 pass
 0 fail
 2 expect() calls
Ran 2 tests across 1 file. [10.77s]
```

That creates a forum topic in the real group, posts into it, and closes it.

## A message sent from a phone, end to end

`os doctor` reports `telegram-config enabled`; the daemon polls; the message was
typed into the group's General topic on a phone with no terminal involved.

```console
$ os events --since 5m        # oldest first, trimmed to the payloads that matter
17:54:12.305Z  session.topic_inferred
   {"decision":"new","title":"So what can I do from here?","alternatives":["langfuse-gate"],
    "rule":"default-to-new (no explicit target)"}
17:54:12.314Z  channel.message_received
   {"channel":"telegram","text":"So what can I do from here?",
    "external":{"chat_id":"-1004445805540","message_id":"6","from":"6973977956"}}
17:54:12.784Z  channel.topic_created   {"channel":"telegram","external_id":"7","title":"So what can I do from here?"}
17:54:12.792Z  routing.decided         {"class":"conversation","tier":"T2","model":"claude-sonnet-5"}
17:54:20.975Z  meter.usage_recorded    {"lane":"interactive","weighted":26240.75,"cost_usd":0.1236,"source":"sdk"}
17:54:20.984Z  vault.written           {"path":"log/2026-08-21.md","bytes":1454,"mode":"append"}
17:54:20.988Z  session.turn_completed  {"ms":8182,"reply_chars":1054}
17:54:21.469Z  channel.message_sent    {"channel":"telegram","external_id":"8","parts":1}

$ curl -sS -u "$PK:$SK" .../api/public/traces/0206c98537b37f594b7264c0608ad1f0
trace  : 0206c98537b37f594b7264c0608ad1f0
name   : turn
session: ses_01M0JQAZP1MN66EMBWDAPRF1ZJ
tags   : ['lane:interactive', 'origin:channel', 'session:ses_01M0JQAZP1MN66EMBWDAPRF1ZJ']
obs    : ['bus.finished', 'channel.message_sent', 'turn', 'sdk.query', 'channel.topic_created',
          'bus.started', 'bus.submitted', 'channel.message_received', 'session.topic_inferred',
          'session.created']

$ os sessions
active   so-what-can-i-do-from-here       turns=1    last=2026-08-21T17:54:20.967Z
active   langfuse-gate                    turns=2    last=2026-08-21T16:12:54.578Z
```

Note the behaviour, which is §8.4 working as designed and still surprising the
first time: a message in **General** with no explicit target infers a *new*
topic, so the daemon created forum topic `7` and replied there rather than in
General.

## The authorization check, observed rather than asserted

The live test's own post — sent by the bot — came back through the poll loop and
was refused:

```json
{"kind":"channel.message_received","payload":{"channel":"telegram","text":"",
 "external":{"chat_id":"-1004445805540","thread_id":"3","message_id":"5","from":"8643553633"},
 "rejected":"unauthorized"}}
```

`8643553633` is the bot's own id, not the owner's. Nothing was submitted to the
bus. This is the first time that path has fired against real traffic.

## The defect it exposed

A refused message emits `channel.message_received` and then stops, so its
`trace_id` never grows a `bus.started` — an orphan. The join audit called it out:

```console
$ os obs join-audit --since 10m
traces 9  orphans 8  baseline 7  delta 1
  unclassified: channel.message_received
```

The wrong fix is to add `channel.message_received` to the baseline's
`expected_kinds`: that would also classify an *accepted* message that never
reached the bus, which is a genuine failure and the exact thing this audit
exists to catch. The audit now classifies on the payload instead — an orphan
trace is expected if every event in it is a baseline kind **or** an inbound
carrying `rejected` — and both halves are pinned by unit tests
(`tests/unit/join-audit.test.ts`).

```console
$ os obs join-audit --since 60m     # same events, daemon restarted with the fix
traces 21  orphans 20  baseline 20  delta 0
```

---

# The daemon in a container — recorded 2026-08-21

`compose/daemon.yml` had never been brought up. It is now, with `runner = "echo"`
(the SDK runner needs a credential inside the container — see the gap at the end).
Five things were wrong, every one of them silent or fatal only at runtime.

```console
$ docker compose -f daemon.yml build          # there was no Dockerfile; there is now
 aleph-daemon  Built

$ ALEPH_UID=$(id -u) ALEPH_GID=$(id -g) ALEPH_VAULT=~/ws/vault ALEPH_RUNNER=echo \
  docker compose --env-file ../.env -f daemon.yml up -d
 Container aleph-daemon-1  Started

$ docker compose -f daemon.yml exec daemon bun src/cli/os.ts doctor
ok    config           /app/config/aleph.toml (3817c688bbe97252)
ok    database         /app/data/aleph.db journal_mode=wal
ok    vault            /vault
ok    vault-git        history on
ok    socket           /app/data/aleph.sock
ok    otlp             http://langfuse-web:3000/api/public/otel/v1/traces
ok    langfuse-link    http://127.0.0.1:3010/project/aleph-next-local/traces/000…
ok    telegram-config  disabled
ok    clock            2026-08-21T19:48:17.601Z

$ docker compose -f daemon.yml exec daemon bun src/cli/os.ts send --topic container-final 'final container turn'
echo[0 prior turns, seed=none]: final container turn

$ curl -sS -u "$PK:$SK" .../api/public/traces/18965b5b8f654ce483fd4693670d0f47
name: turn | session: ses_01M0JXWRBGZ5YQT5HZTM185GD8
obs : ['bus.finished', 'channel.message_received', 'bus.started', 'sdk.query',
       'session.topic_inferred', 'channel.message_sent', 'session.created', 'turn', 'bus.submitted']

$ docker compose -f daemon.yml exec daemon bun src/cli/os.ts status | tail -1
otel     http://langfuse-web:3000/api/public/otel/v1/traces (0 export errors)
```

## The mount plan, enforced rather than asserted

Design §10.3 says enforcement lives at the mount. Probed from inside the
container, as the daemon's own uid:

```console
$ touch /vault/human/probe
touch: cannot touch '/vault/human/probe': Read-only file system
$ echo x >> /vault/VAULT.md
sh: 1: cannot create /vault/VAULT.md: Read-only file system
$ touch /vault/wiki/probe && git -C /vault status --porcelain
?? log/2026-08-21.md
?? wiki/probe
```

`docker compose stop` (SIGTERM, `stop_grace_period: 150s`) wrote
`daemon.stopped` at 19:49:05 — the container shuts down as cleanly as the host
process does.

## Defects, in the order they surfaced

1. **There was no Dockerfile at all.** `build: ..` had never been exercised.
2. **`SQLITE_CANTOPEN` on first boot.** A named volume inherits the ownership of
   the image path it covers; `/app/data` did not exist in the image, so Docker
   created it root-owned and the deliberately-non-root daemon could not open the
   database.
3. **`ALEPH_RUNNER=echo` was silently ignored.** `envOverrides()` skipped every
   single-segment key (`if (path.length < 2) continue`), so top-level config keys
   could not be overridden and the container ran the SDK while claiming to be
   told otherwise. Now only the harness variables (`ALEPH_CONFIG`,
   `ALEPH_GIT_SHA`, `ALEPH_LIVE`, `ALEPH_VAULT`) are exempt.
4. **`EACCES` on every vault write.** The container ran as uid 1000; the
   bind-mounted vault is owned by the host user. `user:` is now
   `${ALEPH_UID:-1000}:${ALEPH_GID:-1000}`.
5. **The vault silently kept no history.** Mounting only the rw *subdirectories*
   leaves `/vault` itself an implicit root-owned directory, and git refuses to
   work in a worktree it does not own — `fatal: detected dubious ownership`.
   `commit()` returns null on failure and the writer simply emits no
   `vault.commit`, so nothing said so. The vault root is now mounted rw with
   `human/` and `VAULT.md` re-mounted ro on top, and **`os doctor` gained a
   `vault-git` check** so the next occurrence is loud.

Two smaller ones: `host.docker.internal` cannot reach a loopback-bound Langfuse
(the daemon joins the Langfuse compose network and addresses `langfuse-web:3000`
instead), and the committed config carries no ingestion key or project id — both
now come from the supervisor as `ALEPH_OBS__*` env.

## Still not verified

- **The SDK runner inside the container.** It needs `CLAUDE_CODE_OAUTH_TOKEN`
  (from `claude setup-token`) or `ANTHROPIC_API_KEY` in the container
  environment; the variable is wired through `compose/daemon.yml` and has never
  been set. Everything here ran on `runner = "echo"`.
- Telegram from the container: the committed config disables it, so the
  container has only the CLI channel. The host process is what exercised
  Telegram.
- Operation over days.

---

# The soak — started 2026-08-21T20:05Z

The only Phase 1 claim that cannot be earned in an afternoon is "survives days of
operation", and §16.3's rehydration test needs a topic that is genuinely a week
old. Both clocks now run. The daemon is a systemd user unit on `Lightbox2`
(`runner = "sdk"`, Telegram enabled), state under
`~/.local/share/aleph-next/{data,vault}`, carried over from the workspace used
earlier today so the Telegram topic **"So what can I do from here?"** (created
2026-08-21T17:54Z) is the subject for the week-old test.

```console
$ systemctl --user status aleph-next
     Active: active (running) since Fri 2026-08-21 13:05:45 PDT
   Main PID: 65501 (bun)

$ os status
daemon   pid 65501  up 5s  runner=sdk  config 71d0f77b0f10a3f5
sessions 2 active   in-flight 0
otel     http://127.0.0.1:3010/api/public/otel/v1/traces (0 export errors)
```

## Resume across a supervisor restart

The turn before the restart established a fact; the turn after it recalled the
fact, in a new process:

```console
$ os send --topic soak 'Reply with just: soak-start'
soak-start

$ systemctl --user restart aleph-next

$ os send --topic soak 'What did I ask you to reply with a moment ago? Answer in three words or fewer.'
"soak-start"
```

`daemon.stopped` at 20:06:11.499Z, `daemon.started` at 20:06:11.881Z — systemd's
SIGTERM path drains the bus and checkpoints exactly as a manual kill does.
`TimeoutStopSec=180` is deliberately above `shutdown_grace_seconds = 120`; the
other way round, systemd SIGKILLs a daemon that is still draining.

## Proving the poll loop is alive, given a bot cannot hear itself

Telegram never delivers a bot its own messages, so posting as the bot proves
nothing — the probe message did not appear in the event log, and should not
have. What does prove it is asking Telegram for updates from a second client:

```console
$ curl "https://api.telegram.org/bot$TOKEN/getUpdates?timeout=5"
{"ok":false,"error_code":409,"description":"Conflict: terminated by other getUpdates request; make sure that only one bot instance is running"}

$ sqlite3 ~/.local/share/aleph-next/data/aleph.db 'select * from kv where key="telegram.offset"'
telegram.offset|223721430
```

The 409 is the daemon holding the long poll, and the persisted offset is what
makes a restart re-deliver rather than drop.

(The one earlier inbound attributed to the bot's own id was the forum
*topic-created service message*, not a message the bot sent — which is why its
`text` was empty.)

## What this does not yet prove

Nothing about days: it has run for minutes. Revisit on **2026-08-28** for the
week-old rehydration judgement, which is Chris's to make, not the daemon's.

---

# The SDK runner inside the container — recorded 2026-08-22

The last open item. `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) now
lives in `.env`, and the container runs `runner = "sdk"` against the real Agent
SDK. Two more defects fell out, both of which only a *second* turn could expose.

```console
$ ALEPH_UID=$(id -u) ALEPH_GID=$(id -g) ALEPH_VAULT=~/.local/share/aleph-next/vault-container \
  docker compose --env-file ../.env -f daemon.yml up -d --build
 Container aleph-daemon-1  Started

$ docker compose -f daemon.yml exec daemon bun src/cli/os.ts status | head -1
daemon   pid 1  up 0s  runner=sdk  config 3b895ab8758fd2b4

$ docker compose -f daemon.yml exec daemon bun src/cli/os.ts send --topic sdk-in-container 'Reply with exactly: container-sdk-ok'
container-sdk-ok

$ docker compose -f daemon.yml exec daemon bun src/cli/os.ts send --topic sdk-resume 'Remember the number 41. Reply with just: noted'
noted
$ docker compose -f daemon.yml exec daemon bun src/cli/os.ts send --topic sdk-resume 'What number? Reply with just the number.'
41
```

The trace, fetched back out of Langfuse rather than out of our own log:

```console
name: turn | session: ses_01M0KGAD4Y4SFASPM9999Z59TD | user: chris
obs : ['turn', 'channel.message_sent', 'sdk.query', 'bus.finished', 'bus.started',
       'bus.submitted', 'channel.message_received']
otel  http://langfuse-web:3000/api/public/otel/v1/traces (0 export errors)
```

## Defect 1 — the first turn worked and every resume failed

```json
{"kind":"session.turn_failed","payload":{"error":"Error: sdk result error_during_execution: no detail"}}
```

The container runs as the host user's uid so it can write the bind-mounted
vault, and that uid has no `/etc/passwd` entry — so `HOME` was `/`, which is not
writable:

```console
$ docker compose exec daemon sh -c 'echo HOME=$HOME; touch $HOME/.probe'
HOME=/
touch: cannot touch '//.probe': Permission denied
```

The Agent SDK keeps its session transcript under `$HOME/.claude`. With nowhere
to write it, a fresh turn still answers — nothing to resume — and every resume
after it dies. `HOME` is now `/app/data/home`, inside the data volume so
transcripts outlive `--force-recreate`, and an entrypoint creates it whatever
state that volume is in.

## Defect 2 — a failed turn hung the CLI for ten minutes

Watching defect 1 happen exposed a worse one. `os send` blocks on a reply that
only ever arrives through the channel; `handleTurn` threw before `reply()`, so
nothing resolved the pending promise and the CLI sat on its 600 s timeout with
an empty stdout. The event log had already recorded `session.turn_failed` and
`bus.finished ok:false` 1.4 seconds in — the daemon knew, and said nothing to
the person waiting.

A failed turn now answers with `turn failed: <error>` and still rethrows, so the
bus continues to record the failure. `tests/integration/daemon.test.ts` pins it
by chmod-ing the vault log directory read-only mid-run — the same EACCES that
started this — and asserting the reply arrives in under 30 s. Without the fix
that test times out at 60 s; the failure is the point of the test.

## Phase 1 is now verified end to end

Everything in `README.md`'s verified list has been observed, on the host and in
the container. What remains is time: the soak (started 2026-08-21T20:05Z) and
the week-old rehydration judgement due 2026-08-28, which is Chris's call.
