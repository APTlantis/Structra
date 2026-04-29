# Structra v1.0.0 Release Notes

Structra v1.0.0 is the first release-candidate milestone for the visual structured data builder and YAML workflow workbench.

## Highlights

- Visual structured data builder for nested values and schema-oriented models.
- Live JSON, YAML, TOML, XML, and JSON Schema export paths.
- JSON and JSON Schema import for round-trip visual editing.
- Template and project save/load support, including workflow state.
- YAML workflow workbench with portable, GitHub Actions, and GitLab CI export targets.
- React Flow workflow graph with dependency handles, add-after controls, node duplicate/delete, edge removal, minimap, and layout reset.
- Structra application branding, window title, favicon, and installer icon set.

## Verification

- `pnpm build`
- `pnpm test:workflow`
- `cargo fmt --check`
- `cargo test`
- `cargo check`
- In-app browser smoke checks for workflow graph authoring controls.

## Packaging Targets

- Windows executable bundle.
- Windows MSI installer.
