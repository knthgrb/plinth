export type AccountCapabilities = {
  canCreateOrganization: boolean;
};

export function getAccountCapabilities({
  isAuthenticated,
}: {
  isAuthenticated: boolean;
}): AccountCapabilities {
  return {
    canCreateOrganization: isAuthenticated,
  };
}
