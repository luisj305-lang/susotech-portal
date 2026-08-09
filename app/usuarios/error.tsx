"use client";

export default function UsersError({
  reset,
}: {
  reset: () => void;
}) {
  return (
    <main style={{ minHeight: "100vh", padding: "40px" }}>
      <h1 style={{ fontSize: "24px", fontWeight: "bold" }}>Error</h1>
      <p role="status">
        No se pudo cargar la lista de usuarios. Verifica que tengas permisos de
        administrador.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        style={{ marginTop: "16px", padding: "10px 16px", cursor: "pointer" }}
      >
        Reintentar
      </button>
    </main>
  );
}
