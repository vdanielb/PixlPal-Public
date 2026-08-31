//! Shadows / Highlights: Lightroom-style dual tonal recovery.
//!
//! Opens or recovers shadows and highlights independently with soft falloffs
//! toward mid-gray. Stronger than `dodge_burn` (±2 stops at full throw) and
//! intended for whole-frame Basic-panel edits (still maskable via the pipeline).

use serde::Deserialize;

use super::util::{lerp, luma};
use crate::ImageBuf;

#[derive(Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Params {
    /// -1.0..=1.0. Positive opens shadows; negative darkens them.
    pub shadows: f32,
    /// -1.0..=1.0. Positive brightens highlights; negative recovers them.
    pub highlights: f32,
}

impl Default for Params {
    fn default() -> Self {
        Self {
            shadows: 0.0,
            highlights: 0.0,
        }
    }
}

/// Soft weight in 0..1 for the shadows band at luma `l` (0..1).
/// Strong in darks, ~0 by mid-gray.
fn shadow_weight(l: f32) -> f32 {
    let l = l.clamp(0.0, 1.0);
    (1.0 - l * 2.0).clamp(0.0, 1.0).powi(2)
}

/// Soft weight in 0..1 for the highlights band at luma `l` (0..1).
/// Strong in brights, ~0 by mid-gray.
fn highlight_weight(l: f32) -> f32 {
    let l = l.clamp(0.0, 1.0);
    ((l - 0.5) * 2.0).clamp(0.0, 1.0).powi(2)
}

pub fn apply(image: &mut ImageBuf, params: &Params) {
    let shadows = params.shadows.clamp(-1.0, 1.0);
    let highlights = params.highlights.clamp(-1.0, 1.0);
    if shadows.abs() < 1e-6 && highlights.abs() < 1e-6 {
        return;
    }
    // ±2 stops at full throw — between dodge_burn (±1.5) and exposure (±2.5).
    let gain_s = 2f32.powf(shadows * 2.0);
    let gain_h = 2f32.powf(highlights * 2.0);
    for px in image.data.chunks_exact_mut(4) {
        let l = luma(px[0], px[1], px[2]);
        let w_s = shadow_weight(l);
        let w_h = highlight_weight(l);
        let scale = lerp(1.0, gain_s, w_s) * lerp(1.0, gain_h, w_h);
        if (scale - 1.0).abs() < 1e-6 {
            continue;
        }
        px[0] *= scale;
        px[1] *= scale;
        px[2] *= scale;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neutral_at_zero() {
        let mut img = ImageBuf {
            width: 1,
            height: 1,
            data: vec![0.2, 0.5, 0.8, 1.0],
        };
        apply(&mut img, &Params::default());
        assert_eq!(img.data, vec![0.2, 0.5, 0.8, 1.0]);
    }

    #[test]
    fn positive_shadows_lifts_dark_more_than_bright() {
        let mut img = ImageBuf {
            width: 2,
            height: 1,
            data: vec![0.15, 0.15, 0.15, 1.0, 0.85, 0.85, 0.85, 1.0],
        };
        let dark_before = img.data[0];
        let bright_before = img.data[4];
        apply(
            &mut img,
            &Params {
                shadows: 0.8,
                highlights: 0.0,
            },
        );
        let dark_delta = img.data[0] - dark_before;
        let bright_delta = img.data[4] - bright_before;
        assert!(dark_delta > 0.0, "shadows should lift dark pixels");
        assert!(
            dark_delta > bright_delta.abs() + 0.01,
            "dark lift should exceed bright change"
        );
    }

    #[test]
    fn negative_highlights_pulls_bright_more_than_dark() {
        let mut img = ImageBuf {
            width: 2,
            height: 1,
            data: vec![0.15, 0.15, 0.15, 1.0, 0.85, 0.85, 0.85, 1.0],
        };
        let dark_before = img.data[0];
        let bright_before = img.data[4];
        apply(
            &mut img,
            &Params {
                shadows: 0.0,
                highlights: -0.8,
            },
        );
        let dark_delta = (img.data[0] - dark_before).abs();
        let bright_delta = bright_before - img.data[4];
        assert!(bright_delta > 0.0, "negative highlights should pull brights down");
        assert!(
            bright_delta > dark_delta + 0.01,
            "bright recovery should exceed dark change"
        );
    }

    #[test]
    fn mid_gray_mostly_stable() {
        let mut img = ImageBuf {
            width: 1,
            height: 1,
            data: vec![0.5, 0.5, 0.5, 1.0],
        };
        apply(
            &mut img,
            &Params {
                shadows: 0.7,
                highlights: -0.7,
            },
        );
        assert!(
            (img.data[0] - 0.5).abs() < 0.02,
            "mid-gray should stay near identity, got {}",
            img.data[0]
        );
    }
}
