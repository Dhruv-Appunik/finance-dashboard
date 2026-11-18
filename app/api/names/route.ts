import { fail, handle, ok } from "@/lib/http";
import { generateNames } from "@/lib/names";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Names one chunk of transactions with AI. The caller repeats with `next` until it is null. */
export const POST = handle(async (req: Request) => {
  const body = await req.json().catch(() => ({}));
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Boolean);
  if (body.ids && !ids.length) return fail("No transactions selected");
  return ok(await generateNames({ ids, after: Number(body.after) || 0 }));
});
