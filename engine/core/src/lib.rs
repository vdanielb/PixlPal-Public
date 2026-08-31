//! PixlPal engine: a platform-agnostic pixel-processing core.
//!
//! The engine knows nothing about UIs, platforms, or AI. It exposes a single
//! entry point: give it image bytes (or a raw RGBA buffer) and a declarative
//! pipeline JSON document, and it returns the processed pixels. Optional named
//! masks let hosts apply ops locally without the engine knowing where masks
//! came from.

pub mod mask;
pub mod ops;
pub mod pipeline;

use std::collections::HashMap;
use std::io::Cursor;

use image::{DynamicImage, ImageFormat, ImageReader};

pub use mask::MaskBuf;
pub use pipeline::Pipeline;

/// Errors surfaced to frontends. Kept coarse-grained and message-carrying so
/// every binding layer (JSI, WASM) can display something actionable.
#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("failed to decode image: {0}")]
    ImageDecode(String),
    #[error("failed to encode image: {0}")]
    ImageEncode(String),
    #[error("invalid pipeline: {0}")]
    InvalidPipeline(String),
    #[error("unsupported pipeline version {0} (engine supports versions 1..=2)")]
    UnsupportedVersion(u32),
    #[error("unknown operation \"{0}\"")]
    UnknownOperation(String),
    #[error("unknown mask \"{0}\"")]
    UnknownMask(String),
}

/// Output encoding for [`process`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputFormat {
    Png,
    /// JPEG with the given quality (1-100).
    Jpeg(u8),
}

/// A working image: interleaved RGBA, f32 channels normalized to 0.0..=1.0.
///
/// Values may temporarily exceed 1.0 mid-pipeline (e.g. after exposure or
/// bloom); they are clamped when converting back to 8-bit.
pub struct ImageBuf {
    pub width: u32,
    pub height: u32,
    /// len == width * height * 4
    pub data: Vec<f32>,
}

impl ImageBuf {
    pub fn from_rgba8(width: u32, height: u32, pixels: &[u8]) -> Self {
        let data = pixels.iter().map(|&b| b as f32 / 255.0).collect();
        Self { width, height, data }
    }

    pub fn to_rgba8(&self) -> Vec<u8> {
        self.data
            .iter()
            .map(|&v| (v.clamp(0.0, 1.0) * 255.0 + 0.5) as u8)
            .collect()
    }

    /// Smaller of width/height, used to make spatial parameters (blur radii,
    /// grain size) resolution-independent so previews match full-res exports.
    pub fn min_dim(&self) -> f32 {
        self.width.min(self.height) as f32
    }
}

/// Process encoded image bytes (JPEG/PNG/WebP) through a pipeline and
/// re-encode the result.
pub fn process(
    image_bytes: &[u8],
    pipeline_json: &str,
    output: OutputFormat,
) -> Result<Vec<u8>, EngineError> {
    process_with_masks(image_bytes, pipeline_json, output, None)
}

/// Like [`process`], with optional named masks for local edits.
pub fn process_with_masks(
    image_bytes: &[u8],
    pipeline_json: &str,
    output: OutputFormat,
    masks: Option<&HashMap<String, MaskBuf>>,
) -> Result<Vec<u8>, EngineError> {
    let pipeline = Pipeline::from_json(pipeline_json)?;

    let decoded = ImageReader::new(Cursor::new(image_bytes))
        .with_guessed_format()
        .map_err(|e| EngineError::ImageDecode(e.to_string()))?
        .decode()
        .map_err(|e| EngineError::ImageDecode(e.to_string()))?;

    let rgba = decoded.to_rgba8();
    let (width, height) = (rgba.width(), rgba.height());
    let mut buf = ImageBuf::from_rgba8(width, height, rgba.as_raw());

    pipeline.apply(&mut buf, masks)?;

    encode(&buf, output)
}

/// Process a raw RGBA8 buffer in place-ish (returns the processed copy).
/// This is the fast path for canvas `ImageData`: no decode/encode round trip.
pub fn process_rgba8(
    pixels: &[u8],
    width: u32,
    height: u32,
    pipeline_json: &str,
) -> Result<Vec<u8>, EngineError> {
    process_rgba8_with_masks(pixels, width, height, pipeline_json, None)
}

/// Like [`process_rgba8`], with optional named masks for local edits.
pub fn process_rgba8_with_masks(
    pixels: &[u8],
    width: u32,
    height: u32,
    pipeline_json: &str,
    masks: Option<&HashMap<String, MaskBuf>>,
) -> Result<Vec<u8>, EngineError> {
    if pixels.len() != (width as usize) * (height as usize) * 4 {
        return Err(EngineError::ImageDecode(format!(
            "pixel buffer length {} does not match {}x{} RGBA",
            pixels.len(),
            width,
            height
        )));
    }
    let pipeline = Pipeline::from_json(pipeline_json)?;
    let mut buf = ImageBuf::from_rgba8(width, height, pixels);
    pipeline.apply(&mut buf, masks)?;
    Ok(buf.to_rgba8())
}

/// Build a mask map from parallel id list + concatenated f32 planes.
/// Each plane is `width * height` floats in row-major order.
pub fn masks_from_planes(
    width: u32,
    height: u32,
    ids: &[String],
    planes: &[f32],
) -> Result<HashMap<String, MaskBuf>, EngineError> {
    let plane_len = (width as usize)
        .checked_mul(height as usize)
        .ok_or_else(|| EngineError::InvalidPipeline("mask dimensions overflow".into()))?;
    let expected = plane_len
        .checked_mul(ids.len())
        .ok_or_else(|| EngineError::InvalidPipeline("mask buffer overflow".into()))?;
    if planes.len() != expected {
        return Err(EngineError::InvalidPipeline(format!(
            "mask planes length {} does not match {} masks of {}x{}",
            planes.len(),
            ids.len(),
            width,
            height
        )));
    }
    let mut map = HashMap::with_capacity(ids.len());
    for (index, id) in ids.iter().enumerate() {
        let start = index * plane_len;
        let data = planes[start..start + plane_len].to_vec();
        map.insert(id.clone(), MaskBuf::new(width, height, data)?);
    }
    Ok(map)
}

fn encode(buf: &ImageBuf, output: OutputFormat) -> Result<Vec<u8>, EngineError> {
    let rgba = image::RgbaImage::from_raw(buf.width, buf.height, buf.to_rgba8())
        .expect("buffer size matches dimensions");
    let mut out = Cursor::new(Vec::new());
    match output {
        OutputFormat::Png => DynamicImage::ImageRgba8(rgba)
            .write_to(&mut out, ImageFormat::Png)
            .map_err(|e| EngineError::ImageEncode(e.to_string()))?,
        OutputFormat::Jpeg(quality) => {
            // JPEG has no alpha channel.
            let rgb = DynamicImage::ImageRgba8(rgba).to_rgb8();
            let encoder =
                image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality.clamp(1, 100));
            rgb.write_with_encoder(encoder)
                .map_err(|e| EngineError::ImageEncode(e.to_string()))?;
        }
    }
    Ok(out.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A small horizontal gradient with some color variation, useful for
    /// asserting that ops actually change pixels in the expected direction.
    fn gradient_image(width: u32, height: u32) -> ImageBuf {
        let mut data = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height {
            for x in 0..width {
                let t = x as f32 / (width - 1) as f32;
                let s = y as f32 / (height - 1) as f32;
                data.extend_from_slice(&[t, 0.5 * t + 0.25 * s, 1.0 - t, 1.0]);
            }
        }
        ImageBuf { width, height, data }
    }

    fn gradient_png(width: u32, height: u32) -> Vec<u8> {
        encode(&gradient_image(width, height), OutputFormat::Png).unwrap()
    }

    #[test]
    fn process_roundtrip_identity() {
        let png = gradient_png(32, 32);
        let out = process(&png, r#"{"version":1,"operations":[]}"#, OutputFormat::Png).unwrap();
        let decoded = image::load_from_memory(&out).unwrap().to_rgba8();
        let original = image::load_from_memory(&png).unwrap().to_rgba8();
        assert_eq!(decoded.as_raw(), original.as_raw());
    }

    #[test]
    fn process_applies_operations() {
        let png = gradient_png(32, 32);
        let pipeline = r#"{"version":1,"operations":[{"op":"exposure","params":{"amount":0.5}}]}"#;
        let out = process(&png, pipeline, OutputFormat::Png).unwrap();
        let processed = image::load_from_memory(&out).unwrap().to_rgba8();
        let original = image::load_from_memory(&png).unwrap().to_rgba8();
        // Positive exposure must brighten the midtones.
        let mid = ((16 * 32 + 16) * 4) as usize;
        assert!(processed.as_raw()[mid] > original.as_raw()[mid]);
    }

    #[test]
    fn process_rgba8_matches_dimensions() {
        let buf = gradient_image(16, 8);
        let pixels = buf.to_rgba8();
        let out = process_rgba8(&pixels, 16, 8, r#"{"version":1,"operations":[]}"#).unwrap();
        assert_eq!(out.len(), pixels.len());
        assert_eq!(out, pixels);
    }

    #[test]
    fn rejects_bad_inputs() {
        assert!(matches!(
            process(b"not an image", r#"{"version":1,"operations":[]}"#, OutputFormat::Png),
            Err(EngineError::ImageDecode(_))
        ));
        let png = gradient_png(4, 4);
        assert!(matches!(
            process(&png, "not json", OutputFormat::Png),
            Err(EngineError::InvalidPipeline(_))
        ));
        assert!(matches!(
            process(&png, r#"{"version":99,"operations":[]}"#, OutputFormat::Png),
            Err(EngineError::UnsupportedVersion(99))
        ));
        assert!(matches!(
            process(
                &png,
                r#"{"version":1,"operations":[{"op":"teleport"}]}"#,
                OutputFormat::Png
            ),
            Err(EngineError::UnknownOperation(op)) if op == "teleport"
        ));
    }

    #[test]
    fn jpeg_output_encodes() {
        let png = gradient_png(16, 16);
        let out = process(&png, r#"{"version":1,"operations":[]}"#, OutputFormat::Jpeg(90)).unwrap();
        assert_eq!(image::guess_format(&out).unwrap(), ImageFormat::Jpeg);
    }

    #[test]
    fn masked_exposure_only_affects_masked_region() {
        let width = 8u32;
        let height = 4u32;
        let buf = gradient_image(width, height);
        let pixels = buf.to_rgba8();

        // Left half masked.
        let mut mask_data = vec![0.0f32; (width * height) as usize];
        for y in 0..height {
            for x in 0..width / 2 {
                mask_data[(y * width + x) as usize] = 1.0;
            }
        }
        let mut masks = HashMap::new();
        masks.insert(
            "left".into(),
            MaskBuf::new(width, height, mask_data).unwrap(),
        );

        let pipeline = r#"{
            "version": 2,
            "masks": [{ "id": "left", "feather": 0 }],
            "operations": [
                { "op": "exposure", "params": { "amount": 0.8 }, "mask": "left" }
            ]
        }"#;

        let out = process_rgba8_with_masks(&pixels, width, height, pipeline, Some(&masks)).unwrap();
        let left = ((0 * width + 1) * 4) as usize;
        let right = ((0 * width + 6) * 4) as usize;
        assert!(out[left] > pixels[left], "masked side should brighten");
        assert_eq!(out[right], pixels[right], "unmasked side should be unchanged");
        assert_eq!(out[right + 1], pixels[right + 1]);
        assert_eq!(out[right + 2], pixels[right + 2]);
    }

    #[test]
    fn missing_mask_is_an_error() {
        let buf = gradient_image(4, 4);
        let pixels = buf.to_rgba8();
        let pipeline = r#"{
            "version": 2,
            "operations": [
                { "op": "exposure", "params": { "amount": 0.5 }, "mask": "missing" }
            ]
        }"#;
        let err = process_rgba8_with_masks(&pixels, 4, 4, pipeline, None).unwrap_err();
        assert!(matches!(err, EngineError::UnknownMask(id) if id == "missing"));
    }

    #[test]
    fn version_one_still_works() {
        let png = gradient_png(8, 8);
        let out = process(
            &png,
            r#"{"version":1,"operations":[{"op":"contrast","params":{"amount":0.2}}]}"#,
            OutputFormat::Png,
        )
        .unwrap();
        assert!(!out.is_empty());
    }

    #[test]
    fn half_mask_strength_halves_masked_exposure_delta() {
        let width = 4u32;
        let height = 1u32;
        // Flat mid-gray so exposure gain is uniform.
        let pixels = vec![128u8; (width * height * 4) as usize];
        let mut mask_data = vec![1.0f32; (width * height) as usize];
        mask_data[2] = 0.0;
        mask_data[3] = 0.0;
        let mut masks = HashMap::new();
        masks.insert(
            "left".into(),
            MaskBuf::new(width, height, mask_data).unwrap(),
        );

        // Mild exposure so the full edit stays below 8-bit clip.
        let full = process_rgba8_with_masks(
            &pixels,
            width,
            height,
            r#"{"version":2,"operations":[{"op":"exposure","params":{"amount":0.15},"mask":"left"}]}"#,
            Some(&masks),
        )
        .unwrap();
        let half = process_rgba8_with_masks(
            &pixels,
            width,
            height,
            r#"{"version":2,"operations":[{"op":"exposure","params":{"amount":0.15},"mask":"left","maskStrength":0.5}]}"#,
            Some(&masks),
        )
        .unwrap();

        let full_delta = full[0] as i16 - pixels[0] as i16;
        let half_delta = half[0] as i16 - pixels[0] as i16;
        assert!(full_delta > 0);
        // Half strength should land near halfway between original and full.
        assert!((half_delta * 2 - full_delta).abs() <= 2);
        // Unmasked pixel unchanged under both.
        assert_eq!(full[8], pixels[8]);
        assert_eq!(half[8], pixels[8]);
    }
}
