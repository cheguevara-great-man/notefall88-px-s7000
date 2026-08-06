from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def test_firmware_core_executes_on_native_host(tmp_path: Path) -> None:
    compiler = shutil.which("g++")
    assert compiler is not None, "g++ is required to execute the firmware core tests"
    executable = tmp_path / ("firmware-core-tests.exe" if os.name == "nt" else "firmware-core-tests")
    command = [
        compiler,
        "-std=c++17",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-pedantic",
        "-Ifirmware/include",
        "firmware/native_tests/test_midi_core.cpp",
        "-o",
        str(executable),
    ]
    subprocess.run(command, cwd=ROOT, check=True, text=True)
    completed = subprocess.run(
        [str(executable)], cwd=ROOT, check=True, text=True, capture_output=True
    )
    assert completed.stdout.strip() == "firmware native core: all checks passed"
