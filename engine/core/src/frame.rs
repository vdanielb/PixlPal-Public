//! The frame transform: non-destructive rotate + crop.
//!
//! Applied after every filter operation, so ops and masks always work in the
//! original image space. Rotation happens first (clockwise, 90-degree steps);
//! the crop rectangle is expressed as normalized fractions of the *rotated*
//! frame. This is the only stage in the engine that changes image dimensions.

use crate::{EngineError, ImageBuf};

/// Clockwise rotation in 90-degree steps.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Rotation {
    #[default]
    R0,
    R90,
    R180,
    R270,
}

impl Rotation {
    pub fn from_degrees(degrees: u32) -> Result<Self, EngineError> {
        match degrees {
            0 => Ok(Self::R0),
            90 => Ok(Self::R90),
            180 => Ok(Self::R180),
            270 => Ok(Self::R270),
            other => Err(EngineError::InvalidPipeline(format!(
                "frame.rotate must be 0, 90, 180 or 270, got {other}"
            ))),
        }
    }
}

/// Normalized crop rectangle (0..1 fractions of the rotated frame).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CropRect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

impl CropRect {
    pub fn validated(x: f32, y: f32, width: f32, height: f32) -> Result<Self, EngineError> {
        for (name, value) in [("x", x), ("y", y), ("width", width), ("height", height)] {
            if !value.is_finite() {
                return Err(EngineError::InvalidPipeline(format!(
                    "frame.crop.{name} must be a finite number"
                )));
            }
        }
        if width <= 0.0 || height <= 0.0 {
            return Err(EngineError::InvalidPipeline(
                "frame.crop width and height must be greater than 0".into(),
            ));
        }
        // Tolerate slightly out-of-range values (LLM- and UI-authored crops):
        // clamp the origin into the unit square and the size to what fits.
        let x = x.clamp(0.0, 1.0);
        let y = y.clamp(0.0, 1.0);
        let width = width.min(1.0 - x);
        let height = height.min(1.0 - y);
        if width <= 0.0 || height <= 0.0 {
            return Err(EngineError::InvalidPipeline(
                "frame.crop lies entirely outside the image".into(),
            ));
        }
        Ok(Self { x, y, width, height })
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct Frame {
    pub rotation: Rotation,
    pub crop: Option<CropRect>,
}

impl Frame {
    pub fn is_noop(&self) -> bool {
        self.rotation == Rotation::R0 && self.crop.is_none()
    }

    /// Apply the frame, producing a (possibly) differently-sized image.
    pub fn apply(&self, image: ImageBuf) -> ImageBuf {
        let rotated = rotate(image, self.rotation);
        match self.crop {
            Some(rect) => crop(&rotated, rect),
            None => rotated,
        }
    }
}

fn rotate(image: ImageBuf, rotation: Rotation) -> ImageBuf {
    let (w, h) = (image.width as usize, image.height as usize);
    match rotation {
        Rotation::R0 => image,
        Rotation::R90 => {
            // out(x, y) = in(y, H-1-x): input's left column becomes the top row.
            let mut data = vec![0.0f32; image.data.len()];
            for yo in 0..w {
                for xo in 0..h {
                    let src = ((h - 1 - xo) * w + yo) * 4;
                    let dst = (yo * h + xo) * 4;
                    data[dst..dst + 4].copy_from_slice(&image.data[src..src + 4]);
                }
            }
            ImageBuf { width: image.height, height: image.width, data }
        }
        Rotation::R180 => {
            let mut data = vec![0.0f32; image.data.len()];
            for yo in 0..h {
                for xo in 0..w {
                    let src = ((h - 1 - yo) * w + (w - 1 - xo)) * 4;
                    let dst = (yo * w + xo) * 4;
                    data[dst..dst + 4].copy_from_slice(&image.data[src..src + 4]);
                }
            }
            ImageBuf { width: image.width, height: image.height, data }
        }
        Rotation::R270 => {
            // out(x, y) = in(W-1-y, x): input's right column becomes the top row.
            let mut data = vec![0.0f32; image.data.len()];
            for yo in 0..w {
                for xo in 0..h {
                    let src = (xo * w + (w - 1 - yo)) * 4;
                    let dst = (yo * h + xo) * 4;
                    data[dst..dst + 4].copy_from_slice(&image.data[src..src + 4]);
                }
            }
            ImageBuf { width: image.height, height: image.width, data }
        }
    }
}

fn crop(image: &ImageBuf, rect: CropRect) -> ImageBuf {
    let w = image.width as f32;
    let h = image.height as f32;

    let x0 = ((rect.x * w).round() as u32).min(image.width.saturating_sub(1));
    let y0 = ((rect.y * h).round() as u32).min(image.height.saturating_sub(1));
    let cw = (((rect.width * w).round() as u32).max(1)).min(image.width - x0);
    let ch = (((rect.height * h).round() as u32).max(1)).min(image.height - y0);

    let mut data = Vec::with_capacity((cw * ch * 4) as usize);
    for y in y0..y0 + ch {
        let start = ((y * image.width + x0) * 4) as usize;
        let end = start + (cw * 4) as usize;
        data.extend_from_slice(&image.data[start..end]);
    }
    ImageBuf { width: cw, height: ch, data }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 2x3 image with a unique red value per pixel: r = (y*W + x) / 10.
    fn tagged_image(width: u32, height: u32) -> ImageBuf {
        let mut data = Vec::new();
        for i in 0..(width * height) {
            data.extend_from_slice(&[i as f32 / 10.0, 0.0, 0.0, 1.0]);
        }
        ImageBuf { width, height, data }
    }

    fn red_at(image: &ImageBuf, x: u32, y: u32) -> f32 {
        image.data[((y * image.width + x) * 4) as usize]
    }

    #[test]
    fn rotate_90_maps_corners_clockwise() {
        // 2 wide, 3 tall: indices are
        //   0 1
        //   2 3
        //   4 5
        let out = rotate(tagged_image(2, 3), Rotation::R90);
        assert_eq!((out.width, out.height), (3, 2));
        // Clockwise: bottom-left (4) becomes top-left.
        assert_eq!(red_at(&out, 0, 0), 0.4);
        // Top-left (0) becomes top-right.
        assert_eq!(red_at(&out, 2, 0), 0.0);
        // Bottom-right (5) becomes bottom-left.
        assert_eq!(red_at(&out, 0, 1), 0.5);
        // Top-right (1) becomes bottom-right.
        assert_eq!(red_at(&out, 2, 1), 0.1);
    }

    #[test]
    fn rotate_270_is_counter_clockwise() {
        let out = rotate(tagged_image(2, 3), Rotation::R270);
        assert_eq!((out.width, out.height), (3, 2));
        // Counter-clockwise: top-right (1) becomes top-left.
        assert_eq!(red_at(&out, 0, 0), 0.1);
        // Bottom-right (5) becomes top-right.
        assert_eq!(red_at(&out, 2, 0), 0.5);
        assert_eq!(red_at(&out, 0, 1), 0.0);
        assert_eq!(red_at(&out, 2, 1), 0.4);
    }

    #[test]
    fn rotate_180_reverses_pixels() {
        let out = rotate(tagged_image(2, 3), Rotation::R180);
        assert_eq!((out.width, out.height), (2, 3));
        assert_eq!(red_at(&out, 0, 0), 0.5);
        assert_eq!(red_at(&out, 1, 2), 0.0);
    }

    #[test]
    fn four_quarter_turns_are_identity() {
        let original = tagged_image(2, 3);
        let mut image = tagged_image(2, 3);
        for _ in 0..4 {
            image = rotate(image, Rotation::R90);
        }
        assert_eq!(image.data, original.data);
        assert_eq!((image.width, image.height), (2, 3));
    }

    #[test]
    fn crop_extracts_the_expected_region() {
        // 4x4 tagged image, crop the right half.
        let image = tagged_image(4, 4);
        let rect = CropRect::validated(0.5, 0.0, 0.5, 1.0).unwrap();
        let out = crop(&image, rect);
        assert_eq!((out.width, out.height), (2, 4));
        assert_eq!(red_at(&out, 0, 0), 0.2);
        assert_eq!(red_at(&out, 1, 3), 1.5);
    }

    #[test]
    fn crop_never_collapses_to_zero() {
        let image = tagged_image(4, 4);
        let rect = CropRect::validated(0.99, 0.99, 0.001, 0.001).unwrap();
        let out = crop(&image, rect);
        assert!(out.width >= 1 && out.height >= 1);
    }

    #[test]
    fn crop_validation_clamps_and_rejects() {
        // Slightly out of range clamps quietly.
        let ok = CropRect::validated(-0.01, 0.0, 1.02, 0.5).unwrap();
        assert_eq!(ok.x, 0.0);
        assert!(ok.width <= 1.0);
        // Nonsense is an error.
        assert!(CropRect::validated(0.0, 0.0, 0.0, 1.0).is_err());
        assert!(CropRect::validated(f32::NAN, 0.0, 0.5, 0.5).is_err());
        assert!(CropRect::validated(1.0, 0.0, 0.5, 0.5).is_err());
    }
}
