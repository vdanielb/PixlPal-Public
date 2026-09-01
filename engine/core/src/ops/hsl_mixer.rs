//! HSL mixer: Lightroom-style per-hue-band hue / saturation / luminance.
//!
//! Eight overlapping bands around the color wheel. Near-grays are gated out
//! so the mixer does not tint neutrals. Hue throw is ±30° at full amount.

use serde::Deserialize;

use super::util::{hsl_to_rgb, rgb_to_hsl, smoothstep};
use crate::ImageBuf;

const BAND_COUNT: usize = 8;
/// Lightroom-ish centers: red, orange, yellow, green, aqua, blue, purple, magenta.
const BAND_CENTERS: [f32; BAND_COUNT] = [0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 280.0, 320.0];
/// Degrees of hue rotation at amount = ±1.
const HUE_THROW: f32 = 30.0;

#[derive(Debug, Deserialize, Default)]
#[serde(default, deny_unknown_fields)]
pub struct Params {
    pub red_hue: f32,
    pub red_sat: f32,
    pub red_lum: f32,
    pub orange_hue: f32,
    pub orange_sat: f32,
    pub orange_lum: f32,
    pub yellow_hue: f32,
    pub yellow_sat: f32,
    pub yellow_lum: f32,
    pub green_hue: f32,
    pub green_sat: f32,
    pub green_lum: f32,
    pub aqua_hue: f32,
    pub aqua_sat: f32,
    pub aqua_lum: f32,
    pub blue_hue: f32,
    pub blue_sat: f32,
    pub blue_lum: f32,
    pub purple_hue: f32,
    pub purple_sat: f32,
    pub purple_lum: f32,
    pub magenta_hue: f32,
    pub magenta_sat: f32,
    pub magenta_lum: f32,
}

impl Params {
    fn is_noop(&self) -> bool {
        self.as_bands()
            .iter()
            .all(|&(h, s, l)| h.abs() < 1e-6 && s.abs() < 1e-6 && l.abs() < 1e-6)
    }

    fn as_bands(&self) -> [(f32, f32, f32); BAND_COUNT] {
        [
            (self.red_hue, self.red_sat, self.red_lum),
            (self.orange_hue, self.orange_sat, self.orange_lum),
            (self.yellow_hue, self.yellow_sat, self.yellow_lum),
            (self.green_hue, self.green_sat, self.green_lum),
            (self.aqua_hue, self.aqua_sat, self.aqua_lum),
            (self.blue_hue, self.blue_sat, self.blue_lum),
            (self.purple_hue, self.purple_sat, self.purple_lum),
            (self.magenta_hue, self.magenta_sat, self.magenta_lum),
        ]
    }
}

/// Piecewise-linear weights on the circular hue wheel: a hue belongs to the
/// two neighboring band centers and nowhere else.
fn band_weights(hue: f32) -> [f32; BAND_COUNT] {
    let h = ((hue % 360.0) + 360.0) % 360.0;
    let mut next = 0usize;
    for (i, &center) in BAND_CENTERS.iter().enumerate() {
        if center > h {
            next = i;
            break;
        }
        if i == BAND_COUNT - 1 {
            next = 0;
        }
    }
    let prev = if next == 0 { BAND_COUNT - 1 } else { next - 1 };
    let c_prev = BAND_CENTERS[prev];
    let c_next = BAND_CENTERS[next];
    let span = if next == 0 {
        (360.0 - c_prev) + c_next
    } else {
        c_next - c_prev
    };
    let dist = if next == 0 {
        (h - c_prev + 360.0) % 360.0
    } else {
        h - c_prev
    };
    let t = if span.abs() < 1e-6 {
        0.0
    } else {
        (dist / span).clamp(0.0, 1.0)
    };
    let mut w = [0.0f32; BAND_COUNT];
    w[prev] = 1.0 - t;
    w[next] = t;
    w
}

pub fn apply(image: &mut ImageBuf, params: &Params) {
    if params.is_noop() {
        return;
    }
    let bands = params.as_bands();
    for px in image.data.chunks_exact_mut(4) {
        let (h, s, l) = rgb_to_hsl(px[0], px[1], px[2]);
        let chroma = smoothstep(0.03, 0.15, s);
        if chroma <= 0.0 {
            continue;
        }
        let weights = band_weights(h);
        let mut dh = 0.0;
        let mut ds = 0.0;
        let mut dl = 0.0;
        for i in 0..BAND_COUNT {
            let (hue, sat, lum) = bands[i];
            let w = weights[i];
            dh += w * hue.clamp(-1.0, 1.0);
            ds += w * sat.clamp(-1.0, 1.0);
            dl += w * lum.clamp(-1.0, 1.0);
        }
        let h2 = h + dh * chroma * HUE_THROW;
        let s2 = (s * (1.0 + ds * chroma)).clamp(0.0, 1.0);
        let l2 = (l * (1.0 + dl * 0.5 * chroma)).clamp(0.0, 1.0);
        let (r, g, b) = hsl_to_rgb(h2, s2, l2);
        px[0] = r;
        px[1] = g;
        px[2] = b;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ops::util::{hue_distance, rgb_to_hsl};

    fn pixel(r: f32, g: f32, b: f32) -> ImageBuf {
        ImageBuf {
            width: 1,
            height: 1,
            data: vec![r, g, b, 1.0],
        }
    }

    #[test]
    fn rgb_hsl_roundtrip_primary_green() {
        let (h, s, l) = rgb_to_hsl(0.0, 1.0, 0.0);
        assert!((h - 120.0).abs() < 0.5);
        assert!((s - 1.0).abs() < 1e-5);
        assert!((l - 0.5).abs() < 1e-5);
        let (r, g, b) = hsl_to_rgb(h, s, l);
        assert!((r - 0.0).abs() < 1e-5);
        assert!((g - 1.0).abs() < 1e-5);
        assert!((b - 0.0).abs() < 1e-5);
    }

    #[test]
    fn gray_is_untouched() {
        let mut img = pixel(0.5, 0.5, 0.5);
        apply(
            &mut img,
            &Params {
                green_sat: 1.0,
                green_lum: 1.0,
                red_hue: 1.0,
                ..Params::default()
            },
        );
        assert!((img.data[0] - 0.5).abs() < 1e-5);
        assert!((img.data[1] - 0.5).abs() < 1e-5);
        assert!((img.data[2] - 0.5).abs() < 1e-5);
    }

    #[test]
    fn green_band_boosts_green_not_red() {
        // Muted green and muted red.
        let mut img = ImageBuf {
            width: 2,
            height: 1,
            data: vec![0.25, 0.45, 0.25, 1.0, 0.45, 0.25, 0.25, 1.0],
        };
        apply(
            &mut img,
            &Params {
                green_sat: 1.0,
                ..Params::default()
            },
        );
        let green_spread = img.data[1] - img.data[0];
        let red_spread = img.data[4] - img.data[5];
        let green_spread_before = 0.45 - 0.25;
        assert!(
            green_spread > green_spread_before + 0.05,
            "green pixel should gain saturation, spread {green_spread}"
        );
        assert!(
            (red_spread - (0.45 - 0.25)).abs() < 0.02,
            "red pixel should be mostly untouched by the green band"
        );
    }

    #[test]
    fn red_hue_rotates_a_red_pixel() {
        let mut img = pixel(0.8, 0.15, 0.15);
        let (h_before, _, _) = rgb_to_hsl(img.data[0], img.data[1], img.data[2]);
        apply(
            &mut img,
            &Params {
                red_hue: 1.0,
                ..Params::default()
            },
        );
        let (h_after, _, _) = rgb_to_hsl(img.data[0], img.data[1], img.data[2]);
        let delta = hue_distance(h_after, h_before);
        assert!(
            delta > 10.0,
            "red hue throw should move hue, before={h_before} after={h_after}"
        );
    }

    #[test]
    fn hue_wrap_at_red_affects_magenta_red() {
        // Hue ~350° is between magenta (320) and red (0).
        let (r, g, b) = hsl_to_rgb(350.0, 0.8, 0.45);
        let mut img = pixel(r, g, b);
        apply(
            &mut img,
            &Params {
                red_sat: 1.0,
                ..Params::default()
            },
        );
        let sat_before = 0.8;
        let (_, sat_after, _) = rgb_to_hsl(img.data[0], img.data[1], img.data[2]);
        assert!(
            sat_after > sat_before,
            "a hue-350 pixel should pick up the red band, sat {sat_after}"
        );
    }

    #[test]
    fn band_weights_peak_on_center() {
        let w = band_weights(120.0);
        assert!((w[3] - 1.0).abs() < 1e-5, "green center should be 1");
        assert!(w.iter().enumerate().filter(|(i, _)| *i != 3).all(|(_, v)| *v < 1e-5));
    }
}
