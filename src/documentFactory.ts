import type { BuilderNode, DocumentModel, FieldDataType, JsonValue, NodeType } from "./types";

type JsonRecord = Record<string, JsonValue>;

interface SchemaInfo {
  schema: JsonRecord;
  baseType: FieldDataType;
  nullable: boolean;
  isArray: boolean;
  itemSchema: JsonRecord | null;
}

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

export function createDocumentFromJsonSchema(value: JsonValue, name = "Imported JSON Schema"): DocumentModel {
  const schema = isRecord(value) ? value : {};
  const properties = schemaProperties(schema);
  return {
    version: "1.0.0",
    nodes: Object.entries(properties).map(([key, propertySchema]) =>
      schemaToNode(key, asRecord(propertySchema), requiredKeys(schema).has(key)),
    ),
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
      required: false,
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

function valueToNode(key: string, value: JsonValue, nullableHint = false): BuilderNode {
  if (Array.isArray(value)) {
    return arrayToNode(key, value, nullableHint);
  }

  if (isRecord(value)) {
    return {
      id: createId(),
      type: "section",
      label: titleCase(key),
      binding: key,
      value: null,
      children: objectEntries(value).map(([childKey, childValue]) => valueToNode(childKey, childValue)),
      props: {
        dataType: "object",
        nullable: nullableHint,
        isArray: false,
        required: !nullableHint,
      },
    };
  }

  const dataType = inferDataType(value);
  return {
    id: createId(),
    type: nodeTypeForDataType(dataType),
    label: titleCase(key),
    binding: key,
    value: value ?? defaultValueForType(dataType),
    children: [],
    props: {
      dataType,
      nullable: nullableHint || value === null,
      isArray: false,
      required: !nullableHint,
    },
  };
}

function arrayToNode(key: string, value: JsonValue[], nullableHint: boolean): BuilderNode {
  const concreteItems = value.filter((item) => item !== null);
  const hasNull = value.length !== concreteItems.length;
  const objectItems = concreteItems.filter(isRecord);
  if (objectItems.length > 0 && objectItems.length === concreteItems.length) {
    const { merged, nullableKeys } = mergeObjectSamples(objectItems);
    return {
      id: createId(),
      type: "section",
      label: titleCase(key),
      binding: key,
      value: null,
      children: Object.entries(merged).map(([childKey, childValue]) =>
        valueToNode(childKey, childValue, nullableKeys.has(childKey)),
      ),
      props: {
        dataType: "object",
        nullable: nullableHint || hasNull,
        isArray: true,
        required: !nullableHint,
      },
    };
  }

  const sample = concreteItems[0] ?? "";
  const dataType = inferDataType(sample);
  const stringOptions = enumOptions(value);
  return {
    id: createId(),
    type: stringOptions.length > 1 ? "select" : nodeTypeForDataType(dataType),
    label: titleCase(key),
    binding: key,
    value: sample,
    children: [],
    props: {
      dataType,
      nullable: nullableHint || hasNull,
      isArray: true,
      required: !nullableHint,
      ...(stringOptions.length > 1 ? { options: stringOptions } : {}),
    },
  };
}

function mergeObjectSamples(samples: JsonRecord[]) {
  const merged: JsonRecord = {};
  const nullableKeys = new Set<string>();
  const keys = new Set(samples.flatMap((sample) => Object.keys(sample)));

  for (const key of keys) {
    const values = samples.map((sample) => sample[key]).filter((item): item is JsonValue => item !== undefined);
    const missing = values.length < samples.length;
    if (missing || values.some((item) => item === null)) {
      nullableKeys.add(key);
    }
    merged[key] = mergeSampleValues(values);
  }

  return { merged, nullableKeys };
}

function mergeSampleValues(values: JsonValue[]): JsonValue {
  const concreteValues = values.filter((item) => item !== null);
  const objectValues = concreteValues.filter(isRecord);
  if (objectValues.length > 0 && objectValues.length === concreteValues.length) {
    return mergeObjectSamples(objectValues).merged;
  }
  const arrayValues = concreteValues.filter(Array.isArray);
  if (arrayValues.length > 0 && arrayValues.length === concreteValues.length) {
    return arrayValues.flat();
  }
  return concreteValues[0] ?? null;
}

function schemaToNode(key: string, rawSchema: JsonRecord, required: boolean): BuilderNode {
  const info = schemaInfo(rawSchema);
  const schema = info.itemSchema ?? info.schema;
  const properties = schemaProperties(schema);
  const hasChildren = info.baseType === "object" || Object.keys(properties).length > 0;
  const options = enumOptionsFromSchema(schema);
  const type = hasChildren ? "section" : options.length > 0 ? "select" : nodeTypeForDataType(info.baseType);

  return {
    id: createId(),
    type,
    label: titleCase(key),
    binding: key,
    value: defaultValueForType(info.baseType),
    children: hasChildren
      ? Object.entries(properties).map(([childKey, childSchema]) =>
          schemaToNode(childKey, asRecord(childSchema), requiredKeys(schema).has(childKey)),
        )
      : [],
    props: {
      dataType: info.baseType,
      nullable: info.nullable,
      isArray: info.isArray,
      required,
      ...(options.length > 0 ? { options } : {}),
      ...(schemaString(schema, "description") ? { description: schemaString(schema, "description") } : {}),
      ...(schemaString(schema, "$ref") ? { dataType: "custom", customType: refName(schemaString(schema, "$ref")) } : {}),
    },
  };
}

function schemaInfo(schema: JsonRecord): SchemaInfo {
  const types = schemaTypes(schema);
  const nullable = types.includes("null") || anyOfSchemas(schema).some((item) => schemaTypes(item).includes("null"));
  const nonNullType = types.find((type) => type !== "null");
  const isArray = nonNullType === "array" || isRecord(schema.items);
  const itemSchema = isArray ? asRecord(schema.items) : null;
  const baseType = schemaString(schema, "$ref")
    ? "custom"
    : jsonSchemaTypeToDataType(isArray && itemSchema ? schemaTypes(itemSchema).find((type) => type !== "null") : nonNullType);

  return {
    schema,
    baseType,
    nullable,
    isArray,
    itemSchema,
  };
}

function schemaProperties(schema: JsonRecord): Record<string, JsonValue> {
  return isRecord(schema.properties) ? schema.properties : {};
}

function requiredKeys(schema: JsonRecord) {
  return new Set(Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : []);
}

function enumOptionsFromSchema(schema: JsonRecord) {
  return Array.isArray(schema.enum) ? schema.enum.filter((item): item is string => typeof item === "string") : [];
}

function schemaTypes(schema: JsonRecord) {
  if (Array.isArray(schema.type)) {
    return schema.type.filter((item): item is string => typeof item === "string");
  }
  return typeof schema.type === "string" ? [schema.type] : [];
}

function anyOfSchemas(schema: JsonRecord) {
  const choices = [...(Array.isArray(schema.anyOf) ? schema.anyOf : []), ...(Array.isArray(schema.oneOf) ? schema.oneOf : [])];
  return choices.filter(isRecord);
}

function schemaString(schema: JsonRecord, key: string) {
  return typeof schema[key] === "string" ? schema[key] : "";
}

function refName(ref: string) {
  const segments = ref.split("/").filter(Boolean);
  return segments[segments.length - 1] || "CustomType";
}

function objectEntries(value: JsonValue): Array<[string, JsonValue]> {
  return isRecord(value) ? Object.entries(value) : [];
}

function inferDataType(value: JsonValue): FieldDataType {
  if (Array.isArray(value)) {
    return "array";
  }
  if (isRecord(value)) {
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

function jsonSchemaTypeToDataType(type: string | undefined): FieldDataType {
  if (type === "integer" || type === "number") {
    return "number";
  }
  if (type === "boolean") {
    return "boolean";
  }
  if (type === "object") {
    return "object";
  }
  if (type === "array") {
    return "array";
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
  if (dataType === "object") {
    return "section";
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
  if (type === "array") {
    return [];
  }
  if (type === "object" || type === "custom") {
    return null;
  }
  return "New value";
}

function enumOptions(values: JsonValue[]) {
  const strings = values.filter((item): item is string => typeof item === "string");
  const options = [...new Set(strings)];
  return options.length > 1 && options.length <= 12 ? options : [];
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}
