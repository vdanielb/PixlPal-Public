//! Vignette: darkens the frame edges with a smooth radial falloff.

use serde::Deserialize;

use super::util::smoothstep;
use crate::ImageBuf;

#[derive(Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Params {
    /// 0.0..=1.0 darkening strength at the corners.
    pub amount: f32,
    /// 0.0..=1.0 size of the untouched center region (bigger = subtler).
    pub size: f32,
}

impl Default for Params {
    fn default() -> Self {
        Self { amount: 0.5, size: 0.5 }
    }
}

pub fn apply(image: &mut ImageBuf, params: &Params) {
    let amount = params.amount.clamp(0.0, 1.0);
    if amount == 0.0 {
        return;
    }
    let size = params.size.clamp(0.0, 1.0);
    let w = image.width as usize;
    let (cx, cy) = (image.width as f32 / 2.0, image.height as f32 / 2.0);
    // Distance normalized so the corner is 1.0.
    let corner = (cx * cx + cy * cy).sqrt();
    let inner = 0.25 + size * 0.6;

    for (i, px) in image.data.chunks_exact_mut(4).enumerate() {
        let x = (i % w) as f32 + 0.5;
        let y = (i / w) as f32 + 0.5;
        let d = ((x - cx).powi(2) + (y - cy).powi(2)).sqrt() / corner;
        let falloff = smoothstep(inner, 1.05, d);
        let gain = 1.0 - amount * falloff;
        px[0] *= gain;
        px[1] *= gain;
        px[2] *= gain;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corners_darken_center_stays() {
        let mut img = ImageBuf { width: 32, height: 32, data: vec![0.8; 32 * 32 * 4] };
        apply(&mut img, &Params { amount: 0.8, size: 0.3 });
        let center = ((16 * 32 + 16) * 4) as usize;
        let corner = 0usize;
        assert!((img.data[center] - 0.8).abs() < 0.05, "center nearly untouched");
        assert!(img.data[corner] < 0.6, "corner clearly darkened");
    }
}
