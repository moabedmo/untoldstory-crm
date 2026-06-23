import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Same path as integrations OAuth persistence */
export function getIntegrationTokenStorePath() {
  return process.env.INTEGRATION_OAUTH_TOKEN_PATH?.trim() || path.join(__dirname, '..', '..', 'integration-tokens.json');
}
