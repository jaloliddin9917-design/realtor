/**
 * Settings screen data. Users are real (`GET`/`POST /api/v1/users`). Bot channels are real too,
 * but owned by entities/bot (`GET /api/v1/bot`) — pages/settings/ui/ChannelsSection.tsx reuses
 * that entity's `$channels`/`fetchBotFx` rather than duplicating them here. The rules/thresholds
 * section reads `entities/meta`'s `$meta.rules` (`GET /api/v1/meta`) — also nothing to mock here.
 * The sources list is `entities/source`'s real `$sources`/`fetchSourcesFx`.
 */
import { api, unwrap, type Schemas } from "@/shared/api";

export type UserRole = "admin" | "agent";

export interface SettingUser {
  id: string;
  name: string;
  role: UserRole;
  phone: string;
  active: boolean;
}

/** Test fixture only — production reads {@link fetchUsers}. */
export const MOCK_USERS: SettingUser[] = [
  { id: "u1", name: "Sardor", role: "admin", phone: "+998900001120", active: true },
  { id: "u2", name: "Aziz", role: "agent", phone: "+998901112233", active: true },
  { id: "u3", name: "Malika", role: "agent", phone: "+998912223344", active: true },
  { id: "u4", name: "Dilshod", role: "agent", phone: "+998933334455", active: false },
  { id: "u5", name: "Jasur", role: "agent", phone: "+998944445566", active: true },
];

// ---- real API ----
function mapUser(o: Schemas["AdminUserOut"]): SettingUser {
  return { id: o.id, name: o.name, role: o.role, phone: o.phone, active: o.active };
}

export function fetchUsers(): Promise<SettingUser[]> {
  return unwrap(api.GET("/api/v1/users")).then((rows) => rows.map(mapUser));
}

export interface AddUserInput {
  name: string;
  phone: string;
  /** Minimum 8 characters — `UserCreateIn.password` on the backend enforces the same. */
  password: string;
  role: UserRole;
}

/** Rejects 409 `user.exists` on a duplicate phone, 422 on a bad role or a too-short password. */
export function addUser(input: AddUserInput): Promise<SettingUser> {
  return unwrap(api.POST("/api/v1/users", { body: input })).then(mapUser);
}
