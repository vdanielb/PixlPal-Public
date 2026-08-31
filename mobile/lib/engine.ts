/**
 * Thin wrapper over the Rust engine turbo module plus the file plumbing the
 * app needs around it: load a photo into bytes, process bytes through a
 * pipeline, and land results back on disk so <Image> can display them.
 */

import { File, Paths } from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import { processEncoded } from "react-native-pixelcam-engine";

const PREVIEW_MAX_WIDTH = 1080;

export interface LoadedPhoto {
  /** Original photo location (full resolution). */
  originalUri: string;
  /** Downscaled JPEG bytes used for live preview processing. */
  previewBytes: Uint8Array;
}

export async function loadPhoto(uri: string, width: number): Promise<LoadedPhoto> {
  let previewUri = uri;
  if (width > PREVIEW_MAX_WIDTH) {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: PREVIEW_MAX_WIDTH } }],
      { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG },
    );
    previewUri = result.uri;
  }
  const previewBytes = await new File(previewUri).bytes();
  return { originalUri: uri, previewBytes };
}

/** Process preview bytes and return a file URI ready for <Image>. */
export function processPreview(previewBytes: Uint8Array, pipelineJson: string): string {
  const processed = processEncoded(toArrayBuffer(previewBytes), pipelineJson, "jpeg", 85);
  return writeTempImage(new Uint8Array(processed), "preview");
}

/** Process the original, full-resolution photo. Returns a file URI. */
export function processFull(originalUri: string, pipelineJson: string): string {
  const bytes = new File(originalUri).bytesSync();
  const processed = processEncoded(toArrayBuffer(bytes), pipelineJson, "jpeg", 92);
  return writeTempImage(new Uint8Array(processed), "export");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer;
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

let tempCounter = 0;

function writeTempImage(bytes: Uint8Array, kind: string): string {
  // Unique name per write: <Image> caches by URI, so reusing a name would
  // show stale frames.
  tempCounter += 1;
  const file = new File(Paths.cache, `pixelcam-${kind}-${tempCounter}.jpg`);
  if (file.exists) {
    file.delete();
  }
  file.write(bytes);
  return file.uri;
}
