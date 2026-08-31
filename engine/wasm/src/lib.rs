//! Thin WASM wrapper over the PixlPal engine.
//!
//! The web app's fast path is `process_rgba8`: it passes canvas `ImageData`
//! pixels straight in and gets processed pixels straight back — no
//! encode/decode round trip per slider move. Optional masks arrive as a JSON
//! id list plus a concatenated f32 plane buffer.

use wasm_bindgen::prelude::*;

/// Process a raw RGBA8 pixel buffer (e.g. canvas ImageData) through a
/// pipeline JSON document. Returns the processed RGBA8 buffer.
#[wasm_bindgen]
pub fn process_rgba8(
    pixels: &[u8],
    width: u32,
    height: u32,
    pipeline_json: &str,
) -> Result<Vec<u8>, JsError> {
    pixelcam_engine::process_rgba8(pixels, width, height, pipeline_json)
        .map_err(|e| JsError::new(&e.to_string()))
}

/// Like [`process_rgba8`], with named masks.
///
/// `mask_ids_json` is a JSON array of strings, e.g. `["dress","sky"]`.
/// `masks` is the concatenation of each mask's `width*height` f32 plane.
#[wasm_bindgen]
pub fn process_rgba8_with_masks(
    pixels: &[u8],
    width: u32,
    height: u32,
    pipeline_json: &str,
    mask_ids_json: &str,
    masks: &[f32],
) -> Result<Vec<u8>, JsError> {
    let ids: Vec<String> = serde_json::from_str(mask_ids_json)
        .map_err(|e| JsError::new(&format!("invalid mask_ids_json: {e}")))?;
    let map = pixelcam_engine::masks_from_planes(width, height, &ids, masks)
        .map_err(|e| JsError::new(&e.to_string()))?;
    pixelcam_engine::process_rgba8_with_masks(pixels, width, height, pipeline_json, Some(&map))
        .map_err(|e| JsError::new(&e.to_string()))
}

/// Process encoded image bytes (JPEG/PNG/WebP) and re-encode.
/// `format` is "png" or "jpeg"; `quality` applies to JPEG only.
#[wasm_bindgen]
pub fn process_encoded(
    image_bytes: &[u8],
    pipeline_json: &str,
    format: &str,
    quality: u8,
) -> Result<Vec<u8>, JsError> {
    let output = match format {
        "jpeg" | "jpg" => pixelcam_engine::OutputFormat::Jpeg(quality),
        _ => pixelcam_engine::OutputFormat::Png,
    };
    pixelcam_engine::process(image_bytes, pipeline_json, output)
        .map_err(|e| JsError::new(&e.to_string()))
}

/// Validate a pipeline JSON document without processing anything.
/// Returns an error message string, or null when valid.
#[wasm_bindgen]
pub fn validate_pipeline(pipeline_json: &str) -> Option<String> {
    match pixelcam_engine::Pipeline::from_json(pipeline_json) {
        Ok(_) => None,
        Err(e) => Some(e.to_string()),
    }
}
