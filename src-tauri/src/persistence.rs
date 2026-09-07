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

// Export uses the same transactional sibling writer as editable projects.
const MAX_PDF_BYTES: u64 = 256 * 1024 * 1024;
fn read_pdf_file(path: &Path) -> Result<Vec<u8>, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    if size == 0 || size > MAX_PDF_BYTES {
        return Err("PDF must be between 1 byte and 256 MiB".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_PDF_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_PDF_BYTES {
        return Err("PDF exceeds 256 MiB".into());
    }
    Ok(bytes)
}
#[tauri::command]
pub async fn read_source_pdf(
    app: tauri::AppHandle,
    path: PathBuf,
) -> Result<tauri::ipc::Response, String> {
    allowed(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || {
        read_pdf_file(&path).map(tauri::ipc::Response::new)
    })
    .await
    .map_err(|e| e.to_string())?
}
fn verified_source(source: &Path, size: u64, sha256: &str) -> Result<Vec<u8>, String> {
    use sha2::{Digest, Sha256};
    if size == 0 || size > MAX_PDF_BYTES {
        return Err("Export supports source PDFs up to 256 MiB".into());
    }
    let file = File::open(source).map_err(|e| format!("Cannot read source PDF: {e}"))?;
    if file.metadata().map_err(|e| e.to_string())?.len() != size {
        return Err("Source PDF changed since opening".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_PDF_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 != size || format!("{:x}", Sha256::digest(&bytes)) != sha256 {
        return Err("Source PDF changed since opening (SHA-256 mismatch)".into());
    }
    Ok(bytes)
}
#[tauri::command]
pub async fn read_export_source(
    app: tauri::AppHandle,
    source_path: PathBuf,
    size: u64,
    sha256: String,
) -> Result<tauri::ipc::Response, String> {
    allowed(&app, &source_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        verified_source(&source_path, size, &sha256).map(tauri::ipc::Response::new)
    })
    .await
    .map_err(|e| e.to_string())?
}
fn export_destination(
    path: &Path,
    source: &Path,
    project: Option<&Path>,
) -> Result<PathBuf, String> {
    if !path.is_absolute()
        || path
            .extension()
            .and_then(|x| x.to_str())
            .map(|x| x.eq_ignore_ascii_case("pdf"))
            != Some(true)
        || path
            .file_name()
            .and_then(|x| x.to_str())
            .is_none_or(|x| x.contains(':'))
    {
        return Err("Choose an absolute destination with the .pdf extension".into());
    }
    let target = path
        .parent()
        .ok_or("Missing parent")?
        .canonicalize()
        .map_err(|e| e.to_string())?
        .join(path.file_name().ok_or("Missing filename")?);
    for protected in std::iter::once(source).chain(project) {
        let canonical = protected.canonicalize().map_err(|e| e.to_string())?;
        if target
            .to_string_lossy()
            .eq_ignore_ascii_case(&canonical.to_string_lossy())
            || (target.exists()
                && same_file::is_same_file(&target, &canonical).map_err(|e| e.to_string())?)
        {
            return Err("Cannot overwrite the source PDF or current editable project".into());
        }
    }
    if target.exists() && !target.is_file() {
        return Err("Destination is not a regular file".into());
    }
    Ok(target)
}
fn export_file(
    path: &Path,
    source: &Path,
    project: Option<&Path>,
    size: u64,
    sha256: &str,
    bytes: &[u8],
) -> Result<(), String> {
    if bytes.len() as u64 > MAX_PDF_BYTES || !bytes.starts_with(b"%PDF-") {
        return Err("Invalid or oversized export (256 MiB limit)".into());
    }
    let target = export_destination(path, source, project)?;
    verified_source(source, size, sha256)?;
    atomic_write(&target, bytes, || {
        export_destination(&target, source, project)?;
        verified_source(source, size, sha256).map(|_| ())
    })
}
#[tauri::command]
pub async fn write_export(
    app: tauri::AppHandle,
    path: PathBuf,
    source_path: PathBuf,
    project_path: Option<PathBuf>,
    size: u64,
    sha256: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    allowed(&app, &path)?;
    allowed(&app, &source_path)?;
    if let Some(project) = &project_path {
        allowed(&app, project)?;
    }
    tauri::async_runtime::spawn_blocking(move || {
        export_file(
            &path,
            &source_path,
            project_path.as_deref(),
            size,
            &sha256,
            &bytes,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    #[test]
    fn bounded_pdf_read_rejects_empty_and_oversized_before_allocation() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("large.pdf");
        let file = File::create(&path).unwrap();
        assert!(read_pdf_file(&path).is_err());
        file.set_len(MAX_PDF_BYTES + 1).unwrap();
        assert!(read_pdf_file(&path).is_err());
        drop(file);
        fs::write(&path, b"%PDF-small").unwrap();
        assert_eq!(read_pdf_file(&path).unwrap(), b"%PDF-small");
    }
    fn identity(bytes: &[u8]) -> (u64, String) {
        use sha2::{Digest, Sha256};
        (bytes.len() as u64, format!("{:x}", Sha256::digest(bytes)))
    }
    #[test]
    fn export_creates_replaces_and_checks_identity() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.pdf");
        let target = dir.path().join("marked.pdf");
        let original = b"%PDF-original";
        fs::write(&source, original).unwrap();
        let (size, hash) = identity(original);
        export_file(&target, &source, None, size, &hash, b"%PDF-first").unwrap();
        export_file(&target, &source, None, size, &hash, b"%PDF-second").unwrap();
        assert_eq!(fs::read(&source).unwrap(), original);
        assert_eq!(verified_source(&source, size, &hash).unwrap(), original);
        fs::write(&source, b"%PDF-modified").unwrap();
        assert!(export_file(&target, &source, None, size, &hash, b"%PDF-third").is_err());
        assert_eq!(fs::read(&target).unwrap(), b"%PDF-second");
        fs::remove_file(&source).unwrap();
        assert!(export_file(&target, &source, None, size, &hash, b"%PDF-third").is_err());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }
    #[test]
    fn export_rejects_protected_aliases_and_invalid_destinations() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.pdf");
        let project = dir.path().join("work.pmarkup");
        fs::write(&source, b"%PDF-original").unwrap();
        fs::write(&project, b"project").unwrap();
        let (size, hash) = identity(b"%PDF-original");
        let alias = dir.path().join("alias.pdf");
        fs::hard_link(&source, &alias).unwrap();
        let project_alias = dir.path().join("project.pdf");
        fs::hard_link(&project, &project_alias).unwrap();
        for name in [
            "source.pdf",
            "SOURCE.PDF",
            "alias.pdf",
            "project.pdf",
            "work.pmarkup",
            "bad.pdf.",
            "bad.pdf ",
            "bad.pdf:stream",
            "bad.txt",
        ] {
            assert!(
                export_file(
                    &dir.path().join(name),
                    &source,
                    Some(&project),
                    size,
                    &hash,
                    b"%PDF-new"
                )
                .is_err(),
                "{name}"
            );
        }
        assert!(export_file(
            &dir.path()
                .join("../")
                .join(dir.path().file_name().unwrap())
                .join("source.pdf"),
            &source,
            None,
            size,
            &hash,
            b"%PDF-new"
        )
        .is_err());
        assert!(export_file(
            Path::new("relative.pdf"),
            &source,
            None,
            size,
            &hash,
            b"%PDF-new"
        )
        .is_err());
        assert!(export_file(
            &dir.path().join("new.pdf"),
            &source,
            None,
            size,
            &hash,
            b"invalid"
        )
        .is_err());
        assert_eq!(fs::read(source).unwrap(), b"%PDF-original");
        assert_eq!(fs::read(project).unwrap(), b"project");
    }
    #[cfg(windows)]
    #[test]
    fn export_sharing_failure_preserves_output_and_cleans_sibling() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.pdf");
        let target = dir.path().join("output.pdf");
        fs::write(&source, b"%PDF-original").unwrap();
        fs::write(&target, b"%PDF-last").unwrap();
        let (size, hash) = identity(b"%PDF-original");
        let lock = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&target)
            .unwrap();
        assert!(export_file(&target, &source, None, size, &hash, b"%PDF-new").is_err());
        drop(lock);
        assert_eq!(fs::read(target).unwrap(), b"%PDF-last");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2);
    }
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
