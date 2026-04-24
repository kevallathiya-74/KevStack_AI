import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page page--centered">
      <section className="error-screen">
        <p className="error-screen__eyebrow">404</p>
        <h1 className="error-screen__title">This workspace view does not exist.</h1>
        <p className="error-screen__body">Head back to the dashboard to continue reviewing content, analytics, and approval flows.</p>
        <Link href="/" className="btn">
          Back to dashboard
        </Link>
      </section>
    </main>
  );
}
