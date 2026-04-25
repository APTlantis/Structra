use quick_xml::escape::escape;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentModel {
    pub version: String,
    pub nodes: Vec<BuilderNode>,
    pub layout: LayoutModel,
    pub meta: DocumentMeta,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutModel {
    pub kind: String,
    pub columns: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentMeta {
    pub name: String,
    pub format: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuilderNode {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: NodeType,
    pub label: String,
    pub binding: String,
    pub value: Value,
    #[serde(default)]
    pub children: Vec<BuilderNode>,
    #[serde(default)]
    pub props: Map<String, Value>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NodeType {
    Text,
    Number,
    Checkbox,
    Select,
    Section,
    Grid,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Json,
    Yaml,
    Toml,
    Xml,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OutputMode {
    Values,
    Schema,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedOutput {
    pub format: ExportFormat,
    pub mode: OutputMode,
    pub content: String,
    pub data: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationReport {
    pub valid: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformError {
    pub message: String,
}

impl From<serde_json::Error> for TransformError {
    fn from(error: serde_json::Error) -> Self {
        Self {
            message: error.to_string(),
        }
    }
}

impl From<serde_yaml::Error> for TransformError {
    fn from(error: serde_yaml::Error) -> Self {
        Self {
            message: error.to_string(),
        }
    }
}

impl From<toml::ser::Error> for TransformError {
    fn from(error: toml::ser::Error) -> Self {
        Self {
            message: error.to_string(),
        }
    }
}

pub fn generate_output(
    document: DocumentModel,
    format: ExportFormat,
    mode: OutputMode,
) -> Result<GeneratedOutput, TransformError> {
    let data = match mode {
        OutputMode::Values => normalize_document(&document),
        OutputMode::Schema => schema_document(&document),
    };
    let content = match format {
        ExportFormat::Json => serde_json::to_string_pretty(&data)?,
        ExportFormat::Yaml => serde_yaml::to_string(&data)?,
        ExportFormat::Toml => toml::to_string_pretty(&data)?,
        ExportFormat::Xml => value_to_xml(
            if matches!(mode, OutputMode::Schema) {
                "schema"
            } else {
                "root"
            },
            &data,
        ),
    };

    Ok(GeneratedOutput {
        format,
        mode,
        content,
        data,
    })
}

pub fn validate_document(document: &DocumentModel) -> ValidationReport {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();

    for node in &document.nodes {
        validate_node(node, None, &mut errors, &mut warnings);
    }

    ValidationReport {
        valid: errors.is_empty(),
        errors,
        warnings,
    }
}

fn validate_node(
    node: &BuilderNode,
    parent_binding: Option<&str>,
    errors: &mut Vec<String>,
    warnings: &mut Vec<String>,
) {
    let binding = node.binding.trim();
    let path = combine_binding(parent_binding, binding);
    let is_container = matches!(node.node_type, NodeType::Section | NodeType::Grid);

    if binding.is_empty() && !is_container {
        warnings.push(format!(
            "{} has no binding and will be skipped.",
            node.label
        ));
    }

    if !binding.is_empty() && !valid_binding(binding) {
        errors.push(format!(
            "{} has an invalid binding: {}",
            node.label, binding
        ));
    }

    validate_node_value(node, path.as_deref().unwrap_or(&node.label), errors);

    for child in &node.children {
        validate_node(child, path.as_deref(), errors, warnings);
    }
}

fn validate_node_value(node: &BuilderNode, path: &str, errors: &mut Vec<String>) {
    if matches!(node.node_type, NodeType::Section | NodeType::Grid) {
        validate_count_constraint(
            node,
            path,
            node.children.len(),
            "minProperties",
            "has fewer properties than",
            errors,
        );
        validate_count_constraint(
            node,
            path,
            node.children.len(),
            "maxProperties",
            "has more properties than",
            errors,
        );
        return;
    }

    let values = if prop_bool(node, "isArray") {
        node.value
            .as_array()
            .cloned()
            .unwrap_or_else(|| vec![node.value.clone()])
    } else {
        vec![node.value.clone()]
    };

    if prop_bool(node, "isArray") {
        validate_count_constraint(
            node,
            path,
            values.len(),
            "minItems",
            "has fewer items than",
            errors,
        );
        validate_count_constraint(
            node,
            path,
            values.len(),
            "maxItems",
            "has more items than",
            errors,
        );
    }

    for value in values {
        validate_scalar_constraints(node, path, &value, errors);
    }
}

fn validate_count_constraint(
    node: &BuilderNode,
    path: &str,
    value: usize,
    key: &str,
    message: &str,
    errors: &mut Vec<String>,
) {
    if let Some(limit) = node.props.get(key).and_then(Value::as_u64) {
        let violated = (key.starts_with("min") && value < limit as usize)
            || (key.starts_with("max") && value > limit as usize);
        if violated {
            errors.push(format!("{path} {message} {limit}."));
        }
    }
}

fn validate_scalar_constraints(
    node: &BuilderNode,
    path: &str,
    value: &Value,
    errors: &mut Vec<String>,
) {
    let data_type = prop_string(node, "dataType").unwrap_or_else(|| {
        match node.node_type {
            NodeType::Text | NodeType::Select => "string",
            NodeType::Number => "number",
            NodeType::Checkbox => "boolean",
            NodeType::Section | NodeType::Grid => "object",
        }
        .to_string()
    });

    if data_type == "string" {
        if let Some(text) = value.as_str() {
            if let Some(min_length) = node.props.get("minLength").and_then(Value::as_u64) {
                if text.chars().count() < min_length as usize {
                    errors.push(format!("{path} is shorter than {min_length} characters."));
                }
            }
            if let Some(max_length) = node.props.get("maxLength").and_then(Value::as_u64) {
                if text.chars().count() > max_length as usize {
                    errors.push(format!("{path} is longer than {max_length} characters."));
                }
            }
            if let Some(pattern) = prop_string(node, "pattern").filter(|value| !value.is_empty()) {
                if !simple_pattern_matches(&pattern, text) {
                    errors.push(format!("{path} does not match pattern {pattern}."));
                }
            }
        }
    }

    if data_type == "number" {
        if let Some(number) = value.as_f64() {
            if let Some(minimum) = node.props.get("minimum").and_then(Value::as_f64) {
                if number < minimum {
                    errors.push(format!("{path} is below minimum {minimum}."));
                }
            }
            if let Some(maximum) = node.props.get("maximum").and_then(Value::as_f64) {
                if number > maximum {
                    errors.push(format!("{path} is above maximum {maximum}."));
                }
            }
        }
    }
}

fn simple_pattern_matches(pattern: &str, text: &str) -> bool {
    if let Some(prefix) = pattern.strip_prefix('^') {
        let prefix = prefix.trim_end_matches('$');
        return text.starts_with(prefix);
    }
    text.contains(pattern.trim_matches('$'))
}

fn normalize_document(document: &DocumentModel) -> Value {
    let mut root = Value::Object(Map::new());
    for node in &document.nodes {
        apply_node(&mut root, node, None);
    }
    root
}

fn schema_document(document: &DocumentModel) -> Value {
    let mut root = Value::Object(Map::new());
    insert_path(
        &mut root,
        &["$schema"],
        Value::String("https://json-schema.org/draft/2020-12/schema".to_string()),
    );
    insert_path(&mut root, &["type"], Value::String("object".to_string()));
    insert_path(&mut root, &["properties"], Value::Object(Map::new()));

    for node in &document.nodes {
        apply_schema_node(&mut root, node, None);
    }

    root
}

fn apply_schema_node(root: &mut Value, node: &BuilderNode, parent_binding: Option<&str>) {
    let binding = node.binding.trim();
    let path = combine_binding(parent_binding, binding);

    match node.node_type {
        NodeType::Section | NodeType::Grid => {
            if let Some(path) = path.as_deref() {
                let segments = split_binding(path);
                insert_schema_path(root, &segments, object_schema_for_node(node));
                if prop_bool(node, "required") {
                    insert_required_path(root, &segments);
                }
            }
            for child in &node.children {
                apply_schema_node(root, child, path.as_deref());
            }
        }
        _ => {
            if let Some(path) = path {
                let segments = split_binding(&path);
                insert_schema_path(root, &segments, schema_for_node(node));
                if prop_bool(node, "required") {
                    insert_required_path(root, &segments);
                }
            }
        }
    }
}

fn object_schema_for_node(node: &BuilderNode) -> Value {
    let mut schema = Map::new();
    schema.insert("type".to_string(), Value::String("object".to_string()));
    schema.insert("properties".to_string(), Value::Object(Map::new()));
    if let Some(description) = prop_string(node, "description").filter(|value| !value.is_empty()) {
        schema.insert("description".to_string(), Value::String(description));
    }
    copy_number_props(node, &mut schema, &["minProperties", "maxProperties"]);
    Value::Object(schema)
}

fn schema_for_node(node: &BuilderNode) -> Value {
    let schema_type = prop_string(node, "dataType").unwrap_or_else(|| {
        match node.node_type {
            NodeType::Text | NodeType::Select => "string",
            NodeType::Number => "number",
            NodeType::Checkbox => "boolean",
            NodeType::Section | NodeType::Grid => "object",
        }
        .to_string()
    });

    let mut schema = Map::new();
    if schema_type == "custom" {
        let custom_type =
            prop_string(node, "customType").unwrap_or_else(|| "CustomType".to_string());
        schema.insert(
            "$ref".to_string(),
            Value::String(format!("#/$defs/{custom_type}")),
        );
    } else {
        schema.insert("type".to_string(), Value::String(schema_type));
    }

    if node.node_type == NodeType::Select {
        if let Some(options) = node.props.get("options").and_then(Value::as_array) {
            schema.insert("enum".to_string(), Value::Array(options.clone()));
        }
    }

    if let Some(description) = prop_string(node, "description").filter(|value| !value.is_empty()) {
        schema.insert("description".to_string(), Value::String(description));
    }

    copy_number_props(
        node,
        &mut schema,
        &["minLength", "maxLength", "minimum", "maximum"],
    );
    if let Some(pattern) = prop_string(node, "pattern").filter(|value| !value.is_empty()) {
        schema.insert("pattern".to_string(), Value::String(pattern));
    }

    let schema = if prop_bool(node, "isArray") {
        let mut array_schema = Map::new();
        array_schema.insert("type".to_string(), Value::String("array".to_string()));
        array_schema.insert("items".to_string(), Value::Object(schema));
        copy_number_props(node, &mut array_schema, &["minItems", "maxItems"]);
        Value::Object(array_schema)
    } else {
        Value::Object(schema)
    };

    nullable_schema(schema, prop_bool(node, "nullable"))
}

fn nullable_schema(mut schema: Value, nullable: bool) -> Value {
    if !nullable {
        return schema;
    }

    if let Value::Object(map) = &mut schema {
        if let Some(Value::String(schema_type)) = map.get("type").cloned() {
            map.insert(
                "type".to_string(),
                Value::Array(vec![
                    Value::String(schema_type),
                    Value::String("null".to_string()),
                ]),
            );
            return schema;
        }
    }

    let mut wrapper = Map::new();
    wrapper.insert(
        "anyOf".to_string(),
        Value::Array(vec![schema, {
            let mut null_schema = Map::new();
            null_schema.insert("type".to_string(), Value::String("null".to_string()));
            Value::Object(null_schema)
        }]),
    );
    Value::Object(wrapper)
}

fn prop_string(node: &BuilderNode, key: &str) -> Option<String> {
    node.props
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn prop_bool(node: &BuilderNode, key: &str) -> bool {
    node.props
        .get(key)
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn copy_number_props(node: &BuilderNode, schema: &mut Map<String, Value>, keys: &[&str]) {
    for key in keys {
        if let Some(prop_value) = node.props.get(*key) {
            if prop_value.as_f64().is_some_and(f64::is_finite) {
                schema.insert((*key).to_string(), prop_value.clone());
            }
        }
    }
}

fn insert_schema_path(root: &mut Value, segments: &[&str], leaf_schema: Value) {
    if segments.is_empty() {
        return;
    }

    let mut current = root;
    for segment in segments.iter().take(segments.len().saturating_sub(1)) {
        current = ensure_schema_property(current, segment, "object");
    }

    if let Some(last) = segments.last() {
        let properties = ensure_properties(current);
        properties.insert((*last).to_string(), leaf_schema);
    }
}

fn ensure_schema_property<'a>(
    current: &'a mut Value,
    key: &str,
    schema_type: &str,
) -> &'a mut Value {
    let properties = ensure_properties(current);
    let entry = properties.entry(key.to_string()).or_insert_with(|| {
        let mut schema = Map::new();
        schema.insert("type".to_string(), Value::String(schema_type.to_string()));
        schema.insert("properties".to_string(), Value::Object(Map::new()));
        Value::Object(schema)
    });

    if entry.get("properties").is_none() {
        if let Value::Object(map) = entry {
            map.insert("properties".to_string(), Value::Object(Map::new()));
        }
    }

    entry
}

fn ensure_properties(value: &mut Value) -> &mut Map<String, Value> {
    if !value.is_object() {
        *value = Value::Object(Map::new());
    }

    let object = value.as_object_mut().expect("object initialized above");
    if !object.contains_key("properties") {
        object.insert("properties".to_string(), Value::Object(Map::new()));
    }

    object
        .get_mut("properties")
        .and_then(Value::as_object_mut)
        .expect("properties initialized above")
}

fn insert_required_path(root: &mut Value, segments: &[&str]) {
    if segments.is_empty() {
        return;
    }

    let mut current = root;
    for segment in segments.iter().take(segments.len().saturating_sub(1)) {
        current = ensure_schema_property(current, segment, "object");
    }

    if let Some(required_key) = segments.last() {
        let object = current
            .as_object_mut()
            .expect("schema object initialized above");
        let required = object
            .entry("required".to_string())
            .or_insert_with(|| Value::Array(Vec::new()));
        if let Some(required) = required.as_array_mut() {
            if !required
                .iter()
                .any(|value| value.as_str() == Some(required_key))
            {
                required.push(Value::String((*required_key).to_string()));
            }
        }
    }
}

fn apply_node(root: &mut Value, node: &BuilderNode, parent_binding: Option<&str>) {
    let binding = node.binding.trim();
    let path = combine_binding(parent_binding, binding);

    match node.node_type {
        NodeType::Section | NodeType::Grid => {
            for child in &node.children {
                apply_node(root, child, path.as_deref());
            }
        }
        _ => {
            if let Some(path) = path {
                insert_path(root, &split_binding(&path), value_for_node(node));
            }
        }
    }
}

fn value_for_node(node: &BuilderNode) -> Value {
    if prop_bool(node, "isArray") && !node.value.is_array() {
        Value::Array(vec![node.value.clone()])
    } else {
        node.value.clone()
    }
}

fn combine_binding(parent: Option<&str>, binding: &str) -> Option<String> {
    match (parent, binding.trim()) {
        (None, "") => None,
        (Some(parent), "") => Some(parent.to_string()),
        (None, binding) => Some(binding.to_string()),
        (Some(parent), binding) => Some(format!("{parent}.{binding}")),
    }
}

fn split_binding(binding: &str) -> Vec<&str> {
    binding
        .split('.')
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .collect()
}

fn valid_binding(binding: &str) -> bool {
    split_binding(binding).iter().all(|segment| {
        segment
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    })
}

fn insert_path(current: &mut Value, segments: &[&str], value: Value) {
    if segments.is_empty() {
        *current = value;
        return;
    }

    let segment = segments[0];
    let final_segment = segments.len() == 1;

    if let Ok(index) = segment.parse::<usize>() {
        if !current.is_array() {
            *current = Value::Array(Vec::new());
        }
        let array = current.as_array_mut().expect("array initialized above");
        while array.len() <= index {
            array.push(Value::Null);
        }
        if final_segment {
            array[index] = value;
        } else {
            if array[index].is_null() {
                array[index] = next_container(segments[1]);
            }
            insert_path(&mut array[index], &segments[1..], value);
        }
        return;
    }

    if !current.is_object() {
        *current = Value::Object(Map::new());
    }
    let object = current.as_object_mut().expect("object initialized above");
    if final_segment {
        object.insert(segment.to_string(), value);
    } else {
        let entry = object
            .entry(segment.to_string())
            .or_insert_with(|| next_container(segments[1]));
        insert_path(entry, &segments[1..], value);
    }
}

fn next_container(next_segment: &str) -> Value {
    if next_segment.parse::<usize>().is_ok() {
        Value::Array(Vec::new())
    } else {
        Value::Object(Map::new())
    }
}

fn value_to_xml(name: &str, value: &Value) -> String {
    match value {
        Value::Object(map) => {
            let inner = map
                .iter()
                .map(|(key, value)| value_to_xml(&xml_name(key), value))
                .collect::<String>();
            format!("<{name}>{inner}</{name}>")
        }
        Value::Array(items) => {
            let inner = items
                .iter()
                .map(|value| value_to_xml("item", value))
                .collect::<String>();
            format!("<{name}>{inner}</{name}>")
        }
        Value::String(text) => format!("<{name}>{}</{name}>", escape(text)),
        Value::Number(number) => format!("<{name}>{number}</{name}>"),
        Value::Bool(boolean) => format!("<{name}>{boolean}</{name}>"),
        Value::Null => format!("<{name} />"),
    }
}

fn xml_name(raw: &str) -> String {
    let mut name = raw
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();

    if name.is_empty() || name.chars().next().is_some_and(|ch| ch.is_ascii_digit()) {
        name.insert(0, '_');
    }

    name
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn node(id: &str, node_type: NodeType, binding: &str, value: Value) -> BuilderNode {
        BuilderNode {
            id: id.to_string(),
            node_type,
            label: id.to_string(),
            binding: binding.to_string(),
            value,
            children: Vec::new(),
            props: Map::new(),
        }
    }

    fn document(nodes: Vec<BuilderNode>) -> DocumentModel {
        DocumentModel {
            version: "1.0.0".to_string(),
            nodes,
            layout: LayoutModel {
                kind: "grid".to_string(),
                columns: 2,
            },
            meta: DocumentMeta {
                name: "Test".to_string(),
                format: "ui-schema".to_string(),
            },
        }
    }

    #[test]
    fn normalizes_flat_scalars() {
        let output = generate_output(
            document(vec![
                node("name", NodeType::Text, "name", json!("Ada")),
                node("age", NodeType::Number, "age", json!(36)),
                node("active", NodeType::Checkbox, "active", json!(true)),
            ]),
            ExportFormat::Json,
            OutputMode::Values,
        )
        .unwrap();

        assert_eq!(output.data["name"], json!("Ada"));
        assert_eq!(output.data["age"], json!(36));
        assert_eq!(output.data["active"], json!(true));
    }

    #[test]
    fn normalizes_nested_bindings_and_sections() {
        let mut section = node("user", NodeType::Section, "user", Value::Null);
        section.children = vec![
            node("email", NodeType::Text, "email", json!("ada@example.com")),
            node("zip", NodeType::Text, "address.zip", json!("10115")),
        ];

        let output = generate_output(
            document(vec![section]),
            ExportFormat::Json,
            OutputMode::Values,
        )
        .unwrap();

        assert_eq!(output.data["user"]["email"], json!("ada@example.com"));
        assert_eq!(output.data["user"]["address"]["zip"], json!("10115"));
    }

    #[test]
    fn normalizes_numeric_segments_as_arrays() {
        let output = generate_output(
            document(vec![
                node("first", NodeType::Text, "hobbies.0", json!("reading")),
                node("second", NodeType::Text, "hobbies.1", json!("painting")),
            ]),
            ExportFormat::Json,
            OutputMode::Values,
        )
        .unwrap();

        assert_eq!(output.data["hobbies"], json!(["reading", "painting"]));
    }

    #[test]
    fn handles_empty_documents() {
        let output =
            generate_output(document(Vec::new()), ExportFormat::Json, OutputMode::Values).unwrap();
        assert_eq!(output.data, json!({}));
    }

    #[test]
    fn serializes_all_formats() {
        let doc = document(vec![node("name", NodeType::Text, "name", json!("Ada"))]);

        assert!(
            generate_output(doc.clone(), ExportFormat::Json, OutputMode::Values)
                .unwrap()
                .content
                .contains("Ada")
        );
        assert!(
            generate_output(doc.clone(), ExportFormat::Yaml, OutputMode::Values)
                .unwrap()
                .content
                .contains("Ada")
        );
        assert!(
            generate_output(doc.clone(), ExportFormat::Toml, OutputMode::Values)
                .unwrap()
                .content
                .contains("Ada")
        );
        assert!(generate_output(doc, ExportFormat::Xml, OutputMode::Values)
            .unwrap()
            .content
            .contains("<name>Ada</name>"));
    }

    #[test]
    fn generates_schema_output() {
        let output = generate_output(
            document(vec![
                node("name", NodeType::Text, "user.name", json!("Ada")),
                node("age", NodeType::Number, "user.age", json!(36)),
            ]),
            ExportFormat::Json,
            OutputMode::Schema,
        )
        .unwrap();

        assert_eq!(
            output.data["$schema"],
            json!("https://json-schema.org/draft/2020-12/schema")
        );
        assert_eq!(output.data["type"], json!("object"));
        assert_eq!(output.data["properties"]["user"]["type"], json!("object"));
        assert_eq!(
            output.data["properties"]["user"]["properties"]["name"]["type"],
            json!("string")
        );
        assert_eq!(
            output.data["properties"]["user"]["properties"]["age"]["type"],
            json!("number")
        );
    }

    #[test]
    fn schema_respects_explicit_type_metadata() {
        let mut field = node("tags", NodeType::Text, "tags", json!("alpha"));
        field.props.insert("dataType".to_string(), json!("string"));
        field.props.insert("isArray".to_string(), json!(true));
        field.props.insert("nullable".to_string(), json!(true));

        let output = generate_output(
            document(vec![field]),
            ExportFormat::Json,
            OutputMode::Schema,
        )
        .unwrap();

        assert_eq!(
            output.data["properties"]["tags"]["type"],
            json!(["array", "null"])
        );
        assert_eq!(
            output.data["properties"]["tags"]["items"]["type"],
            json!("string")
        );
    }

    #[test]
    fn schema_respects_required_and_description_metadata() {
        let mut field = node("id", NodeType::Text, "account.id", json!("acct_1"));
        field.props.insert("required".to_string(), json!(true));
        field.props.insert(
            "description".to_string(),
            json!("Stable account identifier"),
        );

        let output = generate_output(
            document(vec![field]),
            ExportFormat::Json,
            OutputMode::Schema,
        )
        .unwrap();

        assert_eq!(
            output.data["properties"]["account"]["required"],
            json!(["id"])
        );
        assert_eq!(
            output.data["properties"]["account"]["properties"]["id"]["description"],
            json!("Stable account identifier")
        );
    }

    #[test]
    fn schema_respects_validation_constraints() {
        let mut name = node("name", NodeType::Text, "name", json!("Ada"));
        name.props.insert("dataType".to_string(), json!("string"));
        name.props.insert("minLength".to_string(), json!(2));
        name.props.insert("maxLength".to_string(), json!(80));
        name.props
            .insert("pattern".to_string(), json!("^[A-Za-z ]+$"));

        let mut score = node("score", NodeType::Number, "score", json!(5));
        score.props.insert("dataType".to_string(), json!("number"));
        score.props.insert("minimum".to_string(), json!(0));
        score.props.insert("maximum".to_string(), json!(10));

        let mut tags = node("tags", NodeType::Text, "tags", json!("alpha"));
        tags.props.insert("dataType".to_string(), json!("string"));
        tags.props.insert("isArray".to_string(), json!(true));
        tags.props.insert("minItems".to_string(), json!(1));
        tags.props.insert("maxItems".to_string(), json!(4));

        let output = generate_output(
            document(vec![name, score, tags]),
            ExportFormat::Json,
            OutputMode::Schema,
        )
        .unwrap();

        assert_eq!(output.data["properties"]["name"]["minLength"], json!(2));
        assert_eq!(output.data["properties"]["name"]["maxLength"], json!(80));
        assert_eq!(
            output.data["properties"]["name"]["pattern"],
            json!("^[A-Za-z ]+$")
        );
        assert_eq!(output.data["properties"]["score"]["minimum"], json!(0));
        assert_eq!(output.data["properties"]["score"]["maximum"], json!(10));
        assert_eq!(output.data["properties"]["tags"]["minItems"], json!(1));
        assert_eq!(output.data["properties"]["tags"]["maxItems"], json!(4));
    }

    #[test]
    fn validates_values_against_constraints() {
        let mut name = node("name", NodeType::Text, "name", json!("A"));
        name.props.insert("dataType".to_string(), json!("string"));
        name.props.insert("minLength".to_string(), json!(2));
        name.props.insert("pattern".to_string(), json!("^acct_"));

        let mut score = node("score", NodeType::Number, "score", json!(11));
        score.props.insert("dataType".to_string(), json!("number"));
        score.props.insert("maximum".to_string(), json!(10));

        let mut tags = node("tags", NodeType::Text, "tags", json!(["one", "two"]));
        tags.props.insert("dataType".to_string(), json!("string"));
        tags.props.insert("isArray".to_string(), json!(true));
        tags.props.insert("maxItems".to_string(), json!(1));

        let report = validate_document(&document(vec![name, score, tags]));

        assert!(!report.valid);
        assert!(report
            .errors
            .iter()
            .any(|error| error.contains("shorter than 2")));
        assert!(report
            .errors
            .iter()
            .any(|error| error.contains("above maximum 10")));
        assert!(report
            .errors
            .iter()
            .any(|error| error.contains("more items than 1")));
    }
}
