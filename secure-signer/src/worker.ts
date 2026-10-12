/**
 * The signer origin's Worker: `/vault` (the partitioned-cookie blob store);
 * everything else is the static app, served with `deploy/_headers`.
 */
import { handleVault, VAULT_PATH } from "./vault.js";

type Env = { ASSETS: { fetch(request: Request): Promise<Response> } };

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return new URL(request.url).pathname === VAULT_PATH ? handleVault(request) : env.ASSETS.fetch(request);
  },
};
