use crate::persistence::{allowed, atomic_write, protected_destination, verify_source_identity};
use std::path::PathBuf;

const MAX_CSV_BYTES: usize = 64 * 1024 * 1024;
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Options {
    path: PathBuf,
    source_path: PathBuf,
    project_path: Option<PathBuf>,
    size: u64,
    sha256: String,
}
fn validate_csv(bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() || bytes.len() > MAX_CSV_BYTES {
        return Err("CSV report must be between 1 byte and 64 MiB".into());
    }
    let text = std::str::from_utf8(bytes).map_err(|_| "CSV report must be UTF-8")?;
    if !text.starts_with("\u{feff}\"Record type\",\"Source page\",\"Export page\",")
        || text.contains('\0')
    {
        return Err("Invalid markup CSV report".into());
    }
    Ok(())
}
fn decode(body: &tauri::ipc::InvokeBody, metadata: &str) -> Result<(Options, Vec<u8>), String> {
    if metadata.len() > 32 * 1024 {
        return Err("Report metadata exceeds 32 KiB".into());
    }
    let options =
        serde_json::from_str(metadata).map_err(|e| format!("Invalid report metadata: {e}"))?;
    let tauri::ipc::InvokeBody::Raw(bytes) = body else {
        return Err("Reports require binary UTF-8 bytes".into());
    };
    validate_csv(bytes)?;
    Ok((options, bytes.clone()))
}
fn write_file(options: &Options, bytes: &[u8]) -> Result<(), String> {
    validate_csv(bytes)?;
    let destination = || {
        protected_destination(
            &options.path,
            &options.source_path,
            options.project_path.as_deref(),
            "csv",
        )
    };
    let target = destination()?;
    verify_source_identity(&options.source_path, options.size, &options.sha256)?;
    atomic_write(&target, bytes, || {
        destination()?;
        verify_source_identity(&options.source_path, options.size, &options.sha256)
    })
}
#[tauri::command]
pub async fn write_report_csv(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Reports can only be saved from the main window".into());
    }
    let metadata = request
        .headers()
        .get("x-export-metadata")
        .ok_or("Missing report metadata")?
        .to_str()
        .map_err(|e| e.to_string())?;
    let (options, bytes) = decode(request.body(), metadata)?;
    allowed(&app, &options.path)?;
    allowed(&app, &options.source_path)?;
    if let Some(project) = &options.project_path {
        allowed(&app, project)?;
    }
    tauri::async_runtime::spawn_blocking(move || write_file(&options, &bytes))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::fs;
    use std::path::Path;
    const CSV: &str = "\u{feff}\"Record type\",\"Source page\",\"Export page\",\"Type\"\r\n";
    fn fixture(dir: &Path) -> Options {
        let source_path = dir.join("source.pdf");
        let source = b"%PDF-fixture";
        fs::write(&source_path, source).unwrap();
        Options {
            path: dir.join("report.csv"),
            source_path,
            project_path: None,
            size: source.len() as u64,
            sha256: format!("{:x}", Sha256::digest(source)),
        }
    }
    #[test]
    fn report_body_and_metadata_are_bounded_and_typed() {
        let metadata = r#"{"path":"C:/report.csv","sourcePath":"C:/source.pdf","projectPath":null,"size":12,"sha256":"hash"}"#;
        assert!(decode(
            &tauri::ipc::InvokeBody::Raw(CSV.as_bytes().to_vec()),
            metadata
        )
        .is_ok());
        assert!(decode(&tauri::ipc::InvokeBody::Raw(vec![0xff]), metadata).is_err());
        assert!(validate_csv(b"%PDF-renamed").is_err());
        assert!(validate_csv(&vec![0; MAX_CSV_BYTES + 1]).is_err());
        assert!(decode(
            &tauri::ipc::InvokeBody::Raw(CSV.as_bytes().to_vec()),
            &" ".repeat(32769)
        )
        .is_err());
        assert!(decode(
            &tauri::ipc::InvokeBody::Raw(CSV.as_bytes().to_vec()),
            &metadata.replace("\"size\":12", "\"unexpected\":true,\"size\":12")
        )
        .is_err());
    }
    #[test]
    fn writes_atomically_and_rejects_changed_source_without_replacing_report() {
        let dir = tempfile::tempdir().unwrap();
        let options = fixture(dir.path());
        write_file(&options, CSV.as_bytes()).unwrap();
        assert_eq!(fs::read(&options.path).unwrap(), CSV.as_bytes());
        fs::write(&options.source_path, b"%PDF-changed").unwrap();
        assert!(write_file(&options, CSV.as_bytes()).is_err());
        assert_eq!(fs::read(&options.path).unwrap(), CSV.as_bytes());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2);
    }
    #[test]
    fn refuses_protected_aliases_and_wrong_extensions() {
        let dir = tempfile::tempdir().unwrap();
        let mut options = fixture(dir.path());
        fs::hard_link(&options.source_path, &options.path).unwrap();
        assert!(write_file(&options, CSV.as_bytes()).is_err());
        fs::remove_file(&options.path).unwrap();
        let project = dir.path().join("project.pmarkup");
        fs::write(&project, b"editable").unwrap();
        fs::hard_link(&project, &options.path).unwrap();
        options.project_path = Some(project.clone());
        assert!(write_file(&options, CSV.as_bytes()).is_err());
        assert_eq!(fs::read(project).unwrap(), b"editable");
        for filename in [
            "output.pdf",
            "output.csv.",
            "output.csv ",
            "output.csv:stream",
        ] {
            options.path = dir.path().join(filename);
            assert!(write_file(&options, CSV.as_bytes()).is_err());
        }
    }
}
