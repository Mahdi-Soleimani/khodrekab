## 📌 Description

Please provide a concise description of the changes introduced in this pull request and the problem they solve.

Fixes #(issue)

---

## 🔍 Type of Change

- [ ] 🐛 Bug fix (non-breaking change which fixes an issue)
- [ ] ✨ New feature (non-breaking change which adds functionality)
- [ ] ⚡ Performance optimization (improves load time, memory, or FPS)
- [ ] 🛡️ Security / Anti-abuse improvement (PoW, rate limiting, PII protection)
- [ ] 🗄️ Database migration or schema adjustment
- [ ] 📝 Documentation update (README, docs/, architectural specs)
- [ ] 🧹 Refactoring or code maintenance (no functional changes)

---

## 🏛 Architectural & Security Impact

Please check any systems affected by this change:
- [ ] Canvas 2D Engine / Frame Loader / LRU Cache
- [ ] Proof-of-Work (PoW) verification or challenge generation
- [ ] SMS Gateway dispatch or Redis queue workers
- [ ] Card-to-card payment intent or reconciliation
- [ ] PostgreSQL least-privilege roles or migration files
- [ ] Docker container build or loopback supervisor (`entrypoint.sh`)
- [ ] None of the above (isolated change)

---

## 🧪 How Has This Been Tested?

Please describe the tests and verification steps you executed:
- [ ] Local development server (`npm run dev`)
- [ ] TypeScript compile check (`npm run typecheck`)
- [ ] Local Gitleaks security scan (`gitleaks detect --config=.gitleaks.toml --verbose`)
- [ ] Database migration rollback/forward verification (if schema was altered)
- [ ] Mobile/Desktop browser testing (Chrome, Safari, Firefox)

---

## ✅ Contributor Checklist

- [ ] My code follows the code style and guidelines of this project.
- [ ] I have performed a self-review of my own code.
- [ ] I have commented my code, particularly in hard-to-understand or mathematically dense areas.
- [ ] I have updated the relevant documentation in `docs/` or `README.md`.
- [ ] My changes generate **no new TypeScript compiler errors**.
- [ ] I have **NOT committed any real secrets, API keys, credentials, or personal telephone/card numbers**.
