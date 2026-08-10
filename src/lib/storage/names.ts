export function safeStorageName(name: string) {
  return name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 120);
}
