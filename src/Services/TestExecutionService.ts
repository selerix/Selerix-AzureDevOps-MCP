import { AzureDevOpsConfig } from "../Interfaces/AzureDevOps";
import { AzureDevOpsService } from "./AzureDevOpsService";
import { ITestApi } from "azure-devops-node-api/TestApi";
import { ITestPlanApi } from "azure-devops-node-api/TestPlanApi";
import { IReleaseApi } from "azure-devops-node-api/ReleaseApi";
import { IBuildApi } from "azure-devops-node-api/BuildApi";
import { BuildQueryOrder, BuildStatus } from "azure-devops-node-api/interfaces/BuildInterfaces";
import { EnvironmentStatus } from "azure-devops-node-api/interfaces/ReleaseInterfaces";
import {
  GetReleaseDefinitionDetailsParams,
  ListReleaseDefinitionsParams,
  ParsedTestStep,
  ResolvedTestPoint,
  StartedTestResult,
  StartTestRunParams,
} from "../Interfaces/TestExecution";

const HTML_ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
  "&amp;": "&",
};

/** Decode the (possibly double-encoded) HTML ADO stores in step text down to plain text. */
function htmlToText(value: string): string {
  let text = value;
  // Step text is XML-escaped HTML, so one pass of decoding yields tags, a second yields text.
  for (let pass = 0; pass < 2; pass++) {
    text = text.replace(/&(lt|gt|quot|#39|nbsp|amp);/g, (m) => HTML_ENTITIES[m] ?? m);
    if (pass === 0) {
      text = text.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(div|p)>/gi, "\n").replace(/<[^>]+>/g, "");
    }
  }
  return text.replace(/\n{2,}/g, "\n").trim();
}

/**
 * Parse the Microsoft.VSTS.TCM.Steps XML of a test case into steps. Shared-step references
 * (<compref>) are not expanded - their ids are skipped, so recording results against steps
 * inside a shared step set is not supported.
 */
export function parseTestSteps(stepsXml: string | undefined): ParsedTestStep[] {
  if (!stepsXml) {
    return [];
  }
  const steps: ParsedTestStep[] = [];
  const stepRegex = /<step\s+id="(\d+)"\s+type="(ActionStep|ValidateStep)"[^>]*>([\s\S]*?)<\/step>/g;
  let match: RegExpExecArray | null;
  while ((match = stepRegex.exec(stepsXml)) !== null) {
    const strings = [...match[3].matchAll(/<parameterizedString[^>]*>([\s\S]*?)<\/parameterizedString>/g)].map((m) => m[1]);
    const id = parseInt(match[1], 10);
    steps.push({
      id,
      actionPath: id.toString(16).toUpperCase().padStart(8, "0"),
      type: match[2] as ParsedTestStep["type"],
      action: htmlToText(strings[0] ?? ""),
      expectedResult: htmlToText(strings[1] ?? ""),
    });
  }
  return steps;
}

export class TestExecutionService extends AzureDevOpsService {
  constructor(config: AzureDevOpsConfig) {
    super(config);
  }

  protected async getTestApi(): Promise<ITestApi> {
    return await this.connection.getTestApi();
  }

  protected async getTestPlanApi(): Promise<ITestPlanApi> {
    return await this.connection.getTestPlanApi();
  }

  protected async getReleaseApi(): Promise<IReleaseApi> {
    return await this.connection.getReleaseApi();
  }

  protected async getBuildApi(): Promise<IBuildApi> {
    return await this.connection.getBuildApi();
  }

  /**
   * Resolve the test points (test case + configuration pairs) in a plan for the given test
   * cases. When suiteId is omitted each test case's suites are looked up and filtered to the
   * plan. A test case with several configurations yields one point per configuration.
   */
  protected async resolveTestPoints(
    planId: number,
    testCaseIds: number[],
    suiteId?: number
  ): Promise<{ points: ResolvedTestPoint[]; unresolvedTestCaseIds: number[] }> {
    const testPlanApi = await this.getTestPlanApi();

    // suite id -> test cases to look for in that suite
    const bySuite = new Map<number, number[]>();
    if (suiteId !== undefined) {
      bySuite.set(suiteId, [...testCaseIds]);
    } else {
      for (const testCaseId of testCaseIds) {
        const suites = await testPlanApi.getSuitesByTestCaseId(testCaseId);
        for (const suite of suites || []) {
          if (suite.plan?.id === planId && suite.id !== undefined) {
            bySuite.set(suite.id, [...(bySuite.get(suite.id) || []), testCaseId]);
          }
        }
      }
    }

    const points = new Map<number, ResolvedTestPoint>();
    for (const [suite, caseIds] of bySuite) {
      const suitePoints = await testPlanApi.getPointsList(
        this.config.project,
        planId,
        suite,
        undefined,
        caseIds.join(","),
        undefined,
        undefined,
        false,
        false
      );
      for (const point of suitePoints || []) {
        const testCaseId = point.testCaseReference?.id;
        if (point.id !== undefined && testCaseId !== undefined) {
          points.set(point.id, { pointId: point.id, testCaseId, suiteId: suite, planId });
        }
      }
    }

    const resolvedCases = new Set([...points.values()].map((p) => p.testCaseId));
    return {
      points: [...points.values()],
      unresolvedTestCaseIds: testCaseIds.filter((id) => !resolvedCases.has(id)),
    };
  }

  public async listReleaseDefinitions(params: ListReleaseDefinitionsParams) {
    try {
      const releaseApi = await this.getReleaseApi();
      const definitions = await releaseApi.getReleaseDefinitions(
        this.config.project,
        params.searchText,
        undefined,
        undefined,
        undefined,
        params.top
      );
      return (definitions || []).map((d) => ({ id: d.id, name: d.name, path: d.path }));
    } catch (error) {
      console.error("Error listing release definitions:", error);
      throw error;
    }
  }

  public async getReleaseDefinitionDetails(params: GetReleaseDefinitionDetailsParams) {
    try {
      const releaseApi = await this.getReleaseApi();
      const definition = await releaseApi.getReleaseDefinition(this.config.project, params.releaseDefinitionId);
      return {
        id: definition.id,
        name: definition.name,
        stages: (definition.environments || []).map((e) => ({ id: e.id, name: e.name, rank: e.rank })),
        artifacts: (definition.artifacts || []).map((a) => ({
          alias: a.alias,
          type: a.type,
          isPrimary: a.isPrimary,
          buildPipelineId: a.type === "Build" ? Number(a.definitionReference?.definition?.id) || undefined : undefined,
          buildPipelineName: a.definitionReference?.definition?.name,
        })),
      };
    } catch (error) {
      console.error(`Error getting release definition ${params.releaseDefinitionId}:`, error);
      throw error;
    }
  }

  /** Resolve a build id from an explicit id, a build number, or the latest completed build. */
  protected async resolveBuild(pipelineId: number, buildId?: number, buildNumber?: string) {
    const buildApi = await this.getBuildApi();
    if (buildId !== undefined) {
      return await buildApi.getBuild(this.config.project, buildId);
    }
    const builds = await buildApi.getBuilds(
      this.config.project, [pipelineId], undefined, buildNumber, undefined, undefined, undefined, undefined,
      buildNumber ? undefined : BuildStatus.Completed, undefined, undefined, undefined, 1, undefined, undefined,
      undefined, BuildQueryOrder.FinishTimeDescending
    );
    if (!builds || builds.length === 0) {
      throw new Error(
        buildNumber
          ? `Build number ${buildNumber} not found for pipeline ${pipelineId}`
          : `No completed builds found for pipeline ${pipelineId}`
      );
    }
    return builds[0];
  }

  /**
   * Start a test run for one or more test cases.
   *  - manual + webApplication: creates an in-progress run whose results the caller then records.
   *  - automated + releaseStage: creates the run, creates a release from the chosen build with
   *    every stage set to manual, then deploys only the chosen stage.
   */
  public async startTestRun(params: StartTestRunParams) {
    try {
      if (!params.testCaseIds || params.testCaseIds.length === 0) {
        throw new Error("testCaseIds must contain at least one test case id");
      }
      if (params.testType === "manual" && params.runner !== "webApplication") {
        throw new Error("Manual test runs use the 'webApplication' runner");
      }
      if (params.testType === "automated") {
        if (params.runner !== "releaseStage") {
          throw new Error("Automated test runs use the 'releaseStage' runner");
        }
        const missing = (["buildPipelineId", "releasePipelineId", "stageName"] as const).filter((k) => params[k] === undefined);
        if (missing.length > 0) {
          throw new Error(`Automated runs require: ${missing.join(", ")}`);
        }
      }

      const { points, unresolvedTestCaseIds } = await this.resolveTestPoints(params.planId, params.testCaseIds, params.suiteId);
      if (points.length === 0) {
        throw new Error(`No test points found in plan ${params.planId} for test cases ${params.testCaseIds.join(", ")}`);
      }

      const testApi = await this.getTestApi();
      const runName = params.runName || `Run of ${params.testCaseIds.length} test case(s) - ${new Date().toISOString()}`;
      const automated = params.testType === "automated";
      const run = await testApi.createTestRun(
        {
          name: runName,
          plan: { id: String(params.planId) },
          pointIds: points.map((p) => p.pointId),
          automated,
          state: automated ? "NotStarted" : "InProgress",
          configurationIds: [],
        },
        this.config.project
      );

      let release: { id?: number; name?: string; stage: string } | undefined;
      if (automated) {
        release = await this.deployStage(run.id!, params);
      }

      const results = automated ? [] : await testApi.getTestResults(this.config.project, run.id!);
      const pointByCase = new Map(points.map((p) => [p.testCaseId, p.pointId]));
      return {
        runId: run.id,
        runName: run.name,
        runUrl: run.webAccessUrl,
        state: run.state,
        unresolvedTestCaseIds,
        release,
        results: results.map((r) => ({
          resultId: r.id!,
          testCaseId: r.testCase?.id !== undefined ? Number(r.testCase.id) : undefined,
          pointId: pointByCase.get(Number(r.testCase?.id)),
          outcome: r.outcome,
          state: r.state,
        })) as StartedTestResult[],
      };
    } catch (error) {
      console.error("Error starting test run:", error);
      throw error;
    }
  }

  private async deployStage(runId: number, params: StartTestRunParams) {
    const releaseApi = await this.getReleaseApi();
    const definition = await releaseApi.getReleaseDefinition(this.config.project, params.releasePipelineId!);
    const environments = definition.environments || [];
    const stage = environments.find((e) => e.name?.toLowerCase() === params.stageName!.toLowerCase());
    if (!stage || stage.id === undefined) {
      throw new Error(
        `Stage '${params.stageName}' not found in release pipeline ${params.releasePipelineId}. ` +
          `Available stages: ${environments.map((e) => e.name).join(", ")}`
      );
    }

    const artifacts = definition.artifacts || [];
    const artifact = params.artifactAlias
      ? artifacts.find((a) => a.alias === params.artifactAlias)
      : artifacts.find((a) => a.type === "Build" && Number(a.definitionReference?.definition?.id) === params.buildPipelineId) ||
        artifacts.find((a) => a.type === "Build");
    if (!artifact) {
      throw new Error(`No build artifact found on release pipeline ${params.releasePipelineId}`);
    }

    const build = await this.resolveBuild(params.buildPipelineId!, params.buildId, params.buildNumber);
    const variableName = params.runIdVariableName || "test.RunId";

    const release = await releaseApi.createRelease(
      {
        definitionId: params.releasePipelineId,
        description: `Test run ${runId}`,
        artifacts: [{ alias: artifact.alias, instanceReference: { id: String(build.id), name: build.buildNumber } }],
        // Every stage is manual so creating the release deploys nothing; the chosen one is started below.
        manualEnvironments: environments.map((e) => e.name!),
        variables: { [variableName]: { value: String(runId) } },
      },
      this.config.project
    );

    const releaseEnvironment = (release.environments || []).find((e) => e.definitionEnvironmentId === stage.id);
    if (!releaseEnvironment?.id) {
      throw new Error(`Release ${release.id} was created but stage '${params.stageName}' was not found on it`);
    }
    await releaseApi.updateReleaseEnvironment(
      { status: EnvironmentStatus.InProgress, comment: `Started by test run ${runId}` },
      this.config.project,
      release.id!,
      releaseEnvironment.id
    );

    const testApi = await this.getTestApi();
    await testApi.updateTestRun(
      {
        releaseUri: `vstfs:///ReleaseManagement/Release/${release.id}`,
        releaseEnvironmentUri: `vstfs:///ReleaseManagement/Environment/${releaseEnvironment.id}`,
        build: { id: String(build.id) },
      },
      this.config.project,
      runId
    );

    return { id: release.id, name: release.name, stage: stage.name! };
  }

  // __METHODS__
}
