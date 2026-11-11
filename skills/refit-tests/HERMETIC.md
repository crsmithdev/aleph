# Hermetic lens

Which tests reach past their own process and temp dir? A hermetic test owns all it reads. The network is the
largest source of nondeterminism in Google's suites (Software Engineering at Google, ch. 11).

## Signals

`stats.ts smells`, lens `hermetic`:

- **Wall clock.** `Date.now()`, `new Date()`, `performance.now()`.
- **Network.** A URL to a host other than localhost or example.com, a `fetch` to one.
- **Fixed port.** `localhost:<n>`, `port: <n>`. Two runs or two tests on the same port collide.
- **Shared path.** `/tmp/<name>`, the home dir, `$HOME`: state that outlives the test and that another test or the
  user shares.
- **Environment read.** `process.env.X`: the test depends on the shell that runs it. Most hits set a var the code
  reads; the finding is a read with no set in the test, or a set with no restore.

Also read for: a real subprocess of a tool the CI box may not have; a real user config file; the system timezone or
locale.

## Proof

Name the outside thing and show that the test reads it: the line, and a run where it changes the result (another
timezone, the port taken, the var unset, the network off). A hit inside a fixture string, or a URL that the test
only parses, drops with that reason.

## Fix

Inject it: a clock, a port 0 server, `mkdtemp` under the OS temp dir, a fake fetch, an env object the test builds.
Restore each env var the test sets, in `afterEach`.

## Hold

The clock lint for the clock; a shrink-only lint test of the same shape for network, fixed ports and shared paths.

## Check

Does a new test read the clock, the network, a fixed port, a path outside its temp dir, or an env var it does not
set?
