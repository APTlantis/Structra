---
[project]
name = "Structra"
slug = "structra"

description = "A comprehensive schema and workflow builder for production-minded tooling."

[tags]
languages = ["typescript", "rust", "react"]
platforms = ["windows", "macos", "linux"]
tooling = ["tauri", "vite", "pnpm"]
---

# <img src="docs/structra-logo.png" alt="Structra Logo" width="40"> Structra

> A high-performance, cross-platform schema and workflow builder for structured data management.

---

## 🔖 Status

![status](https://img.shields.io/badge/status-active-brightgreen)
![license](https://img.shields.io/badge/license-MIT-blue)
![tauri](https://img.shields.io/badge/built%20with-Tauri-red)
![react](https://img.shields.io/badge/ui-React-blue)

---

## 🧭 Overview

**Structra** (sdb) is a powerful desktop application designed to simplify the creation, management, and transformation of complex data schemas and workflows. Built with performance and maintainability in mind, it provides a visual interface for modeling data structures and exporting them to multiple formats.

![Structra Infographic](docs/structra-infographic.png)

### Key Features:
* **Visual Schema Builder:** Create nested identity payloads, API request bodies, and service configurations.
* **Workflow Modeling:** Design and export workflows with manual approval gates and command execution.
* **Multi-Format Export:** Seamlessly convert models between JSON, YAML, TOML, and XML.
* **Schema Validation:** Built-in validation to ensure data integrity across various formats.
* **Cross-Platform:** Native desktop experience powered by Tauri.

---

## 🛠️ Languages & Technologies

* **Frontend:** React 19, TypeScript, Tailwind CSS
* **Desktop Core:** Tauri 2 (Rust)
* **Build System:** Vite, PNPM
* **State Management:** Zustand
* **Icons:** Lucide React

---

## 📁 Repository Structure

```text
/
├─ src/            # Frontend (React + TypeScript) source code
├─ src-tauri/      # Backend (Rust) Tauri core and configuration
├─ docs/           # Documentation and assets (logos, infographics)
├─ public/         # Static public assets
├─ dist/           # Compiled production build
└─ README.md       # Project documentation
```

---

## 🚀 Usage

### Prerequisites
* [Node.js](https://nodejs.org/) (latest LTS recommended)
* [PNPM](https://pnpm.io/)
* [Rust](https://www.rust-lang.org/) (for Tauri builds)

### Development
To start the development server:
```bash
pnpm install
pnpm dev
```

### Build
To build the production application:
```bash
pnpm build
pnpm tauri build
```

---

## 🧪 Project Philosophy

* Prefer **clarity over cleverness**
* Prefer **data over assumptions**
* Prefer **composable systems**
* Metadata is a first-class citizen
* Documentation evolves with the code

---

## 📜 License

MIT License.
See [`LICENSE`](./LICENSE) for details.

---

## 👤 Author

Maintained by **Herb**
Contributions, forks, and discussion welcome.

---

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareSourceCode",
  "name": "Structra",
  "description": "A comprehensive schema and workflow builder for production-minded tooling.",
  "license": "https://opensource.org/licenses/MIT",
  "programmingLanguage": ["TypeScript", "Rust"],
  "author": {
    "@type": "Person",
    "name": "Herb"
  },
  "codeRepository": "https://github.com/username/structra"
}
</script>
```
