// Test-file paths. Callers that need a narrower set use inTestDir or isJsTestFile.
export const inTestDir = (p: string): boolean => /(^|\/)(tests?|__tests__)\//.test(p);
export const isJsTestFile = (p: string): boolean => /\.(test|spec)\.[cm]?[jt]sx?$/.test(p);
export const isTestFile = (p: string): boolean =>
  inTestDir(p) || isJsTestFile(p) || /\.(test|spec|accept)\./.test(p) || /(^|\/)test_[^/]*\.py$/.test(p) || /_test\.(go|py)$/.test(p);
