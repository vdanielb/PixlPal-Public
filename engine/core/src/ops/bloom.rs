//! Bloom: bright areas glow softly outward, like an over-exposed lens.

use serde::Deserialize;

use super::util::{bright_pass, gaussian_blur_rgb, screen_blend};
use crate::ImageBuf;

#[derive(Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Params {
    /// 0.0..=1.0 glow intensity.
    pub strength: f32,
    /// 0.0..=1.0 luminance threshold above which pixels bloom.
    pub threshold: f32,
    /// 0.0..=1.0 glow spread, where 1.0 is ~8% of the smaller image side.
    pub radius: f32,
}

impl Default for Params {
    fn default() -> Self {
        Self { strength: 0.5, threshold: 0.65, radius: 0.5 }
    }
}

pub fn apply(image: &mut ImageBuf, params: &Params) {
    let strength = params.strength.clamp(0.0, 1.0);
    if strength == 0.0 {
        return;
    }
    let bright = bright_pass(image, params.threshold.clamp(0.0, 1.0));
    let glow_src = ImageBuf { width: image.width, height: image.height, data: bright };
    let sigma = params.radius.clamp(0.0, 1.0) * 0.08 * image.min_dim();
    let glow = gaussian_blur_rgb(&glow_src, sigma.max(1.0));
    screen_blend(image, &glow, strength * 0.8, [1.0, 1.0, 1.0]);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spot_image(w: u32, h: u32) -> ImageBuf {
        // Dark field with a bright 4x4 spot in the middle.
        let mut data = vec![0.0f32; (w * h * 4) as usize];
        for i in (3..data.len()).step_by(4) {
            data[i] = 1.0;
        }
        for dy in 0..4 {
            for dx in 0..4 {
                let idx = (((h / 2 + dy) * w + w / 2 + dx) * 4) as usize;
                data[idx] = 1.0;
                data[idx + 1] = 1.0;
                data[idx + 2] = 1.0;
            }
        }
        ImageBuf { width: w, height: h, data }
    }

    #[test]
    fn bright_spot_spills_into_neighbors() {
        let mut img = spot_image(64, 64);
        // 4px to the left of the bright spot's edge.
        let neighbor = ((33 * 64 + 28) * 4) as usize;
        assert_eq!(img.data[neighbor], 0.0);
        apply(&mut img, &Params { strength: 1.0, threshold: 0.6, radius: 1.0 });
        assert!(img.data[neighbor] > 0.01, "glow should reach nearby dark pixels");
    }

    #[test]
    fn dark_image_does_not_bloom() {
        let mut img = ImageBuf { width: 16, height: 16, data: vec![0.2; 16 * 16 * 4] };
        let before = img.data.clone();
        apply(&mut img, &Params { strength: 1.0, threshold: 0.7, radius: 0.5 });
        let max_delta = img
            .data
            .iter()
            .zip(&before)
            .map(|(a, b)| (a - b).abs())
            .fold(0.0f32, f32::max);
        assert!(max_delta < 0.02, "nothing above threshold, nothing should glow");
    }
}
