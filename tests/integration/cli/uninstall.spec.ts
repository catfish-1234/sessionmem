import { it } from "vitest";

it.todo("uninstallCommand calls adapter.uninstall() and prints success message on success");
it.todo("uninstallCommand with --purge also deletes memories.db from the sessionmem directory");
it.todo("uninstallCommand without --purge leaves memories.db intact");
it.todo("uninstallCommand prints error when adapter has no uninstall() capability");
