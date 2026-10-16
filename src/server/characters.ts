import "server-only";
import { nanoid } from "nanoid";
import { db } from "./db";

export interface Character {
  id: string;
  name: string;
  description: string | null;
  references: string[];
  triggerWord: string | null;
  loraFile: string | null;
  status: "ready" | "training" | "failed";
  createdAt: number;
}

interface Row {
  id: string;
  name: string;
  description: string | null;
  reference_asset_ids_json: string;
  trigger_word: string | null;
  lora_file: string | null;
  status: Character["status"];
  created_at: number;
}

const toCharacter = (r: Row): Character => ({
  id: r.id,
  name: r.name,
  description: r.description,
  references: JSON.parse(r.reference_asset_ids_json) as string[],
  triggerWord: r.trigger_word,
  loraFile: r.lora_file,
  status: r.status,
  createdAt: r.created_at,
});

export function listCharacters(): Character[] {
  return (db().prepare("SELECT * FROM characters ORDER BY created_at DESC").all() as Row[]).map(toCharacter);
}

export function getCharacter(id: string): Character | null {
  const r = db().prepare("SELECT * FROM characters WHERE id = ?").get(id) as Row | undefined;
  return r ? toCharacter(r) : null;
}

export function createCharacter(input: { name: string; description?: string; references: string[] }): Character {
  const now = Date.now();
  const row: Row = {
    id: nanoid(10),
    name: input.name.trim().slice(0, 60),
    description: input.description?.trim() || null,
    reference_asset_ids_json: JSON.stringify(input.references.slice(0, 20)),
    trigger_word: null,
    lora_file: null,
    status: "ready",
    created_at: now,
  };
  db()
    .prepare(
      `INSERT INTO characters (id, name, description, reference_asset_ids_json, trigger_word, lora_file, status, created_at, updated_at)
       VALUES (@id, @name, @description, @reference_asset_ids_json, @trigger_word, @lora_file, @status, @created_at, @created_at)`,
    )
    .run(row);
  return toCharacter(row);
}

export function deleteCharacter(id: string): void {
  db().prepare("DELETE FROM characters WHERE id = ?").run(id);
}
