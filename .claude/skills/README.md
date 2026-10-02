# Skills i repot

Installerade med `npx skills add <repo> --skill <namn>` och låsta i `skills-lock.json`. Innehållet är granskat innan det
committats (bara Markdown, inga kommandon eller nätverksanrop utöver det som står nedan). `.agents/` (kopian för andra
agentverktyg) versionshanteras inte.

| Skill | Källa | Används till |
|---|---|---|
| `supabase`, `supabase-postgres-best-practices` | supabase/agent-skills | Databas, RLS, migrationer, Postgres-prestanda |
| `web-design-guidelines` | vercel-labs/agent-skills | **Granskning** av skärmar mot Vercels Web Interface Guidelines (tillgänglighet, fokus, formulär, laddning, mobil). Reglerna finns lokalt i `GUIDELINES.md` – använd den kopian; SKILL.md:s nätverkshämtning behövs bara när kopian ska uppdateras |
| `animate` | emilkowalski/skills | Övergångar och animationer (flikar, dialoger, toasts, listor). Alltid med `prefers-reduced-motion` och befintliga tokens |

## Det som alltid gäller före en skill

`CLAUDE.md` vinner. MB:s grafiska profil är låst: bara antracit, röd, ljusgrå, blå och vitt; Montserrat; rubriker och
sektionsetiketter i versaler; röd punkt som accent. En skill som föreslår andra färger, typsnitt eller "undvik versaler"
följs inte på de punkterna. Kontrast, 44 px klickytor, text + ikon för status, tangentbord och skärmläsare gäller alltid.

## Prövade men inte installerade (2026-10-02)

- `frontend-design` (anthropics/skills): för att skapa en ny, egen visuell identitet. Vår är låst, och skillen säger
  bl.a. "undvik versaler i etiketter" – tvärtemot profilen. Hantverksreglerna (fokus, reduced motion, responsivt) täcks
  av `web-design-guidelines`.
- Taste Skill, Awesome DESIGN.md, Image to Code, Playwright CLI: landningssidor, referenssamling, bild-till-kod och ett
  CLI för det Playwright vi redan kör i `tests/e2e` och granskningarna. Inget av det behövs i Miljonmatch i dag.
