use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use tauri_plugin_fs::FsExt;

const LIMIT: usize = 12;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFile {
    path: PathBuf,
    filename: String,
    kind: String,
    last_opened: u64,
}
#[derive(Default)]
pub struct RecentFiles(Mutex<Option<Vec<RecentFile>>>);

fn kind(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "pdf" => Some("pdf"),
        "pmarkup" => Some("project"),
        _ => None,
    }
}
fn same_path(a: &Path, b: &Path) -> bool {
    if cfg!(windows) {
        a.to_string_lossy()
            .replace('/', "\\")
            .eq_ignore_ascii_case(&b.to_string_lossy().replace('/', "\\"))
    } else {
        a == b
    }
}
fn load(path: &Path) -> Vec<RecentFile> {
    fs::read(path)
        .ok()
        .filter(|bytes| bytes.len() <= 128 * 1024)
        .and_then(|bytes| serde_json::from_slice::<Vec<RecentFile>>(&bytes).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(|file| {
            file.path.is_absolute()
                && kind(&file.path) == Some(file.kind.as_str())
                && file.last_opened > 0
                && file.last_opened <= 8_640_000_000_000_000
        })
        .take(LIMIT)
        .collect()
}
fn update(
    files: &[RecentFile],
    path: PathBuf,
    last_opened: u64,
) -> Result<Vec<RecentFile>, String> {
    if !path.is_absolute() {
        return Err("Recent file must have an absolute path".into());
    }
    let kind = kind(&path).ok_or("Only PDFs and editable projects belong in recent files")?;
    let filename = path
        .file_name()
        .ok_or("Missing filename")?
        .to_string_lossy()
        .into_owned();
    let mut next = vec![RecentFile {
        path: path.clone(),
        filename,
        kind: kind.into(),
        last_opened,
    }];
    next.extend(
        files
            .iter()
            .filter(|file| !same_path(&file.path, &path))
            .take(LIMIT - 1)
            .cloned(),
    );
    Ok(next)
}
fn store(path: &Path, files: &[RecentFile]) -> Result<(), String> {
    use std::io::Write;
    fs::create_dir_all(path.parent().ok_or("Missing recent files directory")?)
        .map_err(|e| e.to_string())?;
    let mut temp =
        tempfile::NamedTempFile::new_in(path.parent().unwrap()).map_err(|e| e.to_string())?;
    temp.write_all(&serde_json::to_vec(files).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
fn location(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("recent-files.json"))
}
#[tauri::command]
pub fn list_recent_files(app: tauri::AppHandle) -> Result<Vec<RecentFile>, String> {
    let path = location(&app)?;
    let state = app.state::<RecentFiles>();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    Ok(guard.get_or_insert_with(|| load(&path)).clone())
}
#[tauri::command]
pub fn remember_recent_file(
    app: tauri::AppHandle,
    path: PathBuf,
) -> Result<Vec<RecentFile>, String> {
    if !app.fs_scope().is_allowed(&path) {
        return Err("Select this file in a native dialog before remembering it".into());
    }
    if !path.is_file() {
        return Err("This file no longer exists".into());
    }
    let destination = location(&app)?;
    let state = app.state::<RecentFiles>();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as u64;
    let next = update(guard.get_or_insert_with(|| load(&destination)), path, now)?;
    store(&destination, &next)?;
    *guard = Some(next.clone());
    Ok(next)
}
#[tauri::command]
pub fn authorize_recent_file(app: tauri::AppHandle, path: PathBuf) -> Result<(), String> {
    let files = list_recent_files(app.clone())?;
    let file = files
        .iter()
        .find(|file| same_path(&file.path, &path))
        .ok_or("This file is not in recent files. Use Open PDF or Open Project")?;
    // Only a native-recorded, previously selected path can extend the filesystem scope.
    // Document JSON and frontend storage cannot authorize arbitrary files.
    if !file.path.is_file() {
        return Err(
            "Recent file was moved or removed. Use Open PDF or Open Project to locate it".into(),
        );
    }
    app.fs_scope()
        .allow_file(&file.path)
        .map_err(|e| e.to_string())?;
    let canonical = file.path.canonicalize().map_err(|e| e.to_string())?;
    app.fs_scope()
        .allow_file(canonical)
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn clear_recent_files(app: tauri::AppHandle) -> Result<(), String> {
    let path = location(&app)?;
    let state = app.state::<RecentFiles>();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    store(&path, &[])?;
    *guard = Some(Vec::new());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recents_are_bounded_deduplicated_and_persisted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.json");
        let mut files = Vec::new();
        for i in 0..20 {
            files = update(&files, dir.path().join(format!("plan{i}.pdf")), i + 1).unwrap();
        }
        assert_eq!(files.len(), LIMIT);
        files = update(&files, dir.path().join("plan10.pdf"), 99).unwrap();
        assert_eq!(files[0].filename, "plan10.pdf");
        assert_eq!(
            files
                .iter()
                .filter(|file| file.filename == "plan10.pdf")
                .count(),
            1
        );
        store(&path, &files).unwrap();
        assert_eq!(load(&path)[0].last_opened, 99);
        store(&path, &[]).unwrap();
        assert!(load(&path).is_empty());
    }
    #[test]
    fn invalid_registry_entries_never_authorize_paths() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.json");
        fs::write(&path, "broken").unwrap();
        assert!(load(&path).is_empty());
        assert!(update(&[], PathBuf::from("relative.pdf"), 1).is_err());
        assert!(update(&[], dir.path().join("secret.txt"), 1).is_err());
        let files = vec![RecentFile {
            path: dir.path().join("secret.txt"),
            filename: "secret.txt".into(),
            kind: "pdf".into(),
            last_opened: 1,
        }];
        store(&path, &files).unwrap();
        assert!(load(&path).is_empty());
    }
}
