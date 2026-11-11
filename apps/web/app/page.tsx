import Link from "next/link";

export default function Home() {
  return (
    <>
      <section className="hero">
        <span className="pill">PSA & CGC first · more graders coming</span>
        <h1>Check a graded slab before you buy — with evidence, not guesses.</h1>
        <p className="muted" style={{ maxWidth: 640, fontSize: "1.05rem" }}>
          SlabGuard compares your photos with official certification records and reference images, measures physical details that differ between copies of the same card, and inspects visible holder security features. Every finding shows its evidence.
        </p>
        <div className="row" style={{ marginTop: 16 }}>
          <Link className="btn primary" href="/signup">Start free — 3 verifications</Link>
          <Link className="btn" href="/pricing">See plans</Link>
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>No credit card required.</p>
      </section>
      <div className="grid grid-3">
        <div className="card"><h2 className="h3">Same card — or same physical copy?</h2><p className="muted">A valid cert number isn't enough. We align your card to the grader's image and compare cut, centering and surface details.</p></div>
        <div className="card"><h2 className="h3">Holder inspection</h2><p className="muted">Generation-aware checks for labels, codes, edges and light-reactive elements — older genuine slabs aren't penalized for lacking newer features.</p></div>
        <div className="card"><h2 className="h3">Honest about limits</h2><p className="muted">Photos alone can't guarantee authenticity. Reports say what was verified, what was inferred, and what's still uncertain.</p></div>
      </div>
    </>
  );
}
