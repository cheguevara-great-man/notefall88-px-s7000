import re
from pathlib import Path
from urllib.parse import unquote


ROOT = Path(__file__).resolve().parents[1]
MARKDOWN_LINK = re.compile(r"(?<!!)\[[^\]]+\]\(([^)]+)\)")


def markdown_files() -> list[Path]:
    return [ROOT / "README.md", *sorted((ROOT / "docs").rglob("*.md"))]


def test_all_local_markdown_links_resolve() -> None:
    missing: list[str] = []
    for document in markdown_files():
        text = document.read_text(encoding="utf-8")
        for raw_target in MARKDOWN_LINK.findall(text):
            target = raw_target.strip().strip("<>").split(maxsplit=1)[0]
            if not target or target.startswith(("#", "http://", "https://", "mailto:")):
                continue
            relative = unquote(target.split("#", 1)[0])
            resolved = (document.parent / relative).resolve()
            if not resolved.exists():
                missing.append(f"{document.relative_to(ROOT)} -> {target}")
    assert missing == []


def test_first_build_handoff_links_every_manufacturing_source() -> None:
    handoff = (ROOT / "docs" / "first-build.md").read_text(encoding="utf-8")
    for required in (
        "bom.csv",
        "harness.csv",
        "wiring-harness.svg",
        "vendor-order-template.md",
        "decisions/001-native-usb-host-and-vbus.md",
        "flashing.md",
    ):
        assert required in handoff
