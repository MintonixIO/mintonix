from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from .types import ShuttleResult

_INPUT_H = 288
_INPUT_W = 512
_CONF_THRESH = 0.5


# ---------------------------------------------------------------------------
# Building blocks
# ---------------------------------------------------------------------------

def _conv_block(in_ch: int, out_ch: int, n_convs: int) -> nn.Sequential:
    layers: list[nn.Module] = []
    for i in range(n_convs):
        layers += [
            nn.Conv2d(in_ch if i == 0 else out_ch, out_ch, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_ch),
            nn.ReLU(inplace=True),
        ]
    return nn.Sequential(*layers)


class _PowerNormSigmoid(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.power = nn.Parameter(torch.tensor(1.0))
        self.scale = nn.Parameter(torch.tensor(1.0))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return torch.sigmoid(x.abs().pow(self.power) * x.sign() * self.scale)


# ---------------------------------------------------------------------------
# Stage 1 — MDD (Motion Direction Decouple)
# ---------------------------------------------------------------------------

class _MDD(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.pns = _PowerNormSigmoid()

    @staticmethod
    def _lum(x: torch.Tensor) -> torch.Tensor:
        return 0.299 * x[:, 0:1] + 0.587 * x[:, 1:2] + 0.114 * x[:, 2:3]

    def forward(
        self, f1: torch.Tensor, f2: torch.Tensor, f3: torch.Tensor
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        l1, l2, l3 = self._lum(f1), self._lum(f2), self._lum(f3)

        d12 = l2 - l1
        d23 = l3 - l2

        att_12 = torch.cat([self.pns(F.relu(d12)), self.pns(F.relu(-d12))], dim=1)  # B×2×H×W
        att_23 = torch.cat([self.pns(F.relu(d23)), self.pns(F.relu(-d23))], dim=1)

        # F1(3) + att12(2) + F2(3) + att23(2) + F3(3) = 13ch
        x = torch.cat([f1, att_12, f2, att_23, f3], dim=1)
        return x, att_12, att_23


# ---------------------------------------------------------------------------
# Stage 2 — Backbone (VGG-style encoder, 13ch → 512ch)
# ---------------------------------------------------------------------------

class _Backbone(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.block1 = _conv_block(13, 64, 2)
        self.pool1 = nn.MaxPool2d(2, 2)
        self.block2 = _conv_block(64, 128, 2)
        self.pool2 = nn.MaxPool2d(2, 2)
        self.block3 = _conv_block(128, 256, 3)
        self.pool3 = nn.MaxPool2d(2, 2)
        self.block4 = _conv_block(256, 512, 3)

    def forward(
        self, x: torch.Tensor
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        s1 = self.block1(x)
        s2 = self.block2(self.pool1(s1))
        s3 = self.block3(self.pool2(s2))
        bot = self.block4(self.pool3(s3))
        return bot, s3, s2, s1


# ---------------------------------------------------------------------------
# Stage 3 — Neck (U-Net decoder, 512ch → 64ch full-res)
# ---------------------------------------------------------------------------

class _UpBlock(nn.Module):
    def __init__(self, in_ch: int, skip_ch: int, out_ch: int) -> None:
        super().__init__()
        self.up = nn.Upsample(scale_factor=2, mode="bilinear", align_corners=False)
        self.conv = _conv_block(in_ch + skip_ch, out_ch, 2)

    def forward(self, x: torch.Tensor, skip: torch.Tensor) -> torch.Tensor:
        return self.conv(torch.cat([self.up(x), skip], dim=1))


class _Neck(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.up3 = _UpBlock(512, 256, 256)
        self.up2 = _UpBlock(256, 128, 128)
        self.up1 = _UpBlock(128, 64, 64)

    def forward(
        self,
        bot: torch.Tensor,
        s3: torch.Tensor,
        s2: torch.Tensor,
        s1: torch.Tensor,
    ) -> torch.Tensor:
        x = self.up3(bot, s3)
        x = self.up2(x, s2)
        return self.up1(x, s1)  # B×64×H×W


# ---------------------------------------------------------------------------
# Stage 4 — R_STR Head
# ---------------------------------------------------------------------------

class _FusionLayerTypeA(nn.Module):
    """Gates frame 0 and 2 draft maps with MDD attention; frame 1 is unmodified."""

    def forward(
        self,
        drafts: torch.Tensor,
        att_12: torch.Tensor,
        att_23: torch.Tensor,
    ) -> torch.Tensor:
        gate_12 = att_12.mean(dim=1, keepdim=True)
        gate_23 = att_23.mean(dim=1, keepdim=True)
        return torch.cat(
            [drafts[:, 0:1] * gate_12, drafts[:, 1:2], drafts[:, 2:3] * gate_23],
            dim=1,
        )


class _RSTRHead(nn.Module):
    def __init__(self, in_ch: int = 64, patch_size: int = 16) -> None:
        super().__init__()
        d_model = 256
        self.patch_size = patch_size

        self.draft = nn.Conv2d(in_ch, 3, 1)
        self.fusion = _FusionLayerTypeA()

        self.patch_embed = nn.Conv2d(1, d_model, patch_size, stride=patch_size)
        self.temporal_embed = nn.Parameter(torch.zeros(3, 1, d_model))

        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=2,
            dim_feedforward=1024,
            dropout=0.1,
            batch_first=True,
        )
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=4)

        self.decode_conv = nn.Conv2d(d_model, patch_size * patch_size, 1)
        self.pixel_shuffle = nn.PixelShuffle(patch_size)

    def forward(
        self,
        feat: torch.Tensor,
        att_12: torch.Tensor,
        att_23: torch.Tensor,
    ) -> torch.Tensor:
        B, _, H, W = feat.shape
        p = self.patch_size
        h_p, w_p = H // p, W // p

        draft = self.draft(feat)                        # B×3×H×W
        fused = self.fusion(draft, att_12, att_23)      # B×3×H×W

        residuals = []
        for t in range(3):
            tokens = self.patch_embed(fused[:, t : t + 1])     # B×d_model×h_p×w_p
            tokens = tokens.flatten(2).transpose(1, 2)          # B×N×d_model
            tokens = tokens + self.temporal_embed[t]
            refined = self.transformer(tokens)                   # B×N×d_model
            refined = refined.transpose(1, 2).reshape(B, -1, h_p, w_p)
            residuals.append(self.pixel_shuffle(self.decode_conv(refined)))  # B×1×H×W

        residuals_cat = torch.cat(residuals, dim=1)     # B×3×H×W
        return torch.sigmoid(draft + residuals_cat)     # B×3×H×W


# ---------------------------------------------------------------------------
# Full model
# ---------------------------------------------------------------------------

class TrackNetV5(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.mdd = _MDD()
        self.backbone = _Backbone()
        self.neck = _Neck()
        self.head = _RSTRHead()

    def forward(
        self, f1: torch.Tensor, f2: torch.Tensor, f3: torch.Tensor
    ) -> torch.Tensor:
        x, att_12, att_23 = self.mdd(f1, f2, f3)
        bot, s3, s2, s1 = self.backbone(x)
        feat = self.neck(bot, s3, s2, s1)
        return self.head(feat, att_12, att_23)   # B×3×H×W heatmaps


# ---------------------------------------------------------------------------
# Inference wrapper
# ---------------------------------------------------------------------------

class ShuttleDetector:
    def __init__(self, ckpt_path: str | Path) -> None:
        self.model = TrackNetV5().cuda().eval()
        state = torch.load(ckpt_path, map_location="cuda", weights_only=True)
        sd = state.get("model_state_dict", state.get("state_dict", state))
        self.model.load_state_dict(sd)

    def _preprocess(self, frame: np.ndarray) -> torch.Tensor:
        rgb = cv2.cvtColor(
            cv2.resize(frame, (_INPUT_W, _INPUT_H)), cv2.COLOR_BGR2RGB
        )
        return torch.from_numpy(rgb).permute(2, 0, 1).float().div(255.0)  # 3×H×W

    @torch.inference_mode()
    def process_triplet(
        self, f1: np.ndarray, f2: np.ndarray, f3: np.ndarray
    ) -> list[ShuttleResult]:
        t1 = self._preprocess(f1).unsqueeze(0).cuda()
        t2 = self._preprocess(f2).unsqueeze(0).cuda()
        t3 = self._preprocess(f3).unsqueeze(0).cuda()

        heatmaps = self.model(t1, t2, t3)  # 1×3×H×W

        results: list[ShuttleResult] = []
        for i in range(3):
            hm = heatmaps[0, i]            # H×W
            conf = float(hm.max())
            if conf >= _CONF_THRESH:
                peak = int(hm.argmax())
                y = (peak // hm.shape[1]) / hm.shape[0]
                x = (peak % hm.shape[1]) / hm.shape[1]
            else:
                x = y = 0.0
            results.append(ShuttleResult(x=x, y=y, conf=conf, visible=conf >= _CONF_THRESH))

        return results
