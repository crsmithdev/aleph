# Security Rules

Authoritative rules for security findings — exploitable vulnerabilities, not code quality. Read by:

- `src/skills/security-review/SKILL.md` — single combined flow: scan, present, per-finding approval, fix, gate
- CLAUDE.md (project-local + global) — applies these rules silently at write-time

Every rule is **checkable**: it can be evaluated against a real diff and produce a plain-markdown finding citing this file's section anchor. Categories and exclusions are lifted from Anthropic's `claude-code-security-review`; concrete rules cross-reference OWASP Top 10:2025, CWE Top 25, and ASVS 5.0.

Scope: all source under `src/` plus repo-root `*.ts`. Security findings are not scoped to a single domain — they cut across `code`, `design` (XSS in JSX), `hooks` (command injection), and `config` (secrets in settings).

---

## A. Injection

*Sources: OWASP A03:2025, CWE-89/77/78/91, ASVS V5.*

### A.1 No raw string interpolation into SQL

SQL queries must use parameterized queries / prepared statements. Concatenating user-controlled values into a SQL string is forbidden.

- **Detect:** template literals or `+` concatenation building SQL strings that include a non-literal variable (`` `SELECT * FROM users WHERE id = ${userId}` ``); `db.query` / `db.exec` / `db.run` calls whose first argument contains `${`
- **Severity:** `blocking`
- **Tag:** `injection`

### A.2 No raw string interpolation into shell commands

`Bun.spawn` / `child_process.exec` / `child_process.spawn` arguments built from user input must be passed as separate array elements, not concatenated into a single shell string.

- **Detect:** `exec(` / `execSync(` / `spawn(` calls with a template-literal or concatenated first argument containing `${` or `+`
- **Severity:** `blocking`
- **Tag:** `injection`

### A.3 XML / XPath parsers disable external entities

XML parsers must explicitly disable external entity resolution to prevent XXE. Default XML parser settings are often vulnerable.

- **Detect:** `new DOMParser` / `xml2js` / `fast-xml-parser` / `libxmljs` without `noent: false` or `resolveExternals: false` option
- **Severity:** `important`
- **Tag:** `injection`

### A.4 No raw query construction for NoSQL operators

MongoDB / Firestore / similar query objects built from request JSON must reject `$`-prefixed keys before constructing the query (NoSQL injection via operator override).

- **Detect:** `Mongo.collection.find` / `Firestore.where` calls passing `req.body` / `req.query` / `req.params` directly without key sanitization
- **Severity:** `blocking`
- **Tag:** `injection`

---

## B. Authentication & authorization

*Sources: OWASP A01:2025 (Broken Access Control), A07:2025 (Identification & Auth), CWE-285/287/639, ASVS V3/V4.*

### B.1 No client-side-only authorization checks

Authorization checks must run on the server / API handler, not (only) in the client. Hiding a UI element is not the same as denying the action.

- **Detect:** API routes (`src/api/`, `src/research/src/api/`) that read `req.body.userId` / `req.body.role` for authorization without re-deriving the caller's identity from a server-side session or token
- **Severity:** `blocking`
- **Tag:** `auth`

### B.2 Resource lookups verify ownership

Direct object references (IDs in URLs / bodies) must be checked against the authenticated caller before returning the resource. Sequential / guessable IDs without ownership checks → IDOR.

- **Detect:** route handlers that fetch a resource by `req.params.<id>` and return it without a `where: { ownerId: session.userId }` (or equivalent) clause
- **Severity:** `blocking`
- **Tag:** `auth`

### B.3 Session tokens use HttpOnly + Secure + SameSite

Cookies carrying session identifiers or auth tokens must set `httpOnly: true`, `secure: true`, and `sameSite: 'strict'` or `'lax'`.

- **Detect:** `res.cookie(` / `Set-Cookie` headers carrying a session/auth identifier without all three flags
- **Severity:** `important`
- **Tag:** `auth`

### B.4 No hardcoded passwords / bypass logic

Authentication code must not contain hardcoded credentials, magic bypass tokens, "debug mode" flags, or backdoor checks (`if (password === 'admin')`).

- **Detect:** equality comparisons against string literals in auth handlers; `process.env.NODE_ENV === 'development'` branches that skip auth
- **Severity:** `blocking`
- **Tag:** `auth`

---

## C. Data exposure

*Sources: OWASP A02:2025 (Cryptographic Failures) and A09:2025 (Logging), CWE-200/532/798, ASVS V8/V9.*

### C.1 No hardcoded secrets

API keys, passwords, private keys, OAuth client secrets, JWT signing keys, database passwords — none appear as string literals in source. Load from env / secret manager.

- **Detect:** string literals matching common secret patterns: `sk-[A-Za-z0-9]{20,}`, `AKIA[0-9A-Z]{16}`, `xox[bp]-[0-9A-Za-z-]+`, `-----BEGIN [A-Z ]+ PRIVATE KEY-----`, JWT signing strings ≥32 chars
- **Severity:** `blocking`
- **Tag:** `secret`

### C.2 No PII / secrets in logs

Logged values must not include passwords, tokens, full credit card numbers, full SSNs, session IDs, or arbitrary `req.body` / `req.headers` blobs.

- **Detect:** `console.log` / `logger.<level>` calls with `req.body`, `req.headers`, `req.cookies`, `password`, `token`, `apiKey`, `authorization` as a value or string-interpolated component
- **Severity:** `important`
- **Tag:** `pii`

### C.3 Error responses don't leak internal detail

Error responses returned over HTTP must not include stack traces, full file paths, database schema details, or internal IP addresses. Map exceptions to safe public messages.

- **Detect:** `res.json({ error: err })` / `res.send(err.stack)` / responses including `err.message` from unhandled exceptions; `throw` reaching framework default handler
- **Severity:** `important`
- **Tag:** `info-leak`

### C.4 Secrets are masked when shown

Tools or pages that display secrets (env editors, audit logs, debug panels) must mask all but the last 4 characters by default. Reveal requires explicit user action.

- **Detect:** UI components rendering values from sources tagged as secret (env variables, API keys) without a mask helper
- **Severity:** `important`
- **Tag:** `secret`

---

## D. Cryptographic issues

*Sources: OWASP A02:2025, CWE-327/328/759, ASVS V6/V11.*

### D.1 No MD5 / SHA-1 for security purposes

MD5 and SHA-1 must not be used for password hashing, integrity verification, or any security-relevant comparison. Use SHA-256+ for integrity, Argon2id / bcrypt / scrypt for passwords.

- **Detect:** `crypto.createHash('md5')` / `'sha1'`; `bcrypt.hash` rounds < 12
- **Severity:** `important`
- **Tag:** `crypto`

### D.2 Random tokens use a CSPRNG

Session IDs, password-reset tokens, CSRF tokens, and other security-relevant random values must use `crypto.randomBytes` / `crypto.getRandomValues`, never `Math.random()`.

- **Detect:** `Math.random()` used to compute a token, ID, salt, nonce, or any value passed to an auth/session/csrf field
- **Severity:** `blocking`
- **Tag:** `crypto`

### D.3 No ECB mode for symmetric encryption

ECB mode leaks pattern structure. Use AES-GCM or AES-CBC with a unique random IV (and a separate MAC for CBC).

- **Detect:** `crypto.createCipheriv('aes-*-ecb', ...)` or any `*-ecb` mode string
- **Severity:** `important`
- **Tag:** `crypto`

### D.4 Constant-time comparison for secrets

Comparing tokens, signatures, or HMACs with `===` allows timing attacks. Use `crypto.timingSafeEqual`.

- **Detect:** equality (`===`, `!==`) comparison whose operands are HMACs, session tokens, or signature strings (heuristic: both sides have ≥16 hex/base64 chars and one is user-provided)
- **Severity:** `important`
- **Tag:** `crypto`

---

## E. Input validation

*Sources: OWASP A03:2025, CWE-20/79/89, ASVS V5.*

### E.1 Network handlers validate body shape

Every API handler that reads `req.body` validates it against a schema (zod / valibot / similar) before passing values to downstream logic.

- **Detect:** `req.body.<field>` references in route handlers without a preceding `.parse(req.body)` / `.safeParse` / explicit type guard
- **Severity:** `important`
- **Tag:** `validation`

### E.2 File-path inputs are normalized + bounded

User-supplied path fragments must be resolved with `path.resolve` and then verified to live under the expected base directory (no `..` escape).

- **Detect:** `fs.readFile` / `Bun.file` / `path.join` calls whose argument includes `req.params.<x>` / `req.query.<x>` / `req.body.<x>` without a follow-up `startsWith(base)` check
- **Severity:** `blocking`
- **Tag:** `path-traversal`

### E.3 URL inputs are scheme-restricted

URLs accepted from users (redirects, webhook targets, SSRF-sensitive fetches) must whitelist `https:` (or `http://localhost` in dev) and reject `file:` / `gopher:` / `data:`.

- **Detect:** `fetch(req.body.<url>)` / `axios.get(req.body.<url>)` / `Bun.fetch(req.body.<url>)` without a `new URL(...).protocol === 'https:'` check
- **Severity:** `important`
- **Tag:** `ssrf`

### E.4 Numeric inputs are bounded

Numeric fields from request bodies must be range-checked before use as array indices, allocation sizes, or loop counts.

- **Detect:** `req.body.<n>` / `req.query.<n>` flowing into `new Array(n)`, `setTimeout(_, n)`, or a loop bound without `Number.isInteger` + min/max
- **Severity:** `important`
- **Tag:** `validation`

---

## F. Business logic flaws

*Sources: CWE-362/367 (TOCTOU), ASVS V11.*

### F.1 Async file-checks don't race their use

`fs.exists` / `fs.stat` followed by a separate `fs.open` / `fs.read` is a TOCTOU race. Open the resource and handle the error, or use a single atomic call.

- **Detect:** `fs.exists` / `fs.stat` followed within the same scope by `fs.open` / `fs.readFile` on the same path
- **Severity:** `important`
- **Tag:** `toctou`

### F.2 Money / quota mutations are transactional

Updates to balances, credit counts, rate-limit counters, or quota fields must use a database transaction or atomic increment — not read-modify-write at the application layer.

- **Detect:** sequences of `SELECT balance` → `UPDATE balance = <new>` outside a transaction; `count = await get(); await set(count + 1)` patterns on quota-sensitive paths
- **Severity:** `blocking`
- **Tag:** `race`

### F.3 Long-running tokens have expiry

Auth tokens, password-reset tokens, email-verification tokens, and API keys must encode or store an expiry. Tokens with no expiry are forbidden.

- **Detect:** token-issuance code that does not set `exp` (JWT) or `expiresAt` (DB row); `bcrypt.compare` against a stored reset-token without an expiry check
- **Severity:** `important`
- **Tag:** `auth`

---

## G. Configuration security

*Sources: OWASP A05:2025 (Security Misconfiguration), CWE-16/200, ASVS V14.*

### G.1 CORS is not `*` with credentials

`Access-Control-Allow-Origin: *` must not be combined with `Access-Control-Allow-Credentials: true`. Browsers refuse this combination, but the misconfiguration signals broken intent.

- **Detect:** route definitions / middleware that set both `cors: { origin: '*', credentials: true }`
- **Severity:** `important`
- **Tag:** `misconfig`

### G.2 Cookies for auth set Secure in production

In production, every cookie carrying an auth/session token must set `secure: true` (HTTPS-only).

- **Detect:** `res.cookie(name, value, opts)` where `name` matches `session|auth|token|jwt` and `opts.secure !== true` outside development branches
- **Severity:** `important`
- **Tag:** `misconfig`

### G.3 Production headers set the standard hardening set

HTTP responses serving HTML to browsers must set Content-Security-Policy, X-Content-Type-Options, Strict-Transport-Security, and Referrer-Policy.

- **Detect:** server bootstrap (`src/ui/server.ts`, `dev-server.ts`, equivalents) that doesn't set the four headers above
- **Severity:** `nit`
- **Tag:** `hardening`

### G.4 Default credentials and example secrets removed

Sample / template values (`changeme`, `admin/admin`, `your_secret_here`, `sk-EXAMPLE`) must not appear in committed config / env-example files as if they were real defaults the app will load.

- **Detect:** `.env`, `.env.example`, `config.json` files containing real-shaped secret values that match common placeholder strings AND are used by the app without further override
- **Severity:** `important`
- **Tag:** `secret`

---

## H. Supply chain

*Sources: OWASP A06:2025 (Vulnerable Components), CWE-1104/506, ASVS V14.*

### H.1 No unpinned `latest` / floating dependencies

`package.json` `dependencies` entries must pin to a specific version or version range. `"latest"`, `"*"`, or a bare git ref without a commit pin is forbidden.

- **Detect:** `dependencies` / `devDependencies` entries with value `"latest"` / `"*"`; git URLs without `#<sha>`
- **Severity:** `important`
- **Tag:** `supply-chain`

### H.2 No `postinstall` scripts in newly-added deps

A dependency added in the current diff must not bring a `postinstall` / `preinstall` script unless explicitly justified — common malware vector.

- **Detect:** new entries in `package.json` whose installed `node_modules/<dep>/package.json` has `scripts.postinstall` or `scripts.preinstall`
- **Severity:** `important`
- **Tag:** `supply-chain`

### H.3 Lock file is committed and consistent

`bun.lock` / `package-lock.json` is committed and matches `package.json`. Unlocked dependency changes break reproducible installs.

- **Detect:** `package.json` changed without a matching `bun.lock` change in the same commit (or the lock file doesn't include all declared deps)
- **Severity:** `important`
- **Tag:** `supply-chain`

---

## I. Code execution

*Sources: OWASP A08:2025 (Software & Data Integrity), CWE-94/95/502, ASVS V12.*

### I.1 No `eval` / `Function(...)` / `vm.runIn*` on untrusted input

`eval`, `new Function`, `vm.runInThisContext`, and similar dynamic-code-execution primitives must not receive any string that depends on user input.

- **Detect:** `eval(` / `new Function(` / `vm.run` calls whose argument depends on `req.*`, `Bun.stdin`, or a file content
- **Severity:** `blocking`
- **Tag:** `rce`

### I.2 No `JSON.parse` of untrusted prototypes

`JSON.parse(req.body)` followed by direct use as an object is fine; using it as a prototype source (`Object.assign(target, parsed)`, `_.merge(target, parsed)`) without filtering `__proto__` / `constructor` keys is prototype pollution.

- **Detect:** `Object.assign(_, JSON.parse(<input>))` / `_.merge(_, <input>)` / `Object.assign(_, req.body)` without a key allowlist
- **Severity:** `important`
- **Tag:** `prototype-pollution`

### I.3 No dynamic `require(<user-input>)`

`require` / dynamic `import()` whose path string depends on user input lets attackers load arbitrary modules.

- **Detect:** `require(<expr>)` / `import(<expr>)` where `<expr>` is built from `req.*`, file content, or stdin
- **Severity:** `blocking`
- **Tag:** `rce`

### I.4 Deserialization from untrusted sources is bounded

Custom deserialization (BSON, msgpack, `node-serialize`) of attacker-controlled bytes must be size-bounded and use a safe library; `node-serialize`'s `unserialize` is RCE.

- **Detect:** `unserialize(` / `node-serialize` import; deserialization calls with no length cap on the input
- **Severity:** `blocking`
- **Tag:** `rce`

---

## J. XSS

*Sources: OWASP A03:2025 (Injection), CWE-79/80/83, ASVS V5.*

### J.1 No `dangerouslySetInnerHTML` from user input

React's `dangerouslySetInnerHTML` must not receive a value derived from a network response, request body, or any user-controlled source without sanitization (DOMPurify or equivalent).

- **Detect:** `dangerouslySetInnerHTML={{ __html: <expr> }}` where `<expr>` traces back to `fetch`, `props`, or any non-literal source without a `DOMPurify.sanitize` wrap
- **Severity:** `blocking`
- **Tag:** `xss`

### J.2 No raw HTML strings constructed from user input

Building HTML strings with `+` or template literals that include user values and assigning them to `innerHTML` / `document.write` is forbidden.

- **Detect:** `el.innerHTML = ` / `document.write(` calls whose argument includes a template literal with `${}` or string concatenation
- **Severity:** `blocking`
- **Tag:** `xss`

### J.3 Markdown rendering goes through a sanitizing renderer

User-supplied markdown must be rendered via a sanitizing pipeline (DOMPurify after `marked`, or a renderer with `sanitize: true`). Raw HTML in markdown is a vector.

- **Detect:** `marked(<user-input>)` without `DOMPurify.sanitize` follow-up; `react-markdown` without `rehypePlugins: [rehypeSanitize]`
- **Severity:** `important`
- **Tag:** `xss`

### J.4 URL attributes ban `javascript:`

`href` / `src` / `formaction` attributes computed from user input must be checked for `javascript:` scheme before rendering.

- **Detect:** JSX `href={<expr>}` / `src={<expr>}` where `<expr>` is user-controlled and no `URL` parse + scheme check precedes it
- **Severity:** `important`
- **Tag:** `xss`

---

## Default exclusions

Lifted from `claude-code-security-review`. Excluded by default because they generate more noise than signal in product code:

- Denial of Service / rate limiting (handle at infra layer)
- Memory/CPU exhaustion (handle at infra layer)
- Generic input validation without proven impact (covered by E.1 / E.4 only when there's a real downstream consequence)
- Open redirect (unless tied to credential leak; otherwise nit)
- Detection evasion concerns (not a defensive concern)

Override per project via the leaf's invocation flags.

---

## Negative-filter list (uniform with other review leaves)

- Style or quality concerns not in this file → drop
- Pre-existing issues outside the review scope → record under "Pre-existing Issues"
- Subjective suggestions presented as bugs → use `severity: suggestion` if proposing alternatives
- Issues a linter would catch (`eslint-plugin-security`, `semgrep`) → cite the linter, mark `severity: nit` if including at all
- Lint-ignored lines → drop

---

## Framework mappings

Each rule cross-references to external standards (cited in the finding's prose when relevant):

- **OWASP Top 10:2025** — primary categorization
- **CWE Top 25** — defect type identifier
- **NIST CSF 2.0** — control function (Identify / Protect / Detect / Respond / Recover)
- **ASVS 5.0** — verification level (V1-V14)
- **MITRE ATT&CK** — adversary technique ID (when applicable)

Detail mapping tables live in reference files:

- `owasp-top-10.md` — full OWASP Top 10:2025 with rule mappings (stub; populate on demand)
- `cwe-top-25.md` — CWE Top 25 with rule mappings (stub; populate on demand)

---

## Approval policy (Construct-specific)

Security findings prompt per-finding regardless of severity. The leaf surfaces every finding individually for explicit user sign-off — there is no apply-all path for the security domain. This is the one place where the standard apply-all / pick / discard gate is replaced by per-finding prompting.
