"""Render generated STL parts in an off-screen VTK assembly preview."""

from __future__ import annotations

import json
from pathlib import Path

import vtk


ROOT = Path(__file__).resolve().parents[1]
EXPORTS = ROOT / "mechanical" / "exports"
RENDERS = ROOT / "mechanical" / "renders"


def actor_for(path: Path, color: tuple[float, float, float], opacity: float, z: float):
    reader = vtk.vtkSTLReader()
    reader.SetFileName(str(path))
    mapper = vtk.vtkPolyDataMapper()
    mapper.SetInputConnection(reader.GetOutputPort())
    actor = vtk.vtkActor()
    actor.SetMapper(mapper)
    actor.GetProperty().SetColor(*color)
    actor.GetProperty().SetOpacity(opacity)
    actor.GetProperty().SetInterpolationToPBR()
    actor.GetProperty().SetMetallic(0.0)
    actor.GetProperty().SetRoughness(0.72)
    actor.SetPosition(0.0, 0.0, z)
    return actor


def render(
    name: str,
    camera_position: tuple[float, float, float],
    focal=(0.0, 0.0, 6.0),
    view_up=(0.0, 0.0, 1.0),
) -> Path:
    config = json.loads((ROOT / "config" / "system.json").read_text(encoding="utf-8"))
    mech = config["mechanical"]
    layers = [
        ("base", (0.42, 0.44, 0.48), 1.0, 0.0),
        ("tray", (0.08, 0.09, 0.10), 1.0, float(mech["base_thickness_mm"])),
        (
            "baffle",
            (0.015, 0.015, 0.018),
            1.0,
            float(mech["base_thickness_mm"]) + float(mech["tray_height_mm"]),
        ),
        (
            "diffuser",
            (0.55, 0.82, 0.96),
            0.30,
            float(mech["base_thickness_mm"])
            + float(mech["tray_height_mm"])
            + float(mech["baffle_height_mm"]),
        ),
    ]
    renderer = vtk.vtkRenderer()
    renderer.SetBackground(0.93, 0.94, 0.96)
    for part, color, opacity, z in layers:
        renderer.AddActor(actor_for(EXPORTS / f"v0_{part}.stl", color, opacity, z))

    light = vtk.vtkLight()
    light.SetLightTypeToCameraLight()
    light.SetIntensity(1.15)
    renderer.AddLight(light)

    camera = renderer.GetActiveCamera()
    camera.SetPosition(*camera_position)
    camera.SetFocalPoint(*focal)
    camera.SetViewUp(*view_up)
    camera.SetParallelProjection(True)
    camera.SetParallelScale(105.0)

    window = vtk.vtkRenderWindow()
    window.SetOffScreenRendering(True)
    window.SetSize(1400, 800)
    window.AddRenderer(renderer)
    window.Render()

    image_filter = vtk.vtkWindowToImageFilter()
    image_filter.SetInput(window)
    image_filter.SetInputBufferTypeToRGBA()
    image_filter.ReadFrontBufferOff()
    image_filter.Update()
    RENDERS.mkdir(parents=True, exist_ok=True)
    output = RENDERS / name
    writer = vtk.vtkPNGWriter()
    writer.SetFileName(str(output))
    writer.SetInputConnection(image_filter.GetOutputPort())
    writer.Write()
    return output


def main() -> None:
    if not (EXPORTS / "v0_base.stl").exists():
        raise SystemExit("Run mechanical/generate.py first")
    paths = [
        render("v0_isometric.png", (240.0, -220.0, 180.0)),
        render(
            "v0_top.png",
            (0.0, 0.0, 400.0),
            focal=(0.0, 0.0, 0.0),
            view_up=(0.0, 1.0, 0.0),
        ),
    ]
    for path in paths:
        print(path)


if __name__ == "__main__":
    main()
