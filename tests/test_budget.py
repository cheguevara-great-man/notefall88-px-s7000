from tools.engineering_budget import calculate


def test_full_width_timing_and_serial_budget_have_margin():
    budget = calculate()["full88_estimate"]
    assert budget["pixels"] == 708
    assert budget["spi_frame_ms"] < 10.0
    assert budget["serial_kbytes_per_s"] < budget["uart_8n1_capacity_kbytes_per_s"] * 0.7

