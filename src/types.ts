export type NodeType = "text" | "number" | "checkbox" | "select" | "section" | "grid";

export type ExportFormat = "json" | "yaml" | "toml" | "xml";

export type OutputMode = "values" | "schema";

export type CanvasView = "form" | "structure" | "workflow";

export type ImportMode = "values" | "schema";

export type FieldDataType = "string" | "number" | "boolean" | "object" | "array" | "custom";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface BuilderNode {
  id: string;
  type: NodeType;
  label: string;
  binding: string;
  value: JsonValue;
  children: BuilderNode[];
  props: Record<string, JsonValue>;
}

export interface InternalNode {
  id: string;
  type: FieldDataType;
  path: string[];
  value: JsonValue;
  nullable: boolean;
  isArray: boolean;
  label: string;
  customType?: string;
}

export interface DocumentModel {
  version: string;
  nodes: BuilderNode[];
  layout: {
    kind: string;
    columns: number;
  };
  meta: {
    name: string;
    format: string;
  };
}

export interface GeneratedOutput {
  format: ExportFormat;
  mode: OutputMode;
  content: string;
  data: JsonValue;
}

export interface ValidationReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export type WorkflowTrigger = "manual" | "push" | "schedule";

export type WorkflowStepKind = "run" | "uses" | "approval";

export type WorkflowExportTarget = "portable" | "github-actions" | "gitlab-ci";

export type WorkflowImportSource = WorkflowExportTarget;

export interface WorkflowStep {
  id: string;
  name: string;
  kind: WorkflowStepKind;
  command: string;
  uses: string;
  needs: string[];
  env: Record<string, string>;
}

export interface WorkflowGraphLayout {
  positions: Record<string, { x: number; y: number }>;
}

export interface WorkflowModel {
  version: string;
  name: string;
  trigger: WorkflowTrigger;
  schedule: string;
  runsOn: string;
  steps: WorkflowStep[];
  graph?: WorkflowGraphLayout;
}

export interface WorkflowImportResult {
  workflow: WorkflowModel;
  source: WorkflowImportSource;
  warnings: string[];
}

export interface WorkflowExecutionPlan {
  orderedStepIds: string[];
  blockedStepIds: string[];
  cycles: string[][];
  missingDependencies: Array<{
    stepId: string;
    dependency: string;
  }>;
}

export interface WorkflowTemplate {
  name: string;
  description: string;
  workflow: WorkflowModel;
}

export const exportFormats: ExportFormat[] = ["json", "yaml", "toml", "xml"];

export const outputModes: OutputMode[] = ["values", "schema"];
