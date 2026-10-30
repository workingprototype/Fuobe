import { beforeAll, beforeEach } from "vitest";
import { enterAs, LOCAL_OWNER } from "@/server/access/actor";

/**
 * Every test acts as the local owner ("Just me on this computer"), so suites that call server modules directly keep
 * working now that server code asks who is acting (docs/research/accounts-8.md §13). A test that needs nobody calls
 * asNobody() (tests/helpers/actors.ts); one that needs someone else wraps its work in runAs().
 */
enterAs(LOCAL_OWNER);
beforeAll(() => enterAs(LOCAL_OWNER));
beforeEach(() => enterAs(LOCAL_OWNER));
