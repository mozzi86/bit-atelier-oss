"""Device choice without ctranslate2: 0 GPUs → cpu int8 + warning; load failure → cpu + DLL hint."""

from harness.voice import devices
from harness.voice.devices import APPLE_HINT, CPU_HINT, CUDA_DLL_HINT, choose_device


def test_no_gpu_means_cpu_with_warning(monkeypatch):
    monkeypatch.setattr(devices, "_is_apple_silicon", lambda: False)
    d = choose_device(cuda_count=lambda: 0, try_load=lambda dev, ct: None)
    assert (d.geraet, d.compute_type, d.warnung) == ("cpu", "int8", CPU_HINT)


def test_gpu_that_fails_to_load_falls_back_with_dll_hint(monkeypatch):
    monkeypatch.setattr(devices, "_is_apple_silicon", lambda: False)

    def boom(dev, ct):
        raise RuntimeError("cublas64_12.dll not found")

    d = choose_device(cuda_count=lambda: 1, try_load=boom)
    assert d.geraet == "cpu" and d.compute_type == "int8" and "cuBLAS" in d.warnung and d.warnung == CUDA_DLL_HINT


def test_gpu_ok_is_cuda_float16_without_warning(monkeypatch):
    monkeypatch.setattr(devices, "_is_apple_silicon", lambda: False)
    d = choose_device(cuda_count=lambda: 1, try_load=lambda dev, ct: None)
    assert (d.geraet, d.compute_type, d.warnung) == ("cuda", "float16", "")


def test_apple_silicon_is_cpu_with_mlx_hint(monkeypatch):
    monkeypatch.setattr(devices, "_is_apple_silicon", lambda: True)
    d = choose_device(cuda_count=lambda: 4, try_load=lambda dev, ct: None)
    assert d.geraet == "cpu" and "mlx-whisper" in d.warnung and d.warnung == APPLE_HINT


def test_register_cuda_dlls_is_noop_off_windows_and_idempotent(monkeypatch):
    monkeypatch.setattr(devices, "_DLL_DIRS_REGISTERED", False)
    monkeypatch.setattr(devices.platform, "system", lambda: "Linux")
    assert devices.register_cuda_dlls() == []
    monkeypatch.setattr(devices.platform, "system", lambda: "Windows")
    first = devices.register_cuda_dlls()          # real venv: lists nvidia/*/bin when installed
    assert isinstance(first, list)
    assert devices.register_cuda_dlls() == []     # second call does nothing


def test_broken_probe_counts_as_no_gpu(monkeypatch):
    monkeypatch.setattr(devices, "_is_apple_silicon", lambda: False)

    def broken():
        raise ImportError("ctranslate2 missing")

    assert choose_device(cuda_count=broken).geraet == "cpu"
