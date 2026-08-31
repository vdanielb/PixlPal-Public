//! Film softness: blends a slight diffusion blur over the image for the
//! gentle, low-microcontrast look of consumer film stocks and diffusion
//! filters. Unlike lens blur, detail stays visible underneath.

use serde::Deserialize;

use super::util::{gaussian_blur_rgb, lerp};
use crate::ImageBuf;

#[derive(Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Params {
    /// 0.0..=1.0 diffusion amount.
    pub amount: f32,
}

impl Default for Params {
    fn default() -> Self {
        Self { amount: 0.5 }
    }
}

pub fn apply(image: &mut ImageBuf, params: &Params) {
    let amount = params.amount.clamp(0.0, 1.0);
    if amount == 0.0 {
        return;
    }
    let sigma = (0.004 + amount * 0.008) * image.min_dim();
    let blurred = gaussian_blur_rgb(image, sigma.max(0.8));
    let mix = amount * 0.55;
    for (px, bl) in image.data.chunks_exact_mut(4).zip(blurred.chunks_exact(4)) {
        px[0] = lerp(px[0], bl[0], mix);
        px[1] = lerp(px[1], bl[1], mix);
        px[2] = lerp(px[2], bl[2], mix);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn softens_but_preserves_structure() {
        // Vertical black/white stripes, 4px wide.
        let (w, h) = (32u32, 32u32);
        let mut data = Vec::new();
        for _y in 0..h {
            for x in 0..w {
                let v = if (x / 4) % 2 == 0 { 0.0 } else { 1.0 };
                data.extend_from_slice(&[v, v, v, 1.0]);
            }
        }
        let mut img = ImageBuf { width: w, height: h, data };
        apply(&mut img, &Params { amount: 1.0 });
        // Sample just either side of a stripe boundary (x=3 dark, x=4 light).
        let dark = img.data[(16 * 32 + 3) as usize * 4];
        let light = img.data[(16 * 32 + 4) as usize * 4];
        assert!(light - dark > 0.3, "structure must survive");
        assert!(dark > 0.0, "shadows should soften up");
        assert!(light < 1.0, "highlights should soften down");
    }
}
