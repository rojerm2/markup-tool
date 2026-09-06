use std::{
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tauri_plugin_fs::FsExt;

const MAX_BYTES: u64 = 16 * 1024 * 1024;
fn allowed(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    if app.fs_scope().is_allowed(path) {
        Ok(())
    } else {
        Err("Select this file in a native dialog to authorize access".into())
    }
}
#[tauri::command]
pub fn read_project(app: tauri::AppHandle, path: PathBuf) -> Result<String, String> {
    allowed(&app, &path)?;
    let file = File::open(path).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("Project exceeds 16 MiB".into());
    }
    String::from_utf8(bytes).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn resolve_source(
    app: tauri::AppHandle,
    project_path: PathBuf,
    reference: PathBuf,
) -> Result<Option<String>, String> {
    allowed(&app, &project_path)?;
    let path = if reference.is_absolute() {
        reference
    } else {
        project_path
            .parent()
            .ok_or("Project has no parent")?
            .join(reference)
    };
    // A project reference never extends scope. A fresh launch uses Locate PDF.
    if allowed(&app, &path).is_err() || !path.is_file() {
        return Ok(None);
    }
    Ok(Some(path.to_string_lossy().into_owned()))
}
fn checked_destination(path: &Path, source: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("Choose an absolute project path".into());
    }
    // Only our extension: rejects PDF, alternate data streams and trailing-dot/space aliases.
    if path
        .extension()
        .and_then(|x| x.to_str())
        .map(|x| x.eq_ignore_ascii_case("pmarkup"))
        != Some(true)
        || path
            .file_name()
            .and_then(|x| x.to_str())
            .is_none_or(|x| x.contains(':'))
    {
        return Err("Save editable projects with the .pmarkup extension, never as a PDF".into());
    }
    let parent = path
        .parent()
        .ok_or("Missing destination directory")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let target = parent.join(path.file_name().ok_or("Missing filename")?);
    let source = source.canonicalize().map_err(|e| e.to_string())?;
    if target.exists() {
        let canonical = target.canonicalize().map_err(|e| e.to_string())?;
        if canonical
            .to_string_lossy()
            .eq_ignore_ascii_case(&source.to_string_lossy())
        {
            return Err("Cannot overwrite the source PDF".into());
        }
        // Existing destinations must be project JSON. Signature sniffing can miss a
        // renamed PDF with a long prefix, or mistake a legend named "%PDF-" for one.
        let mut bytes = Vec::new();
        File::open(&target)
            .map_err(|e| e.to_string())?
            .take(MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        let existing = serde_json::from_slice::<serde_json::Value>(&bytes).ok();
        if bytes.len() as u64 > MAX_BYTES
            || existing.as_ref().is_none_or(|v| {
                v["format"] != "pdf-markup-project" || v["version"] != 1 || !v["source"].is_object()
            })
        {
            return Err(
                "Cannot overwrite a PDF or non-project destination. Choose a new .pmarkup file"
                    .into(),
            );
        }
    }
    Ok(target)
}
fn atomic_write(
    path: &Path,
    bytes: &[u8],
    before_replace: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let mut temporary = tempfile::NamedTempFile::new_in(path.parent().ok_or("Missing parent")?)
        .map_err(|e| e.to_string())?;
    temporary.write_all(bytes).map_err(|e| e.to_string())?;
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    before_replace()?;
    // tempfile uses MoveFileExW(REPLACE_EXISTING) on Windows, rename on Unix.
    temporary.persist(path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    File::open(path.parent().unwrap())
        .and_then(|f| f.sync_all())
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub async fn write_project(
    app: tauri::AppHandle,
    path: PathBuf,
    source_path: PathBuf,
    text: String,
) -> Result<(), String> {
    allowed(&app, &path)?;
    allowed(&app, &source_path)?;
    tauri::async_runtime::spawn_blocking(move || save_file(&path, &source_path, &text))
        .await
        .map_err(|e| e.to_string())?
}
fn save_file(path: &Path, source: &Path, text: &str) -> Result<(), String> {
    if text.len() as u64 > MAX_BYTES {
        return Err("Project exceeds 16 MiB".into());
    }
    let target = checked_destination(path, source)?;
    let mut value: serde_json::Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    if value["format"] != "pdf-markup-project"
        || value["version"] != 1
        || !value["source"].is_object()
    {
        return Err("Invalid project envelope".into());
    }
    let source = source.canonicalize().map_err(|e| e.to_string())?;
    // Portable within the project directory; otherwise absolute (including other drives).
    let reference = source
        .strip_prefix(target.parent().unwrap())
        .unwrap_or(&source);
    value["source"]["reference"] = reference.to_string_lossy().into_owned().into();
    let bytes = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("Project exceeds 16 MiB after path resolution".into());
    }
    atomic_write(&target, &bytes, || {
        checked_destination(&target, &source).map(|_| ())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    fn project() -> &'static str {
        r#"{"format":"pdf-markup-project","version":1,"source":{}}"#
    }
    #[test]
    fn creates_replaces_and_preserves_source() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("原本 plan.pdf");
        let target = dir.path().join("plan.pmarkup");
        fs::write(&source, b"%PDF-original").unwrap();
        save_file(&target, &source, project()).unwrap();
        let value: serde_json::Value = serde_json::from_slice(&fs::read(&target).unwrap()).unwrap();
        assert_eq!(value["source"]["reference"], "原本 plan.pdf");
        atomic_write(&target, b"second", || Ok(())).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"second");
        assert_eq!(fs::read(&source).unwrap(), b"%PDF-original");
    }
    #[test]
    fn failure_keeps_last_project_and_cleans_temporary() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("saved.pmarkup");
        fs::write(&target, b"last valid").unwrap();
        assert!(atomic_write(
            &target,
            b"new",
            || Err("injected before replacement".into())
        )
        .is_err());
        assert_eq!(fs::read(&target).unwrap(), b"last valid");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
        let directory = dir.path().join("directory.pmarkup");
        fs::create_dir(&directory).unwrap();
        assert!(atomic_write(&directory, b"new", || Ok(())).is_err());
        assert!(directory.is_dir());
        assert!(atomic_write(&dir.path().join("missing/file.pmarkup"), b"new", || Ok(())).is_err());
    }
    #[test]
    fn rejects_pdf_aliases_hardlinks_and_invalid_destinations() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.pdf");
        fs::write(&source, b"%PDF-original").unwrap();
        for name in [
            "source.pdf",
            "SOURCE.PDF",
            "source.pdf.",
            "source.pdf ",
            "x.pmarkup:stream",
            "x.json",
        ] {
            assert!(save_file(&dir.path().join(name), &source, project()).is_err());
        }
        let alias = dir.path().join("alias.pmarkup");
        fs::hard_link(&source, &alias).unwrap();
        assert!(save_file(&alias, &source, project()).is_err());
        assert_eq!(fs::read(&source).unwrap(), b"%PDF-original");
        assert!(save_file(&dir.path().join("x.pmarkup"), &source, "bad json").is_err());
    }
    #[test]
    fn save_as_rebases_paths_and_preserves_both_projects() {
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("原本 plans");
        fs::create_dir(&sub).unwrap();
        let source = sub.join("floor.pdf");
        fs::write(&source, b"%PDF-original").unwrap();
        let first = sub.join("first.pmarkup");
        let second = dir.path().join("second.pmarkup");
        save_file(&first, &source, project()).unwrap();
        let old = fs::read(&first).unwrap();
        save_file(&second, &source, std::str::from_utf8(&old).unwrap()).unwrap();
        let value: serde_json::Value = serde_json::from_slice(&fs::read(&second).unwrap()).unwrap();
        assert_eq!(
            Path::new(value["source"]["reference"].as_str().unwrap()),
            Path::new("原本 plans").join("floor.pdf")
        );
        let other = tempfile::tempdir().unwrap();
        let third = other.path().join("third.pmarkup");
        save_file(&third, &source, project()).unwrap();
        let value: serde_json::Value = serde_json::from_slice(&fs::read(third).unwrap()).unwrap();
        assert!(Path::new(value["source"]["reference"].as_str().unwrap()).is_absolute());
        assert_eq!(fs::read(&first).unwrap(), old);
        assert_eq!(fs::read(&source).unwrap(), b"%PDF-original");
    }
    #[cfg(windows)]
    #[test]
    fn actual_windows_sharing_violation_keeps_last_project() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("locked.pmarkup");
        fs::write(&path, b"last valid").unwrap();
        let lock = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&path)
            .unwrap();
        assert!(atomic_write(&path, b"replacement", || Ok(())).is_err());
        drop(lock);
        assert_eq!(fs::read(&path).unwrap(), b"last valid");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }
    #[test]
    fn recognizes_project_envelope_instead_of_pdf_signature_sniffing() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.pdf");
        fs::write(&source, b"%PDF-original").unwrap();
        let target = dir.path().join("project.pmarkup");
        let text =
            r#"{"format":"pdf-markup-project","version":1,"source":{},"legendName":"%PDF-"}"#;
        save_file(&target, &source, text).unwrap();
        save_file(&target, &source, text).unwrap();
        let disguised = dir.path().join("disguised.pmarkup");
        let bytes = [vec![b' '; 2048], b"%PDF-original".to_vec()].concat();
        fs::write(&disguised, &bytes).unwrap();
        assert!(save_file(&disguised, &source, project()).is_err());
        assert_eq!(fs::read(disguised).unwrap(), bytes);
    }
}
