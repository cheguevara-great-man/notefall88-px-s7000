import gzip
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "firmware" / "data"


def test_embedded_web_assets_are_gzipped_and_resolvable() -> None:
    html = (DATA / "index.html").read_text(encoding="utf-8")
    entry_assets = re.findall(r"(?:src|href)=\"\.?/?(assets/[^\"]+)\"", html)
    assert entry_assets

    compressed = sorted((DATA / "assets").glob("*.gz"))
    assert compressed
    assert not list((DATA / "assets").glob("*.js"))
    assert not list((DATA / "assets").glob("*.css"))

    for relative in entry_assets:
        assert not (DATA / relative).exists()
        assert (DATA / f"{relative}.gz").exists()

    for path in compressed:
        assert len(path.name.encode("utf-8")) <= 31
        assert gzip.decompress(path.read_bytes())
