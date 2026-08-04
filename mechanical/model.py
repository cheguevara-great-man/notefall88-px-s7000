"""CadQuery models for the final single-strip NoteFall 88 rail and controller case."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import cadquery as cq


@dataclass(frozen=True)
class RailDimensions:
    total_length: float
    segment_count: int
    segment_length: float
    depth: float
    height: float
    floor: float
    wall: float
    strip_width: float
    strip_clearance: float
    diffuser_thickness: float


def rail_dimensions(config: dict[str, Any]) -> RailDimensions:
    mech = config["mechanical"]
    led = config["led"]
    total = float(mech["rail_total_length_mm"])
    count = int(mech["rail_segment_count"])
    return RailDimensions(
        total_length=total,
        segment_count=count,
        segment_length=total / count,
        depth=float(mech["rail_depth_mm"]),
        height=float(mech["rail_height_mm"]),
        floor=float(mech["rail_floor_mm"]),
        wall=float(mech["rail_wall_mm"]),
        strip_width=float(led["pcb_width_mm"]),
        strip_clearance=float(mech["strip_clearance_mm"]),
        diffuser_thickness=float(mech["diffuser_thickness_mm"]),
    )


def _connector_tongues(d: RailDimensions) -> cq.Workplane:
    tongue_length = 3.0
    tongue_width = 2.2
    tongue_height = min(1.1, d.floor * 0.75)
    x = d.segment_length / 2.0 + tongue_length / 2.0
    tongues = cq.Workplane("XY")
    for y in (-d.depth * 0.28, d.depth * 0.28):
        tongues = tongues.union(
            cq.Workplane("XY")
            .center(x, y)
            .box(tongue_length, tongue_width, tongue_height, centered=(True, True, False))
        )
    return tongues


def _build_rail_segment(
    config: dict[str, Any], *, left_socket: bool, right_tongue: bool
) -> cq.Workplane:
    """Build one rail body with only the joints needed at its position."""
    d = rail_dimensions(config)
    inner = d.strip_width + d.strip_clearance
    wall_center = inner / 2.0 + d.wall / 2.0

    rail = cq.Workplane("XY").box(
        d.segment_length, d.depth, d.floor, centered=(True, True, False)
    )
    for y in (-wall_center, wall_center):
        rail = rail.union(
            cq.Workplane("XY")
            .center(0, y)
            .box(d.segment_length, d.wall, d.height, centered=(True, True, False))
        )

    # Narrow inward lips retain a flexible 0.8 mm diffuser without glue.
    lip_width = 0.65
    lip_height = 0.55
    for y in (-(inner / 2.0 - lip_width / 2.0), inner / 2.0 - lip_width / 2.0):
        rail = rail.union(
            cq.Workplane("XY")
            .center(0, y)
            .box(d.segment_length, lip_width, lip_height, centered=(True, True, False))
            .translate((0, 0, d.height - lip_height))
        )

    if right_tongue:
        rail = rail.union(_connector_tongues(d))

    # Matching cavities are inside the left end. A 0.20 mm radial allowance is
    # deliberately generous for consumer FDM printers.
    if left_socket:
        cavity_length = 3.2
        cavity_width = 2.6
        cavity_height = min(1.35, d.floor - 0.05)
        x = -d.segment_length / 2.0 + cavity_length / 2.0
        for y in (-d.depth * 0.28, d.depth * 0.28):
            rail = rail.cut(
                cq.Workplane("XY")
                .center(x, y)
                .box(cavity_length, cavity_width, cavity_height, centered=(True, True, False))
            )

    # Two cable-tie slots per segment also accept a temporary paper alignment strip.
    for x in (-d.segment_length * 0.35, d.segment_length * 0.35):
        slot = (
            cq.Workplane("XY")
            .center(x, 0)
            .rect(5.0, 1.4)
            .extrude(d.floor + 0.4)
            .translate((0, 0, -0.2))
        )
        rail = rail.cut(slot)
    return rail


def build_rail_segment(config: dict[str, Any]) -> cq.Workplane:
    """Interior segment: female joint at left, male joint at right."""
    return _build_rail_segment(config, left_socket=True, right_tongue=True)


def build_rail_left_end(config: dict[str, Any]) -> cq.Workplane:
    """Flush left terminal segment with only a male joint at its right."""
    return _build_rail_segment(config, left_socket=False, right_tongue=True)


def build_rail_right_end(config: dict[str, Any]) -> cq.Workplane:
    """Flush right terminal segment with only a female joint at its left."""
    return _build_rail_segment(config, left_socket=True, right_tongue=False)


def build_diffuser_segment(config: dict[str, Any]) -> cq.Workplane:
    d = rail_dimensions(config)
    width = d.strip_width + d.strip_clearance + 0.25
    length = d.segment_length - 0.6
    return cq.Workplane("XY").box(
        length, width, d.diffuser_thickness, centered=(True, True, False)
    )


def build_controller_tray(config: dict[str, Any]) -> cq.Workplane:
    """Universal ventilated tray; boards are retained by zip ties, not exact hole spacing."""
    length, width, floor, wall, height = 106.0, 62.0, 2.0, 1.8, 18.0
    tray = cq.Workplane("XY").box(length, width, floor, centered=(True, True, False))
    outer = (
        cq.Workplane("XY")
        .box(length, width, height, centered=(True, True, False))
    )
    inner = (
        cq.Workplane("XY")
        .box(length - 2 * wall, width - 2 * wall, height, centered=(True, True, False))
        .translate((0, 0, floor))
    )
    tray = tray.union(outer.cut(inner))

    for x in (-34.0, -16.0, 16.0, 34.0):
        for y in (-18.0, 18.0):
            slot = (
                cq.Workplane("XY")
                .center(x, y)
                .rect(8.0, 2.4)
                .extrude(floor + 0.4)
                .translate((0, 0, -0.2))
            )
            tray = tray.cut(slot)

    # USB and power openings are oversized to tolerate module variants.
    for x in (-length / 2.0, length / 2.0):
        opening = (
            cq.Workplane("YZ")
            .rect(18.0, 10.0)
            .extrude(wall + 0.5)
            .translate((x - (wall + 0.5) / 2.0 if x < 0 else x - 0.25, 0, 8.5))
        )
        tray = tray.cut(opening)
    return tray


def build_controller_lid(config: dict[str, Any]) -> cq.Workplane:
    length, width, thickness = 106.4, 62.4, 1.8
    lid = cq.Workplane("XY").box(length, width, thickness, centered=(True, True, False))
    for x in (-30.0, -15.0, 0.0, 15.0, 30.0):
        vent = (
            cq.Workplane("XY")
            .center(x, 0)
            .rect(8.0, 32.0)
            .extrude(thickness + 0.4)
            .translate((0, 0, -0.2))
        )
        lid = lid.cut(vent)
    return lid


def build_parts(config: dict[str, Any]) -> dict[str, cq.Workplane]:
    return {
        "rail_left_end": build_rail_left_end(config),
        "rail_segment": build_rail_segment(config),
        "rail_right_end": build_rail_right_end(config),
        "diffuser_segment": build_diffuser_segment(config),
        "controller_tray": build_controller_tray(config),
        "controller_lid": build_controller_lid(config),
    }


def build_full_rail_assembly(config: dict[str, Any]) -> cq.Assembly:
    d = rail_dimensions(config)
    rail_left = build_rail_left_end(config)
    rail_middle = build_rail_segment(config)
    rail_right = build_rail_right_end(config)
    diffuser = build_diffuser_segment(config)
    assembly = cq.Assembly(name="notefall88_single_strip_rail")
    start = -d.total_length / 2.0 + d.segment_length / 2.0
    for index in range(d.segment_count):
        x = start + index * d.segment_length
        rail = rail_left if index == 0 else rail_right if index == d.segment_count - 1 else rail_middle
        assembly.add(
            rail,
            name=f"rail_{index + 1}",
            loc=cq.Location((x, 0, 0)),
            color=cq.Color(0.025, 0.025, 0.03),
        )
        assembly.add(
            diffuser,
            name=f"diffuser_{index + 1}",
            loc=cq.Location((x, 0, d.height - d.diffuser_thickness - 0.25)),
            color=cq.Color(0.75, 0.86, 0.94, 0.48),
        )
    return assembly
