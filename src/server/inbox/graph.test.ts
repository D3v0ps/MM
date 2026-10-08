// Graph-klienten med fejkad fetch: inställningarna, inloggningen, listningen (text), bilagorna, mappen Inläst och felkoderna.
import { describe, expect, it } from "vitest";
import { base64Bytes, DEFAULT_DONE_FOLDER, graphEnv, graphMail, htmlToText, type GraphFetch } from "./graph";

const ENV = { MS_GRAPH_TENANT_ID: "tenant-1", MS_GRAPH_CLIENT_ID: "client-1", MS_GRAPH_CLIENT_SECRET: "hemlig", MM_INBOX_MAILBOX: "Avrop@Example.invalid" };
const CFG = graphEnv(ENV)!;

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
function fakeFetch(routes: Record<string, (c: Call) => { status?: number; json?: unknown }>): GraphFetch & { calls: Call[] } {
  const calls: Call[] = [];
  const fn: GraphFetch = async (url, init) => {
    const c: Call = { url, method: init.method, headers: init.headers, body: init.body };
    calls.push(c);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return { ok: false, status: 404, json: async () => ({}) };
    const r = routes[key](c);
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => r.json ?? {} };
  };
  return Object.assign(fn, { calls });
}
const token = () => ({ json: { access_token: "tok" } });

describe("graphEnv", () => {
  it("null när något saknas; brevlådan i gemener och mappen Inläst som standard", () => {
    expect(graphEnv({})).toBeNull();
    expect(graphEnv({ ...ENV, MS_GRAPH_CLIENT_SECRET: "" })).toBeNull();
    expect(graphEnv({ ...ENV, MM_INBOX_MAILBOX: "ingen-adress" })).toBeNull();
    expect(CFG).toEqual({ tenantId: "tenant-1", clientId: "client-1", clientSecret: "hemlig", mailbox: "avrop@example.invalid", doneFolder: DEFAULT_DONE_FOLDER });
    expect(graphEnv({ ...ENV, MM_INBOX_DONE_FOLDER: "Klart" })?.doneFolder).toBe("Klart");
  });
});

describe("graphMail", () => {
  it("loggar in en gång (client credentials) och listar olästa mejl som text, med HTML omgjort vid behov", async () => {
    const f = fakeFetch({
      "oauth2/v2.0/token": token,
      "/messages?": () => ({
        json: { value: [
          { id: "m1", internetMessageId: "<a@b>", subject: "Avrop", receivedDateTime: "2027-02-01T07:50:00Z", from: { emailAddress: { address: "Linda@Botkyrka.se", name: "Linda" } }, hasAttachments: true, body: { contentType: "text", content: "Hej\r\nFörnamn: A" } },
          { id: "m2", subject: "Html", receivedDateTime: "2027-02-01T07:51:00Z", from: { emailAddress: { address: "x@y.se" } }, body: { contentType: "html", content: "<p>Hej</p><table><tr><td>Förnamn</td><td>Anna</td></tr></table>" } },
        ] },
      }),
    });
    const g = graphMail(CFG, f);
    const list = await g.listUnread();
    expect(list).toEqual([
      { id: "m1", internetMessageId: "<a@b>", subject: "Avrop", receivedDateTime: "2027-02-01T07:50:00Z", fromAddress: "linda@botkyrka.se", fromName: "Linda", bodyText: "Hej\nFörnamn: A", hasAttachments: true },
      { id: "m2", internetMessageId: null, subject: "Html", receivedDateTime: "2027-02-01T07:51:00Z", fromAddress: "x@y.se", fromName: "", bodyText: "Hej\nFörnamn\tAnna", hasAttachments: false },
    ]);
    await g.listUnread();
    expect(f.calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(1);
    const login = f.calls[0];
    expect(login.url).toBe("https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token");
    expect(login.body).toContain("grant_type=client_credentials");
    expect(login.body).toContain("scope=https%3A%2F%2Fgraph.microsoft.com%2F.default");
    const listCall = f.calls[1];
    expect(listCall.url).toContain("/users/avrop%40example.invalid/mailFolders/inbox/messages?$filter=isRead%20eq%20false");
    expect(listCall.headers.Prefer).toBe('outlook.body-content-type="text"');
    expect(listCall.headers.Authorization).toBe("Bearer tok");
  });

  it("bilagor: bara filbilagor som inte är inbäddade; innehållet som byte; mappen Inläst hittas eller skapas och mejlet flyttas", async () => {
    const f = fakeFetch({
      "oauth2/v2.0/token": token,
      "/attachments?": () => ({ json: { value: [
        { "@odata.type": "#microsoft.graph.fileAttachment", id: "a1", name: "mall.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 3, isInline: false },
        { "@odata.type": "#microsoft.graph.fileAttachment", id: "a2", name: "logo.png", contentType: "image/png", size: 3, isInline: true },
        { "@odata.type": "#microsoft.graph.itemAttachment", id: "a3", name: "vidarebefordrat", size: 3 },
      ] } }),
      "/attachments/a1": () => ({ json: { contentBytes: "UEsD" } }),
      "mailFolders?$filter": () => ({ json: { value: [] } }),
      "/mailFolders": (c) => (c.method === "POST" ? { status: 201, json: { id: "folder-1" } } : { json: {} }),
      "/move": () => ({ status: 201, json: { id: "moved" } }),
    });
    const g = graphMail(CFG, f);
    expect(await g.listAttachments("m1")).toEqual([{ id: "a1", name: "mall.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 3 }]);
    expect([...(await g.attachmentBytes("m1", "a1"))]).toEqual([0x50, 0x4b, 0x03]);
    await g.moveToDone("m1");
    await g.moveToDone("m2");
    const create = f.calls.find((c) => c.method === "POST" && c.url.endsWith("/mailFolders"))!;
    expect(JSON.parse(create.body ?? "{}")).toEqual({ displayName: "Inläst" });
    const moves = f.calls.filter((c) => c.url.endsWith("/move"));
    expect(moves).toHaveLength(2);
    expect(JSON.parse(moves[0].body ?? "{}")).toEqual({ destinationId: "folder-1" });
    // Mappen slås upp en gång per körning.
    expect(f.calls.filter((c) => c.url.includes("mailFolders?$filter"))).toHaveLength(1);
  });

  it("felen: 401 vid inloggningen pekar på appregistreringen (inget nytt försök), 429/5xx försöks igen, nätverksfel likaså – aldrig innehåll", async () => {
    const bad = graphMail(CFG, fakeFetch({ "oauth2/v2.0/token": () => ({ status: 401, json: { error: "invalid_client", error_description: "hemlig text" } }) }));
    await expect(bad.listUnread()).rejects.toMatchObject({ retryable: false, message: "Microsoft Graph: inloggningen svarade 401 – kontrollera klient-id, hemligheten och katalog-id" });
    const busy = graphMail(CFG, fakeFetch({ "oauth2/v2.0/token": token, "/messages?": () => ({ status: 429 }) }));
    await expect(busy.listUnread()).rejects.toMatchObject({ retryable: true, message: "Microsoft Graph: listningen svarade 429" });
    const forbidden = graphMail(CFG, fakeFetch({ "oauth2/v2.0/token": token, "/messages?": () => ({ status: 403 }) }));
    await expect(forbidden.listUnread()).rejects.toMatchObject({ retryable: false, message: expect.stringContaining("403 – kontrollera appregistreringen") });
    const net: GraphFetch = async () => {
      throw new Error("ECONNRESET");
    };
    await expect(graphMail(CFG, net).listUnread()).rejects.toMatchObject({ retryable: true, message: "Microsoft Graph: inloggningen kunde inte nås (nätverksfel eller tidsgräns)" });
  });

  it("hjälparna: HTML till text och base64 till byte", () => {
    expect(htmlToText("<div>Hej&nbsp;du</div><p>Rad 2</p><style>x{}</style>")).toBe("Hej du\nRad 2");
    expect([...base64Bytes("AQID")]).toEqual([1, 2, 3]);
  });
});
