-- CreateEnum
CREATE TYPE "auth_account_state" AS ENUM ('pending', 'active', 'suspended', 'disabled', 'deleted');

-- CreateEnum
CREATE TYPE "auth_credential_type" AS ENUM ('password');

-- CreateEnum
CREATE TYPE "auth_session_revoked_reason" AS ENUM ('logout', 'logout_all', 'password_changed', 'password_reset', 'state_changed', 'admin', 'rotated');

-- CreateEnum
CREATE TYPE "auth_event_outcome" AS ENUM ('success', 'failure');

-- CreateTable
CREATE TABLE "auth_users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254),
    "email_normalized" VARCHAR(254),
    "email_verified_at" TIMESTAMPTZ(3),
    "state" "auth_account_state" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "auth_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_credentials" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "auth_credential_type" NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "auth_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "idle_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" "auth_session_revoked_reason",
    "ip_address" VARCHAR(64),
    "user_agent" VARCHAR(512),
    "reauthenticated_at" TIMESTAMPTZ(3),

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_roles" (
    "id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "auth_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_permissions" (
    "id" UUID NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "description" TEXT,

    CONSTRAINT "auth_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL,
    "assigned_by" UUID,

    CONSTRAINT "auth_user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "auth_role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "auth_role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "auth_password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "invalidated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "auth_password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_email_verification_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "invalidated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "auth_email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_security_events" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "outcome" "auth_event_outcome" NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" UUID,
    "actor_id" UUID,
    "ip_address" VARCHAR(64),
    "user_agent" VARCHAR(512),
    "request_id" VARCHAR(64),
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "auth_security_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_rate_limits" (
    "key" VARCHAR(320) NOT NULL,
    "count" INTEGER NOT NULL,
    "window_ends_at" TIMESTAMPTZ(3) NOT NULL,
    "blocked_until" TIMESTAMPTZ(3) NOT NULL,
    "strikes" INTEGER NOT NULL,
    "last_block_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "auth_rate_limits_pkey" PRIMARY KEY ("key")
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
CREATE UNIQUE INDEX "auth_security_events_seq_key" ON "auth_security_events"("seq");

-- CreateIndex
CREATE INDEX "auth_security_events_occurred_at_idx" ON "auth_security_events"("occurred_at");

-- CreateIndex
CREATE INDEX "auth_security_events_user_id_idx" ON "auth_security_events"("user_id");

-- CreateIndex
CREATE INDEX "auth_rate_limits_window_ends_at_idx" ON "auth_rate_limits"("window_ends_at");

-- AddForeignKey
ALTER TABLE "auth_credentials" ADD CONSTRAINT "auth_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_user_roles" ADD CONSTRAINT "auth_user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_user_roles" ADD CONSTRAINT "auth_user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "auth_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_role_permissions" ADD CONSTRAINT "auth_role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "auth_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_role_permissions" ADD CONSTRAINT "auth_role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "auth_permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_password_reset_tokens" ADD CONSTRAINT "auth_password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_email_verification_tokens" ADD CONSTRAINT "auth_email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
