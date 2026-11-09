export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertProductionReady } = await import("./lib/startup");
  const problems = await assertProductionReady();
  // Throwing here aborts server startup.
  if (problems.length) throw new Error(`Refusing to start:\n - ${problems.join("\n - ")}`);
}
