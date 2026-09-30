// Hanterare: session och diagnos.
import { handleQuery } from "@/api/server";
import { sessionPing } from "./api";
import "./nav-handlers";

handleQuery(sessionPing, {}, (ctx) => ({ now: ctx.now(), role: ctx.actor.role, userId: ctx.actor.userId }));
