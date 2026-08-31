//! Tone curve: remaps tones through a smooth curve, per channel.
//!
//! Either pick a named preset or supply explicit control points
//! (`[[0,0],[0.5,0.6],[1,1]]`). Points are interpolated with a monotone
//! cubic (Fritsch–Carlson), so curves never overshoot or ring.

use serde::Deserialize;

use super::util::map_rgb;
use crate::ImageBuf;

#[derive(Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Params {
    /// One of: "linear", "soft", "hard", "film".
    pub preset: String,
    /// Optional explicit control points; overrides `preset` when present.
    pub points: Option<Vec<[f32; 2]>>,
}

impl Default for Params {
    fn default() -> Self {
        Self { preset: "soft".to_string(), points: None }
    }
}

fn preset_points(name: &str) -> Vec<[f32; 2]> {
    match name {
        // Gentle S with lifted shadows and eased highlights.
        "soft" => vec![[0.0, 0.04], [0.25, 0.22], [0.5, 0.52], [0.75, 0.8], [1.0, 0.97]],
        // Punchy S-curve.
        "hard" => vec![[0.0, 0.0], [0.25, 0.14], [0.5, 0.5], [0.75, 0.86], [1.0, 1.0]],
        // Faded blacks, rolled-off highlights — classic negative film response.
        "film" => vec![[0.0, 0.08], [0.2, 0.2], [0.5, 0.55], [0.8, 0.84], [1.0, 0.93]],
        // "linear" and anything unrecognized: identity.
        _ => vec![[0.0, 0.0], [1.0, 1.0]],
    }
}

/// Monotone cubic interpolation (Fritsch–Carlson) sampled into a LUT.
fn build_lut(points: &[[f32; 2]]) -> [f32; 256] {
    let mut pts: Vec<[f32; 2]> = points.to_vec();
    pts.sort_by(|a, b| a[0].partial_cmp(&b[0]).unwrap_or(std::cmp::Ordering::Equal));
    pts.dedup_by(|a, b| (a[0] - b[0]).abs() < 1e-6);

    let mut lut = [0.0f32; 256];
    if pts.len() < 2 {
        for (i, v) in lut.iter_mut().enumerate() {
            *v = i as f32 / 255.0;
        }
        return lut;
    }

    let n = pts.len();
    let mut slopes = vec![0.0f32; n - 1];
    for i in 0..n - 1 {
        let dx = (pts[i + 1][0] - pts[i][0]).max(1e-6);
        slopes[i] = (pts[i + 1][1] - pts[i][1]) / dx;
    }
    let mut m = vec![0.0f32; n];
    m[0] = slopes[0];
    m[n - 1] = slopes[n - 2];
    for i in 1..n - 1 {
        m[i] = if slopes[i - 1] * slopes[i] <= 0.0 {
            0.0
        } else {
            (slopes[i - 1] + slopes[i]) / 2.0
        };
    }
    // Enforce monotonicity.
    for i in 0..n - 1 {
        if slopes[i].abs() < 1e-9 {
            m[i] = 0.0;
            m[i + 1] = 0.0;
        } else {
            let a = m[i] / slopes[i];
            let b = m[i + 1] / slopes[i];
            let s = a * a + b * b;
            if s > 9.0 {
                let t = 3.0 / s.sqrt();
                m[i] = t * a * slopes[i];
                m[i + 1] = t * b * slopes[i];
            }
        }
    }

    for (i, v) in lut.iter_mut().enumerate() {
        let x = i as f32 / 255.0;
        *v = if x <= pts[0][0] {
            pts[0][1]
        } else if x >= pts[n - 1][0] {
            pts[n - 1][1]
        } else {
            let seg = pts.windows(2).position(|w| x >= w[0][0] && x <= w[1][0]).unwrap_or(0);
            let (x0, y0) = (pts[seg][0], pts[seg][1]);
            let (x1, y1) = (pts[seg + 1][0], pts[seg + 1][1]);
            let h = (x1 - x0).max(1e-6);
            let t = (x - x0) / h;
            let t2 = t * t;
            let t3 = t2 * t;
            let h00 = 2.0 * t3 - 3.0 * t2 + 1.0;
            let h10 = t3 - 2.0 * t2 + t;
            let h01 = -2.0 * t3 + 3.0 * t2;
            let h11 = t3 - t2;
            h00 * y0 + h10 * h * m[seg] + h01 * y1 + h11 * h * m[seg + 1]
        }
        .clamp(0.0, 1.0);
    }
    lut
}

pub fn apply(image: &mut ImageBuf, params: &Params) {
    let points = match &params.points {
        Some(p) if p.len() >= 2 => p.clone(),
        _ => preset_points(&params.preset),
    };
    let lut = build_lut(&points);
    let look = |v: f32| {
        let x = v.clamp(0.0, 1.0) * 255.0;
        let i = x.floor() as usize;
        let frac = x - i as f32;
        if i >= 255 {
            lut[255]
        } else {
            lut[i] * (1.0 - frac) + lut[i + 1] * frac
        }
    };
    map_rgb(image, |r, g, b| (look(r), look(g), look(b)));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linear_preset_is_identity() {
        let mut img = ImageBuf { width: 1, height: 1, data: vec![0.3, 0.6, 0.9, 1.0] };
        apply(&mut img, &Params { preset: "linear".into(), points: None });
        assert!((img.data[0] - 0.3).abs() < 0.005);
        assert!((img.data[1] - 0.6).abs() < 0.005);
        assert!((img.data[2] - 0.9).abs() < 0.005);
    }

    #[test]
    fn film_preset_lifts_blacks_and_rolls_highlights() {
        let mut img = ImageBuf { width: 2, height: 1, data: vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0] };
        apply(&mut img, &Params { preset: "film".into(), points: None });
        assert!(img.data[0] > 0.05, "blacks lifted");
        assert!(img.data[4] < 0.97, "highlights rolled off");
    }

    #[test]
    fn custom_points_override_preset() {
        let mut img = ImageBuf { width: 1, height: 1, data: vec![0.5, 0.5, 0.5, 1.0] };
        apply(
            &mut img,
            &Params {
                preset: "linear".into(),
                points: Some(vec![[0.0, 0.0], [0.5, 0.8], [1.0, 1.0]]),
            },
        );
        assert!((img.data[0] - 0.8).abs() < 0.01);
    }

    #[test]
    fn lut_is_monotone_for_presets() {
        for preset in ["soft", "hard", "film"] {
            let lut = build_lut(&preset_points(preset));
            for w in lut.windows(2) {
                assert!(w[1] >= w[0] - 1e-4, "{preset} curve must not decrease");
            }
        }
    }
}
