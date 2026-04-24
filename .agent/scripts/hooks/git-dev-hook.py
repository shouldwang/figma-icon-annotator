#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
import sys
try:
    import tomllib
except ImportError:
    tomllib = None  # type: ignore[assignment]
from datetime import datetime, timezone
from pathlib import Path


CODE_EXTENSIONS = {
    ".c", ".cc", ".cpp", ".cs", ".css", ".go", ".java",
    ".js", ".jsx", ".kt", ".kts", ".mjs", ".cjs", ".php",
    ".py", ".rb", ".rs", ".scss", ".sh", ".sql", ".swift",
    ".ts", ".tsx", ".zsh",
}

CONFIG_BASENAMES = {
    ".editorconfig", ".eslintrc", ".eslintrc.cjs", ".eslintrc.js",
    ".eslintrc.json", ".flake8", ".prettierrc", ".prettierrc.cjs",
    ".prettierrc.js", ".prettierrc.json", ".ruff.toml", "biome.json",
    "eslint.config.cjs", "eslint.config.js", "eslint.config.mjs",
    "package.json", "prettier.config.cjs", "prettier.config.js",
    "prettier.config.mjs", "pyproject.toml", "ruff.toml",
    "setup.cfg", "tsconfig.json",
}

CONFIG_PREFIXES = ("eslint", "prettier", "ruff", "biome", "tsconfig", "vite", "webpack")
SUGGESTION_ORDER = ["format", "lint", "typecheck", "test_changed", "test", "deploy"]

VALID_PHASES = {"spec", "design", "dev", "qa", "deploy", "iteration"}
VALID_STAGES = ("Research", "Plan", "Implement")

# Per-phase allowlist: which verify suggestion keys are surfaced.
# spec/design skip code-verify entirely; qa front-loads test; deploy gates on test+deploy.
PHASE_SUGGEST_KEYS: dict[str, list[str]] = {
    "spec":      [],
    "design":    [],
    "dev":       ["format", "lint", "typecheck", "test_changed", "test"],
    "qa":        ["test_changed", "test", "typecheck", "format", "lint"],
    "deploy":    ["test", "deploy"],
    "iteration": ["format", "lint", "typecheck", "test_changed", "test"],
}

# Per-phase rpi_enforced override; None means use project.toml setting.
PHASE_RPI_OVERRIDE: dict[str, str | None] = {
    "spec":      "inform-only",
    "design":    "inform-only",
    "dev":       None,
    "qa":        None,
    "deploy":    "always",
    "iteration": None,
}


# ---------------------------------------------------------------------------
# Repo / manifest
# ---------------------------------------------------------------------------

def repo_root() -> Path | None:
    try:
        root = subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except subprocess.CalledProcessError:
        return None
    return Path(root)


def agent_root(root: Path) -> Path:
    return root / ".agent"


def manifest_path(root: Path) -> Path:
    return agent_root(root) / "project.toml"


def load_manifest(root: Path) -> dict | None:
    path = manifest_path(root)
    if not path.is_file():
        return None
    if tomllib is None:
        return None

    with path.open("rb") as f:
        data = tomllib.load(f)

    project = data.get("project") or {}
    if project.get("type") != "git-dev":
        return None

    commands = data.get("commands") or {}
    paths = data.get("paths") or {}
    features = data.get("features") or {}

    def clean_str(value: object) -> str:
        return value.strip() if isinstance(value, str) and value.strip() else ""

    def clean_list(value: object) -> list[str]:
        if not isinstance(value, list):
            return []
        return [item.strip() for item in value if isinstance(item, str) and item.strip()]

    raw_phase = clean_str(project.get("phase")) or "dev"
    phase = raw_phase if raw_phase in VALID_PHASES else "dev"

    try:
        max_episodic = int(features.get("max_episodic_entries", 50))
    except (TypeError, ValueError):
        max_episodic = 50

    return {
        "project": {
            "type":          "git-dev",
            "phase":         phase,
            "repo_root":     str(root),
            "manifest_path": str(path),
        },
        "commands": {
            "dev":          clean_str(commands.get("dev")),
            "format":       clean_str(commands.get("format")),
            "lint":         clean_str(commands.get("lint")),
            "typecheck":    clean_str(commands.get("typecheck")),
            "test":         clean_str(commands.get("test")),
            "test_changed": clean_str(commands.get("test_changed")),
            "deploy":       clean_str(commands.get("deploy")),
        },
        "paths": {
            "key_dirs":         clean_list(paths.get("key_dirs")),
            "high_risk":        clean_list(paths.get("high_risk")),
            "dependency_files": clean_list(paths.get("dependency_files")),
            "lockfiles":        clean_list(paths.get("lockfiles")),
            "spec_dirs":        clean_list(paths.get("spec_dirs")),
        },
        "features": {
            "memory_capture":       bool(features.get("memory_capture", True)),
            "rpi_enforced":         clean_str(features.get("rpi_enforced")) or "complex-only",
            "max_episodic_entries": max_episodic,
        },
    }


# ---------------------------------------------------------------------------
# Runtime directories & state paths
# ---------------------------------------------------------------------------

def runtime_dirs(root: Path) -> dict[str, Path]:
    agent = agent_root(root)
    return {
        "agent":    agent,
        "state":    agent / "state",
        "logs":     agent / "logs",
        "cache":    agent / "cache",
        "tmp":      agent / "tmp",
        "episodic": agent / "memory" / "episodic",
        "working":  agent / "memory" / "working",
        "semantic": agent / "memory" / "semantic",
    }


def ensure_runtime_dirs(root: Path) -> dict[str, Path]:
    dirs = runtime_dirs(root)
    for path in dirs.values():
        path.mkdir(parents=True, exist_ok=True)
    return dirs


def session_state_path(root: Path) -> Path:
    return runtime_dirs(root)["state"] / "session.json"


def rpi_state_path(root: Path) -> Path:
    return runtime_dirs(root)["state"] / "rpi.json"


def receipt_path(root: Path) -> Path:
    return runtime_dirs(root)["state"] / "rpi-latest.md"


# ---------------------------------------------------------------------------
# I/O helpers
# ---------------------------------------------------------------------------

def read_json(path: Path, default: dict) -> dict:
    if not path.is_file():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


# ---------------------------------------------------------------------------
# Git helpers
# ---------------------------------------------------------------------------

def parse_status(root: Path) -> list[dict]:
    try:
        output = subprocess.check_output(
            ["git", "-C", str(root), "status", "--porcelain", "--untracked-files=all"],
            text=True,
        )
    except subprocess.CalledProcessError:
        return []

    entries = []
    for line in output.splitlines():
        if len(line) < 4:
            continue
        status = line[:2]
        raw_path = line[3:]
        if " -> " in raw_path:
            raw_path = raw_path.split(" -> ", 1)[1]
        abs_path = (root / raw_path).resolve()
        entries.append({
            "status":   status,
            "path":     raw_path,
            "abs_path": str(abs_path),
            "exists":   abs_path.exists(),
        })
    return entries


def branch_status(root: Path) -> str:
    branch = subprocess.check_output(
        ["git", "-C", str(root), "branch", "--show-current"],
        text=True,
    ).strip() or "DETACHED"
    upstream = subprocess.run(
        ["git", "-C", str(root), "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
        text=True,
        capture_output=True,
    )
    if upstream.returncode != 0:
        return f"branch {branch} 尚未設定 upstream"

    def count(rev: str) -> int:
        try:
            return int(subprocess.check_output(
                ["git", "-C", str(root), "rev-list", "--count", rev],
                text=True,
            ).strip())
        except subprocess.CalledProcessError:
            return 0

    ahead  = count("@{u}..HEAD")
    behind = count("HEAD..@{u}")
    if ahead and behind:
        return f"branch {branch} 落後 {behind}、領先 {ahead}"
    if behind:
        return f"branch {branch} 落後 remote {behind} commit"
    if ahead:
        return f"branch {branch} 領先 remote {ahead} commit"
    return f"branch {branch} 與 remote 同步"


# ---------------------------------------------------------------------------
# Path classification helpers
# ---------------------------------------------------------------------------

def normalize_rel(path: str) -> str:
    return path.replace(os.sep, "/").lstrip("./")


def rel_path(root: Path, path: str) -> str:
    abs_path = Path(path) if os.path.isabs(path) else root / path
    return normalize_rel(os.path.relpath(abs_path, root))


def path_matches(rel: str, prefixes: list[str]) -> bool:
    for item in prefixes:
        needle = normalize_rel(item)
        if rel == needle or rel.startswith(f"{needle}/"):
            return True
    return False


def is_code_like(rel: str, manifest: dict) -> bool:
    if path_matches(rel, manifest["paths"]["key_dirs"]):
        return True
    return Path(rel).suffix in CODE_EXTENSIONS


def is_config_like(rel: str) -> bool:
    path = Path(rel)
    name = path.name
    if name in CONFIG_BASENAMES:
        return True
    if any(name.startswith(p) for p in CONFIG_PREFIXES):
        return True
    if name.startswith(".") and any(token in name for token in CONFIG_PREFIXES):
        return True
    if path.suffix in {".json", ".yaml", ".yml", ".toml", ".ini"} and len(path.parts) <= 2:
        return True
    return False


def merge_suggestions(existing: list[str], new: list[str]) -> list[str]:
    merged = set(existing) | set(new)
    return [item for item in SUGGESTION_ORDER if item in merged]


# ---------------------------------------------------------------------------
# classify — phase-aware
# ---------------------------------------------------------------------------

def classify(
    rel_files: list[str],
    manifest: dict,
) -> tuple[list[str], list[str], list[str], list[str]]:
    phase   = manifest["project"]["phase"]
    allowed = set(PHASE_SUGGEST_KEYS.get(phase, PHASE_SUGGEST_KEYS["dev"]))

    suggestions:     set[str] = set()
    risks:           set[str] = set()
    complex_reasons: set[str] = set()

    dep_set  = {normalize_rel(i) for i in manifest["paths"]["dependency_files"]}
    lock_set = {normalize_rel(i) for i in manifest["paths"]["lockfiles"]}
    touched  = {normalize_rel(i) for i in rel_files}

    dep_touched  = sorted(dep_set  & touched)
    lock_touched = sorted(lock_set & touched)

    if len(touched) > 1:
        complex_reasons.add("跨多個檔案")

    for rel in touched:
        if is_code_like(rel, manifest):
            if "typecheck" in allowed:
                suggestions.add("typecheck")
            has_changed = bool(manifest["commands"]["test_changed"])
            test_key = "test_changed" if (has_changed and "test_changed" in allowed) else "test"
            if test_key in allowed:
                suggestions.add(test_key)
        if is_config_like(rel):
            if "format" in allowed:
                suggestions.add("format")
            if "lint" in allowed:
                suggestions.add("lint")
        if path_matches(rel, manifest["paths"]["high_risk"]):
            risks.add(f"{rel} 屬於 high-risk 路徑")
            complex_reasons.add("命中 high-risk 路徑")
            if "deploy" in allowed:
                suggestions.add("deploy")
        if rel.endswith(("hooks.json", "settings.json", ".toml")) and ".agent/" in rel:
            complex_reasons.add("涉及 agent hook 或 protocol 設定")

    if dep_touched and not lock_touched:
        risks.add("dependency 檔案已變更但 lockfile 未同步：" + ", ".join(dep_touched))
        complex_reasons.add("涉及依賴與 lockfile 風險")
    if lock_touched and not dep_touched:
        risks.add("lockfile 已變更但 dependency 檔案未同步：" + ", ".join(lock_touched))
        complex_reasons.add("涉及依賴與 lockfile 風險")

    if phase == "deploy" and risks:
        complex_reasons.add("deploy 階段高風險路徑變更")

    ordered_suggestions = [
        k for k in SUGGESTION_ORDER
        if k in suggestions and manifest["commands"].get(k) and k in allowed
    ]
    return sorted(touched), sorted(risks), ordered_suggestions, sorted(complex_reasons)


# ---------------------------------------------------------------------------
# Input parsing
# ---------------------------------------------------------------------------

def touched_files_from_input(root: Path) -> list[str]:
    file_list = os.environ.get("GIT_DEV_FILE_LIST", "").strip()
    touched: list[str] = []
    if file_list and os.path.isfile(file_list):
        with open(file_list, "r", encoding="utf-8") as f:
            for line in f:
                raw = line.strip()
                if not raw:
                    continue
                abs_path = Path(raw) if os.path.isabs(raw) else root / raw
                abs_path = abs_path.resolve()
                if str(abs_path).startswith(str(root)) and abs_path.exists():
                    touched.append(str(abs_path))
        return touched

    payload = sys.stdin.read().strip()
    if not payload:
        return []

    try:
        data = json.loads(payload)
    except Exception:
        return []

    raw = ((data.get("tool_input") or {}).get("file_path")) or ""
    if not isinstance(raw, str) or not raw:
        return []

    abs_path = (Path(raw) if os.path.isabs(raw) else root / raw).resolve()
    if str(abs_path).startswith(str(root)) and abs_path.exists():
        return [str(abs_path)]
    return []


def summarize_dirty(entries: list[dict]) -> str:
    live = [e for e in entries if e["exists"]]
    if not live:
        return "worktree clean"
    preview = ", ".join(e["path"] for e in live[:5])
    if len(live) > 5:
        preview += f" 等 {len(live)} 個檔案"
    return f"dirty {len(live)} 個檔案：{preview}"


def format_verify_suggestions(manifest: dict, suggestions: list[str]) -> str:
    if not suggestions:
        return "目前無額外 verify 建議"
    parts = [f"{k}=`{manifest['commands'][k]}`" for k in suggestions if manifest["commands"].get(k)]
    return "；".join(parts) if parts else "目前無額外 verify 建議"


def emit_message(message: str, hook_event: str | None = None) -> int:
    if not message.strip():
        return 0
    payload: dict = {"systemMessage": message}
    if hook_event:
        payload["hookSpecificOutput"] = {
            "hookEventName":     hook_event,
            "additionalContext": message,
        }
    print(json.dumps(payload, ensure_ascii=False))
    return 0


# ---------------------------------------------------------------------------
# RPI helpers
# ---------------------------------------------------------------------------

def effective_rpi_enforced(manifest: dict) -> str:
    phase    = manifest["project"]["phase"]
    override = PHASE_RPI_OVERRIDE.get(phase)
    return override if override is not None else manifest["features"]["rpi_enforced"]


def write_rpi_state(
    root: Path,
    manifest: dict,
    touched: list[str],
    risks: list[str],
    suggestions: list[str],
    complex_reasons: list[str],
    stage: str,
) -> dict:
    enforced = effective_rpi_enforced(manifest)
    phase    = manifest["project"]["phase"]

    existing = read_json(rpi_state_path(root), {})
    # Preserve completed_stages unless opening a fresh Research stage (new session)
    completed_stages: list[str] = [] if stage == "Research" else existing.get("completed_stages", [])

    if enforced == "always":
        required = True
    elif enforced == "complex-only":
        required = bool(complex_reasons)
    else:
        required = False

    required_precursors = ["Research", "Plan"] if required and stage == "Implement" else []
    missing = [s for s in required_precursors if s not in completed_stages]

    payload = {
        "updated_at":        datetime.now(timezone.utc).isoformat(),
        "required":          required,
        "phase":             phase,
        "current_stage":     stage,
        "completed_stages":  completed_stages,
        "complex_reasons":   complex_reasons,
        "missing_receipts":  missing,
        "last_receipt_path": str(receipt_path(root)),
    }
    write_json(rpi_state_path(root), payload)

    receipt_lines = [
        f"# {stage} Receipt",
        "",
        f"- Updated at: {payload['updated_at']}",
        f"- Phase: {phase}",
        f"- Current stage: {stage}",
        f"- RPI enforced: {enforced}",
    ]
    if touched:
        receipt_lines.append(f"- Touched files: {', '.join(touched[:8])}")
    if risks:
        receipt_lines.append(f"- Risks: {'；'.join(risks)}")
    if suggestions:
        receipt_lines.append(f"- Verify: {format_verify_suggestions(manifest, suggestions)}")
    if complex_reasons:
        receipt_lines.append(f"- Complex reasons: {'；'.join(complex_reasons)}")
    if missing:
        receipt_lines.append(f"- Missing receipts: {', '.join(missing)}")

    receipt_path(root).write_text("\n".join(receipt_lines).rstrip() + "\n", encoding="utf-8")
    return payload


# ---------------------------------------------------------------------------
# Episodic memory management
# ---------------------------------------------------------------------------

def trim_episodic(root: Path, manifest: dict) -> None:
    max_entries  = manifest["features"]["max_episodic_entries"]
    episodic_dir = runtime_dirs(root)["episodic"]
    if not episodic_dir.is_dir():
        return
    candidates = sorted(episodic_dir.glob("*.json"))
    excess = len(candidates) - max_entries
    if excess > 0:
        for path in candidates[:excess]:
            path.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Hook handlers
# ---------------------------------------------------------------------------

def run_session_start(root: Path, manifest: dict) -> int:
    ensure_runtime_dirs(root)
    trim_episodic(root, manifest)

    write_json(session_state_path(root), {
        "started_at":    datetime.now(timezone.utc).isoformat(),
        "touched_files": [],
        "risks":         [],
        "suggestions":   [],
    })
    write_rpi_state(root, manifest, [], [], [], [], "Research")

    status_entries = parse_status(root)
    rel_dirty      = [rel_path(root, e["abs_path"]) for e in status_entries if e["exists"]]
    _, risks, _, complex_reasons = classify(rel_dirty, manifest)

    phase    = manifest["project"]["phase"]
    enforced = effective_rpi_enforced(manifest)

    lines = [
        f"[git-dev] {branch_status(root)}",
        f"[git-dev] {summarize_dirty(status_entries)}",
        f"[git-dev] phase: {phase}  rpi: {enforced}",
    ]
    if risks:
        lines.append("[git-dev] 風險：" + "；".join(risks))
    if complex_reasons:
        lines.append("[git-dev] RPI：" + "；".join(complex_reasons))

    cmd_parts: list[str] = []
    for key in ("dev", "test", "deploy"):
        cmd = manifest["commands"].get(key)
        if cmd:
            cmd_parts.append(f"{key}=`{cmd}`")
    if cmd_parts:
        lines.append("[git-dev] 常用命令：" + "；".join(cmd_parts))

    if phase in ("spec", "design"):
        lines.append(f"[git-dev] {phase} 階段：RPI 為 inform-only，可直接作業")
    elif phase == "deploy":
        lines.append("[git-dev] deploy 階段：任何任務均強制 RPI，請先寫 Research receipt 再編輯")

    return emit_message("\n".join(lines), "SessionStart")


def run_post_edit(root: Path, manifest: dict) -> int:
    ensure_runtime_dirs(root)
    touched_abs = touched_files_from_input(root)
    if not touched_abs:
        return 0

    rel_files = [rel_path(root, p) for p in touched_abs]
    rel_files, risks, suggestions, complex_reasons = classify(rel_files, manifest)

    state = read_json(session_state_path(root), {
        "started_at": "", "touched_files": [], "risks": [], "suggestions": [],
    })
    state["touched_files"] = sorted(set(state.get("touched_files", [])) | set(rel_files))
    state["risks"]         = sorted(set(state.get("risks", []))         | set(risks))
    state["suggestions"]   = merge_suggestions(state.get("suggestions", []), suggestions)
    write_json(session_state_path(root), state)

    rpi_state = write_rpi_state(root, manifest, rel_files, risks, suggestions, complex_reasons, "Implement")

    lines = [f"[git-dev] touched {len(rel_files)} 個檔案：{', '.join(rel_files[:5])}"]
    if risks:
        lines.append("[git-dev] 風險：" + "；".join(risks))
    if suggestions:
        lines.append("[git-dev] 建議 verify：" + format_verify_suggestions(manifest, suggestions))

    # Cross-file accumulation: re-classify all session-touched files to surface combination risks
    all_touched = state["touched_files"]
    if len(all_touched) > len(rel_files):
        _, acc_risks, _, _ = classify(all_touched, manifest)
        new_risks = sorted(set(acc_risks) - set(risks))
        if new_risks:
            lines.append("[git-dev] 累積跨檔風險：" + "；".join(new_risks))
            state["risks"] = sorted(set(state["risks"]) | set(acc_risks))
            write_json(session_state_path(root), state)

    if rpi_state["missing_receipts"]:
        needed = ", ".join(rpi_state["missing_receipts"])
        lines.append(
            f"[git-dev] RPI：複雜任務應先補 receipt — "
            f"python3 .agent/scripts/hooks/git-dev-hook.py write-receipt <{needed}> \"...\""
        )
    return emit_message("\n".join(lines))


def run_session_stop(root: Path, manifest: dict) -> int:
    ensure_runtime_dirs(root)
    state = read_json(session_state_path(root), {
        "started_at": "", "touched_files": [], "risks": [], "suggestions": [],
    })
    rpi_state = read_json(rpi_state_path(root), {
        "current_stage": "Research", "missing_receipts": [],
        "complex_reasons": [], "completed_stages": [],
    })
    status_entries = parse_status(root)
    rel_dirty      = [rel_path(root, e["abs_path"]) for e in status_entries if e["exists"]]
    _, current_risks, _, _ = classify(rel_dirty, manifest)

    touched     = state.get("touched_files") or []
    risks       = sorted(set(state.get("risks", [])) | set(current_risks))
    suggestions = merge_suggestions(state.get("suggestions", []), [])
    phase       = manifest["project"]["phase"]

    branch = subprocess.check_output(
        ["git", "-C", str(root), "branch", "--show-current"], text=True,
    ).strip() or "DETACHED"

    if touched:
        completed_str = f"本 session 觸及 {len(touched)} 個檔案：{', '.join(touched[:5])}"
        if len(touched) > 5:
            completed_str += " ..."
    else:
        completed_str = "尚未記錄到本 session 的檔案編輯"

    if rel_dirty:
        completed_str += f"；目前仍有 {len(rel_dirty)} 個 dirty 檔案"

    risk_text   = "；".join(risks) if risks else "目前沒有明確高風險警示"
    verify_text = format_verify_suggestions(manifest, suggestions)

    rpi_text    = rpi_state.get("current_stage", "Research")
    done_stages = rpi_state.get("completed_stages", [])
    if done_stages:
        rpi_text += f"；已完成 {', '.join(done_stages)}"
    if rpi_state.get("missing_receipts"):
        rpi_text += "；缺少 " + ", ".join(rpi_state["missing_receipts"])

    message = "\n".join([
        f"當前目標：branch {branch}（{phase}）",
        f"已完成：{completed_str}",
        f"風險：{risk_text}",
        f"下一個 verify 建議：{verify_text}",
        f"RPI：{rpi_text}",
    ])
    return emit_message(message, "Stop")


def run_write_receipt(root: Path, manifest: dict) -> int:
    stage = sys.argv[2] if len(sys.argv) > 2 else ""
    note  = " ".join(sys.argv[3:]) if len(sys.argv) > 3 else ""

    if stage not in VALID_STAGES:
        return emit_message(
            f"[git-dev] write-receipt: 無效 stage '{stage}'，有效值：{', '.join(VALID_STAGES)}"
        )

    ensure_runtime_dirs(root)

    rpi_state                 = read_json(rpi_state_path(root), {})
    completed: list[str]      = rpi_state.get("completed_stages", [])
    missing:   list[str]      = rpi_state.get("missing_receipts", [])

    if stage not in completed:
        completed.append(stage)
    if stage in missing:
        missing.remove(stage)

    rpi_state["completed_stages"] = completed
    rpi_state["missing_receipts"] = missing
    rpi_state["updated_at"]       = datetime.now(timezone.utc).isoformat()
    write_json(rpi_state_path(root), rpi_state)

    stage_file = runtime_dirs(root)["state"] / f"receipt-{stage.lower()}.md"
    receipt_lines = [
        f"# {stage} Receipt",
        "",
        f"- Written at: {datetime.now(timezone.utc).isoformat()}",
        f"- Phase: {manifest['project']['phase']}",
    ]
    if note:
        receipt_lines.append(f"- Note: {note}")
    stage_file.write_text("\n".join(receipt_lines) + "\n", encoding="utf-8")

    return emit_message(
        f"[git-dev] {stage} receipt 已寫入（{stage_file.name}）；completed: {', '.join(completed)}"
    )


def run_validate_sync(root: Path) -> int:
    shared_dir = root / "agent" / "scripts" / "project-types" / "git-dev"
    if not shared_dir.is_dir():
        return emit_message("[git-dev] validate-sync: 非 dotfiles repo，跳過")

    local_hooks = root / ".agent" / "scripts" / "hooks"
    local_mem   = root / ".agent" / "scripts" / "memory"
    seed_dir    = root / "agent" / "bootstrap" / "project-types" / "git-dev"

    issues: list[str] = []

    # shared runtime hook vs local overlay
    for fname in ("git-dev-hook.py",):
        s = shared_dir / fname
        l = local_hooks / fname
        if not s.is_file():
            issues.append(f"shared/{fname} 不存在")
        elif not l.is_file():
            issues.append(f"local overlay/{fname} 不存在")
        elif s.read_text(encoding="utf-8") != l.read_text(encoding="utf-8"):
            issues.append(f"{fname}: shared 與 local overlay 內容不同步")

    # memory scripts
    for fname in ("capture-commit.py", "review-candidate.py"):
        s = shared_dir / "memory" / fname
        l = local_mem / fname
        if s.is_file() and l.is_file():
            if s.read_text(encoding="utf-8") != l.read_text(encoding="utf-8"):
                issues.append(f"memory/{fname}: shared 與 local 不同步")

    # seed rpi.md vs local rpi.md
    seed_rpi  = seed_dir / ".agent" / "protocols" / "rpi.md"
    local_rpi = root / ".agent" / "protocols" / "rpi.md"
    if seed_rpi.is_file() and local_rpi.is_file():
        if seed_rpi.read_text(encoding="utf-8") != local_rpi.read_text(encoding="utf-8"):
            issues.append("protocols/rpi.md: seed 與 local 不同步")

    if issues:
        return emit_message(
            "[git-dev] validate-sync 發現不同步：\n" + "\n".join(f"  - {i}" for i in issues)
        )
    return emit_message("[git-dev] validate-sync: OK — shared runtime、local overlay、seed 同步")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    root = repo_root()
    if not root:
        return 0

    manifest = load_manifest(root)
    if not manifest:
        return 0

    if mode == "session-start":
        return run_session_start(root, manifest)
    if mode == "post-edit":
        return run_post_edit(root, manifest)
    if mode == "session-stop":
        return run_session_stop(root, manifest)
    if mode == "write-receipt":
        return run_write_receipt(root, manifest)
    if mode == "validate-sync":
        return run_validate_sync(root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
