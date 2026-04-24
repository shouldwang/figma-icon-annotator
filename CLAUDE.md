# Repo Claude Entry

This repository uses a repo-local `.agent/` stack.

Read this order:

1. `./.agent/project.toml`
2. `./.agent/protocols/repo-rules.md`
3. `./.agent/protocols/rpi.md`
4. `./.agent/memory/semantic/LESSONS.md`
5. Relevant files under `./.agent/agents/`

Rules:

- Treat `./.agent/` as repo-local runtime state and policy.
- Do not assume dotfiles are the source of truth for repo behavior after bootstrap.
- Use `./.agent/state/` for receipts and ignored runtime files, not repo root.
