-- CreateTable
CREATE TABLE "auth_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT,
    "email_normalized" TEXT,
    "email_verified_at" DATETIME,
    "state" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME
);

-- CreateTable
CREATE TABLE "auth_credentials" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "auth_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL,
    "last_seen_at" DATETIME NOT NULL,
    "idle_expires_at" DATETIME NOT NULL,
    "absolute_expires_at" DATETIME NOT NULL,
    "revoked_at" DATETIME,
    "revoked_reason" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "reauthenticated_at" DATETIME,
    CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "auth_roles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "auth_permissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT
);

-- CreateTable
CREATE TABLE "auth_user_roles" (
    "user_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "assigned_at" DATETIME NOT NULL,
    "assigned_by" TEXT,

    PRIMARY KEY ("user_id", "role_id"),
    CONSTRAINT "auth_user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "auth_user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "auth_roles" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "auth_role_permissions" (
    "role_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,

    PRIMARY KEY ("role_id", "permission_id"),
    CONSTRAINT "auth_role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "auth_roles" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "auth_role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "auth_permissions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "auth_password_reset_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "used_at" DATETIME,
    "invalidated_at" DATETIME,
    "created_at" DATETIME NOT NULL,
    CONSTRAINT "auth_password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "auth_email_verification_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "used_at" DATETIME,
    "invalidated_at" DATETIME,
    "created_at" DATETIME NOT NULL,
    CONSTRAINT "auth_email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "auth_security_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "occurred_at" DATETIME NOT NULL,
    "user_id" TEXT,
    "actor_id" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "request_id" TEXT,
    "metadata" JSONB NOT NULL
);

-- CreateTable
CREATE TABLE "auth_rate_limits" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "count" INTEGER NOT NULL,
    "window_ends_at" DATETIME NOT NULL,
    "blocked_until" DATETIME NOT NULL,
    "strikes" INTEGER NOT NULL,
    "last_block_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_users_email_normalized_key" ON "auth_users"("email_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "auth_credentials_user_id_type_key" ON "auth_credentials"("user_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");

-- CreateIndex
CREATE INDEX "auth_sessions_absolute_expires_at_idx" ON "auth_sessions"("absolute_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "auth_roles_name_key" ON "auth_roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "auth_permissions_name_key" ON "auth_permissions"("name");

-- CreateIndex
CREATE INDEX "auth_user_roles_role_id_idx" ON "auth_user_roles"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_password_reset_tokens_token_hash_key" ON "auth_password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "auth_password_reset_tokens_user_id_idx" ON "auth_password_reset_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_email_verification_tokens_token_hash_key" ON "auth_email_verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "auth_email_verification_tokens_user_id_idx" ON "auth_email_verification_tokens"("user_id");

-- CreateIndex
CREATE INDEX "auth_security_events_occurred_at_idx" ON "auth_security_events"("occurred_at");

-- CreateIndex
CREATE INDEX "auth_security_events_user_id_idx" ON "auth_security_events"("user_id");

-- CreateIndex
CREATE INDEX "auth_rate_limits_window_ends_at_idx" ON "auth_rate_limits"("window_ends_at");
