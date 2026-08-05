"""CadQuery model for the optional NoteFall 88 electronics enclosure.

The keyboard-side LED strip is intentionally not enclosed by a printed rail:
it mounts vertically with its emitters exposed toward the player and keys.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import cadquery as cq


@dataclass(frozen=True)
class ControllerDimensions:
    length: float
    width: float
    floor: float
    wall: float
    height: float
    lid_thickness: float


def controller_dimensions(config: dict[str, Any]) -> ControllerDimensions:
    mech = config["mechanical"]
    return ControllerDimensions(
        length=float(mech["controller_case_length_mm"]),
        width=float(mech["controller_case_width_mm"]),
        floor=float(mech["controller_case_floor_mm"]),
        wall=float(mech["controller_case_wall_mm"]),
        height=float(mech["controller_case_height_mm"]),
        lid_thickness=float(mech["controller_lid_thickness_mm"]),
    )


def build_controller_tray(config: dict[str, Any]) -> cq.Workplane:
    """Ventilated universal tray; zip ties tolerate different module hole patterns."""
    d = controller_dimensions(config)
    tray = cq.Workplane("XY").box(
        d.length, d.width, d.floor, centered=(True, True, False)
    )
    outer = cq.Workplane("XY").box(
        d.length, d.width, d.height, centered=(True, True, False)
    )
    inner = (
        cq.Workplane("XY")
        .box(
            d.length - 2 * d.wall,
            d.width - 2 * d.wall,
            d.height,
            centered=(True, True, False),
        )
        .translate((0, 0, d.floor))
    )
    tray = tray.union(outer.cut(inner))

    for x in (-d.length * 0.32, -d.length * 0.15, d.length * 0.15, d.length * 0.32):
        for y in (-d.width * 0.29, d.width * 0.29):
            slot = (
                cq.Workplane("XY")
                .center(x, y)
                .rect(8.0, 2.4)
                .extrude(d.floor + 0.4)
                .translate((0, 0, -0.2))
            )
            tray = tray.cut(slot)

    # Oversized USB/power openings accommodate the known N8R8 board variants.
    for x in (-d.length / 2.0, d.length / 2.0):
        opening = (
            cq.Workplane("YZ")
            .rect(18.0, 10.0)
            .extrude(d.wall + 0.5)
            .translate(
                (
                    x - (d.wall + 0.5) / 2.0 if x < 0 else x - 0.25,
                    0,
                    min(8.5, d.height * 0.47),
                )
            )
        )
        tray = tray.cut(opening)
    return tray


def build_controller_lid(config: dict[str, Any]) -> cq.Workplane:
    d = controller_dimensions(config)
    clearance = 0.4
    lid = cq.Workplane("XY").box(
        d.length + clearance,
        d.width + clearance,
        d.lid_thickness,
        centered=(True, True, False),
    )
    for x in (-30.0, -15.0, 0.0, 15.0, 30.0):
        vent = (
            cq.Workplane("XY")
            .center(x, 0)
            .rect(8.0, min(32.0, d.width - 18.0))
            .extrude(d.lid_thickness + 0.4)
            .translate((0, 0, -0.2))
        )
        lid = lid.cut(vent)
    return lid


def build_parts(config: dict[str, Any]) -> dict[str, cq.Workplane]:
    """Return only parts that are actually useful in the revised architecture."""
    return {
        "controller_tray": build_controller_tray(config),
        "controller_lid": build_controller_lid(config),
    }
