import { getAuth } from "@/server/identity/auth";
import { signInRequired } from "@/server/mode";

/**
 * Better Auth's router (docs/research/accounts-8.md §7.1), mounted at /api/identity. Only allowlisted endpoints
 * answer browser traffic (src/server/identity/auth.ts ROUTER_ALLOWED); sign-up and social sign-in arrive with the
 * sign-in package. With sign-in off (Just me on this computer) there is nothing to sign in to, so nothing is
 * mounted. Personal installs sign in through POST /api/auth/login.
 */
async function handle(request: Request): Promise<Response> {
  if (!signInRequired()) return Response.json({ error: "Sign-in is off on this Fuobe." }, { status: 404 });
  return getAuth().handler(request);
}

export const GET = handle;
export const POST = handle;
