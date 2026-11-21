// Test-file paths. Callers that need a narrower set use inTestDir or isJsTestFile.
export const inTestDir = (p: string): boolean => /(^|\/)(tests?|__tests__)\//.test(p);
export const isJsTestFile = (p: string): boolean => /\.(test|spec)\.[cm]?[jt]sx?$/.test(p);
export const isTestFile = (p: string): boolean =>
  inTestDir(p) || isJsTestFile(p) || /\.(test|spec|accept)\./.test(p) || /(^|\/)test_[^/]*\.py$/.test(p) || /_test\.(go|py)$/.test(p);
/** Matches a test file the text names: by name, in a test folder, or as a Python or Go test. */
export const testFileInText = /[\w./-]+\.(test|spec)\.[a-z]+\b|(^|[\s`/])(tests?|__tests__)\/[\w./-]+|\btest_[\w-]+\.py\b|_test\.(go|py)\b/m;
/** Captures each JS or TS test file the text names by its .test or .spec name, without a leading ./ or /. */
export const jsTestFilesInText = /(?:^|[\s`(])\.?\/?([\w.@-]+(?:\/[\w.@-]+)*\.(?:test|spec)\.[jt]sx?)\b/g;
