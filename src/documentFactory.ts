import type { BuilderNode, DocumentModel, FieldDataType, JsonValue, NodeType } from "./types";

const createId = () => `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const titleCase = (value: string) =>
  value
    .replace(/[-_]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

export function createDocumentFromJson(value: JsonValue, name = "Imported JSON"): DocumentModel {
  return {
    version: "1.0.0",
    nodes: objectEntries(value).map(([key, item]) => valueToNode(key, item)),
    layout: {
      kind: "grid",
      columns: 2,
    },
    meta: {
      name,
      format: "ui-schema",
    },
  };
}

export function createNodeFromType(type: NodeType): BuilderNode {
  const dataType = nodeTypeToDataType(type);
  const labels: Record<NodeType, string> = {
    text: "Text Field",
    number: "Number Field",
    checkbox: "Checkbox",
    select: "Select",
    section: "Object",
    grid: "Grid",
  };

  return {
    id: createId(),
    type,
    label: labels[type],
    binding: type === "section" || type === "grid" ? "group" : "field",
    value: defaultValueForType(dataType),
    children: [],
    props: {
      dataType,
      nullable: false,
      isArray: false,
      ...(type === "select" ? { options: ["Option A", "Option B"] } : {}),
    },
  };
}

export const templateDocuments: Array<{ name: string; description: string; document: DocumentModel }> = [
  {
    name: "User Profile",
    description: "Nested identity payload",
    document: createDocumentFromJson({
      user: {
        name: "Ada Lovelace",
        age: 36,
        active: true,
        profile: {
          role: "Engineer",
        },
      },
    }),
  },
  {
    name: "API Payload",
    description: "Request body starter",
    document: createDocumentFromJson({
      request: {
        id: "req_001",
        retries: 3,
        dryRun: false,
        tags: ["alpha", "beta"],
      },
    }),
  },
  {
    name: "Config File",
    description: "Service config shape",
    document: createDocumentFromJson({
      service: {
        host: "localhost",
        port: 8080,
        features: {
          logging: true,
        },
      },
    }),
  },
];

function valueToNode(key: string, value: JsonValue): BuilderNode {
  if (Array.isArray(value)) {
    const sample = value[0] ?? "";
    const sampleType = inferDataType(sample);
    return {
      id: createId(),
      type: sampleType === "object" ? "section" : nodeTypeForDataType(sampleType),
      label: titleCase(key),
      binding: key,
      value: sampleType === "object" ? null : sample,
      children: sampleType === "object" ? objectEntries(sample).map(([childKey, childValue]) => valueToNode(childKey, childValue)) : [],
      props: {
        dataType: sampleType,
        nullable: value.some((item) => item === null),
        isArray: true,
      },
    };
  }

  if (value && typeof value === "object") {
    return {
      id: createId(),
      type: "section",
      label: titleCase(key),
      binding: key,
      value: null,
      children: objectEntries(value).map(([childKey, childValue]) => valueToNode(childKey, childValue)),
      props: {
        dataType: "object",
        nullable: false,
        isArray: false,
      },
    };
  }

  const dataType = inferDataType(value);
  return {
    id: createId(),
    type: nodeTypeForDataType(dataType),
    label: titleCase(key),
    binding: key,
    value,
    children: [],
    props: {
      dataType,
      nullable: value === null,
      isArray: false,
    },
  };
}

function objectEntries(value: JsonValue): Array<[string, JsonValue]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  return Object.entries(value);
}

function inferDataType(value: JsonValue): FieldDataType {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value && typeof value === "object") {
    return "object";
  }
  if (typeof value === "number") {
    return "number";
  }
  if (typeof value === "boolean") {
    return "boolean";
  }
  return "string";
}

function nodeTypeForDataType(dataType: FieldDataType): NodeType {
  if (dataType === "number") {
    return "number";
  }
  if (dataType === "boolean") {
    return "checkbox";
  }
  return "text";
}

function nodeTypeToDataType(type: NodeType): FieldDataType {
  if (type === "number") {
    return "number";
  }
  if (type === "checkbox") {
    return "boolean";
  }
  if (type === "section" || type === "grid") {
    return "object";
  }
  return "string";
}

function defaultValueForType(type: FieldDataType): JsonValue {
  if (type === "number") {
    return 0;
  }
  if (type === "boolean") {
    return false;
  }
  if (type === "object") {
    return null;
  }
  return "New value";
}
