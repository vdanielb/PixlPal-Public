//! Color balance: warm/cool temperature and green/magenta tint shifts.

use serde::Deserialize;

use super::util::map_rgb;
use crate::ImageBuf;

#[derive(Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Params {
    /// -1.0..=1.0. Positive is warmer (toward orange), negative cooler (toward blue).
    pub temperature: f32,
    /// -1.0..=1.0. Positive is magenta, negative is green.
    pub tint: f32,
}

impl Default for Params {
    fn default() -> Self {
        Self { temperature: 0.0, tint: 0.0 }
    }
}

pub fn apply(image: &mut ImageBuf, params: &Params) {
    let temp = params.temperature.clamp(-1.0, 1.0);
    let tint = params.tint.clamp(-1.0, 1.0);
    let r_gain = 1.0 + 0.20 * temp + 0.06 * tint;
    let g_gain = 1.0 - 0.12 * tint;
    let b_gain = 1.0 - 0.20 * temp + 0.06 * tint;
    map_rgb(image, |r, g, b| (r * r_gain, g * g_gain, b * b_gain));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn warm_raises_red_lowers_blue() {
        let mut img = ImageBuf { width: 1, height: 1, data: vec![0.5, 0.5, 0.5, 1.0] };
        apply(&mut img, &Params { temperature: 1.0, tint: 0.0 });
        assert!(img.data[0] > 0.5);
        assert!(img.data[2] < 0.5);
        assert!((img.data[1] - 0.5).abs() < 1e-6);
    }

    #[test]
    fn green_tint_raises_green() {
        let mut img = ImageBuf { width: 1, height: 1, data: vec![0.5, 0.5, 0.5, 1.0] };
        apply(&mut img, &Params { temperature: 0.0, tint: -1.0 });
        assert!(img.data[1] > 0.5);
    }
}
