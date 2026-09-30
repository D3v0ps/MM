// Nedladdning i prototypen: artefaktens nedladdning när den finns, annars texten i en dialog (som MM.download).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const showText = vi.fn();
const toast = vi.fn();
vi.mock("@/ui/dialog", () => ({ showText: (v: unknown) => showText(v) }));
vi.mock("@/ui/toast", () => ({ toast: (...a: unknown[]) => toast(...a) }));

const { artifactDownload } = await import("./download");

type Save = (req: { filename: string; data: Blob }) => Promise<unknown>;
const withClaude = (save: Save | null) => {
  (globalThis as unknown as { window: unknown }).window = { claude: { use: async (n: string) => (n === "downloads" && save ? { save } : null) } };
};

describe("artifactDownload", () => {
  beforeEach(() => {
    showText.mockReset();
    toast.mockReset();
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("sparar via artefaktens nedladdning med BOM för Excel", async () => {
    const save = vi.fn<Save>(async () => ({ status: "saved" }));
    withClaude(save);
    expect(await artifactDownload({ filename: "fakturaunderlag-2027-01.csv", content: "Ärende;Belopp\nBOT-26-0143;1 234" })).toBe(true);
    const req = save.mock.calls[0][0];
    expect(req.filename).toBe("fakturaunderlag-2027-01.csv");
    const bytes = new Uint8Array(await req.data.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes)).toBe("Ärende;Belopp\nBOT-26-0143;1 234");
    expect(toast).toHaveBeenCalledWith("Filen fakturaunderlag-2027-01.csv är sparad.");
    expect(showText).not.toHaveBeenCalled();
  });

  it("avbruten nedladdning ger ett fel och ingen dialog", async () => {
    withClaude(async () => Promise.reject({ code: "declined", message: "nej" }));
    expect(await artifactDownload({ filename: "a.csv", content: "x" })).toBe(false);
    expect(toast).toHaveBeenCalledWith("Nedladdningen avbröts.", "error");
    expect(showText).not.toHaveBeenCalled();
  });

  it("utan artefaktens nedladdning visas texten att kopiera", async () => {
    withClaude(null);
    expect(await artifactDownload({ filename: "logg.csv", content: "rad 1" })).toBe(false);
    expect(showText).toHaveBeenCalledWith({ title: "Innehåll i logg.csv", text: "rad 1", note: "Filen kunde inte sparas direkt här. Kopiera innehållet i stället." });
  });

  it("andra fel (t.ex. rate_limited) faller tillbaka till dialogen", async () => {
    withClaude(async () => Promise.reject({ code: "rate_limited", message: "vänta" }));
    expect(await artifactDownload({ filename: "b.csv", content: "y" })).toBe(false);
    expect(showText).toHaveBeenCalledTimes(1);
  });
});
