// @useauthio/react-native — public entry point.
//
// Multi-org-first: a single end-user identity can belong to many
// organizations. `AuthioSession.userId` always identifies the person;
// `AuthioSession.orgId` is the active organization (null when the user
// has authenticated but not yet picked an org).

export { AuthioClient } from "./client";
export {
  AuthioProvider,
  AuthioContext,
  type AuthioContextValue,
  type AuthioProviderProps,
} from "./provider";
export {
  useAuthio,
  useAuthioClient,
  useUser,
  useOrganizations,
  useActiveOrganization,
  useSwitchOrganization,
  useSignOut,
  type UseUserResult,
  type UseOrganizationsResult,
  type UseActiveOrganizationResult,
} from "./hooks";

export { AuthioError, AuthioErrorCode, type AuthioErrorCodeT } from "./errors";
export { MemoryStorage } from "./storage";

export type {
  AuthioClientOptions,
  AuthioSession,
  Membership,
  MembershipStatus,
  MembershipWithOrg,
  Organization,
  OAuthProvider,
  PreferredLoginMethod,
  SessionStorage,
  User,
} from "./types";

// Re-exports of helpers customers sometimes want to call directly
// (e.g. handling deep links outside the provider).
export { extractQueryParam, extractTokenFromUrl } from "./magic-link";
