import { invoke } from "@tauri-apps/api/core";
import type {
  BuilderNode,
  DocumentModel,
  ExportFormat,
  GeneratedOutput,
  JsonValue,
  OutputMode,
  ValidationReport,
} from "./types";

interface TauriWindow extends Window {
  __TAURI_INTERNALS__?: unknown;
}

const isTauriRuntime = () => Boolean((window as TauriWindow).__TAURI_INTERNALS__);

export async function generateOutput(
  document: DocumentModel,
  format: ExportFormat,
  mode: OutputMode,
): Promise<GeneratedOutput> {
  if (isTauriRuntime()) {
    return invoke<GeneratedOutput>("generate_output", { document, format, mode });
  }

  const data = mode === "schema" ? schemaDocument(document) : normalizeDocument(document);
  return {
    format,
    mode,
    content: serializeData(data, format),
    data,
  };
}

export async function validateDocument(document: DocumentModel): Promise<ValidationReport> {
  if (isTauriRuntime()) {
    return invoke<ValidationReport>("validate_document", { document });
  }

  const warnings: string[] = [];
  const errors: string[] = [];
  visitNodes(document.nodes, null, (node, parentBinding) => {
    const binding = node.binding.trim();
    const path = combineBinding(parentBinding, binding) ?? node.label;
    const isContainer = node.type === "section" || node.type === "grid";
    if (!binding && !isContainer) {
      warnings.push(`${node.label} has no binding and will be skipped.`);
    }
    if (binding && !binding.split(".").every((part) => /^[A-Za-z0-9_-]+$/.test(part))) {
      errors.push(`${node.label} has an invalid binding: ${binding}`);
    }
    validateNodeValue(node, path, errors);
    return combineBinding(parentBinding, binding);
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function validateNodeValue(node: BuilderNode, path: string, errors: string[]) {
  if (node.type === "section" || node.type === "grid") {
    validateNumberConstraint(node, path, node.children.length, "minProperties", "has fewer properties than");
    validateNumberConstraint(node, path, node.children.length, "maxProperties", "has more properties than");
    return;
  }

  const values = Boolean(node.props.isArray) ? arrayValue(node.value) : [node.value];
  if (Boolean(node.props.isArray)) {
    validateNumberConstraint(node, path, values.length, "minItems", "has fewer items than");
    validateNumberConstraint(node, path, values.length, "maxItems", "has more items than");
  }

  for (const value of values) {
    validateScalarConstraints(node, path, value, errors);
  }

  function validateNumberConstraint(
    constraintNode: BuilderNode,
    constraintPath: string,
    value: number,
    key: string,
    message: string,
  ) {
    const limit = constraintNode.props[key];
    if (typeof limit === "number" && Number.isFinite(limit)) {
      if ((key.startsWith("min") && value < limit) || (key.startsWith("max") && value > limit)) {
        errors.push(`${constraintPath} ${message} ${limit}.`);
      }
    }
  }
}

function validateScalarConstraints(node: BuilderNode, path: string, value: JsonValue, errors: string[]) {
  const dataType = typeof node.props.dataType === "string" ? node.props.dataType : node.type;
  if (dataType === "string" && typeof value === "string") {
    const minLength = node.props.minLength;
    const maxLength = node.props.maxLength;
    if (typeof minLength === "number" && value.length < minLength) {
      errors.push(`${path} is shorter than ${minLength} characters.`);
    }
    if (typeof maxLength === "number" && value.length > maxLength) {
      errors.push(`${path} is longer than ${maxLength} characters.`);
    }
    if (typeof node.props.pattern === "string" && node.props.pattern) {
      try {
        if (!new RegExp(node.props.pattern).test(value)) {
          errors.push(`${path} does not match pattern ${node.props.pattern}.`);
        }
      } catch {
        errors.push(`${path} has an invalid pattern constraint.`);
      }
    }
  }

  if (dataType === "number" && typeof value === "number") {
    const minimum = node.props.minimum;
    const maximum = node.props.maximum;
    if (typeof minimum === "number" && value < minimum) {
      errors.push(`${path} is below minimum ${minimum}.`);
    }
    if (typeof maximum === "number" && value > maximum) {
      errors.push(`${path} is above maximum ${maximum}.`);
    }
  }
}

function arrayValue(value: JsonValue) {
  return Array.isArray(value) ? value : [value];
}

function normalizeDocument(document: DocumentModel): JsonValue {
  const root: Record<string, JsonValue> = {};
  for (const node of document.nodes) {
    applyNode(root, node, null);
  }
  return root;
}

function schemaDocument(document: DocumentModel): JsonValue {
  const root: JsonValue = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {},
  };
  for (const node of document.nodes) {
    applySchemaNode(root, node, null);
  }
  return root;
}

function applySchemaNode(root: JsonValue, node: BuilderNode, parentBinding: string | null) {
  const binding = combineBinding(parentBinding, node.binding.trim());
  if (node.type === "section" || node.type === "grid") {
    if (binding) {
      const path = binding.split(".");
      insertSchemaPath(root, path, objectSchemaForNode(node));
      if (Boolean(node.props.required)) {
        insertRequiredPath(root, path);
      }
    }
    for (const child of node.children) {
      applySchemaNode(root, child, binding);
    }
    return;
  }

  if (binding) {
    const path = binding.split(".");
    insertSchemaPath(root, path, schemaForNode(node));
    if (Boolean(node.props.required)) {
      insertRequiredPath(root, path);
    }
  }
}

function objectSchemaForNode(node: BuilderNode): JsonValue {
  return {
    type: "object",
    properties: {},
    ...(typeof node.props.description === "string" && node.props.description ? { description: node.props.description } : {}),
    ...schemaConstraintProps(node, ["minProperties", "maxProperties"]),
  };
}

function schemaForNode(node: BuilderNode): JsonValue {
  const fallbackTypes: Record<BuilderNode["type"], string> = {
    text: "string",
    number: "number",
    checkbox: "boolean",
    select: "string",
    section: "object",
    grid: "object",
  };

  const dataType = typeof node.props.dataType === "string" ? node.props.dataType : fallbackTypes[node.type];
  let schema: JsonValue =
    dataType === "custom"
      ? {
          $ref: `#/$defs/${
            typeof node.props.customType === "string" && node.props.customType ? node.props.customType : "CustomType"
          }`,
        }
      : { type: dataType };

  if (node.type === "select") {
    schema = { ...(schema as Record<string, JsonValue>), enum: optionValues(node) };
  }

  if (typeof node.props.description === "string" && node.props.description) {
    schema = { ...(schema as Record<string, JsonValue>), description: node.props.description };
  }

  schema = {
    ...(schema as Record<string, JsonValue>),
    ...schemaConstraintProps(node, ["minLength", "maxLength", "pattern", "minimum", "maximum"]),
  };

  if (Boolean(node.props.isArray)) {
    schema = { type: "array", items: schema, ...schemaConstraintProps(node, ["minItems", "maxItems"]) };
  }

  if (Boolean(node.props.nullable)) {
    const objectSchema = schema as Record<string, JsonValue>;
    schema =
      typeof objectSchema.type === "string"
        ? { ...objectSchema, type: [objectSchema.type, "null"] }
        : { anyOf: [schema, { type: "null" }] };
  }

  return schema;
}

function schemaConstraintProps(node: BuilderNode, keys: string[]) {
  const props: Record<string, JsonValue> = {};
  for (const key of keys) {
    const value = node.props[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      props[key] = value;
    }
    if (key === "pattern" && typeof value === "string" && value.trim()) {
      props[key] = value;
    }
  }
  return props;
}

function insertSchemaPath(root: JsonValue, path: string[], leafSchema: JsonValue) {
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    return;
  }

  let cursor = root as Record<string, JsonValue>;
  for (const segment of path.slice(0, -1)) {
    const properties = ensureProperties(cursor);
    const next = properties[segment];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      properties[segment] = { type: "object", properties: {} };
    }
    cursor = properties[segment] as Record<string, JsonValue>;
  }

  const last = path[path.length - 1];
  if (last) {
    ensureProperties(cursor)[last] = leafSchema;
  }
}

function ensureProperties(schema: Record<string, JsonValue>) {
  if (!schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) {
    schema.properties = {};
  }
  return schema.properties as Record<string, JsonValue>;
}

function insertRequiredPath(root: JsonValue, path: string[]) {
  if (!root || typeof root !== "object" || Array.isArray(root) || path.length === 0) {
    return;
  }

  let cursor = root as Record<string, JsonValue>;
  for (const segment of path.slice(0, -1)) {
    const properties = ensureProperties(cursor);
    const next = properties[segment];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      properties[segment] = { type: "object", properties: {} };
    }
    cursor = properties[segment] as Record<string, JsonValue>;
  }

  const requiredKey = path[path.length - 1];
  const required = Array.isArray(cursor.required) ? cursor.required : [];
  if (!required.includes(requiredKey)) {
    cursor.required = [...required, requiredKey];
  }
}

function applyNode(root: Record<string, JsonValue>, node: BuilderNode, parentBinding: string | null) {
  const binding = combineBinding(parentBinding, node.binding.trim());

  if (node.type === "section" || node.type === "grid") {
    for (const child of node.children) {
      applyNode(root, child, binding);
    }
    return;
  }

  if (binding) {
    insertPath(root, binding.split("."), valueForNode(node));
  }
}

function valueForNode(node: BuilderNode): JsonValue {
  return Boolean(node.props.isArray) && !Array.isArray(node.value) ? [node.value] : node.value;
}

function visitNodes(
  nodes: BuilderNode[],
  parentBinding: string | null,
  visitor: (node: BuilderNode, parentBinding: string | null) => string | null,
) {
  for (const node of nodes) {
    const nextParent = visitor(node, parentBinding);
    for (const child of node.children) {
      visitNodes([child], nextParent, visitor);
    }
  }
}

function combineBinding(parent: string | null, binding: string) {
  if (!parent && !binding) {
    return null;
  }
  if (parent && !binding) {
    return parent;
  }
  if (!parent) {
    return binding;
  }
  return `${parent}.${binding}`;
}

function insertPath(root: Record<string, JsonValue>, path: string[], value: JsonValue) {
  let cursor: Record<string, JsonValue> | JsonValue[] = root;

  path.forEach((segment, index) => {
    const finalSegment = index === path.length - 1;
    const nextSegment = path[index + 1];
    const nextIsArray = nextSegment !== undefined && /^\d+$/.test(nextSegment);

    if (Array.isArray(cursor)) {
      const arrayIndex = Number(segment);
      if (finalSegment) {
        cursor[arrayIndex] = value;
      } else {
        cursor[arrayIndex] = cursor[arrayIndex] ?? (nextIsArray ? [] : {});
        cursor = cursor[arrayIndex] as Record<string, JsonValue> | JsonValue[];
      }
      return;
    }

    if (finalSegment) {
      cursor[segment] = value;
      return;
    }

    cursor[segment] = cursor[segment] ?? (nextIsArray ? [] : {});
    cursor = cursor[segment] as Record<string, JsonValue> | JsonValue[];
  });
}

function serializeData(data: JsonValue, format: ExportFormat) {
  if (format === "json") {
    return JSON.stringify(data, null, 2);
  }
  if (format === "xml") {
    return toXml("root", data);
  }
  if (format === "toml") {
    return toToml(data);
  }
  return toYaml(data);
}

function toYaml(value: JsonValue, indent = 0): string {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    return value
      .map((item) => `${pad}- ${isScalar(item) ? scalar(item) : `\n${toYaml(item, indent + 2)}`}`)
      .join("\n");
  }
  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([key, item]) => `${pad}${key}: ${isScalar(item) ? scalar(item) : `\n${toYaml(item, indent + 2)}`}`)
      .join("\n");
  }
  return `${pad}${scalar(value)}`;
}

function toToml(value: JsonValue, prefix = ""): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return `value = ${tomlValue(value)}\n`;
  }

  const lines: string[] = [];
  const nested: Array<[string, JsonValue]> = [];
  for (const [key, item] of Object.entries(value)) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      nested.push([key, item]);
    } else {
      lines.push(`${key} = ${tomlValue(item)}`);
    }
  }
  for (const [key, item] of nested) {
    const section = prefix ? `${prefix}.${key}` : key;
    lines.push("", `[${section}]`, toToml(item, section).trim());
  }
  return `${lines.join("\n")}\n`;
}

function toXml(name: string, value: JsonValue): string {
  if (Array.isArray(value)) {
    return `<${name}>${value.map((item) => toXml("item", item)).join("")}</${name}>`;
  }
  if (value && typeof value === "object") {
    return `<${name}>${Object.entries(value)
      .map(([key, item]) => toXml(xmlName(key), item))
      .join("")}</${name}>`;
  }
  if (value === null) {
    return `<${name} />`;
  }
  return `<${name}>${escapeXml(String(value))}</${name}>`;
}

function isScalar(value: JsonValue) {
  return value === null || typeof value !== "object";
}

function scalar(value: JsonValue) {
  if (typeof value === "string") {
    return value.includes(":") || value.includes("#") ? JSON.stringify(value) : value;
  }
  return String(value);
}

function tomlValue(value: JsonValue): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(tomlValue).join(", ")}]`;
  }
  if (value === null) {
    return '""';
  }
  return String(value);
}

function xmlName(value: string) {
  const sanitized = value.replace(/[^A-Za-z0-9_-]/g, "_");
  return /^\d/.test(sanitized) ? `_${sanitized}` : sanitized || "node";
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function optionValues(node: BuilderNode) {
  const options = node.props.options;
  return Array.isArray(options) ? options.map(String) : ["Option A", "Option B"];
}
