// Enda ingången till API:t från webbläsaren. Validerar indata och roll i execute(); loggar aldrig personuppgifter.
// Körläget (minnet eller Supabase) väljs i src/server/runtime.ts.
import { ApiError } from "@/api/server";
import { DataError } from "@/data/supabase";
import { runRpc } from "@/server/runtime";

export async function POST(request: Request) {
  let body: { kind?: string; key?: string; input?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ code: "invalid_json", message: "Ogiltig begäran." }, { status: 400 });
  }
  const { kind, key, input } = body;
  if ((kind !== "query" && kind !== "command") || typeof key !== "string") {
    return Response.json({ code: "invalid_request", message: "Ogiltig begäran." }, { status: 400 });
  }
  try {
    const result = await runRpc(kind, key, input);
    return Response.json({ result: result === undefined ? null : result });
  } catch (e) {
    if (e instanceof ApiError) {
      const status = e.code === "unauthenticated" ? 401 : e.status;
      return Response.json({ code: e.code, message: e.message }, { status });
    }
    // Bara nyckel och feltyp i loggen – aldrig indata. DataError innehåller bara tabell och felkod.
    console.error("rpc-fel", key, e instanceof DataError ? e.message : e instanceof Error ? e.name : "okänt");
    return Response.json({ code: "server_error", message: "Något gick fel. Försök igen." }, { status: 500 });
  }
}
