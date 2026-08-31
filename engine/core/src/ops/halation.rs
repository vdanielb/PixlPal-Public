//! Halation: the red-orange halo film produces around bright highlights,
//! caused by light scattering back through the emulsion.

use serde::Deserialize;

use super::util::{bright_pass, gaussian_blur_rgb, screen_blend};
use crate::ImageBuf;

#[derive(Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Params {
    /// 0.0..=1.0 halo intensity.
    pub strength: f32,
    /// 0.0..=1.0 luminance threshold for what counts as a highlight.
    pub threshold: f32,
    /// 0.0..=1.0 halo spread, where 1.0 is ~6% of the smaller image side.
    pub radius: f32,
}

impl Default for Params {
    fn default() -> Self {
        Self { strength: 0.4, threshold: 0.75, radius: 0.4 }
    }
}

/// Halation reads warm: strong in red, weak in green, almost none in blue.
const TINT: [f32; 3] = [1.0, 0.35, 0.12];

pub fn apply(image: &mut ImageBuf, params: &Params) {
    let strength = params.strength.clamp(0.0, 1.0);
    if strength == 0.0 {
        return;
    }
    let bright = bright_pass(image, params.threshold.clamp(0.0, 1.0));
    let glow_src = ImageBuf { width: image.width, height: image.height, data: bright };
    let sigma = params.radius.clamp(0.0, 1.0) * 0.06 * image.min_dim();
    let glow = gaussian_blur_rgb(&glow_src, sigma.max(1.0));
    screen_blend(image, &glow, strength, TINT);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn halo_is_red_shifted() {
        // Dark field with a bright white block.
        let (w, h) = (64u32, 64u32);
        let mut data = vec![0.0f32; (w * h * 4) as usize];
        for i in (3..data.len()).step_by(4) {
            data[i] = 1.0;
        }
        for dy in 28..36 {
            for dx in 28..36 {
                let idx = ((dy * w + dx) * 4) as usize;
                data[idx] = 1.0;
                data[idx + 1] = 1.0;
                data[idx + 2] = 1.0;
            }
        }
        let mut img = ImageBuf { width: w, height: h, data };
        apply(&mut img, &Params { strength: 1.0, threshold: 0.6, radius: 1.0 });

        // A pixel just outside the bright block should have picked up more
        // red than blue.
        let idx = ((32 * w + 24) * 4) as usize;
        assert!(img.data[idx] > 0.01, "halo should reach this pixel");
        assert!(img.data[idx] > img.data[idx + 2] * 2.0, "halo should be red-dominant");
    }
}
