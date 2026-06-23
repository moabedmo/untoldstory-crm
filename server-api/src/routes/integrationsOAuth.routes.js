import { Router } from 'express';
import {
  oauthPublicBaseFromExpressReq,
  processIntegrationsOAuthRequest,
} from '../lib/integrationsOAuthEngine.js';
import { getIntegrationTokenStorePath } from '../lib/integrationTokenPath.js';

const tokenStorePath = getIntegrationTokenStorePath();

/** In-memory OAuth state (use Redis when scaling horizontally) */
const stateStore = new Map();

function appOriginDefault() {
  return process.env.APP_ORIGIN?.trim() || 'http://localhost:5173';
}

export const integrationsOAuthRouter = Router();

integrationsOAuthRouter.use(async (req, res, next) => {
  try {
    const u = new URL(req.originalUrl || '/', `http://${req.get('host') || 'localhost'}`);
    const pathname = u.pathname;
    const oauthPublicBase = oauthPublicBaseFromExpressReq(req);
    const appOrigin = appOriginDefault();

    const out = await processIntegrationsOAuthRequest({
      method: req.method,
      pathname,
      searchParams: u.searchParams,
      oauthPublicBase,
      appOrigin,
      stateStore,
      tokenStorePath,
    });

    if (out.kind === 'redirect') {
      res.redirect(302, out.location);
      return;
    }
    res.status(out.status).json(out.body);
  } catch (e) {
    next(e);
  }
});
