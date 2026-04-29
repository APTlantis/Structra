# Structra v1.0.0

Structra v1.0.0 is the first official desktop release of the visual structured data builder and YAML workflow workbench.

This release turns Structra from a proof of concept into a usable Windows desktop app: users can design nested data visually, inspect the resulting structure, export values or schema artifacts, import JSON/JSON Schema, and model workflow dependencies with a React Flow graph.

## Download

Attach these generated artifacts to the GitHub release:

- `Structra_1.0.0_x64-setup.exe`
- `Structra_1.0.0_x64_en-US.msi`

Local build paths:

```text
src-tauri/target/release/bundle/nsis/Structra_1.0.0_x64-setup.exe
src-tauri/target/release/bundle/msi/Structra_1.0.0_x64_en-US.msi
```

SHA256:

```text
Structra_1.0.0_x64-setup.exe
E543591AD54BD39E057F84E72806D89EC05FF28B73ABD7F762031CEF8FD366C8

Structra_1.0.0_x64_en-US.msi
094C0D2239614A07A04F6E9A74CD54BDA28D8215EF3147B64E8D7152C1C9F66A
```

## Highlights

- Visual structured data builder for nested payloads, configuration files, API bodies, and schema-oriented models.
- Live export to JSON, YAML, TOML, XML, and JSON Schema.
- JSON and JSON Schema import for round-trip editing.
- Structure view for understanding how field bindings become nested output.
- Explicit type metadata for schema-oriented modeling.
- Template support for reusable structures.
- Project save/load support with `.sdb.json` files.
- YAML workflow workbench for portable workflow authoring.
- Workflow export targets for portable Structra YAML, GitHub Actions, and GitLab CI.
- React Flow workflow graph with dependency handles, minimap, selected-node add-after controls, duplicate/delete actions, edge removal, and layout reset.
- Structra branding across app metadata, browser favicon, window title, installer icons, EXE, and MSI.

## Workflow Builder

The v1 workflow builder supports:

- Run steps with shell commands.
- Action/reference steps for workflow systems such as GitHub Actions.
- Manual approval gates.
- Environment variables per step.
- Dependency modeling through both inspector controls and graph edges.
- Cycle prevention when connecting graph dependencies.
- Execution order inspection and blocked-step warnings.
- Import from portable Structra workflow YAML, GitHub Actions YAML, and GitLab CI YAML.
- Export to portable Structra workflow YAML, GitHub Actions YAML, and GitLab CI YAML.

## Validation and Reliability

This release includes:

- Rust-side structured data validation and output generation.
- Frontend workflow smoke coverage for import/export, graph-position persistence, missing dependency validation, and execution planning.
- Empty workflow graph state.
- Release metadata hardening for product name, version, description, author, window sizing, and installer identity.

## Verification

The release candidate was verified with:

```bash
pnpm build
pnpm test:workflow
cargo fmt --check
cargo test
cargo check
pnpm tauri build
```

In-app browser smoke checks verified:

- `Structra - Structured Data Builder` page title.
- Workflow graph renders with nodes and edges.
- Selected-node `Run after`, `Uses after`, and `Gate after` controls are present.
- Add-after creates a connected downstream node.
- Empty workflow state appears after deleting all graph nodes.
- No browser console errors during the smoke flow.

## Known v1 Boundaries

- Workflow import covers a practical subset of GitHub Actions and GitLab CI rather than every platform feature.
- GitHub Actions export keeps workflow steps sequential where step-level dependencies do not map directly.
- GitLab CI export converts action references into script placeholders.
- Approval gates export as manual/echo-style placeholders depending on the target.
- Workflow execution is not included in v1.0.0; this release focuses on modeling, validation, import/export, and graph authoring.

## Upgrade Notes

This is the first official release, so there are no migration steps from a prior public version.
