export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertProductionReady } = await import("./lib/startup");
  const problems = await assertProductionReady();
  if (problems.length) {
    console.error(`Refusing to start:\n - ${problems.join("\n - ")}`);
    process.exit(1);
  }
}
