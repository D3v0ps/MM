// Hanterare för området admin (frågor och kommandon). Registreras via src/api/handlers.ts – importeras aldrig av skärmar.
// Källa: prototyp/src/views/admin.js. Uppdelat per skärm:
//   ./handlers-avtal.ts          /admin/avtal: avtal, konfiguration, prislista, jämförelse, interna regler (admin.setOrgRule)
//   ./handlers-users.ts          /admin/anvandare: användare och roller (admin.inviteCustomer, admin.setCustomerActive)
//   ./handlers-integrations.ts   /admin/integrationer: underbiträden, integrationer, bakgrundsjobb (admin.runJob)
//   ./handlers-templates.ts      /admin/mallar: mallar och utskickslogg (admin.saveTemplate)
//   ./handlers-log.ts            /admin/logg: revisionslogg och loggkontroll (admin.logCheck)
import "./handlers-avtal";
import "./handlers-users";
import "./handlers-integrations";
import "./handlers-templates";
import "./handlers-log";
