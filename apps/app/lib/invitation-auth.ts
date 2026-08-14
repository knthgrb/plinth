type InvitationAuthDestination = "login" | "signup";

const APPLICATION_ORIGIN = "https://plinth.local";

interface InvitationAuthDetails {
  email: string;
  token: string;
}

interface SearchParamsReader {
  get(name: string): string | null;
}

export interface InvitationAuthContext {
  email: string;
  redirect: string;
}

function isInternalPath(path: string): boolean {
  if (!path.startsWith("/")) return false;

  try {
    return new URL(path, APPLICATION_ORIGIN).origin === APPLICATION_ORIGIN;
  } catch {
    return false;
  }
}

export function buildInvitationAcceptPath(token: string): string {
  const params = new URLSearchParams({ token });
  return `/invite/accept?${params.toString()}`;
}

export function buildInvitationAuthPath(
  destination: InvitationAuthDestination,
  details: InvitationAuthDetails,
): string {
  const params = new URLSearchParams({
    email: details.email,
    redirect: buildInvitationAcceptPath(details.token),
    invite: "1",
  });

  return `/${destination}?${params.toString()}`;
}

export function getSafeInternalRedirect(
  searchParams: SearchParamsReader,
  fallback = "/",
): string {
  const redirect = searchParams.get("redirect");
  return redirect && isInternalPath(redirect) ? redirect : fallback;
}

export function isInvitationAuthFlow(
  searchParams: SearchParamsReader,
): boolean {
  if (searchParams.get("invite") !== "1") return false;

  const redirect = getSafeInternalRedirect(searchParams, "");
  if (!redirect) return false;

  const invitationUrl = new URL(redirect, APPLICATION_ORIGIN);
  return (
    invitationUrl.pathname === "/invite/accept" &&
    Boolean(invitationUrl.searchParams.get("token")?.trim())
  );
}

export function getInvitationAuthContext(
  searchParams: SearchParamsReader,
): InvitationAuthContext | null {
  if (!isInvitationAuthFlow(searchParams)) return null;

  const email = searchParams.get("email")?.trim().toLowerCase();
  if (!email) return null;

  return {
    email,
    redirect: getSafeInternalRedirect(searchParams),
  };
}
