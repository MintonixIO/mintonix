from pathlib import Path

import cv2
import numpy as np

_INPUT_H = 256
_INPUT_W = 128

# Cosine similarity floor to accept a match; below this a detection is left
# unassigned (occluded/blurred crop, or a bystander the SlimSAM mask never
# labeled) rather than forced onto the nearest-but-wrong player.
_MATCH_THRESH = 0.5


class ReIDEmbedder:
    """TensorRT appearance-embedding model (OSNet-style): crop -> L2-normalized vector.

    Used to keep player identity stable across the whole video from a single
    SlimSAM-labeled reference frame, instead of relying on frame-to-frame
    positional continuity (which drifts/switches on occlusion or players
    crossing paths).
    """

    def __init__(self, engine_path: str | Path, batch_size: int = 16) -> None:
        # Defer CUDA/TRT until construction so `import detect` works on CI
        # without a driver (same contract as PoseEstimator / PoseEngine).
        import pycuda.autoinit  # noqa: F401
        import pycuda.driver as cuda
        import tensorrt as trt

        self.batch_size = batch_size
        self._cuda = cuda
        self._trt = trt

        with open(engine_path, "rb") as f:
            runtime = trt.Runtime(trt.Logger(trt.Logger.WARNING))
            self.engine = runtime.deserialize_cuda_engine(f.read())

        self.context = self.engine.create_execution_context()
        self._alloc_buffers()

    # ------------------------------------------------------------------
    # Buffer management
    # ------------------------------------------------------------------

    def _alloc_buffers(self) -> None:
        trt, cuda = self._trt, self._cuda
        self._bufs: dict[str, dict] = {}
        self._input_name: str = ""
        self._output_name: str = ""

        for i in range(self.engine.num_io_tensors):
            name = self.engine.get_tensor_name(i)
            dtype = trt.nptype(self.engine.get_tensor_dtype(name))
            shape = list(self.engine.get_tensor_shape(name))
            shape = [self.batch_size if s == -1 else s for s in shape]

            host = cuda.pagelocked_empty(int(np.prod(shape)), dtype)
            dev = cuda.mem_alloc(host.nbytes)
            self._bufs[name] = {"host": host, "device": dev, "shape": shape}

            if self.engine.get_tensor_mode(name) == trt.TensorIOMode.INPUT:
                self._input_name = name
            else:
                self._output_name = name

    # ------------------------------------------------------------------
    # Inference
    # ------------------------------------------------------------------

    def embed(self, crops: list[np.ndarray]) -> np.ndarray:
        """Return (len(crops), D) L2-normalized embeddings, one per crop."""
        if not crops:
            return np.zeros((0, self._bufs[self._output_name]["shape"][-1]), dtype=np.float32)

        out = []
        for i in range(0, len(crops), self.batch_size):
            out.append(self._embed_batch(crops[i : i + self.batch_size]))
        return np.concatenate(out, axis=0)

    def _embed_batch(self, crops: list[np.ndarray]) -> np.ndarray:
        n = len(crops)
        padded = crops + [crops[-1]] * (self.batch_size - n)

        x = self._preprocess(padded)
        in_buf = self._bufs[self._input_name]
        out_buf = self._bufs[self._output_name]

        np.copyto(in_buf["host"], x.ravel())
        self._cuda.memcpy_htod(in_buf["device"], in_buf["host"])

        bindings = [int(self._bufs[self.engine.get_tensor_name(i)]["device"])
                    for i in range(self.engine.num_io_tensors)]
        self.context.execute_v2(bindings)

        self._cuda.memcpy_dtoh(out_buf["host"], out_buf["device"])
        raw = out_buf["host"].reshape(out_buf["shape"])[:n]

        norm = np.linalg.norm(raw, axis=1, keepdims=True)
        return raw / np.clip(norm, 1e-6, None)

    def _preprocess(self, crops: list[np.ndarray]) -> np.ndarray:
        out = np.zeros((len(crops), 3, _INPUT_H, _INPUT_W), dtype=np.float32)
        for i, crop in enumerate(crops):
            resized = cv2.resize(crop, (_INPUT_W, _INPUT_H))
            out[i] = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB).transpose(2, 0, 1) / 255.0
        return out

    def __del__(self) -> None:
        if hasattr(self, "context"):
            del self.context
        if hasattr(self, "engine"):
            del self.engine


# ---------------------------------------------------------------------------
# Reference-embedding seeding and per-frame matching
# ---------------------------------------------------------------------------

def build_reference_embeddings(
    embedder: ReIDEmbedder, frame: np.ndarray, player_mask: np.ndarray
) -> dict[int, np.ndarray]:
    """Seed one reference embedding per labeled player from a SlimSAM mask.

    `player_mask` is a single-channel label image aligned to `frame`: 0 is
    background, each distinct positive value is one player's region on that
    reference frame (frame 0 of the video).
    """
    labels = sorted(int(v) for v in np.unique(player_mask) if v != 0)
    if not labels:
        return {}

    crops = []
    for label in labels:
        ys, xs = np.where(player_mask == label)
        y1, y2 = int(ys.min()), int(ys.max()) + 1
        x1, x2 = int(xs.min()), int(xs.max()) + 1
        crops.append(frame[y1:y2, x1:x2])

    embs = embedder.embed(crops)
    return {label: emb for label, emb in zip(labels, embs)}


def match_players(
    embedder: ReIDEmbedder,
    frame: np.ndarray,
    boxes: list[tuple[float, float, float, float]],
    refs: dict[int, np.ndarray],
) -> list[int | None]:
    """Exclusive player assignment by cosine similarity.

    Greedy bipartite match: highest similarity pairs first; each detection and
    each reference player id may be used at most once. Below `_MATCH_THRESH`
    the detection stays unassigned (None).
    """
    if not refs or not boxes:
        return [None] * len(boxes)

    h, w = frame.shape[:2]
    crops = []
    for x1, y1, x2, y2 in boxes:
        px1, py1 = max(int(x1 * w), 0), max(int(y1 * h), 0)
        px2, py2 = max(int(x2 * w), px1 + 1), max(int(y2 * h), py1 + 1)
        crop = frame[py1:py2, px1:px2]
        crops.append(crop if crop.size else frame)

    embs = embedder.embed(crops)
    return exclusive_match(embs, refs, thresh=_MATCH_THRESH)


def exclusive_match(
    embeddings: np.ndarray,
    refs: dict[int, np.ndarray],
    *,
    thresh: float = _MATCH_THRESH,
) -> list[int | None]:
    """Greedy 1:1 assignment of L2-normalized embeddings to reference vectors.

    Pure-numpy helper (no TRT) so unit tests can cover exclusivity without GPU.
    """
    n = embeddings.shape[0]
    if n == 0 or not refs:
        return [None] * n

    ref_ids = list(refs.keys())
    ref_mat = np.stack([refs[i] for i in ref_ids])  # R x D
    sims = embeddings @ ref_mat.T  # N x R

    pairs: list[tuple[float, int, int]] = []
    for di in range(n):
        for ri in range(len(ref_ids)):
            pairs.append((float(sims[di, ri]), di, ri))
    pairs.sort(key=lambda t: t[0], reverse=True)

    assigned: list[int | None] = [None] * n
    used_dets: set[int] = set()
    used_refs: set[int] = set()
    for sim, di, ri in pairs:
        if sim < thresh:
            break
        if di in used_dets or ri in used_refs:
            continue
        assigned[di] = ref_ids[ri]
        used_dets.add(di)
        used_refs.add(ri)
    return assigned
