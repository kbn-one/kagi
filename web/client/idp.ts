/**
 * IdP origin shared by the sign-in UI (navbar + /my page).
 *
 * The `/my` page authorizes against `${IDP_ORIGIN}/authorize` and reads the
 * session from `${IDP_ORIGIN}/session` using DPoP-bound requests.
 */

export const IDP_ORIGIN = "https://id.kbn.one";
