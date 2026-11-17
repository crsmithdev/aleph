# Test rules

The rules a test must meet, numbered so that a check and a refit can cite them. A tag names the
[refit-tests](../refit-tests/SKILL.md) lens that finds a break.

## Each test

1. **Name the break.** Before you write a test, name the code change that would make it fail. If you cannot name
   one, the test checks nothing. (hollow)
2. **Red for the right reason.** Run a new test before the fix, and see it fail for the reason you expect: not a
   typo, an import error or a missing fixture. (hollow)
3. **Count the tests.** A run in which no test ran proves nothing. Check the count in the output. (gates)
4. **An independent expected value.** The expected value comes from a known-good literal, a worked example or the
   spec, never from the formula the code uses (`expect(add(a, b)).toBe(a + b)`). (hollow)
5. **Assert the result.** Assert on what the code returns or leaves behind, not on which calls it made. Prefer
   the real code, then a fake, then a stub, then a mock. (hollow)
6. **Through the interface.** Mock no internal collaborator, test no private method, and verify through no side
   channel, such as a query of the database in place of the interface. The tell: the test breaks on a refactor
   that keeps the behaviour. (hollow)
7. **One slice at a time.** Write one test, then its implementation, then the next. Tests written in bulk test
   the shape of imagined behaviour. (growth)
8. **One behaviour per test.** A test checks one behaviour, and its name says which. (smells)

## New things

Ask these of each new test, helper, fixture, mock, skip, wait, timeout, port, temp path and env read.

9. **It gates.** A new skip, `todo`, `only`, retry or test file names its reason, and the command that runs it on
   the way to the default branch. (gates)
10. **No shared state.** A new test that waits, reads the clock, shares a file, port or env var with another test,
    or starts a process names the event it waits for and the state it owns. (flake)
11. **Hermetic.** A new test reads no clock, network, fixed port, path outside its temp dir, or env var it does not
    set. (hermetic)
12. **No smells.** A new test does not sleep, poll, focus, print or use unseeded random data. (smells)
13. **Each behaviour tested.** A new behaviour has a test, and a bug fix has a test that fails before the fix.
    (gaps)
14. **A known cost.** A new test that starts a process, a browser or a server, builds the project, or waits
    names its expected time. (runtime)
15. **Not twice.** A new test asserts nothing an existing test asserts. Name the existing test, or extend it.
    (merge)
16. **Lines the behaviour needs.** A new test adds no more lines than its behaviour needs. (growth)
17. **No test-only seam.** Each new export or parameter has a production caller. (hollow)
