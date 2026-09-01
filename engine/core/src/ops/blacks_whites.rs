//! Blacks / Whites: Lightroom-style endpoint controls.
//!
//! Moves the black point and white point rather than broad tonal bands —
//! the weights are concentrated near the extremes and fade out well before
//! mid-gray (contrast `shadows_highlights`, whose bands reach mid-gray).
//! Positive whites is allowed to push values past 1.0 so users can set where
//! clipping begins; negative blacks likewise crushes to (and clips at) 0.

use serde::Deserialize;

use super::util::luma;
use crate::ImageBuf;

/// Maximum black-point shift at full throw (matches the old lift_blacks cap).
const BLACKS_REACH: f32 = 0.18;
/// Maximum white-point shift at full throw. Large enough that whites = 1.0
/// clips everything from ~0.75 luma upward.
const WHITES_REACH: f32 = 0.3;

#[derive(Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Params {
    /// -1.0..=1.0. Positive lifts the black point (matte); negative crushes
    /// deep shadows toward (and into) clipping.
    pub blacks: f32,
    /// -1.0..=1.0. Positive stretches brights toward (and past) clipping;
    /// negative pulls the white point down.
    pub whites: f32,
}

impl Default for Params {
    fn default() -> Self {
        Self {
            blacks: 0.0,
            whites: 0.0,
        }
    }
}

/// Weight for the blacks band at luma `l`: 1 at black, ~0 by l = 0.25.
fn black_weight(l: f32) -> f32 {
    (1.0 - l.clamp(0.0, 1.0) / 0.25).clamp(0.0, 1.0).powi(2)
}

/// Weight for the whites band at luma `l`: 1 at white, ~0 by l = 0.75.
fn white_weight(l: f32) -> f32 {
    ((l.clamp(0.0, 1.0) - 0.75) / 0.25).clamp(0.0, 1.0).powi(2)
}

pub fn apply(image: &mut ImageBuf, params: &Params) {
    let blacks = params.blacks.clamp(-1.0, 1.0);
    let whites = params.whites.clamp(-1.0, 1.0);
    if blacks.abs() < 1e-6 && whites.abs() < 1e-6 {
        return;
    }
    for px in image.data.chunks_exact_mut(4) {
        let l = luma(px[0], px[1], px[2]);
        let delta = blacks * BLACKS_REACH * black_weight(l) + whites * WHITES_REACH * white_weight(l);
        if delta.abs() < 1e-6 {
            continue;
        }
        // Negative light does not exist: crushed blacks clip at 0 here.
        // Values above 1.0 are intentionally kept so whites can clip at
        // output conversion (and interact with later ops like bloom).
        px[0] = (px[0] + delta).max(0.0);
        px[1] = (px[1] + delta).max(0.0);
        px[2] = (px[2] + delta).max(0.0);
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
    fn positive_blacks_lifts_black_point_only() {
        let mut img = ImageBuf {
            width: 2,
            height: 1,
            data: vec![0.0, 0.0, 0.0, 1.0, 0.5, 0.5, 0.5, 1.0],
        };
        apply(
            &mut img,
            &Params {
                blacks: 1.0,
                whites: 0.0,
            },
        );
        assert!((img.data[0] - BLACKS_REACH).abs() < 1e-6, "black should lift to the cap");
        assert!((img.data[4] - 0.5).abs() < 1e-6, "mid-gray should be untouched");
    }

    #[test]
    fn negative_blacks_crushes_and_clips_shadows() {
        let mut img = ImageBuf {
            width: 2,
            height: 1,
            data: vec![0.05, 0.05, 0.05, 1.0, 0.5, 0.5, 0.5, 1.0],
        };
        apply(
            &mut img,
            &Params {
                blacks: -1.0,
                whites: 0.0,
            },
        );
        assert_eq!(img.data[0], 0.0, "deep shadow should crush to hard black");
        assert!((img.data[4] - 0.5).abs() < 1e-6, "mid-gray should be untouched");
    }

    #[test]
    fn positive_whites_clips_brights() {
        let mut img = ImageBuf {
            width: 2,
            height: 1,
            data: vec![0.9, 0.9, 0.9, 1.0, 0.5, 0.5, 0.5, 1.0],
        };
        apply(
            &mut img,
            &Params {
                blacks: 0.0,
                whites: 1.0,
            },
        );
        assert!(img.data[0] >= 1.0, "near-white should be pushed to or past clip, got {}", img.data[0]);
        assert!((img.data[4] - 0.5).abs() < 1e-6, "mid-gray should be untouched");
        // Output conversion clamps to 1.0.
        let bytes = img.to_rgba8();
        assert_eq!(bytes[0], 255);
    }

    #[test]
    fn negative_whites_pulls_white_point_down() {
        let mut img = ImageBuf {
            width: 1,
            height: 1,
            data: vec![1.0, 1.0, 1.0, 1.0],
        };
        apply(
            &mut img,
            &Params {
                blacks: 0.0,
                whites: -1.0,
            },
        );
        assert!((img.data[0] - (1.0 - WHITES_REACH)).abs() < 1e-6);
    }

    #[test]
    fn bands_are_narrower_than_shadows_highlights() {
        // Quarter-tones should be essentially untouched.
        let mut img = ImageBuf {
            width: 2,
            height: 1,
            data: vec![0.3, 0.3, 0.3, 1.0, 0.7, 0.7, 0.7, 1.0],
        };
        apply(
            &mut img,
            &Params {
                blacks: 1.0,
                whites: 1.0,
            },
        );
        assert!((img.data[0] - 0.3).abs() < 1e-6, "0.3 luma is outside the blacks band");
        assert!((img.data[4] - 0.7).abs() < 1e-6, "0.7 luma is outside the whites band");
    }
}
