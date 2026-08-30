import type { EmrCapability } from '../contracts/capabilities.js';
import { TOOL_DEFINITIONS, type ToolDefinition, type ToolName } from './tool-definitions.js';

export const SESSION_PRIVILEGE = 'session';
export const USE_PRIVILEGE = 'emr-webmcp.use';

export type PolicyInputs = {
  capabilities: ReadonlySet<EmrCapability>;
  privileges: ReadonlySet<string>;
};

function requiredPrivileges(name: ToolName): readonly string[] {
  return name === 'get_active_patient' ? [SESSION_PRIVILEGE] : [USE_PRIVILEGE];
}

export function selectEligibleTools(inputs: PolicyInputs): readonly ToolDefinition[] {
  return TOOL_DEFINITIONS.filter((tool) => {
    const capabilitiesGranted = tool.requiredCapabilities.every((capability) =>
      inputs.capabilities.has(capability),
    );
    const privilegesGranted = requiredPrivileges(tool.name).every((privilege) =>
      inputs.privileges.has(privilege),
    );
    return capabilitiesGranted && privilegesGranted;
  });
}
