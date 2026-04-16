"""Generate simulated electrophoresis gel images from ABI files.

Produces a grayscale PNG where each ABI file is rendered as a gel lane.
Signal intensity from the selected fluorescence channel is mapped to band
darkness, mimicking the appearance of a stained agarose/polyacrylamide gel.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from abi_parser import AbifFile

LANE_WIDTH = 40
LANE_SPACING = 6
MARGIN = 20
BACKGROUND = 230
BAND_FLOOR = 10
DEFAULT_HEIGHT = 800
LABEL_HEIGHT = 20


def create_gel_image(
    abi_paths: list[Path],
    channel: int,
    output_path: str | Path,
    *,
    intensity_percentile: float = 99.5,
    height: int = DEFAULT_HEIGHT,
    labels: list[str] | None = None,
) -> Path:
    """Create a simulated gel image from multiple ABI files.

    Args:
        abi_paths: Paths to .ab1 or .fsa files, one per gel lane.
        channel: Dye channel to render (1-based index matching dye order).
        output_path: Where to save the PNG image.
        intensity_percentile: Percentile for intensity clipping (controls
            contrast). Lower values increase contrast for weak signals.
        height: Height of the gel area in pixels.
        labels: Optional lane labels. Defaults to well ID from each file.

    Returns:
        The output path.
    """
    output_path = Path(output_path)

    abi_files = [AbifFile(p) for p in abi_paths]
    signals = _extract_signals(abi_files, channel)

    if labels is None:
        labels = [abi.well or abi.sample_name or p.stem for abi, p in zip(abi_files, abi_paths)]

    max_len = max(len(s) for s in signals)
    signals = _pad_and_normalize(signals, max_len, intensity_percentile)
    signals = _resample(signals, height)

    num_lanes = len(signals)
    img_width = 2 * MARGIN + num_lanes * LANE_WIDTH + (num_lanes - 1) * LANE_SPACING
    img_height = LABEL_HEIGHT + height

    gel = np.full((img_height, img_width), BACKGROUND, dtype=np.uint8)

    horizontal_profile = _gaussian_profile(LANE_WIDTH)

    for i, signal in enumerate(signals):
        x_start = MARGIN + i * (LANE_WIDTH + LANE_SPACING)
        lane = signal[:, np.newaxis] * horizontal_profile[np.newaxis, :]
        pixel_values = BACKGROUND - (BACKGROUND - BAND_FLOOR) * lane
        gel[LABEL_HEIGHT:, x_start : x_start + LANE_WIDTH] = pixel_values.astype(np.uint8)

    image = Image.fromarray(gel, mode="L")

    draw = ImageDraw.Draw(image)
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", 11)
    except OSError:
        font = ImageFont.load_default(size=11)
    for i, label in enumerate(labels):
        x_center = MARGIN + i * (LANE_WIDTH + LANE_SPACING) + LANE_WIDTH // 2
        bbox = draw.textbbox((0, 0), label, font=font)
        text_width = bbox[2] - bbox[0]
        draw.text((x_center - text_width // 2, 3), label, fill=0, font=font)

    image.save(output_path)
    return output_path


def _extract_signals(
    abi_files: list[AbifFile], channel: int
) -> list[np.ndarray]:
    signals = []
    for abi in abi_files:
        raw = abi.raw_channels
        if channel not in raw:
            available = sorted(raw.keys())
            msg = f"Channel {channel} not found in {abi.path.name}. Available: {available}"
            raise ValueError(msg)
        signals.append(np.array(raw[channel], dtype=np.float64))
    return signals


def _pad_and_normalize(
    signals: list[np.ndarray],
    target_length: int,
    clip_percentile: float,
) -> list[np.ndarray]:
    """Pad signals to equal length and normalize intensities to 0-1."""
    padded = []
    for s in signals:
        s = np.clip(s, 0, None)
        if len(s) < target_length:
            s = np.pad(s, (0, target_length - len(s)))
        padded.append(s)

    all_values = np.concatenate(padded)
    clip_max = np.percentile(all_values, clip_percentile)
    if clip_max <= 0:
        clip_max = 1.0

    normalized = []
    for s in padded:
        s = np.clip(s, 0, clip_max) / clip_max
        normalized.append(s)
    return normalized


def _resample(signals: list[np.ndarray], target_length: int) -> list[np.ndarray]:
    """Resample signals to a target length using linear interpolation."""
    resampled = []
    for s in signals:
        orig_x = np.linspace(0, 1, len(s))
        new_x = np.linspace(0, 1, target_length)
        resampled.append(np.interp(new_x, orig_x, s))
    return resampled


def _gaussian_profile(width: int) -> np.ndarray:
    """1D Gaussian centered in the lane for realistic band shape."""
    x = np.linspace(-1, 1, width)
    sigma = 0.45
    profile = np.exp(-0.5 * (x / sigma) ** 2)
    return profile
