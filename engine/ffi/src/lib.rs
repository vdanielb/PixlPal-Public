//! UniFFI wrapper over the PixlPal engine, consumed by the React Native
//! turbo module (via uniffi-bindgen-react-native). Mirrors the WASM wrapper's
//! surface: raw-pixel fast path, encoded-bytes path, and pipeline validation.

uniffi::setup_scaffolding!();

use pixelcam_engine as engine;

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum EngineError {
    #[error("failed to decode image: {message}")]
    ImageDecode { message: String },
    #[error("failed to encode image: {message}")]
    ImageEncode { message: String },
    #[error("invalid pipeline: {message}")]
    InvalidPipeline { message: String },
    #[error("unsupported pipeline version {version}")]
    UnsupportedVersion { version: u32 },
    #[error("unknown operation \"{op}\"")]
    UnknownOperation { op: String },
    #[error("unknown mask \"{mask}\"")]
    UnknownMask { mask: String },
}

impl From<engine::EngineError> for EngineError {
    fn from(err: engine::EngineError) -> Self {
        match err {
            engine::EngineError::ImageDecode(message) => Self::ImageDecode { message },
            engine::EngineError::ImageEncode(message) => Self::ImageEncode { message },
            engine::EngineError::InvalidPipeline(message) => Self::InvalidPipeline { message },
            engine::EngineError::UnsupportedVersion(version) => Self::UnsupportedVersion { version },
            engine::EngineError::UnknownOperation(op) => Self::UnknownOperation { op },
            engine::EngineError::UnknownMask(mask) => Self::UnknownMask { mask },
        }
    }
}

/// Process a raw RGBA8 pixel buffer through a pipeline JSON document.
#[uniffi::export]
pub fn process_rgba8(
    pixels: Vec<u8>,
    width: u32,
    height: u32,
    pipeline_json: String,
) -> Result<Vec<u8>, EngineError> {
    Ok(engine::process_rgba8(&pixels, width, height, &pipeline_json)?)
}

/// Process encoded image bytes (JPEG/PNG/WebP) and re-encode.
/// `format` is "png" or "jpeg"; `quality` applies to JPEG only (1-100).
#[uniffi::export]
pub fn process_encoded(
    image_bytes: Vec<u8>,
    pipeline_json: String,
    format: String,
    quality: u8,
) -> Result<Vec<u8>, EngineError> {
    let output = match format.as_str() {
        "jpeg" | "jpg" => engine::OutputFormat::Jpeg(quality),
        _ => engine::OutputFormat::Png,
    };
    Ok(engine::process(&image_bytes, &pipeline_json, output)?)
}

/// Validate a pipeline JSON document. Returns an error message, or None when valid.
#[uniffi::export]
pub fn validate_pipeline(pipeline_json: String) -> Option<String> {
    match engine::Pipeline::from_json(&pipeline_json) {
        Ok(_) => None,
        Err(e) => Some(e.to_string()),
    }
}
