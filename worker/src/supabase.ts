import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../.env") });

export const supabaseUrl = process.env.SUPABASE_URL!;
export const supabaseKey = process.env.SUPABASE_KEY!;
export const supabase = createClient(supabaseUrl, supabaseKey);
