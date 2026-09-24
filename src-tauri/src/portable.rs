//! A bounded, uncompressed container: magic/version, lengths, project JSON, original PDF.
//! Keeping PDF bytes binary avoids base64 overhead and large JSON/IPC allocations.
use std::{collections::HashMap, fs::File, io::{Read, Write}, path::{Path, PathBuf}, sync::Mutex};
use sha2::{Digest, Sha256};

const MAGIC: &[u8; 8] = b"PMARKUP\x01";
const HEADER_BYTES: u64 = 20;
const MAX_METADATA: u64 = 16 * 1024 * 1024;
const MAX_PDF: u64 = 256 * 1024 * 1024;

pub fn envelope(text: &str) -> Result<serde_json::Value, String> {
    let value: serde_json::Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    if value["format"] != "pdf-markup-project"
        || (value["version"] != 1 && value["version"] != 2)
        || !value["source"].is_object()
    { return Err("Invalid project envelope".into()); }
    Ok(value)
}

fn verify_pdf(value: &serde_json::Value, bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() || bytes.len() as u64 > MAX_PDF
        || value["source"]["size"].as_u64() != Some(bytes.len() as u64)
        || value["source"]["sha256"].as_str() != Some(format!("{:x}", Sha256::digest(bytes)).as_str())
    { return Err("The included PDF is damaged or does not match the project".into()); }
    Ok(())
}

pub fn encode(text: &str, pdf: &[u8]) -> Result<Vec<u8>, String> {
    if text.len() as u64 > MAX_METADATA { return Err("Project annotations exceed 16 MiB".into()); }
    let mut value = envelope(text)?;
    verify_pdf(&value, pdf)?;
    // No machine-specific or temporary paths are needed in a portable project.
    value["source"]["reference"] = value["source"]["filename"].clone();
    let metadata = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
    if metadata.len() as u64 > MAX_METADATA { return Err("Project annotations exceed 16 MiB".into()); }
    let mut output = Vec::with_capacity(HEADER_BYTES as usize + metadata.len() + pdf.len());
    output.extend_from_slice(MAGIC);
    output.extend_from_slice(&(metadata.len() as u32).to_le_bytes());
    output.extend_from_slice(&(pdf.len() as u64).to_le_bytes());
    output.extend_from_slice(&metadata);
    output.extend_from_slice(pdf);
    Ok(output)
}

/// Legacy JSON remains supported. PDF payloads are read only when needed.
pub fn read(path: &Path, include_pdf: bool) -> Result<(String, Option<Vec<u8>>), String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let total = file.metadata().map_err(|e| e.to_string())?.len();
    let mut prefix = [0; 8];
    file.read_exact(&mut prefix).map_err(|_| "Incomplete project file")?;
    if &prefix != MAGIC {
        if prefix.starts_with(b"PMARKUP") { return Err("Unsupported project container version".into()); }
        if total > MAX_METADATA { return Err("Legacy project exceeds 16 MiB".into()); }
        let mut bytes = prefix.to_vec();
        file.take(MAX_METADATA + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        if bytes.len() as u64 > MAX_METADATA { return Err("Legacy project exceeds 16 MiB".into()); }
        let text = String::from_utf8(bytes).map_err(|e| e.to_string())?;
        envelope(&text)?;
        return Ok((text, None));
    }
    let mut lengths = [0; 12];
    file.read_exact(&mut lengths).map_err(|_| "Incomplete project header")?;
    let metadata_len = u32::from_le_bytes(lengths[..4].try_into().unwrap()) as u64;
    let pdf_len = u64::from_le_bytes(lengths[4..].try_into().unwrap());
    if metadata_len == 0 || metadata_len > MAX_METADATA || pdf_len == 0 || pdf_len > MAX_PDF
        || total != HEADER_BYTES + metadata_len + pdf_len
    { return Err("Invalid project lengths or incomplete project file".into()); }
    let mut metadata = vec![0; metadata_len as usize];
    file.read_exact(&mut metadata).map_err(|e| e.to_string())?;
    let text = String::from_utf8(metadata).map_err(|e| e.to_string())?;
    let value = envelope(&text)?;
    if value["source"]["size"].as_u64() != Some(pdf_len) { return Err("Included PDF size mismatch".into()); }
    let pdf = if include_pdf {
        let mut bytes = vec![0; pdf_len as usize];
        file.read_exact(&mut bytes).map_err(|e| e.to_string())?;
        verify_pdf(&value, &bytes)?;
        Some(bytes)
    } else { None };
    Ok((text, pdf))
}

/// Generated files are kept alive for the application session and removed on exit.
/// No path supplied by project JSON is used for extraction.
#[derive(Default)]
pub struct EmbeddedSources(Mutex<HashMap<String, tempfile::NamedTempFile>>);
impl EmbeddedSources {
    pub fn extract(&self, bytes: &[u8]) -> Result<PathBuf, String> {
        let hash = format!("{:x}", Sha256::digest(bytes));
        let mut files = self.0.lock().map_err(|e| e.to_string())?;
        if let Some(file) = files.get(&hash) { return Ok(file.path().to_path_buf()); }
        let mut file = tempfile::Builder::new().prefix("pdf-markup-").suffix(".pdf").tempfile().map_err(|e| e.to_string())?;
        file.write_all(bytes).map_err(|e| e.to_string())?;
        file.flush().map_err(|e| e.to_string())?;
        let path = file.path().to_path_buf();
        files.insert(hash, file);
        Ok(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn text(pdf: &[u8]) -> String {
        serde_json::json!({"format":"pdf-markup-project", "version":2,
            "source":{"reference":"C:/original.pdf", "filename":"plan.pdf", "size":pdf.len(),
                "sha256":format!("{:x}", Sha256::digest(pdf))}, "session":{}}).to_string()
    }
    #[test]
    fn roundtrip_without_original_and_temporary_lifetime() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("moved.pmarkup");
        let pdf = b"%PDF-original";
        std::fs::write(&path, encode(&text(pdf), pdf).unwrap()).unwrap();
        let (metadata, payload) = read(&path, true).unwrap();
        assert_eq!(envelope(&metadata).unwrap()["source"]["reference"], "plan.pdf");
        let store = EmbeddedSources::default();
        let extracted = store.extract(&payload.unwrap()).unwrap();
        assert_eq!(std::fs::read(&extracted).unwrap(), pdf);
        assert_eq!(store.extract(pdf).unwrap(), extracted);
        drop(store);
        assert!(!extracted.exists());
    }
    #[test]
    fn rejects_corruption_truncation_oversize_and_future_containers() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bad.pmarkup");
        let good = encode(&text(b"%PDF-original"), b"%PDF-original").unwrap();
        for length in [0, 7, 12, good.len()-1] {
            std::fs::write(&path, &good[..length]).unwrap();
            assert!(read(&path, true).is_err());
        }
        for offset in [7, 11, 19, good.len()-1] {
            let mut bad = good.clone(); bad[offset] ^= 0xff;
            std::fs::write(&path, bad).unwrap();
            assert!(read(&path, true).is_err());
        }
        assert!(encode(&text(b"other"), b"%PDF-original").is_err());
        std::fs::write(&path, text(b"%PDF-original")).unwrap();
        assert!(read(&path, true).unwrap().1.is_none());
    }
}
