"""TrackNetV5 topology for **export tools only** (not product runtime).

Product shuttle path uses TensorRT engines only (`SHUTTLE_ENGINE`). This module
is kept so ``tools/export_tracknet_trt.py`` can still load ``.pt`` weights on
an export host that has PyTorch.

Flattened inference-only copy of the released TrackNetV5 topology
(MDD → Backbone → Neck → R_STRHead). Input is three stacked RGB frames
(B, 9, 288, 512); output is per-frame sigmoid heatmaps (B, 3, 288, 512).
"""
from __future__ import annotations

import torch
import torch.nn as nn


class MDD(nn.Module):
    """Motion Direction Decouple: builds 4 motion-attention channels."""

    def __init__(self) -> None:
        super().__init__()
        self.a = nn.Parameter(torch.tensor(0.2))
        self.b = nn.Parameter(torch.tensor(0.15))
        self.register_buffer("R_WEIGHT", torch.tensor(0.299).view(1, 1, 1, 1))
        self.register_buffer("G_WEIGHT", torch.tensor(0.587).view(1, 1, 1, 1))
        self.register_buffer("B_WEIGHT", torch.tensor(0.114).view(1, 1, 1, 1))

    def _rgb_to_luminance(self, img: torch.Tensor) -> torch.Tensor:
        return (
            self.R_WEIGHT * img[:, 0:1]
            + self.G_WEIGHT * img[:, 1:2]
            + self.B_WEIGHT * img[:, 2:3]
        )

    def _power_normalization(
        self, x: torch.Tensor, a: torch.Tensor, b: torch.Tensor
    ) -> torch.Tensor:
        return 1.0 / (
            1.0
            + torch.exp(
                -(5.0 / (0.45 * torch.abs(torch.tanh(a)) + 1e-6))
                * (torch.abs(x) - 0.6 * torch.tanh(b))
            )
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (B, 9, H, W) stacked RGB prev/curr/next
        lum_prev = self._rgb_to_luminance(x[:, 0:3])
        lum_curr = self._rgb_to_luminance(x[:, 3:6])
        lum_next = self._rgb_to_luminance(x[:, 6:9])
        diff1 = lum_curr - lum_prev
        diff2 = lum_next - lum_curr
        return torch.cat(
            [
                self._power_normalization(torch.relu(diff1), self.a, self.b),
                self._power_normalization(torch.relu(-diff1), self.a, self.b),
                self._power_normalization(torch.relu(diff2), self.a, self.b),
                self._power_normalization(torch.relu(-diff2), self.a, self.b),
            ],
            dim=1,
        )


class ConvBlock(nn.Module):
    """Conv → ReLU → BN (checkpoint order)."""

    def __init__(self, in_channels: int, out_channels: int, k: int = 3) -> None:
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv2d(
                in_channels,
                out_channels,
                kernel_size=k,
                padding=(k - 1) // 2,
                bias=False,
            ),
            nn.ReLU(inplace=True),
            nn.BatchNorm2d(out_channels),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.conv(x)


class TrackNetV2Backbone(nn.Module):
    def __init__(self, in_channels: int = 13) -> None:
        super().__init__()
        self.conv1 = ConvBlock(in_channels, 64)
        self.conv2 = ConvBlock(64, 64)
        self.pool1 = nn.MaxPool2d(2, 2)
        self.conv3 = ConvBlock(64, 128)
        self.conv4 = ConvBlock(128, 128)
        self.pool2 = nn.MaxPool2d(2, 2)
        self.conv5 = ConvBlock(128, 256)
        self.conv6 = ConvBlock(256, 256)
        self.conv7 = ConvBlock(256, 256)
        self.pool3 = nn.MaxPool2d(2, 2)
        self.conv8 = ConvBlock(256, 512)
        self.conv9 = ConvBlock(512, 512)
        self.conv10 = ConvBlock(512, 512)

    def forward(self, x: torch.Tensor) -> dict[str, torch.Tensor]:
        features: dict[str, torch.Tensor] = {}
        x = self.conv2(self.conv1(x))
        features["skip1"] = x
        x = self.conv4(self.conv3(self.pool1(x)))
        features["skip2"] = x
        x = self.conv7(self.conv6(self.conv5(self.pool2(x))))
        features["skip3"] = x
        x = self.conv10(self.conv9(self.conv8(self.pool3(x))))
        features["bottleneck"] = x
        return features


class TrackNetV2Neck(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.ups1 = nn.Upsample(scale_factor=2, mode="bilinear", align_corners=True)
        self.conv11 = ConvBlock(512 + 256, 256)
        self.conv12 = ConvBlock(256, 256)
        self.conv13 = ConvBlock(256, 256)
        self.ups2 = nn.Upsample(scale_factor=2, mode="bilinear", align_corners=True)
        self.conv14 = ConvBlock(256 + 128, 128)
        self.conv15 = ConvBlock(128, 128)
        self.ups3 = nn.Upsample(scale_factor=2, mode="bilinear", align_corners=True)
        self.conv16 = ConvBlock(128 + 64, 64)
        self.conv17 = ConvBlock(64, 64)

    def forward(self, features: dict[str, torch.Tensor]) -> torch.Tensor:
        x = self.ups1(features["bottleneck"])
        x = torch.cat([x, features["skip3"]], dim=1)
        x = self.conv13(self.conv12(self.conv11(x)))
        x = self.ups2(x)
        x = torch.cat([x, features["skip2"]], dim=1)
        x = self.conv15(self.conv14(x))
        x = self.ups3(x)
        x = torch.cat([x, features["skip1"]], dim=1)
        x = self.conv17(self.conv16(x))
        return x


class FusionLayerTypeA(nn.Module):
    def forward(self, inputs: list[torch.Tensor]) -> torch.Tensor:
        feature_map, attention_map = inputs
        out1 = feature_map[:, 0, :, :]
        out2 = feature_map[:, 1, :, :] * attention_map[:, 0, :, :]
        out3 = feature_map[:, 2, :, :] * attention_map[:, 2, :, :]
        return torch.stack([out1, out2, out3], dim=1)


class R_STRHead(nn.Module):
    def __init__(
        self,
        in_channels: int = 64,
        out_channels: int = 3,
        img_size: tuple[int, int] = (288, 512),
        patch_size: int = 16,
        embed_dim: int = 256,
        num_transformer_layers: int = 4,
        num_transformer_heads: int = 2,
    ) -> None:
        super().__init__()
        self.fusion_layer = FusionLayerTypeA()
        self.patch_size = patch_size
        self.embed_dim = embed_dim
        self.draft_head = nn.Conv2d(
            in_channels, out_channels, kernel_size=1, padding=0, bias=False
        )
        self.embed_conv = nn.Conv2d(
            1, embed_dim, kernel_size=patch_size, stride=patch_size
        )
        h_feat, w_feat = img_size[0] // patch_size, img_size[1] // patch_size
        self.base_grid = (h_feat, w_feat)
        self.spatial_pos_embed = nn.Parameter(
            torch.randn(1, h_feat * w_feat, embed_dim)
        )
        self.time_embed = nn.Parameter(torch.randn(1, 3, embed_dim))
        self.context_dropout = nn.Dropout(p=0.1)
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=embed_dim,
            nhead=num_transformer_heads,
            batch_first=True,
            dim_feedforward=embed_dim * 4,
            dropout=0.1,
        )
        self.transformer_encoder = nn.TransformerEncoder(
            encoder_layer, num_layers=num_transformer_layers
        )
        self.decoder_head = nn.Sequential(
            nn.Conv2d(embed_dim, patch_size**2, kernel_size=1),
            nn.PixelShuffle(patch_size),
        )
        self.final_sigmoid = nn.Sigmoid()

    def _pos_embed(self, h_feat: int, w_feat: int) -> torch.Tensor:
        if (h_feat, w_feat) == self.base_grid:
            return self.spatial_pos_embed
        b_h, b_w = self.base_grid
        pe = self.spatial_pos_embed.reshape(1, b_h, b_w, self.embed_dim).permute(
            0, 3, 1, 2
        )
        pe = nn.functional.interpolate(
            pe, size=(h_feat, w_feat), mode="bilinear", align_corners=False
        )
        return pe.flatten(2).permute(0, 2, 1)

    def forward(
        self, x: torch.Tensor, residual_maps: torch.Tensor
    ) -> torch.Tensor:
        draft_logits = self.draft_head(x)
        draft = self.fusion_layer([draft_logits, residual_maps])

        b, _c, h, w = draft.shape
        h_feat, w_feat = h // self.patch_size, w // self.patch_size
        pos_embed = self._pos_embed(h_feat, w_feat)

        embd_prev = self.embed_conv(draft[:, 0, :, :].unsqueeze(1))
        embd_curr = self.embed_conv(draft[:, 1, :, :].unsqueeze(1))
        embd_next = self.embed_conv(draft[:, 2, :, :].unsqueeze(1))

        flat_prev = embd_prev.flatten(2).permute(0, 2, 1)
        flat_curr = embd_curr.flatten(2).permute(0, 2, 1)
        flat_next = embd_next.flatten(2).permute(0, 2, 1)

        in_prev = flat_prev + pos_embed + self.time_embed[:, 0, :].unsqueeze(1)
        in_curr = flat_curr + pos_embed + self.time_embed[:, 1, :].unsqueeze(1)
        in_next = flat_next + pos_embed + self.time_embed[:, 2, :].unsqueeze(1)

        seq = self.transformer_encoder(
            torch.cat([in_prev, in_curr, in_next], dim=1)
        )
        rep_prev, rep_curr, rep_next = torch.chunk(seq, 3, dim=1)

        def decode(flat: torch.Tensor) -> torch.Tensor:
            feat = flat.permute(0, 2, 1).reshape(b, self.embed_dim, h_feat, w_feat)
            return self.decoder_head(feat)

        residual_logits = torch.cat(
            [decode(rep_prev), decode(rep_curr), decode(rep_next)], dim=1
        )
        return self.final_sigmoid(draft + residual_logits)


class TrackNetV5(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.mdd = MDD()
        self.backbone = TrackNetV2Backbone(in_channels=13)
        self.neck = TrackNetV2Neck()
        self.head = R_STRHead(in_channels=64, out_channels=3)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (B, 9, H, W) — 3 stacked RGB frames
        att = self.mdd(x)  # (B, 4, H, W)
        x = torch.cat(
            [
                x[:, 0:3],
                att[:, 0:2],
                x[:, 3:6],
                att[:, 2:4],
                x[:, 6:9],
            ],
            dim=1,
        )  # → (B, 13, H, W)
        return self.head(self.neck(self.backbone(x)), att)
