"""Headless VTK renders for the vertical exposed strip and controller enclosure."""

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
    actor.GetProperty().SetRoughness(0.64)
    actor.GetProperty().SetAmbient(0.32)
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
    actor.GetProperty().SetRoughness(0.48)
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
    for position, intensity in (((-260, -380, 420), 1.1), ((320, 180, 240), 0.75)):
        light = vtk.vtkLight()
        light.SetPosition(*position)
        light.SetFocalPoint(0, 0, 0)
        light.SetIntensity(intensity)
        renderer.AddLight(light)


def save(renderer: vtk.vtkRenderer, window: vtk.vtkRenderWindow, path: Path, size: tuple[int, int]) -> None:
    window.SetSize(*size)
    add_lights(renderer)
    window.Render()
    capture = vtk.vtkWindowToImageFilter()
    capture.SetInput(window)
    capture.SetInputBufferTypeToRGBA()
    capture.ReadFrontBufferOff()
    capture.Update()
    writer = vtk.vtkPNGWriter()
    writer.SetFileName(str(path))
    writer.SetInputConnection(capture.GetOutputPort())
    writer.Write()


def vertical_strip_mount(config: dict) -> None:
    """Render a representative keyboard section; no printed rail is present."""
    renderer, window = configure_renderer()
    white_pitch = float(config["piano"]["white_key_pitch_mm"])
    led_pitch = 1000.0 / float(config["led"]["pixels_per_m"])
    pcb_height = float(config["led"]["pcb_width_mm"])
    carrier_height = float(config["mechanical"]["optional_carrier_height_mm"])
    clearance = float(config["mechanical"]["strip_bottom_clearance_mm"])
    section_width = 10 * white_pitch

    for index in range(10):
        x = (index - 4.5) * white_pitch
        renderer.AddActor(cube_actor((white_pitch - 0.5, 142.0, 10.0), (x, -55.0, -5.0), (0.90, 0.91, 0.92)))
    for index in (0, 1, 3, 4, 5, 7, 8):
        x = (index - 4.0) * white_pitch
        renderer.AddActor(cube_actor((13.0, 88.0, 10.0), (x, -29.0, 5.0), (0.018, 0.020, 0.024)))

    carrier_z = clearance + carrier_height / 2.0
    renderer.AddActor(cube_actor((section_width, 0.8, carrier_height), (0, 17.0, carrier_z), (0.035, 0.038, 0.045)))
    renderer.AddActor(cube_actor((section_width, 0.55, pcb_height), (0, 16.25, clearance + pcb_height / 2.0), (0.025, 0.025, 0.028)))

    led_count = round(section_width / led_pitch)
    led_start = -(led_count - 1) * led_pitch / 2.0
    lit = {4: (0.10, 0.78, 1.0), 14: (0.16, 0.86, 1.0), 24: (0.10, 1.0, 0.42)}
    for index in range(led_count):
        x = led_start + index * led_pitch
        color = lit.get(index, (0.16, 0.16, 0.17))
        renderer.AddActor(cube_actor((2.7, 0.9, 2.7), (x, 15.65, clearance + pcb_height / 2.0), color))
    for index, color in lit.items():
        x = led_start + index * led_pitch
        renderer.AddActor(cube_actor((8.5, 90.0, 0.35), (x, -35.0, 0.2), color, 0.34))

    camera = renderer.GetActiveCamera()
    camera.SetPosition(235, -390, 105)
    camera.SetFocalPoint(0, -20, 2.5)
    camera.SetViewUp(0, 0, 1)
    camera.ParallelProjectionOn()
    camera.SetParallelScale(118)
    save(renderer, window, RENDERS / "vertical_strip_mount.png", (1500, 900))


def controller_case(config: dict) -> None:
    renderer, window = configure_renderer()
    height = float(config["mechanical"]["controller_case_height_mm"])
    tray = stl_actor(EXPORTS / "controller_tray.stl", (0.22, 0.26, 0.34), 0.92)
    lid = stl_actor(EXPORTS / "controller_lid.stl", (0.43, 0.48, 0.60), 0.96)
    # Exploded view exposes the locating skirt, screw holes, ventilation,
    # universal tie slots, strain relief, and the two differently sized exits.
    lid.SetPosition(-18, 18, height + 32)
    renderer.AddActor(tray)
    renderer.AddActor(lid)
    renderer.AddActor(cube_actor((66, 29, 3), (-8, 2, 4.2), (0.08, 0.35, 0.30)))
    renderer.AddActor(cube_actor((24, 20, 5), (34, -14, 5.2), (0.18, 0.35, 0.62)))
    camera = renderer.GetActiveCamera()
    camera.SetPosition(175, -205, 165)
    camera.SetFocalPoint(-4, 4, 30)
    camera.SetViewUp(0, 0, 1)
    camera.ParallelProjectionOn()
    camera.SetParallelScale(94)
    save(renderer, window, RENDERS / "controller_case.png", (1200, 800))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=ROOT / "config" / "system.json")
    args = parser.parse_args()
    RENDERS.mkdir(parents=True, exist_ok=True)
    config = json.loads(args.config.read_text(encoding="utf-8"))
    vertical_strip_mount(config)
    controller_case(config)
    print(f"Rendered {RENDERS / 'vertical_strip_mount.png'}")
    print(f"Rendered {RENDERS / 'controller_case.png'}")


if __name__ == "__main__":
    main()
