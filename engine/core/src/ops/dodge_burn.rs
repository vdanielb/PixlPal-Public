//! Dodge / burn: photographic local lighten/darken weighted by luma range.
//!
//! Milder than global exposure (±1.5 stops at full amount). Designed to be
//! used with masks for local edits ("brighten dress midtones", "burn sky
//! highlights").

use serde::Deserialize;

use super::util::{lerp, luma};
use crate::ImageBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Range {
    Shadows,
    Midtones,
    Highlights,
}

impl Default for Range {
    fn default() -> Self {
        Self::Midtones
    }
}

#[derive(Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Params {
    /// -1.0..=1.0. Positive dodges (lightens), negative burns (darkens).
    pub amount: f32,
    /// Which tonal band to emphasize.
    pub range: Range,
}

impl Default for Params {
    fn default() -> Self {
        Self {
            amount: 0.0,
            range: Range::Midtones,
        }
    }
}

/// Soft weight in 0..1 for the selected tonal range at luma `l` (0..1).
fn range_weight(range: Range, l: f32) -> f32 {
    let l = l.clamp(0.0, 1.0);
    match range {
        // High in shadows, falls off through mids.
        Range::Shadows => (1.0 - l * 2.0).clamp(0.0, 1.0).powi(2),
        // Peaks around middle gray.
        Range::Midtones => {
            let d = (l - 0.5) * 2.0;
            (1.0 - d * d).clamp(0.0, 1.0)
        }
        // High in highlights, falls off through mids.
        Range::Highlights => ((l - 0.5) * 2.0).clamp(0.0, 1.0).powi(2),
    }
}

pub fn apply(image: &mut ImageBuf, params: &Params) {
    let amount = params.amount.clamp(-1.0, 1.0);
    if amount.abs() < 1e-6 {
        return;
    }
    // Milder than global exposure (±2.5 stops): ±1.5 stops at full throw.
    let gain = 2f32.powf(amount * 1.5);
    for px in image.data.chunks_exact_mut(4) {
        let w = range_weight(params.range, luma(px[0], px[1], px[2]));
        if w <= 0.0 {
            continue;
        }
        px[0] = lerp(px[0], px[0] * gain, w);
        px[1] = lerp(px[1], px[1] * gain, w);
        px[2] = lerp(px[2], px[2] * gain, w);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gray(l: f32) -> ImageBuf {
        ImageBuf {
            width: 1,
            height: 1,
            data: vec![l, l, l, 1.0],
        }
    }

    #[test]
    fn zero_amount_is_identity() {
        let mut img = gray(0.4);
        apply(&mut img, &Params { amount: 0.0, range: Range::Midtones });
        assert!((img.data[0] - 0.4).abs() < 1e-6);
    }

    #[test]
    fn shadows_affect_dark_more_than_bright() {
        let mut dark = gray(0.15);
        let mut bright = gray(0.85);
        let params = Params {
            amount: 0.6,
            range: Range::Shadows,
        };
        apply(&mut dark, &params);
        apply(&mut bright, &params);
        let dark_delta = dark.data[0] - 0.15;
        let bright_delta = bright.data[0] - 0.85;
        assert!(dark_delta > 0.0);
        assert!(dark_delta > bright_delta.abs() + 0.01);
    }

    #[test]
    fn highlights_affect_bright_more_than_dark() {
        let mut dark = gray(0.15);
        let mut bright = gray(0.85);
        let params = Params {
            amount: -0.6,
            range: Range::Highlights,
        };
        apply(&mut dark, &params);
        apply(&mut bright, &params);
        let dark_delta = (dark.data[0] - 0.15).abs();
        let bright_delta = (bright.data[0] - 0.85).abs();
        assert!(bright_delta > dark_delta + 0.01);
    }

    #[test]
    fn midtones_peak_near_middle_gray() {
        let mut shadow = gray(0.1);
        let mut mid = gray(0.5);
        let mut hi = gray(0.9);
        let params = Params {
            amount: 0.5,
            range: Range::Midtones,
        };
        apply(&mut shadow, &params);
        apply(&mut mid, &params);
        apply(&mut hi, &params);
        let mid_delta = mid.data[0] - 0.5;
        let shadow_delta = shadow.data[0] - 0.1;
        let hi_delta = hi.data[0] - 0.9;
        assert!(mid_delta > shadow_delta);
        assert!(mid_delta > hi_delta);
    }
}
