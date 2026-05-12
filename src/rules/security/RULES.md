# Security Rules

Authoritative rules for security findings — exploitable vulnerabilities, not code quality. Read by `security-audit` (post-hoc) and `security-fix` (remediation). No `security-author` skill; security rules apply via `code-author`'s CLAUDE.md context.

**Status: stub.** Will be populated in Phase 5. Net-new domain; rules draw from external standards (OWASP / CWE / NIST / ASVS / MITRE) plus the 10 vulnerability categories validated by `claude-code-security-review`.

## Planned sections (drawn from Anthropic's claude-code-security-review)

- **A. Injection** — SQL, command, LDAP, XPath, NoSQL injection, XXE
- **B. Authentication & authorization** — broken auth, privilege escalation, IDOR, bypass logic
- **C. Data exposure** — hardcoded secrets, PII logging, sensitive data in errors
- **D. Cryptographic issues** — weak algorithms, improper key management, weak RNG
- **E. Input validation** — missing validation, improper sanitization, buffer overflow
- **F. Business logic flaws** — race conditions, TOCTOU
- **G. Configuration security** — insecure defaults, missing security headers
- **H. Supply chain** — vulnerable dependencies, suspicious additions
- **I. Code execution** — RCE via deserialization, pickle injection, eval, dangerous dynamic require
- **J. XSS** — reflected, stored, DOM-based

## Framework mappings

Each rule cross-references to:

- **OWASP Top 10:2025** — primary categorization
- **CWE Top 25** — defect type
- **NIST CSF 2.0** — control framework
- **ASVS 5.0** — verification level
- **MITRE ATT&CK** — adversary technique (where applicable)

## Default exclusions (also from claude-code-security-review)

Excluded by default — noise generators in practice:

- Denial of Service / rate limiting
- Memory/CPU exhaustion
- Generic input validation without proven impact
- Open redirect (unless tied to credential leak)

Override via `omnibus.yml` `leaves.security-audit.include:` for projects where these matter.

## Reference files

- `owasp-top-10.md` — current OWASP Top 10:2025 with examples
- `cwe-top-25.md` — current CWE Top 25 with examples
- `nist-csf.md` — relevant subset of NIST CSF 2.0 controls
- `asvs.md` — ASVS 5.0 verification requirements
