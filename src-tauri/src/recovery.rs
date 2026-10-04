//! Local crash checkpoints. Source snapshots are copied once; subsequent writes
//! contain only bounded project metadata. Renderer-supplied references grant no scope.
use crate::{persistence, portable};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use tauri_plugin_fs::FsExt;

const MAX_METADATA: u64 = 16 * 1024 * 1024;
const MAX_PDF: u64 = 256 * 1024 * 1024;
const MAX_ENTRIES: usize = 8;
const MAX_STORAGE: u64 = 512 * 1024 * 1024;

#[derive(Default)]
pub struct RecoveryWrites(Mutex<()>);

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    id: String,
    updated_at: u64,
    project: serde_json::Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    id: String,
    filename: String,
    updated_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recovered {
    text: String,
    source_path: PathBuf,
}

fn valid_id(id: &str) -> Result<(), String> {
    if id.len() == 64
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        Ok(())
    } else {
        Err("Invalid recovery identifier".into())
    }
}

fn metadata_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    valid_id(id)?;
    Ok(root.join(format!("{id}.json")))
}

fn source_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    valid_id(id)?;
    Ok(root.join(format!("{id}.pdf")))
}

fn regular_size(path: &Path, max: u64) -> Result<u64, String> {
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.file_type().is_file() || meta.len() == 0 || meta.len() > max {
        return Err("Invalid or oversized recovery file".into());
    }
    Ok(meta.len())
}

fn identity(value: &serde_json::Value) -> Result<(u64, &str), String> {
    let size = value["source"]["size"]
        .as_u64()
        .ok_or("Missing recovery source size")?;
    let hash = value["source"]["sha256"]
        .as_str()
        .ok_or("Missing recovery source hash")?;
    valid_id(hash)?;
    if size == 0 || size > MAX_PDF {
        return Err("Recovery source exceeds 256 MiB".into());
    }
    let name = value["source"]["filename"]
        .as_str()
        .ok_or("Missing recovery filename")?;
    if name.is_empty() || name.len() > 4096 {
        return Err("Invalid recovery filename".into());
    }
    Ok((size, hash))
}

fn load(root: &Path, id: &str) -> Result<Record, String> {
    let path = metadata_path(root, id)?;
    regular_size(&path, MAX_METADATA)?;
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(|e| e.to_string())?
        .take(MAX_METADATA + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_METADATA {
        return Err("Recovery metadata exceeds 16 MiB".into());
    }
    let record: Record = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    if record.id != id || record.updated_at == 0 || record.updated_at > 8_640_000_000_000_000 {
        return Err("Invalid recovery record".into());
    }
    portable::envelope(&record.project.to_string())?;
    let (size, _) = identity(&record.project)?;
    if regular_size(&source_path(root, id)?, MAX_PDF)? != size {
        return Err("Recovery source size mismatch".into());
    }
    Ok(record)
}

fn records(root: &Path) -> Result<Vec<Record>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut items = Vec::new();
    for (count, entry) in fs::read_dir(root).map_err(|e| e.to_string())?.enumerate() {
        if count >= 256 {
            return Err("Recovery directory contains too many files".into());
        }
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.path().extension().and_then(|v| v.to_str()) != Some("json") {
            continue;
        }
        if let Some(id) = entry.path().file_stem().and_then(|v| v.to_str()) {
            if let Ok(record) = load(root, id) {
                items.push(record);
            }
        }
        if items.len() > 128 {
            return Err("Recovery directory contains too many records".into());
        }
    }
    items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then(a.id.cmp(&b.id)));
    Ok(items)
}

fn cleanup_interrupted_writes(root: &Path) -> Result<(), String> {
    if !root.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.ends_with(".tmp")
            && (name.starts_with("snapshot-") || name.starts_with("checkpoint-"))
        {
            fs::remove_file(path).map_err(|e| e.to_string())?;
        } else if path.extension().and_then(|v| v.to_str()) == Some("pdf") {
            if let Some(id) = path.file_stem().and_then(|v| v.to_str()) {
                if valid_id(id).is_ok() && !metadata_path(root, id)?.exists() {
                    fs::remove_file(path).map_err(|e| e.to_string())?;
                }
            }
        }
    }
    Ok(())
}

fn remove(root: &Path, id: &str) -> Result<(), String> {
    // Each target has a fixed parent and a validated hash name. No recursive deletion.
    for path in [metadata_path(root, id)?, source_path(root, id)?] {
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}

fn snapshot(root: &Path, id: &str, source: &Path, size: u64, hash: &str) -> Result<(), String> {
    let destination = source_path(root, id)?;
    if destination.exists() {
        // Check size without re-reading a large PDF on every annotation change.
        if regular_size(&destination, MAX_PDF)? == size {
            return Ok(());
        }
        return Err("Recovery source snapshot is damaged".into());
    }
    let input = File::open(source).map_err(|e| e.to_string())?;
    if input.metadata().map_err(|e| e.to_string())?.len() != size {
        return Err("Source PDF changed before recovery checkpoint".into());
    }
    let mut input = input.take(MAX_PDF + 1);
    let mut temporary = tempfile::Builder::new()
        .prefix("snapshot-")
        .suffix(".tmp")
        .tempfile_in(root)
        .map_err(|e| e.to_string())?;
    let mut digest = Sha256::new();
    let mut bytes = [0; 64 * 1024];
    let mut copied = 0u64;
    loop {
        let count = input.read(&mut bytes).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        copied += count as u64;
        if copied > size {
            return Err("Source PDF changed during recovery snapshot".into());
        }
        temporary
            .write_all(&bytes[..count])
            .map_err(|e| e.to_string())?;
        digest.update(&bytes[..count]);
    }
    if copied != size || format!("{:x}", digest.finalize()) != hash {
        return Err("Source PDF changed during recovery snapshot".into());
    }
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    temporary.persist(&destination).map_err(|e| e.to_string())?;
    Ok(())
}

fn checkpoint(
    root: &Path,
    source: &Path,
    project_path: Option<&Path>,
    text: &str,
    previous_id: Option<&str>,
    updated_at: u64,
) -> Result<String, String> {
    if text.len() as u64 > MAX_METADATA {
        return Err("Recovery metadata exceeds 16 MiB".into());
    }
    let mut project = portable::envelope(text)?;
    let (size, hash) = identity(&project)?;
    let id = if let Some(id) = previous_id {
        let previous = load(root, id)?;
        if identity(&previous.project)? != (size, hash) {
            return Err("Recovery source identity mismatch".into());
        }
        id.to_string()
    } else {
        let origin = project_path
            .unwrap_or(source)
            .to_string_lossy()
            .replace('\\', "/");
        let origin = if cfg!(windows) {
            origin.to_lowercase()
        } else {
            origin
        };
        // Opening the original again must not overwrite a crash checkpoint
        // that the user has not recovered or dismissed yet.
        format!(
            "{:x}",
            Sha256::digest(format!("{origin}\n{hash}\n{updated_at}"))
        )
    };
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    cleanup_interrupted_writes(root)?;
    project["source"]["reference"] = project["source"]["filename"].clone();
    let record = Record {
        id: id.clone(),
        project,
        updated_at,
    };
    let bytes = serde_json::to_vec(&record).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_METADATA {
        return Err("Recovery metadata exceeds 16 MiB".into());
    }
    let (size, hash) = identity(&record.project)?;
    snapshot(root, &id, source, size, hash)?;
    let mut temp = tempfile::Builder::new()
        .prefix("checkpoint-")
        .suffix(".tmp")
        .tempfile_in(root)
        .map_err(|e| e.to_string())?;
    temp.write_all(&bytes).map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(metadata_path(root, &id)?)
        .map_err(|e| e.to_string())?;
    let mut total = 0u64;
    let mut count = 0usize;
    let mut items = records(root)?;
    // Preserve the active checkpoint even when timestamps have the same millisecond.
    items.sort_by_key(|r| r.id != id);
    for record in items {
        let entry_bytes = regular_size(&source_path(root, &record.id)?, MAX_PDF)?
            + regular_size(&metadata_path(root, &record.id)?, MAX_METADATA)?;
        if count >= MAX_ENTRIES || total + entry_bytes > MAX_STORAGE {
            remove(root, &record.id)?;
        } else {
            count += 1;
            total += entry_bytes;
        }
    }
    Ok(id)
}

fn location(app: &tauri::AppHandle, window: &tauri::WebviewWindow) -> Result<PathBuf, String> {
    if window.label() != "main" {
        return Err("Recovery is available only in the editor".into());
    }
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("recovery"))
}

#[tauri::command]
pub async fn write_recovery(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    source_path: PathBuf,
    project_path: Option<PathBuf>,
    text: String,
    recovery_id: Option<String>,
) -> Result<String, String> {
    let root = location(&app, &window)?;
    persistence::allowed(&app, &source_path)?;
    if let Some(path) = &project_path {
        persistence::allowed(&app, path)?;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<RecoveryWrites>();
        let _guard = state.0.lock().map_err(|e| e.to_string())?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis() as u64;
        checkpoint(
            &root,
            &source_path,
            project_path.as_deref(),
            &text,
            recovery_id.as_deref(),
            now,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_recovery(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Vec<Entry>, String> {
    let root = location(&app, &window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<RecoveryWrites>();
        let _guard = state.0.lock().map_err(|e| e.to_string())?;
        cleanup_interrupted_writes(&root)?;
        Ok(records(&root)?
            .into_iter()
            .take(MAX_ENTRIES)
            .map(|record| Entry {
                filename: record.project["source"]["filename"]
                    .as_str()
                    .unwrap_or("Recovered PDF")
                    .to_string(),
                id: record.id,
                updated_at: record.updated_at,
            })
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn read_recovery(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
) -> Result<Recovered, String> {
    let root = location(&app, &window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<RecoveryWrites>();
        let _guard = state.0.lock().map_err(|e| e.to_string())?;
        let record = load(&root, &id)?;
        let (size, hash) = identity(&record.project)?;
        let path = source_path(&root, &id)?;
        persistence::verify_source_identity(&path, size, hash)?;
        let mut bytes = Vec::with_capacity(size as usize);
        File::open(path)
            .map_err(|e| e.to_string())?
            .take(MAX_PDF + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        // Reverify after reading; metadata never authorizes a path from the record.
        if bytes.len() as u64 != size || format!("{:x}", Sha256::digest(&bytes)) != hash {
            return Err("Recovery source changed while opening".into());
        }
        let extracted = app.state::<portable::EmbeddedSources>().extract(&bytes)?;
        app.fs_scope()
            .allow_file(&extracted)
            .map_err(|e| e.to_string())?;
        Ok(Recovered {
            text: record.project.to_string(),
            source_path: extracted,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_recovery(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
) -> Result<(), String> {
    let root = location(&app, &window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<RecoveryWrites>();
        let _guard = state.0.lock().map_err(|e| e.to_string())?;
        remove(&root, &id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn project(pdf: &[u8], note: &str) -> String {
        serde_json::json!({ "format":"pdf-markup-project", "version":2,
            "source":{"size":pdf.len(), "sha256":format!("{:x}", Sha256::digest(pdf)),
            "filename":"floor.pdf", "reference":"C:/private.pdf"},
            "session":{"notes":note} })
        .to_string()
    }
    #[test]
    fn checkpoint_survives_missing_original_and_only_updates_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("cache");
        let source = dir.path().join("original.pdf");
        let pdf = b"%PDF-original";
        fs::write(&source, pdf).unwrap();
        let id = checkpoint(&root, &source, None, &project(pdf, "first"), None, 1).unwrap();
        fs::remove_file(&source).unwrap();
        let snapshot = source_path(&root, &id).unwrap();
        let changed = fs::metadata(&snapshot).unwrap().modified().unwrap();
        checkpoint(&root, &source, None, &project(pdf, "second"), Some(&id), 2).unwrap();
        assert_eq!(
            fs::metadata(&snapshot).unwrap().modified().unwrap(),
            changed
        );
        assert_eq!(fs::read(snapshot).unwrap(), pdf);
        let record = load(&root, &id).unwrap();
        assert_eq!(record.project["session"]["notes"], "second");
        assert_eq!(record.project["source"]["reference"], "floor.pdf");
        remove(&root, &id).unwrap();
        assert!(records(&root).unwrap().is_empty());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
    }
    #[test]
    fn rejects_path_traversal_changed_sources_and_corruption() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("cache");
        let source = dir.path().join("original.pdf");
        let pdf = b"%PDF-original";
        fs::write(&source, b"%PDF-changed!").unwrap();
        assert!(checkpoint(&root, &source, None, &project(pdf, "first"), None, 1).is_err());
        assert!(remove(&root, "../../original").is_err());
        assert!(load(&root, &"A".repeat(64)).is_err());
        fs::write(&source, pdf).unwrap();
        let id = checkpoint(&root, &source, None, &project(pdf, "first"), None, 2).unwrap();
        assert!(checkpoint(
            &root,
            &source,
            None,
            &project(b"different", "bad"),
            Some(&id),
            3
        )
        .is_err());
        fs::write(metadata_path(&root, &id).unwrap(), b"bad json").unwrap();
        assert!(load(&root, &id).is_err());
        assert!(records(&root).unwrap().is_empty());
        assert_eq!(fs::read(source).unwrap(), pdf);
    }
    #[test]
    fn isolates_projects_and_limits_retention() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("cache");
        let source = dir.path().join("original.pdf");
        let pdf = b"%PDF-original";
        fs::write(&source, pdf).unwrap();
        let mut ids = Vec::new();
        for i in 1..=12 {
            ids.push(
                checkpoint(
                    &root,
                    &source,
                    Some(&dir.path().join(format!("{i}.pmarkup"))),
                    &project(pdf, "note"),
                    None,
                    i,
                )
                .unwrap(),
            );
        }
        assert_eq!(records(&root).unwrap().len(), MAX_ENTRIES);
        assert!(load(&root, &ids[0]).is_err());
        assert!(load(&root, &ids[11]).is_ok());
        assert_eq!(fs::read_dir(root).unwrap().count(), MAX_ENTRIES * 2);
    }

    #[test]
    fn reopening_original_does_not_replace_unclaimed_recovery() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("cache");
        let source = dir.path().join("original.pdf");
        let pdf = b"%PDF-original";
        fs::write(&source, pdf).unwrap();
        let first = checkpoint(&root, &source, None, &project(pdf, "old work"), None, 1).unwrap();
        let second = checkpoint(&root, &source, None, &project(pdf, "new work"), None, 2).unwrap();
        assert_ne!(first, second);
        assert_eq!(
            load(&root, &first).unwrap().project["session"]["notes"],
            "old work"
        );
        assert_eq!(
            load(&root, &second).unwrap().project["session"]["notes"],
            "new work"
        );
    }

    #[test]
    fn removes_only_interrupted_internal_files_not_completed_or_unknown_files() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("cache");
        let source = dir.path().join("original.pdf");
        let pdf = b"%PDF-original";
        fs::write(&source, pdf).unwrap();
        let id = checkpoint(&root, &source, None, &project(pdf, "note"), None, 1).unwrap();
        let orphan = source_path(&root, &"b".repeat(64)).unwrap();
        fs::write(&orphan, pdf).unwrap();
        fs::write(root.join("snapshot-aborted.tmp"), pdf).unwrap();
        fs::write(root.join("checkpoint-aborted.tmp"), b"metadata").unwrap();
        fs::write(root.join("user-file.pdf"), pdf).unwrap();
        cleanup_interrupted_writes(&root).unwrap();
        assert!(!orphan.exists());
        assert!(!root.join("snapshot-aborted.tmp").exists());
        assert!(!root.join("checkpoint-aborted.tmp").exists());
        assert!(load(&root, &id).is_ok());
        assert_eq!(fs::read(root.join("user-file.pdf")).unwrap(), pdf);
    }
}
