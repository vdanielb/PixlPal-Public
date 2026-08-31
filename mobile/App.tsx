import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";
import {
  opStateToPipeline,
  serializePipeline,
  type OpState,
} from "@pixelcam/shared";

import { loadPhoto, processFull, processPreview, type LoadedPhoto } from "./lib/engine";
import { EditorControls } from "./components/EditorControls";
import { theme } from "./components/theme";

export default function App() {
  const [photo, setPhoto] = useState<LoadedPhoto | null>(null);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [opState, setOpState] = useState<OpState>({});
  const [busy, setBusy] = useState(false);
  const [comparing, setComparing] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pipeline = useMemo(() => opStateToPipeline(opState), [opState]);
  const pipelineJson = useMemo(() => serializePipeline(pipeline), [pipeline]);

  const pickPhoto = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
    });
    const asset = result.assets?.[0];
    if (!asset) return;
    setBusy(true);
    try {
      const loaded = await loadPhoto(asset.uri, asset.width);
      setPhoto(loaded);
      setOpState({});
      setPreviewUri(processPreview(loaded.previewBytes, serializePipeline(opStateToPipeline({}))));
    } catch (err) {
      Alert.alert("Could not open photo", String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  // Re-process the preview whenever the pipeline changes (debounced so
  // slider drags settle before the engine runs).
  useEffect(() => {
    if (!photo) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      try {
        setPreviewUri(processPreview(photo.previewBytes, pipelineJson));
      } catch (err) {
        Alert.alert("Engine error", String(err));
      }
    }, 120);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [photo, pipelineJson]);

  const changeOps = useCallback((next: OpState) => {
    setOpState(next);
  }, []);

  const exportPhoto = useCallback(
    async (action: "save" | "share") => {
      if (!photo) return;
      setBusy(true);
      try {
        const uri = processFull(photo.originalUri, pipelineJson);
        if (action === "save") {
          const permission = await MediaLibrary.requestPermissionsAsync();
          if (!permission.granted) {
            Alert.alert("Permission needed", "Allow photo library access to save your edit.");
            return;
          }
          await MediaLibrary.saveToLibraryAsync(uri);
          Alert.alert("Saved", "Your edited photo is in your library.");
        } else {
          await Sharing.shareAsync(uri, { mimeType: "image/jpeg" });
        }
      } catch (err) {
        Alert.alert("Export failed", String(err));
      } finally {
        setBusy(false);
      }
    },
    [photo, pipelineJson],
  );

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.topbar}>
        <Text style={styles.logo}>
          Pixl<Text style={styles.logoAccent}>Pal</Text>
        </Text>
        {photo && (
          <View style={styles.topActions}>
            <Pressable style={styles.button} onPress={() => exportPhoto("share")} disabled={busy}>
              <Text style={styles.buttonText}>Share</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.buttonPrimary]}
              onPress={() => exportPhoto("save")}
              disabled={busy}
            >
              <Text style={[styles.buttonText, styles.buttonPrimaryText]}>Save</Text>
            </Pressable>
          </View>
        )}
      </View>

      {!photo ? (
        <View style={styles.landing}>
          <Text style={styles.landingTitle}>Welcome to PixlPal.</Text>
          <Text style={styles.landingBody}>
            PixlPal lets anyone edit photos. Just describe the changes you want in plain English.
          </Text>
          <Pressable style={[styles.button, styles.buttonPrimary, styles.pickButton]} onPress={pickPhoto}>
            <Text style={[styles.buttonText, styles.buttonPrimaryText]}>Choose a photo</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.editor} stickyHeaderIndices={[]}>
          <Pressable
            onPressIn={() => setComparing(true)}
            onPressOut={() => setComparing(false)}
            style={styles.previewWrap}
          >
            {previewUri && (
              <Image
                source={{ uri: comparing ? photo.originalUri : previewUri }}
                style={styles.preview}
                resizeMode="contain"
              />
            )}
            {busy && <ActivityIndicator style={styles.spinner} color={theme.accent} />}
            <Text style={styles.previewHint}>
              {comparing ? "original" : "hold to compare"}
            </Text>
          </Pressable>

          <EditorControls opState={opState} onOpChange={changeOps} pipeline={pipeline} />

          <Pressable style={[styles.button, styles.newPhoto]} onPress={pickPhoto}>
            <Text style={styles.buttonText}>Choose a different photo</Text>
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  logo: {
    color: theme.text,
    fontSize: 17,
    fontWeight: "700",
  },
  logoAccent: {
    color: theme.accent,
  },
  topActions: {
    flexDirection: "row",
    gap: 8,
  },
  button: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.borderStrong,
    backgroundColor: theme.bgInset,
  },
  buttonText: {
    color: theme.text,
    fontSize: 13,
    fontWeight: "600",
  },
  buttonPrimary: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  buttonPrimaryText: {
    color: "#1a1204",
  },
  landing: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 16,
  },
  landingTitle: {
    color: theme.text,
    fontSize: 24,
    fontWeight: "700",
    textAlign: "center",
  },
  landingBody: {
    color: theme.textDim,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  pickButton: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 999,
  },
  editor: {
    paddingBottom: 48,
  },
  previewWrap: {
    backgroundColor: "#07080a",
    alignItems: "center",
    justifyContent: "center",
  },
  preview: {
    width: "100%",
    aspectRatio: 1,
  },
  spinner: {
    position: "absolute",
  },
  previewHint: {
    position: "absolute",
    bottom: 8,
    right: 12,
    color: theme.textDim,
    fontSize: 11,
  },
  newPhoto: {
    alignSelf: "center",
    marginTop: 24,
  },
});
