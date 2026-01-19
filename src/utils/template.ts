/**
 * Template Engine for Agent Trigger System
 * Interpolates prompt templates with variables extracted from webhook/API payloads
 */

import { JSONPath } from 'jsonpath-plus';

export interface PayloadMapping {
  [variableName: string]: string; // JSONPath expression
}

/**
 * Interpolates prompt template with variables extracted from payload
 *
 * @param template - Prompt with {{variable}} placeholders
 * @param payload - Event data from webhook/API
 * @param mapping - Variable name → JSONPath mappings
 * @returns Interpolated prompt ready for agent execution
 *
 * @example
 * const template = "Process GitHub issue #{{issueNumber}}: {{issueTitle}}";
 * const payload = { issue: { number: 123, title: "Bug in upload" } };
 * const mapping = {
 *   issueNumber: "$.issue.number",
 *   issueTitle: "$.issue.title"
 * };
 * const result = interpolatePrompt(template, payload, mapping);
 * // => "Process GitHub issue #123: Bug in upload"
 */
export function interpolatePrompt(
  template: string,
  payload: any,
  mapping: PayloadMapping,
): string {
  const variables: Record<string, any> = {};

  // Extract variables from payload using JSONPath
  for (const [varName, jsonPath] of Object.entries(mapping)) {
    try {
      const result = JSONPath({ json: payload, path: jsonPath });
      variables[varName] = result[0] ?? null;
    } catch (error) {
      console.warn(`Failed to extract ${varName} from payload using ${jsonPath}:`, error);
      variables[varName] = null;
    }
  }

  // Replace {{variable}} placeholders
  return template.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
    const value = variables[varName];

    if (value === null || value === undefined) {
      return match; // Keep placeholder if not found
    }

    // Handle different types
    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2);
    }

    return String(value);
  });
}

/**
 * Validates JSONPath expression
 *
 * @param jsonPath - JSONPath expression to validate
 * @param samplePayload - Optional sample payload to test against
 * @returns true if valid, false otherwise
 */
export function validateJsonPath(jsonPath: string, samplePayload?: any): boolean {
  try {
    if (samplePayload) {
      JSONPath({ json: samplePayload, path: jsonPath });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Extracts all variable placeholders from a template
 *
 * @param template - Template string with {{variable}} placeholders
 * @returns Array of variable names found in template
 *
 * @example
 * extractVariables("Process {{type}} #{{number}}: {{title}}")
 * // => ["type", "number", "title"]
 */
export function extractVariables(template: string): string[] {
  const regex = /\{\{(\w+)\}\}/g;
  const variables: string[] = [];
  let match;

  while ((match = regex.exec(template)) !== null) {
    variables.push(match[1]);
  }

  return [...new Set(variables)]; // Remove duplicates
}

/**
 * Tests a payload mapping against a sample payload
 *
 * @param template - Template with {{variables}}
 * @param payload - Sample payload to test
 * @param mapping - Variable mappings to test
 * @returns Object with test results
 */
export function testPayloadMapping(
  template: string,
  payload: any,
  mapping: PayloadMapping,
): {
  success: boolean;
  result: string;
  variables: Record<string, { value: any; extracted: boolean }>;
  errors: string[];
} {
  const variables: Record<string, { value: any; extracted: boolean }> = {};
  const errors: string[] = [];

  // Extract variables
  for (const [varName, jsonPath] of Object.entries(mapping)) {
    try {
      const result = JSONPath({ json: payload, path: jsonPath });
      const value = result[0] ?? null;
      variables[varName] = {
        extracted: value !== null,
        value,
      };

      if (value === null) {
        errors.push(`Variable "${varName}" not found using path: ${jsonPath}`);
      }
    } catch (error) {
      variables[varName] = {
        extracted: false,
        value: null,
      };
      errors.push(`Error extracting "${varName}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Interpolate
  const result = interpolatePrompt(template, payload, mapping);

  return {
    errors,
    result,
    success: errors.length === 0,
    variables,
  };
}
