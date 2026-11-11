# Hollow lens

Which tests pass when the code is wrong? A hollow test adds runtime and false trust, and no protection. The
`hollow` lens also takes a test-only seam: production code that exists only so a test can reach in.

## Signals

- **No assertion.** `stats.ts runtime` `noAsserts`: each test with zero assertions in the JUnit report. A test that
  checks only that no exception was thrown asserts nothing about the result.
- **Always true.** `stats.ts smells` "always-true assertion": `expect(true).toBe(true)`, `assert True`.
- **Tautology.** The expected value comes from the code under test, or from the same formula the code uses.
- **Mocks the subject.** The test replaces the unit it claims to test, and asserts on the mock.
- **Asserts the mock.** The only assertion checks that a mock was called, not what the code produced.
- **Snapshot only.** A large snapshot, updated in the same commits as the code, that no reviewer reads.
- **Weak assertion.** `toBeDefined`, `toBeTruthy`, `length > 0` where the value is known.
- **Test-only seam.** An export, a parameter, a flag or an `if (process.env.TEST)` branch that only tests use: grep
  each export for callers outside test files.

## Proof

Break the code and show that the test still passes. Change the line the test claims to cover (flip a condition,
return a constant, delete a call), run the test, and record it green. Revert the change. This is a spot check on
the candidate, not a mutation-testing run. For a test-only seam, the grep with zero production callers.

## Fix

Assert the result the user sees, or delete the test. Test through the public interface and remove the seam; where
the seam injects a dependency (a clock, a spawner), keep it and record why in `.refit.json`.

## Hold

Model: `check`.

## Check

For each new test: which change to the code makes it fail? For each new export or parameter: which production
caller uses it?
