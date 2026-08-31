//! Single-channel masks for local (masked) edits.
//!
//! The engine never runs a segmentation model. Hosts supply named bitmaps;
//! ops are blended against them with a generic lerp wrapper.

use crate::ops::util::{gaussian_blur_rgb, lerp};
use crate::{EngineError, ImageBuf};

/// Single-channel f32 mask, image-sized, values in 0.0..=1.0.
#[derive(Debug, Clone)]
pub struct MaskBuf {
    pub width: u32,
    pub height: u32,
    /// len == width * height
    pub data: Vec<f32>,
}

impl MaskBuf {
    pub fn new(width: u32, height: u32, data: Vec<f32>) -> Result<Self, EngineError> {
        let expected = (width as usize)
            .checked_mul(height as usize)
            .ok_or_else(|| EngineError::InvalidPipeline("mask dimensions overflow".into()))?;
        if data.len() != expected {
            return Err(EngineError::InvalidPipeline(format!(
                "mask buffer length {} does not match {}x{}",
                data.len(),
                width,
                height
            )));
        }
        Ok(Self {
            width,
            height,
            data,
        })
    }

    pub fn zeros(width: u32, height: u32) -> Self {
        Self {
            width,
            height,
            data: vec![0.0; (width * height) as usize],
        }
    }

    pub fn ensure_size(&self, width: u32, height: u32) -> Result<(), EngineError> {
        if self.width != width || self.height != height {
            return Err(EngineError::InvalidPipeline(format!(
                "mask is {}x{}, image is {}x{}",
                self.width, self.height, width, height
            )));
        }
        Ok(())
    }

    /// Soften mask edges. `radius` is a fraction of the image's smaller side.
    pub fn feather(&mut self, radius: f32) {
        if radius <= 0.0 {
            return;
        }
        let min_dim = self.width.min(self.height) as f32;
        let sigma = radius * min_dim;
        if sigma < 0.3 {
            return;
        }
        // Reuse the RGB gaussian by stuffing the mask into R and reading it back.
        let mut image = ImageBuf {
            width: self.width,
            height: self.height,
            data: vec![0.0; (self.width * self.height * 4) as usize],
        };
        for (i, &v) in self.data.iter().enumerate() {
            let o = i * 4;
            image.data[o] = v;
            image.data[o + 1] = v;
            image.data[o + 2] = v;
            image.data[o + 3] = 1.0;
        }
        let blurred = gaussian_blur_rgb(&image, sigma);
        for (i, slot) in self.data.iter_mut().enumerate() {
            *slot = blurred[i * 4].clamp(0.0, 1.0);
        }
    }

    pub fn invert(&mut self) {
        for v in &mut self.data {
            *v = 1.0 - *v;
        }
    }
}

/// Blend `edited` into `original` by mask weight (1 = full effect). Alpha from original.
///
/// `strength` (0..1) scales the mask before invert: `t = mask * strength`, then
/// optionally `1 - t` when `invert` is set. Strength 0 is a no-op; 1 matches
/// the unscaled mask.
pub fn blend_masked(
    original: &ImageBuf,
    edited: &ImageBuf,
    mask: &MaskBuf,
    invert: bool,
    strength: f32,
) -> ImageBuf {
    debug_assert_eq!(original.width, edited.width);
    debug_assert_eq!(original.height, edited.height);
    debug_assert_eq!(original.width, mask.width);
    debug_assert_eq!(original.height, mask.height);

    let strength = strength.clamp(0.0, 1.0);
    if strength <= 0.0 {
        return ImageBuf {
            width: original.width,
            height: original.height,
            data: original.data.clone(),
        };
    }

    let mut out = original.data.clone();
    let w = original.width as usize;
    for y in 0..original.height as usize {
        for x in 0..w {
            let mi = y * w + x;
            let mut t = mask.data[mi].clamp(0.0, 1.0) * strength;
            if invert {
                t = 1.0 - t;
            }
            if t <= 0.0 {
                continue;
            }
            let pi = mi * 4;
            if t >= 1.0 {
                out[pi] = edited.data[pi];
                out[pi + 1] = edited.data[pi + 1];
                out[pi + 2] = edited.data[pi + 2];
            } else {
                out[pi] = lerp(original.data[pi], edited.data[pi], t);
                out[pi + 1] = lerp(original.data[pi + 1], edited.data[pi + 1], t);
                out[pi + 2] = lerp(original.data[pi + 2], edited.data[pi + 2], t);
            }
            // keep original alpha
        }
    }
    ImageBuf {
        width: original.width,
        height: original.height,
        data: out,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn feather_keeps_dimensions() {
        let mut mask = MaskBuf::new(8, 8, vec![0.0; 64]).unwrap();
        for i in 24..40 {
            mask.data[i] = 1.0;
        }
        mask.feather(0.2);
        assert_eq!(mask.data.len(), 64);
        assert!(mask.data.iter().any(|&v| v > 0.0 && v < 1.0));
    }
}
