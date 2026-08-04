"""Headless VTK renders for the generated NoteFall 88 manufacturing models."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import vtk


ROOT = Path(__file__).resolve().parents[1]
EXPORTS = ROOT / "mechanical" / "exports"
RENDERS = ROOT / "mechanical" / "renders"


def stl_actor(path: Path, color: tuple[float, float, float], opacity: float = 1.0) -> vtk.vtkActor:
    reader = vtk.vtkSTLReader()
    reader.SetFileName(str(path))
    normals = vtk.vtkPolyDataNormals()
    normals.SetInputConnection(reader.GetOutputPort())
    normals.SetFeatureAngle(45)
    mapper = vtk.vtkPolyDataMapper()
    mapper.SetInputConnection(normals.GetOutputPort())
    actor = vtk.vtkActor()
    actor.SetMapper(mapper)
    actor.GetProperty().SetColor(*color)
    actor.GetProperty().SetOpacity(opacity)
    actor.GetProperty().SetInterpolationToPBR()
    actor.GetProperty().SetMetallic(0.08)
    actor.GetProperty().SetRoughness(0.64)
    actor.GetProperty().SetAmbient(0.32)
    actor.GetProperty().SetDiffuse(0.85)
    return actor


def cube_actor(
    size: tuple[float, float, float],
    center: tuple[float, float, float],
    color: tuple[float, float, float],
    opacity: float = 1.0,
) -> vtk.vtkActor:
    source = vtk.vtkCubeSource()
    source.SetXLength(size[0])
    source.SetYLength(size[1])
    source.SetZLength(size[2])
    source.SetCenter(*center)
    mapper = vtk.vtkPolyDataMapper()
    mapper.SetInputConnection(source.GetOutputPort())
    actor = vtk.vtkActor()
    actor.SetMapper(mapper)
    actor.GetProperty().SetColor(*color)
    actor.GetProperty().SetOpacity(opacity)
    actor.GetProperty().SetInterpolationToPBR()
    actor.GetProperty().SetRoughness(0.45)
    actor.GetProperty().SetAmbient(0.38)
    return actor


def configure_renderer() -> tuple[vtk.vtkRenderer, vtk.vtkRenderWindow]:
    renderer = vtk.vtkRenderer()
    renderer.SetBackground(0.025, 0.032, 0.052)
    renderer.SetBackground2(0.11, 0.14, 0.23)
    renderer.GradientBackgroundOn()
    renderer.UseFXAAOn()
    window = vtk.vtkRenderWindow()
    window.SetOffScreenRendering(1)
    window.SetMultiSamples(8)
    window.AddRenderer(renderer)
    return renderer, window


def add_lights(renderer: vtk.vtkRenderer) -> None:
    key = vtk.vtkLight()
    key.SetPosition(-400, -500, 650)
    key.SetFocalPoint(0, 0, 0)
    key.SetIntensity(1.15)
    renderer.AddLight(key)
    fill = vtk.vtkLight()
    fill.SetPosition(450, 300, 220)
    fill.SetFocalPoint(0, 0, 0)
    fill.SetIntensity(0.7)
    renderer.AddLight(fill)


def save(renderer: vtk.vtkRenderer, window: vtk.vtkRenderWindow, path: Path, size: tuple[int, int]) -> None:
    window.SetSize(*size)
    add_lights(renderer)
    window.Render()
    capture = vtk.vtkWindowToImageFilter()
    capture.SetInput(window)
    capture.SetScale(1)
    capture.SetInputBufferTypeToRGBA()
    capture.ReadFrontBufferOff()
    capture.Update()
    writer = vtk.vtkPNGWriter()
    writer.SetFileName(str(path))
    writer.SetInputConnection(capture.GetOutputPort())
    writer.Write()


def full_rail(config: dict) -> None:
    renderer, window = configure_renderer()
    mech = config["mechanical"]
    led = config["led"]
    total = float(mech["rail_total_length_mm"])
    count = int(mech["rail_segment_count"])
    segment = total / count
    start = -total / 2 + segment / 2
    height = float(mech["rail_height_mm"])
    floor = float(mech["rail_floor_mm"])

    for index in range(count):
        x = start + index * segment
        rail_file = (
            "rail_left_end.stl"
            if index == 0
            else "rail_right_end.stl"
            if index == count - 1
            else "rail_segment.stl"
        )
        rail = stl_actor(EXPORTS / rail_file, (0.095, 0.11, 0.15))
        rail.SetPosition(x, 0, 0)
        renderer.AddActor(rail)
        diffuser = stl_actor(EXPORTS / "diffuser_segment.stl", (0.72, 0.82, 0.98), 0.42)
        diffuser.SetPosition(x, 0, height - float(mech["diffuser_thickness_mm"]) - 0.25)
        renderer.AddActor(diffuser)

    renderer.AddActor(cube_actor((total - 4, float(led["pcb_width_mm"]), 0.55), (0, 0, floor + 0.4), (0.04, 0.04, 0.045)))
    pitch = 1000 / float(led["pixels_per_m"])
    led_start = -(int(led["pixel_count"]) - 1) * pitch / 2
    for index in range(int(led["pixel_count"])):
        x = led_start + index * pitch
        color = (0.12, 0.82, 1.0) if index % 12 < 5 else (1.0, 0.18, 0.68)
        renderer.AddActor(cube_actor((2.7, 3.2, 0.8), (x, -0.2, floor + 1.05), color))
    # A few illuminated diffuser locations communicate the single-row function
    # without falsely suggesting that every pixel is lit simultaneously.
    for target_index in (8, 28, 48, 65, 84, 105, 126, 148, 168):
        x = led_start + target_index * pitch
        color = (0.12, 0.82, 1.0) if target_index % 2 == 0 else (1.0, 0.18, 0.68)
        renderer.AddActor(cube_actor((5.2, 8.5, 1.1), (x, 0, height + 0.25), color, 0.95))

    camera = renderer.GetActiveCamera()
    camera.SetPosition(0, -650, 285)
    camera.SetFocalPoint(0, 0, 1.8)
    camera.SetViewUp(0, 0, 1)
    camera.ParallelProjectionOn()
    camera.SetParallelScale(190)
    save(renderer, window, RENDERS / "full_rail.png", (1800, 500))


def detail(config: dict) -> None:
    renderer, window = configure_renderer()
    mech = config["mechanical"]
    height = float(mech["rail_height_mm"])
    diffuser = stl_actor(EXPORTS / "diffuser_segment.stl", (0.62, 0.77, 0.98), 0.38)
    diffuser.SetPosition(0, 0, height - float(mech["diffuser_thickness_mm"]) - 0.25)
    renderer.AddActor(stl_actor(EXPORTS / "rail_segment.stl", (0.095, 0.11, 0.15)))
    renderer.AddActor(diffuser)
    controller = stl_actor(EXPORTS / "controller_tray.stl", (0.11, 0.13, 0.18))
    controller.SetPosition(0, 78, 0)
    controller.RotateZ(-8)
    renderer.AddActor(controller)
    renderer.AddActor(cube_actor((168, 11.8, 0.55), (0, 0, float(mech["rail_floor_mm"]) + 0.4), (0.035, 0.035, 0.04)))

    camera = renderer.GetActiveCamera()
    camera.SetPosition(225, -265, 170)
    camera.SetFocalPoint(0, 25, 3)
    camera.SetViewUp(0, 0, 1)
    camera.ParallelProjectionOn()
    camera.SetParallelScale(105)
    save(renderer, window, RENDERS / "segment_detail.png", (1400, 800))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=ROOT / "config" / "system.json")
    args = parser.parse_args()
    RENDERS.mkdir(parents=True, exist_ok=True)
    config = json.loads(args.config.read_text(encoding="utf-8"))
    full_rail(config)
    detail(config)
    print(f"Rendered {RENDERS / 'full_rail.png'}")
    print(f"Rendered {RENDERS / 'segment_detail.png'}")


if __name__ == "__main__":
    main()
