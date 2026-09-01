//! Image operations. Each submodule is independent and exposes
//! `apply(&mut ImageBuf, &Params)` plus a serde-deserializable `Params`
//! struct with sensible defaults.
//!
//! Conventions shared by all ops:
//! - Unipolar parameters live in `0.0..=1.0`, bipolar ones in `-1.0..=1.0`.
//! - Spatial sizes (blur radii, glow spread) are expressed as a fraction of
//!   the image's smaller dimension so results are resolution-independent —
//!   a downscaled preview looks like the full-resolution export.

pub mod blacks_whites;
pub mod bloom;
pub mod color_balance;
pub mod color_shift;
pub mod contrast;
pub mod dodge_burn;
pub mod exposure;
pub mod film_softness;
pub mod grain;
pub mod hsl_mixer;
pub mod halation;
pub mod lens_blur;
pub mod saturation;
pub mod shadows_highlights;
pub mod tone_curve;
pub mod vignette;

pub(crate) mod util {
    use crate::ImageBuf;

    /// Rec. 709 relative luminance.
    #[inline]
    pub fn luma(r: f32, g: f32, b: f32) -> f32 {
        0.2126 * r + 0.7152 * g + 0.0722 * b
    }

    #[inline]
    pub fn lerp(a: f32, b: f32, t: f32) -> f32 {
        a + (b - a) * t
    }

    #[inline]
    pub fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
        let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
        t * t * (3.0 - 2.0 * t)
    }

    /// Hue in 0..360, saturation and lightness in 0..1.
    #[inline]
    pub fn rgb_to_hsl(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
        let max = r.max(g).max(b);
        let min = r.min(g).min(b);
        let l = (max + min) * 0.5;
        let d = max - min;
        if d < 1e-6 {
            return (0.0, 0.0, l);
        }
        let s = if l > 0.5 {
            d / (2.0 - max - min)
        } else {
            d / (max + min).max(1e-6)
        };
        let h = if (max - r).abs() <= 1e-6 {
            let mut hue = (g - b) / d;
            if g < b {
                hue += 6.0;
            }
            hue
        } else if (max - g).abs() <= 1e-6 {
            (b - r) / d + 2.0
        } else {
            (r - g) / d + 4.0
        };
        (h * 60.0, s.clamp(0.0, 1.0), l)
    }

    #[inline]
    fn hue_to_rgb(p: f32, q: f32, t: f32) -> f32 {
        let mut t = t;
        if t < 0.0 {
            t += 1.0;
        }
        if t > 1.0 {
            t -= 1.0;
        }
        if t < 1.0 / 6.0 {
            return p + (q - p) * 6.0 * t;
        }
        if t < 0.5 {
            return q;
        }
        if t < 2.0 / 3.0 {
            return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
        }
        p
    }

    /// Inverse of [`rgb_to_hsl`]. Hue is degrees (any wrap); S/L are 0..1.
    #[inline]
    pub fn hsl_to_rgb(h: f32, s: f32, l: f32) -> (f32, f32, f32) {
        let s = s.clamp(0.0, 1.0);
        let l = l.clamp(0.0, 1.0);
        if s < 1e-6 {
            return (l, l, l);
        }
        let q = if l < 0.5 {
            l * (1.0 + s)
        } else {
            l + s - l * s
        };
        let p = 2.0 * l - q;
        let hk = (((h % 360.0) + 360.0) % 360.0) / 360.0;
        (
            hue_to_rgb(p, q, hk + 1.0 / 3.0),
            hue_to_rgb(p, q, hk),
            hue_to_rgb(p, q, hk - 1.0 / 3.0),
        )
    }

    /// Shortest distance on the hue wheel, in degrees (0..180).
    #[inline]
    pub fn hue_distance(a: f32, b: f32) -> f32 {
        let d = (((a - b) % 360.0) + 360.0) % 360.0;
        d.min(360.0 - d)
    }

    /// Apply `f(r, g, b) -> (r, g, b)` to every pixel, leaving alpha alone.
    #[inline]
    pub fn map_rgb(image: &mut ImageBuf, mut f: impl FnMut(f32, f32, f32) -> (f32, f32, f32)) {
        for px in image.data.chunks_exact_mut(4) {
            let (r, g, b) = f(px[0], px[1], px[2]);
            px[0] = r;
            px[1] = g;
            px[2] = b;
        }
    }

    /// Separable gaussian approximation via three box-blur passes
    /// (standard "boxes for gaussian" decomposition). Operates on RGB;
    /// alpha is preserved. `sigma` is in pixels.
    pub fn gaussian_blur_rgb(image: &ImageBuf, sigma: f32) -> Vec<f32> {
        let mut src = image.data.clone();
        if sigma < 0.3 {
            return src;
        }
        let mut boxes = boxes_for_gauss(sigma, 3);
        // For very small sigmas every box radius can quantize to zero;
        // a single radius-1 box pass approximates sigma ~0.8.
        if boxes.iter().all(|&r| r == 0) {
            boxes = vec![1];
        }
        let mut dst = vec![0.0f32; src.len()];
        let (w, h) = (image.width as usize, image.height as usize);
        for radius in boxes {
            box_blur_h(&src, &mut dst, w, h, radius);
            box_blur_v(&dst, &mut src, w, h, radius);
        }
        src
    }

    fn boxes_for_gauss(sigma: f32, n: usize) -> Vec<usize> {
        let w_ideal = (12.0 * sigma * sigma / n as f32 + 1.0).sqrt();
        let mut wl = w_ideal.floor() as i32;
        if wl % 2 == 0 {
            wl -= 1;
        }
        let wu = wl + 2;
        let m_ideal =
            (12.0 * sigma * sigma - (n as f32) * (wl * wl) as f32 - 4.0 * n as f32 * wl as f32
                - 3.0 * n as f32)
                / (-4.0 * wl as f32 - 4.0);
        let m = m_ideal.round() as usize;
        (0..n)
            .map(|i| {
                let size = if i < m { wl } else { wu };
                (size.max(1) as usize - 1) / 2
            })
            .collect()
    }

    /// Sliding-window box blur along rows, edges clamped.
    fn box_blur_h(src: &[f32], dst: &mut [f32], w: usize, h: usize, radius: usize) {
        if radius == 0 {
            dst.copy_from_slice(src);
            return;
        }
        let norm = 1.0 / (2 * radius + 1) as f32;
        let r = radius as i64;
        for y in 0..h {
            let row = y * w * 4;
            for c in 0..3 {
                let sample = |x: i64| src[row + (x.clamp(0, w as i64 - 1) as usize) * 4 + c];
                let mut acc: f32 = (-r..=r).map(&sample).sum();
                for x in 0..w {
                    dst[row + x * 4 + c] = acc * norm;
                    acc += sample(x as i64 + r + 1) - sample(x as i64 - r);
                }
            }
            for x in 0..w {
                dst[row + x * 4 + 3] = src[row + x * 4 + 3];
            }
        }
    }

    /// Sliding-window box blur along columns, edges clamped.
    fn box_blur_v(src: &[f32], dst: &mut [f32], w: usize, h: usize, radius: usize) {
        if radius == 0 {
            dst.copy_from_slice(src);
            return;
        }
        let norm = 1.0 / (2 * radius + 1) as f32;
        let r = radius as i64;
        let stride = w * 4;
        for x in 0..w {
            for c in 0..3 {
                let col = x * 4 + c;
                let sample = |y: i64| src[(y.clamp(0, h as i64 - 1) as usize) * stride + col];
                let mut acc: f32 = (-r..=r).map(&sample).sum();
                for y in 0..h {
                    dst[y * stride + col] = acc * norm;
                    acc += sample(y as i64 + r + 1) - sample(y as i64 - r);
                }
            }
            for y in 0..h {
                dst[y * stride + x * 4 + 3] = src[y * stride + x * 4 + 3];
            }
        }
    }

    /// Extract pixels brighter than `threshold` with a soft knee, returning an
    /// RGB "glow source" buffer (alpha untouched).
    pub fn bright_pass(image: &ImageBuf, threshold: f32) -> Vec<f32> {
        let knee = 0.1;
        let mut out = image.data.clone();
        for px in out.chunks_exact_mut(4) {
            let l = luma(px[0], px[1], px[2]);
            let gain = smoothstep(threshold - knee, threshold + knee, l);
            px[0] *= gain;
            px[1] *= gain;
            px[2] *= gain;
        }
        out
    }

    /// Screen-blend `glow` (scaled by `strength`) onto the image's RGB.
    pub fn screen_blend(image: &mut ImageBuf, glow: &[f32], strength: f32, tint: [f32; 3]) {
        for (px, gl) in image.data.chunks_exact_mut(4).zip(glow.chunks_exact(4)) {
            for c in 0..3 {
                let g = (gl[c] * strength * tint[c]).clamp(0.0, 1.0);
                let base = px[c].clamp(0.0, 1.0);
                px[c] = 1.0 - (1.0 - base) * (1.0 - g);
            }
        }
    }
}
