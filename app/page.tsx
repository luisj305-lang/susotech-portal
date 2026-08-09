import { supabase } from "@/lib/supabase/client";

export default async function Home() {
  const { data, error } = await supabase
    .from("projects")
    .select("*");

  return (
    <main style={{ padding: 40 }}>
      <h1>SUSOTECH MVP</h1>

      <pre>
        {JSON.stringify({ data, error }, null, 2)}
      </pre>
    </main>
  );
}