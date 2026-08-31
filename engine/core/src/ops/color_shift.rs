//! Color shift: rotates every hue around the color wheel.

use serde::Deserialize;

use super::util::map_rgb;
use crate::ImageBuf;

#[derive(Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Params {
    /// -1.0..=1.0, mapped to ±180 degrees of hue rotation.
    pub hue: f32,
}

impl Default for Params {
    fn default() -> Self {
        Self { hue: 0.0 }
    }
}

pub fn apply(image: &mut ImageBuf, params: &Params) {
    let angle = params.hue.clamp(-1.0, 1.0) * std::f32::consts::PI;
    let (sin, cos) = angle.sin_cos();

    // Standard luminance-preserving hue-rotation matrix (as used by
    // SVG/CSS hue-rotate), evaluated once.
    let m = [
        [0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928],
        [0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.140, 0.072 - cos * 0.072 - sin * 0.283],
        [0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072],
    ];

    map_rgb(image, |r, g, b| {
        (
            m[0][0] * r + m[0][1] * g + m[0][2] * b,
            m[1][0] * r + m[1][1] * g + m[1][2] * b,
            m[2][0] * r + m[2][1] * g + m[2][2] * b,
        )
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_is_identity() {
        let mut img = ImageBuf { width: 1, height: 1, data: vec![0.8, 0.3, 0.2, 1.0] };
        apply(&mut img, &Params { hue: 0.0 });
        assert!((img.data[0] - 0.8).abs() < 1e-3);
        assert!((img.data[1] - 0.3).abs() < 1e-3);
        assert!((img.data[2] - 0.2).abs() < 1e-3);
    }

    #[test]
    fn rotation_moves_red_toward_other_channels() {
        let mut img = ImageBuf { width: 1, height: 1, data: vec![1.0, 0.0, 0.0, 1.0] };
        apply(&mut img, &Params { hue: 0.66 }); // ~120 degrees
        assert!(img.data[1] > img.data[0], "red should rotate toward green");
    }

    #[test]
    fn gray_is_unchanged() {
        let mut img = ImageBuf { width: 1, height: 1, data: vec![0.5, 0.5, 0.5, 1.0] };
        apply(&mut img, &Params { hue: 0.5 });
        assert!((img.data[0] - 0.5).abs() < 1e-3);
        assert!((img.data[1] - 0.5).abs() < 1e-3);
        assert!((img.data[2] - 0.5).abs() < 1e-3);
    }
}
