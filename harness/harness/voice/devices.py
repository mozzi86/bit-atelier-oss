"""Device choice for faster-whisper — honest, with a warning the UI can show.

Order: cuda (ctranslate2 sees a GPU AND a float16 model loads — missing cuBLAS/
cuDNN DLLs on Windows or a full GPU fail the load) → cpu int8 with a warning.
Apple Silicon: CTranslate2 has no MPS path → cpu int8, the warning names
mlx-whisper as the Phase-68 option [ASSUMED].

In: nothing but the environment. Out: DeviceChoice(geraet, compute_type, warnung).
"""

from __future__ import annotations

import platform
from dataclasses import dataclass
from typing import Callable

CUDA_DLL_HINT = (
    "CUDA vorhanden, aber das Modell lädt nicht auf der GPU — meist fehlen cuBLAS/cuDNN: "
    "`pip install nvidia-cublas-cu12 nvidia-cudnn-cu12` (Windows) oder die GPU ist belegt. "
    "Läuft auf CPU (int8): langsamer."
)
CPU_HINT = "Keine CUDA-GPU gefunden — läuft auf CPU (int8): langsamer, für Diktat ausreichend."
APPLE_HINT = (
    "Apple Silicon: CTranslate2 kennt keinen MPS-Pfad — läuft auf CPU (int8). "
    "Schneller wäre mlx-whisper (Phase 68 [ASSUMED])."
)
EXTRA_HINT = "Extra [voice] installieren: pip install -e .[voice]"


@dataclass(frozen=True)
class DeviceChoice:
    geraet: str          # "cuda" | "cpu" | "none"
    compute_type: str    # "float16" | "int8" | ""
    warnung: str = ""    # empty when everything is as good as it gets


def _is_apple_silicon() -> bool:
    return platform.system() == "Darwin" and platform.machine() in ("arm64", "aarch64")


_DLL_DIRS_REGISTERED = False


def register_cuda_dlls() -> list[str]:
    """Windows: `pip install nvidia-cublas-cu12 nvidia-cudnn-cu12` drops the DLLs into
    site-packages/nvidia/<lib>/bin, which is NOT on the loader path — ctranslate2 then
    reports "cublas64_12.dll is not found" although the wheels are installed (measured
    05.09.2026). Registering the folders with os.add_dll_directory fixes it. Idempotent."""
    global _DLL_DIRS_REGISTERED
    if _DLL_DIRS_REGISTERED or platform.system() != "Windows":
        return []
    import glob
    import os
    import sys
    added: list[str] = []
    for d in glob.glob(os.path.join(sys.prefix, "Lib", "site-packages", "nvidia", "*", "bin")):
        try:
            os.add_dll_directory(d)
            os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")
            added.append(d)
        except OSError:
            continue
    _DLL_DIRS_REGISTERED = True
    return added


def choose_device(
    *,
    cuda_count: Callable[[], int] | None = None,
    try_load: Callable[[str, str], None] | None = None,
) -> DeviceChoice:
    """Decide where faster-whisper runs. `cuda_count` and `try_load` are injectable
    so the decision is testable without ctranslate2; `try_load(device, compute_type)`
    raises when a model cannot be created on that device."""
    if _is_apple_silicon():
        return DeviceChoice("cpu", "int8", APPLE_HINT)
    register_cuda_dlls()

    if cuda_count is None:
        def cuda_count() -> int:  # type: ignore[no-redef]
            try:
                import ctranslate2  # noqa: WPS433 (lazy on purpose)
                return int(ctranslate2.get_cuda_device_count())
            except Exception:
                return 0

    n = 0
    try:
        n = int(cuda_count())
    except Exception:
        n = 0
    if n <= 0:
        return DeviceChoice("cpu", "int8", CPU_HINT)

    if try_load is not None:
        try:
            try_load("cuda", "float16")
        except Exception:
            return DeviceChoice("cpu", "int8", CUDA_DLL_HINT)
    return DeviceChoice("cuda", "float16", "")


def voice_extra_available() -> bool:
    try:
        import faster_whisper  # noqa: F401
        return True
    except Exception:
        return False
