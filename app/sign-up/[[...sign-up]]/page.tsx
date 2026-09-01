import { SignUp } from "@clerk/nextjs";
import { AUTH_FALLBACK_REDIRECT, resolveAuthDestination } from "../../lib/auth-redirect";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_url?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = typeof params.redirect_url === "string" ? params.redirect_url : undefined;
  const { redirectUrl, signInUrl } = resolveAuthDestination(raw);
  return (
    <main className="auth-page">
      <SignUp
        routing="path"
        path="/sign-up"
        signInUrl={signInUrl}
        forceRedirectUrl={redirectUrl ?? undefined}
        fallbackRedirectUrl={AUTH_FALLBACK_REDIRECT}
      />
    </main>
  );
}
