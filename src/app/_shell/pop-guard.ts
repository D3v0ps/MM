// Tillbaka/framåt till en historikpost från ett tidigare dokument (före en omladdning, eller efter ett besök på en annan
// webbplats som inte låg kvar i webbläsarens sidcache): ladda om sidan på postens adress i stället för att låta Next visa den.
// Posten bär det gamla dokumentets interna Next-träd, och med det visar Next fel sida och fel titel (se next-nav.tsx).
//
// Skriptet körs före hydreringen (next/script beforeInteractive i src/app/layout.tsx), så att dess popstate-lyssnare ligger
// före Nexts: lyssnare på window körs i den ordning de lades till. next-nav.tsx lägger nycklarna för det här dokumentets
// poster i window[OWN_KEYS_GLOBAL]. Finns inte mängden ännu (appen laddar fortfarande) gör skriptet ingenting.

/** Namnet på mängden med det här dokumentets nycklar (bara bokstäver och siffror). */
export const OWN_KEYS_GLOBAL = "__mmOwnNavKeys";

export const POP_GUARD_SCRIPT = `window.addEventListener("popstate",function(e){var s=e.state,k=s&&s.mmKey,o=window.${OWN_KEYS_GLOBAL};if(typeof k==="string"&&o&&!o.has(k)){e.stopImmediatePropagation();window.location.reload();}});`;
