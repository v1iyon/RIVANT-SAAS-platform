// tests/mfa-backup-codes.test.js
import { describe, it, expect, beforeAll } from "vitest";
import { generateBackupCodes, hashBackupCode } from "../lib/mfa-backup-codes.js";

beforeAll(() => {
  // hashBackupCode/generateBackupCodes навмисно кидають виняток без
  // ENCRYPTION_KEY (див. коментар у самому файлі) — у реальному оточенні
  // це завжди задано, тут підставляємо тестове значення.
  process.env.ENCRYPTION_KEY = "test-encryption-key-for-unit-tests-only";
});

describe("generateBackupCodes", () => {
  it("генерує 10 кодів за замовчуванням", () => {
    const { plainCodes, hashes } = generateBackupCodes();
    expect(plainCodes).toHaveLength(10);
    expect(hashes).toHaveLength(10);
  });

  it("кожен код унікальний у межах однієї партії (немає видимих колізій)", () => {
    const { plainCodes } = generateBackupCodes(50); // більша партія навмисно, щоб колізія була помітнішою, якби існувала
    expect(new Set(plainCodes).size).toBe(plainCodes.length);
  });

  it("формат коду — XXXXX-XXXXX, без заплутуваних символів 0/O/1/I", () => {
    const { plainCodes } = generateBackupCodes(20);
    for (const code of plainCodes) {
      expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
      expect(code).not.toMatch(/[01OI]/);
    }
  });

  it("hashes відповідають саме hashBackupCode(plainCode) — консистентність generate() і окремого виклику hash", () => {
    const { plainCodes, hashes } = generateBackupCodes(5);
    plainCodes.forEach((code, i) => {
      expect(hashBackupCode(code)).toBe(hashes[i]);
    });
  });
});

describe("hashBackupCode", () => {
  it("детермінований — однаковий код завжди дає однаковий хеш", () => {
    expect(hashBackupCode("ABCDE-FGHJK")).toBe(hashBackupCode("ABCDE-FGHJK"));
  });

  it("регістр і дефіс не впливають на результат — так само зійдеться, якщо ввести код без дефісу чи малими літерами", () => {
    const a = hashBackupCode("ABCDE-FGHJK");
    const b = hashBackupCode("abcde-fghjk");
    const c = hashBackupCode("ABCDEFGHJK");
    const d = hashBackupCode("  ABCDE-FGHJK  ");
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(a).toBe(d);
  });

  it("різні коди дають різні хеші", () => {
    expect(hashBackupCode("ABCDE-FGHJK")).not.toBe(hashBackupCode("ABCDE-FGHJ2"));
  });

  it("кидає виняток без ENCRYPTION_KEY, а не тихо хешує передбачуваним фолбеком", () => {
    const saved = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    expect(() => hashBackupCode("ABCDE-FGHJK")).toThrow();
    process.env.ENCRYPTION_KEY = saved;
  });
});
