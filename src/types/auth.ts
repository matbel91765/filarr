/**
 * Auth types — local-only build.
 *
 * Cloud account types (UserDTO, RegisterResult, AuthStatus, DeviceInfo)
 * have been removed alongside the cloud auth services.
 */

export interface AuthError {
  code: string;
  message: string;
}
