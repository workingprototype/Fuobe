import { connection } from "next/server";
import { z } from "zod";
import { checkGpuAddress, GpuError, testGpu } from "@/server/account-gpu";
import { accountGpu, requestAccount, setAccountGpu } from "@/server/auth";

/**
 * "Your GPU" (public sign-up): the account's own ComfyUI, where its runs go. GET says what is
 * connected (never the token); PUT checks the address and asks the ComfyUI for /system_stats, then
 * saves it (`?test=1`: check only); DELETE disconnects. Accounts only: the owner's ComfyUI is in Settings.
 */
const account = async (request: Request) => requestAccount(request);

const notAccount = () => Response.json({ error: "Your GPU is for accounts. The studio's own ComfyUI is in Settings → Open-source engine." }, { status: 400 });

export async function GET(request: Request) {
  await connection();
  const a = await account(request);
  if (!a) return notAccount();
  const gpu = accountGpu(a.id);
  return Response.json({ gpu: gpu ? { url: gpu.url, hasToken: !!gpu.token } : null });
}

const Body = z.object({ url: z.string().min(1).max(500), token: z.string().max(500).optional() });

export async function PUT(request: Request) {
  const a = await account(request);
  if (!a) return notAccount();
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter your ComfyUI's address" }, { status: 400 });
  try {
    const url = await checkGpuAddress(parsed.data.url);
    // A token left empty keeps the saved one when the address is the same.
    const saved = accountGpu(a.id);
    const token = parsed.data.token?.trim() || (saved?.url === url ? saved.token : undefined);
    const info = await testGpu({ url, token });
    if (new URL(request.url).searchParams.get("test") !== "1") setAccountGpu(a.id, { url, token });
    return Response.json({ gpu: { url, hasToken: !!token }, info });
  } catch (e) {
    if (e instanceof GpuError) return Response.json({ error: e.message }, { status: 422 });
    throw e;
  }
}

export async function DELETE(request: Request) {
  const a = await account(request);
  if (!a) return notAccount();
  setAccountGpu(a.id, null);
  return Response.json({ gpu: null });
}
