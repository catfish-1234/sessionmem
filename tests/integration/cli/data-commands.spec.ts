import { it } from "vitest";

it.todo("listCommand prints a table with ID, importance, date, and preview columns for all project memories");
it.todo("listCommand prints empty table when no memories exist for the project");
it.todo("showCommand prints key:value block with all MemoryDto fields for a valid memory ID");
it.todo("showCommand exits non-zero and prints error when memory ID is not found");
it.todo("showCommand maps camelCase DTO fields to snake_case labels (source_adapter, created_at, etc.)");
