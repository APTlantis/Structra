import type { WorkflowExportTarget, WorkflowModel, WorkflowStep, WorkflowStepKind } from "./types";

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
  return target === "github-actions" ? githubActionsWorkflowToYaml(workflow) : portableWorkflowToYaml(workflow);
}

export function workflowExportFilename(workflow: WorkflowModel, target: WorkflowExportTarget) {
  return target === "github-actions" ? `${slugify(workflow.name || "workflow")}.github-actions.yml` : `${slugify(workflow.name || "workflow")}.workflow.yaml`;
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

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "workflow";
}
