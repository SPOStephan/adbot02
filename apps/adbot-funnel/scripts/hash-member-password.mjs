// Erzeugt den passwordHash für einen Eintrag in FUNNEL_MEMBER_LOGINS.
// Aufruf: node scripts/hash-member-password.mjs   (Passwort wird abgefragt, nicht gespeichert)
import { randomBytes, scryptSync } from "node:crypto";
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, output: process.stderr });
rl.question("Passwort (mind. 12 Zeichen): ", password => {
  rl.close();
  if (password.length < 12) {
    console.error("Passwort zu kurz.");
    process.exit(1);
  }
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  console.log(`scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`);
});
