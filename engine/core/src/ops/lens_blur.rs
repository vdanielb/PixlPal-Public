//! Lens blur: a soft, resolution-independent gaussian defocus.

use serde::Deserialize;

use super::util::gaussian_blur_rgb;
use crate::ImageBuf;

#[derive(Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Params {
    /// 0.0..=1.0 blur radius, where 1.0 is ~5% of the image's smaller side.
    pub radius: f32,
}

impl Default for Params {
    fn default() -> Self {
        Self { radius: 0.3 }
    }
}

pub fn apply(image: &mut ImageBuf, params: &Params) {
    let radius = params.radius.clamp(0.0, 1.0);
    if radius == 0.0 {
        return;
    }
    let sigma = radius * 0.05 * image.min_dim();
    image.data = gaussian_blur_rgb(image, sigma);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blur_reduces_local_contrast() {
        // Vertical black/white stripes.
        let (w, h) = (32u32, 32u32);
        let mut data = Vec::new();
        for _y in 0..h {
            for x in 0..w {
                let v = if x % 2 == 0 { 0.0 } else { 1.0 };
                data.extend_from_slice(&[v, v, v, 1.0]);
            }
        }
        let mut img = ImageBuf { width: w, height: h, data };
        apply(&mut img, &Params { radius: 0.8 });
        let a = img.data[(16 * 32 + 15) as usize * 4];
        let b = img.data[(16 * 32 + 16) as usize * 4];
        assert!((a - b).abs() < 0.2, "stripes should smear together");
    }

    #[test]
    fn zero_radius_is_noop() {
        let mut img = ImageBuf { width: 4, height: 4, data: vec![0.3; 64] };
        let before = img.data.clone();
        apply(&mut img, &Params { radius: 0.0 });
        assert_eq!(img.data, before);
    }
}
