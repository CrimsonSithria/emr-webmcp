import { getAsyncLifecycle, defineConfigSchema } from '@openmrs/esm-framework';
import { configSchema } from './config-schema';
import { moduleName } from './constants';
import { startWebmcpLifecycle } from './webmcp/webmcp-lifecycle';

const options = {
  featureName: 'emr-webmcp',
  moduleName,
};

export const importTranslation = require.context('../translations', false, /.json$/, 'lazy');

export function startupApp() {
  defineConfigSchema(moduleName, configSchema);
  startWebmcpLifecycle();
}

// Root component — /emr-webmcp review workspace
export const root = getAsyncLifecycle(() => import('./root.component'), options);
export { ReviewQueue } from './review/review-queue.component';

// Extensions

// Modals

// Workspaces

