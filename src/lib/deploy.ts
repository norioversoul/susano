// Clients for Comfy Developer Platform deployments (apps whose workflows need custom nodes).
// Server-only: the API key never reaches the browser.
import "server-only";
import { Comfy } from "@comfyorg/sdk";

/** The deployments Susano uses, by the env variable that holds each one's endpoint URL. */
export const DEPLOYMENTS = {
  tsukuyomi: "SUSANO_TSUKUYOMI_URL",
  reshoot: "SUSANO_RESHOOT_URL",
} as const;
export type DeploymentName = keyof typeof DEPLOYMENTS;

export class DeploymentMissing extends Error {}

/**
 * A Comfy SDK client for one deployment. The SDK takes its target only from COMFY_BASE_URL, read once in the
 * constructor, so it is set just for that synchronous call: Comfy Cloud and several deployments share one process.
 */
export function deployment(name: DeploymentName): Comfy {
  const url = process.env[DEPLOYMENTS[name]]?.trim();
  if (!url) throw new DeploymentMissing(`${DEPLOYMENTS[name]} is not set (see .env.local.example).`);
  const apiKey = process.env.COMFY_CLOUD_API_KEY?.trim();
  if (!apiKey) throw new DeploymentMissing("COMFY_CLOUD_API_KEY is not set (see .env.local.example).");
  const before = process.env.COMFY_BASE_URL;
  process.env.COMFY_BASE_URL = url;
  try {
    return new Comfy({ apiKey, clientInfo: "susano" });
  } finally {
    if (before === undefined) delete process.env.COMFY_BASE_URL;
    else process.env.COMFY_BASE_URL = before;
  }
}

/** SDK job states that end a job. */
export const DEPLOY_DONE = new Set(["succeeded"]);
export const DEPLOY_FAILED = new Set(["failed", "canceled", "expired"]);

/** A readable reason from an SDK error, e.g. a stopped deployment. */
export function deployError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/not.?ready|stopped|no deployment|503|deployment_not_ready/i.test(msg)) {
    return `The GPU for this app is not running. Start the deployment, then try again. (${msg.slice(0, 200)})`;
  }
  return msg.slice(0, 400);
}
