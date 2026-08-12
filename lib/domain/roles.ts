export const APP_ROLES = [
  "admin",
  "provider_manager",
  "operations_editor",
  "auditor",
  "viewer",
] as const;

export type AppRole = (typeof APP_ROLES)[number];
