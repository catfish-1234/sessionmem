import { it } from "vitest";

it.todo("exportCommand writes a valid JSON array of MemoryDto objects to the specified path");
it.todo("exportCommand uses an ISO-dated default path when no path argument is given");
it.todo("importCommand without --merge skips duplicate IDs and prints 'Imported N, skipped M duplicates'");
it.todo("importCommand with --merge overwrites existing memories via upsert");
it.todo("importCommand exits non-zero when the JSON file is missing or invalid");
