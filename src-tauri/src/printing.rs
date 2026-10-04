use std::{
    io::Write,
    sync::{Arc, Mutex},
};
use tauri::{Emitter, Manager};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrintOptions {
    source_path: std::path::PathBuf,
    size: u64,
    sha256: String,
    filename: String,
}

fn decode(request: &tauri::ipc::Request<'_>) -> Result<(PrintOptions, Vec<u8>), String> {
    let metadata = request
        .headers()
        .get("x-print-metadata")
        .ok_or("Missing print metadata")?
        .to_str()
        .map_err(|e| e.to_string())?;
    if metadata.len() > 16384 {
        return Err("Print metadata is too large".into());
    }
    let options: PrintOptions = serde_json::from_str(metadata).map_err(|e| e.to_string())?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Print requires binary PDF data".into());
    };
    if bytes.len() > 256 * 1024 * 1024 || !bytes.starts_with(b"%PDF-") {
        return Err("Invalid or oversized print PDF".into());
    }
    Ok((options, bytes.clone()))
}

#[cfg(windows)]
fn configure_preview(window: &tauri::WebviewWindow) -> Result<(), String> {
    let app = window.app_handle().clone();
    window
        .with_webview(move |webview| {
            let result = unsafe {
                webview
                    .controller()
                    .CoreWebView2()
                    .and_then(|core| core.Settings()?.SetAreDefaultContextMenusEnabled(false))
            };
            if let Err(error) = result {
                let _ = app.emit_to(
                    "main",
                    "print-error",
                    format!("Print preview could not be configured: {error}"),
                );
            }
        })
        .map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn configure_preview(_window: &tauri::WebviewWindow) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn print_annotated_pdf(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Printing is only available from the editor".into());
    }
    if let Some(existing) = app.get_webview_window("print-preview") {
        let _ = existing.set_focus();
        return Err("Close the existing print preview before preparing another PDF".into());
    }
    let (options, bytes) = decode(&request)?;
    crate::persistence::allowed(&app, &options.source_path)?;
    let filename = options.filename;
    let file = tauri::async_runtime::spawn_blocking(move || {
        crate::persistence::verify_source_identity(
            &options.source_path,
            options.size,
            &options.sha256,
        )?;
        let mut file = tempfile::Builder::new()
            .prefix("pdf-markup-print-")
            .suffix(".pdf")
            .tempfile()
            .map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        file.flush().map_err(|e| e.to_string())?;
        Ok::<_, String>(file)
    })
    .await
    .map_err(|e| e.to_string())??;
    let url = tauri::Url::from_file_path(file.path()).map_err(|_| "Invalid print preview path")?;
    let allowed_url = url.clone();
    let file = Arc::new(Mutex::new(Some(file)));
    let preview =
        tauri::WebviewWindowBuilder::new(&app, "print-preview", tauri::WebviewUrl::External(url))
            .title(format!(
                "Print preview — click the printer icon to print — {filename}"
            ))
            .inner_size(1000.0, 760.0)
            .disable_drag_drop_handler()
            .on_navigation(move |url| url == &allowed_url)
            .build()
            .map_err(|e| e.to_string())?;
    // Keep only our generated temporary PDF alive until this preview is destroyed.
    preview.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            if let Ok(mut file) = file.lock() {
                file.take();
            }
        }
    });
    // The embedded PDF viewer requires a user action on its printer button.
    // Programmatic ShowPrintUI can return success without displaying a dialog.
    configure_preview(&preview)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn print_metadata_has_no_arbitrary_output_path() {
        let valid =
            r#"{"sourcePath":"C:/plan.pdf","size":10,"sha256":"hash","filename":"plan.pdf"}"#;
        assert!(serde_json::from_str::<PrintOptions>(valid).is_ok());
        assert!(serde_json::from_str::<PrintOptions>(
            &valid.replace("\"size\":10", "\"path\":\"C:/overwrite.pdf\",\"size\":10")
        )
        .is_err());
    }
}
