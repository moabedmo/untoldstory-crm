import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fetchCode = readFileSync(join(root, 'n8n/_snippets/fetch-google-ads-leads-body.js'), 'utf8');
const sheetsWf = JSON.parse(readFileSync(join(root, 'n8n/google-sheets-to-supabase.workflow.json'), 'utf8'));
const insertNode = sheetsWf.nodes.find((n) => n.name === 'Insert into Supabase');
let insertJs = insertNode.parameters.jsCode;
insertJs = insertJs.replace(/ev-google-/g, 'ev-gads-').replace(/تكامل Google/g, 'تكامل Google Ads');
insertJs = insertJs.replace(/صف الشيت: \$\{lead\.sheet_row\}/, 'Google Ads — ${lead.google_ads_customer_id} — ${lead.campaign || lead.google_ads_submission_id}');

const wf = {
  name: 'Google Ads API → Supabase leads (google)',
  nodes: [
    {
      parameters: {
        content:
          '## Google Ads API — كل الحملات تلقائياً\n\n### 0) Supabase API\nعقدة Insert → Supabase credential\n\n### 1) Google Ads OAuth2 API\n- Client ID + Secret من Google Cloud\n- **Developer Token** من Google Ads → Tools → API Center\n- Connect بحساب الإعلانات\n\nعقدة **Fetch Google Ads Leads** → نفس Credential\n\n### 2) Static Data (اختياري)\n```json\n{\n  "googleAdsDeveloperToken": "ضع_هنا_لو_مش_في_Credential",\n  "googleAdsLoginCustomerId": "1234567890",\n  "googleAdsCustomerId": "",\n  "googleAdsApiVersion": "v17",\n  "defaultAssignedToId": "u_xxx"\n}\n```\nloginCustomerId = MCC فقط\n\n### 3) Manual → Active (كل 10 دقائق)\nيسحب lead_form_submission_data من كل حسابات Ads المتاحة — أي حملة Lead Form جديدة بدون إعداد شيت.',
        height: 480,
        width: 560,
        color: 4,
      },
      id: 'sticky-gads-setup',
      name: 'Setup (اقرأني)',
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [-360, -140],
    },
    {
      parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 10 }] } },
      id: 'trigger-schedule-gads',
      name: 'Every 10 minutes',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      position: [240, 0],
    },
    {
      parameters: {},
      id: 'trigger-manual-gads',
      name: 'Manual',
      type: 'n8n-nodes-base.manualTrigger',
      typeVersion: 1,
      position: [240, 200],
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: fetchCode },
      id: 'code-fetch-google-ads',
      name: 'Fetch Google Ads Leads',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [520, 100],
      credentials: {
        googleAdsOAuth2Api: { id: 'CONFIGURE_IN_N8N', name: 'Google Ads account' },
      },
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: insertJs },
      id: 'code-insert-gads-supabase',
      name: 'Insert into Supabase',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [800, 100],
      credentials: {
        supabaseApi: { id: 'CONFIGURE_IN_N8N', name: 'Supabase — Untold Story' },
      },
    },
  ],
  connections: {
    'Every 10 minutes': { main: [[{ node: 'Fetch Google Ads Leads', type: 'main', index: 0 }]] },
    Manual: { main: [[{ node: 'Fetch Google Ads Leads', type: 'main', index: 0 }]] },
    'Fetch Google Ads Leads': { main: [[{ node: 'Insert into Supabase', type: 'main', index: 0 }]] },
  },
  pinData: {},
  settings: { executionOrder: 'v1' },
  staticData: null,
  tags: [{ name: 'leads' }, { name: 'google-ads' }, { name: 'supabase' }],
  triggerCount: 1,
  meta: { templateCredsSetupCompleted: true },
};

writeFileSync(join(root, 'n8n/google-ads-leads-to-supabase.workflow.json'), JSON.stringify(wf, null, 2) + '\n');
console.log('OK google-ads-leads-to-supabase.workflow.json');
