export type NodeType = "text" | "number" | "checkbox" | "select" | "section" | "grid";

export type ExportFormat = "json" | "yaml" | "toml" | "xml";

export type OutputMode = "values" | "schema";

export type CanvasView = "form" | "structure";

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

export const exportFormats: ExportFormat[] = ["json", "yaml", "toml", "xml"];

export const outputModes: OutputMode[] = ["values", "schema"];
