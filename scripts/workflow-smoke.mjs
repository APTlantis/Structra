import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const scratch = await mkdtemp(join(tmpdir(), "sdb-workflow-smoke-"));

const compile = async (sourcePath, outputName, rewrite = (value) => value) => {
  const source = await readFile(new URL(sourcePath, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const outputPath = join(scratch, outputName);
  await writeFile(outputPath, rewrite(outputText), "utf8");
  return outputPath;
};

const workflowModulePath = await compile("../src/workflowFactory.ts", "workflowFactory.mjs");
const internalModelPath = await compile("../src/internalModel.ts", "internalModel.mjs", (value) =>
  value.replace('from "./workflowFactory";', 'from "./workflowFactory.mjs";'),
);

const workflow = await import(`file:///${workflowModulePath.replace(/\\/g, "/")}`);
const internalModel = await import(`file:///${internalModelPath.replace(/\\/g, "/")}`);

try {
  const base = structuredClone(workflow.initialWorkflow);
  assert.equal(workflow.validateWorkflow(base, "portable").valid, true);

  const portableYaml = workflow.workflowToYaml(base, "portable");
  const portableImport = workflow.importWorkflowYaml(portableYaml);
  assert.equal(portableImport.source, "portable");
  assert.deepEqual(portableImport.workflow.steps.map((step) => step.id), base.steps.map((step) => step.id));

  const githubYaml = workflow.workflowToYaml(base, "github-actions");
  const githubImport = workflow.importWorkflowYaml(githubYaml);
  assert.equal(githubImport.source, "github-actions");
  assert.equal(githubImport.workflow.steps.length, base.steps.length);

  const gitlabYaml = workflow.workflowToYaml(base, "gitlab-ci");
  const gitlabImport = workflow.importWorkflowYaml(gitlabYaml);
  assert.equal(gitlabImport.source, "gitlab-ci");
  assert.equal(gitlabImport.workflow.steps.length, base.steps.length);

  const withGraph = {
    ...base,
    graph: {
      positions: {
        [base.steps[0].id]: { x: 80, y: 120 },
        [base.steps[1].id]: { x: 390, y: 120 },
      },
    },
  };
  assert.deepEqual(workflow.normalizeWorkflow(withGraph)?.graph, withGraph.graph);

  const document = {
    version: "1.0.0",
    nodes: [],
    layout: { kind: "grid", columns: 1 },
    meta: { name: "Smoke Project", format: "json" },
  };
  const project = internalModel.createProjectFile(document, withGraph);
  const loadedProject = internalModel.readProjectFile(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(loadedProject?.workflow?.graph, withGraph.graph);

  const invalidDependency = structuredClone(base);
  invalidDependency.steps[1].needs = ["missing-step"];
  const invalidReport = workflow.validateWorkflow(invalidDependency, "portable");
  assert.equal(invalidReport.valid, false);
  assert.ok(invalidReport.errors.some((error) => error.includes("missing-step")));

  const plan = workflow.buildWorkflowExecutionPlan(base);
  assert.deepEqual(plan.orderedStepIds, ["step-validate", "step-export"]);
  assert.deepEqual(plan.blockedStepIds, []);

  console.log("workflow smoke checks passed");
} finally {
  await rm(scratch, { recursive: true, force: true });
}
