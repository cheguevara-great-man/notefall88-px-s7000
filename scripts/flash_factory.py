"""Verify and flash a NoteFall factory bundle extracted from GitHub Releases."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path


EXPECTED_BOARD = "esp32-s3-devkitc-1-n8r8"


def load_verified_image(directory: Path) -> tuple[Path, dict[str, object]]:
    manifest_path = directory / "factory-manifest.json"
    if not manifest_path.is_file():
        raise ValueError("factory-manifest.json 不存在；请先完整解压发布 ZIP")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("board") != EXPECTED_BOARD:
        raise ValueError("该发布包不是为乐鑫 ESP32-S3-DevKitC-1 N8R8 制作的")
    record = manifest.get("factoryImage")
    if not isinstance(record, dict) or not isinstance(record.get("name"), str):
        raise ValueError("发布清单缺少 factoryImage")
    image = directory / record["name"]
    if not image.is_file():
        raise ValueError(f"{record['name']} 不存在")
    content = image.read_bytes()
    if len(content) != record.get("bytes"):
        raise ValueError("factory.bin 大小与发布清单不一致")
    if hashlib.sha256(content).hexdigest() != record.get("sha256"):
        raise ValueError("factory.bin SHA-256 校验失败；不要烧录该文件")
    return image, manifest


def esptool_commands(port: str, image: Path) -> list[list[str]]:
    common = [sys.executable, "-m", "esptool", "--chip", "esp32s3", "--port", port]
    return [
        [*common, "erase_flash"],
        [
            *common,
            "--before", "default_reset",
            "--after", "hard_reset",
            "write_flash",
            "--flash_mode", "qio",
            "--flash_freq", "80m",
            "--flash_size", "8MB",
            "0x0", str(image),
        ],
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description="首次烧录 NoteFall 88 N8R8 控制器")
    parser.add_argument("--port", required=True, help="Windows 例如 COM5；Linux/macOS 例如 /dev/ttyUSB0")
    parser.add_argument("--yes", action="store_true", help="不再要求输入 ERASE 确认")
    parser.add_argument("--dry-run", action="store_true", help="只校验并显示命令，不接触设备")
    args = parser.parse_args()

    directory = Path(__file__).resolve().parent
    image, manifest = load_verified_image(directory)
    commands = esptool_commands(args.port, image)
    print(
        f"已验证 NoteFall {manifest['firmwareVersion']} / 协议 v{manifest['protocol']}，"
        f"目标板 {manifest['board']}。"
    )
    for command in commands:
        print(" ".join(command))
    if args.dry_run:
        return
    if importlib.util.find_spec("esptool") is None:
        raise SystemExit("缺少 esptool；请先执行：python -m pip install esptool==4.5.1")
    if not args.yes and input("这会清除该开发板的全部 Flash。确认端口无误后输入 ERASE：").strip() != "ERASE":
        raise SystemExit("已取消，未写入设备")
    for command in commands:
        subprocess.run(command, check=True)
    print("烧录完成。断开电脑前请等待开发板重启，然后按 FLASHING.md 连接 NoteFall-88。")


if __name__ == "__main__":
    main()
