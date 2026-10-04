import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { parsePreset, serializePreset, type MarkupPreset } from "./presets";

const filters = [
  { name: "Markup preset (*.pmpreset)", extensions: ["pmpreset"] },
];

export async function importPresetFile() {
  const path = await open({
    title: "Import markup preset",
    multiple: false,
    filters,
  });
  if (!path) return null;
  return parsePreset(await invoke<string>("read_preset", { path }));
}

export async function exportPresetFile(preset: MarkupPreset) {
  const text = serializePreset(preset);
  const path = await save({
    title: "Export markup preset",
    defaultPath: "markup-styles.pmpreset",
    filters,
  });
  if (!path) return null;
  await invoke("write_preset", { path, text });
  return path;
}
