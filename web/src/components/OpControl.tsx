import type { ActiveOp, OperationDef } from "@pixelcam/shared";
import type { OpState, ParamValues } from "../lib/pipelineState";

/** Default params for an op when it is first activated by a user gesture. */
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

export function OpControl({
  def,
  opState,
  onOpChange,
  onMaskBadgeClick,
}: {
  def: OperationDef;
  opState: OpState;
  onOpChange: (next: OpState) => void;
  /** When set, clicking a mask badge focuses that mask overlay. */
  onMaskBadgeClick?: (maskId: string) => void;
}) {
  const current = opState[def.op];
  const active = current !== undefined;
  const params = current?.params;

  const setParam = (key: string, value: number | string) => {
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

  const strength = current?.maskStrength ?? 1;

  return (
    <fieldset className="op" data-active={active || undefined} title={def.description}>
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
      {Object.entries(def.params).map(([key, param]) =>
        param.kind === "slider" ? (
          <label key={key} className="slider">
            {param.label}
            <input
              type="range"
              min={param.min}
              max={param.max}
              step={param.step}
              value={Number(params?.[key] ?? (active ? param.default : param.neutral))}
              onChange={(e) => setParam(key, Number(e.target.value))}
            />
            <output>
              {Number(params?.[key] ?? (active ? param.default : param.neutral)).toFixed(2)}
            </output>
          </label>
        ) : (
          <label key={key} className="select">
            {param.label}
            <select
              value={String(params?.[key] ?? param.default)}
              onChange={(e) => setParam(key, e.target.value)}
            >
              {param.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        ),
      )}
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
