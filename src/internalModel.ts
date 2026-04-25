import type { BuilderNode, DocumentModel, FieldDataType, InternalNode, JsonValue, WorkflowModel } from "./types";
import { normalizeWorkflow } from "./workflowFactory";

export interface ProjectFile {
  version: string;
  document: DocumentModel;
  internalNodes: InternalNode[];
  workflow?: WorkflowModel;
}

export interface ProjectLoadResult {
  document: DocumentModel;
  workflow?: WorkflowModel;
}

export function createProjectFile(document: DocumentModel, workflow?: WorkflowModel): ProjectFile {
  return {
    version: "1.0.0",
    document,
    internalNodes: buildInternalNodes(document),
    ...(workflow ? { workflow } : {}),
  };
}

export function readProjectFile(value: unknown): ProjectLoadResult | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const maybeProject = value as Partial<ProjectFile>;
  if (isDocumentModel(maybeProject.document)) {
    const workflow = normalizeWorkflow(maybeProject.workflow);
    return {
      document: maybeProject.document,
      ...(workflow ? { workflow } : {}),
    };
  }

  return isDocumentModel(value) ? { document: value } : null;
}

export function buildInternalNodes(document: DocumentModel): InternalNode[] {
  const nodes: InternalNode[] = [];

  const visit = (items: BuilderNode[], parentPath: string[]) => {
    for (const item of items) {
      const path = [...parentPath, ...splitBinding(item.binding)];
      nodes.push({
        id: item.id,
        type: fieldDataType(item),
        path,
        value: item.value,
        nullable: Boolean(item.props.nullable),
        isArray: Boolean(item.props.isArray),
        label: item.label,
        ...(typeof item.props.customType === "string" ? { customType: item.props.customType } : {}),
      });
      visit(item.children, path);
    }
  };

  visit(document.nodes, []);
  return nodes;
}

function isDocumentModel(value: unknown): value is DocumentModel {
  if (!value || typeof value !== "object") {
    return false;
  }

  const document = value as Partial<DocumentModel>;
  return typeof document.version === "string" && Array.isArray(document.nodes) && Boolean(document.layout) && Boolean(document.meta);
}

function splitBinding(binding: string) {
  return binding
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
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
  if (Array.isArray(node.value)) {
    return "array";
  }
  return primitiveType(node.value);
}

function primitiveType(value: JsonValue): FieldDataType {
  if (typeof value === "number") {
    return "number";
  }
  if (typeof value === "boolean") {
    return "boolean";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (value && typeof value === "object") {
    return "object";
  }
  return "string";
}
