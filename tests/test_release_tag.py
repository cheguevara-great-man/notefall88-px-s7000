import pytest
from pathlib import Path

from scripts.verify_release_tag import verify_release_tag


ROOT = Path(__file__).resolve().parents[1]


def test_release_tag_matches_firmware_version_and_classifies_rc() -> None:
    assert verify_release_tag("v0.7.0-rc.1", "0.7.0") is True
    assert verify_release_tag("v0.7.0", "0.7.0") is False


@pytest.mark.parametrize("tag", ["0.7.0", "v0.7", "v0.7.0-beta.1", "v0.7.0-rc.0"])
def test_release_tag_rejects_ambiguous_names(tag: str) -> None:
    with pytest.raises(ValueError):
        verify_release_tag(tag, "0.7.0")


def test_release_tag_rejects_version_drift() -> None:
    with pytest.raises(ValueError, match="does not match"):
        verify_release_tag("v0.6.9-rc.1", "0.7.0")


def test_release_workflow_cannot_publish_raw_images_or_mislabel_rc() -> None:
    workflow = (ROOT / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8")
    assert "python scripts/verify_release_tag.py" in workflow
    assert 'test -f "docs/releases/${GITHUB_REF_NAME}.md"' in workflow
    assert "release-work/firmware.bin" in workflow
    assert "release-work/littlefs.bin" in workflow
    assert "cp ~/.platformio/build/notefall88/esp32-s3-devkitc-1-n8r8/firmware.bin dist/" not in workflow
    assert "--notes-file" in workflow
    assert "--prerelease" in workflow
    assert "npm run smoke:browser" in workflow
