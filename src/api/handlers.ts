// Registrerar alla hanterare. Importeras av servern (/api/rpc) och av prototypen – aldrig av skärmar.
import "@/features/session/handlers";
import "@/features/inkorg/handlers";
import "@/features/arenden/handlers";
import "@/features/coach/handlers";
import "@/features/rapporter/handlers";
import "@/features/ledning/handlers";
import "@/features/ekonomi/handlers";
import "@/features/kommun/handlers";
import "@/features/admin/handlers";
import "@/features/praktik/handlers";
import "@/features/puls/handlers";
import "@/features/rost/handlers";
import "@/features/notiser/handlers";
export { execute, isSilentCommand, registeredKeys } from "./server";
