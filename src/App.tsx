import {
  Background,
  ConnectionMode,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Connection,
  type Edge as FlowEdge,
  type EdgeChange,
  type Node as FlowNode,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
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
  GitBranch,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import { createDocumentFromJson, createDocumentFromJsonSchema, templateDocuments } from "./documentFactory";
import { buildInternalNodes, createProjectFile, readProjectFile } from "./internalModel";
import { generateOutput, validateDocument } from "./transformClient";
import { selectNodeById, useBuilderStore } from "./store";
import {
  buildWorkflowExecutionPlan,
  createWorkflowStep,
  envFromText,
  envToText,
  initialWorkflow,
  importWorkflowYaml,
  validateWorkflow,
  workflowExportFilename,
  workflowTemplates,
  workflowToYaml,
} from "./workflowFactory";
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
  WorkflowExecutionPlan,
  WorkflowExportTarget,
  WorkflowModel,
  WorkflowStep,
  WorkflowStepKind,
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
  workflow: "Workflow",
};

const savedTemplateKey = "sdb.savedTemplates.v1";
const themeKey = "sdb.theme.v1";
const workflowNodeTypes = {
  workflowStep: WorkflowFlowNodeCard,
};

interface WorkflowFlowNodeData extends Record<string, unknown> {
  step: WorkflowStep;
  index: number;
  selected: boolean;
  issue?: WorkflowStepIssueSummary;
  orderIndex: number | null;
  blocked: boolean;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
}

type WorkflowFlowNode = FlowNode<WorkflowFlowNodeData, "workflowStep">;

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
  const [workflow, setWorkflow] = useState<WorkflowModel>(initialWorkflow);
  const [workflowTarget, setWorkflowTarget] = useState<WorkflowExportTarget>("portable");
  const [selectedWorkflowStepId, setSelectedWorkflowStepId] = useState(initialWorkflow.steps[0]?.id ?? null);
  const projectInputRef = useRef<HTMLInputElement | null>(null);
  const workflowInputRef = useRef<HTMLInputElement | null>(null);

  const selectedNode = useMemo(() => selectNodeById(document, selectedNodeId), [document, selectedNodeId]);
  const selectedWorkflowStep = useMemo(
    () => workflow.steps.find((step) => step.id === selectedWorkflowStepId) ?? null,
    [selectedWorkflowStepId, workflow.steps],
  );
  const pathSuggestions = useMemo(() => collectBindingPaths(document), [document]);
  const internalNodes = useMemo(() => buildInternalNodes(document), [document]);
  const workflowYaml = useMemo(() => workflowToYaml(workflow, workflowTarget), [workflow, workflowTarget]);
  const workflowValidation = useMemo(() => validateWorkflow(workflow, workflowTarget), [workflow, workflowTarget]);
  const workflowIssueMap = useMemo(() => workflowStepIssueMap(workflow), [workflow]);
  const workflowExecutionPlan = useMemo(() => buildWorkflowExecutionPlan(workflow), [workflow]);

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
    const project = createProjectFile(document, workflow);
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
      const project = readProjectFile(parsed);
      if (!project) {
        setStatus("Invalid project file");
        return;
      }
      replaceDocument(project.document);
      if (project.workflow) {
        setWorkflow(project.workflow);
        setSelectedWorkflowStepId(project.workflow.steps[0]?.id ?? null);
      }
      setCanvasView(project.workflow ? "workflow" : "structure");
      setStatus("Project loaded");
    } catch {
      setStatus("Invalid project file");
    }
  };

  const importWorkflowFile = async (file: File) => {
    try {
      const result = importWorkflowYaml(await file.text());
      setWorkflow(result.workflow);
      setWorkflowTarget(result.source);
      setSelectedWorkflowStepId(result.workflow.steps[0]?.id ?? null);
      setCanvasView("workflow");
      const sourceLabel =
        result.source === "github-actions" ? "GitHub Actions" : result.source === "gitlab-ci" ? "GitLab CI" : "Workflow";
      setStatus(
        result.warnings.length > 0
          ? `${sourceLabel} imported with warnings`
          : `${sourceLabel} imported`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Invalid workflow YAML");
    }
  };

  const applyWorkflowTemplate = (nextWorkflow: WorkflowModel) => {
    const workflowCopy = structuredClone(nextWorkflow);
    setWorkflow(workflowCopy);
    setSelectedWorkflowStepId(workflowCopy.steps[0]?.id ?? null);
    setCanvasView("workflow");
    setStatus("Workflow preset loaded");
  };

  const addWorkflowStep = (kind: WorkflowStepKind, options: { afterStepId?: string; connect?: boolean } = {}) => {
    const step = createWorkflowStep(kind);
    setWorkflow((current) => {
      const sourceIndex = options.afterStepId
        ? current.steps.findIndex((candidate) => candidate.id === options.afterStepId)
        : -1;
      const nextStep =
        sourceIndex >= 0 && options.connect
          ? { ...step, needs: [...new Set([...step.needs, current.steps[sourceIndex].id])] }
          : step;
      const steps =
        sourceIndex >= 0
          ? [...current.steps.slice(0, sourceIndex + 1), nextStep, ...current.steps.slice(sourceIndex + 1)]
          : [...current.steps, nextStep];
      const sourcePosition = options.afterStepId ? current.graph?.positions?.[options.afterStepId] : undefined;
      const positions = {
        ...(current.graph?.positions ?? {}),
        [nextStep.id]: sourcePosition
          ? { x: sourcePosition.x + 310, y: sourcePosition.y }
          : createWorkflowGraphPositions({ ...current, steps })[nextStep.id],
      };
      return { ...current, steps, graph: { ...(current.graph ?? { positions: {} }), positions } };
    });
    setSelectedWorkflowStepId(step.id);
    setStatus("Workflow step added");
  };

  const updateWorkflow = (patch: Partial<WorkflowModel>) => {
    setWorkflow((current) => ({ ...current, ...patch }));
  };

  const updateWorkflowStep = (id: string, patch: Partial<WorkflowStep>) => {
    setWorkflow((current) => ({
      ...current,
      steps: current.steps.map((step) => (step.id === id ? { ...step, ...patch, id: step.id } : step)),
    }));
  };

  const deleteWorkflowStep = (id: string) => {
    setWorkflow((current) => {
      const steps = current.steps.filter((step) => step.id !== id);
      const cleanedSteps = steps.map((step) => ({ ...step, needs: step.needs.filter((dependency) => dependency !== id) }));
      const positions = { ...(current.graph?.positions ?? {}) };
      delete positions[id];
      setSelectedWorkflowStepId(steps[0]?.id ?? null);
      return { ...current, steps: cleanedSteps, graph: { ...(current.graph ?? { positions: {} }), positions } };
    });
    setStatus("Workflow step deleted");
  };

  const duplicateWorkflowStep = (id: string) => {
    setWorkflow((current) => {
      const index = current.steps.findIndex((step) => step.id === id);
      if (index < 0) {
        return current;
      }
      const source = current.steps[index];
      const clone = {
        ...source,
        id: createWorkflowStepId(source.name, current.steps),
        name: `${source.name} Copy`,
        env: { ...source.env },
        needs: [...source.needs],
      };
      const steps = [...current.steps.slice(0, index + 1), clone, ...current.steps.slice(index + 1)];
      const sourcePosition = current.graph?.positions?.[source.id];
      const positions = {
        ...(current.graph?.positions ?? {}),
        ...(sourcePosition ? { [clone.id]: { x: sourcePosition.x + 40, y: sourcePosition.y + 40 } } : {}),
      };
      setSelectedWorkflowStepId(clone.id);
      return { ...current, steps, graph: { ...(current.graph ?? { positions: {} }), positions } };
    });
    setStatus("Workflow step duplicated");
  };

  const moveWorkflowStep = (id: string, direction: -1 | 1) => {
    setWorkflow((current) => {
      const index = current.steps.findIndex((step) => step.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.steps.length) {
        return current;
      }
      const steps = [...current.steps];
      [steps[index], steps[target]] = [steps[target], steps[index]];
      return { ...current, steps };
    });
  };

  const resetWorkflowLayout = () => {
    setWorkflow((current) => ({ ...current, graph: { positions: createWorkflowGraphPositions(current) } }));
    setStatus("Workflow graph layout reset");
  };

  const copyWorkflowYaml = async () => {
    await navigator.clipboard.writeText(workflowYaml);
    setStatus("Workflow YAML copied");
  };

  const downloadWorkflowYaml = () => {
    const blob = new Blob([workflowYaml], { type: "text/yaml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = workflowExportFilename(workflow, workflowTarget);
    window.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setStatus("Workflow YAML downloaded");
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
          <input
            ref={workflowInputRef}
            accept=".yaml,.yml,text/yaml,application/yaml"
            className="hidden"
            type="file"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) {
                void importWorkflowFile(file);
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
                  options={(["form", "structure", "workflow"] as CanvasView[]).map((view) => ({
                    value: view,
                    label: viewLabels[view],
                  }))}
                  onChange={setCanvasView}
                />
                {canvasView === "workflow" ? (
                  <>
                    <button
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      type="button"
                      onClick={() => workflowInputRef.current?.click()}
                    >
                      <Import size={16} aria-hidden="true" />
                      Import YAML
                    </button>
                    <button
                      className="inline-flex h-9 items-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-medium text-white hover:bg-slate-800"
                      type="button"
                      onClick={() => addWorkflowStep("run")}
                    >
                      <Plus size={16} aria-hidden="true" />
                      Add step
                    </button>
                  </>
                ) : (
                  <button
                    className="inline-flex h-9 items-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-medium text-white hover:bg-slate-800"
                    type="button"
                    onClick={() => addNode("text")}
                  >
                    <Plus size={16} aria-hidden="true" />
                    Add field
                  </button>
                )}
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
            ) : canvasView === "structure" ? (
              <StructureView data={generated?.data ?? {}} internalNodes={internalNodes} mode={outputMode} />
            ) : (
              <WorkflowCanvas
                executionPlan={workflowExecutionPlan}
                issueMap={workflowIssueMap}
                workflow={workflow}
                selectedStepId={selectedWorkflowStepId}
                onApplyTemplate={applyWorkflowTemplate}
                onAddStep={addWorkflowStep}
                onDeleteStep={deleteWorkflowStep}
                onDuplicateStep={duplicateWorkflowStep}
                onMoveStep={moveWorkflowStep}
                onResetLayout={resetWorkflowLayout}
                onSelectStep={setSelectedWorkflowStepId}
                onUpdateStep={updateWorkflowStep}
                onUpdateWorkflow={updateWorkflow}
              />
            )}
          </div>
        </section>

        <aside className="grid border-t border-slate-200 bg-white lg:min-h-0 lg:border-l lg:border-t-0">
          <div className="grid lg:min-h-0 lg:grid-rows-[minmax(285px,0.95fr)_minmax(340px,1.05fr)]">
            {canvasView === "workflow" ? (
              <>
                <WorkflowInspector
                  executionPlan={workflowExecutionPlan}
                  selectedStep={selectedWorkflowStep}
                  workflow={workflow}
                  issueMap={workflowIssueMap}
                  onDeleteStep={deleteWorkflowStep}
                  onUpdateStep={updateWorkflowStep}
                  onUpdateWorkflow={updateWorkflow}
                />
                <WorkflowExportPanel
                  content={workflowYaml}
                  target={workflowTarget}
                  validation={workflowValidation}
                  onCopy={copyWorkflowYaml}
                  onDownload={downloadWorkflowYaml}
                  onTargetChange={setWorkflowTarget}
                />
              </>
            ) : (
              <>
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
              </>
            )}
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

function WorkflowFlowNodeCard({ data }: NodeProps<WorkflowFlowNode>) {
  const hasErrors = Boolean(data.issue?.errors.length);
  const hasWarnings = Boolean(data.issue?.warnings.length);
  return (
    <div
      className={`min-w-[230px] rounded-md border bg-white shadow-sm ${
        data.selected
          ? "border-slate-950 ring-2 ring-slate-200"
          : hasErrors
            ? "border-red-300"
            : hasWarnings
              ? "border-amber-300"
              : "border-slate-200"
      }`}
    >
      <Handle className="!size-2.5 !border-2 !border-white !bg-slate-500" position={Position.Left} type="target" />
      <Handle className="!size-2.5 !border-2 !border-white !bg-slate-950" position={Position.Right} type="source" />
      <div className="border-b border-slate-100 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold text-slate-900">{data.step.name || data.step.id}</span>
          <div className="flex shrink-0 items-center gap-1">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{data.step.kind}</span>
            <button
              aria-label={`Duplicate ${data.step.name}`}
              className="nodrag nopan inline-flex size-6 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-950"
              title="Duplicate"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                data.onDuplicate(data.step.id);
              }}
            >
              <Copy size={12} aria-hidden="true" />
            </button>
            <button
              aria-label={`Delete ${data.step.name}`}
              className="nodrag nopan inline-flex size-6 items-center justify-center rounded text-slate-500 hover:bg-red-50 hover:text-red-700"
              title="Delete"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                data.onDelete(data.step.id);
              }}
            >
              <Trash2 size={12} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1 font-mono text-[11px] text-slate-500">
          <span className="truncate">{data.step.id}</span>
          {data.orderIndex ? <span className="rounded bg-emerald-50 px-1 text-emerald-700">#{data.orderIndex}</span> : null}
          {data.blocked ? <span className="rounded bg-red-50 px-1 text-red-700">blocked</span> : null}
        </div>
      </div>
      <div className="grid gap-1 px-3 py-2 text-[11px] text-slate-600">
        {data.step.kind === "uses" ? (
          <span className="truncate font-mono">{data.step.uses || "missing action reference"}</span>
        ) : (
          <span className="line-clamp-2 font-mono">{data.step.command || "missing command"}</span>
        )}
        {hasErrors || hasWarnings ? (
          <span className={hasErrors ? "text-red-700" : "text-amber-700"}>
            {hasErrors ? data.issue?.errors[0] : data.issue?.warnings[0]}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function WorkflowCanvas({
  executionPlan,
  issueMap,
  workflow,
  selectedStepId,
  onApplyTemplate,
  onAddStep,
  onDeleteStep,
  onDuplicateStep,
  onMoveStep,
  onResetLayout,
  onSelectStep,
  onUpdateStep,
  onUpdateWorkflow,
}: {
  executionPlan: WorkflowExecutionPlan;
  issueMap: Map<string, WorkflowStepIssueSummary>;
  workflow: WorkflowModel;
  selectedStepId: string | null;
  onApplyTemplate: (workflow: WorkflowModel) => void;
  onAddStep: (kind: WorkflowStepKind, options?: { afterStepId?: string; connect?: boolean }) => void;
  onDeleteStep: (id: string) => void;
  onDuplicateStep: (id: string) => void;
  onMoveStep: (id: string, direction: -1 | 1) => void;
  onResetLayout: () => void;
  onSelectStep: (id: string) => void;
  onUpdateStep: (id: string, patch: Partial<WorkflowStep>) => void;
  onUpdateWorkflow: (patch: Partial<WorkflowModel>) => void;
}) {
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const nodePositions = workflow.graph?.positions ?? {};
  const selectedStep = workflow.steps.find((step) => step.id === selectedStepId) ?? null;
  const { edges, nodes } = useMemo(
    () =>
      buildWorkflowFlowElements(workflow, executionPlan, issueMap, selectedStepId, nodePositions, {
        onDelete: onDeleteStep,
        onDuplicate: onDuplicateStep,
      }),
    [executionPlan, issueMap, nodePositions, onDeleteStep, onDuplicateStep, selectedStepId, workflow],
  );
  const onNodesChange = useCallback(
    (changes: NodeChange<WorkflowFlowNode>[]) => {
      const positionChanges = changes.filter((change) => change.type === "position" && change.position);
      if (positionChanges.length === 0) {
        return;
      }
      const changedNodes = applyNodeChanges(positionChanges, nodes);
      const nextPositions = { ...nodePositions };
      for (const node of changedNodes) {
        nextPositions[node.id] = node.position;
      }
      onUpdateWorkflow({ graph: { ...(workflow.graph ?? { positions: {} }), positions: nextPositions } });
    },
    [nodePositions, nodes, onUpdateWorkflow, workflow.graph],
  );
  const removeDependencyEdge = useCallback(
    (edgeId: string) => {
      const edge = edges.find((item) => item.id === edgeId);
      if (!edge) {
        return;
      }
      const targetStep = workflow.steps.find((step) => step.id === edge.target);
      if (!targetStep) {
        return;
      }
      onUpdateStep(targetStep.id, { needs: targetStep.needs.filter((dependency) => dependency !== edge.source) });
      setSelectedEdgeId(null);
    },
    [edges, onUpdateStep, workflow.steps],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange<FlowEdge>[]) => {
      changes
        .filter((change) => change.type === "remove")
        .forEach((change) => {
          removeDependencyEdge(change.id);
        });
    },
    [removeDependencyEdge],
  );
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || connection.source === connection.target) {
        return;
      }
      const targetStep = workflow.steps.find((step) => step.id === connection.target);
      if (!targetStep || targetStep.needs.includes(connection.source)) {
        return;
      }
      if (dependencyWouldCreateCycle(connection.target, connection.source, workflow.steps)) {
        return;
      }
      onUpdateStep(targetStep.id, { needs: [...targetStep.needs, connection.source] });
    },
    [onUpdateStep, workflow.steps],
  );
  const isValidConnection = useCallback(
    (connection: FlowEdge | Connection) =>
      Boolean(
        connection.source &&
          connection.target &&
          connection.source !== connection.target &&
          !workflow.steps.find((step) => step.id === connection.target)?.needs.includes(connection.source) &&
          !dependencyWouldCreateCycle(connection.target, connection.source, workflow.steps),
      ),
    [workflow.steps],
  );

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">{workflow.name}</h3>
          <p className="text-xs text-slate-500">Build a portable YAML workflow from ordered, dependency-aware steps.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="h-8 rounded-md border border-slate-200 px-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            type="button"
            onClick={() => onAddStep("run")}
          >
            Run
          </button>
          <button
            className="h-8 rounded-md border border-slate-200 px-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            type="button"
            onClick={() => onAddStep("uses")}
          >
            Uses
          </button>
          <button
            className="h-8 rounded-md border border-slate-200 px-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            type="button"
            onClick={() => onAddStep("approval")}
          >
            Gate
          </button>
        </div>
      </div>
      <div className="border-b border-slate-200 bg-slate-50 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-xs font-semibold text-slate-700">Graph Canvas</h4>
            <p className="text-[11px] text-slate-500">Connect nodes to create dependencies. Pan, zoom, and inspect flow shape.</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
            {selectedStep ? (
              <>
                <button
                  className="inline-flex items-center gap-1 rounded bg-white px-2 py-1 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                  title="Add run step after the selected node"
                  type="button"
                  onClick={() => onAddStep("run", { afterStepId: selectedStep.id, connect: true })}
                >
                  <Plus size={12} aria-hidden="true" />
                  Run after
                </button>
                <button
                  className="inline-flex items-center gap-1 rounded bg-white px-2 py-1 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                  title="Add action step after the selected node"
                  type="button"
                  onClick={() => onAddStep("uses", { afterStepId: selectedStep.id, connect: true })}
                >
                  <ArrowRight size={12} aria-hidden="true" />
                  Uses after
                </button>
                <button
                  className="inline-flex items-center gap-1 rounded bg-white px-2 py-1 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                  title="Add approval gate after the selected node"
                  type="button"
                  onClick={() => onAddStep("approval", { afterStepId: selectedStep.id, connect: true })}
                >
                  <ListChecks size={12} aria-hidden="true" />
                  Gate after
                </button>
              </>
            ) : null}
            <button
              className="inline-flex items-center gap-1 rounded bg-white px-2 py-1 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
              title="Reset workflow graph layout"
              type="button"
              onClick={onResetLayout}
            >
              <Rows3 size={12} aria-hidden="true" />
              Layout
            </button>
            {selectedEdgeId ? (
              <button
                className="rounded bg-red-50 px-2 py-1 text-red-700 ring-1 ring-red-200 hover:bg-red-100"
                type="button"
                onClick={() => removeDependencyEdge(selectedEdgeId)}
              >
                Remove selected edge
              </button>
            ) : null}
            <span className="rounded bg-white px-2 py-1 text-slate-600 ring-1 ring-slate-200">{nodes.length} nodes</span>
            <span className="rounded bg-white px-2 py-1 text-slate-600 ring-1 ring-slate-200">{edges.length} edges</span>
          </div>
        </div>
        <div className="h-[460px] overflow-hidden rounded-md border border-slate-200 bg-white">
          <ReactFlow
            colorMode="light"
            connectionMode={ConnectionMode.Loose}
            defaultEdgeOptions={{
              type: "smoothstep",
              markerEnd: { type: MarkerType.ArrowClosed },
            }}
            edges={edges}
            fitView
            fitViewOptions={{ padding: 0.18 }}
            isValidConnection={isValidConnection}
            nodeTypes={workflowNodeTypes}
            nodes={nodes}
            nodesDraggable
            proOptions={{ hideAttribution: true }}
            snapGrid={[20, 20]}
            snapToGrid
            onConnect={onConnect}
            onEdgeClick={(_, edge) => setSelectedEdgeId(edge.id)}
            onEdgesChange={onEdgesChange}
            onNodeClick={(_, node) => onSelectStep(node.id)}
            onNodesChange={onNodesChange}
            onPaneClick={() => setSelectedEdgeId(null)}
          >
            <Background gap={20} color="#e2e8f0" />
            <Controls position="bottom-left" />
            <MiniMap
              pannable
              zoomable
              nodeBorderRadius={8}
              nodeColor={(node) => (node.data?.blocked ? "#fecaca" : node.selected ? "#0f172a" : "#cbd5e1")}
            />
            {nodes.length === 0 ? (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
                <div className="rounded-md border border-dashed border-slate-200 bg-white/95 px-4 py-3 text-center shadow-sm">
                  <p className="text-sm font-semibold text-slate-800">No workflow steps yet</p>
                  <p className="mt-1 text-xs text-slate-500">Add a run, action, or approval gate to start the graph.</p>
                </div>
              </div>
            ) : null}
          </ReactFlow>
        </div>
      </div>
      <div className="grid gap-2 border-b border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h4 className="text-xs font-semibold text-slate-700">Workflow Presets</h4>
            <p className="text-[11px] text-slate-500">Load a practical starter before shaping dependencies.</p>
          </div>
          <span className="rounded bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-500">{workflowTemplates.length} presets</span>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {workflowTemplates.map((template) => (
            <button
              key={template.name}
              className="rounded-md border border-slate-200 bg-slate-50 p-2 text-left transition hover:border-slate-400 hover:bg-white"
              type="button"
              onClick={() => onApplyTemplate(template.workflow)}
            >
              <span className="block text-xs font-semibold text-slate-800">{template.name}</span>
              <span className="block truncate text-[11px] text-slate-500">{template.description}</span>
            </button>
          ))}
        </div>
      </div>
      <WorkflowDependencyMap
        executionPlan={executionPlan}
        issueMap={issueMap}
        selectedStepId={selectedStepId}
        workflow={workflow}
        onRemoveDependency={(stepId, dependency) => {
          const step = workflow.steps.find((item) => item.id === stepId);
          if (step) {
            onUpdateStep(step.id, { needs: step.needs.filter((item) => item !== dependency) });
          }
        }}
        onSelectStep={onSelectStep}
      />
      <div className="grid gap-3 p-4">
        {workflow.steps.map((step, index) => (
          <WorkflowStepCard
            issue={issueMap.get(step.id)}
            key={step.id}
            index={index}
            selected={step.id === selectedStepId}
            step={step}
            onDelete={onDeleteStep}
            onDuplicate={onDuplicateStep}
            onMove={onMoveStep}
            onSelect={onSelectStep}
            onUpdate={onUpdateStep}
          />
        ))}
      </div>
    </div>
  );
}

function WorkflowStepCard({
  index,
  issue,
  selected,
  step,
  onDelete,
  onDuplicate,
  onMove,
  onSelect,
  onUpdate,
}: {
  index: number;
  issue?: WorkflowStepIssueSummary;
  selected: boolean;
  step: WorkflowStep;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onSelect: (id: string) => void;
  onUpdate: (id: string, patch: Partial<WorkflowStep>) => void;
}) {
  const hasErrors = Boolean(issue?.errors.length);
  const hasWarnings = Boolean(issue?.warnings.length);
  return (
    <div
      className={`rounded-md border bg-white shadow-sm transition ${
        selected
          ? "border-slate-950 ring-2 ring-slate-200"
          : hasErrors
            ? "border-red-300 hover:border-red-400 hover:shadow-md"
            : hasWarnings
              ? "border-amber-300 hover:border-amber-400 hover:shadow-md"
              : "border-slate-200 hover:border-slate-400 hover:shadow-md"
      }`}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(step.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          onSelect(step.id);
        }
      }}
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <div className="min-w-0 flex-1 pr-2">
          <div className="flex items-center gap-2">
            <span className="flex size-6 shrink-0 items-center justify-center rounded bg-slate-100 text-xs font-semibold text-slate-600">
              {index + 1}
            </span>
            <input
              aria-label={`${step.name} workflow step name`}
              className="h-7 min-w-0 flex-1 rounded bg-transparent text-sm font-semibold outline-none focus:bg-slate-50 focus:px-1"
              value={step.name}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => onUpdate(step.id, { name: event.currentTarget.value })}
            />
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-1 font-mono text-[11px] text-slate-500">
            <span className="rounded bg-slate-100 px-1 text-slate-700">{step.kind}</span>
            {hasErrors ? <span className="rounded bg-red-50 px-1 text-red-700">error</span> : null}
            {!hasErrors && hasWarnings ? <span className="rounded bg-amber-50 px-1 text-amber-700">warning</span> : null}
            {step.needs.length > 0 ? <span className="truncate">needs {step.needs.join(", ")}</span> : <span>no dependencies</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton label="Move up" icon={ArrowUp} onClick={() => onMove(step.id, -1)} />
          <IconButton label="Move down" icon={ArrowDown} onClick={() => onMove(step.id, 1)} />
          <IconButton label="Duplicate" icon={Copy} onClick={() => onDuplicate(step.id)} />
          <IconButton label="Delete" icon={Trash2} onClick={() => onDelete(step.id)} />
        </div>
      </div>
      <div className="grid gap-2 p-3">
        {issue && (issue.errors.length > 0 || issue.warnings.length > 0) ? (
          <div
            className={`rounded-md border p-2 text-xs ${
              issue.errors.length > 0 ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900"
            }`}
          >
            {[...issue.errors, ...issue.warnings].slice(0, 2).join(" ")}
          </div>
        ) : null}
        <select
          className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm outline-none focus:border-slate-400"
          value={step.kind}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onUpdate(step.id, { kind: event.currentTarget.value as WorkflowStepKind })}
        >
          <option value="run">run</option>
          <option value="uses">uses</option>
          <option value="approval">approval</option>
        </select>
        {step.kind === "uses" ? (
          <input
            className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-sm outline-none focus:border-slate-400"
            value={step.uses}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onUpdate(step.id, { uses: event.currentTarget.value })}
          />
        ) : (
          <textarea
            className="min-h-20 resize-y rounded-md border border-slate-200 bg-white px-2 py-2 font-mono text-sm outline-none focus:border-slate-400"
            value={step.command}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onUpdate(step.id, { command: event.currentTarget.value })}
          />
        )}
      </div>
    </div>
  );
}

function WorkflowDependencyMap({
  executionPlan,
  issueMap,
  selectedStepId,
  workflow,
  onRemoveDependency,
  onSelectStep,
}: {
  executionPlan: WorkflowExecutionPlan;
  issueMap: Map<string, WorkflowStepIssueSummary>;
  selectedStepId: string | null;
  workflow: WorkflowModel;
  onRemoveDependency: (stepId: string, dependency: string) => void;
  onSelectStep: (id: string) => void;
}) {
  const ids = new Set(workflow.steps.map((step) => step.id));
  const dependencies = workflow.steps.flatMap((step) =>
    step.needs.map((dependency) => ({
      dependency,
      step,
      missing: !ids.has(dependency),
    })),
  );
  const rootSteps = workflow.steps.filter((step) => step.needs.length === 0);
  const errorCount = [...issueMap.values()].reduce((count, issue) => count + issue.errors.length, 0);
  const warningCount = [...issueMap.values()].reduce((count, issue) => count + issue.warnings.length, 0);

  return (
    <div className="border-b border-slate-200 bg-slate-50 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-md bg-white text-slate-600 ring-1 ring-slate-200">
            <GitBranch size={16} aria-hidden="true" />
          </span>
          <div>
            <h4 className="text-xs font-semibold text-slate-700">Dependency Map</h4>
            <p className="text-[11px] text-slate-500">Roots, edges, and validation pressure.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
          <span className="rounded bg-white px-2 py-1 text-slate-600 ring-1 ring-slate-200">{workflow.steps.length} steps</span>
          <span className="rounded bg-white px-2 py-1 text-slate-600 ring-1 ring-slate-200">{dependencies.length} edges</span>
          {errorCount > 0 ? <span className="rounded bg-red-50 px-2 py-1 text-red-700 ring-1 ring-red-200">{errorCount} errors</span> : null}
          {warningCount > 0 ? (
            <span className="rounded bg-amber-50 px-2 py-1 text-amber-700 ring-1 ring-amber-200">{warningCount} warnings</span>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="grid gap-2">
          {dependencies.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-200 bg-white p-3 text-xs text-slate-500">
              No dependency edges yet. Add dependencies in the selected step inspector.
            </div>
          ) : (
            dependencies.map((edge, index) => (
              <div
                key={`${edge.step.id}-${edge.dependency}-${index}`}
                className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border bg-white p-2 text-xs transition hover:border-slate-400 ${
                  edge.missing ? "border-red-200" : edge.step.id === selectedStepId ? "border-slate-400" : "border-slate-200"
                }`}
              >
                <button
                  className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-left"
                  type="button"
                  onClick={() => onSelectStep(edge.step.id)}
                >
                  <span
                    className={`truncate rounded px-2 py-1 font-mono ${
                      edge.missing ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {edge.dependency}
                  </span>
                  <ArrowRight size={14} className="text-slate-400" aria-hidden="true" />
                  <span className="truncate rounded bg-slate-950 px-2 py-1 font-mono text-white">{edge.step.id}</span>
                </button>
                <button
                  aria-label={`Remove dependency ${edge.dependency} to ${edge.step.id}`}
                  className="inline-flex size-7 items-center justify-center rounded-md text-slate-500 hover:bg-red-50 hover:text-red-700"
                  title="Remove dependency"
                  type="button"
                  onClick={() => onRemoveDependency(edge.step.id, edge.dependency)}
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </div>
            ))
          )}
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <div className="mb-2 text-xs font-semibold text-slate-700">Root Steps</div>
          <div className="grid gap-1">
            {rootSteps.length > 0 ? (
              rootSteps.map((step) => (
                <button
                  key={step.id}
                  className={`truncate rounded px-2 py-1 text-left font-mono text-[11px] ${
                    step.id === selectedStepId ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                  }`}
                  type="button"
                  onClick={() => onSelectStep(step.id)}
                >
                  {step.id}
                </button>
              ))
            ) : (
              <div className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">No root step detected.</div>
            )}
          </div>
        </div>
      </div>
      <div className="mt-3 rounded-md border border-slate-200 bg-white p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-slate-700">Execution Order</div>
          {executionPlan.blockedStepIds.length > 0 ? (
            <span className="rounded bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">
              {executionPlan.blockedStepIds.length} blocked
            </span>
          ) : (
            <span className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">ready</span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {executionPlan.orderedStepIds.length > 0 ? (
            executionPlan.orderedStepIds.map((id, index) => (
              <button
                key={id}
                className={`inline-flex items-center gap-1 rounded px-2 py-1 font-mono text-[11px] ${
                  id === selectedStepId ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                }`}
                type="button"
                onClick={() => onSelectStep(id)}
              >
                <span className="font-sans text-[10px] font-semibold">{index + 1}</span>
                {id}
              </button>
            ))
          ) : (
            <span className="rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">No executable order available.</span>
          )}
        </div>
        {executionPlan.blockedStepIds.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">
            {executionPlan.blockedStepIds.map((id) => (
              <button
                key={id}
                className="rounded bg-red-50 px-2 py-1 font-mono text-[11px] text-red-700 hover:bg-red-100"
                type="button"
                onClick={() => onSelectStep(id)}
              >
                {id}
              </button>
            ))}
          </div>
        ) : null}
      </div>
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
            {Boolean(node.props.isArray) ? (
              <span className="rounded bg-slate-100 px-1 text-slate-700">array of {fieldDataType(node)}</span>
            ) : null}
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
  if (Boolean(node.props.isArray)) {
    const dataType = fieldDataType(node);
    return (
      <input
        className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none focus:border-slate-400"
        value={arrayItemsText(node.value)}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) =>
          onUpdate(node.id, {
            value: event.currentTarget.value
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean)
              .map((item) => (dataType === "number" ? Number(item) : item)),
          })
        }
      />
    );
  }

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

function TextAreaControl({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <textarea
        className="min-h-20 resize-y rounded-md border border-slate-200 bg-white px-2 py-2 text-sm outline-none focus:border-slate-400"
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
      <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600">
        {isArray ? `Array items: ${dataType}` : `Value type: ${dataType}`}
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
      <ConstraintControl dataType={dataType} isArray={isArray} node={node} onUpdateProps={updateProps} />
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

function ConstraintControl({
  dataType,
  isArray,
  node,
  onUpdateProps,
}: {
  dataType: FieldDataType;
  isArray: boolean;
  node: BuilderNode;
  onUpdateProps: (props: Record<string, JsonValue>) => void;
}) {
  const updateNumberProp = (key: string, value: string) => {
    onUpdateProps({ [key]: value.trim() === "" ? null : Number(value) });
  };

  const controls: ReactNode[] = [];
  if (dataType === "string" || node.type === "select") {
    controls.push(
      <NumberControl
        key="minLength"
        label="Min length"
        value={numberProp(node, "minLength")}
        onChange={(value) => updateNumberProp("minLength", value)}
      />,
      <NumberControl
        key="maxLength"
        label="Max length"
        value={numberProp(node, "maxLength")}
        onChange={(value) => updateNumberProp("maxLength", value)}
      />,
      <TextControl
        key="pattern"
        label="Pattern"
        value={typeof node.props.pattern === "string" ? node.props.pattern : ""}
        onChange={(pattern) => onUpdateProps({ pattern })}
      />,
    );
  }
  if (dataType === "number") {
    controls.push(
      <NumberControl
        key="minimum"
        label="Minimum"
        value={numberProp(node, "minimum")}
        onChange={(value) => updateNumberProp("minimum", value)}
      />,
      <NumberControl
        key="maximum"
        label="Maximum"
        value={numberProp(node, "maximum")}
        onChange={(value) => updateNumberProp("maximum", value)}
      />,
    );
  }
  if (dataType === "object") {
    controls.push(
      <NumberControl
        key="minProperties"
        label="Min props"
        value={numberProp(node, "minProperties")}
        onChange={(value) => updateNumberProp("minProperties", value)}
      />,
      <NumberControl
        key="maxProperties"
        label="Max props"
        value={numberProp(node, "maxProperties")}
        onChange={(value) => updateNumberProp("maxProperties", value)}
      />,
    );
  }
  if (isArray) {
    controls.push(
      <NumberControl
        key="minItems"
        label="Min items"
        value={numberProp(node, "minItems")}
        onChange={(value) => updateNumberProp("minItems", value)}
      />,
      <NumberControl
        key="maxItems"
        label="Max items"
        value={numberProp(node, "maxItems")}
        onChange={(value) => updateNumberProp("maxItems", value)}
      />,
    );
  }

  if (controls.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-2 rounded-md border border-slate-200 bg-white p-3">
      <div className="text-xs font-semibold text-slate-700">Constraints</div>
      <div className="grid grid-cols-2 gap-2">{controls}</div>
    </div>
  );
}

function NumberControl({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <input
        className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm outline-none focus:border-slate-400"
        type="number"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function numberProp(node: BuilderNode, key: string) {
  return typeof node.props[key] === "number" && Number.isFinite(node.props[key]) ? String(node.props[key]) : "";
}

function arrayItemsText(value: JsonValue) {
  return (Array.isArray(value) ? value : [value]).map((item) => String(item ?? "")).join(", ");
}

function ValueControl({ node, onUpdate }: { node: BuilderNode; onUpdate: (id: string, patch: Partial<BuilderNode>) => void }) {
  const isArray = Boolean(node.props.isArray);
  const dataType = fieldDataType(node);

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

  if (isArray) {
    const updateItems = (value: string) => {
      const items = value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => (dataType === "number" ? Number(item) : item));
      onUpdate(node.id, { value: items });
    };

    return (
      <>
        {node.type === "select" ? (
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
              });
            }}
          />
        ) : null}
        <TextControl label="Items" value={arrayItemsText(node.value)} onChange={updateItems} />
      </>
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

function WorkflowInspector({
  executionPlan,
  issueMap,
  selectedStep,
  workflow,
  onDeleteStep,
  onUpdateStep,
  onUpdateWorkflow,
}: {
  executionPlan: WorkflowExecutionPlan;
  issueMap: Map<string, WorkflowStepIssueSummary>;
  selectedStep: WorkflowStep | null;
  workflow: WorkflowModel;
  onDeleteStep: (id: string) => void;
  onUpdateStep: (id: string, patch: Partial<WorkflowStep>) => void;
  onUpdateWorkflow: (patch: Partial<WorkflowModel>) => void;
}) {
  return (
    <section className="min-h-0 overflow-auto border-b border-slate-200">
      <PanelHeader title="Workflow" caption="Configure trigger, runtime, and selected step" />
      <div className="grid gap-3 p-4">
        <TextControl label="Name" value={workflow.name} onChange={(name) => onUpdateWorkflow({ name })} />
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-slate-600">Trigger</span>
            <select
              className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm outline-none focus:border-slate-400"
              value={workflow.trigger}
              onChange={(event) => onUpdateWorkflow({ trigger: event.currentTarget.value as WorkflowModel["trigger"] })}
            >
              <option value="manual">manual</option>
              <option value="push">push</option>
              <option value="schedule">schedule</option>
            </select>
          </label>
          <TextControl label="Runs on" value={workflow.runsOn} onChange={(runsOn) => onUpdateWorkflow({ runsOn })} />
        </div>
        {workflow.trigger === "schedule" ? (
          <TextControl label="Cron" value={workflow.schedule} onChange={(schedule) => onUpdateWorkflow({ schedule })} />
        ) : null}

        {selectedStep ? (
          <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold text-slate-700">Selected Step</div>
                <div className="font-mono text-[11px] text-slate-500">{selectedStep.id}</div>
              </div>
              <button
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-red-200 bg-white px-2 text-xs font-semibold text-red-700 hover:bg-red-50"
                type="button"
                onClick={() => onDeleteStep(selectedStep.id)}
              >
                <Trash2 size={13} aria-hidden="true" />
                Delete
              </button>
            </div>
            <TextControl label="Step name" value={selectedStep.name} onChange={(name) => onUpdateStep(selectedStep.id, { name })} />
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-slate-600">Kind</span>
              <select
                className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm outline-none focus:border-slate-400"
                value={selectedStep.kind}
                onChange={(event) => onUpdateStep(selectedStep.id, { kind: event.currentTarget.value as WorkflowStepKind })}
              >
                <option value="run">run</option>
                <option value="uses">uses</option>
                <option value="approval">approval</option>
              </select>
            </label>
            {selectedStep.kind === "uses" ? (
              <TextControl label="Uses" value={selectedStep.uses} onChange={(uses) => onUpdateStep(selectedStep.id, { uses })} />
            ) : (
              <TextAreaControl
                label={selectedStep.kind === "approval" ? "Gate note" : "Command"}
                value={selectedStep.command}
                onChange={(command) => onUpdateStep(selectedStep.id, { command })}
              />
            )}
            <TextControl
              label="Needs"
              value={selectedStep.needs.join(", ")}
              onChange={(value) =>
                onUpdateStep(selectedStep.id, {
                  needs: value
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean),
                })
              }
            />
            <WorkflowDependencyPicker
              executionPlan={executionPlan}
              issue={issueMap.get(selectedStep.id)}
              selectedStep={selectedStep}
              steps={workflow.steps}
              onChange={(needs) => onUpdateStep(selectedStep.id, { needs })}
            />
            <TextAreaControl
              label="Environment"
              value={envToText(selectedStep.env)}
              onChange={(value) => onUpdateStep(selectedStep.id, { env: envFromText(value) })}
            />
          </div>
        ) : (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">Select a workflow step to edit it.</div>
        )}
      </div>
    </section>
  );
}

function WorkflowDependencyPicker({
  executionPlan,
  issue,
  selectedStep,
  steps,
  onChange,
}: {
  executionPlan: WorkflowExecutionPlan;
  issue?: WorkflowStepIssueSummary;
  selectedStep: WorkflowStep;
  steps: WorkflowStep[];
  onChange: (needs: string[]) => void;
}) {
  const candidates = steps.filter((step) => step.id !== selectedStep.id);
  const needs = new Set(selectedStep.needs);

  const toggleDependency = (id: string) => {
    onChange(needs.has(id) ? selectedStep.needs.filter((dependency) => dependency !== id) : [...selectedStep.needs, id]);
  };

  return (
    <div className="grid gap-2 rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-700">Dependency Builder</span>
        <span className="rounded bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">{selectedStep.id}</span>
      </div>
      <div className="grid gap-1.5">
        {candidates.length > 0 ? (
          candidates.map((step) => {
            const selected = needs.has(step.id);
            const createsCycle = !selected && dependencyWouldCreateCycle(selectedStep.id, step.id, steps);
            return (
              <button
                key={step.id}
                className={`flex min-w-0 items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-xs disabled:cursor-not-allowed disabled:opacity-55 ${
                  selected
                    ? "border-slate-950 bg-slate-950 text-white"
                    : createsCycle
                      ? "border-red-200 bg-red-50 text-red-700"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50"
                }`}
                disabled={createsCycle}
                title={createsCycle ? "This dependency would create a circular workflow." : undefined}
                type="button"
                onClick={() => toggleDependency(step.id)}
              >
                <span className="truncate font-mono">{step.id}</span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                    selected ? "bg-white/15" : createsCycle ? "bg-white text-red-700" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {selected ? "needed" : createsCycle ? "cycle" : step.kind}
                </span>
              </button>
            );
          })
        ) : (
          <div className="rounded bg-slate-50 px-2 py-2 text-xs text-slate-500">Add another step to create dependencies.</div>
        )}
      </div>
      {issue && issue.errors.length > 0 ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">{issue.errors.slice(0, 2).join(" ")}</div>
      ) : null}
      {executionPlan.cycles.length > 0 ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          Circular dependency: {executionPlan.cycles[0].join(" -> ")}.
        </div>
      ) : null}
    </div>
  );
}

function WorkflowExportPanel({
  content,
  target,
  validation,
  onCopy,
  onDownload,
  onTargetChange,
}: {
  content: string;
  target: WorkflowExportTarget;
  validation: ValidationReport;
  onCopy: () => void;
  onDownload: () => void;
  onTargetChange: (target: WorkflowExportTarget) => void;
}) {
  return (
    <section className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto]">
      <PanelHeader title="YAML" caption={workflowTargetCaption(target)} />
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 p-2">
        <SegmentedControl
          ariaLabel="Workflow export target"
          value={target}
          options={[
            { value: "portable", label: "Generic" },
            { value: "github-actions", label: "GitHub Actions" },
            { value: "gitlab-ci", label: "GitLab CI" },
          ]}
          onChange={onTargetChange}
        />
      </div>
      <OutputCode title={workflowPreviewTitle(target)} content={content} />
      <div className="grid gap-2 border-t border-slate-200 p-3">
        <ValidationSummary report={validation} validLabel="Workflow is valid." />
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

function workflowTargetCaption(target: WorkflowExportTarget) {
  if (target === "github-actions") {
    return "GitHub Actions workflow";
  }
  if (target === "gitlab-ci") {
    return "GitLab CI pipeline";
  }
  return "Portable workflow definition";
}

function workflowPreviewTitle(target: WorkflowExportTarget) {
  if (target === "github-actions") {
    return "github-actions.yml";
  }
  if (target === "gitlab-ci") {
    return ".gitlab-ci.yml";
  }
  return "workflow.yaml";
}

function ValidationSummary({ report, validLabel }: { report: ValidationReport; validLabel: string }) {
  if (report.errors.length === 0 && report.warnings.length === 0) {
    return <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">{validLabel}</div>;
  }

  return (
    <div
      className={`rounded-md border p-2 text-xs ${
        report.errors.length > 0 ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900"
      }`}
    >
      {[...report.errors, ...report.warnings].slice(0, 3).join(" ")}
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

interface WorkflowStepIssueSummary {
  errors: string[];
  warnings: string[];
}

function workflowStepIssueMap(workflow: WorkflowModel) {
  const issues = new Map<string, WorkflowStepIssueSummary>();
  const ids = new Set(workflow.steps.map((step) => step.id));
  const names = new Map<string, string[]>();

  const ensure = (id: string) => {
    const existing = issues.get(id);
    if (existing) {
      return existing;
    }
    const next = { errors: [], warnings: [] };
    issues.set(id, next);
    return next;
  };

  for (const step of workflow.steps) {
    const issue = ensure(step.id);
    const label = step.name.trim() || step.id;
    const nameGroup = names.get(step.name.trim()) ?? [];
    if (step.name.trim()) {
      nameGroup.push(step.id);
      names.set(step.name.trim(), nameGroup);
    }
    if (!step.name.trim()) {
      issue.warnings.push(`${step.id} has no display name.`);
    }
    if (step.kind === "uses" && !step.uses.trim()) {
      issue.errors.push(`${label} needs an action reference.`);
    }
    if (step.kind !== "uses" && !step.command.trim()) {
      issue.errors.push(`${label} needs a command or gate note.`);
    }
    for (const dependency of step.needs) {
      if (dependency === step.id) {
        issue.errors.push(`${label} depends on itself.`);
      } else if (!ids.has(dependency)) {
        issue.errors.push(`${label} depends on missing step ${dependency}.`);
      }
    }
  }

  for (const group of names.values()) {
    if (group.length > 1) {
      group.forEach((id) => ensure(id).warnings.push("Duplicate step name."));
    }
  }

  const cycle = findWorkflowCycle(workflow);
  if (cycle.length > 0) {
    cycle.forEach((id) => ensure(id).errors.push("Circular dependency."));
  }

  return issues;
}

function buildWorkflowFlowElements(
  workflow: WorkflowModel,
  executionPlan: WorkflowExecutionPlan,
  issueMap: Map<string, WorkflowStepIssueSummary>,
  selectedStepId: string | null,
  nodePositions: Record<string, { x: number; y: number }>,
  actions: {
    onDelete: (id: string) => void;
    onDuplicate: (id: string) => void;
  },
): { nodes: WorkflowFlowNode[]; edges: FlowEdge[] } {
  const depthMap = workflowDepthMap(workflow);
  const layoutPositions = createWorkflowGraphPositions(workflow);
  const orderMap = new Map(executionPlan.orderedStepIds.map((id, index) => [id, index + 1]));
  const blocked = new Set(executionPlan.blockedStepIds);
  const ids = new Set(workflow.steps.map((step) => step.id));
  const nodes: WorkflowFlowNode[] = workflow.steps.map((step, index) => {
    const depth = depthMap.get(step.id) ?? 0;
    return {
      id: step.id,
      type: "workflowStep",
      initialHeight: 122,
      initialWidth: 260,
      width: 260,
      height: 122,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      handles: [
        { type: "target", position: Position.Left, x: 0, y: 56, width: 10, height: 10 },
        { type: "source", position: Position.Right, x: 250, y: 56, width: 10, height: 10 },
      ],
      position: nodePositions[step.id] ?? layoutPositions[step.id] ?? { x: 40 + depth * 310, y: 40 + index * 145 },
      selected: step.id === selectedStepId,
      data: {
        step,
        index,
        selected: step.id === selectedStepId,
        issue: issueMap.get(step.id),
        orderIndex: orderMap.get(step.id) ?? null,
        blocked: blocked.has(step.id),
        onDelete: actions.onDelete,
        onDuplicate: actions.onDuplicate,
      },
    };
  });
  const edges: FlowEdge[] = workflow.steps.flatMap((step) =>
    step.needs
      .filter((dependency) => ids.has(dependency))
      .map((dependency) => ({
        id: `edge-${dependency}-${step.id}`,
        source: dependency,
        target: step.id,
        type: "smoothstep",
        animated: step.id === selectedStepId || dependency === selectedStepId,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: {
          stroke: step.id === selectedStepId || dependency === selectedStepId ? "#0f172a" : "#94a3b8",
          strokeWidth: step.id === selectedStepId || dependency === selectedStepId ? 2.2 : 1.6,
        },
      })),
  );
  return { nodes, edges };
}

function createWorkflowGraphPositions(workflow: WorkflowModel) {
  const depthMap = workflowDepthMap(workflow);
  const depthRows = new Map<number, number>();
  return workflow.steps.reduce<Record<string, { x: number; y: number }>>((positions, step) => {
    const depth = depthMap.get(step.id) ?? 0;
    const row = depthRows.get(depth) ?? 0;
    depthRows.set(depth, row + 1);
    positions[step.id] = {
      x: 40 + depth * 310,
      y: 40 + row * 145,
    };
    return positions;
  }, {});
}

function workflowDepthMap(workflow: WorkflowModel) {
  const ids = new Set(workflow.steps.map((step) => step.id));
  const byId = new Map(workflow.steps.map((step) => [step.id, step]));
  const visiting = new Set<string>();
  const depths = new Map<string, number>();

  const depthFor = (id: string): number => {
    if (depths.has(id)) {
      return depths.get(id) ?? 0;
    }
    if (visiting.has(id)) {
      return 0;
    }
    visiting.add(id);
    const step = byId.get(id);
    const dependencyDepths = step?.needs.filter((dependency) => ids.has(dependency)).map((dependency) => depthFor(dependency)) ?? [];
    const depth = dependencyDepths.length > 0 ? Math.max(...dependencyDepths) + 1 : 0;
    visiting.delete(id);
    depths.set(id, depth);
    return depth;
  };

  workflow.steps.forEach((step) => depthFor(step.id));
  return depths;
}

function createWorkflowStepId(name: string, steps: WorkflowStep[]) {
  const usedIds = new Set(steps.map((step) => step.id));
  const base = `step-${slugify(name || "step")}`;
  let candidate = base;
  let index = 2;
  while (usedIds.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
}

function dependencyWouldCreateCycle(stepId: string, dependencyId: string, steps: WorkflowStep[]) {
  const graph = new Map(steps.map((step) => [step.id, step.id === stepId ? [...step.needs, dependencyId] : step.needs]));
  const visit = (id: string, seen: Set<string>): boolean => {
    if (id === stepId && seen.size > 0) {
      return true;
    }
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return (graph.get(id) ?? []).some((dependency) => visit(dependency, new Set(seen)));
  };
  return visit(dependencyId, new Set());
}

function findWorkflowCycle(workflow: WorkflowModel) {
  const ids = new Set(workflow.steps.map((step) => step.id));
  const graph = new Map(workflow.steps.map((step) => [step.id, step.needs.filter((dependency) => ids.has(dependency))]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      return stack.slice(start);
    }
    if (visited.has(id)) {
      return null;
    }
    visiting.add(id);
    stack.push(id);
    for (const dependency of graph.get(id) ?? []) {
      const cycle = visit(dependency);
      if (cycle) {
        return cycle;
      }
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
    return null;
  };

  for (const step of workflow.steps) {
    const cycle = visit(step.id);
    if (cycle) {
      return cycle;
    }
  }
  return [];
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
