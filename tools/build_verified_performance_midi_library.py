#!/usr/bin/env python3
"""Build a small, provenance-first piano performance MIDI library.

This builder deliberately has a tiny allow-list. It copies source MIDI bytes
unchanged; it never renders a score, quantizes, re-times, or synthesizes a
performance. A requested title is emitted as missing unless a specific,
auditable, directly captured performance MIDI exists in an approved source.
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
PIANOVAM_ROOT = SOURCES / "pianovam" / "MIDI"
SMD_ROOT = SOURCES / "smd" / "MIDI"
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
    is_bonus: bool = False


# Every populated source_path was manually verified against either a dataset's
# performance-MIDI metadata field or its direct-digital-piano capture statement.
# Blank rows are intentionally not guessed from similarly named score files or
# internet MIDI files.
WORKS = (
    RequestedWork(1, "River Flows in You", "Yiruma", "01_Beginner", "入门"),
    RequestedWork(2, "Comptine d'un autre été", "Yann Tiersen", "01_Beginner", "入门"),
    RequestedWork(3, "Kiss The Rain", "Yiruma", "01_Beginner", "入门", "PianoVAM v1 direct digital-piano performance MIDI", "2024-02-17_21-44-37.mid", "Kiss The Rain — Changyun (Beginner)"),
    RequestedWork(4, "Merry Christmas Mr. Lawrence", "Ryuichi Sakamoto", "01_Beginner", "入门"),
    RequestedWork(5, "Gymnopédie No. 1", "Erik Satie", "01_Beginner", "入门", "PianoVAM v1 direct digital-piano performance MIDI", "2024-09-05_13-25-10.mid", "Gymnopedie No.1 — Hyunsung (Beginner)"),
    RequestedWork(6, "Canon in D", "Johann Pachelbel", "02_Intermediate", "初级进阶"),
    RequestedWork(7, "Always With Me (千与千寻)", "Joe Hisaishi", "02_Intermediate", "初级进阶", "PianoVAM v1 direct digital-piano performance MIDI", "2024-09-05_21-04-38.mid", "Always with me — jiwoo (Beginner)"),
    RequestedWork(8, "Castle in the Sky (天空之城)", "Joe Hisaishi", "02_Intermediate", "初级进阶"),
    RequestedWork(9, "Summer", "Joe Hisaishi", "02_Intermediate", "初级进阶", "PianoVAM v1 direct digital-piano performance MIDI", "2024-09-05_20-46-25.mid", "Summer — Yujeong (Intermediate)"),
    RequestedWork(10, "Merry Go Round of Life", "Joe Hisaishi", "02_Intermediate", "初级进阶"),
    RequestedWork(11, "Prelude in C Major, BWV 846", "J. S. Bach", "03_Classical", "古典入门", "ASAP performance MIDI", "Bach/Prelude/bwv_846/Shi05M.mid", "Prelude_bwv_846"),
    RequestedWork(12, "Für Elise", "Ludwig van Beethoven", "03_Classical", "古典入门", "PianoVAM v1 direct digital-piano performance MIDI", "2024-09-04_21-44-42.mid", "Fur Elise — Junhyung (Advanced)"),
    RequestedWork(13, "Moonlight Sonata, 1st Movement", "Ludwig van Beethoven", "03_Classical", "古典入门"),
    RequestedWork(14, "Prelude Op. 28 No. 4", "Frédéric Chopin", "03_Classical", "古典入门", "SMD direct Yamaha Disklavier performance MIDI", "Chopin_Op028-04_003_20100611-SMD.mid", "Prelude Op. 28 No. 4 — SMD pianist 003"),
    RequestedWork(15, "Waltz Op. 69 No. 2", "Frédéric Chopin", "03_Classical", "古典入门"),
    RequestedWork(16, "Clair de Lune", "Claude Debussy", "03_Classical", "展示型 / 高级", "PianoVAM v1 direct digital-piano performance MIDI", "2024-02-15_21-40-43.mid", "Clair de lune — Doha (Intermediate)"),
    RequestedWork(17, "Nuvole Bianche", "Ludovico Einaudi", "03_Classical", "展示型 / 高级"),
    RequestedWork(18, "Experience", "Ludovico Einaudi", "03_Classical", "展示型 / 高级"),
    RequestedWork(19, "Nocturne Op. 9 No. 2", "Frédéric Chopin", "03_Classical", "展示型 / 高级", "MAESTRO v3 performance MIDI", "2011/MIDI-Unprocessed_06_R3_2011_MID--AUDIO_R3-D3_05_Track05_wav.midi", "Nocturne Op. 9 No. 2 in E-flat Major"),
    RequestedWork(20, "La Campanella", "Franz Liszt", "03_Classical", "展示型 / 高级", "MAESTRO v3 performance MIDI", "2017/MIDI-Unprocessed_046_PIANO046_MID--AUDIO-split_07-06-17_Piano-e_2-02_wav--3.midi", 'Grandes études de Paganini, No. 3 "La campanella", S.141/3'),
    # Carefully selected extras: all direct, named PianoVAM captures. Canon in
    # C is intentionally an extra, not a false substitution for Canon in D.
    RequestedWork(1, "Canon in C (verified alternate arrangement)", "Johann Pachelbel", "01_Beginner", "入门", "PianoVAM v1 direct digital-piano performance MIDI", "2024-09-05_21-01-27.mid", "Canon in C — jiwoo (Beginner)", True),
    RequestedWork(2, "My Neighbor Totoro Ending", "Azumi Inoue", "01_Beginner", "入门", "PianoVAM v1 direct digital-piano performance MIDI", "2024-09-05_21-26-38.mid", "Tonari no Totoro ending — jiwoo (Beginner)", True),
    RequestedWork(3, "Surprise Symphony (piano arrangement)", "Joseph Haydn", "01_Beginner", "入门", "PianoVAM v1 direct digital-piano performance MIDI", "2024-09-04_17-07-59.mid", "Surprise Symphony — jiwoo (Beginner)", True),
    RequestedWork(4, "Home, Sweet Home", "Henry Bishop", "01_Beginner", "入门", "PianoVAM v1 direct digital-piano performance MIDI", "2024-09-04_17-02-04.mid", "Home, Sweet Home — jiwoo (Beginner)", True),
    RequestedWork(5, "Stay in Memory", "Yiruma", "02_Intermediate", "初级进阶", "PianoVAM v1 direct digital-piano performance MIDI", "2024-09-02_15-26-39.mid", "Stay in memory — Yujeong (Intermediate)", True),
    RequestedWork(6, "Ballade Pour Adeline", "Richard Clayderman", "02_Intermediate", "初级进阶", "PianoVAM v1 direct digital-piano performance MIDI", "2024-09-05_21-13-49.mid", "Ballade Pour Adeline — Yujeong (Intermediate)", True),
    RequestedWork(7, "The Blue Danube (beginner piano arrangement)", "Johann Strauss II", "01_Beginner", "入门", "PianoVAM v1 direct digital-piano performance MIDI", "2024-09-04_16-13-44.mid", "The Blue Danube — jiwoo (Beginner)", True),
    RequestedWork(8, "Sonatina Op. 36 (short classical study)", "Muzio Clementi", "03_Classical", "古典入门", "PianoVAM v1 direct digital-piano performance MIDI", "2024-09-02_18-25-31.mid", "Sonatine Op.36 — Junhyung (Advanced performer; beginner repertoire)", True),
    RequestedWork(9, "Mozart Sonata K. 545 (accessible classical sonata)", "W. A. Mozart", "03_Classical", "初级进阶", "PianoVAM v1 direct digital-piano performance MIDI", "2024-09-02_18-29-40.mid", "Sonata K.545 — Junhyung (Advanced performer; intermediate repertoire)", True),
    RequestedWork(10, "Antifreeze", "Baek Yerin", "02_Intermediate", "初级进阶", "PianoVAM v1 direct digital-piano performance MIDI", "2024-09-05_20-51-00.mid", "Antifreeze — Yujeong (Intermediate)", True),
    RequestedWork(11, "This Is the Moment", "Frank Wildhorn", "02_Intermediate", "初级进阶", "PianoVAM v1 direct digital-piano performance MIDI", "2024-09-05_21-07-35.mid", "This is the moment — Yujeong (Intermediate)", True),
)


def source_file(work: RequestedWork) -> Path:
    if work.source == "MAESTRO v3 performance MIDI":
        return MAESTRO_ROOT / str(work.source_path)
    if work.source == "ASAP performance MIDI":
        return ASAP_ROOT / str(work.source_path)
    if work.source == "PianoVAM v1 direct digital-piano performance MIDI":
        return PIANOVAM_ROOT / str(work.source_path)
    if work.source == "SMD direct Yamaha Disklavier performance MIDI":
        return SMD_ROOT / str(work.source_path)
    raise ValueError(f"Unsupported source for {work.title}: {work.source}")


def source_reference(work: RequestedWork) -> dict[str, str]:
    if work.source == "MAESTRO v3 performance MIDI":
        return {"dataset_url": "https://magenta.withgoogle.com/datasets/maestro", "download_url": MAESTRO_ARCHIVE, "archive_member": str(work.source_path), "license": "CC BY-NC-SA 4.0"}
    if work.source == "ASAP performance MIDI":
        rel = str(work.source_path).replace("\\", "/")
        return {"dataset_url": ASAP_REPO, "download_url": f"https://raw.githubusercontent.com/fosfrancesco/asap-dataset/master/{rel}", "repository_member": rel, "license": "CC BY-NC-SA 4.0"}
    if work.source == "PianoVAM v1 direct digital-piano performance MIDI":
        member = str(work.source_path)
        return {"dataset_url": "https://huggingface.co/datasets/PianoVAM/PianoVAM_v1", "download_url": f"https://huggingface.co/datasets/PianoVAM/PianoVAM_v1/resolve/main/MIDI/{member}?download=true", "repository_member": f"MIDI/{member}", "license": "CC BY-NC-SA 4.0"}
    if work.source == "SMD direct Yamaha Disklavier performance MIDI":
        member = str(work.source_path)
        return {"dataset_url": "https://www.audiolabs-erlangen.de/resources/MIR/SMD/midi_version_0", "download_url": f"https://www.audiolabs-erlangen.de/content/resources/MIR/SMD/02_midi/data/midi/{member}", "repository_member": f"02_midi/data/midi/{member}", "license": "CC BY-NC-SA 3.0"}
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
    prefix = f"bonus_{work.number:02d}" if work.is_bonus else f"{work.number:02d}"
    return f"{prefix}_{safe}".rstrip("_")


def clean_generated_content() -> None:
    for category in ("01_Beginner", "02_Intermediate", "03_Classical"):
        directory = OUT / category
        directory.mkdir(parents=True, exist_ok=True)
        for item in list(directory.glob("[0-9][0-9]_*")) + list(directory.glob("bonus_[0-9][0-9]_*")):
            if item.is_dir():
                shutil.rmtree(item)


def write_readme(records: list[dict[str, Any]]) -> None:
    lines = [
        "# Verified human-performance piano MIDI library", "",
        "本目录只收录可核验的真人演奏 MIDI。文件均为原始 performance MIDI 的字节复制：没有由乐谱/MusicXML 转换、量化、重定时或 AI 转录。", "",
        "## 使用方式", "", "将需要的 `performance.mid` 导入 NoteFall Studio。不要把本目录中的元数据当成乐谱；它只记录演奏来源和审计结果。", "",
        "## 结果", "", "| 曲名 | 来源 | 真人确认 | velocity | pedal | 难度 |", "| --- | --- | --- | --- | --- | --- |",
    ]
    for record in (record for record in records if not record["is_bonus"]):
        source = record["source"] if record["available"] else "not_found_in_verified_performance_dataset"
        verified = "是" if record["available"] else "否（未收录）"
        velocity = "是" if record.get("audit", {}).get("velocity", {}).get("present") else "—"
        pedal = "是" if record.get("audit", {}).get("pedal", {}).get("sustain_cc64_present") else "—"
        lines.append(f"| {record['number']:02d}. {record['title']} | {source} | {verified} | {velocity} | {pedal} | {record['difficulty']} |")
    lines += ["", "## 额外适合当前阶段的真人演奏曲目", "", "| 曲名 | 来源 | 真人确认 | velocity | pedal | 难度 |", "| --- | --- | --- | --- | --- | --- |"]
    for record in (record for record in records if record["is_bonus"]):
        velocity = "是" if record["audit"]["velocity"]["present"] else "否"
        pedal = "是" if record["audit"]["pedal"]["sustain_cc64_present"] else "无 CC64"
        lines.append(f"| B{record['number']:02d}. {record['title']} | {record['source']} | 是 | {velocity} | {pedal} | {record['difficulty']} |")
    lines += ["", "## 严格筛选规则", "", "- **MAESTRO v3**：Yamaha Disklavier 对真人钢琴家演奏的高精度 MIDI 记录。", "- **ASAP**：只允许其 `metadata.csv` 中 `midi_performance` 字段指定的文件；绝不使用同目录的 `midi_score.mid` 或 MusicXML。", "- **PianoVAM v1**：只使用其标为从数码钢琴直接录得的 ground-truth performance MIDI，且有同步音频/视频与演奏者元数据。", "- **SMD**：只使用 Saarland Music Data 中学生在 Yamaha Disklavier 上演奏时直接捕获的 MIDI；原站同时提供同步音频。", "- **PianoCoRe 1.0（正式 TISMIR 版）**：已正式发布，但只接受其元数据中 `is_transcription=false` 的原始 performance MIDI。已审计正式版 250,046 条记录：仅 1,066 条满足该条件，且全部来自 ASAP 的 Disklavier 直录；Aria-MIDI、ATEPP、GiantMIDI-Piano 等标记为转录的条目一律排除。", "- 未明确存在于上述可用且可验证来源的曲目统一标记为 `not_found_in_verified_performance_dataset`，不以任何其他 MIDI 替代。", "", "## 文件与可复核性", "", "每个收录曲目目录含 `performance.mid` 和 `metadata.json`。`metadata.json` 给出数据集、原始成员路径、下载链接、SHA-256，以及对音符力度和 CC64 延音踏板的实际审计。", "", "## 许可与归属", "", "收录 MIDI 保留上游的 CC BY-NC-SA 许可：仅限非商业使用；若再分发，必须保留归属、许可和相同方式共享。MAESTRO 归属 Google LLC / International Piano-e-Competition；ASAP、PianoVAM 与 SMD 归属各数据集作者。详见各 `metadata.json` 和官方数据集页面。", "", "生成器：[`tools/build_verified_performance_midi_library.py`](../tools/build_verified_performance_midi_library.py)。", ""]
    (OUT / "README.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    if not MAESTRO_ROOT.is_dir() or not ASAP_ROOT.is_dir() or not PIANOVAM_ROOT.is_dir():
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
                "reason": "No exact, usable directly captured human-performance MIDI found in MAESTRO v3, ASAP, PianoVAM v1, SMD, or the is_transcription=false subset of formally released PianoCoRe 1.0.",
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
            "human_performance_confirmation": "MAESTRO: Yamaha Disklavier capture of a pianist performance" if work.source.startswith("MAESTRO") else ("ASAP metadata.csv: midi_performance (not midi_score)" if work.source.startswith("ASAP") else "PianoVAM: ground-truth performance MIDI recorded directly from digital piano, with synchronized audio/video and performer metadata"),
            "source_reference": source_reference(work), "local_file": copied.relative_to(OUT).as_posix(), "sha256": sha256(copied), "audit": midi_audit(copied),
        })
        (target_dir / "metadata.json").write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        records.append(record)
    (OUT / "manifest.json").write_text(json.dumps({"schema": 1, "records": records}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_readme(records)
    print(f"Built {sum(record['available'] for record in records)}/{len(records)} verified performance MIDI entries in {OUT}")


if __name__ == "__main__":
    main()
