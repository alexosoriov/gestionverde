import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    "Faltan VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY. Copia .env.example como .env.local.",
  );
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export type AppRole =
  | "administrador"
  | "jefatura"
  | "supervisor"
  | "chofer"
  | "recolector"
  | "vecino";

export type AccountStatus = "pendiente" | "aprobado" | "revocado";

export type Profile = {
  id: string;
  email: string;
  nombre: string;
  telefono: string | null;
  rol: AppRole;
  estado: AccountStatus;
  activo: boolean;
  calle: string | null;
  numero_vivienda: string | null;
  sector: string | null;
};

export async function getCurrentProfile(): Promise<Profile | null> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const userId = sessionData.session?.user.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,nombre,telefono,rol,estado,activo,calle,numero_vivienda,sector")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data as Profile | null;
}
