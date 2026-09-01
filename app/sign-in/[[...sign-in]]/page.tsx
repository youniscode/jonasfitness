import { SignIn } from "@clerk/nextjs";
import { AUTH_FALLBACK_REDIRECT, resolveAuthDestination } from "../../lib/auth-redirect";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_url?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = typeof params.redirect_url === "string" ? params.redirect_url : undefined;
  const { redirectUrl, signUpUrl } = resolveAuthDestination(raw);
  return (
    <main className="auth-page">
      <SignIn
        routing="path"
        path="/sign-in"
        signUpUrl={signUpUrl}
        forceRedirectUrl={redirectUrl ?? undefined}
        fallbackRedirectUrl={AUTH_FALLBACK_REDIRECT}
      />
    </main>
  );
}
