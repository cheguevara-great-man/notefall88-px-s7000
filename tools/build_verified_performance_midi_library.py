#!/usr/bin/env python3
"""Build a small, provenance-first piano performance MIDI library.

This builder deliberately has a tiny allow-list. It copies source MIDI bytes
unchanged; it never renders a score, quantizes, re-times, or synthesizes a
performance. A requested title is emitted as missing unless a specific,
auditable performance MIDI exists in MAESTRO or ASAP.
"""

from __future__ import annotations

import hashlib
import json
import shutil
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import mido


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "piano_beginner_midi_library"
SOURCES = ROOT / ".build" / "verified-midi-sources"
MAESTRO_ROOT = SOURCES / "maestro-v3.0.0" / "maestro-v3.0.0"
ASAP_ROOT = SOURCES / "asap-dataset"
MAESTRO_ARCHIVE = "https://storage.googleapis.com/magentadata/datasets/maestro/v3.0.0/maestro-v3.0.0-midi.zip"
ASAP_REPO = "https://github.com/fosfrancesco/asap-dataset"


@dataclass(frozen=True)
class RequestedWork:
    number: int
    title: str
    composer: str
    category: str
    difficulty: str
    source: str | None = None
    source_path: str | None = None
    source_title: str | None = None


# Every populated source_path was manually verified against the dataset's
# performance-MIDI metadata field. Blank rows are intentionally not guessed
# from similarly named score files or internet MIDI files.
WORKS = (
    RequestedWork(1, "River Flows in You", "Yiruma", "01_Beginner", "入门"),
    RequestedWork(2, "Comptine d'un autre été", "Yann Tiersen", "01_Beginner", "入门"),
    RequestedWork(3, "Kiss The Rain", "Yiruma", "01_Beginner", "入门"),
    RequestedWork(4, "Merry Christmas Mr. Lawrence", "Ryuichi Sakamoto", "01_Beginner", "入门"),
    RequestedWork(5, "Gymnopédie No. 1", "Erik Satie", "01_Beginner", "入门"),
    RequestedWork(6, "Canon in D", "Johann Pachelbel", "02_Intermediate", "初级进阶"),
    RequestedWork(7, "Always With Me (千与千寻)", "Joe Hisaishi", "02_Intermediate", "初级进阶"),
    RequestedWork(8, "Castle in the Sky (天空之城)", "Joe Hisaishi", "02_Intermediate", "初级进阶"),
    RequestedWork(9, "Summer", "Joe Hisaishi", "02_Intermediate", "初级进阶"),
    RequestedWork(10, "Merry Go Round of Life", "Joe Hisaishi", "02_Intermediate", "初级进阶"),
    RequestedWork(11, "Prelude in C Major, BWV 846", "J. S. Bach", "03_Classical", "古典入门", "ASAP performance MIDI", "Bach/Prelude/bwv_846/Shi05M.mid", "Prelude_bwv_846"),
    RequestedWork(12, "Für Elise", "Ludwig van Beethoven", "03_Classical", "古典入门"),
    RequestedWork(13, "Moonlight Sonata, 1st Movement", "Ludwig van Beethoven", "03_Classical", "古典入门"),
    RequestedWork(14, "Prelude Op. 28 No. 4", "Frédéric Chopin", "03_Classical", "古典入门"),
    RequestedWork(15, "Waltz Op. 69 No. 2", "Frédéric Chopin", "03_Classical", "古典入门"),
    RequestedWork(16, "Clair de Lune", "Claude Debussy", "03_Classical", "展示型 / 高级"),
    RequestedWork(17, "Nuvole Bianche", "Ludovico Einaudi", "03_Classical", "展示型 / 高级"),
    RequestedWork(18, "Experience", "Ludovico Einaudi", "03_Classical", "展示型 / 高级"),
    RequestedWork(19, "Nocturne Op. 9 No. 2", "Frédéric Chopin", "03_Classical", "展示型 / 高级", "MAESTRO v3 performance MIDI", "2011/MIDI-Unprocessed_06_R3_2011_MID--AUDIO_R3-D3_05_Track05_wav.midi", "Nocturne Op. 9 No. 2 in E-flat Major"),
    RequestedWork(20, "La Campanella", "Franz Liszt", "03_Classical", "展示型 / 高级", "MAESTRO v3 performance MIDI", "2017/MIDI-Unprocessed_046_PIANO046_MID--AUDIO-split_07-06-17_Piano-e_2-02_wav--3.midi", 'Grandes études de Paganini, No. 3 "La campanella", S.141/3'),
)


def source_file(work: RequestedWork) -> Path:
    if work.source == "MAESTRO v3 performance MIDI":
        return MAESTRO_ROOT / str(work.source_path)
    if work.source == "ASAP performance MIDI":
        return ASAP_ROOT / str(work.source_path)
    raise ValueError(f"Unsupported source for {work.title}: {work.source}")


def source_reference(work: RequestedWork) -> dict[str, str]:
    if work.source == "MAESTRO v3 performance MIDI":
        return {"dataset_url": "https://magenta.withgoogle.com/datasets/maestro", "download_url": MAESTRO_ARCHIVE, "archive_member": str(work.source_path), "license": "CC BY-NC-SA 4.0"}
    if work.source == "ASAP performance MIDI":
        rel = str(work.source_path).replace("\\", "/")
        return {"dataset_url": ASAP_REPO, "download_url": f"https://raw.githubusercontent.com/fosfrancesco/asap-dataset/master/{rel}", "repository_member": rel, "license": "CC BY-NC-SA 4.0"}
    raise ValueError(f"Unsupported source for {work.title}: {work.source}")


def midi_audit(path: Path) -> dict[str, Any]:
    """Read, but never modify, a MIDI to report expressive-event evidence."""
    midi = mido.MidiFile(path)
    velocities: list[int] = []
    sustain_values: list[int] = []
    pedal_controllers: set[int] = set()
    tempo, seconds = 500000, 0.0
    for message in mido.merge_tracks(midi.tracks):
        seconds += mido.tick2second(message.time, midi.ticks_per_beat, tempo)
        if message.type == "set_tempo":
            tempo = message.tempo
        elif message.type == "note_on" and message.velocity > 0:
            velocities.append(message.velocity)
        elif message.type == "control_change" and message.control in (64, 66, 67):
            pedal_controllers.add(message.control)
            if message.control == 64:
                sustain_values.append(message.value)
    distinct = sorted(set(velocities))
    return {
        "midi_format": midi.type, "track_count": len(midi.tracks), "duration_seconds": round(seconds, 3), "note_on_event_count": len(velocities),
        "velocity": {"present": bool(velocities), "distinct_nonzero_values": len(distinct), "minimum": min(distinct) if distinct else None, "maximum": max(distinct) if distinct else None, "varied": len(distinct) > 1},
        "pedal": {"sustain_cc64_present": bool(sustain_values), "sustain_cc64_pressed_values_present": any(value >= 64 for value in sustain_values), "controllers_present": sorted(pedal_controllers)},
    }


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def slug(work: RequestedWork) -> str:
    safe = "".join(char if char.isalnum() else "_" for char in work.title)
    return f"{work.number:02d}_{safe}".rstrip("_")


def clean_generated_content() -> None:
    for category in ("01_Beginner", "02_Intermediate", "03_Classical"):
        directory = OUT / category
        directory.mkdir(parents=True, exist_ok=True)
        for item in directory.glob("[0-9][0-9]_*"):
            if item.is_dir():
                shutil.rmtree(item)


def write_readme(records: list[dict[str, Any]]) -> None:
    lines = [
        "# Verified human-performance piano MIDI library", "",
        "本目录只收录可核验的真人演奏 MIDI。文件均为原始 performance MIDI 的字节复制：没有由乐谱/MusicXML 转换、量化、重定时或 AI 转录。", "",
        "## 使用方式", "", "将需要的 `performance.mid` 导入 NoteFall Studio。不要把本目录中的元数据当成乐谱；它只记录演奏来源和审计结果。", "",
        "## 结果", "", "| 曲名 | 来源 | 真人确认 | velocity | pedal | 难度 |", "| --- | --- | --- | --- | --- | --- |",
    ]
    for record in records:
        source = record["source"] if record["available"] else "not_found_in_verified_performance_dataset"
        verified = "是" if record["available"] else "否（未收录）"
        velocity = "是" if record.get("audit", {}).get("velocity", {}).get("present") else "—"
        pedal = "是" if record.get("audit", {}).get("pedal", {}).get("sustain_cc64_present") else "—"
        lines.append(f"| {record['number']:02d}. {record['title']} | {source} | {verified} | {velocity} | {pedal} | {record['difficulty']} |")
    lines += ["", "## 严格筛选规则", "", "- **MAESTRO v3**：Yamaha Disklavier 对真人钢琴家演奏的高精度 MIDI 记录，优先使用。", "- **ASAP**：只允许其 `metadata.csv` 中 `midi_performance` 字段指定的文件；绝不使用同目录的 `midi_score.mid` 或 MusicXML。", "- **PianoCoRe**：已核查，但其当前公开页说明材料仅限审稿过程、不得分发/使用；因此本库不采用其 demo。", "- 未明确存在于上述可用且可验证来源的曲目统一标记为 `not_found_in_verified_performance_dataset`，不以任何其他 MIDI 替代。", "", "## 文件与可复核性", "", "每个收录曲目目录含 `performance.mid` 和 `metadata.json`。`metadata.json` 给出数据集、原始成员路径、下载链接、SHA-256，以及对音符力度和 CC64 延音踏板的实际审计。", "", "## 许可与归属", "", "收录 MIDI 保留上游的 **CC BY-NC-SA 4.0** 许可：仅限非商业使用；若再分发，必须保留归属、许可和相同方式共享。MAESTRO 归属 Google LLC / International Piano-e-Competition；ASAP 归属其数据集作者。详见各 `metadata.json` 和官方数据集页面。", "", "生成器：[`tools/build_verified_performance_midi_library.py`](../tools/build_verified_performance_midi_library.py)。", ""]
    (OUT / "README.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    if not MAESTRO_ROOT.is_dir() or not ASAP_ROOT.is_dir():
        raise SystemExit("Missing verified source cache. Download MAESTRO v3 MIDI and clone ASAP first.")
    clean_generated_content()
    records: list[dict[str, Any]] = []
    for work in WORKS:
        record = asdict(work)
        if work.source is None:
            target_dir = OUT / work.category / slug(work)
            target_dir.mkdir(parents=True, exist_ok=True)
            record.update({
                "available": False,
                "status": "not_found_in_verified_performance_dataset",
                "source_dataset": None,
                "download_link": None,
                "human_performance_confirmation": False,
                "velocity": None,
                "pedal": None,
                "reason": "No exact, usable human-performance MIDI found in MAESTRO v3 or ASAP; PianoCoRe was checked but is not currently usable/distributable.",
            })
            (target_dir / "metadata.json").write_text(
                json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
            records.append(record)
            continue
        original = source_file(work)
        if not original.is_file():
            raise FileNotFoundError(original)
        target_dir = OUT / work.category / slug(work)
        target_dir.mkdir(parents=True, exist_ok=True)
        copied = target_dir / "performance.mid"
        shutil.copy2(original, copied)
        record.update({
            "available": True, "status": "verified_human_performance_midi",
            "human_performance_confirmation": "MAESTRO: Yamaha Disklavier capture of a pianist performance" if work.source.startswith("MAESTRO") else "ASAP metadata.csv: midi_performance (not midi_score)",
            "source_reference": source_reference(work), "local_file": copied.relative_to(OUT).as_posix(), "sha256": sha256(copied), "audit": midi_audit(copied),
        })
        (target_dir / "metadata.json").write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        records.append(record)
    (OUT / "manifest.json").write_text(json.dumps({"schema": 1, "records": records}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_readme(records)
    print(f"Built {sum(record['available'] for record in records)}/{len(records)} verified performance MIDI entries in {OUT}")


if __name__ == "__main__":
    main()
