//! Saturation: pushes colors toward (or away from) their grayscale value.

use serde::Deserialize;

use super::util::{lerp, luma, map_rgb};
use crate::ImageBuf;

#[derive(Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Params {
    /// -1.0..=1.0. -1 is fully desaturated, +1 doubles saturation.
    pub amount: f32,
}

impl Default for Params {
    fn default() -> Self {
        Self { amount: 0.0 }
    }
}

pub fn apply(image: &mut ImageBuf, params: &Params) {
    let sat = 1.0 + params.amount.clamp(-1.0, 1.0);
    map_rgb(image, |r, g, b| {
        let l = luma(r, g, b);
        (lerp(l, r, sat), lerp(l, g, sat), lerp(l, b, sat))
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn minus_one_is_grayscale() {
        let mut img = ImageBuf { width: 1, height: 1, data: vec![0.9, 0.2, 0.1, 1.0] };
        apply(&mut img, &Params { amount: -1.0 });
        assert!((img.data[0] - img.data[1]).abs() < 1e-6);
        assert!((img.data[1] - img.data[2]).abs() < 1e-6);
    }

    #[test]
    fn positive_increases_channel_spread() {
        let mut img = ImageBuf { width: 1, height: 1, data: vec![0.7, 0.4, 0.3, 1.0] };
        apply(&mut img, &Params { amount: 0.8 });
        assert!(img.data[0] - img.data[2] > 0.4);
    }
}
