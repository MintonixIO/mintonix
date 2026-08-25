#!/usr/bin/env python3
"""Export TrackNetV5 → ONNX → TensorRT fixed-batch engine (FP16 preferred).

TRT 10+: try BuilderFlag.FP16.
TRT 11+: classic FP16 flag may be gone — use nvidia-modelopt AutoCast if available.

Env:
  SHUTTLE_CKPT   path to tracknetv5.pt (required)
  OUT_DIR        output directory (default: dirname of ckpt)
  SHUTTLE_TRT_BATCH  fixed batch (default: 48)
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import torch

# Repo root on sys.path when run from tools/
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from detect.tracknet import TrackNetV5  # noqa: E402

_H, _W = 288, 512
_IN_CH = 9


def load_model(ckpt: Path, device: str = "cuda") -> torch.nn.Module:
    m = TrackNetV5().to(device).eval()
    state = torch.load(ckpt, map_location=device, weights_only=True)
    sd = state.get("model_state_dict", state.get("state_dict", state))
    m.load_state_dict(sd)
    return m


def export_onnx(model: torch.nn.Module, onnx_path: Path, batch: int) -> None:
    dummy = torch.randn(batch, _IN_CH, _H, _W, device="cuda")
    torch.onnx.export(
        model,
        dummy,
        str(onnx_path),
        input_names=["input"],
        output_names=["heatmaps"],
        opset_version=18,
        do_constant_folding=True,
        dynamo=False,  # legacy exporter — campaign path
    )
    print(f"ONNX written: {onnx_path} ({onnx_path.stat().st_size / 1e6:.1f} MB)")


def maybe_autocast(onnx_path: Path) -> Path:
    """Apply nvidia-modelopt AutoCast (required for TRT 11 FP16 strongly-typed)."""
    try:
        import onnx
        from modelopt.onnx.autocast import convert_to_mixed_precision
    except Exception as e:  # noqa: BLE001
        print(f"modelopt AutoCast unavailable ({e}); using raw ONNX")
        return onnx_path

    out = onnx_path.with_name(onnx_path.stem + "_autocast_fp16.onnx")
    try:
        model = convert_to_mixed_precision(
            str(onnx_path),
            low_precision_type="fp16",
            keep_io_types=True,
            providers=["cpu"],
        )
        onnx.save(model, str(out))
        print(f"AutoCast ONNX: {out} ({out.stat().st_size / 1e6:.1f} MB)")
        return out
    except Exception as e:  # noqa: BLE001
        print(f"AutoCast failed ({e}); using raw ONNX")
        return onnx_path


def build_engine(onnx_path: Path, engine_path: Path, batch: int) -> None:
    import tensorrt as trt

    logger = trt.Logger(trt.Logger.INFO)
    builder = trt.Builder(logger)
    # TRT 10: EXPLICIT_BATCH + BuilderFlag.FP16. STRONGLY_TYPED forbids kFP16
    # (Error 3: condition !config.getFlag(BuilderFlag::kFP16)).
    # TRT 11: no EXPLICIT_BATCH / no kFP16 — STRONGLY_TYPED + AutoCast ONNX.
    flag = 0
    strongly_typed = False
    if hasattr(trt.BuilderFlag, "FP16") and hasattr(
        trt.NetworkDefinitionCreationFlag, "EXPLICIT_BATCH"
    ):
        flag |= 1 << int(trt.NetworkDefinitionCreationFlag.EXPLICIT_BATCH)
    elif hasattr(trt.NetworkDefinitionCreationFlag, "STRONGLY_TYPED"):
        flag |= 1 << int(trt.NetworkDefinitionCreationFlag.STRONGLY_TYPED)
        strongly_typed = True
    network = builder.create_network(flag)
    parser = trt.OnnxParser(network, logger)
    with open(onnx_path, "rb") as f:
        if not parser.parse(f.read()):
            for i in range(parser.num_errors):
                print(parser.get_error(i))
            raise RuntimeError("ONNX parse failed")

    config = builder.create_builder_config()
    if hasattr(config, "set_memory_pool_limit"):
        config.set_memory_pool_limit(trt.MemoryPoolType.WORKSPACE, 20 << 30)
    else:
        config.max_workspace_size = 4 << 30  # type: ignore[attr-defined]

    # TRT 11 removed BuilderFlag.FP16 — precision comes from AutoCast ONNX types.
    if (
        not strongly_typed
        and hasattr(trt.BuilderFlag, "FP16")
        and builder.platform_has_fast_fp16
    ):
        config.set_flag(trt.BuilderFlag.FP16)
        print("BuilderFlag.FP16 enabled")
    else:
        print("BuilderFlag.FP16 skipped — relying on AutoCast/strongly-typed types")

    try:
        inp = network.get_input(0)
        if any(d < 0 for d in inp.shape):
            profile = builder.create_optimization_profile()
            shape = (batch, _IN_CH, _H, _W)
            profile.set_shape(inp.name, shape, shape, shape)
            config.add_optimization_profile(profile)
            print(f"optimization profile fixed batch={batch}")
    except Exception as e:  # noqa: BLE001
        print(f"profile skip: {e}")

    print("Building engine (this can take several minutes)...")
    serialized = builder.build_serialized_network(network, config)
    if serialized is None:
        raise RuntimeError("TRT engine build failed")
    engine_path.write_bytes(bytes(serialized))
    print(f"Engine written: {engine_path} ({engine_path.stat().st_size / 1e6:.1f} MB)")


def main() -> None:
    ckpt = Path(os.environ.get("SHUTTLE_CKPT", "")).expanduser()
    if not ckpt.is_file():
        sys.exit("Set SHUTTLE_CKPT to tracknetv5.pt")
    batch = int(os.environ.get("SHUTTLE_TRT_BATCH", "48"))
    out_dir = Path(os.environ.get("OUT_DIR", str(ckpt.parent)))
    out_dir.mkdir(parents=True, exist_ok=True)

    if not torch.cuda.is_available():
        sys.exit("CUDA required")

    # Disable fused MHA so legacy ONNX export sees standard ops (PyTorch 2.11+).
    try:
        torch.backends.mha.set_fastpath_enabled(False)
    except Exception:  # noqa: BLE001
        pass
    model = load_model(ckpt)
    for mod in model.modules():
        if hasattr(mod, "enable_nested_tensor"):
            mod.enable_nested_tensor = False
    onnx_path = out_dir / f"tracknetv5_b{batch}.onnx"
    with torch.inference_mode():
        export_onnx(model, onnx_path, batch=batch)
    del model
    torch.cuda.empty_cache()
    onnx_use = maybe_autocast(onnx_path)
    engine_path = out_dir / f"tracknetv5_fp16_b{batch}.engine"
    build_engine(onnx_use, engine_path, batch=batch)
    print("DONE", engine_path)


if __name__ == "__main__":
    main()
