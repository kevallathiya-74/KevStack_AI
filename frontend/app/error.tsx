"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="page page--centered">
      <section className="error-screen">
        <p className="error-screen__eyebrow">Application Error</p>
        <h1 className="error-screen__title">Something interrupted the dashboard.</h1>
        <p className="error-screen__body">
          The page hit an unexpected error boundary. You can retry safely, and the backend request guardrails remain active.
        </p>
        <Button onClick={reset}>Try again</Button>
      </section>
    </main>
  );
}
