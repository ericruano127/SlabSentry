import path from "node:path";

const bool = (v?: string) => v === "1" || v === "true";

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/slabguard",
  isProd: process.env.NODE_ENV === "production",
  /** Dev auth lets local testing run without Supabase. Refused in production. */
  devAuth: process.env.AUTH_MODE === "dev" && process.env.NODE_ENV !== "production",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET ?? "",
  storageBucket: process.env.STORAGE_BUCKET ?? "slab-images",
  localStorageDir: process.env.LOCAL_STORAGE_DIR ?? path.resolve(process.cwd(), ".data/uploads"),
  visionUrl: process.env.VISION_URL ?? "http://localhost:8001",
  visionKey: process.env.VISION_API_KEY ?? "",
  psaToken: process.env.PSA_API_TOKEN ?? "",
  googleVisionKey: process.env.GOOGLE_VISION_API_KEY ?? "",
  stripeSecret: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  revenuecatWebhookAuth: process.env.REVENUECAT_WEBHOOK_AUTH ?? "",
  revenuecatSecretKey: process.env.REVENUECAT_SECRET_API_KEY ?? "",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  adminEmails: (process.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  inlineWorker: bool(process.env.INLINE_WORKER ?? (process.env.NODE_ENV !== "production" ? "1" : "0")),
  reservationTtlMinutes: Number(process.env.RESERVATION_TTL_MINUTES ?? 30),
  maxAnalysesPerSession: Number(process.env.MAX_ANALYSES_PER_SESSION ?? 8),
  maxImagesPerSession: Number(process.env.MAX_IMAGES_PER_SESSION ?? 30),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 15 * 1024 * 1024),
};
