import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Slider from "@react-native-community/slider";
import {
  CATEGORY_LABELS,
  OPERATION_DEFS,
  type OpCategory,
  type OperationDef,
  type OpState,
  type ParamValues,
  type Pipeline,
} from "@pixelcam/shared";

import { theme } from "./theme";

const CATEGORIES: OpCategory[] = ["tonal", "color", "texture", "optical"];

export function EditorControls({
  opState,
  onOpChange,
  pipeline,
}: {
  opState: OpState;
  onOpChange: (next: OpState) => void;
  pipeline: Pipeline;
}) {
  const [showJson, setShowJson] = useState(false);

  return (
    <View style={styles.container}>
      {CATEGORIES.map((category) => (
        <View key={category}>
          <Text style={styles.sectionTitle}>{CATEGORY_LABELS[category]}</Text>
          {OPERATION_DEFS.filter((def) => def.category === category).map((def) => (
            <OpControl key={def.op} def={def} opState={opState} onOpChange={onOpChange} />
          ))}
        </View>
      ))}

      <Pressable style={styles.jsonToggle} onPress={() => setShowJson((v) => !v)}>
        <Text style={styles.jsonToggleText}>
          Pipeline JSON · {pipeline.operations.length} ops {showJson ? "▾" : "▸"}
        </Text>
      </Pressable>
      {showJson && (
        <View style={styles.jsonBox}>
          <Text style={styles.jsonText}>{JSON.stringify(pipeline, null, 2)}</Text>
        </View>
      )}
    </View>
  );
}

function activationDefaults(def: OperationDef): ParamValues {
  const params: ParamValues = {};
  for (const [key, p] of Object.entries(def.params)) {
    params[key] = p.default;
  }
  return params;
}

function OpControl({
  def,
  opState,
  onOpChange,
}: {
  def: OperationDef;
  opState: OpState;
  onOpChange: (next: OpState) => void;
}) {
  const current = opState[def.op];
  const active = current !== undefined;
  const params = current?.params;

  const setParam = (key: string, value: number | string) => {
    const nextParams = { ...(params ?? activationDefaults(def)), [key]: value };
    onOpChange({
      ...opState,
      [def.op]: {
        params: nextParams,
        ...(current?.mask ? { mask: current.mask } : {}),
        ...(current?.invertMask ? { invertMask: true } : {}),
        ...(current?.mask && current.maskStrength !== undefined
          ? { maskStrength: current.maskStrength }
          : {}),
      },
    });
  };

  const reset = () => {
    const next = { ...opState };
    delete next[def.op];
    onOpChange(next);
  };

  return (
    <View style={[styles.op, active && styles.opActive]}>
      <View style={styles.opHeader}>
        <Text style={[styles.opTitle, active && styles.opTitleActive]}>{def.label}</Text>
        {active && (
          <Pressable onPress={reset} hitSlop={8}>
            <Text style={styles.opReset}>×</Text>
          </Pressable>
        )}
      </View>
      {Object.entries(def.params).map(([key, param]) =>
        param.kind === "slider" ? (
          <View key={key} style={styles.paramRow}>
            <Text style={styles.paramLabel}>{param.label}</Text>
            <Slider
              style={styles.slider}
              minimumValue={param.min}
              maximumValue={param.max}
              step={param.step}
              value={Number(params?.[key] ?? (active ? param.default : param.neutral))}
              minimumTrackTintColor={theme.accent}
              maximumTrackTintColor={theme.borderStrong}
              thumbTintColor={theme.text}
              onSlidingComplete={(value) => setParam(key, value)}
            />
            <Text style={styles.paramValue}>
              {Number(params?.[key] ?? (active ? param.default : param.neutral)).toFixed(2)}
            </Text>
          </View>
        ) : (
          <View key={key} style={styles.paramRow}>
            <Text style={styles.paramLabel}>{param.label}</Text>
            <View style={styles.options}>
              {param.options.map((option) => {
                const selected = String(params?.[key] ?? param.default) === option;
                return (
                  <Pressable
                    key={option}
                    style={[styles.chip, styles.optionChip, selected && styles.chipActive]}
                    onPress={() => setParam(key, option)}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextActive]}>{option}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 4,
  },
  sectionTitle: {
    color: theme.textDim,
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1.4,
    marginTop: 14,
    marginBottom: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.borderStrong,
    backgroundColor: theme.bgInset,
  },
  chipActive: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  chipText: {
    color: theme.text,
    fontSize: 13,
  },
  chipTextActive: {
    color: "#1a1204",
    fontWeight: "600",
  },
  op: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 10,
    backgroundColor: theme.bgInset,
    padding: 10,
    marginBottom: 8,
  },
  opActive: {
    borderColor: theme.accent,
  },
  opHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  opTitle: {
    color: theme.text,
    fontSize: 13,
    fontWeight: "600",
  },
  opTitleActive: {
    color: theme.accent,
  },
  opReset: {
    color: theme.textDim,
    fontSize: 16,
    paddingHorizontal: 6,
  },
  paramRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    gap: 8,
  },
  paramLabel: {
    color: theme.textDim,
    fontSize: 12,
    width: 82,
  },
  slider: {
    flex: 1,
    height: 32,
  },
  paramValue: {
    color: theme.textDim,
    fontSize: 11,
    width: 40,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
  options: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    flex: 1,
  },
  optionChip: {
    paddingVertical: 4,
  },
  jsonToggle: {
    marginTop: 16,
    padding: 10,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 10,
    backgroundColor: theme.bgInset,
  },
  jsonToggleText: {
    color: theme.text,
    fontSize: 13,
    fontWeight: "600",
  },
  jsonBox: {
    marginTop: 6,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "#07080a",
  },
  jsonText: {
    color: "#b7c7a3",
    fontSize: 11,
    fontFamily: "monospace",
  },
});
