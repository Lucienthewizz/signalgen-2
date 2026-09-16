export type User = {
  id: string;
  email: string;
  full_name?: string | null;
  role?: "user" | "admin";
  status?: "active" | "suspended";
  entitlement?: {
    plan_code: string;
    status: string;
    valid_until?: string | null;
  } | null;
};

export type LoginResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: User;
};

export type RegisterResponse = {
  message: string;
  requires_email_confirmation: boolean;
  access_token?: string | null;
  user: User;
};

export type ApiStatus = {
  name: string;
  version: string;
  description: string;
  docs: string;
  status: string;
};

export type MessageResponse = {
  message: string;
};
