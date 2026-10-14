# Security Policy

Khodrekab takes the security and integrity of our interactive automotive platform and users' privacy with paramount importance. We appreciate the efforts of security researchers and engineers who responsibly disclose security vulnerabilities.

---

## Supported Versions

Only the latest release branch and active development on `main` receive critical security updates.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1.0 | :x:                |

---

## Reporting a Vulnerability

**Please DO NOT report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability, Proof-of-Work bypass, authentication flaw, or potential sensitive data leak, please report it privately through one of the following channels:

1. **GitHub Private Vulnerability Reporting (Preferred):**  
   Navigate to the [Security tab](https://github.com/Mahdi-Soleimani/khodrekab/security) of the repository and click **"Report a vulnerability"** to open a confidential advisory.

2. **Direct Security Contact:**  
   Send an encrypted or confidential email to:
   - **Lead Engineer:** `mahdisoleimani2003@gmail.com`
   - **Subject:** `[SECURITY] Potential Vulnerability in Khodrekab - <Short Description>`

### Information to Include

To help us triage and reproduce the issue rapidly, please provide:
- A descriptive summary of the vulnerability and its potential impact.
- Step-by-step reproduction instructions or a minimal Proof of Concept (PoC).
- Affected endpoints, files, or components (e.g., `/api/waitlist/verify`, `src/lib/security/pow.ts`).
- Any potential remediations or patches you recommend.

---

## Response Timeline & SLA

- **Acknowledgment:** Within **24–48 hours** of receiving your report.
- **Initial Assessment & Reproduction:** Within **3–5 business days**.
- **Remediation & Patch Deployment:** Critical severity patches are deployed within **7 business days**.
- **Coordinated Public Disclosure:** Following deployment and verification of the fix, we will coordinate public disclosure and provide proper attribution to the reporter in our release notes.

---

## Bug Bounty & Attribution

Khodrekab is an independent software project. While we may not currently operate a monetary bug bounty program, we proudly credit and thank security researchers in our release notes and contributor hall of fame for valid, responsibly disclosed findings.
