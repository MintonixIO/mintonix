# -*- coding: utf-8 -*-
"""
Minimal, self-contained definition of the TrackNetV5 shuttle-detection network.

This is a flattened copy of the model defined in the Mintonix project's
`lib/TrackNetV5/models_factory` (MDD -> Backbone -> Neck -> R_STRHead), with the
training/registry/visualization scaffolding stripped out. It only needs to run
forward inference and load the released `TrackNetV5.pt` checkpoint.

Input  : tensor of shape (B, 13, 288, 512)
         = [frame_prev(3), att_prev_curr(2), frame_curr(3), att_curr_next(2), frame_next(3)]
         (the attention channels are produced internally by MDD from the 9 RGB
          channels, so the caller only stacks the 3 RGB frames -> 9ch, and the
          MDD-derived 4ch are concatenated in `forward`.)
Output : tensor of shape (B, 3, 288, 512) -- a sigmoid heatmap per input frame.
"""
import torch
import torch.nn as nn


class MDD(nn.Module):
    """Motion Direction Decouple layer: builds 4 motion-attention channels."""

    def __init__(self):
        super().__init__()
        self.a = nn.Parameter(torch.tensor(0.2))
        self.b = nn.Parameter(torch.tensor(0.15))
        self.register_buffer('R_WEIGHT', torch.tensor(0.299).view(1, 1, 1, 1))
        self.register_buffer('G_WEIGHT', torch.tensor(0.587).view(1, 1, 1, 1))
        self.register_buffer('B_WEIGHT', torch.tensor(0.114).view(1, 1, 1, 1))

    def _rgb_to_luminance(self, img):
        return (self.R_WEIGHT * img[:, 0:1]
                + self.G_WEIGHT * img[:, 1:2]
                + self.B_WEIGHT * img[:, 2:3])

    def _power_normalization(self, x, a, b):
        return 1.0 / (1.0 + torch.exp(
            -(5.0 / (0.45 * torch.abs(torch.tanh(a)) + 1e-6))
            * (torch.abs(x) - 0.6 * torch.tanh(b))))

    def forward(self, x):
        lum_prev = self._rgb_to_luminance(x[:, 0:3])
        lum_curr = self._rgb_to_luminance(x[:, 3:6])
        lum_next = self._rgb_to_luminance(x[:, 6:9])
        diff1 = lum_curr - lum_prev
        diff2 = lum_next - lum_curr
        return torch.cat([
            self._power_normalization(torch.relu(diff1), self.a, self.b),
            self._power_normalization(torch.relu(-diff1), self.a, self.b),
            self._power_normalization(torch.relu(diff2), self.a, self.b),
            self._power_normalization(torch.relu(-diff2), self.a, self.b),
        ], dim=1)


class ConvBlock(nn.Module):
    """Conv -> ReLU -> BN."""

    def __init__(self, in_channels, out_channels, k=3):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv2d(in_channels, out_channels, kernel_size=k,
                      padding=(k - 1) // 2, bias=False),
            nn.ReLU(inplace=True),
            nn.BatchNorm2d(out_channels),
        )

    def forward(self, x):
        return self.conv(x)


class TrackNetV2Backbone(nn.Module):
    def __init__(self, in_channels=13):
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

    def forward(self, x):
        features = {}
        x = self.conv2(self.conv1(x))
        features['skip1'] = x
        x = self.conv4(self.conv3(self.pool1(x)))
        features['skip2'] = x
        x = self.conv7(self.conv6(self.conv5(self.pool2(x))))
        features['skip3'] = x
        x = self.conv10(self.conv9(self.conv8(self.pool3(x))))
        features['bottleneck'] = x
        return features


class TrackNetV2Neck(nn.Module):
    def __init__(self):
        super().__init__()
        self.ups1 = nn.Upsample(scale_factor=2, mode='bilinear', align_corners=True)
        self.conv11 = ConvBlock(512 + 256, 256)
        self.conv12 = ConvBlock(256, 256)
        self.conv13 = ConvBlock(256, 256)
        self.ups2 = nn.Upsample(scale_factor=2, mode='bilinear', align_corners=True)
        self.conv14 = ConvBlock(256 + 128, 128)
        self.conv15 = ConvBlock(128, 128)
        self.ups3 = nn.Upsample(scale_factor=2, mode='bilinear', align_corners=True)
        self.conv16 = ConvBlock(128 + 64, 64)
        self.conv17 = ConvBlock(64, 64)

    def forward(self, features):
        x = self.ups1(features['bottleneck'])
        x = torch.cat([x, features['skip3']], dim=1)
        x = self.conv13(self.conv12(self.conv11(x)))
        x = self.ups2(x)
        x = torch.cat([x, features['skip2']], dim=1)
        x = self.conv15(self.conv14(x))
        x = self.ups3(x)
        x = torch.cat([x, features['skip1']], dim=1)
        x = self.conv17(self.conv16(x))
        return x


class FusionLayerTypeA(nn.Module):
    def forward(self, inputs):
        feature_map, attention_map = inputs
        out1 = feature_map[:, 0, :, :]
        out2 = feature_map[:, 1, :, :] * attention_map[:, 0, :, :]
        out3 = feature_map[:, 2, :, :] * attention_map[:, 2, :, :]
        return torch.stack([out1, out2, out3], dim=1)


class R_STRHead(nn.Module):
    def __init__(self, in_channels=64, out_channels=3, img_size=(288, 512),
                 patch_size=16, embed_dim=256, num_transformer_layers=4,
                 num_transformer_heads=2):
        super().__init__()
        self.fusion_layer = FusionLayerTypeA()
        self.patch_size = patch_size
        self.embed_dim = embed_dim
        self.draft_head = nn.Conv2d(in_channels, out_channels, kernel_size=1,
                                    padding=0, bias=False)
        self.embed_conv = nn.Conv2d(1, embed_dim, kernel_size=patch_size,
                                    stride=patch_size)
        H_feat, W_feat = img_size[0] // patch_size, img_size[1] // patch_size
        self.base_grid = (H_feat, W_feat)  # grid the checkpoint's pos-embed was trained at
        self.spatial_pos_embed = nn.Parameter(torch.randn(1, H_feat * W_feat, embed_dim))
        self.time_embed = nn.Parameter(torch.randn(1, 3, embed_dim))
        self.context_dropout = nn.Dropout(p=0.1)
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=embed_dim, nhead=num_transformer_heads, batch_first=True,
            dim_feedforward=embed_dim * 4, dropout=0.1)
        self.transformer_encoder = nn.TransformerEncoder(encoder_layer,
                                                         num_layers=num_transformer_layers)
        self.decoder_head = nn.Sequential(
            nn.Conv2d(embed_dim, patch_size ** 2, kernel_size=1),
            nn.PixelShuffle(patch_size))
        self.final_sigmoid = nn.Sigmoid()

    def _pos_embed(self, H_feat, W_feat):
        """Positional embedding for an (H_feat, W_feat) token grid.

        The checkpoint's `spatial_pos_embed` is sized to the 288x512 training
        input (18x32 grid). For any other input resolution, bilinearly
        interpolate it to the new grid (standard ViT resolution transfer) --
        this is what unlocks higher-res inference on the same weights. At the
        native grid this returns the parameter untouched, so baseline
        behavior is bit-identical.
        """
        if (H_feat, W_feat) == self.base_grid:
            return self.spatial_pos_embed
        bH, bW = self.base_grid
        pe = self.spatial_pos_embed.reshape(1, bH, bW, self.embed_dim).permute(0, 3, 1, 2)
        pe = nn.functional.interpolate(pe, size=(H_feat, W_feat),
                                       mode='bilinear', align_corners=False)
        return pe.flatten(2).permute(0, 2, 1)

    def forward(self, x, residual_maps):
        draft_logits = self.draft_head(x)
        draft_clean = self.fusion_layer([draft_logits, residual_maps])
        draft = draft_clean  # eval mode: no context dropout

        B, C, H, W = draft.shape
        H_feat, W_feat = H // self.patch_size, W // self.patch_size
        pos_embed = self._pos_embed(H_feat, W_feat)

        embd_prev = self.embed_conv(draft[:, 0, :, :].unsqueeze(1))
        embd_curr = self.embed_conv(draft[:, 1, :, :].unsqueeze(1))
        embd_next = self.embed_conv(draft[:, 2, :, :].unsqueeze(1))

        flat_prev = embd_prev.flatten(2).permute(0, 2, 1)
        flat_curr = embd_curr.flatten(2).permute(0, 2, 1)
        flat_next = embd_next.flatten(2).permute(0, 2, 1)

        in_prev = flat_prev + pos_embed + self.time_embed[:, 0, :].unsqueeze(1)
        in_curr = flat_curr + pos_embed + self.time_embed[:, 1, :].unsqueeze(1)
        in_next = flat_next + pos_embed + self.time_embed[:, 2, :].unsqueeze(1)

        seq = self.transformer_encoder(torch.cat([in_prev, in_curr, in_next], dim=1))
        rep_prev, rep_curr, rep_next = torch.chunk(seq, 3, dim=1)

        def decode(flat):
            feat = flat.permute(0, 2, 1).reshape(B, self.embed_dim, H_feat, W_feat)
            return self.decoder_head(feat)

        residual_logits = torch.cat([decode(rep_prev), decode(rep_curr),
                                     decode(rep_next)], dim=1)
        return self.final_sigmoid(draft + residual_logits)


class TrackNetV5(nn.Module):
    def __init__(self):
        super().__init__()
        self.mdd = MDD()
        self.backbone = TrackNetV2Backbone(in_channels=13)
        self.neck = TrackNetV2Neck()
        self.head = R_STRHead(in_channels=64, out_channels=3)

    def forward(self, x):
        # x: (B, 9, H, W) -- 3 stacked RGB frames
        att = self.mdd(x)  # (B, 4, H, W)
        x = torch.cat([
            x[:, 0:3], att[:, 0:2],   # frame_prev + brighten1/darken1
            x[:, 3:6], att[:, 2:4],   # frame_curr + brighten2/darken2
            x[:, 6:9],                # frame_next
        ], dim=1)                      # -> (B, 13, H, W)
        return self.head(self.neck(self.backbone(x)), att)
