import { useState } from "react";
import { HSL_BANDS, type HslBand, type OperationDef } from "@pixelcam/shared";
import type { ActiveOp, OpState, ParamValues } from "../lib/pipelineState";

type HslProperty = "hue" | "sat" | "lum";
type HslView = HslProperty | "all";

const PROPERTIES: { id: HslProperty; label: string }[] = [
  { id: "hue", label: "Hue" },
  { id: "sat", label: "Saturation" },
  { id: "lum", label: "Luminance" },
];

const BAND_LABEL: Record<HslBand, string> = {
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  aqua: "Aqua",
  blue: "Blue",
  purple: "Purple",
  magenta: "Magenta",
};

/** Mid-band swatches used to paint Lightroom-style slider tracks. */
const BAND_COLOR: Record<HslBand, string> = {
  red: "#e24b4b",
  orange: "#ef8a2c",
  yellow: "#e6d13a",
  green: "#3caf4a",
  aqua: "#2bb8b0",
  blue: "#3b6fe0",
  purple: "#7a4fd0",
  magenta: "#d44aa0",
};

const HUE_NEIGHBORS: Record<HslBand, [string, string]> = {
  red: [BAND_COLOR.magenta, BAND_COLOR.orange],
  orange: [BAND_COLOR.red, BAND_COLOR.yellow],
  yellow: [BAND_COLOR.orange, BAND_COLOR.green],
  green: [BAND_COLOR.yellow, BAND_COLOR.aqua],
  aqua: [BAND_COLOR.green, BAND_COLOR.blue],
  blue: [BAND_COLOR.aqua, BAND_COLOR.purple],
  purple: [BAND_COLOR.blue, BAND_COLOR.magenta],
  magenta: [BAND_COLOR.purple, BAND_COLOR.red],
};

function trackGradient(property: HslProperty, band: HslBand): string {
  const color = BAND_COLOR[band];
  if (property === "hue") {
    const [left, right] = HUE_NEIGHBORS[band];
    return `linear-gradient(to right, ${left}, ${color} 50%, ${right})`;
  }
  if (property === "sat") {
    return `linear-gradient(to right, #6a6a6a, ${color})`;
  }
  return `linear-gradient(to right, #141414, ${color}, #f2f2f2)`;
}

function paramKey(band: HslBand, property: HslProperty): `${HslBand}_${HslProperty}` {
  return `${band}_${property}`;
}

function activationDefaults(def: OperationDef): ParamValues {
  const params: ParamValues = {};
  for (const [key, p] of Object.entries(def.params)) {
    params[key] = p.default;
  }
  return params;
}

function withMaskFields(current: ActiveOp | undefined, params: ParamValues): ActiveOp {
  return {
    params,
    ...(current?.mask ? { mask: current.mask } : {}),
    ...(current?.invertMask ? { invertMask: true } : {}),
    ...(current?.mask !== undefined && current.maskStrength !== undefined
      ? { maskStrength: current.maskStrength }
      : {}),
  };
}

export function HslMixerControl({
  def,
  opState,
  onOpChange,
  onMaskBadgeClick,
}: {
  def: OperationDef;
  opState: OpState;
  onOpChange: (next: OpState) => void;
  onMaskBadgeClick?: (maskId: string) => void;
}) {
  const [view, setView] = useState<HslView>("all");
  const current = opState[def.op];
  const active = current !== undefined;
  const params = current?.params;
  const strength = current?.maskStrength ?? 1;

  const setParam = (key: string, value: number) => {
    const nextParams = { ...(params ?? activationDefaults(def)), [key]: value };
    onOpChange({
      ...opState,
      [def.op]: withMaskFields(current, nextParams),
    });
  };

  const setMaskStrength = (value: number) => {
    if (!current?.mask) return;
    onOpChange({
      ...opState,
      [def.op]: {
        ...withMaskFields(current, current.params),
        maskStrength: value,
      },
    });
  };

  const reset = () => {
    const next = { ...opState };
    delete next[def.op];
    onOpChange(next);
  };

  const families = view === "all" ? PROPERTIES : PROPERTIES.filter((p) => p.id === view);

  return (
    <fieldset className="op hsl-mixer" data-active={active || undefined} title={def.description}>
      <legend>
        {def.label}
        {current?.mask && (
          <button
            type="button"
            className="mask-badge"
            title={
              current.invertMask
                ? `Masked (inverted): ${current.mask}`
                : `Masked: ${current.mask}`
            }
            onClick={() => onMaskBadgeClick?.(current.mask!)}
          >
            {current.invertMask ? `¬${current.mask}` : current.mask}
          </button>
        )}
        {active && (
          <button className="reset" onClick={reset} title={`Remove ${def.label}`}>
            ×
          </button>
        )}
      </legend>

      <nav className="hsl-views" aria-label="HSL property">
        <menu>
          {([...PROPERTIES, { id: "all" as const, label: "All" }]).map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={view === item.id ? "active" : undefined}
                aria-pressed={view === item.id}
                onClick={() => setView(item.id)}
              >
                {item.label}
              </button>
            </li>
          ))}
        </menu>
      </nav>

      {families.map((family) => (
        <fieldset key={family.id} className="hsl-family">
          <legend>{family.label}</legend>
          {HSL_BANDS.map((band) => {
            const key = paramKey(band, family.id);
            const param = def.params[key];
            if (!param || param.kind !== "slider") return null;
            const value = Number(
              params?.[key] ?? (active ? param.default : param.neutral),
            );
            return (
              <label key={key} className="slider hsl-slider">
                {BAND_LABEL[band]}
                <input
                  type="range"
                  className="hsl-track"
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  value={value}
                  aria-label={`${BAND_LABEL[band]} ${family.label}`}
                  style={{ ["--hsl-track" as string]: trackGradient(family.id, band) }}
                  onChange={(e) => setParam(key, Number(e.target.value))}
                />
                <output>{value.toFixed(2)}</output>
              </label>
            );
          })}
        </fieldset>
      ))}

      {current?.mask && (
        <label className="slider">
          Mask strength
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={strength}
            onChange={(e) => setMaskStrength(Number(e.target.value))}
          />
          <output>{strength.toFixed(2)}</output>
        </label>
      )}
    </fieldset>
  );
}
