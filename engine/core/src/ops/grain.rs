//! Grain: deterministic film-style luminance noise.
//!
//! Noise is generated from an integer hash (no RNG dependency), so the same
//! seed always produces the same grain on every platform — a preview on web
//! matches the export on mobile. `size` controls grain clump size via
//! bilinearly-interpolated value noise. Grain is strongest in midtones,
//! like silver-halide film.

use serde::Deserialize;

use super::util::{lerp, luma};
use crate::ImageBuf;

#[derive(Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Params {
    /// 0.0..=1.0 grain intensity.
    pub amount: f32,
    /// Grain clump size in (preview-independent) units, 0.5..=4.0. 1.0 is fine grain.
    pub size: f32,
    /// Noise seed; change for a different grain pattern.
    pub seed: u32,
}

impl Default for Params {
    fn default() -> Self {
        Self { amount: 0.5, size: 1.0, seed: 7 }
    }
}

/// 2D integer hash -> [0, 1). (lowbias32-style avalanche.)
#[inline]
fn hash(x: i32, y: i32, seed: u32) -> f32 {
    let mut h = (x as u32).wrapping_mul(0x85eb_ca6b)
        ^ (y as u32).wrapping_mul(0xc2b2_ae35)
        ^ seed.wrapping_mul(0x27d4_eb2f);
    h ^= h >> 16;
    h = h.wrapping_mul(0x7feb_352d);
    h ^= h >> 15;
    h = h.wrapping_mul(0x846c_a68b);
    h ^= h >> 16;
    (h >> 8) as f32 / 16_777_216.0
}

/// Bilinear value noise in [-1, 1] at grain-cell resolution.
#[inline]
fn value_noise(fx: f32, fy: f32, seed: u32) -> f32 {
    let x0 = fx.floor() as i32;
    let y0 = fy.floor() as i32;
    let tx = fx - x0 as f32;
    let ty = fy - y0 as f32;
    let n00 = hash(x0, y0, seed);
    let n10 = hash(x0 + 1, y0, seed);
    let n01 = hash(x0, y0 + 1, seed);
    let n11 = hash(x0 + 1, y0 + 1, seed);
    let n = lerp(lerp(n00, n10, tx), lerp(n01, n11, tx), ty);
    n * 2.0 - 1.0
}

pub fn apply(image: &mut ImageBuf, params: &Params) {
    let amount = params.amount.clamp(0.0, 1.0);
    if amount == 0.0 {
        return;
    }
    // Cell size scales with resolution so grain looks identical on the
    // downscaled preview and the full-size export. At a 1000px image and
    // size=1.0, one grain cell is ~2px.
    let cell = (params.size.clamp(0.5, 4.0) * image.min_dim() / 500.0).max(1.0);
    let strength = amount * 0.16;
    let w = image.width as usize;

    for (i, px) in image.data.chunks_exact_mut(4).enumerate() {
        let x = (i % w) as f32 / cell;
        let y = (i / w) as f32 / cell;
        let n = value_noise(x, y, params.seed);
        let l = luma(px[0], px[1], px[2]).clamp(0.0, 1.0);
        // Midtone-weighted: little grain in deep blacks and bright whites.
        let weight = 1.0 - (2.0 * l - 1.0).abs() * 0.75;
        let g = n * strength * weight;
        px[0] += g;
        px[1] += g;
        px[2] += g;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flat_gray(w: u32, h: u32) -> ImageBuf {
        ImageBuf { width: w, height: h, data: vec![0.5; (w * h * 4) as usize] }
    }

    #[test]
    fn grain_is_deterministic() {
        let mut a = flat_gray(16, 16);
        let mut b = flat_gray(16, 16);
        let p = Params { amount: 0.8, size: 1.0, seed: 42 };
        apply(&mut a, &p);
        apply(&mut b, &p);
        assert_eq!(a.data, b.data);
    }

    #[test]
    fn different_seeds_differ() {
        let mut a = flat_gray(16, 16);
        let mut b = flat_gray(16, 16);
        apply(&mut a, &Params { amount: 0.8, size: 1.0, seed: 1 });
        apply(&mut b, &Params { amount: 0.8, size: 1.0, seed: 2 });
        assert_ne!(a.data, b.data);
    }

    #[test]
    fn grain_adds_variance_but_keeps_mean() {
        let mut img = flat_gray(64, 64);
        apply(&mut img, &Params { amount: 0.6, size: 1.0, seed: 7 });
        let reds: Vec<f32> = img.data.chunks_exact(4).map(|p| p[0]).collect();
        let mean = reds.iter().sum::<f32>() / reds.len() as f32;
        let var = reds.iter().map(|v| (v - mean).powi(2)).sum::<f32>() / reds.len() as f32;
        assert!(var > 1e-5, "grain should add variance");
        assert!((mean - 0.5).abs() < 0.02, "grain should be roughly zero-mean");
    }

    #[test]
    fn zero_amount_is_noop() {
        let mut img = flat_gray(8, 8);
        apply(&mut img, &Params { amount: 0.0, size: 1.0, seed: 7 });
        assert!(img.data.iter().all(|&v| v == 0.5));
    }

    #[test]
    fn grain_is_monochrome_per_pixel() {
        let mut img = flat_gray(8, 8);
        apply(&mut img, &Params { amount: 0.9, size: 1.0, seed: 3 });
        for px in img.data.chunks_exact(4) {
            assert!((px[0] - px[1]).abs() < 1e-6);
            assert!((px[1] - px[2]).abs() < 1e-6);
        }
    }
}
