//! Declarative pipeline format (versions 1 and 2).
//!
//! ```json
//! {
//!   "version": 2,
//!   "masks": [
//!     { "id": "dress", "source": "segmentation", "prompt": "the red dress", "feather": 0.02 }
//!   ],
//!   "operations": [
//!     { "op": "saturation", "params": { "amount": 0.4 }, "mask": "dress" }
//!   ]
//! }
//! ```
//!
//! `params` is optional on every operation; missing parameters fall back to
//! documented defaults. Unknown `op` names are a hard error so that typos in
//! AI- or human-authored pipelines never silently no-op.
//!
//! Version 2 adds optional per-op `mask` / `invertMask` / `maskStrength`.
//! Mask *bitmaps* are supplied by the host at apply time — the engine never
//! runs a model.

use std::collections::HashMap;

use serde::Deserialize;
use serde_json::Value;

use crate::mask::{blend_masked, MaskBuf};
use crate::ops;
use crate::{EngineError, ImageBuf};

pub const MIN_SUPPORTED_VERSION: u32 = 1;
pub const MAX_SUPPORTED_VERSION: u32 = 2;

#[derive(Debug, Deserialize)]
struct RawPipeline {
    #[serde(default = "default_version")]
    version: u32,
    #[serde(default)]
    #[allow(dead_code)]
    masks: Vec<RawMaskDecl>,
    #[serde(default)]
    operations: Vec<RawOperation>,
}

fn default_version() -> u32 {
    MIN_SUPPORTED_VERSION
}

#[derive(Debug, Deserialize)]
struct RawMaskDecl {
    id: String,
    #[serde(default)]
    #[allow(dead_code)]
    source: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    prompt: Option<String>,
    #[serde(default)]
    feather: Option<f32>,
}

#[derive(Debug, Deserialize)]
struct RawOperation {
    op: String,
    #[serde(default)]
    params: Value,
    #[serde(default)]
    mask: Option<String>,
    #[serde(default, rename = "invertMask")]
    invert_mask: Option<bool>,
    #[serde(default, rename = "maskStrength")]
    mask_strength: Option<f32>,
}

/// Host-declared mask metadata (feather, etc.). Bitmaps arrive separately.
#[derive(Debug, Clone)]
pub struct MaskDecl {
    pub id: String,
    pub feather: f32,
}

/// A parsed, validated pipeline ready to run.
#[derive(Debug)]
pub struct Pipeline {
    operations: Vec<BoundOp>,
    mask_decls: Vec<MaskDecl>,
}

#[derive(Debug)]
struct BoundOp {
    op: Operation,
    mask: Option<String>,
    invert_mask: bool,
    /// 0..1; scales the mask before invert. Only meaningful when `mask` is set.
    mask_strength: f32,
}

#[derive(Debug)]
pub enum Operation {
    Exposure(ops::exposure::Params),
    Contrast(ops::contrast::Params),
    ShadowsHighlights(ops::shadows_highlights::Params),
    ToneCurve(ops::tone_curve::Params),
    LiftBlacks(ops::lift_blacks::Params),
    DodgeBurn(ops::dodge_burn::Params),
    Saturation(ops::saturation::Params),
    ColorBalance(ops::color_balance::Params),
    ColorShift(ops::color_shift::Params),
    Grain(ops::grain::Params),
    FilmSoftness(ops::film_softness::Params),
    Vignette(ops::vignette::Params),
    Bloom(ops::bloom::Params),
    Halation(ops::halation::Params),
    LensBlur(ops::lens_blur::Params),
}

fn parse_params<T: Default + for<'de> Deserialize<'de>>(
    op: &str,
    params: Value,
) -> Result<T, EngineError> {
    if params.is_null() {
        return Ok(T::default());
    }
    serde_json::from_value(params)
        .map_err(|e| EngineError::InvalidPipeline(format!("bad params for \"{op}\": {e}")))
}

impl Pipeline {
    pub fn from_json(json: &str) -> Result<Self, EngineError> {
        let raw: RawPipeline = serde_json::from_str(json)
            .map_err(|e| EngineError::InvalidPipeline(e.to_string()))?;
        if raw.version < MIN_SUPPORTED_VERSION || raw.version > MAX_SUPPORTED_VERSION {
            return Err(EngineError::UnsupportedVersion(raw.version));
        }

        let mask_decls: Vec<MaskDecl> = raw
            .masks
            .into_iter()
            .map(|m| MaskDecl {
                id: m.id,
                feather: m.feather.unwrap_or(0.0).clamp(0.0, 1.0),
            })
            .collect();

        let mut operations = Vec::with_capacity(raw.operations.len());
        for raw_op in raw.operations {
            let name = raw_op.op.as_str();
            let op = match name {
                "exposure" => Operation::Exposure(parse_params(name, raw_op.params)?),
                "contrast" => Operation::Contrast(parse_params(name, raw_op.params)?),
                "shadows_highlights" => {
                    Operation::ShadowsHighlights(parse_params(name, raw_op.params)?)
                }
                "tone_curve" => Operation::ToneCurve(parse_params(name, raw_op.params)?),
                "lift_blacks" => Operation::LiftBlacks(parse_params(name, raw_op.params)?),
                "dodge_burn" => Operation::DodgeBurn(parse_params(name, raw_op.params)?),
                "saturation" => Operation::Saturation(parse_params(name, raw_op.params)?),
                "color_balance" => Operation::ColorBalance(parse_params(name, raw_op.params)?),
                "color_shift" => Operation::ColorShift(parse_params(name, raw_op.params)?),
                "grain" => Operation::Grain(parse_params(name, raw_op.params)?),
                "film_softness" => Operation::FilmSoftness(parse_params(name, raw_op.params)?),
                "vignette" => Operation::Vignette(parse_params(name, raw_op.params)?),
                "bloom" => Operation::Bloom(parse_params(name, raw_op.params)?),
                "halation" => Operation::Halation(parse_params(name, raw_op.params)?),
                "lens_blur" => Operation::LensBlur(parse_params(name, raw_op.params)?),
                other => return Err(EngineError::UnknownOperation(other.to_string())),
            };

            if let Some(ref mask_id) = raw_op.mask {
                if mask_id.is_empty() {
                    return Err(EngineError::InvalidPipeline(
                        "operation mask id must not be empty".into(),
                    ));
                }
            }

            if raw_op.mask_strength.is_some() && raw_op.mask.is_none() {
                return Err(EngineError::InvalidPipeline(
                    "maskStrength requires a mask id".into(),
                ));
            }
            let mask_strength = raw_op.mask_strength.unwrap_or(1.0).clamp(0.0, 1.0);

            operations.push(BoundOp {
                op,
                mask: raw_op.mask,
                invert_mask: raw_op.invert_mask.unwrap_or(false),
                mask_strength,
            });
        }
        Ok(Self {
            operations,
            mask_decls,
        })
    }

    /// Apply the pipeline. `masks` maps declaration ids to bitmaps from the host.
    pub fn apply(
        &self,
        image: &mut ImageBuf,
        masks: Option<&HashMap<String, MaskBuf>>,
    ) -> Result<(), EngineError> {
        let prepared = self.prepare_masks(image.width, image.height, masks)?;

        for bound in &self.operations {
            match &bound.mask {
                None => self.apply_op(image, &bound.op),
                Some(mask_id) => {
                    let mask = prepared.get(mask_id).ok_or_else(|| {
                        EngineError::UnknownMask(mask_id.clone())
                    })?;
                    let mut edited = ImageBuf {
                        width: image.width,
                        height: image.height,
                        data: image.data.clone(),
                    };
                    self.apply_op(&mut edited, &bound.op);
                    *image = blend_masked(
                        image,
                        &edited,
                        mask,
                        bound.invert_mask,
                        bound.mask_strength,
                    );
                }
            }
        }
        Ok(())
    }

    fn prepare_masks(
        &self,
        width: u32,
        height: u32,
        masks: Option<&HashMap<String, MaskBuf>>,
    ) -> Result<HashMap<String, MaskBuf>, EngineError> {
        let empty = HashMap::new();
        let source = masks.unwrap_or(&empty);
        let mut prepared: HashMap<String, MaskBuf> = HashMap::new();

        // Feather any declared masks that have a feather radius.
        for decl in &self.mask_decls {
            if let Some(mask) = source.get(&decl.id) {
                mask.ensure_size(width, height)?;
                let mut owned = mask.clone();
                if decl.feather > 0.0 {
                    owned.feather(decl.feather);
                }
                prepared.insert(decl.id.clone(), owned);
            }
        }

        // Ops may reference masks not listed in masks[] — still require the bitmap.
        for bound in &self.operations {
            if let Some(id) = &bound.mask {
                if prepared.contains_key(id) {
                    continue;
                }
                let mask = source.get(id).ok_or_else(|| EngineError::UnknownMask(id.clone()))?;
                mask.ensure_size(width, height)?;
                prepared.insert(id.clone(), mask.clone());
            }
        }

        Ok(prepared)
    }

    fn apply_op(&self, image: &mut ImageBuf, op: &Operation) {
        match op {
            Operation::Exposure(p) => ops::exposure::apply(image, p),
            Operation::Contrast(p) => ops::contrast::apply(image, p),
            Operation::ShadowsHighlights(p) => ops::shadows_highlights::apply(image, p),
            Operation::ToneCurve(p) => ops::tone_curve::apply(image, p),
            Operation::LiftBlacks(p) => ops::lift_blacks::apply(image, p),
            Operation::DodgeBurn(p) => ops::dodge_burn::apply(image, p),
            Operation::Saturation(p) => ops::saturation::apply(image, p),
            Operation::ColorBalance(p) => ops::color_balance::apply(image, p),
            Operation::ColorShift(p) => ops::color_shift::apply(image, p),
            Operation::Grain(p) => ops::grain::apply(image, p),
            Operation::FilmSoftness(p) => ops::film_softness::apply(image, p),
            Operation::Vignette(p) => ops::vignette::apply(image, p),
            Operation::Bloom(p) => ops::bloom::apply(image, p),
            Operation::Halation(p) => ops::halation::apply(image, p),
            Operation::LensBlur(p) => ops::lens_blur::apply(image, p),
        }
    }

    pub fn len(&self) -> usize {
        self.operations.len()
    }

    pub fn is_empty(&self) -> bool {
        self.operations.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_full_pipeline() {
        let json = r#"{
            "version": 1,
            "operations": [
                { "op": "grain", "params": { "amount": 0.65, "size": 1.8 } },
                { "op": "tone_curve", "params": { "preset": "soft" } },
                { "op": "halation", "params": { "strength": 0.25 } }
            ]
        }"#;
        let p = Pipeline::from_json(json).unwrap();
        assert_eq!(p.len(), 3);
    }

    #[test]
    fn parses_version_two_with_masks() {
        let json = r#"{
            "version": 2,
            "masks": [{ "id": "dress", "prompt": "the red dress", "feather": 0.02 }],
            "operations": [
                { "op": "saturation", "params": { "amount": 0.4 }, "mask": "dress" },
                { "op": "exposure", "params": { "amount": -0.2 }, "mask": "dress", "invertMask": true }
            ]
        }"#;
        let p = Pipeline::from_json(json).unwrap();
        assert_eq!(p.len(), 2);
        assert_eq!(p.mask_decls.len(), 1);
    }

    #[test]
    fn params_are_optional() {
        let p = Pipeline::from_json(r#"{"version":1,"operations":[{"op":"lift_blacks"}]}"#).unwrap();
        assert_eq!(p.len(), 1);
    }

    #[test]
    fn version_defaults_to_one() {
        let p = Pipeline::from_json(r#"{"operations":[]}"#).unwrap();
        assert!(p.is_empty());
    }

    #[test]
    fn unknown_op_is_an_error() {
        let err = Pipeline::from_json(r#"{"version":1,"operations":[{"op":"sharpen_9000"}]}"#)
            .unwrap_err();
        assert!(matches!(err, EngineError::UnknownOperation(op) if op == "sharpen_9000"));
    }

    #[test]
    fn bad_param_type_is_an_error() {
        let err = Pipeline::from_json(
            r#"{"version":1,"operations":[{"op":"exposure","params":{"amount":"lots"}}]}"#,
        )
        .unwrap_err();
        assert!(matches!(err, EngineError::InvalidPipeline(_)));
    }

    #[test]
    fn unsupported_version_is_an_error() {
        let err = Pipeline::from_json(r#"{"version":99,"operations":[]}"#).unwrap_err();
        assert!(matches!(err, EngineError::UnsupportedVersion(99)));
    }

    #[test]
    fn mask_strength_without_mask_is_an_error() {
        let err = Pipeline::from_json(
            r#"{"version":2,"operations":[{"op":"exposure","params":{"amount":0.2},"maskStrength":0.5}]}"#,
        )
        .unwrap_err();
        assert!(matches!(err, EngineError::InvalidPipeline(msg) if msg.contains("maskStrength")));
    }

    #[test]
    fn parses_dodge_burn_and_mask_strength() {
        let json = r#"{
            "version": 2,
            "operations": [
                {
                    "op": "dodge_burn",
                    "params": { "amount": 0.35, "range": "midtones" },
                    "mask": "dress",
                    "maskStrength": 0.85
                }
            ]
        }"#;
        let p = Pipeline::from_json(json).unwrap();
        assert_eq!(p.len(), 1);
        assert!((p.operations[0].mask_strength - 0.85).abs() < 1e-6);
    }

    #[test]
    fn parses_shadows_highlights_and_mask() {
        let json = r#"{
            "version": 2,
            "operations": [
                {
                    "op": "shadows_highlights",
                    "params": { "shadows": 0.4, "highlights": -0.3 },
                    "mask": "sky",
                    "maskStrength": 0.7
                }
            ]
        }"#;
        let p = Pipeline::from_json(json).unwrap();
        assert_eq!(p.len(), 1);
        assert_eq!(p.operations[0].mask.as_deref(), Some("sky"));
        assert!((p.operations[0].mask_strength - 0.7).abs() < 1e-6);
        assert!(matches!(
            p.operations[0].op,
            Operation::ShadowsHighlights(ref params)
                if (params.shadows - 0.4).abs() < 1e-6
                    && (params.highlights + 0.3).abs() < 1e-6
        ));
    }
}
