import type {
  ValidationReport,
  WorkflowExportTarget,
  WorkflowImportResult,
  WorkflowModel,
  WorkflowStep,
  WorkflowStepKind,
  WorkflowTemplate,
  WorkflowTrigger,
} from "./types";

const createId = () => `step-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const initialWorkflow: WorkflowModel = {
  version: "1.0.0",
  name: "Schema Validation Pipeline",
  trigger: "manual",
  schedule: "0 9 * * 1",
  runsOn: "ubuntu-latest",
  steps: [
    {
      id: "step-validate",
      name: "Validate structured payload",
      kind: "run",
      command: "sdb validate --schema schema.json --input payload.json",
      uses: "",
      needs: [],
      env: {
        SDB_MODE: "schema",
      },
    },
    {
      id: "step-export",
      name: "Export workflow artifact",
      kind: "run",
      command: "sdb export --format yaml --out workflow.yaml",
      uses: "",
      needs: ["step-validate"],
      env: {},
    },
  ],
};

export const workflowTemplates: WorkflowTemplate[] = [
  {
    name: "Schema Validation",
    description: "Validate a payload against the generated JSON Schema.",
    workflow: initialWorkflow,
  },
  {
    name: "Multi-format Export",
    description: "Generate JSON, YAML, TOML, and XML artifacts from the current model.",
    workflow: {
      version: "1.0.0",
      name: "Multi-format Export Pipeline",
      trigger: "manual",
      schedule: initialWorkflow.schedule,
      runsOn: "ubuntu-latest",
      steps: [
        {
          id: "step-export-json",
          name: "Export JSON",
          kind: "run",
          command: "sdb export --format json --out dist/payload.json",
          uses: "",
          needs: [],
          env: {},
        },
        {
          id: "step-export-yaml",
          name: "Export YAML",
          kind: "run",
          command: "sdb export --format yaml --out dist/payload.yaml",
          uses: "",
          needs: ["step-export-json"],
          env: {},
        },
        {
          id: "step-export-toml",
          name: "Export TOML",
          kind: "run",
          command: "sdb export --format toml --out dist/payload.toml",
          uses: "",
          needs: ["step-export-json"],
          env: {},
        },
        {
          id: "step-export-xml",
          name: "Export XML",
          kind: "run",
          command: "sdb export --format xml --out dist/payload.xml",
          uses: "",
          needs: ["step-export-json"],
          env: {},
        },
      ],
    },
  },
  {
    name: "API Contract Check",
    description: "Build schema, validate examples, and publish contract artifacts.",
    workflow: {
      version: "1.0.0",
      name: "API Contract Check",
      trigger: "push",
      schedule: initialWorkflow.schedule,
      runsOn: "ubuntu-latest",
      steps: [
        {
          id: "step-checkout",
          name: "Checkout repository",
          kind: "uses",
          command: "",
          uses: "actions/checkout@v4",
          needs: [],
          env: {},
        },
        {
          id: "step-build-schema",
          name: "Build JSON Schema",
          kind: "run",
          command: "sdb export --mode schema --format json --out contract/schema.json",
          uses: "",
          needs: ["step-checkout"],
          env: {},
        },
        {
          id: "step-validate-examples",
          name: "Validate example payloads",
          kind: "run",
          command: "sdb validate --schema contract/schema.json --input examples/*.json",
          uses: "",
          needs: ["step-build-schema"],
          env: {},
        },
      ],
    },
  },
  {
    name: "Docs Artifact",
    description: "Generate schema and docs outputs for publishing.",
    workflow: {
      version: "1.0.0",
      name: "Docs Artifact Pipeline",
      trigger: "manual",
      schedule: initialWorkflow.schedule,
      runsOn: "ubuntu-latest",
      steps: [
        {
          id: "step-generate-schema",
          name: "Generate schema",
          kind: "run",
          command: "sdb export --mode schema --format json --out docs/schema.json",
          uses: "",
          needs: [],
          env: {},
        },
        {
          id: "step-generate-docs",
          name: "Generate docs",
          kind: "run",
          command: "sdb docs --schema docs/schema.json --out docs/structured-data.md",
          uses: "",
          needs: ["step-generate-schema"],
          env: {},
        },
        {
          id: "step-review-gate",
          name: "Review generated docs",
          kind: "approval",
          command: "Review docs/structured-data.md before publishing.",
          uses: "",
          needs: ["step-generate-docs"],
          env: {},
        },
      ],
    },
  },
];

export function createWorkflowStep(kind: WorkflowStepKind): WorkflowStep {
  const defaults: Record<WorkflowStepKind, Omit<WorkflowStep, "id">> = {
    run: {
      name: "Run command",
      kind: "run",
      command: "echo \"Run step\"",
      uses: "",
      needs: [],
      env: {},
    },
    uses: {
      name: "Use action",
      kind: "uses",
      command: "",
      uses: "actions/checkout@v4",
      needs: [],
      env: {},
    },
    approval: {
      name: "Approval gate",
      kind: "approval",
      command: "manual approval required",
      uses: "",
      needs: [],
      env: {},
    },
  };

  return {
    id: createId(),
    ...defaults[kind],
  };
}

export function workflowToYaml(workflow: WorkflowModel, target: WorkflowExportTarget = "portable") {
  if (target === "github-actions") {
    return githubActionsWorkflowToYaml(workflow);
  }
  if (target === "gitlab-ci") {
    return gitlabCiWorkflowToYaml(workflow);
  }
  return portableWorkflowToYaml(workflow);
}

export function workflowExportFilename(workflow: WorkflowModel, target: WorkflowExportTarget) {
  if (target === "github-actions") {
    return `${slugify(workflow.name || "workflow")}.github-actions.yml`;
  }
  if (target === "gitlab-ci") {
    return `${slugify(workflow.name || "workflow")}.gitlab-ci.yml`;
  }
  return `${slugify(workflow.name || "workflow")}.workflow.yaml`;
}

export function normalizeWorkflow(value: unknown): WorkflowModel | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const workflow = value as Partial<WorkflowModel>;
  if (
    typeof workflow.version !== "string" ||
    typeof workflow.name !== "string" ||
    !isWorkflowTrigger(workflow.trigger) ||
    typeof workflow.runsOn !== "string" ||
    !Array.isArray(workflow.steps)
  ) {
    return null;
  }

  const steps = workflow.steps.map(normalizeWorkflowStep).filter((step): step is WorkflowStep => Boolean(step));
  return {
    version: workflow.version,
    name: workflow.name,
    trigger: workflow.trigger,
    schedule: typeof workflow.schedule === "string" ? workflow.schedule : initialWorkflow.schedule,
    runsOn: workflow.runsOn,
    steps,
  };
}

export function importWorkflowYaml(text: string): WorkflowImportResult {
  const parsed = parseYamlLike(text);
  if (!isRecord(parsed)) {
    throw new Error("Workflow YAML must be a mapping.");
  }

  if (isRecord(parsed.workflow)) {
    return {
      workflow: fromPortableWorkflow(parsed.workflow),
      source: "portable",
      warnings: [],
    };
  }

  return fromGithubActionsWorkflow(parsed);
}

export function validateWorkflow(workflow: WorkflowModel, target: WorkflowExportTarget): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  const duplicateNames = new Set<string>();

  if (!workflow.name.trim()) {
    warnings.push("Workflow has no name.");
  }
  if (!workflow.runsOn.trim()) {
    errors.push("Workflow runtime is required.");
  }
  if (workflow.trigger === "schedule" && !workflow.schedule.trim()) {
    errors.push("Scheduled workflow needs a cron expression.");
  }
  if (workflow.steps.length === 0) {
    warnings.push("Workflow has no steps yet.");
  }

  for (const step of workflow.steps) {
    const label = step.name.trim() || step.id;
    if (ids.has(step.id)) {
      errors.push(`Duplicate step id: ${step.id}.`);
    }
    ids.add(step.id);

    if (!step.name.trim()) {
      warnings.push(`${step.id} has no display name.`);
    } else if (names.has(step.name.trim())) {
      duplicateNames.add(step.name.trim());
    }
    names.add(step.name.trim());

    if (step.kind === "uses" && !step.uses.trim()) {
      errors.push(`${label} is a uses step without an action reference.`);
    }
    if (step.kind !== "uses" && !step.command.trim()) {
      errors.push(`${label} has no command or gate note.`);
    }
    for (const dependency of step.needs) {
      if (dependency === step.id) {
        errors.push(`${label} depends on itself.`);
      } else if (!workflow.steps.some((candidate) => candidate.id === dependency)) {
        errors.push(`${label} depends on missing step ${dependency}.`);
      }
    }
  }

  const cycle = findWorkflowCycle(workflow);
  if (cycle.length > 0) {
    errors.push(`Workflow has a circular dependency: ${cycle.join(" -> ")}.`);
  }

  duplicateNames.forEach((name) => warnings.push(`Duplicate step name: ${name}.`));

  if (target === "github-actions") {
    if (workflow.steps.some((step) => step.needs.length > 0)) {
      warnings.push("GitHub Actions export keeps steps sequential and does not emit step-level dependencies.");
    }
    if (workflow.steps.some((step) => step.kind === "approval")) {
      warnings.push("Approval gates export as echo steps until environment approvals are modeled.");
    }
  }
  if (target === "gitlab-ci") {
    if (workflow.steps.some((step) => step.kind === "uses")) {
      warnings.push("GitLab CI export converts action references into echo script placeholders.");
    }
    if (workflow.steps.some((step) => step.kind === "approval")) {
      warnings.push("Approval gates export as manual GitLab jobs.");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
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
      return [...stack.slice(start), id];
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

function portableWorkflowToYaml(workflow: WorkflowModel) {
  return toYaml({
    workflow: {
      version: workflow.version,
      name: workflow.name,
      trigger:
        workflow.trigger === "schedule"
          ? {
              type: workflow.trigger,
              cron: workflow.schedule,
            }
          : workflow.trigger,
      runs_on: workflow.runsOn,
      steps: workflow.steps.map((step) => ({
        id: step.id,
        name: step.name,
        type: step.kind,
        ...(step.needs.length > 0 ? { needs: step.needs } : {}),
        ...(step.kind === "uses" ? { uses: step.uses } : { run: step.command }),
        ...(Object.keys(step.env).length > 0 ? { env: step.env } : {}),
      })),
    },
  });
}

function githubActionsWorkflowToYaml(workflow: WorkflowModel) {
  return toYaml({
    name: workflow.name,
    on: githubTrigger(workflow),
    jobs: {
      workflow: {
        "runs-on": workflow.runsOn,
        steps: workflow.steps.map((step) => ({
          name: step.name,
          ...(step.kind === "uses" ? { uses: step.uses } : { run: step.kind === "approval" ? `echo ${JSON.stringify(step.command)}` : step.command }),
          ...(Object.keys(step.env).length > 0 ? { env: step.env } : {}),
        })),
      },
    },
  });
}

function gitlabCiWorkflowToYaml(workflow: WorkflowModel) {
  const stages = workflow.steps.map((step) => gitlabJobName(step.id));
  return toYaml({
    stages,
    ...Object.fromEntries(
      workflow.steps.map((step) => [
        gitlabJobName(step.id),
        {
          stage: gitlabJobName(step.id),
          ...(workflow.runsOn.trim() ? { tags: [workflow.runsOn] } : {}),
          ...(step.needs.length > 0 ? { needs: step.needs.map(gitlabJobName) } : {}),
          script: gitlabScript(step),
          ...(Object.keys(step.env).length > 0 ? { variables: step.env } : {}),
          ...(step.kind === "approval" ? { when: "manual", allow_failure: false } : {}),
        },
      ]),
    ),
  });
}

function gitlabJobName(value: string) {
  return slugify(value).replace(/-/g, "_");
}

function gitlabScript(step: WorkflowStep) {
  if (step.kind === "uses") {
    return [`echo "Action reference: ${step.uses}"`];
  }
  if (step.kind === "approval") {
    return [`echo ${JSON.stringify(step.command)}`];
  }
  return step.command
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function githubTrigger(workflow: WorkflowModel): string | Record<string, YamlValue> {
  if (workflow.trigger === "push") {
    return "push";
  }
  if (workflow.trigger === "schedule") {
    return {
      schedule: [
        {
          cron: workflow.schedule,
        },
      ],
    };
  }
  return "workflow_dispatch";
}

function fromPortableWorkflow(value: Record<string, unknown>): WorkflowModel {
  const trigger = normalizePortableTrigger(value.trigger);
  const usedIds = new Set<string>();
  const steps = Array.isArray(value.steps) ? value.steps.map((step, index) => portableStep(step, index, usedIds)) : [];
  return {
    version: readString(value.version, initialWorkflow.version),
    name: readString(value.name, "Imported Workflow"),
    trigger: trigger.trigger,
    schedule: trigger.schedule,
    runsOn: readString(value.runs_on, readString(value.runsOn, initialWorkflow.runsOn)),
    steps,
  };
}

function fromGithubActionsWorkflow(value: Record<string, unknown>): WorkflowImportResult {
  const warnings: string[] = [];
  const trigger = normalizeGithubTrigger(value.on);
  const jobs = isRecord(value.jobs) ? value.jobs : {};
  const [jobName, jobValue] = Object.entries(jobs)[0] ?? [];
  if (!jobName || !isRecord(jobValue)) {
    throw new Error("GitHub Actions workflow must contain at least one job.");
  }
  if (Object.keys(jobs).length > 1) {
    warnings.push("Imported the first GitHub Actions job only; multi-job graph import is not modeled yet.");
  }

  const rawSteps = Array.isArray(jobValue.steps) ? jobValue.steps : [];
  const usedIds = new Set<string>();
  const steps = rawSteps.map((step, index) => githubStep(step, index, usedIds));

  return {
    source: "github-actions",
    warnings,
    workflow: {
      version: initialWorkflow.version,
      name: readString(value.name, "Imported GitHub Actions Workflow"),
      trigger: trigger.trigger,
      schedule: trigger.schedule,
      runsOn: readString(jobValue["runs-on"], initialWorkflow.runsOn),
      steps,
    },
  };
}

function portableStep(value: unknown, index: number, usedIds: Set<string>): WorkflowStep {
  const step = isRecord(value) ? value : {};
  const kind = isWorkflowStepKind(step.type) ? step.type : isWorkflowStepKind(step.kind) ? step.kind : step.uses ? "uses" : "run";
  return {
    id: uniqueStepId(readString(step.id, readString(step.name, `step-${index + 1}`)), index, usedIds),
    name: readString(step.name, `Step ${index + 1}`),
    kind,
    command: readString(step.run, readString(step.command, "")),
    uses: readString(step.uses, ""),
    needs: normalizeStringList(step.needs),
    env: isStringRecord(step.env) ? step.env : {},
  };
}

function githubStep(value: unknown, index: number, usedIds: Set<string>): WorkflowStep {
  const step = isRecord(value) ? value : {};
  const actionRef = typeof step.uses === "string" ? step.uses : "";
  const hasUses = actionRef.trim().length > 0;
  const name = readString(step.name, hasUses ? actionRef : `Step ${index + 1}`);
  return {
    id: uniqueStepId(name, index, usedIds),
    name,
    kind: hasUses ? "uses" : "run",
    command: readString(step.run, ""),
    uses: actionRef,
    needs: [],
    env: isStringRecord(step.env) ? step.env : {},
  };
}

function normalizePortableTrigger(value: unknown): { trigger: WorkflowTrigger; schedule: string } {
  if (isRecord(value) && value.type === "schedule") {
    return { trigger: "schedule", schedule: readString(value.cron, initialWorkflow.schedule) };
  }
  if (value === "push" || value === "schedule" || value === "manual") {
    return { trigger: value, schedule: initialWorkflow.schedule };
  }
  return { trigger: "manual", schedule: initialWorkflow.schedule };
}

function normalizeGithubTrigger(value: unknown): { trigger: WorkflowTrigger; schedule: string } {
  if (value === "push") {
    return { trigger: "push", schedule: initialWorkflow.schedule };
  }
  if (isRecord(value)) {
    if (value.push !== undefined) {
      return { trigger: "push", schedule: initialWorkflow.schedule };
    }
    if (Array.isArray(value.schedule)) {
      const first = value.schedule.find(isRecord);
      return { trigger: "schedule", schedule: first ? readString(first.cron, initialWorkflow.schedule) : initialWorkflow.schedule };
    }
  }
  return { trigger: "manual", schedule: initialWorkflow.schedule };
}

function parseYamlLike(text: string): unknown {
  const lines = text
    .replace(/\t/g, "  ")
    .split(/\r?\n/)
    .map((raw) => ({ indent: raw.match(/^ */)?.[0].length ?? 0, text: stripYamlComment(raw).trim() }))
    .filter((line) => line.text.length > 0);
  if (lines.length === 0) {
    throw new Error("Workflow YAML is empty.");
  }
  const [value] = parseBlock(lines, 0, lines[0].indent);
  return value;
}

function parseBlock(lines: Array<{ indent: number; text: string }>, start: number, indent: number): [unknown, number] {
  if (lines[start]?.text.startsWith("-")) {
    return parseList(lines, start, indent);
  }
  return parseMap(lines, start, indent);
}

function parseMap(lines: Array<{ indent: number; text: string }>, start: number, indent: number): [Record<string, unknown>, number] {
  const output: Record<string, unknown> = {};
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent || line.indent > indent || line.text.startsWith("-")) {
      break;
    }
    const pair = splitYamlPair(line.text);
    if (!pair) {
      index += 1;
      continue;
    }
    const [key, rawValue] = pair;
    if (rawValue === "") {
      if (index + 1 < lines.length && lines[index + 1].indent > line.indent) {
        const [child, next] = parseBlock(lines, index + 1, lines[index + 1].indent);
        output[key] = child;
        index = next;
      } else {
        output[key] = null;
        index += 1;
      }
    } else {
      output[key] = parseYamlScalar(rawValue);
      index += 1;
    }
  }
  return [output, index];
}

function parseList(lines: Array<{ indent: number; text: string }>, start: number, indent: number): [unknown[], number] {
  const output: unknown[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (line.indent !== indent || !line.text.startsWith("-")) {
      break;
    }
    const rawValue = line.text.slice(1).trim();
    if (rawValue === "") {
      if (index + 1 < lines.length && lines[index + 1].indent > line.indent) {
        const [child, next] = parseBlock(lines, index + 1, lines[index + 1].indent);
        output.push(child);
        index = next;
      } else {
        output.push(null);
        index += 1;
      }
      continue;
    }

    const pair = splitYamlPair(rawValue);
    if (pair) {
      const item: Record<string, unknown> = { [pair[0]]: pair[1] === "" ? null : parseYamlScalar(pair[1]) };
      let next = index + 1;
      if (next < lines.length && lines[next].indent > line.indent) {
        const [child, childNext] = parseMap(lines, next, lines[next].indent);
        Object.assign(item, child);
        next = childNext;
      }
      output.push(item);
      index = next;
    } else {
      output.push(parseYamlScalar(rawValue));
      index += 1;
    }
  }
  return [output, index];
}

function splitYamlPair(value: string): [string, string] | null {
  let quoted: string | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === "\"" || char === "'") && value[index - 1] !== "\\") {
      quoted = quoted === char ? null : quoted ?? char;
    }
    if (char === ":" && !quoted) {
      return [value.slice(0, index).trim(), value.slice(index + 1).trim()];
    }
  }
  return null;
}

function parseYamlScalar(value: string): unknown {
  if (value === "null" || value === "~") {
    return null;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    try {
      return value.startsWith("\"") ? JSON.parse(value) : value.slice(1, -1).replace(/''/g, "'");
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    return inner ? inner.split(",").map((item) => parseYamlScalar(item.trim())) : [];
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}

function stripYamlComment(value: string) {
  let quoted: string | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === "\"" || char === "'") && value[index - 1] !== "\\") {
      quoted = quoted === char ? null : quoted ?? char;
    }
    if (char === "#" && !quoted && (index === 0 || /\s/.test(value[index - 1]))) {
      return value.slice(0, index);
    }
  }
  return value;
}

function readString(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function normalizeStringList(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

function uniqueStepId(value: string, index: number, usedIds: Set<string>) {
  const base = slugify(value || `step-${index + 1}`);
  const prefix = base.startsWith("step-") ? base : `step-${base}`;
  let candidate = prefix;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${prefix}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

export function envFromText(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((env, line) => {
      const [key, ...rest] = line.split("=");
      if (key.trim()) {
        env[key.trim()] = rest.join("=").trim();
      }
      return env;
    }, {});
}

export function envToText(env: Record<string, string>) {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue };

function toYaml(value: YamlValue, indent = 0): string {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    return value
      .map((item) => {
        if (isScalar(item)) {
          return `${pad}- ${scalar(item)}`;
        }
        return `${pad}-\n${toYaml(item, indent + 2)}`;
      })
      .join("\n");
  }

  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([key, item]) => {
        if (isScalar(item)) {
          return `${pad}${key}: ${scalar(item)}`;
        }
        return `${pad}${key}:\n${toYaml(item, indent + 2)}`;
      })
      .join("\n");
  }

  return `${pad}${scalar(value)}`;
}

function isScalar(value: YamlValue) {
  return value === null || typeof value !== "object";
}

function scalar(value: YamlValue) {
  if (typeof value === "string") {
    return value === "" || /[:#\n[\]{},&*?|-]|^\s|\s$/.test(value) ? JSON.stringify(value) : value;
  }
  return String(value);
}

function normalizeWorkflowStep(value: unknown): WorkflowStep | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const step = value as Partial<WorkflowStep>;
  if (typeof step.id !== "string" || typeof step.name !== "string" || !isWorkflowStepKind(step.kind)) {
    return null;
  }
  return {
    id: step.id,
    name: step.name,
    kind: step.kind,
    command: typeof step.command === "string" ? step.command : "",
    uses: typeof step.uses === "string" ? step.uses : "",
    needs: Array.isArray(step.needs) ? step.needs.filter((item): item is string => typeof item === "string") : [],
    env: isStringRecord(step.env) ? step.env : {},
  };
}

function isWorkflowTrigger(value: unknown): value is WorkflowModel["trigger"] {
  return value === "manual" || value === "push" || value === "schedule";
}

function isWorkflowStepKind(value: unknown): value is WorkflowStepKind {
  return value === "run" || value === "uses" || value === "approval";
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "workflow";
}
