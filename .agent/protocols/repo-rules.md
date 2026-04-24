# Repo Rules

- `./.agent/project.toml` 是這個 repo 的 machine-readable source of truth。
- `./.agent/scripts/hooks/` 只做 inform、verify 建議、receipt、memory capture；不自動 commit、push、deploy。
- repo-local `.agent/` 是 overlay：bootstrap 之後由 repo 自行維護，不與 dotfiles 自動同步。
- 長輸出與暫存資訊寫到 `./.agent/logs/` 或 `./.agent/state/`，不要把大段 log 貼回主對話。
- semantic memory 只接受 review 過的內容；`memory/episodic/` 只是候選與審計資料。
