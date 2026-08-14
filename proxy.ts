import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/client(.*)",
  "/api/clients(.*)",
  "/api/check-ins(.*)",
  "/api/programmes(.*)",
  "/api/sessions(.*)",
  "/api/coach-ai(.*)",
  "/api/progress(.*)",
  "/api/client-portal(.*)",
  "/api/client-progress(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  if (isProtectedRoute(request)) await auth.protect();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
