# Security Policy

## Supported Version

Security fixes are applied to the latest code on the `main` branch.

## Reporting A Vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do not publish administrator credentials, API keys, database copies, exploit details, or user data in a public Issue.

Include the affected version or commit, reproduction steps, impact, and any suggested mitigation. We will acknowledge a valid report as soon as practical and coordinate disclosure after a fix is available.

## Secret Handling

- A fresh install has no default administrator password.
- Keep `BENCHMARK_ADMIN_PASSWORD`, `BENCHMARK_SECRET`, and provider API keys outside Git.
- Never commit `data/benchmark.db`, `.env`, logs, exports containing keys, or production process-manager configuration.
- Rotate a credential immediately if it was ever committed, even if the commit was later removed.
