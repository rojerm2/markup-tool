use serde_json::Value;
use std::{
    fs::File,
    io::Read,
    path::{Path, PathBuf},
};

const MAX_BYTES: u64 = 1024 * 1024;

fn validate(text: &str) -> Result<(), String> {
    if text.len() as u64 > MAX_BYTES {
        return Err("Preset exceeds 1 MiB".into());
    }
    let value: Value = serde_json::from_str(text).map_err(|_| "Invalid preset JSON")?;
    let valid_name = |v: &Value| {
        v.as_str().is_some_and(|s| {
            !s.is_empty()
                && s.trim() == s
                && s.chars().count() <= 256
                && !s.chars().any(char::is_control)
        })
    };
    if value.get("format").and_then(Value::as_str) != Some("pdf-markup-preset")
        || value.get("version").and_then(Value::as_u64) != Some(1)
        || !value.get("name").is_some_and(valid_name)
        || !value.get("drawing").is_some_and(Value::is_object)
        || !value.get("toolStyles").is_some_and(Value::is_object)
        || value
            .get("categories")
            .and_then(Value::as_array)
            .is_none_or(|a| a.len() > 256)
        || value
            .get("symbols")
            .and_then(Value::as_array)
            .is_none_or(|a| a.len() > 32)
    {
        return Err("Unsupported or invalid preset envelope".into());
    }
    // Frontend validation checks geometry, relationships and every style before application.
    // This envelope guard additionally prevents replacing PDFs/projects or future preset formats.
    Ok(())
}

fn read(path: &Path) -> Result<String, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_BYTES {
        return Err("Preset exceeds 1 MiB or is not a file".into());
    }
    let mut text = String::new();
    file.take(MAX_BYTES + 1)
        .read_to_string(&mut text)
        .map_err(|_| "Preset must be valid UTF-8")?;
    validate(&text)?;
    Ok(text)
}

fn destination(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute()
        || path
            .extension()
            .and_then(|s| s.to_str())
            .is_none_or(|s| !s.eq_ignore_ascii_case("pmpreset"))
        || path
            .file_name()
            .and_then(|s| s.to_str())
            .is_none_or(|s| s.contains(':'))
    {
        return Err("Save presets to an absolute .pmpreset path".into());
    }
    let parent = path
        .parent()
        .ok_or("Missing preset directory")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let target = parent.join(path.file_name().ok_or("Missing preset filename")?);
    if target.exists() {
        read(&target)?;
    }
    Ok(target)
}

fn write(path: &Path, text: &str) -> Result<(), String> {
    validate(text)?;
    let target = destination(path)?;
    crate::persistence::atomic_write(&target, text.as_bytes(), || {
        if target.exists() {
            read(&target)?;
        }
        Ok(())
    })
}

#[tauri::command]
pub async fn read_preset(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    path: PathBuf,
) -> Result<String, String> {
    if window.label() != "main" {
        return Err("Presets are only available from the editor".into());
    }
    crate::persistence::allowed(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || read(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn write_preset(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    path: PathBuf,
    text: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Presets are only available from the editor".into());
    }
    crate::persistence::allowed(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || write(&path, &text))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    const PRESET: &str = r##"{"format":"pdf-markup-preset","version":1,"name":"Floor plan","drawing":{"color":"#facc15","width":10,"opacity":0.4},"toolStyles":{"shape":{"color":"#38bdf8","width":2,"fill":null},"measurement":{"color":"#0284c7","width":2,"fontSize":12}},"categories":[],"symbols":[]}"##;

    #[test]
    fn roundtrip_replace_and_reject_unrelated_or_future_destinations() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("styles.pmpreset");
        write(&path, PRESET).unwrap();
        assert_eq!(read(&path).unwrap(), PRESET);
        let changed = PRESET.replace("Floor plan", "Revised");
        write(&path, &changed).unwrap();
        assert_eq!(read(&path).unwrap(), changed);
        for contents in [
            "%PDF-1.7 unrelated source",
            "{\"format\":\"pdf-markup-project\",\"version\":4}",
            &PRESET.replace("\"version\":1", "\"version\":99"),
        ] {
            std::fs::write(&path, contents).unwrap();
            assert!(write(&path, PRESET).is_err());
            assert_eq!(std::fs::read_to_string(&path).unwrap(), contents);
        }
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn bounds_reads_writes_and_extensions_without_partial_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("styles.pmpreset");
        std::fs::write(&path, "old content").unwrap();
        assert!(write(&path, &"x".repeat(MAX_BYTES as usize + 1)).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "old content");
        assert!(write(&dir.path().join("source.pdf"), PRESET).is_err());
        assert!(write(&dir.path().join("project.pmarkup"), PRESET).is_err());
        assert!(write(Path::new("relative.pmpreset"), PRESET).is_err());
        for filename in [
            "styles.pmpreset.",
            "styles.pmpreset ",
            "styles.pmpreset:stream",
        ] {
            assert!(write(&dir.path().join(filename), PRESET).is_err());
        }
        let file = File::create(&path).unwrap();
        file.set_len(MAX_BYTES + 1).unwrap();
        assert!(read(&path).is_err());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn validates_bounded_names_counts_utf8_and_envelope_fields() {
        for text in [
            "null",
            "{}",
            &PRESET.replace("Floor plan", "Bad\\nname"),
            &PRESET.replace(
                "\"drawing\":{\"color\":\"#facc15\",\"width\":10,\"opacity\":0.4}",
                "\"drawing\":null",
            ),
        ] {
            assert!(validate(text).is_err());
        }
        let mut value: Value = serde_json::from_str(PRESET).unwrap();
        value["categories"] = serde_json::json!(vec!["bad"; 257]);
        assert!(validate(&value.to_string()).is_err());
        value["categories"] = serde_json::json!([]);
        value["symbols"] = serde_json::json!(vec!["bad"; 33]);
        assert!(validate(&value.to_string()).is_err());
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("invalid.pmpreset");
        std::fs::write(&path, [0xff, 0xfe]).unwrap();
        assert!(read(&path).is_err());
    }
}
