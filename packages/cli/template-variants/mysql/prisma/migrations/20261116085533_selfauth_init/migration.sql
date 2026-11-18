-- CreateTable
CREATE TABLE `auth_users` (
    `id` CHAR(36) NOT NULL,
    `email` VARCHAR(254) NULL,
    `email_normalized` VARCHAR(254) NULL,
    `email_verified_at` DATETIME(3) NULL,
    `state` ENUM('pending', 'active', 'suspended', 'disabled', 'deleted') NOT NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `auth_users_email_normalized_key`(`email_normalized`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `auth_credentials` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `type` ENUM('password') NOT NULL,
    `secret_hash` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `auth_credentials_user_id_type_key`(`user_id`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `auth_sessions` (
    `id` CHAR(36) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL,
    `last_seen_at` DATETIME(3) NOT NULL,
    `idle_expires_at` DATETIME(3) NOT NULL,
    `absolute_expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `revoked_reason` ENUM('logout', 'logout_all', 'password_changed', 'password_reset', 'state_changed', 'admin', 'rotated') NULL,
    `ip_address` VARCHAR(64) NULL,
    `user_agent` VARCHAR(512) NULL,
    `reauthenticated_at` DATETIME(3) NULL,

    UNIQUE INDEX `auth_sessions_token_hash_key`(`token_hash`),
    INDEX `auth_sessions_user_id_idx`(`user_id`),
    INDEX `auth_sessions_absolute_expires_at_idx`(`absolute_expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `auth_roles` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `description` VARCHAR(191) NULL,
    `is_system` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `auth_roles_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `auth_permissions` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `description` VARCHAR(191) NULL,

    UNIQUE INDEX `auth_permissions_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `auth_user_roles` (
    `user_id` CHAR(36) NOT NULL,
    `role_id` CHAR(36) NOT NULL,
    `assigned_at` DATETIME(3) NOT NULL,
    `assigned_by` CHAR(36) NULL,

    INDEX `auth_user_roles_role_id_idx`(`role_id`),
    PRIMARY KEY (`user_id`, `role_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `auth_role_permissions` (
    `role_id` CHAR(36) NOT NULL,
    `permission_id` CHAR(36) NOT NULL,

    PRIMARY KEY (`role_id`, `permission_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `auth_password_reset_tokens` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `used_at` DATETIME(3) NULL,
    `invalidated_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `auth_password_reset_tokens_token_hash_key`(`token_hash`),
    INDEX `auth_password_reset_tokens_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `auth_email_verification_tokens` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `used_at` DATETIME(3) NULL,
    `invalidated_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `auth_email_verification_tokens_token_hash_key`(`token_hash`),
    INDEX `auth_email_verification_tokens_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `auth_security_events` (
    `id` CHAR(36) NOT NULL,
    `seq` BIGINT NOT NULL AUTO_INCREMENT,
    `type` VARCHAR(64) NOT NULL,
    `outcome` ENUM('success', 'failure') NOT NULL,
    `occurred_at` DATETIME(3) NOT NULL,
    `user_id` CHAR(36) NULL,
    `actor_id` CHAR(36) NULL,
    `ip_address` VARCHAR(64) NULL,
    `user_agent` VARCHAR(512) NULL,
    `request_id` VARCHAR(64) NULL,
    `metadata` JSON NOT NULL,

    UNIQUE INDEX `auth_security_events_seq_key`(`seq`),
    INDEX `auth_security_events_occurred_at_idx`(`occurred_at`),
    INDEX `auth_security_events_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `auth_rate_limits` (
    `key` VARCHAR(320) NOT NULL,
    `count` INTEGER NOT NULL,
    `window_ends_at` DATETIME(3) NOT NULL,
    `blocked_until` DATETIME(3) NOT NULL,
    `strikes` INTEGER NOT NULL,
    `last_block_at` DATETIME(3) NOT NULL,

    INDEX `auth_rate_limits_window_ends_at_idx`(`window_ends_at`),
    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- AddForeignKey
ALTER TABLE `auth_credentials` ADD CONSTRAINT `auth_credentials_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `auth_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_sessions` ADD CONSTRAINT `auth_sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `auth_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_user_roles` ADD CONSTRAINT `auth_user_roles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `auth_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_user_roles` ADD CONSTRAINT `auth_user_roles_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `auth_roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_role_permissions` ADD CONSTRAINT `auth_role_permissions_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `auth_roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_role_permissions` ADD CONSTRAINT `auth_role_permissions_permission_id_fkey` FOREIGN KEY (`permission_id`) REFERENCES `auth_permissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_password_reset_tokens` ADD CONSTRAINT `auth_password_reset_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `auth_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_email_verification_tokens` ADD CONSTRAINT `auth_email_verification_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `auth_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
