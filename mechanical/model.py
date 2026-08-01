"""CadQuery solids and shared piano/LED layout math for NoteFall 88 V0."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cadquery as cq


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = ROOT / "config" / "system.json"


def load_config(path: Path = DEFAULT_CONFIG) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


@dataclass(frozen=True)
class Layout:
    first_note: int
    note_count: int
    row_count: int
    pixels_per_row: int
    led_pitch_mm: float
    octave_span_mm: float
    white_key_pitch_mm: float
    row_pitch_mm: float


def layout_from_config(cfg: dict[str, Any]) -> Layout:
    proto = cfg["prototype"]
    led = cfg["led"]
    return Layout(
        first_note=int(proto["first_midi_note"]),
        note_count=int(proto["note_count"]),
        row_count=int(proto["row_count"]),
        pixels_per_row=int(led["pixels_per_row"]),
        led_pitch_mm=1000.0 / float(led["pixels_per_m"]),
        octave_span_mm=float(proto["octave_span_mm"]),
        white_key_pitch_mm=float(proto["white_key_pitch_mm"]),
        row_pitch_mm=float(proto["row_pitch_mm"]),
    )


# Key-center locations inside a C-to-C octave, in units of one white-key pitch.
# Accidentals use their visual black-key centers. Real instrument calibration can
# override these after M01/M02; the nearest-pixel error is still bounded by 1/2 pitch.
KEY_CENTER_WHITE_PITCH = (
    0.5,  # C
    1.0,  # C#
    1.5,  # D
    2.0,  # D#
    2.5,  # E
    3.5,  # F
    4.0,  # F#
    4.5,  # G
    5.0,  # G#
    5.5,  # A
    6.0,  # A#
    6.5,  # B
)


def note_centers_mm(layout: Layout) -> list[float]:
    if layout.note_count != 12:
        raise ValueError("V0 geometry currently expects one 12-note C-to-B octave")
    left_c_boundary = -layout.octave_span_mm / 2.0
    return [
        left_c_boundary + offset * layout.white_key_pitch_mm
        for offset in KEY_CENTER_WHITE_PITCH
    ]


def led_centers_mm(layout: Layout) -> list[float]:
    span = layout.pixels_per_row * layout.led_pitch_mm
    left_cell_edge = -span / 2.0
    return [
        left_cell_edge + (index + 0.5) * layout.led_pitch_mm
        for index in range(layout.pixels_per_row)
    ]


def logical_to_physical_map(layout: Layout) -> dict[str, Any]:
    led_x = led_centers_mm(layout)
    notes_x = note_centers_mm(layout)
    nearest = [min(range(len(led_x)), key=lambda i: abs(led_x[i] - x)) for x in notes_x]
    errors = [led_x[i] - note_x for i, note_x in zip(nearest, notes_x)]

    rows: list[list[int]] = []
    for row in range(layout.row_count):
        row_map = []
        for pixel_in_row in nearest:
            serpentine_pixel = (
                pixel_in_row if row % 2 == 0 else layout.pixels_per_row - 1 - pixel_in_row
            )
            row_map.append(row * layout.pixels_per_row + serpentine_pixel)
        rows.append(row_map)

    return {
        "schema_version": 1,
        "coordinate_convention": {
            "x": "positive toward treble",
            "y": "row 0 is nearest the player/keybed",
            "origin": "center of the C4-B4 octave coupon",
        },
        "first_midi_note": layout.first_note,
        "note_count": layout.note_count,
        "row_count": layout.row_count,
        "pixels_per_row": layout.pixels_per_row,
        "total_pixels": layout.row_count * layout.pixels_per_row,
        "led_pitch_mm": layout.led_pitch_mm,
        "note_centers_mm": notes_x,
        "led_centers_mm": led_x,
        "nearest_pixel_in_row": nearest,
        "mapping_error_mm": errors,
        "max_abs_mapping_error_mm": max(abs(value) for value in errors),
        "row_directions": ["left_to_right" if row % 2 == 0 else "right_to_left" for row in range(layout.row_count)],
        "physical_pixel_by_row_note": rows,
    }


def _through_hole(x: float, y: float, height: float, diameter: float) -> cq.Workplane:
    return (
        cq.Workplane("XY")
        .center(x, y)
        .circle(diameter / 2.0)
        .extrude(height + 0.4)
        .translate((0, 0, -0.2))
    )


def _cut_fastener_holes(
    solid: cq.Workplane, cfg: dict[str, Any], height: float
) -> cq.Workplane:
    mech = cfg["mechanical"]
    x = float(mech["fastener_x_mm"])
    y = float(mech["fastener_y_mm"])
    diameter = float(mech["fastener_clearance_mm"])
    for sx in (-1.0, 1.0):
        for sy in (-1.0, 1.0):
            solid = solid.cut(_through_hole(sx * x, sy * y, height, diameter))
    return solid


def build_base(cfg: dict[str, Any]) -> cq.Workplane:
    mech = cfg["mechanical"]
    width = float(mech["body_width_mm"])
    depth = float(mech["body_depth_mm"])
    height = float(mech["base_thickness_mm"])
    # Leave at least 0.5 mm of the nominal 0.8 mm pad proud of the plastic so
    # layer-line high spots cannot touch the instrument finish.
    pad_depth = min(0.3, float(mech["silicone_pad_thickness_mm"]))

    base = cq.Workplane("XY").box(width, depth, height, centered=(True, True, False))

    # Captured top pockets for optional steel fender-washer ballast.
    for x in (-55.0, 55.0):
        for y in (-18.0, 18.0):
            cutter = (
                cq.Workplane("XY")
                .center(x, y)
                .circle(12.25)
                .extrude(2.3)
                .translate((0, 0, height - 2.2))
            )
            base = base.cut(cutter)

    # Shallow underside pockets positively locate four silicone isolation pads.
    for x in (-67.0, 67.0):
        for y in (-25.0, 25.0):
            cutter = (
                cq.Workplane("XY")
                .center(x, y)
                .box(28.0, 12.0, pad_depth + 0.2, centered=(True, True, False))
                .translate((0, 0, -0.1))
            )
            base = base.cut(cutter)

    return _cut_fastener_holes(base, cfg, height)


def build_tray(cfg: dict[str, Any]) -> cq.Workplane:
    mech = cfg["mechanical"]
    layout = layout_from_config(cfg)
    width = float(mech["body_width_mm"])
    depth = float(mech["body_depth_mm"])
    floor = float(mech["tray_floor_mm"])
    total_height = float(mech["tray_height_mm"])
    wall = float(mech["outer_wall_mm"])

    tray = cq.Workplane("XY").box(width, depth, floor, centered=(True, True, False))
    outer = (
        cq.Workplane("XY")
        .box(width, depth, total_height - floor, centered=(True, True, False))
        .translate((0, 0, floor))
    )
    inner = (
        cq.Workplane("XY")
        .box(
            width - 2.0 * wall,
            depth - 2.0 * wall,
            total_height - floor + 0.2,
            centered=(True, True, False),
        )
        .translate((0, 0, floor - 0.1))
    )
    tray = tray.union(outer.cut(inner))

    # Low ribs locate strip edges but remain below the LED package top.
    for boundary in (-layout.row_pitch_mm, 0.0, layout.row_pitch_mm):
        rib = (
            cq.Workplane("XY")
            .center(0, boundary)
            .box(width - 2.0 * wall, 0.8, 0.6, centered=(True, True, False))
            .translate((0, 0, floor))
        )
        tray = tray.union(rib)

    # Cable reliefs: input at front-left, then alternating U-turn sides.
    reliefs = [
        (-width / 2.0, -1.5 * layout.row_pitch_mm),
        (width / 2.0, -layout.row_pitch_mm),
        (-width / 2.0, 0.0),
        (width / 2.0, layout.row_pitch_mm),
    ]
    for x, y in reliefs:
        cutter = (
            cq.Workplane("XY")
            .center(x, y)
            .box(5.0, 5.0, total_height - floor + 0.4, centered=(True, True, False))
            .translate((0, 0, floor - 0.2))
        )
        tray = tray.cut(cutter)

    return _cut_fastener_holes(tray, cfg, total_height)


def build_baffle(cfg: dict[str, Any]) -> cq.Workplane:
    mech = cfg["mechanical"]
    layout = layout_from_config(cfg)
    width = float(mech["body_width_mm"])
    depth = float(mech["body_depth_mm"])
    height = float(mech["baffle_height_mm"])
    outer_wall = float(mech["outer_wall_mm"])
    grid_wall = float(mech["grid_wall_mm"])
    cell_span_x = layout.pixels_per_row * layout.led_pitch_mm
    cell_span_y = layout.row_count * layout.row_pitch_mm

    outer = cq.Workplane("XY").box(width, depth, height, centered=(True, True, False))
    aperture = (
        cq.Workplane("XY")
        .box(cell_span_x, cell_span_y, height + 0.4, centered=(True, True, False))
        .translate((0, 0, -0.2))
    )
    baffle = outer.cut(aperture)

    # Pixel boundaries. The outer frame closes the two outermost boundaries.
    left_edge = -cell_span_x / 2.0
    for boundary_index in range(1, layout.pixels_per_row):
        x = left_edge + boundary_index * layout.led_pitch_mm
        wall = (
            cq.Workplane("XY")
            .center(x, 0)
            .box(grid_wall, cell_span_y, height, centered=(True, True, False))
        )
        baffle = baffle.union(wall)

    front_edge = -cell_span_y / 2.0
    for boundary_index in range(1, layout.row_count):
        y = front_edge + boundary_index * layout.row_pitch_mm
        wall = (
            cq.Workplane("XY")
            .center(0, y)
            .box(cell_span_x, grid_wall, height, centered=(True, True, False))
        )
        baffle = baffle.union(wall)

    # A tiny bevel on the upper perimeter reduces sharp handling edges without
    # changing the optical cell dimensions. Fillet failure should not block export.
    try:
        baffle = baffle.edges(">Z").chamfer(min(0.35, outer_wall / 4.0))
    except Exception:
        pass
    return _cut_fastener_holes(baffle, cfg, height)


def build_diffuser(cfg: dict[str, Any]) -> cq.Workplane:
    mech = cfg["mechanical"]
    width = float(mech["body_width_mm"])
    depth = float(mech["body_depth_mm"])
    height = float(mech["diffuser_thickness_mm"])
    diffuser = cq.Workplane("XY").box(width, depth, height, centered=(True, True, False))
    return _cut_fastener_holes(diffuser, cfg, height)


def build_alignment_jig(cfg: dict[str, Any]) -> cq.Workplane:
    mech = cfg["mechanical"]
    layout = layout_from_config(cfg)
    width = float(mech["body_width_mm"])
    finger_length = float(mech["alignment_finger_length_mm"])
    thickness = 1.6
    crossbar_depth = 8.0

    jig = cq.Workplane("XY").box(
        width, crossbar_depth, thickness, centered=(True, True, False)
    )
    for x in (-layout.octave_span_mm / 2.0, layout.octave_span_mm / 2.0):
        finger = (
            cq.Workplane("XY")
            .center(x, -(crossbar_depth + finger_length) / 2.0)
            .box(1.2, finger_length, thickness, centered=(True, True, False))
        )
        tip = (
            cq.Workplane("XY")
            .workplane(offset=0)
            .polyline(
                [
                    (x - 2.5, -crossbar_depth / 2.0 - finger_length),
                    (x + 2.5, -crossbar_depth / 2.0 - finger_length),
                    (x, -crossbar_depth / 2.0 - finger_length - 4.0),
                ]
            )
            .close()
            .extrude(thickness)
        )
        jig = jig.union(finger).union(tip)
    return jig


def build_parts(cfg: dict[str, Any]) -> dict[str, cq.Workplane]:
    return {
        "base": build_base(cfg),
        "tray": build_tray(cfg),
        "baffle": build_baffle(cfg),
        "diffuser": build_diffuser(cfg),
        "alignment_jig": build_alignment_jig(cfg),
    }


def build_assembly(cfg: dict[str, Any], parts: dict[str, cq.Workplane]) -> cq.Assembly:
    mech = cfg["mechanical"]
    z_base = 0.0
    z_tray = float(mech["base_thickness_mm"])
    z_baffle = z_tray + float(mech["tray_height_mm"])
    z_diffuser = z_baffle + float(mech["baffle_height_mm"])
    assembly = cq.Assembly(name="notefall_v0")
    assembly.add(parts["base"], loc=cq.Location((0, 0, z_base)), name="base", color=cq.Color(0.25, 0.25, 0.28))
    assembly.add(parts["tray"], loc=cq.Location((0, 0, z_tray)), name="tray", color=cq.Color(0.08, 0.08, 0.09))
    assembly.add(parts["baffle"], loc=cq.Location((0, 0, z_baffle)), name="baffle", color=cq.Color(0.02, 0.02, 0.02))
    assembly.add(parts["diffuser"], loc=cq.Location((0, 0, z_diffuser)), name="diffuser", color=cq.Color(0.75, 0.9, 1.0, 0.45))
    return assembly
