//! Lift blacks: raises the black point for a faded, matte film look.

use serde::Deserialize;

use super::util::map_rgb;
use crate::ImageBuf;

#[derive(Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Params {
    /// 0.0..=1.0. At 1.0 the deepest black is lifted to ~18% gray.
    pub amount: f32,
}

impl Default for Params {
    fn default() -> Self {
        Self { amount: 0.5 }
    }
}

pub fn apply(image: &mut ImageBuf, params: &Params) {
    let lift = params.amount.clamp(0.0, 1.0) * 0.18;
    let adjust = |v: f32| lift + v.max(0.0) * (1.0 - lift);
    map_rgb(image, |r, g, b| (adjust(r), adjust(g), adjust(b)));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn black_is_lifted_white_is_kept() {
        let mut img = ImageBuf { width: 2, height: 1, data: vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0] };
        apply(&mut img, &Params { amount: 1.0 });
        assert!((img.data[0] - 0.18).abs() < 1e-6);
        assert!((img.data[4] - 1.0).abs() < 1e-6);
    }
}
