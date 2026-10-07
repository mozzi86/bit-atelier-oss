// Registriert den Alias-Loader-Hook für node --test.
// Nutzung: node --test --import ./tests/alias-register.mjs tests/unit/
import { register } from "node:module";

register("./alias-hook.mjs", import.meta.url);
