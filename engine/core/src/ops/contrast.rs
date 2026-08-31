//! Contrast: expands or compresses tones around middle gray.

use serde::Deserialize;

use super::util::map_rgb;
use crate::ImageBuf;

#[derive(Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Params {
    /// -1.0..=1.0. Positive increases contrast, negative flattens.
    pub amount: f32,
}

impl Default for Params {
    fn default() -> Self {
        Self { amount: 0.0 }
    }
}

pub fn apply(image: &mut ImageBuf, params: &Params) {
    let a = params.amount.clamp(-1.0, 1.0);
    // Up to 1.8x expansion, down to 0.4x compression around the 0.5 pivot.
    let slope = if a >= 0.0 { 1.0 + a * 0.8 } else { 1.0 + a * 0.6 };
    let adjust = |v: f32| (v - 0.5) * slope + 0.5;
    map_rgb(image, |r, g, b| (adjust(r), adjust(g), adjust(b)));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_around_midpoint() {
        let mut img = ImageBuf { width: 2, height: 1, data: vec![0.25, 0.25, 0.25, 1.0, 0.75, 0.75, 0.75, 1.0] };
        apply(&mut img, &Params { amount: 1.0 });
        assert!(img.data[0] < 0.25, "shadows push darker");
        assert!(img.data[4] > 0.75, "highlights push brighter");
    }

    #[test]
    fn pivot_is_stable() {
        let mut img = ImageBuf { width: 1, height: 1, data: vec![0.5, 0.5, 0.5, 1.0] };
        apply(&mut img, &Params { amount: 0.7 });
        assert!((img.data[0] - 0.5).abs() < 1e-6);
    }
}
