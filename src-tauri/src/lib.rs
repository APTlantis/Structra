mod transform;

use transform::{
    generate_output as generate_document_output, validate_document as validate_builder_document,
    DocumentModel, ExportFormat, GeneratedOutput, OutputMode, TransformError, ValidationReport,
};

#[tauri::command]
fn generate_output(
    document: DocumentModel,
    format: ExportFormat,
    mode: OutputMode,
) -> Result<GeneratedOutput, TransformError> {
    generate_document_output(document, format, mode)
}

#[tauri::command]
fn validate_document(document: DocumentModel) -> Result<ValidationReport, TransformError> {
    Ok(validate_builder_document(&document))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![generate_output, validate_document])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
