#!/usr/bin/env python3
"""Start the FastAPI backend with reload. Works on Windows, macOS, and Linux."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"

if sys.platform == "win32":
    venv_python = ROOT / ".venv" / "Scripts" / "python.exe"
else:
    venv_python = ROOT / ".venv" / "bin" / "python"

python = venv_python if venv_python.is_file() else Path(sys.executable)

parts = [str(ROOT), str(BACKEND)]
existing = os.environ.get("PYTHONPATH", "")
if existing:
    parts.append(existing)
os.environ["PYTHONPATH"] = os.pathsep.join(parts)

cmd = [
    str(python),
    "-m",
    "uvicorn",
    "app.main:app",
    "--reload",
    "--host",
    "0.0.0.0",
    "--port",
    "8000",
]
raise SystemExit(subprocess.call(cmd, cwd=BACKEND))
