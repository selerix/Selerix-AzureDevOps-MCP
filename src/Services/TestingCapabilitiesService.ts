import { AzureDevOpsConfig } from "../Interfaces/AzureDevOps";
import { AzureDevOpsService } from "./AzureDevOpsService";
import { TestOutcome } from "azure-devops-node-api/interfaces/TestInterfaces";
import {
  RunAutomatedTestsParams,
  GetTestAutomationStatusParams,
  ConfigureTestAgentsParams,
  CreateTestDataGeneratorParams,
  ManageTestEnvironmentsParams,
  GetTestFlakinessParams,
  GetTestGapAnalysisParams,
  RunTestImpactAnalysisParams,
  GetTestHealthDashboardParams,
  RunTestOptimizationParams,
  CreateExploratorySessionsParams,
  RecordExploratoryTestResultsParams,
  ConvertFindingsToWorkItemsParams,
  GetExploratoryTestStatisticsParams
} from "../Interfaces/TestingCapabilities";

export class TestingCapabilitiesService extends AzureDevOpsService {
  constructor(config: AzureDevOpsConfig) {
    super(config);
  }

  async runAutomatedTests(params: RunAutomatedTestsParams) {
    // This would contain actual implementation
    // For now, we're returning a mock response
    return {
      success: true,
      testRunId: 12345,
      message: "Automated tests started successfully",
    };
  }

  async getTestAutomationStatus(params: GetTestAutomationStatusParams) {
    const testApi = await this.connection.getTestApi();
    const run = await testApi.getTestRunById(this.config.project, params.testRunId, true);
    const totalTests = run.totalTests ?? 0;
    const incompleteTests = run.incompleteTests ?? 0;
    const passedTests = run.passedTests ?? 0;

    // Failed results are counted as such. They are not "completed minus passed minus not
    // applicable": a completed result can also be Blocked, Inconclusive, Timeout and so on, and
    // none of those is a failure.
    let outcomes: Record<string, number> | undefined;
    let failedTests: number;
    if (run.runStatistics?.length) {
      outcomes = {};
      for (const stat of run.runStatistics) {
        outcomes[stat.outcome] = (outcomes[stat.outcome] ?? 0) + stat.count;
      }
      failedTests = Object.entries(outcomes)
        .filter(([outcome]) => outcome.toLowerCase() === "failed")
        .reduce((sum, [, count]) => sum + count, 0);
    } else {
      failedTests = await this.countFailedResults(params.testRunId);
    }

    return {
      testRunId: params.testRunId,
      status: run.state,
      completedTests: totalTests - incompleteTests,
      totalTests,
      passedTests,
      failedTests,
      outcomes,
    };
  }

  /** Count a run's Failed results by reading them page by page (when the run carries no statistics). */
  private async countFailedResults(runId: number): Promise<number> {
    const testApi = await this.connection.getTestApi();
    const pageSize = 1000;
    let count = 0;
    for (let page = 0; page < 100; page++) {
      const results = await testApi.getTestResults(
        this.config.project, runId, undefined, page * pageSize, pageSize, [TestOutcome.Failed]
      );
      count += results?.length ?? 0;
      if (!results || results.length < pageSize) {
        break;
      }
    }
    return count;
  }

  async configureTestAgents(params: ConfigureTestAgentsParams) {
    return {
      agentName: params.agentName,
      enabled: params.enabled ?? true,
      capabilities: params.capabilities,
      status: "configured",
    };
  }

  async createTestDataGenerator(params: CreateTestDataGeneratorParams) {
    return {
      generatorId: "gen-123",
      name: params.name,
      recordCount: params.recordCount || 100,
      status: "created",
    };
  }

  async manageTestEnvironments(params: ManageTestEnvironmentsParams) {
    return {
      environmentName: params.environmentName,
      action: params.action,
      status: "success",
      properties: params.properties,
    };
  }

  async getTestFlakiness(params: GetTestFlakinessParams) {
    return {
      flakyTests: [
        { testId: 123, name: "LoginTest", flakinessScore: 0.35, failureCount: 7, totalRuns: 20 },
        { testId: 456, name: "CheckoutTest", flakinessScore: 0.15, failureCount: 3, totalRuns: 20 }
      ],
      timeRange: params.timeRange || "30d",
    };
  }

  async getTestGapAnalysis(params: GetTestGapAnalysisParams) {
    return {
      coverage: 78.5,
      untested: [
        { area: "Authentication", coverage: 65.8, recommendation: "Add tests for password reset" },
        { area: "Checkout", coverage: 82.3, recommendation: "Add tests for promo code validation" }
      ],
      areaPath: params.areaPath,
    };
  }

  async runTestImpactAnalysis(params: RunTestImpactAnalysisParams) {
    return {
      buildId: params.buildId,
      impactedTests: [
        { testId: 123, name: "UserProfileTest", impact: "high" },
        { testId: 456, name: "PaymentGatewayTest", impact: "medium" }
      ],
      totalTests: 150,
      impactedTestCount: 12,
    };
  }

  async getTestHealthDashboard(params: GetTestHealthDashboardParams) {
    return {
      overallHealth: 82.4,
      passRate: 91.5,
      flakiness: 7.2,
      coverage: 78.5,
      executionTime: "3h 24m",
      trends: params.includeTrends ? {
        passRate: [90.2, 89.8, 91.5],
        coverage: [76.2, 77.8, 78.5],
        executionTime: ["3h 45m", "3h 30m", "3h 24m"]
      } : undefined,
    };
  }

  async runTestOptimization(params: RunTestOptimizationParams) {
    return {
      testPlanId: params.testPlanId,
      optimizationGoal: params.optimizationGoal,
      results: {
        originalDuration: "4h 15m",
        optimizedDuration: "2h 45m",
        timeReduction: 35.3,
        prioritizedTests: 45,
        deprioritizedTests: 15,
      },
    };
  }

  async createExploratorySessions(params: CreateExploratorySessionsParams) {
    return {
      sessionId: 789,
      title: params.title,
      description: params.description,
      status: "created",
      createdDate: new Date().toISOString(),
    };
  }

  async recordExploratoryTestResults(params: RecordExploratoryTestResultsParams) {
    return {
      sessionId: params.sessionId,
      recordedFindings: params.findings.length,
      status: "recorded",
      summary: {
        issues: params.findings.length,
        attachments: params.attachments?.length || 0,
      },
    };
  }

  async convertFindingsToWorkItems(params: ConvertFindingsToWorkItemsParams) {
    return {
      sessionId: params.sessionId,
      workItemIds: [1001, 1002, 1003],
      status: "converted",
      workItemType: params.workItemType || "Bug",
    };
  }

  async getExploratoryTestStatistics(params: GetExploratoryTestStatisticsParams) {
    return {
      sessionCount: 24,
      totalFindings: 87,
      convertedToWorkItems: 65,
      timeSpent: "48h 30m",
      findingsPerSession: 3.6,
      timeRange: params.timeRange || "90d",
    };
  }
} 