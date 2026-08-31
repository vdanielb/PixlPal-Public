//! Exposure: brightens or darkens the whole image in photographic stops.

use serde::Deserialize;

use super::util::map_rgb;
use crate::ImageBuf;

#[derive(Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Params {
    /// -1.0..=1.0, mapped to ±2.5 stops. 0 is neutral.
    pub amount: f32,
}

impl Default for Params {
    fn default() -> Self {
        Self { amount: 0.0 }
    }
}

pub fn apply(image: &mut ImageBuf, params: &Params) {
    let gain = 2f32.powf(params.amount.clamp(-1.0, 1.0) * 2.5);
    map_rgb(image, |r, g, b| (r * gain, g * gain, b * gain));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn brightens_and_darkens() {
        let mut img = ImageBuf { width: 1, height: 1, data: vec![0.4, 0.4, 0.4, 1.0] };
        apply(&mut img, &Params { amount: 0.5 });
        assert!(img.data[0] > 0.4);

        let mut img = ImageBuf { width: 1, height: 1, data: vec![0.4, 0.4, 0.4, 1.0] };
        apply(&mut img, &Params { amount: -0.5 });
        assert!(img.data[0] < 0.4);
    }

    #[test]
    fn neutral_at_zero() {
        let mut img = ImageBuf { width: 1, height: 1, data: vec![0.4, 0.5, 0.6, 1.0] };
        apply(&mut img, &Params::default());
        assert_eq!(img.data, vec![0.4, 0.5, 0.6, 1.0]);
    }
}
