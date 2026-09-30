// Enda ingången till API:t från webbläsaren. Validerar indata och roll i execute(); loggar aldrig personuppgifter.
import { ApiError } from "@/api/server";
import { currentPersona, memoryRuntime } from "@/server/runtime";

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
  const persona = await currentPersona();
  if (!persona) return Response.json({ code: "unauthenticated", message: "Du är inte inloggad." }, { status: 401 });
  try {
    const result = await memoryRuntime().run(kind, key, input, persona.actor);
    return Response.json({ result });
  } catch (e) {
    if (e instanceof ApiError) return Response.json({ code: e.code, message: e.message }, { status: e.status });
    // Bara nyckel och feltyp i loggen – aldrig indata.
    console.error("rpc-fel", key, e instanceof Error ? e.name : "okänt");
    return Response.json({ code: "server_error", message: "Något gick fel. Försök igen." }, { status: 500 });
  }
}
