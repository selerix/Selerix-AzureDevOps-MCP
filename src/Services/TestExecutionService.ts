import { AzureDevOpsConfig } from "../Interfaces/AzureDevOps";
import { AzureDevOpsService } from "./AzureDevOpsService";
import { ITestApi } from "azure-devops-node-api/TestApi";
import { ITestPlanApi } from "azure-devops-node-api/TestPlanApi";
import { IReleaseApi } from "azure-devops-node-api/ReleaseApi";
import { IBuildApi } from "azure-devops-node-api/BuildApi";
import { ParsedTestStep, ResolvedTestPoint } from "../Interfaces/TestExecution";

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

  // __METHODS__
}
