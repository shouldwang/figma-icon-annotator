#!/usr/bin/env python3

import os
import re
import subprocess
import sys
from pathlib import Path


def repo_root() -> Path:
    output = subprocess.check_output(
        ["git", "rev-parse", "--show-toplevel"],
        text=True,
        stderr=subprocess.DEVNULL,
    )
    return Path(output.strip())


def dotfiles_dir(root: Path) -> str:
    manifest = root / ".agent" / "project.toml"
    match = re.search(r'^dotfiles_dir\s*=\s*"([^"]+)"', manifest.read_text(encoding="utf-8"), re.M)
    if not match:
        raise SystemExit(f"Missing dotfiles_dir in {manifest}")
    return match.group(1)


def main() -> int:
    root = repo_root()
    shared = Path(dotfiles_dir(root)) / "agent" / "scripts" / "project-types" / "git-dev" / "git-dev-hook.py"
    os.execv(sys.executable, [sys.executable, str(shared), *sys.argv[1:]])


if __name__ == "__main__":
    raise SystemExit(main())
