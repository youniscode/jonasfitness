import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/client(.*)",
  "/api/clients(.*)",
  "/api/check-ins(.*)",
  "/api/programmes(.*)",
  "/api/workouts(.*)",
  "/api/sessions(.*)",
  "/api/coach-ai(.*)",
  "/api/progress(.*)",
  "/api/client-portal(.*)",
  "/api/client-progress(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  if (request.nextUrl.pathname.startsWith("/__clerk/")) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  if (!isProtectedRoute(request)) return;
  const { userId } = await auth();
  if (userId) return;

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const signInUrl = new URL("/sign-in", request.url);
  signInUrl.searchParams.set("redirect_url", request.url);
  return NextResponse.redirect(signInUrl);
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
