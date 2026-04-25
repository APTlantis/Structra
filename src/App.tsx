import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Braces,
  CheckSquare,
  Clipboard,
  Copy,
  Download,
  FolderOpen,
  GitCompareArrows,
  Grid2X2,
  Hash,
  Import,
  Layers3,
  ListChecks,
  Moon,
  Plus,
  Redo2,
  Rows3,
  Save,
  SquareDashedMousePointer,
  Sun,
  TextCursorInput,
  Trash2,
  Undo2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { createDocumentFromJson, createDocumentFromJsonSchema, templateDocuments } from "./documentFactory";
import { buildInternalNodes, createProjectFile, readProjectFile } from "./internalModel";
import { generateOutput, validateDocument } from "./transformClient";
import { selectNodeById, useBuilderStore } from "./store";
import type {
  BuilderNode,
  CanvasView,
  DocumentModel,
  ExportFormat,
  FieldDataType,
  GeneratedOutput,
  ImportMode,
  JsonValue,
  NodeType,
  OutputMode,
  ValidationReport,
} from "./types";
import { exportFormats, outputModes } from "./types";

const nodeCatalog: Array<{
  type: NodeType;
  label: string;
  description: string;
  icon: typeof TextCursorInput;
}> = [
  { type: "text", label: "Text", description: "String value", icon: TextCursorInput },
  { type: "number", label: "Number", description: "Numeric value", icon: Hash },
  { type: "checkbox", label: "Checkbox", description: "Boolean flag", icon: CheckSquare },
  { type: "select", label: "Select", description: "Option value", icon: ListChecks },
  { type: "section", label: "Object", description: "Nested structure", icon: Layers3 },
  { type: "grid", label: "Grid", description: "Layout group", icon: Grid2X2 },
];

const formatLabels: Record<ExportFormat, string> = {
  json: "JSON",
  yaml: "YAML",
  toml: "TOML",
  xml: "XML",
};

const modeLabels: Record<OutputMode, string> = {
  values: "Values",
  schema: "Schema",
};

const viewLabels: Record<CanvasView, string> = {
  form: "Form View",
  structure: "Structure View",
};

const savedTemplateKey = "sdb.savedTemplates.v1";
const themeKey = "sdb.theme.v1";

function App() {
  const document = useBuilderStore((state) => state.document);
  const selectedNodeId = useBuilderStore((state) => state.selectedNodeId);
  const activeFormat = useBuilderStore((state) => state.activeFormat);
  const historyLength = useBuilderStore((state) => state.history.length);
  const futureLength = useBuilderStore((state) => state.future.length);
  const setActiveFormat = useBuilderStore((state) => state.setActiveFormat);
  const addNode = useBuilderStore((state) => state.addNode);
  const selectNode = useBuilderStore((state) => state.selectNode);
  const updateNode = useBuilderStore((state) => state.updateNode);
  const deleteNode = useBuilderStore((state) => state.deleteNode);
  const duplicateNode = useBuilderStore((state) => state.duplicateNode);
  const moveNode = useBuilderStore((state) => state.moveNode);
  const replaceDocument = useBuilderStore((state) => state.replaceDocument);
  const undo = useBuilderStore((state) => state.undo);
  const redo = useBuilderStore((state) => state.redo);

  const [canvasView, setCanvasView] = useState<CanvasView>("form");
  const [outputMode, setOutputMode] = useState<OutputMode>("values");
  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>("values");
  const [importText, setImportText] = useState(sampleImportJson);
  const [importError, setImportError] = useState<string | null>(null);
  const [savedTemplates, setSavedTemplates] = useState<Array<{ name: string; document: DocumentModel }>>(() =>
    loadSavedTemplates(),
  );
  const [theme, setTheme] = useState<"light" | "dark">(() => loadTheme());
  const [generated, setGenerated] = useState<GeneratedOutput | null>(null);
  const [previousGenerated, setPreviousGenerated] = useState<GeneratedOutput | null>(null);
  const [validation, setValidation] = useState<ValidationReport | null>(null);
  const [status, setStatus] = useState("Ready");
  const projectInputRef = useRef<HTMLInputElement | null>(null);

  const selectedNode = useMemo(() => selectNodeById(document, selectedNodeId), [document, selectedNodeId]);
  const pathSuggestions = useMemo(() => collectBindingPaths(document), [document]);
  const internalNodes = useMemo(() => buildInternalNodes(document), [document]);

  useEffect(() => {
    documentElement().classList.toggle("dark", theme === "dark");
    localStorage.setItem(themeKey, theme);
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    setStatus("Generating");

    Promise.all([generateOutput(document, activeFormat, outputMode), validateDocument(document)])
      .then(([output, report]) => {
        if (!cancelled) {
          setGenerated((current) => {
            if (current && current.content !== output.content) {
              setPreviousGenerated(current);
            }
            return output;
          });
          setValidation(report);
          setStatus("Ready");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : "Unable to generate output");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeFormat, document, outputMode]);

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const type = event.dataTransfer.getData("application/x-builder-node") as NodeType;
    if (nodeCatalog.some((item) => item.type === type)) {
      addNode(type);
    }
  };

  const copyOutput = async () => {
    if (!generated) {
      return;
    }
    await navigator.clipboard.writeText(generated.content);
    setStatus(`${formatLabels[generated.format]} ${modeLabels[generated.mode].toLowerCase()} copied`);
  };

  const downloadOutput = () => {
    if (!generated) {
      return;
    }
    const blob = new Blob([generated.content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `structured-data-${generated.mode}.${generated.format}`;
    window.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setStatus(`${formatLabels[generated.format]} ${modeLabels[generated.mode].toLowerCase()} downloaded`);
  };

  const changeImportMode = (mode: ImportMode) => {
    setImportMode(mode);
    setImportText(mode === "schema" ? sampleImportSchema : sampleImportJson);
    setImportError(null);
  };

  const importJson = () => {
    try {
      const parsed = JSON.parse(importText) as JsonValue;
      replaceDocument(importMode === "schema" ? createDocumentFromJsonSchema(parsed) : createDocumentFromJson(parsed));
      setCanvasView("structure");
      setOutputMode(importMode === "schema" ? "schema" : "values");
      setImportError(null);
      setImportOpen(false);
      setStatus(importMode === "schema" ? "JSON Schema imported" : "JSON values imported");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Invalid JSON");
    }
  };

  const saveTemplate = () => {
    const name = window.prompt("Template name", document.meta.name || "Untitled Template");
    if (!name) {
      return;
    }
    const next = [{ name, document }, ...savedTemplates.filter((template) => template.name !== name)].slice(0, 8);
    setSavedTemplates(next);
    localStorage.setItem(savedTemplateKey, JSON.stringify(next));
    setStatus("Template saved");
  };

  const applyTemplate = (nextDocument: DocumentModel) => {
    replaceDocument(structuredClone(nextDocument));
    setCanvasView("structure");
    setStatus("Template loaded");
  };

  const saveProject = () => {
    const project = createProjectFile(document);
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `${slugify(document.meta.name || "structured-data-project")}.sdb.json`;
    window.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setStatus("Project saved");
  };

  const loadProjectFile = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const nextDocument = readProjectFile(parsed);
      if (!nextDocument) {
        setStatus("Invalid project file");
        return;
      }
      replaceDocument(nextDocument);
      setCanvasView("structure");
      setStatus("Project loaded");
    } catch {
      setStatus("Invalid project file");
    }
  };

  return (
    <main className="flex min-h-screen flex-col bg-[#f5f7fa] text-slate-950 lg:h-screen lg:min-h-[720px]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-md bg-slate-950 text-white">
            <Braces size={18} aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-sm font-semibold leading-5">Structured Data Builder</h1>
            <p className="text-xs leading-4 text-slate-500">Visual structure to values, schema, and export formats</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={projectInputRef}
            accept=".json,.sdb.json,application/json"
            className="hidden"
            type="file"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) {
                void loadProjectFile(file);
              }
              event.currentTarget.value = "";
            }}
          />
          <ToolbarButton label="Open project" icon={FolderOpen} onClick={() => projectInputRef.current?.click()} />
          <ToolbarButton label="Save project" icon={Save} onClick={saveProject} />
          <ToolbarButton
            label={theme === "dark" ? "Use light theme" : "Use dark theme"}
            icon={theme === "dark" ? Sun : Moon}
            onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
          />
          <ToolbarButton label="Undo" icon={Undo2} disabled={historyLength === 0} onClick={undo} />
          <ToolbarButton label="Redo" icon={Redo2} disabled={futureLength === 0} onClick={redo} />
          <div className="ml-2 hidden rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600 sm:block">
            {status}
          </div>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 lg:min-h-0 lg:grid-cols-[260px_minmax(420px,1fr)_460px]">
        <aside className="border-b border-slate-200 bg-white lg:min-h-0 lg:border-b-0 lg:border-r">
          <PanelHeader title="Components" caption="Drag onto the canvas" />
          <div className="grid grid-cols-2 gap-2 p-3 lg:grid-cols-1">
            {nodeCatalog.map((item) => (
              <PaletteItem key={item.type} {...item} onAdd={() => addNode(item.type)} />
            ))}
          </div>
          <div className="border-t border-slate-200 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-slate-700">Templates</h3>
                <p className="text-[11px] text-slate-500">Import, load, or save structures</p>
              </div>
              <button
                aria-label="Import JSON"
                className="inline-flex size-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
                title="Import JSON"
                type="button"
                onClick={() => setImportOpen(true)}
              >
                <Import size={15} aria-hidden="true" />
              </button>
            </div>
            <div className="grid gap-2">
              {[...templateDocuments, ...savedTemplates.map((template) => ({ ...template, description: "Saved template" }))].map(
                (template) => (
                  <button
                    key={template.name}
                    className="rounded-md border border-slate-200 bg-white p-2 text-left hover:border-slate-400 hover:bg-slate-50"
                    type="button"
                    onClick={() => applyTemplate(template.document)}
                  >
                    <span className="block text-xs font-semibold text-slate-800">{template.name}</span>
                    <span className="block truncate text-[11px] text-slate-500">{template.description}</span>
                  </button>
                ),
              )}
              <button
                className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 hover:bg-white"
                type="button"
                onClick={saveTemplate}
              >
                Save Current Template
              </button>
            </div>
          </div>
        </aside>

        <section
          className="p-4 lg:min-h-0 lg:overflow-auto"
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <div className="mx-auto flex max-w-4xl flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Canvas</h2>
                <p className="text-sm text-slate-500">Build the structure visually, then inspect its generated shape.</p>
              </div>
              <div className="flex items-center gap-2">
                <SegmentedControl
                  ariaLabel="Canvas view"
                  value={canvasView}
                  options={(["form", "structure"] as CanvasView[]).map((view) => ({
                    value: view,
                    label: viewLabels[view],
                  }))}
                  onChange={setCanvasView}
                />
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-medium text-white hover:bg-slate-800"
                  type="button"
                  onClick={() => addNode("text")}
                >
                  <Plus size={16} aria-hidden="true" />
                  Add field
                </button>
              </div>
            </div>

            {canvasView === "form" ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white p-3 shadow-sm">
                {document.nodes.length === 0 ? (
                  <EmptyCanvas />
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {document.nodes.map((node) => (
                      <CanvasNode
                        key={node.id}
                        node={node}
                        selectedNodeId={selectedNodeId}
                        onSelect={selectNode}
                        onUpdate={updateNode}
                        onDelete={deleteNode}
                        onDuplicate={duplicateNode}
                        onMove={moveNode}
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <StructureView data={generated?.data ?? {}} internalNodes={internalNodes} mode={outputMode} />
            )}
          </div>
        </section>

        <aside className="grid border-t border-slate-200 bg-white lg:min-h-0 lg:border-l lg:border-t-0">
          <div className="grid lg:min-h-0 lg:grid-rows-[minmax(285px,0.95fr)_minmax(340px,1.05fr)]">
            <InspectorPanel
              selectedNode={selectedNode}
              pathSuggestions={pathSuggestions}
              onUpdate={updateNode}
              onDelete={deleteNode}
            />
            <ExportPanel
              activeFormat={activeFormat}
              outputMode={outputMode}
              generated={generated}
              previousGenerated={previousGenerated}
              validation={validation}
              onCopy={copyOutput}
              onDownload={downloadOutput}
              onFormatChange={setActiveFormat}
              onModeChange={setOutputMode}
            />
          </div>
        </aside>
      </div>
      {importOpen ? (
        <ImportJsonDialog
          error={importError}
          mode={importMode}
          value={importText}
          onChange={setImportText}
          onClose={() => {
            setImportOpen(false);
            setImportError(null);
          }}
          onImport={importJson}
          onModeChange={changeImportMode}
        />
      ) : null}
    </main>
  );
}

function ToolbarButton({
  label,
  icon: Icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: typeof Undo2;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="inline-flex size-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
      disabled={disabled}
      title={label}
      type="button"
      onClick={onClick}
    >
      <Icon size={16} aria-hidden="true" />
    </button>
  );
}

function SegmentedControl<T extends string>({
  ariaLabel,
  value,
  options,
  onChange,
}: {
  ariaLabel: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div aria-label={ariaLabel} className="inline-flex h-9 rounded-md border border-slate-200 bg-slate-50 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          className={`rounded px-2.5 text-xs font-semibold transition ${
            option.value === value ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-800"
          }`}
          type="button"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function PanelHeader({ title, caption }: { title: string; caption: string }) {
  return (
    <div className="border-b border-slate-200 px-4 py-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="text-xs text-slate-500">{caption}</p>
    </div>
  );
}

function PaletteItem({
  type,
  label,
  description,
  icon: Icon,
  onAdd,
}: {
  type: NodeType;
  label: string;
  description: string;
  icon: typeof TextCursorInput;
  onAdd: () => void;
}) {
  return (
    <button
      className="group flex min-h-16 items-center gap-3 rounded-md border border-slate-200 bg-white p-3 text-left transition hover:-translate-y-0.5 hover:border-slate-400 hover:bg-slate-50 hover:shadow-sm"
      draggable
      type="button"
      onClick={onAdd}
      onDragStart={(event) => event.dataTransfer.setData("application/x-builder-node", type)}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700 group-hover:bg-white">
        <Icon size={17} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-950">{label}</span>
        <span className="block truncate text-xs text-slate-500">{description}</span>
      </span>
    </button>
  );
}

function EmptyCanvas() {
  return (
    <div className="flex min-h-80 flex-col items-center justify-center rounded-md bg-slate-50 text-center">
      <SquareDashedMousePointer className="mb-3 text-slate-400" size={30} aria-hidden="true" />
      <p className="text-sm font-medium text-slate-700">Drop a component here</p>
      <p className="mt-1 max-w-64 text-xs text-slate-500">Start with text, number, checkbox, select, object, or grid.</p>
    </div>
  );
}

function CanvasNode({
  node,
  selectedNodeId,
  onSelect,
  onUpdate,
  onDelete,
  onDuplicate,
  onMove,
}: {
  node: BuilderNode;
  selectedNodeId: string | null;
  onSelect: (id: string | null) => void;
  onUpdate: (id: string, patch: Partial<BuilderNode>) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
}) {
  const selected = node.id === selectedNodeId;
  const isContainer = node.type === "section" || node.type === "grid";

  return (
    <div
      className={`rounded-md border bg-white shadow-sm transition ${
        selected ? "border-slate-950 ring-2 ring-slate-200" : "border-slate-200 hover:border-slate-400 hover:shadow-md"
      } ${node.type === "section" ? "md:col-span-2" : ""}`}
      role="button"
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(node.id);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          onSelect(node.id);
        }
      }}
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <div className="min-w-0 flex-1 pr-2">
          <input
            aria-label={`${node.label} label`}
            className="h-6 w-full rounded bg-transparent text-sm font-semibold outline-none focus:bg-slate-50 focus:px-1"
            value={node.label}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onUpdate(node.id, { label: event.currentTarget.value })}
          />
          <div className="flex min-w-0 items-center gap-1 font-mono text-[11px] text-slate-500">
            {isContainer ? <span className="rounded bg-slate-100 px-1 text-slate-700">type: object</span> : null}
            <span className="truncate">{node.binding || "unbound"}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton label="Move up" icon={ArrowUp} onClick={() => onMove(node.id, -1)} />
          <IconButton label="Move down" icon={ArrowDown} onClick={() => onMove(node.id, 1)} />
          <IconButton label="Duplicate" icon={Copy} onClick={() => onDuplicate(node.id)} />
          <IconButton label="Delete" icon={Trash2} onClick={() => onDelete(node.id)} />
        </div>
      </div>
      <div className="p-3">
        {isContainer ? (
          <div className={node.type === "grid" ? "grid gap-3 sm:grid-cols-2" : "grid gap-3"}>
            {node.children.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-8 text-center text-xs text-slate-500">
                Select this object, then add child components from the palette.
              </div>
            ) : (
              node.children.map((child) => (
                <CanvasNode
                  key={child.id}
                  node={child}
                  selectedNodeId={selectedNodeId}
                  onSelect={onSelect}
                  onUpdate={onUpdate}
                  onDelete={onDelete}
                  onDuplicate={onDuplicate}
                  onMove={onMove}
                />
              ))
            )}
          </div>
        ) : (
          <FieldPreview node={node} onUpdate={onUpdate} />
        )}
      </div>
    </div>
  );
}

function FieldPreview({ node, onUpdate }: { node: BuilderNode; onUpdate: (id: string, patch: Partial<BuilderNode>) => void }) {
  if (node.type === "checkbox") {
    return (
      <label className="inline-flex items-center gap-2 text-sm">
        <input
          checked={Boolean(node.value)}
          className="size-4 rounded border-slate-300"
          type="checkbox"
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onUpdate(node.id, { value: event.currentTarget.checked })}
        />
        {Boolean(node.value) ? "true" : "false"}
      </label>
    );
  }

  if (node.type === "select") {
    const options = optionValues(node);
    return (
      <select
        className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none focus:border-slate-400"
        value={String(node.value ?? "")}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => onUpdate(node.id, { value: event.currentTarget.value })}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none focus:border-slate-400"
      type={node.type === "number" ? "number" : "text"}
      value={String(node.value ?? "")}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) =>
        onUpdate(node.id, {
          value: node.type === "number" ? Number(event.currentTarget.value) : event.currentTarget.value,
        })
      }
    />
  );
}

function IconButton({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: typeof Trash2;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="inline-flex size-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-950"
      title={label}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <Icon size={14} aria-hidden="true" />
    </button>
  );
}

function InspectorPanel({
  selectedNode,
  pathSuggestions,
  onUpdate,
  onDelete,
}: {
  selectedNode: BuilderNode | null;
  pathSuggestions: string[];
  onUpdate: (id: string, patch: Partial<BuilderNode>) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <section className="min-h-0 overflow-auto border-b border-slate-200">
      <PanelHeader title="Inspector" caption="Shape the selected data node" />
      {selectedNode ? (
        <div className="grid gap-3 p-4">
          <TextControl label="Label" value={selectedNode.label} onChange={(label) => onUpdate(selectedNode.id, { label })} />
          <PathBuilder
            binding={selectedNode.binding}
            suggestions={pathSuggestions}
            onChange={(binding) => onUpdate(selectedNode.id, { binding })}
          />
          <TypeControl node={selectedNode} onUpdate={onUpdate} />

          {selectedNode.type !== "section" && selectedNode.type !== "grid" ? (
            <ValueControl node={selectedNode} onUpdate={onUpdate} />
          ) : (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              This is a real object node. Its key prefixes child paths and emits a nested structure in values mode or{" "}
              <span className="font-mono text-slate-900">{"{ type: \"object\" }"}</span> in schema mode.
            </div>
          )}

          <button
            className="mt-1 inline-flex h-9 items-center justify-center gap-2 rounded-md border border-red-200 bg-white text-sm font-medium text-red-700 hover:bg-red-50"
            type="button"
            onClick={() => onDelete(selectedNode.id)}
          >
            <Trash2 size={15} aria-hidden="true" />
            Delete component
          </button>
        </div>
      ) : (
        <div className="p-4 text-sm text-slate-500">Select a component on the canvas to edit its output path.</div>
      )}
    </section>
  );
}

function PathBuilder({
  binding,
  suggestions,
  onChange,
}: {
  binding: string;
  suggestions: string[];
  onChange: (binding: string) => void;
}) {
  const segments = binding.split(".").filter(Boolean);

  const updateSegment = (index: number, value: string) => {
    const next = [...segments];
    next[index] = cleanSegment(value);
    onChange(next.filter(Boolean).join("."));
  };

  const addSegment = () => {
    onChange([...segments, "key"].join("."));
  };

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-600">Path</span>
        <button
          className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 px-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          type="button"
          onClick={addSegment}
        >
          <Plus size={13} aria-hidden="true" />
          Segment
        </button>
      </div>
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-slate-200 bg-white p-2">
        {segments.length === 0 ? <span className="px-1 text-xs text-slate-400">No path</span> : null}
        {segments.map((segment, index) => (
          <div key={`${segment}-${index}`} className="flex items-center gap-1">
            {index > 0 ? <ArrowRight size={13} className="text-slate-400" aria-hidden="true" /> : null}
            <input
              aria-label={`Path segment ${index + 1}`}
              className="h-7 w-[8ch] rounded border border-slate-200 bg-slate-50 px-1.5 font-mono text-xs outline-none focus:border-slate-400"
              value={segment}
              onChange={(event) => updateSegment(index, event.currentTarget.value)}
            />
          </div>
        ))}
      </div>
      <label className="grid gap-1.5">
        <span className="text-xs font-medium text-slate-600">Binding</span>
        <input
          className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-sm outline-none focus:border-slate-400"
          list="binding-suggestions"
          value={binding}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </label>
      <datalist id="binding-suggestions">
        {suggestions.map((path) => (
          <option key={path} value={path} />
        ))}
      </datalist>
    </div>
  );
}

function TextControl({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <input
        className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm outline-none focus:border-slate-400"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function TypeControl({ node, onUpdate }: { node: BuilderNode; onUpdate: (id: string, patch: Partial<BuilderNode>) => void }) {
  const dataType = fieldDataType(node);
  const nullable = Boolean(node.props.nullable);
  const isArray = Boolean(node.props.isArray);
  const required = Boolean(node.props.required);

  const updateProps = (props: Record<string, JsonValue>) => {
    onUpdate(node.id, {
      props: {
        ...node.props,
        ...props,
      },
    });
  };

  return (
    <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-700">Type</span>
        <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500">{node.binding || "unbound"}</span>
      </div>
      <select
        className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm outline-none focus:border-slate-400"
        value={dataType}
        onChange={(event) => updateProps({ dataType: event.currentTarget.value as FieldDataType })}
      >
        <option value="string">string</option>
        <option value="number">number</option>
        <option value="boolean">boolean</option>
        <option value="object">object</option>
        <option value="array">array</option>
        <option value="custom">custom</option>
      </select>
      {dataType === "custom" ? (
        <TextControl
          label="Custom type"
          value={typeof node.props.customType === "string" ? node.props.customType : "CustomType"}
          onChange={(customType) => updateProps({ customType })}
        />
      ) : null}
      <TextControl
        label="Description"
        value={typeof node.props.description === "string" ? node.props.description : ""}
        onChange={(description) => updateProps({ description })}
      />
      <div className="grid grid-cols-3 gap-2">
        <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white p-2 text-xs font-medium text-slate-700">
          <input
            checked={required}
            className="size-4 rounded border-slate-300"
            type="checkbox"
            onChange={(event) => updateProps({ required: event.currentTarget.checked })}
          />
          Required
        </label>
        <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white p-2 text-xs font-medium text-slate-700">
          <input
            checked={nullable}
            className="size-4 rounded border-slate-300"
            type="checkbox"
            onChange={(event) => updateProps({ nullable: event.currentTarget.checked })}
          />
          Nullable
        </label>
        <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white p-2 text-xs font-medium text-slate-700">
          <input
            checked={isArray}
            className="size-4 rounded border-slate-300"
            type="checkbox"
            onChange={(event) => updateProps({ isArray: event.currentTarget.checked })}
          />
          Array
        </label>
      </div>
    </div>
  );
}

function ValueControl({ node, onUpdate }: { node: BuilderNode; onUpdate: (id: string, patch: Partial<BuilderNode>) => void }) {
  if (node.type === "checkbox") {
    return (
      <label className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-3 text-sm">
        <span className="font-medium text-slate-700">Value</span>
        <input
          checked={Boolean(node.value)}
          className="size-4 rounded border-slate-300"
          type="checkbox"
          onChange={(event) => onUpdate(node.id, { value: event.currentTarget.checked })}
        />
      </label>
    );
  }

  if (node.type === "select") {
    return (
      <>
        <TextControl
          label="Options"
          value={optionValues(node).join(", ")}
          onChange={(value) => {
            const options = value
              .split(",")
              .map((option) => option.trim())
              .filter(Boolean);
            onUpdate(node.id, {
              props: { ...node.props, options },
              value: options.includes(String(node.value)) ? node.value : options[0] ?? "",
            });
          }}
        />
        <TextControl label="Value" value={String(node.value ?? "")} onChange={(value) => onUpdate(node.id, { value })} />
      </>
    );
  }

  return (
    <TextControl
      label="Value"
      value={String(node.value ?? "")}
      onChange={(value) => onUpdate(node.id, { value: node.type === "number" ? Number(value) : value })}
    />
  );
}

function StructureView({
  data,
  internalNodes,
  mode,
}: {
  data: JsonValue;
  internalNodes: ReturnType<typeof buildInternalNodes>;
  mode: OutputMode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">{modeLabels[mode]} Structure</h3>
          <p className="text-xs text-slate-500">The mental model between canvas and export.</p>
        </div>
        <Rows3 size={17} className="text-slate-400" aria-hidden="true" />
      </div>
      <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_220px]">
        <pre className="min-h-[360px] overflow-auto rounded-md bg-slate-950 p-4 font-mono text-xs leading-5 text-slate-100">
          {JSON.stringify(data, null, 2)}
        </pre>
        <StructureTree data={data} internalNodes={internalNodes} />
      </div>
    </div>
  );
}

function StructureTree({ data, internalNodes }: { data: JsonValue; internalNodes: ReturnType<typeof buildInternalNodes> }) {
  const rows = flattenValue(data);
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 text-xs font-semibold text-slate-600">Path Map</div>
      <div className="grid gap-1">
        {rows.map((row) => (
          <div key={row.path} className="flex items-center justify-between gap-2 rounded bg-white px-2 py-1 text-xs">
            <span className="truncate font-mono text-slate-700">{row.path || "root"}</span>
            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
              {row.type}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 border-t border-slate-200 pt-3">
        <div className="mb-2 text-xs font-semibold text-slate-600">Internal Nodes</div>
        <div className="grid max-h-52 gap-1 overflow-auto">
          {internalNodes.map((node) => (
            <div key={node.id} className="rounded bg-white px-2 py-1 text-xs">
              <div className="truncate font-mono text-slate-700">{node.path.join(".") || "root"}</div>
              <div className="mt-0.5 flex gap-1 text-[10px] font-semibold text-slate-500">
                <span>{node.type}</span>
                {node.isArray ? <span>array</span> : null}
                {node.nullable ? <span>nullable</span> : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ExportPanel({
  activeFormat,
  outputMode,
  generated,
  previousGenerated,
  validation,
  onFormatChange,
  onModeChange,
  onCopy,
  onDownload,
}: {
  activeFormat: ExportFormat;
  outputMode: OutputMode;
  generated: GeneratedOutput | null;
  previousGenerated: GeneratedOutput | null;
  validation: ValidationReport | null;
  onFormatChange: (format: ExportFormat) => void;
  onModeChange: (mode: OutputMode) => void;
  onCopy: () => void;
  onDownload: () => void;
}) {
  return (
    <section className="grid min-h-0 grid-rows-[auto_auto_auto_minmax(0,1fr)_auto]">
      <PanelHeader title="Export" caption="Generated from the visual model" />
      <div className="flex items-center gap-1 border-b border-slate-200 p-2">
        {exportFormats.map((format) => (
          <button
            key={format}
            className={`h-8 rounded-md px-3 text-xs font-semibold ${
              activeFormat === format ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
            type="button"
            onClick={() => onFormatChange(format)}
          >
            {formatLabels[format]}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 p-2">
        <SegmentedControl
          ariaLabel="Output mode"
          value={outputMode}
          options={outputModes.map((mode) => ({ value: mode, label: modeLabels[mode] }))}
          onChange={onModeChange}
        />
        <button
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          type="button"
          onClick={() => {
            onFormatChange("json");
            onModeChange("schema");
          }}
        >
          <GitCompareArrows size={14} aria-hidden="true" />
          JSON Schema
        </button>
      </div>
      <div className="grid min-h-0 grid-cols-1 bg-slate-950 md:grid-cols-2">
        <OutputCode title="Current" content={generated?.content ?? "Generating..."} />
        <OutputCode title="Previous" content={previousGenerated?.content ?? "No previous transform yet."} muted />
      </div>
      <div className="grid gap-2 border-t border-slate-200 p-3">
        {validation && (validation.errors.length > 0 || validation.warnings.length > 0) ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
            {[...validation.errors, ...validation.warnings].slice(0, 3).join(" ")}
          </div>
        ) : (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">
            Document is valid.
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white text-sm font-medium hover:bg-slate-50"
            type="button"
            onClick={onCopy}
          >
            <Clipboard size={15} aria-hidden="true" />
            Copy
          </button>
          <button
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-slate-950 text-sm font-medium text-white hover:bg-slate-800"
            type="button"
            onClick={onDownload}
          >
            <Download size={15} aria-hidden="true" />
            Download
          </button>
        </div>
      </div>
    </section>
  );
}

function OutputCode({ title, content, muted }: { title: string; content: string; muted?: boolean }) {
  return (
    <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-b border-slate-800 md:border-b-0 md:border-r last:border-r-0">
      <div className="border-b border-slate-800 bg-slate-900 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </div>
      <pre className={`min-h-0 overflow-auto p-4 font-mono text-xs leading-5 ${muted ? "text-slate-400" : "text-slate-100"}`}>
        {content}
      </pre>
    </div>
  );
}

function optionValues(node: BuilderNode) {
  const options = node.props.options;
  if (Array.isArray(options)) {
    return options.map(String);
  }
  return ["Option A", "Option B"];
}

function fieldDataType(node: BuilderNode): FieldDataType {
  if (typeof node.props.dataType === "string") {
    return node.props.dataType as FieldDataType;
  }
  if (node.type === "number") {
    return "number";
  }
  if (node.type === "checkbox") {
    return "boolean";
  }
  if (node.type === "section" || node.type === "grid") {
    return "object";
  }
  return "string";
}

function cleanSegment(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, "");
}

function collectBindingPaths(document: DocumentModel) {
  const paths = new Set<string>();

  const visit = (nodes: BuilderNode[], parentPath: string | null) => {
    for (const node of nodes) {
      const path = combinePath(parentPath, node.binding);
      if (path) {
        const segments = path.split(".");
        segments.forEach((_, index) => paths.add(segments.slice(0, index + 1).join(".")));
      }
      visit(node.children, path);
    }
  };

  visit(document.nodes, null);
  return [...paths].sort();
}

function combinePath(parent: string | null, binding: string) {
  const clean = binding.trim();
  if (!parent && !clean) {
    return null;
  }
  if (!parent) {
    return clean;
  }
  return clean ? `${parent}.${clean}` : parent;
}

function flattenValue(value: JsonValue, path = ""): Array<{ path: string; type: string }> {
  if (Array.isArray(value)) {
    return [
      { path, type: "array" },
      ...value.flatMap((item, index) => flattenValue(item, path ? `${path}.${index}` : String(index))),
    ];
  }

  if (value && typeof value === "object") {
    return [
      { path, type: "object" },
      ...Object.entries(value).flatMap(([key, item]) => flattenValue(item, path ? `${path}.${key}` : key)),
    ];
  }

  return [{ path, type: value === null ? "null" : typeof value }];
}

function ImportJsonDialog({
  value,
  error,
  mode,
  onChange,
  onClose,
  onImport,
  onModeChange,
}: {
  value: string;
  error: string | null;
  mode: ImportMode;
  onChange: (value: string) => void;
  onClose: () => void;
  onImport: () => void;
  onModeChange: (mode: ImportMode) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 p-4">
      <div className="grid max-h-[82vh] w-full max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Import JSON or Schema</h2>
            <p className="text-xs text-slate-500">
              {mode === "schema"
                ? "Rebuild the canvas from JSON Schema properties, required fields, enums, and arrays."
                : "Rebuild the canvas from canonical JSON values and inferred field types."}
            </p>
          </div>
          <SegmentedControl
            ariaLabel="Import mode"
            value={mode}
            options={[
              { value: "values", label: "Values" },
              { value: "schema", label: "Schema" },
            ]}
            onChange={onModeChange}
          />
        </div>
        <div className="min-h-0 p-4">
          <textarea
            className="h-[420px] w-full resize-none rounded-md border border-slate-200 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-slate-400"
            value={value}
            onChange={(event) => onChange(event.currentTarget.value)}
          />
          {error ? <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</div> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 p-3">
          <button
            className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="h-9 rounded-md bg-slate-950 px-3 text-sm font-medium text-white hover:bg-slate-800"
            type="button"
            onClick={onImport}
          >
            Import {mode === "schema" ? "Schema" : "Values"}
          </button>
        </div>
      </div>
    </div>
  );
}

function loadSavedTemplates(): Array<{ name: string; document: DocumentModel }> {
  try {
    const raw = localStorage.getItem(savedTemplateKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as Array<{ name: string; document: DocumentModel }>;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadTheme(): "light" | "dark" {
  const saved = localStorage.getItem(themeKey);
  if (saved === "light" || saved === "dark") {
    return saved;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function documentElement() {
  return window.document.documentElement;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "project";
}

const sampleImportJson = JSON.stringify(
  {
    user: {
      name: "Grace Hopper",
      age: 85,
      active: true,
      profile: {
        role: "Compiler Engineer",
      },
      tags: ["navy", "cobol"],
    },
  },
  null,
  2,
);

const sampleImportSchema = JSON.stringify(
  {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    required: ["user"],
    properties: {
      user: {
        type: "object",
        required: ["name", "profile"],
        properties: {
          name: {
            type: "string",
            description: "Display name",
          },
          age: {
            type: ["number", "null"],
          },
          profile: {
            type: "object",
            required: ["role"],
            properties: {
              role: {
                type: "string",
                enum: ["Admin", "Editor", "Viewer"],
              },
              tags: {
                type: "array",
                items: {
                  type: "string",
                },
              },
            },
          },
        },
      },
    },
  },
  null,
  2,
);

export default App;
