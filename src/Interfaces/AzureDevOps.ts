import { EntraAuthHandler } from "../Services/EntraAuthHandler";

/**
 * Defines the possible authentication types for Azure DevOps.
 */
export type AzureDevOpsAuthType = 'pat' | 'ntlm' | 'basic' | 'entra';

/**
 * Configuration for Personal Access Token (PAT) authentication.
 */
export interface PatAuth {
  type: 'pat';
}

/**
 * Configuration for NTLM authentication.
 */
export interface NtlmAuth {
  type: 'ntlm';
  username: string;
  password: string;
  domain?: string;
}

/**
 * Configuration for Basic authentication.
 */
export interface BasicAuth {
  type: 'basic';
  username: string;
  password: string;
}

/**
 * Configuration for Azure Identity (Entra/DefaultAzureCredential) authentication.
 */
export interface AzureIdentityAuth {
  type: 'entra';
}

/**
 * Union type for all possible Azure DevOps authentication configurations.
 */
export type AzureDevOpsAuthConfig = PatAuth | NtlmAuth | BasicAuth | AzureIdentityAuth;

/**
 * Interface for Azure DevOps configuration
 */
export interface AzureDevOpsConfig {
  orgUrl: string;
  project: string;
  personalAccessToken: string;
  isOnPremises?: boolean;
  collection?: string; // Collection name for on-premises
  apiVersion?: string; // API version for on-premises
  auth?: AzureDevOpsAuthConfig; // Updated to use the new union type
  entraAuthHandler?: EntraAuthHandler;
  /**
   * Folders the test execution tools may read attachments from and save them to. When not set, the
   * working directory and the system temp folder; ["*"] lifts the folder limit. Credential and key
   * files are refused either way.
   */
  fileAccessDirs?: string[];
}

/**
 * Interface for work item query parameters
 */
export interface WorkItemQueryParams {
  query: string;
}

/**
 * Interface for the raw work item response from Azure DevOps
 */
export interface RawWorkItemResponse {
  workItems: any[]; // Using any for flexibility, can be typed more specifically
  count: number;
}

/**
 * Interface for formatted work item response suitable for MCP
 */
export interface WorkItemResponse {
  content: Array<{
    type: "text";
    text: string;
  }>;
  workItems?: any[]; // Optional raw data if needed
  isError?: boolean;
}
