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
    lid_skirt: float
    lid_clearance: float
    usb_opening_width: float
    harness_opening_width: float
    opening_height: float
    lid_screw_diameter: float
    lid_screw_pilot: float
    lid_boss_diameter: float
    lid_boss_height: float


def controller_dimensions(config: dict[str, Any]) -> ControllerDimensions:
    mech = config["mechanical"]
    return ControllerDimensions(
        length=float(mech["controller_case_length_mm"]),
        width=float(mech["controller_case_width_mm"]),
        floor=float(mech["controller_case_floor_mm"]),
        wall=float(mech["controller_case_wall_mm"]),
        height=float(mech["controller_case_height_mm"]),
        lid_thickness=float(mech["controller_lid_thickness_mm"]),
        lid_skirt=float(mech["controller_lid_skirt_mm"]),
        lid_clearance=float(mech["controller_lid_clearance_mm"]),
        usb_opening_width=float(mech["usb_opening_width_mm"]),
        harness_opening_width=float(mech["harness_opening_width_mm"]),
        opening_height=float(mech["opening_height_mm"]),
        lid_screw_diameter=float(mech["lid_screw_diameter_mm"]),
        lid_screw_pilot=float(mech["lid_screw_pilot_mm"]),
        lid_boss_diameter=float(mech["lid_boss_diameter_mm"]),
        lid_boss_height=float(mech["lid_boss_height_mm"]),
    )


def lid_fastener_centres(d: ControllerDimensions) -> tuple[tuple[float, float], ...]:
    """Shared tray/lid coordinates for four positive-retention screws."""
    edge_offset = d.wall + d.lid_boss_diameter / 2.0 + 1.2
    x = d.length / 2.0 - edge_offset
    y = d.width / 2.0 - edge_offset
    return ((-x, -y), (-x, y), (x, -y), (x, y))


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

    # Four printed pilot bosses positively retain the lid. They accept M3x10
    # thread-forming screws, avoiding heat-set inserts and loose nuts.
    for x, y in lid_fastener_centres(d):
        boss = (
            cq.Workplane("XY")
            .center(x, y)
            .circle(d.lid_boss_diameter / 2.0)
            .extrude(d.lid_boss_height)
        )
        pilot = (
            cq.Workplane("XY")
            .center(x, y)
            .circle(d.lid_screw_pilot / 2.0)
            .extrude(d.lid_boss_height + 0.4)
            .translate((0, 0, -0.2))
        )
        tray = tray.union(boss).cut(pilot)

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

    # Dedicated cable-tie pairs stop external cable pull from reaching USB
    # sockets, module headers, or LED-strip solder pads.
    for x in (-d.length * 0.39, d.length * 0.39):
        for y in (-8.0, 8.0):
            slot = (
                cq.Workplane("XY")
                .center(x, y)
                .rect(10.0, 2.8)
                .extrude(d.floor + 0.4)
                .translate((0, 0, -0.2))
            )
            tray = tray.cut(slot)

    # The official N8R8 board has adjacent USB/OTG and UART connectors. The
    # opposite keyed opening carries the Micro-Fit and XT30 harnesses.
    for x, opening_width in (
        (-d.length / 2.0, d.usb_opening_width),
        (d.length / 2.0, d.harness_opening_width),
    ):
        opening = (
            cq.Workplane("YZ")
            .rect(opening_width, d.opening_height)
            .extrude(d.wall + 0.5)
            .translate(
                (
                    x - (d.wall + 0.5) / 2.0 if x < 0 else x - 0.25,
                    0,
                    d.floor + d.opening_height / 2.0 - 0.5,
                )
            )
        )
        tray = tray.cut(opening)
    return tray


def build_controller_lid(config: dict[str, Any]) -> cq.Workplane:
    d = controller_dimensions(config)
    overhang = 0.4
    top = cq.Workplane("XY").box(
        d.length + overhang,
        d.width + overhang,
        d.lid_thickness,
        centered=(True, True, False),
    )
    inner_length = d.length - 2 * d.wall
    inner_width = d.width - 2 * d.wall
    skirt_outer = (
        cq.Workplane("XY")
        .box(
            inner_length - d.lid_clearance,
            inner_width - d.lid_clearance,
            d.lid_skirt,
            centered=(True, True, False),
        )
        .translate((0, 0, -d.lid_skirt))
    )
    skirt_wall = 1.4
    skirt_inner = (
        cq.Workplane("XY")
        .box(
            inner_length - d.lid_clearance - 2 * skirt_wall,
            inner_width - d.lid_clearance - 2 * skirt_wall,
            d.lid_skirt + 0.4,
            centered=(True, True, False),
        )
        .translate((0, 0, -d.lid_skirt - 0.2))
    )
    lid = top.union(skirt_outer.cut(skirt_inner))
    for x in (-30.0, -15.0, 0.0, 15.0, 30.0):
        vent = (
            cq.Workplane("XY")
            .center(x, 0)
            .rect(8.0, min(32.0, d.width - 18.0))
            .extrude(d.lid_thickness + 0.4)
            .translate((0, 0, -0.2))
        )
        lid = lid.cut(vent)
    for x, y in lid_fastener_centres(d):
        screw_hole = (
            cq.Workplane("XY")
            .center(x, y)
            .circle(d.lid_screw_diameter / 2.0)
            .extrude(d.lid_thickness + d.lid_skirt + 0.4)
            .translate((0, 0, -d.lid_skirt - 0.2))
        )
        lid = lid.cut(screw_hole)
    # Keep the exported solid entirely above Z=0 for predictable slicing.
    return lid.translate((0, 0, d.lid_skirt))


def build_parts(config: dict[str, Any]) -> dict[str, cq.Workplane]:
    """Return only parts that are actually useful in the revised architecture."""
    return {
        "controller_tray": build_controller_tray(config),
        "controller_lid": build_controller_lid(config),
    }
